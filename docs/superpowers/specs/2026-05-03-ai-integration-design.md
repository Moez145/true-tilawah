# True Tilawah — AI Integration Design

**Date:** 2026-05-03
**Status:** Draft awaiting user review
**Scope:** Wire the existing Python AI service (`AI Code/main.py`) into the existing Node.js backend so a React Native frontend can stream audio in realtime, get word-level Quranic recitation feedback per ayah while still reciting, and a consolidated final report on stop.

---

## 1. Goals & non-goals

### Must-have
- React Native frontend streams microphone audio over a single WebSocket to the Node.js backend.
- Audio is transcribed by Whisper (`large-v3`) via Groq, with a provider abstraction so future swaps (self-hosted Whisper, OpenAI, faster-whisper, etc.) require **only an env-var change**.
- Comparison is **strictly scoped** to the user's selected `surahId / ayahStart / ayahEnd`. Verses outside the range are never returned as "matched".
- Per-ayah feedback events (~1.0–1.5 s after the user pauses on each ayah) include a **word-level diff** plus tajweed errors. Only **HIGH-severity** tajweed violations are surfaced as mistakes; LOW/MEDIUM are filtered out by the pipeline as advisory-only.
- A consolidated `final_report` is sent when the user sends `STOP`; Session is then marked `COMPLETED` and `Progress` is recalculated.
- Feedback rows are persisted **per ayah event** (not buffered) so a mid-recitation disconnect preserves partial data.
- Word accuracy ≥ 87% on Quranic recitation; design targets 93–96%.
- Sub-1.5-second feedback latency per ayah on a typical mobile network.

### Non-goals
- Mid-ayah word interception (Whisper is batch ASR; would require streaming wav2vec2/Conformer-CTC and would lose accuracy on Arabic).
- TTS (text-to-speech for corrections) — handled later by the frontend.
- Multi-user rooms / shared sessions.
- Audio storage / replay infrastructure (left as a stretch goal in §11).
- Frontend (React Native) implementation — covered separately when frontend work begins.

### Success criteria
| Metric | Target |
|---|---|
| Word accuracy on Quranic recitation | ≥ 93% |
| Verse-detection accuracy within selected scope | ≥ 97% |
| End-to-end feedback latency per ayah | ≤ 1.5 s p95 |
| False-positive rate (correct word flagged wrong) | ≤ 4% |
| Session resilience (% of feedback rows preserved on disconnect) | 100% of ayahs that fired before disconnect |

---

## 2. Architecture overview

```
┌────────────────────────┐
│   React Native app     │
│ Mic → int16 PCM        │
│ 16 kHz mono            │
│ Library: react-native- │
│ live-audio-stream      │
└──────────┬─────────────┘
           │ WS  ws://api/ws/audio?token=…&sessionId=…
           │ Frame 1: text JSON (config sanity, optional)
           │ Frames 2..N: binary [4-byte seqNo][int16 PCM chunk]
           │ Final: text "STOP"
           ▼
┌─────────────────────────────────────────────────────────┐
│        Node.js Backend (Express + ws, port 5000)         │
│                                                          │
│ Existing (untouched):                                    │
│  • REST /api/auth, /api/sessions, /api/progress,         │
│    /api/quran                                            │
│  • Prisma → MySQL                                        │
│  • JWT auth middleware                                   │
│  • feedback.service.createFeedbackBatch                  │
│  • progress recalc raw-SQL in completeSession            │
│                                                          │
│ Modified:                                                │
│  • src/routes/audio.ws.js  (rewrite of stub)             │
│                                                          │
│ New:                                                     │
│  • src/services/ai.service.js  (Python WS client)        │
│  • src/services/tajweed.service.js  (rule lookup/seed)   │
│  • prisma/seed/tajweedRules.js  (seed Qalqala/Madd/      │
│    Ghunna into tajweed_rules)                            │
│  • New schema field: Feedback.disputed Boolean @default  │
│    false (for §9 false-positive flow)                    │
└──────────┬──────────────────────────────────────────────┘
           │ WS  ws://ai-service:8000/ws/evaluate
           │ Frame 1: text JSON config:
           │   {"surahId":1,"ayahStart":1,"ayahEnd":7,
           │    "userId":"<uuid>","sessionId":"<uuid>"}
           │ Frames 2..N: binary float32 PCM (16 kHz mono)
           │ Final: text "STOP"
           ▼
┌─────────────────────────────────────────────────────────┐
│      Python AI Service (FastAPI + uvicorn, port 8000)    │
│                                                          │
│ Refactored from current single-file main.py into:        │
│   app/                                                   │
│   ├── main.py                FastAPI app + routes        │
│   ├── config.py              env loader, constants       │
│   ├── lifespan.py            startup/shutdown            │
│   ├── vad.py                 Silero VAD logic            │
│   ├── quran_index.py         load + build inverted index │
│   ├── verse_detector.py      RapidFuzz, NOW SCOPED       │
│   ├── word_diff.py           LCS algorithm               │
│   ├── tajweed.py             Qalqala/Madd/Ghunna checks  │
│   ├── pipeline.py            run_evaluation_pipeline     │
│   └── transcription/                                     │
│       ├── base.py            TranscriptionProvider ABC   │
│       ├── groq.py            Groq whisper-large-v3       │
│       └── local_whisper.py   self-hosted fallback        │
└──────────┬──────────────────────────────────────────────┘
           │ HTTPS POST  api.groq.com/openai/v1/audio/transcriptions
           │ (only when transcribing; per-utterance, not streaming)
           ▼
   ┌──────────────┐
   │  Groq Cloud  │
   │ whisper-     │
   │ large-v3     │
   └──────────────┘
```

