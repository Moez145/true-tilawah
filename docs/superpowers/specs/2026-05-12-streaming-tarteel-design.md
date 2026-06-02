# True Tilawah — Streaming Tarteel Recitation Pipeline

**Date:** 2026-05-12
**Status:** Approved (awaiting implementation)
**Scope:** Replace the current Groq-based per-utterance pipeline with a local streaming pipeline using `tarteel-ai/whisper-base-ar-quran` via `faster-whisper`. Mid-recitation feedback: every mispronounced word is highlighted red on screen and the correct pronunciation is played aloud — **without** the user pausing. Server is deployed to a free Hugging Face Space.

**Supersedes (partially):** §3 (pipeline) and §4 (wire protocol) of [`2026-05-03-ai-integration-design.md`](2026-05-03-ai-integration-design.md). All non-pipeline contracts (auth, sessions, DB schema, Progress aggregation, disputed-feedback exclusion, frontend ↔ backend WS framing) carry over unchanged.

---

## 1. Goals & non-goals

### Must-have
- Server transcribes a **rolling 4 s audio window every 250 ms** using locally-loaded `tarteel-ai/whisper-base-ar-quran` via `faster-whisper` (CTranslate2 int8).
- A **lock-in rule** (a word must appear at the same position in ≥ 2 consecutive ASR runs) gates emission to suppress Whisper edits/hallucinations.
- Each locked-in word is immediately diffed against the user's selected ayah and tajweed-checked. A mispronunciation, omission, or HIGH-severity tajweed violation emits a `partial_mistake` event **mid-ayah, without waiting for the user to pause**.
- Frontend renders ayahs **word-by-word** and paints the offending word red on `partial_mistake`. Within the same event, the frontend plays a short audio clip of the correct pronunciation (EveryAyah CDN word-timing seek, falling back to gTTS).
- A **MistakeStateMachine** handles the user's free choice: if they re-read the corrected word, it goes green (`word_corrected`); if they move on, the red fades (`mistake_acknowledged`); no nagging — a mistake at a given position emits **at most once per ayah**.
- VAD's role narrows to detecting end-of-ayah silence (≥ 0.7 s). At that point a final consolidated `ayah_finalized` event is emitted and Node persists `Feedback` rows (single batch per ayah).
- `final_report` on `STOP` is unchanged in semantics; Session/Progress flow untouched.
- AI service runs on a free Hugging Face Space (Docker SDK, CPU Basic, 2 vCPU / 16 GB RAM). Node connects to its `wss://` URL with a bearer token in the WS upgrade headers.

### Non-goals
- Replacing or extending current tajweed rules (Qalqala, Madd, Ghunna stay as-is).
- Frontend `react-native-live-audio-stream` integration itself (still flagged "pending" in CLAUDE.md; assumed done before this work lands).
- Touching any non-audio REST endpoint or non-WS frontend code.
- Multi-user concurrency tuning for the HF Space (single user / small testing crowd is the target).
- Self-hosted Coqui TTS — EveryAyah covers all ayahs; gTTS handles rare misses.
- Adding `python-Levenshtein` (RapidFuzz already provides the same C-Levenshtein faster).
- DTW / phonetic matching libraries (Tarteel + scoped LCS is sufficient; revisit only if measured accuracy is poor).

### Success criteria

| Metric | Target |
|---|---|
| Time from end-of-word to red highlight on screen (HF Spaces CPU) | ≤ 1.0 s p95 |
| Time from end-of-word to first TTS audio audible | ≤ 1.3 s p95 |
| False-positive rate (correct word flagged wrong) | ≤ 5 % on a 10-recitation smoke test |
| `partial_mistake` followed by `word_corrected` / `mistake_acknowledged` for **every** emitted partial | 100 % (no orphan red highlights) |
| Same `(ayah, word_index)` re-emitting `partial_mistake` in a single ayah pass | 0 % (nagging suppression) |
| `ayah_finalized` produces exactly the same set of `Feedback` rows as today's `mistake` event | 100 % parity (DB shape unchanged) |
| End-to-end smoke: 10 recitations, Tarteel mistake set agrees with Groq on ≥ 80 % of words | Sign-off gate |