### Architectural invariants

1. **Node.js is the only public service.** Python listens on a private port, reachable only from Node.js (or the same Docker network). No public exposure.
2. **Python is stateless per connection.** Each WS holds its own audio buffer + config. No shared state across users.
3. **Groq API key lives only in Python's environment.** Node.js never sees it.
4. **Provider abstraction is the only place that knows about Groq.** Swapping providers = changing `TRANSCRIPTION_PROVIDER` env var; no other code touches.
5. **Feedback persistence happens in Node.js, not Python.** Python returns JSON; Node.js writes Prisma rows. This keeps Python a pure compute service that could be reused by other clients later.

---

## 3. Components in detail

### 3.1 React Native (frontend — out of scope here, defining contract only)

**Library:** `react-native-live-audio-stream` (or equivalent).

**Configuration:**
```js
{
  sampleRate: 16000,
  channels: 1,
  bitsPerSample: 16,
  audioSource: 6,        // VOICE_RECOGNITION on Android
  bufferSize: 4096,      // ~256 ms per chunk
}
```

**WS open URL:**
```
ws://your-server:5000/ws/audio?token=<accessToken>&sessionId=<sessionUuid>
```
(Token comes from prior REST `/api/auth/login` or `/api/auth/refresh`.)

**Wire format per chunk:**
```
[ 4-byte big-endian uint32 seqNo ][ int16 PCM bytes ]
```
The 4-byte seqNo is for drop-on-disorder protection. Frontend increments seqNo by 1 per chunk.

**Termination:** Send the text string `"STOP"` to finalize.

### 3.2 Node.js — `src/routes/audio.ws.js` (rewrite)

Replaces the current demo stub. Responsibilities:

1. **Authenticate** — same as today: verify JWT from `?token`, confirm `sessionId` exists, is `ACTIVE`, and belongs to `decoded.id`. Reject with WS close codes `4001` (auth) / `4003` (session) on failure.
2. **Open a child WS to Python** at `ws://${AI_SERVICE_HOST}:${AI_SERVICE_PORT}/ws/evaluate`.
3. **Send config frame** (text JSON) immediately on Python WS open:
   ```json
   {
     "surahId":   <Session.surahId>,
     "ayahStart": <Session.ayahStart>,
     "ayahEnd":   <Session.ayahEnd>,
     "userId":    "<req.user.id>",
     "sessionId": "<sessionId>"
   }
   ```
4. **Audio pump** — for every binary frame from RN:
   - Parse 4-byte seqNo header → drop if out-of-order (same logic as current stub).
   - Convert int16 PCM → float32 (`Int16Array` → divide by 32768 → `Float32Array`).
   - Forward float32 buffer (binary) to Python.
5. **Result handler** — on every JSON message from Python:
   - If `type === "verse_detected"`:
     - Map to `Feedback` rows (see §4.2 mapping table).
     - Call `createFeedbackBatch(sessionId, userId, mappedRows)` (existing service — no changes).
     - Forward the same JSON to RN unchanged.
   - If `type === "final_report"`:
     - Call new `completeSession(sessionId, userId, { transcript: report.transcript, accuracyScore: report.average_similarity * 100 })` (existing service, unchanged signature).
     - Forward JSON to RN.
     - Close both WS connections cleanly.
6. **STOP relay** — when RN sends text `"STOP"`, forward `"STOP"` to Python.
7. **Disconnect handling**:
   - If RN disconnects without `STOP` → forward `STOP` to Python (so it flushes a final report); when Python responds, mark `Session.status = ABANDONED`.
   - If Python disconnects unexpectedly → close RN with code `4500` and message; mark Session ABANDONED.

### 3.3 Node.js — `src/services/ai.service.js` (new)

Encapsulates the Python WS client so `audio.ws.js` stays thin.

Responsibilities:
- `connect({ surahId, ayahStart, ayahEnd, userId, sessionId })` → returns a wrapped WS with `sendAudio(float32Buffer)`, `sendStop()`, and `on('event', cb)` / `on('close', cb)`.
- Serializes/deserializes the JSON protocol.
- Reconnect logic: if Python WS drops *before* `final_report`, surface error to the caller — do **not** auto-reconnect (a fresh session is the right semantic).

### 3.4 Node.js — `src/services/tajweed.service.js` (new)

- `getRuleByName(name)` → memoized lookup of `tajweed_rules` row by `ruleName`.
- Used by the feedback mapper to translate Python's `"Qalqala" | "Madd" | "Ghunna"` strings into Prisma `tajweedRuleId` values.

### 3.5 Python — `app/transcription/` (new package)

```python
# app/transcription/base.py
class TranscriptionProvider(ABC):
    @abstractmethod
    async def transcribe(
        self,
        pcm_float32: np.ndarray,  # 16 kHz mono
        language: str = "ar",
    ) -> TranscriptionResult: ...

@dataclass
class TranscriptionResult:
    text: str
    confidence: float | None  # None if provider doesn't expose
    raw: dict                 # provider-native response for debugging

# app/transcription/groq.py
class GroqProvider(TranscriptionProvider):
    # Wraps audio in a WAV header, POSTs to Groq's
    # /openai/v1/audio/transcriptions with model="whisper-large-v3"

# app/transcription/local_whisper.py
class LocalWhisperProvider(TranscriptionProvider):
    # Existing whisper.load_model() + transcribe() logic
```

Selection in `app/config.py`:
```python
def get_provider() -> TranscriptionProvider:
    name = os.getenv("TRANSCRIPTION_PROVIDER", "groq")
    if name == "groq":          return GroqProvider(api_key=os.environ["GROQ_API_KEY"])
    if name == "local_whisper": return LocalWhisperProvider(
                                    model=os.getenv("WHISPER_MODEL", "medium"))
    raise ValueError(f"Unknown TRANSCRIPTION_PROVIDER: {name}")
```

### 3.6 Python — `app/verse_detector.py` (modified)

The existing `_detect_verse()` matches against the **full Quran**. New behavior:

```python
def detect_verse(text_slice: str, scope: VerseScope | None) -> VerseMatch | None:
    """
    scope = (surahId, ayahStart, ayahEnd) — when present, candidate set
    is restricted to verses in that range. None means full-Quran search
    (used by REST /evaluate for backward compat).
    """
```

When scope is given, the candidate set is built from a per-scope inverted index slice (~5–20 verses), not the full inverted index (~6,236 verses). This both improves accuracy *and* reduces detection latency (~10× faster).

### 3.7 Python — `/ws/evaluate` (modified)

Existing handler is preserved as a fallback path (no config = full-Quran scope, returns the legacy `verse_detected` shape). When the first message is a JSON config, the response shape switches to the new mistake-focused protocol:

```python
# Pseudocode
config = await ws.receive_json()  # First text frame
scope  = (config["surahId"], config["ayahStart"], config["ayahEnd"])
session_summary = SummaryAccumulator(scope)

while True:
    msg = await ws.receive()
    if msg.text == "STOP": break
    if msg.bytes:
        buffer.append(np.frombuffer(msg.bytes, dtype=np.float32))
        if len(buffer) >= 2 * SAMPLE_RATE:  # ~2s chunks
            for seg in run_vad(buffer):
                text  = await provider.transcribe(seg.audio)
                ayah  = ayah_aligner.align(text, scope)         # internal: which ayah?
                if ayah is None:
                    await ws.send_json({"type": "out_of_scope", "you_recited": text})
                    continue
                mistakes = build_mistakes(text, ayah)            # word_diff + tajweed
                session_summary.record(ayah, mistakes)
                if mistakes:
                    await ws.send_json({
                        "type": "mistake",
                        "ayah": ayah.number,
                        "mistakes": mistakes,
                    })
                else:
                    await ws.send_json({"type": "ok", "ayah": ayah.number})
            buffer = buffer[-int(0.5 * SAMPLE_RATE):]  # keep last 0.5s tail

# On STOP — single consolidated summary
await ws.send_json({"type": "final_report", **session_summary.finalize()})
```

**Note:** the verse-level fields (`similarity`, `verdict`, `you_recited`, `correct_verse`, `word_diff`) remain available for server-side logging/debugging but are **not sent to the frontend** in the new protocol.

---

## 4. Message protocol & data flow

### 4.1 RN ↔ Node.js WS messages

| Direction | Type | Format | Payload |
|---|---|---|---|
| RN → Node | binary | `[uint32 BE seqNo][int16 PCM]` | one ~256 ms audio chunk |
| RN → Node | text | string | `"STOP"` |
| Node → RN | text | JSON | `mistake` / `ok` / `final_report` / `unclear` / `out_of_scope` / `error` |

### 4.1.1 Event shapes (Node → RN)

```jsonc
// Per ayah, ONLY when at least one mistake is detected:
{
  "type": "mistake",
  "ayah": 2,
  "mistakes": [
    {
      "type": "MISPRONUNCIATION" | "OMITTED_WORD" | "ADDED_WORD" | "TAJWEED_VIOLATION",
      "incorrect": "<what user said, or '' if omitted>",
      "correct":   "<what they should have said, or '' if extra>",
      "tajweedRule": null | "Qalqala" | "Madd" | "Ghunna",
      "severity":    null | "low" | "medium" | "high",     // present only on TAJWEED_VIOLATION
      "tip":         null | "<human-readable correction>"  // present only on TAJWEED_VIOLATION
    }
    // ... 0..N entries
  ]
}

// Per ayah, when everything was recited correctly:
{ "type": "ok", "ayah": 2 }

// On STOP — one consolidated summary:
{
  "type": "final_report",
  "totalAyahs":         7,
  "ayahsWithMistakes":  1,
  "totalMistakes":      2,
  "averageAccuracy":    91.4,
  "grade": "Excellent" | "Good" | "Needs Practice" | "Needs Significant Practice"
}

// System events (covered in §7 Error matrix):
{ "type": "unclear",      "ayah": 2 }
{ "type": "out_of_scope", "you_recited": "..." }
{ "type": "error",        "code": "asr_failed" | "ai_unavailable", "message": "..." }
```

The frontend's job per `mistake` event is trivial: iterate `mistakes[]`, render the `incorrect → correct` pair, optionally show `tip`, and feed `correct` to TTS.

### 4.2 Mapping `mistake` event → `Feedback` rows

The mapping is now **1:1** — each item in the event's `mistakes[]` array becomes one `Feedback` row in the same order.

| Event field | Feedback column |
|---|---|
| `mistakes[i].type` | `errorType` |
| `mistakes[i].incorrect` | `incorrectWord` |
| `mistakes[i].correct` | `correctWord` |
| `mistakes[i].tajweedRule` (string) → `tajweedService.getRuleByName()` | `tajweedRuleId` (UUID, nullable) |
| `mistakes[i].tajweedRule` (string) | `ruleApplied` (denormalized for analytics) |
| event-level confidence (still computed internally, not sent to RN) | `confidenceScore` |
| event `ayah` | `ayahNumber` |
| `i` (array index) | `wordPosition` |