---

## 2. Architecture overview

```
┌──────────────────────────────┐
│   React Native (Expo, RN)    │
│ Mic → int16 PCM 16 kHz       │
│ Word-by-word renderer        │
│ wordStateStore               │
│ ttsQueueService              │
│ wordAudioPrefetch            │
└──────────────┬───────────────┘
               │ WS  ws://api/ws/audio?token=…&sessionId=…
               │ Frame 1: text JSON config
               │ Frames 2..N: binary [4-byte seqNo][int16 PCM]
               │ Final: text "STOP"
               ▼
┌──────────────────────────────┐
│  Node.js Backend (Express)   │
│ (UNCHANGED endpoints)        │
│ src/routes/audio.ws.js       │  ← only this file changes
│ src/services/ai.service.js   │  ← only this file changes
└──────────────┬───────────────┘
               │ WSS  wss://<user>-truetilawah-asr.hf.space/ws/evaluate
               │ Authorization: Bearer <AI_SERVICE_AUTH_TOKEN>
               │ Frame 1: text JSON config (surahId, ayahStart, ayahEnd, sessionId)
               │ Frames 2..N: binary float32 PCM 16 kHz
               │ Final: text "STOP"
               ▼
┌────────────────────────────────────────────────────────────┐
│  Python AI service (Hugging Face Space, Docker, CPU)        │
│                                                              │
│  Streaming inner loop:                                       │
│    every 250 ms →                                            │
│       faster-whisper.WhisperModel.transcribe(last 4 s)       │
│         (tarteel-ai/whisper-base-ar-quran, CT2 int8)         │
│       → StableTracker.feed(new_transcript)                   │
│       → for each newly_locked_word:                          │
│           Aligner.align_partial(words_so_far)                │
│           diff vs ayah_words[position]                       │
│           tajweed.check(word, context)                       │
│           MistakeStateMachine.observe(locked)                │
│           emit partial_mistake | word_corrected |            │
│                mistake_acknowledged                          │
│    when VAD detects ≥ 0.7 s silence →                        │
│       emit ayah_finalized (mistake list for that ayah)       │
│       reset trackers for next ayah                           │
│    on "STOP" →                                               │
│       emit final_report                                      │
└──────────────────────────────────────────────────────────────┘
               │
               │ TTS audio: frontend fetches DIRECTLY from
               ▼ https://everyayah.com/.../<surah>_<ayah>.mp3 with word-timing seek
┌──────────────────────────────┐
│  EveryAyah CDN (free)        │
│  Fallback: gTTS (server)     │
└──────────────────────────────┘
```

**What changes**: ai-service inner loop, two backend files, one frontend screen + four new frontend services.
**What does not change**: auth, sessions, REST endpoints, DB schema, all other frontend screens, Quran loader, Tajweed rule code, Silero VAD model, the `TranscriptionProvider` ABC, the wire framing on the RN ↔ Node leg.

---

## 3. Streaming pipeline

### 3.1 Audio ingest

| Stage | Detail |
|---|---|
| Sample rate | 16 kHz mono (unchanged) |
| Frame size from RN to Node | unchanged — `[4-byte BE seqNo][int16 PCM]` |
| Node → Python | unchanged — strips seqNo, converts int16 → float32, forwards binary frames |
| Python rolling buffer | `numpy.float32` 1-D, append on every binary frame |
| Buffer trim | Trim oldest samples once buffer exceeds `STREAM_WINDOW_SEC + 1 s` to bound memory |

### 3.2 Streaming cadence