When the event is `ok`, no `Feedback` rows are written and Node.js does **not** call `createFeedbackBatch`. The frontend simply gets `{type:"ok", ayah:N}` for UX purposes.

All `Feedback` rows from a single `mistake` event are inserted via **one** call to `createFeedbackBatch` for atomicity + minimum DB chatter. The Python side already groups tajweed violations and word diffs into a single ordered `mistakes[]` array, so Node.js does not need to merge multiple sources.

### 4.3 End-to-end happy path (one session)

```
T+0.0s   RN: POST /api/sessions { surahId:1, ayahStart:1, ayahEnd:7 }
         Node: returns Session { id, status: ACTIVE }

T+0.5s   RN: WS connect to /ws/audio?token=…&sessionId=…
         Node: verify auth → open child WS to Python → send config JSON
         Node→RN: { type: "ready" }

T+1.0s   User starts reciting Al-Fatihah ayah 1
         RN→Node: binary chunks, ~16/sec
         Node→Python: float32 chunks (after seqNo strip + conversion)

T+5.0s   User pauses (1s silence)
T+5.5s   Python VAD detects utterance end
T+5.7s   Python POSTs audio to Groq
T+6.0s   Groq returns transcript "بسم الله الرحمن الرحيم"
T+6.05s  ayah_aligner: utterance corresponds to ayah 1 (score 0.97)
T+6.06s  word_diff: all correct, no tajweed errors
T+6.07s  Python emits { "type": "ok", "ayah": 1 }
T+6.10s  Node receives, writes 0 Feedback rows (skips DB call), relays to RN
         RN: shows ✅ for ayah 1

T+6.10s  User has already started ayah 2…
… repeat for ayahs 2-7 …

T+45s    User taps "Done" button in RN
         RN→Node: text "STOP"
         Node→Python: text "STOP"
         Python: aggregates all 7 verses, computes grade
         Python→Node: { type: "final_report", … }
         Node: marks Session COMPLETED, recalculates Progress
         Node→RN: relays final_report
         Both WS close cleanly.
```

---

## 5. Database changes

### 5.1 New schema field (Prisma migration `add_feedback_dispute_field`)

```prisma
model Feedback {
  // ... existing fields unchanged ...
  disputed   Boolean   @default(false)  // §9 false-positive flow
}
```

The existing `confidenceScore Float?` field is reused to hold the **event-level similarity** (0..1) for every row mapped from a single `verse_detected` event. We do not add a separate similarity field — the same number is stored on every row from one ayah, which is fine because the `confidenceScore` semantics (0 = no confidence, 1 = perfect) already match.

### 5.2 Seed data

`prisma/seed/tajweedRules.js` — idempotent upsert on `ruleName`:

```js
const rules = [
  { ruleName: "Qalqala", ruleCode: "QAL", description: "Echo/bounce sound on ق ط ب ج د when sukoon", severity: "MEDIUM" },
  { ruleName: "Madd",    ruleCode: "MAD", description: "Elongation of vowels (2-6 counts)",          severity: "HIGH"   },
  { ruleName: "Ghunna",  ruleCode: "GHN", description: "Nasalization on Noon/Meem with shadda",      severity: "MEDIUM" },
];
```

Run once at deploy time: `node prisma/seed/tajweedRules.js`.

### 5.3 Reference Quran data

Out of scope for AI integration. Python uses its own HuggingFace-loaded copy. Node.js's `quranic_texts` / `ayahs` tables remain reference data for the REST `/api/quran` endpoints (frontend metadata) and are seeded separately.

---

## 6. Configuration (env vars)

### Node.js `.env` (additions)
```env
AI_SERVICE_HOST=localhost      # or "ai-service" inside docker-compose
AI_SERVICE_PORT=8000
AI_SERVICE_WS_PATH=/ws/evaluate
AI_SERVICE_TIMEOUT_MS=10000    # initial connect timeout
```

### Python `.env` (new file)
```env
TRANSCRIPTION_PROVIDER=groq          # or "local_whisper"
GROQ_API_KEY=<your-key>              # required when provider=groq
GROQ_MODEL=whisper-large-v3          # only used when provider=groq
WHISPER_MODEL=medium                 # only used when provider=local_whisper
VAD_SILENCE_THRESHOLD_SEC=1.0
VAD_MIN_SPEECH_SEC=0.5
PORT=8000
```

---

## 7. Error handling matrix

| Failure mode | Detection | Response |
|---|---|---|
| **Python service unreachable** | Initial child WS open fails / times out | Close RN WS with code 4503, message "AI service unavailable, please retry" |
| **Groq API error / timeout** | Provider raises | Python emits `{type:"error", code:"asr_failed", utterance:N}`; Node relays; RN shows non-blocking toast; recitation continues |
| **Whisper returns gibberish (low confidence)** | similarity < 0.25 | Python emits `{type:"unclear", ayah:N}`; Node does NOT write Feedback rows; RN shows "Couldn't hear clearly, please repeat ayah N" |
| **User recites wrong surah** (outside scope) | scoped detector returns no match for an utterance | Python emits `{type:"out_of_scope", you_recited: "…"}`; Node does NOT write Feedback; RN shows "That doesn't match Surah X, ayah Y-Z" |
| **WS disconnect, RN side** | `ws.on('close')` in Node | Forward STOP to Python → wait for final_report → mark Session ABANDONED, persist whatever final aggregate Python returns |
| **WS disconnect, Python side** | `ws.on('close')` of child in Node | Mark Session ABANDONED. Close RN WS with code 4503. |
| **Out-of-order audio chunks** | seqNo < expected | Drop chunk silently (existing stub logic preserved) |
| **Audio buffer overflow on slow network** | RN-side concern | RN drops oldest chunks (frontend implementation note, not backend) |
| **User selects ayah range that doesn't exist** | Already validated by `createSessionValidator` + `session.service.createSession` | 400 returned at session creation time, never reaches WS |

---

## 8. Performance & accuracy budget

### Latency per ayah (steady state, default config)

| Stage | Time |
|---|---|
| VAD silence threshold | 1.0 s |
| Python → Groq HTTP roundtrip | 200–400 ms |
| Verse detection (scoped, ≤20 candidates) | < 30 ms |
| Word diff + tajweed | < 10 ms |
| JSON emit → Node → RN | < 100 ms |
| **Total p50** | **~1.3 s** |
| **Total p95** | **~1.6 s** |

### Throughput

- One Python process handles ~10 concurrent recitations on a small VPS (each session is mostly idle waiting for Groq). To scale further, run multiple Python replicas behind a simple round-robin (Node.js picks one on session start, sticks for the session lifetime).

### Accuracy levers (in priority order)

1. **Whisper model** — `large-v3` via Groq (locked).
2. **Strict scope** — restricting candidate verses to user's selection eliminates ~99% of false-match opportunities (locked).
3. **Two-pass on borderline** — re-transcribe at `temperature=0.2` if first pass returns 0.5 ≤ similarity < 0.75 (§9 layer 5).
4. **Initial-prompt seeding** — Whisper is given the expected first ayah as `initial_prompt` for ASR conditioning. Already in current code; we extend it to seed the *first ayah of the user's selected range* instead of always "بسم الله الرحمن الرحيم".
5. **Confidence threshold** — only flag a word wrong when similarity drops below 0.75 *and* LCS specifically flags it. Default threshold tunable via env.

---

## 9. False-positive defense (the most important UX layer)

Five layers, all part of the design:

1. **Threshold-gated flagging** — see §8 lever 5.
2. **`Feedback.similarity` per row** — frontend de-emphasizes low-confidence corrections visually (greyed out + "AI uncertain" label).
3. **Audio playback per ayah** *(stretch goal §11)* — keep last-30-second PCM in RN local cache; show 🔊 button next to each flagged word.
4. **User dispute action** — RN sends `PATCH /api/sessions/:id/feedback/:fbId/dispute`; sets `Feedback.disputed = true`. Disputed rows excluded from `Progress.totalMistakes` (modify the raw-SQL aggregate in `completeSession` to add `AND disputed = false`).
5. **Two-pass borderline transcription** — see §8 lever 3. Triggered only on uncertain utterances; adds ~300 ms only when needed.