| Constant | Default | Tunable via env |
|---|---|---|
| `STREAM_CHUNK_SEC` | `0.25` | yes |
| `STREAM_WINDOW_SEC` | `4.0` | yes |
| `STREAM_LOCK_IN_RUNS` | `2` | yes |
| `VAD_SILENCE_THRESHOLD_SEC` | `0.7` (was `1.0`) | yes |
| `PENDING_CORRECTION_TIMEOUT_SEC` | `2.0` | yes |

Adaptive fallback: if 5 consecutive ASR runs exceed `STREAM_CHUNK_SEC + 30 ms` of inference, cadence backs off to `0.5 s` and `STREAM_LOCK_IN_RUNS` drops to `1` (announced in `ready` event so the client can adjust the UX hint).

### 3.3 StableTracker (word lock-in)

Given a sequence of normalised, whitespace-split transcripts `T₁, T₂, … Tₙ`, a word at position `p` is **locked** when:

```
T_{n-1}[p] == T_n[p]  AND  p < len(T_n) - 1   (i.e. not the trailing tentative tail)
```

The tracker exposes:
- `feed(transcript: str) -> list[LockedWord]` — returns words newly locked in this run (never previously locked).
- `current_locked() -> list[str]` — full known-good prefix.
- `reset()` — called on `ayah_finalized`.

Normalisation before comparison uses `arabic_norm.canonical(word)` (strip tashkeel, normalise Alef/Ya). Comparison is byte-level after normalisation.

### 3.4 Partial aligner

`ayah_aligner.align_partial(words_so_far: list[str], scope: VerseScope, last_anchor: AyahAnchor | None) -> AyahAnchor | None`

- After ≥ 3 normalised words match a single ayah in scope (RapidFuzz partial ratio ≥ 80), the alignment is **anchored** to that ayah.
- Subsequent words map directly to incremental positions in the anchored ayah.
- If a freshly locked word causes the running alignment score to drop > 25 points, the anchor is invalidated, the MistakeStateMachine for that ayah is reset, and re-alignment runs from scratch on the next lock-in.

### 3.5 Per-word mistake builder

`pipeline.build_partial_mistake(locked: LockedWord, anchor: AyahAnchor) -> Mistake | None`

Output schema:

```json
{
  "type": "OMITTED_WORD" | "MISPRONUNCIATION" | "TAJWEED_VIOLATION" | "ADDED_WORD",
  "incorrect": "عبدنا",
  "correct": "عَبْدِنَا",
  "tajweedRule": "Madd" | null,
  "severity": "high" | null,
  "tip": "Elongate the long vowel (2 to 6 counts)." | null
}
```

Decision matrix:

| Locked word vs expected at anchor.position | Output |
|---|---|
| Equal after normalisation, no HIGH-severity tajweed violation | `None` (no event) |
| Equal after normalisation, HIGH-severity tajweed rule failed | `TAJWEED_VIOLATION` |
| Mismatch but expected word skipped, locked == ayah_words[position + 1] | `OMITTED_WORD` for `position` (then advance anchor) |
| Mismatch and not a skip | `MISPRONUNCIATION` |
| Locked word matches none of next 3 expected positions | `ADDED_WORD` (`correct` is empty string) |

Only HIGH-severity tajweed violations surface — LOW/MEDIUM stay advisory (rule unchanged from current behaviour).

### 3.6 MistakeStateMachine

Per WS connection, in-memory:

```python
PendingMistake = dataclass(
    state: Literal["PENDING", "CORRECTED", "ACKNOWLEDGED"],
    emitted_at: float,
    expected_correct: str,         # normalised
    expected_next_position: int,
    payload: Mistake,
)

pending: dict[tuple[int, int], PendingMistake] = {}
```

Transitions, triggered by each newly locked word `w` at position `pos`:

| Trigger | Effect | Event |
|---|---|---|
| `(ayah, pos) in pending` and `state == PENDING` and `canonical(w) == expected_correct` | mark CORRECTED | emit `word_corrected` |
| Any existing PENDING entry whose `expected_next_position == pos` | mark ACKNOWLEDGED | emit `mistake_acknowledged` for that entry |
| 2 s elapsed since `emitted_at` for any PENDING entry, no relevant lock-in | mark ACKNOWLEDGED | emit `mistake_acknowledged` |
| New mistake at `(ayah, pos)` and entry already in pending | **suppress emission** | (no event) |

Timer is driven by a `asyncio.create_task(_sweep_pending())` background task per WS connection that polls every 250 ms; it terminates on WS close.

### 3.7 Ayah finalisation

On every binary frame, after the streaming loop, run a cheap `is_recent_silence(buffer, last_n_sec=1.0, threshold_sec=0.7)` check:

- Returns `True` iff the last 1 s of the buffer has ≤ 0.7 s of cumulative speech (Silero VAD probs averaged per 32 ms frame).
- When `True` **and** the anchor for the current ayah is set: emit `ayah_finalized` with the consolidated mistake list (every payload that was emitted as `partial_mistake` for this anchor, regardless of state). Reset MistakeStateMachine entries for this ayah, reset StableTracker, advance anchor expectation to next ayah.

### 3.8 Final report