---

## 10. Testing without a frontend

Three layers, in increasing fidelity:

### 10.1 Python service in isolation

**Unit tests** (`pytest`):
- `_norm()` — Arabic text normalization edge cases.
- `_word_diff()` — LCS correctness on known correct/missing/extra inputs.
- `_check_tajweed()` — Qalqala/Madd/Ghunna detection on hand-crafted strings.
- `verse_detector.detect_verse()` with `scope=(1,1,7)` — confirms restriction works.
- Fake `TranscriptionProvider` for deterministic tests (returns canned strings).

**Manual HTTP test**:
```bash
# /evaluate works with a recorded audio file, no WS needed
curl -F "file=@test_audio/al-fatihah-correct.m4a" \
     http://localhost:8000/evaluate | jq
```

### 10.2 Node.js ↔ Python integration (no RN)

**Test script** at `backend/scripts/test_audio_ws.js`:

```js
// 1. POST /api/auth/register (or login) → get accessToken
// 2. POST /api/sessions { surahId:1, ayahStart:1, ayahEnd:7 } → get sessionId
// 3. Open WS:  ws://localhost:5000/ws/audio?token=…&sessionId=…
// 4. Read a pre-recorded WAV (16 kHz mono int16) from disk
// 5. Stream it in 4096-byte chunks with seqNo headers, ~62 ms apart
//    (simulates real-time pacing)
// 6. Print every JSON message received from server
// 7. After EOF, send "STOP", wait for final_report, exit
```

Required fixture: `backend/scripts/fixtures/al-fatihah.wav` — a real recitation, 16 kHz mono int16. Source from a free Quran audio site or record yourself; commit the WAV (small file, <2 MB).

Run via:
```bash
node scripts/test_audio_ws.js fixtures/al-fatihah.wav
```

Expected output: 7 `verse_detected` events, then `final_report` with `grade: "Excellent"`.

### 10.3 Stress / soak test

- Run the test script in 5 parallel processes against the same Python service. Confirm no cross-talk between sessions, no memory leaks, latency p95 stays under 2 s.

### 10.4 Convenience: a Postman / Insomnia collection

For REST testing only (auth, session create, progress fetch, dispute). Saves time iterating without code.

---

## 11. Out of scope / future work

- **Audio storage** — record full PCM to S3/MinIO per session for offline review and tajweed coach. Adds GDPR/PII considerations.
- **TTS playback of corrections** — frontend will integrate later.
- **Streaming ASR** — replace VAD+Whisper with wav2vec2/Conformer-CTC for true mid-ayah feedback; lower accuracy on Arabic, deferred.
- **More tajweed rules** — current 3 (Qalqala, Madd, Ghunna). Roadmap: Idgham, Ikhfa, Iqlab, Hams.
- **Multi-tenancy / orgs** — single-user only today.

---

## 12. Implementation order (high level — exact plan to be produced by writing-plans)

1. **Python refactor** — split `main.py` into the package layout in §3.5; keep behavior identical. Add tests.
2. **Provider abstraction** — implement `TranscriptionProvider`, `GroqProvider`, `LocalWhisperProvider`. Switch `_transcribe` callsite to use provider.
3. **Scoped verse detection** — add `scope` param to `verse_detector`; thread through `pipeline.run_evaluation_pipeline`.
4. **WS config frame** — read first JSON message in `/ws/evaluate` to set scope.
5. **Prisma migration + seed** — add `Feedback.disputed`, `Feedback.similarity`; seed tajweed rules.
6. **Node.js `ai.service.js`** — child WS client.
7. **Node.js `audio.ws.js` rewrite** — real audio pump replacing the stub demo.
8. **Tajweed lookup service + feedback mapper.**
9. **Test fixture WAV + `scripts/test_audio_ws.js`.**
10. **Manual end-to-end** with the test script.
11. **Dispute REST endpoint** (`PATCH /api/sessions/:id/feedback/:fbId/dispute`) + `Progress` aggregate adjustment.
12. **Docker compose** for Node + Python + MySQL on the same network.

Detailed plan with file paths, line numbers, and step-by-step actions will be produced next via the writing-plans skill.