`STOP` flow is unchanged. `SummaryAccumulator` consumes only `ayah_finalized` events (renamed from today's `mistake` event for clarity).

---

## 4. Wire protocol

### 4.1 Server → client event vocabulary

| `type` | Fires when | Persisted by Node? | Frontend UI action |
|---|---|---|---|
| `ready` | AI service accepts config frame; includes `effective_chunk_sec` after adaptive check | — | Show "listening" indicator |
| `partial_mistake` | Locked-in word at `(ayah, word_index)` ≠ expected; first emission only | ❌ | Paint word red; enqueue + play TTS clip |
| `word_corrected` | User re-recited the corrected word in expected position | ❌ | Paint word green |
| `mistake_acknowledged` | User moved past the mistake OR 2 s timeout elapsed | ❌ | Fade red to faded-red |
| `ayah_finalized` | VAD detects ayah-end silence | ✅ via `createFeedbackBatch` | Optional summary toast |
| `unclear` | ASR returned empty/garbled text for a buffer ≥ `MIN_SPEECH_SEC` | ❌ | Optional indicator |
| `out_of_scope` | Transcript matched no ayah in scope after 3 attempts | ❌ | Optional "wrong ayah?" toast |
| `final_report` | After client sends "STOP" | Updates Session + Progress | Show grade screen |
| `error` | Pipeline failure | ❌ | Show error toast |

### 4.2 Payload shapes

```jsonc
// partial_mistake
{
  "type": "partial_mistake",
  "ayah": 23,
  "word_index": 3,                          // 0-based, within ayah
  "mistake": {
    "type": "OMITTED_WORD",
    "incorrect": "",
    "correct": "رَيْبٍ",
    "tajweedRule": null,
    "severity": null,
    "tip": null
  },
  "audio_url": "https://everyayah.com/data/Husary_64kbps/002023.mp3",
  "audio_word_timing": {"start_ms": 1450, "end_ms": 1820},  // from Quran.com word timings; null if unknown
  "audio_fallback_url": null,               // server-generated gTTS URL, only when EveryAyah lacks the surah
  "state": "pending"
}

// word_corrected
{ "type": "word_corrected", "ayah": 23, "word_index": 3 }

// mistake_acknowledged
{ "type": "mistake_acknowledged", "ayah": 23, "word_index": 3 }

// ayah_finalized
{
  "type": "ayah_finalized",
  "ayah": 23,
  "mistakes": [ /* same shape as today's mistake[].mistakes — array of mistakes */ ]
}

// final_report (unchanged from spec 2026-05-03 §4.1.1)
{
  "type": "final_report",
  "grade": "A",
  "averageAccuracy": 0.94,
  "totalMistakes": 3,
  "ayahsCovered": [23, 24, 25]
}
```

### 4.3 Backwards compatibility

The legacy `mistake` event (today's per-ayah batch) is **removed** and replaced by `ayah_finalized` (identical payload shape under a new name). This is a breaking change to the Node ↔ Python wire only; the Node → RN wire keeps the existing `mistake` name for RN clients by mapping `ayah_finalized` → `mistake` in `audio.ws.js` (one-line rename in the dispatcher). All new events are forwarded under their new names.

### 4.4 Connection authentication (HF Space)

The HF Space exposes a public `wss://` URL. Node sends a bearer token in the WS upgrade `Authorization` header:

```
Authorization: Bearer <AI_SERVICE_AUTH_TOKEN>
```

The ai-service rejects upgrades without a matching token (constant-time compare). Token is set as an HF Space secret and as a `backend/.env` value, never committed.

---

## 5. Module breakdown

### 5.1 ai-service (Python)

```
ai-service/app/
├── main.py                       UNCHANGED   FastAPI entry, /health + /ws/evaluate
├── config.py                     EDIT        +streaming/TTS env vars
├── lifespan.py                   EDIT        load Tarteel via faster-whisper; detect CPU vs GPU
├── quran_index.py                UNCHANGED
├── vad.py                        EDIT        +is_recent_silence(buffer, last_n_sec, threshold_sec)
├── ayah_aligner.py               EDIT        +align_partial(words_so_far, scope, last_anchor)
├── word_diff.py                  EDIT        +diff_locked_word(locked, expected_words, position)
├── tajweed.py                    UNCHANGED   Qalqala/Madd/Ghunna; called per-word now
├── pipeline.py                   EDIT        +build_partial_mistake(); +MistakeStateMachine class
├── arabic_norm.py                NEW         pyarabic wrapper: canonical(word), strip_diacritics(text)
├── streaming_buffer.py           NEW         RollingBuffer + StableTracker
├── tts_resolver.py               NEW         (surah, ayah, word_idx) → (audio_url, audio_word_timing, fallback_url)
├── auth.py                       NEW         constant-time bearer-token check
├── ws_handler.py                 REWRITE     streaming inner loop; new event emissions
└── transcription/
    ├── base.py                   UNCHANGED
    ├── tarteel.py                NEW         faster-whisper provider
    ├── groq.py                   UNCHANGED   kept as dead code for fallback
    └── local_whisper.py          UNCHANGED   deprecated; not used

ai-service/scripts/
├── convert_tarteel_model.py      NEW         HF → CT2 conversion (idempotent)
└── build_word_timing_index.py    NEW         fetch Quran.com word-timing JSON, cache to ./data/

ai-service/tests/
├── test_streaming_buffer.py      NEW
├── test_stable_tracker.py        NEW
├── test_arabic_norm.py           NEW
├── test_align_partial.py         NEW
├── test_mistake_state_machine.py NEW
├── test_tts_resolver.py          NEW
└── test_ws_handler_streaming.py  NEW         replay WAV; assert partial→corrected→finalized event order
```

### 5.2 backend (Node.js)

| File | Status | Change |
|---|---|---|
| [backend/src/routes/audio.ws.js](../../backend/src/routes/audio.ws.js) | EDIT | Add cases for `partial_mistake`, `word_corrected`, `mistake_acknowledged`, `ayah_finalized` in the Python-event dispatcher. Relay first three verbatim to RN. `ayah_finalized` → call `createFeedbackBatch` (existing service) **then** relay to RN as `mistake` (for RN backwards-compat). |
| [backend/src/services/ai.service.js](../../backend/src/services/ai.service.js) | EDIT | Connect to `AI_SERVICE_WSS_URL` instead of host+port. Send `Authorization: Bearer ${AI_SERVICE_AUTH_TOKEN}` on WS handshake. Extend `onEvent` dispatcher. |
| [backend/.env.example](../../backend/.env.example) | EDIT | Add `AI_SERVICE_WSS_URL`, `AI_SERVICE_AUTH_TOKEN`. Keep legacy `AI_SERVICE_HOST`/`AI_SERVICE_PORT` for local Docker mode. |

**No other backend files touched.** REST endpoints, Prisma schema, services, middleware — all unchanged.

### 5.3 frontend (React Native)

| File | Status | Change |
|---|---|---|
| [frontend/src/screens/ReciteScreen.js](../../frontend/src/screens/ReciteScreen.js) | EDIT | Render selected ayahs **word-by-word** via flex-wrap. Each word is a memoized `<WordToken>` reading state from `wordStateStore`. Style maps state → colour. |
| [frontend/src/services/audioStreamService.js](../../frontend/src/services/audioStreamService.js) | EDIT | Dispatch new event types: `partial_mistake`, `word_corrected`, `mistake_acknowledged`. Existing `mistake` / `final_report` handlers unchanged. |
| `frontend/src/services/wordStateStore.js` | NEW | Zustand store: `{[ayah]: {[wordIdx]: 'pending'\|'mistake'\|'corrected'\|'acknowledged'}}` + setters. |
| `frontend/src/services/ttsQueueService.js` | NEW | Strict FIFO queue using `expo-av`. Pre-warmed `Sound` objects, max 2 queued, drop oldest if pile-up. |
| `frontend/src/services/wordAudioPrefetch.js` | NEW | At session start, prefetch ayah-level mp3s + word-timing JSON from EveryAyah; store in `expo-file-system`. |
| [frontend/src/constants/colors.js](../../frontend/src/constants/colors.js) | EDIT | Add tokens: `wordPending`, `wordMistake`, `wordCorrected`, `wordAcknowledged`. |

**No other frontend files touched.** Auth screens, navigation, Quran browser, session list, settings — all unchanged.

### 5.4 docs

| File | Status |
|---|---|
| `docs/superpowers/specs/2026-05-12-streaming-tarteel-design.md` | NEW (this file) |
| `docs/superpowers/plans/2026-05-12-streaming-tarteel.md` | NEW (TDD plan; built next) |
| `docs/superpowers/specs/2026-05-03-ai-integration-design.md` | UNCHANGED (this spec supersedes its §3 & §4 only) |

---

## 6. Configuration

### 6.1 ai-service/.env (HF Space secrets + local override)

```ini
TRANSCRIPTION_PROVIDER=tarteel
WHISPER_MODEL_PATH=./models/tarteel-ct2/
STREAM_CHUNK_SEC=0.25
STREAM_WINDOW_SEC=4.0
STREAM_LOCK_IN_RUNS=2
VAD_SILENCE_THRESHOLD_SEC=0.7
PENDING_CORRECTION_TIMEOUT_SEC=2.0
TTS_AUDIO_BASE_URL=https://everyayah.com/data/Husary_64kbps
TTS_WORD_TIMING_INDEX_PATH=./data/word_timings.json
AI_SERVICE_AUTH_TOKEN=<32-byte random hex; HF Space secret>
```

### 6.2 backend/.env

```ini
AI_SERVICE_WSS_URL=wss://<hf-user>-truetilawah-asr.hf.space/ws/evaluate
AI_SERVICE_AUTH_TOKEN=<same as HF Space secret>
# Legacy local mode (still supported):
AI_SERVICE_HOST=localhost
AI_SERVICE_PORT=8000
```

`ai.service.js` picks `AI_SERVICE_WSS_URL` if set, else falls back to `ws://${AI_SERVICE_HOST}:${AI_SERVICE_PORT}/ws/evaluate`.

### 6.3 HF Space

| Setting | Value |
|---|---|
| SDK | Docker |
| Hardware | CPU Basic (free) |
| Visibility | Private |
| Build entry | `Dockerfile` at repo root of the Space |
| Secrets | `AI_SERVICE_AUTH_TOKEN` |
| Public port | `7860` (HF default) |
| WSS URL | `wss://<user>-truetilawah-asr.hf.space/ws/evaluate` |

### 6.4 Dockerfile additions (HF Space-friendly)

```dockerfile
FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt requirements-local-whisper.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-local-whisper.txt
COPY . .
RUN python scripts/convert_tarteel_model.py
RUN python scripts/build_word_timing_index.py
EXPOSE 7860
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860"]
```

---

## 7. Latency budget (HF Space free CPU, 2 vCPU)

| Stage | Realistic | Target | Notes |
|---|---|---|---|
| End of mispronounced word → next ASR boundary | 0–250 ms (avg 125 ms) | — | Forced by `STREAM_CHUNK_SEC` |
| `faster-whisper` int8 on 4 s window | 200–400 ms | < 250 ms | Tarteel-base is small; quantization keeps it cheap |
| Lock-in wait (next ASR run confirms) | +300 ms | — | One additional cadence cycle |
| Aligner + diff + tajweed | 5–20 ms | < 50 ms | In-memory |
| Build + send WS event | 5–20 ms | < 50 ms | Small JSON |
| Node relay → RN render | 30–100 ms | < 150 ms | LAN/WAN dependent |
| **End-to-end highlight** | **≈ 700–900 ms** | **≤ 1.0 s p95** | ✅ |
| RN dequeue cached audio + play | 100–200 ms | < 250 ms | Pre-fetched at session start |
| **End-to-end first audio audible** | **≈ 900–1100 ms** | **≤ 1.3 s p95** | ✅ |

Sub-500 ms feedback is **not** achievable on free CPU; explicitly out of scope for this version. To reach 500 ms, the path is a GPU host (paid Fly.io ≈ $0.40/hr, or Modal trial). The streaming architecture is GPU-ready — only `WhisperModel(... device="cuda", compute_type="float16")` changes.

---

## 8. Hosting & deployment

### 8.1 Hugging Face Space setup (one-time)

1. Create Space `<user>/truetilawah-asr`. SDK = Docker. Hardware = CPU Basic. Visibility = Private.
2. Push `ai-service/` contents to the Space repo (Dockerfile at root).
3. Set Space secret `AI_SERVICE_AUTH_TOKEN` to a random 32-byte hex.
4. First build: ~8 min (torch + faster-whisper + Tarteel model download).
5. Confirm `wss://<user>-truetilawah-asr.hf.space/ws/evaluate` accepts a WS upgrade with the bearer token.

### 8.2 Keep-warm

HF Space free tier sleeps after 48 h idle (~30 s cold start). Mitigations:

- Node retries WS connection up to 3× with exponential backoff (0.5 s, 2 s, 8 s).
- Optional: free UptimeRobot or GitHub Actions cron pings `/health` every 25 min.

### 8.3 Device testing path

- AI service: HF Space (public WSS).
- Node + MySQL: laptop (existing `npm run dev`).
- Cloudflare Tunnel: `cloudflared tunnel --url http://localhost:5000` → stable URL.
- RN dev build points at the Cloudflare tunnel URL. Node points at the HF Space URL.

---

## 9. Test plan

### 9.1 Python unit tests (pytest)

| Suite | Asserts |
|---|---|
| `test_streaming_buffer.py` | `RollingBuffer` append + slice; eviction past `STREAM_WINDOW_SEC + 1 s`. |
| `test_stable_tracker.py` | Word locks after 2 consecutive identical transcripts; trailing tentative word never locks; reset clears state. |
| `test_arabic_norm.py` | `canonical()` strips tashkeel, normalises Alef variants, handles Hamza-Wasl. |
| `test_align_partial.py` | After 3 matching words, anchor is set; subsequent words map by position; score drop > 25 invalidates anchor. |
| `test_mistake_state_machine.py` | PENDING → CORRECTED on matching re-read; PENDING → ACKNOWLEDGED on position-advance or 2 s timeout; suppressed re-emission for same `(ayah, pos)`. |
| `test_tts_resolver.py` | Known surah/ayah/word returns valid EveryAyah URL + timing; unknown surah returns gTTS fallback URL. |
| `test_ws_handler_streaming.py` | Replay a fixture WAV (`tests/fixtures/al-baqarah-23.wav`); assert event order: `ready` → ≥ 1 `partial_mistake` → ≥ 1 `word_corrected`-or-`mistake_acknowledged` per partial → `ayah_finalized` → `final_report`. |

### 9.2 Node integration test

Extend [backend/scripts/test_audio_ws.js](../../backend/scripts/test_audio_ws.js):

- Connect to a local AI service (not HF Space) for fast CI feedback.
- Replay the same fixture WAV.
- Assert `Feedback` rows count matches `ayah_finalized.mistakes.length`.
- Assert no `Feedback` rows are written before `ayah_finalized` arrives.

### 9.3 Manual smoke test (sign-off gate)

10 recitations (mix of accurate + intentionally flawed) on a real device:

| Check | Pass criterion |
|---|---|
| Mispronounced word turns red within ~1 s | ≥ 9/10 |
| Correct word audible within ~1.3 s | ≥ 9/10 |
| Re-reading the corrected word turns it green | ≥ 8/10 |
| Skipping past a mistake fades to acknowledged within 2 s | 10/10 |
| Same `(ayah, word)` never re-fires red in one ayah pass | 10/10 |
| Final report grade matches the `Feedback` rows in DB | 10/10 |
| Tarteel mistake set agrees with Groq baseline | ≥ 80 % word-set overlap |

---

## 10. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| HF Space cold start drops first WS connection | High after idle | Node retries 3× w/ backoff; UptimeRobot keep-warm. |
| Tarteel-base less accurate than Groq large-v3 for some reciters | Medium | Provider abstraction preserved; flip `TRANSCRIPTION_PROVIDER=groq` to A/B. |
| 250 ms cadence saturates 2 vCPU | Medium | Adaptive cadence backs off to 500 ms after 5 slow runs; `ready` event announces effective rate. |
| Whisper hallucinates trailing words | Low | Lock-in rule (≥ 2 stable runs); `no_speech_threshold=0.6`, `log_prob_threshold=-1.0`. |
| TTS clip overlaps live recitation | By design | Acceptable per requirement; clips are ~300 ms, queue capped at 2. |
| User repeats word but ASR misses it (noise, fast speech) | Medium | 2 s timeout → `mistake_acknowledged`. User isn't blocked. |
| EveryAyah CDN slow/blocked on user's network | Low | `wordAudioPrefetch` at session start; gTTS fallback URL when EveryAyah lacks coverage. |
| Auth token leak (HF Space is public) | Low | Constant-time compare; rotate via HF Space secrets; never logged. |
| Multi-user concurrency on free Space | Low for solo dev | Single-user assumption documented; scale to CPU Upgrade (~$20/mo) or Fly.io when needed. |

---

## 11. Out-of-scope items (deferred)

- GPU-class latency (sub-500 ms feedback) — requires paid host.
- Multi-user concurrency tuning.
- Additional tajweed rules (Idgham, Ikhfa, Iqlab, Ra rules, Lam in Allah, Hamzat al-Wasl, Waqf).
- Self-hosted Coqui TTS or pre-recorded studio audio.
- DTW alignment, phonetic matching.
- Translating `partial_mistake` events into push notifications, in-app coaching screens, etc.
- Backend persistence of `partial_mistake` events (intentionally ephemeral).

---

## 12. Cross-references

- Original AI integration design: [`2026-05-03-ai-integration-design.md`](2026-05-03-ai-integration-design.md)
- Implementation plan for this spec: [`../plans/2026-05-12-streaming-tarteel.md`](../plans/2026-05-12-streaming-tarteel.md) (to be created)
- Root project guide: [`../../CLAUDE.md`](../../CLAUDE.md)
- Backend layered architecture: [`../../backend/CLAUDE.md`](../../backend/CLAUDE.md)
