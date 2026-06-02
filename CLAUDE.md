# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**True Tilawah** is a Quranic recitation tutor.

**The user flow:**
1. User selects an ayah range (e.g., *Al-Baqarah 23–28*) in the React Native app.
2. User recites those verses out loud.
3. While they're still reciting, within ~1 second of finishing each ayah, any **mispronounced word** is detected and the **correct word is sent back as text** so the frontend can speak it via TTS as voice feedback.
4. **HIGH-severity tajweed violations** (e.g., a missed `Madd` elongation) are also flagged as mistakes with the corrected pronunciation. LOW/MEDIUM tajweed observations are intentionally **not** surfaced — they are advisory only and would clutter the feedback stream.
5. Recitation never stops. The user finishes ayah 2; while they begin ayah 3, the corrected word from ayah 2 plays in their ear.

**What "mistake" means in the response:**

| `mistakes[].type` | When it fires | What `correct` contains (what TTS plays) |
|---|---|---|
| `MISPRONUNCIATION` | A word was said incorrectly enough that LCS couldn't match it | The expected Quranic word |
| `OMITTED_WORD` | The user skipped a word | The word they should have said |
| `ADDED_WORD` | The user added a word that isn't in the verse | empty (frontend may play "extra word" sound or skip TTS) |
| `TAJWEED_VIOLATION` | HIGH-severity rule broken (`Madd` is the only HIGH rule today) | The correctly-pronounced Quranic form for re-reading |

**Output is realtime per ayah.** No batch results, no waiting until the user stops. Each ayah's mistakes arrive while the user is reciting the next one.

The repo is a **monorepo with three independent services** that communicate over WebSockets:

```
React Native app (Expo)            ──RN: int16 PCM 16kHz──→  Node.js backend
(frontend/)                                                  (backend/)
                                                                │
                                                                │ float32 PCM
                                                                │ + scope JSON
                                                                ▼
                                   Tarteel whisper-base- ◄─── Python AI service
                                   ar-quran via                 (ai-service/)
                                   faster-whisper (local,        │
                                   streaming; rolling             │ 250 ms cadence
                                   4 s window every               │ + ≥2-run lock-in
                                   250 ms)                        │ per word
```

Tarteel is the **only** transcription engine. Audio never leaves the host machine — everything runs locally via `faster-whisper` + the CT2-quantised `tarteel-ai/whisper-base-ar-quran` model. The `TranscriptionProvider` ABC still exists so a future engine swap is a one-file change.

## Top-level layout

```
TrueTilawah/
├── frontend/                   React Native (Expo) — see frontend/README.md
├── backend/                    Node.js + Express + Prisma + MySQL — see backend/CLAUDE.md
├── ai-service/                 FastAPI + Silero VAD + faster-whisper (Tarteel) — see §"AI service" below
├── docs/superpowers/
│   ├── specs/                  Approved design docs (one per major feature)
│   └── plans/                  Step-by-step implementation plans (TDD-style)
├── docker-compose.yml          Orchestrates mysql + ai-service + backend on one network
└── .env.example                Root env template (Docker Compose reads this)
```

For backend-specific architecture details (request flow, services layering, Prisma gotchas), read [backend/CLAUDE.md](backend/CLAUDE.md). For a deep-dive on the recitation pipeline, read:

- [docs/superpowers/specs/2026-05-03-ai-integration-design.md](docs/superpowers/specs/2026-05-03-ai-integration-design.md) — the **original** Groq-only, VAD-segment-based pipeline.
- [docs/superpowers/specs/2026-05-12-streaming-tarteel-design.md](docs/superpowers/specs/2026-05-12-streaming-tarteel-design.md) — the **streaming Tarteel** addition (supersedes §3 + §4 of the original): mid-recitation per-word feedback, MistakeStateMachine for repeat/skip, HF Space deployment. Implementation plan at [docs/superpowers/plans/2026-05-12-streaming-tarteel.md](docs/superpowers/plans/2026-05-12-streaming-tarteel.md).

## How the realtime feedback pipeline works

1. **Frontend** (`react-native-live-audio-stream` or similar) opens `ws://backend/ws/audio?token=…&sessionId=…` and streams microphone audio as binary frames `[4-byte BE seqNo][int16 PCM]`. Sample rate 16 kHz mono. Sends text `"STOP"` to finalize.
2. **Node.js backend** ([backend/src/routes/audio.ws.js](backend/src/routes/audio.ws.js)) authenticates the JWT, verifies the session belongs to the user and is `ACTIVE`, then opens a child WebSocket to the Python AI service. It strips the seqNo, drops out-of-order chunks, converts int16→float32, and forwards.
3. **Python AI service** ([ai-service/app/ws_handler.py](ai-service/app/ws_handler.py)) runs the streaming inner loop: every 250 ms, the last 4 s of audio is transcribed locally via `faster-whisper` running `tarteel-ai/whisper-base-ar-quran` (CT2 int8). A `StableTracker` locks a word once it appears at the same position in ≥2 consecutive ASR runs; each locked word is diffed against the expected ayah and tajweed-checked **immediately** without waiting for the user to pause.
4. The locked word is aligned to one of the user's selected ayahs via the `ScopedAligner` (RapidFuzz, scoped to the `surahId/ayahStart/ayahEnd` sent in the first WS frame). Python emits JSON events back to Node:
   - Per-word `partial_mistake` events the moment a mismatch is locked.
   - `word_corrected` if the user re-reads the missed/wrong word correctly within the grace window.
   - `mistake_acknowledged` if they move on past a flagged word, or after 2 s of silence with no re-read.
   - On ayah-end silence (≥0.7 s), the consolidated `ayah_finalized` event fires with the full mistake list. The Node backend renames `ayah_finalized → mistake` on the wire to RN.
   - Node persists each `ayah_finalized` batch as `Feedback` rows via `createFeedbackBatch`. The streaming-only events (`partial_mistake`, `word_corrected`, `mistake_acknowledged`) are relayed verbatim to RN and **NOT** persisted — they are ephemeral UI signals.
5. On `STOP`, Python sends `{"type":"final_report", grade, averageAccuracy, …}`. Node marks the `Session` `COMPLETED` and recalculates `Progress` aggregates (excluding rows with `Feedback.disputed = true`).

Wire vocabulary: `ready | partial_mistake | word_corrected | mistake_acknowledged | ayah_finalized | mistake | unclear | out_of_scope | final_report | error`. The legacy `mistake` name is what RN receives after Node renames `ayah_finalized` for backwards compat. See [spec §4](docs/superpowers/specs/2026-05-12-streaming-tarteel-design.md) for full payload shapes.

### Example: real mistake flow (Al-Baqarah 23 with one mispronunciation)

User recites "وَإِن كُنتُمْ فِي رَيْبٍ مِّمَّا نَزَّلْنَا عَلَىٰ عَبْدِنَا..." but says `عبدنا` without the proper `Madd` elongation, and omits `رَيْبٍ`. The server emits this WS event ~1.0 s after the user pauses at the end of ayah 23:

```json
{
  "type": "mistake",
  "ayah": 23,
  "mistakes": [
    {
      "type": "OMITTED_WORD",
      "incorrect": "",
      "correct": "رَيْبٍ",
      "tajweedRule": null,
      "severity": null,
      "tip": null
    },
    {
      "type": "TAJWEED_VIOLATION",
      "incorrect": "عبدنا",
      "correct": "عَبْدِنَا",
      "tajweedRule": "Madd",
      "severity": "high",
      "tip": "Elongate the long vowel (2 to 6 counts)."
    }
  ]
}
```

The frontend calls TTS twice: once with `"رَيْبٍ"` (the omitted word), once with `"عَبْدِنَا"` (correct pronunciation of the tajweed-violated word). The user hears these in their ear while already reciting ayah 24 — non-blocking, non-interrupting.

If ayah 23 is fully correct, the server emits no `partial_mistake` events at all; the final `ayah_finalized` arrives with `mistakes: []` and no TTS is needed.

**How the streaming events fire on this example.** While the user is still saying "عبدنا فأتوا بسورة...", the server emits two `partial_mistake` events at word indices 3 (`OMITTED_WORD: رَيْبٍ`) and 4 (`TAJWEED_VIOLATION: عَبْدِنَا`). The frontend paints those words red instantly and queues TTS clips. When the user pauses at the end of ayah 23, the server emits a final `ayah_finalized` (relayed to RN as `mistake`) with the consolidated mistake list — that's the event Node persists as `Feedback` rows. Same DB shape, mid-recitation visual feedback.

## Running everything locally

### One-shot via Docker Compose (recommended)
```bash
cp .env.example .env       # then fill in JWT_SECRET, JWT_REFRESH_SECRET, MYSQL_ROOT_PASSWORD
docker compose up --build
docker compose exec backend npx prisma migrate deploy
docker compose exec backend npm run seed:tajweed   # one-time: seed Qalqala/Madd/Ghunna
docker compose exec backend npm run seed:quran     # one-time: seed all 114 surahs + 6236 ayahs from Quran.com (~5-8 min)
```
Backend on `http://localhost:5000`, AI service internal-only (`expose: 8000`), MySQL on `:3306`.

### Manual (three terminals — better for active dev)
```bash
# Terminal 1 — AI service
cd ai-service
py -3.11 -m pip install -r requirements.txt    # one-time, ~5 min (torch is ~700 MB)
py -3.11 -m uvicorn app.main:app --host 0.0.0.0 --port 8000

# Terminal 2 — Node backend
cd backend
npm install                                     # one-time
npm run db:migrate                              # one-time, applies pending migrations
npm run seed:tajweed                            # one-time: 3 tajweed rules
npm run seed:quran                              # one-time: 114 surahs + 6236 ayahs (~5-8 min)
npm run dev

# Terminal 3 — React Native (Expo) frontend
cd frontend
npm install                                     # one-time
npm start                                       # opens Expo dev menu; press 'a' for Android, 'i' for iOS
```

**Python is sticky to 3.11.** Newer Pythons (3.13/3.14) lack torch wheels. Use `py -3.11 -m ...` on Windows; `python3.11 -m ...` on macOS/Linux.

## Service responsibilities (don't mix these up)

| Service | Owns | Never does |
|---|---|---|
| **frontend (RN)** | Mic capture, UI state, TTS playback of `correct` words, JWT storage, REST calls to `/api/auth`/`/api/sessions`/`/api/progress`, opening the audio WS | Talk to ai-service directly. Decode Quran text. |
| **backend (Node)** | Auth, DB, session lifecycle, Progress aggregation, persisting `Feedback` rows, the *only* server RN connects to. Acts as proxy/auth-gate to ai-service. | Run AI models. Decode audio formats. |
| **ai-service (Python)** | VAD, transcription via `TranscriptionProvider`, scoped verse alignment, word-diff, tajweed checks. Stateless per WS connection. | Talk to MySQL. Authenticate users. Hold per-user state. Be reachable from the public internet. |

## AI service

Located in `ai-service/`. FastAPI app split into a clean package layout:

```
ai-service/app/
├── main.py                 thin FastAPI entry, /health + /ws/evaluate
├── config.py               env loader (auto-loads ai-service/.env via python-dotenv)
├── lifespan.py             startup loaders → STATE dict (vad, quran, provider, tts)
├── quran_index.py          loads Quran from HuggingFace nazimali/quran (CDN fallback) + builds inverted index
├── vad.py                  Silero VAD: run_vad() for batch mode + is_recent_silence() for ayah-end detection
├── ayah_aligner.py         ScopedAligner — RapidFuzz match restricted to scope; align_partial() + AyahAnchor for streaming
├── word_diff.py            LCS word_diff() + diff_locked_word() per-word helper for streaming
├── tajweed.py              Qalqala / Madd / Ghunna detectors + check_tajweed_violations() per-word shim (HIGH-severity only)
├── pipeline.py             build_mistakes() (batch) + build_partial_mistake() (per-word) + MistakeStateMachine + SummaryAccumulator
├── arabic_norm.py          pyarabic-backed canonical() / strip_diacritics() — tashkeel / Alef / Ya / Ta Marbuta normalisation
├── streaming_buffer.py     RollingBuffer (capped 4 s + 1 s tail) + StableTracker (≥2-run lock-in)
├── tts_resolver.py         (surah, ayah, word_idx) → EveryAyah CDN audio URL + gTTS fallback URL
├── auth.py                 constant-time bearer-token gate for the HF Space public URL
├── ws_handler.py           /ws/evaluate — streaming inner loop; drives all of the above; emits the wire events
└── transcription/
    ├── base.py             TranscriptionProvider ABC
    └── tarteel.py          default + only provider — faster-whisper + tarteel-ai/whisper-base-ar-quran (CT2 int8)

ai-service/scripts/
├── convert_tarteel_model.py    one-time HF → CTranslate2 int8 conversion (idempotent; ~80 MB output)
└── build_word_timing_index.py  builds ./data/word_timings.json (6236 ayah-level EveryAyah URLs)

ai-service/data/                generated; gitignored. word_timings.json lives here.
ai-service/models/              generated; gitignored. tarteel-ct2/ model files live here.
```

**One-time setup** (Tarteel is the only provider; you must run these once per machine):

```bash
cd ai-service
py -3.11 -m pip install -r requirements.txt -r requirements-local-whisper.txt
py -3.11 -m scripts.convert_tarteel_model    # one-time, ~2 min, ~150 MB HF download
py -3.11 -m scripts.build_word_timing_index  # one-time, instant, builds 6236 entries
```

After that, `faster-whisper` loads the CT2 model from `./models/tarteel-ct2/` on every startup (~2 s warm-up). The Dockerfile bakes both steps into the image so Docker Compose / HF Space users don't need a separate setup. The `TranscriptionProvider` ABC remains so a future engine swap is a one-file change.

**Streaming pipeline tunables** (all env-driven, defaults are spec-mandated):

| Env var | Default | What it controls |
|---|---|---|
| `STREAM_CHUNK_SEC` | `0.25` | ASR cadence — new transcription every N seconds. |
| `STREAM_WINDOW_SEC` | `4.0` | How much trailing audio each ASR call sees. |
| `STREAM_LOCK_IN_RUNS` | `2` | Runs a word must appear in before it locks. ≥2 only. |
| `VAD_SILENCE_THRESHOLD_SEC` | `0.7` | Silence required to declare an ayah finished (lowered from 1.0). |
| `PENDING_CORRECTION_TIMEOUT_SEC` | `2.0` | Pending mistake → `mistake_acknowledged` if user doesn't re-read in N seconds. |

**Why scoped detection matters:** without it, RapidFuzz matches against all 6,236 verses and can misroute a recitation to a similarly-worded ayah elsewhere in the Quran. The first WS frame `{"surahId":..,"ayahStart":..,"ayahEnd":..}` restricts the candidate set to the user's selection only — typically 1–20 verses. This both improves accuracy and ~10× speeds up matching.

**Key files to touch when extending tajweed rules:** add a detector function in `app/tajweed.py` (and, for the streaming pipeline, wire it into `check_tajweed_violations()` if it's HIGH-severity) and seed a corresponding row in `backend/prisma/seed/tajweedRules.js`. The rule name in Python must exactly match `tajweed_rules.ruleName` in MySQL — that's how Node maps the rule to a `Feedback.tajweedRuleId` UUID.

**Hugging Face Space deployment:** the `Dockerfile` is HF-Space-compatible (port 7860; runs both setup scripts at build time). Push `ai-service/` to a Docker-SDK Space, set the `AI_SERVICE_AUTH_TOKEN` secret, and Node connects via `AI_SERVICE_WSS_URL` + `Authorization: Bearer ${AI_SERVICE_AUTH_TOKEN}`. See spec §8 for the step-by-step.

## Backend (Node.js)

See [backend/CLAUDE.md](backend/CLAUDE.md) for full layered architecture. Notable touchpoints for AI integration:

- [backend/src/routes/audio.ws.js](backend/src/routes/audio.ws.js) — the audio WS handler. Auth → child WS to Python → relay → persist. Dispatches both the legacy `mistake` event (persists) and the new streaming events: `partial_mistake` / `word_corrected` / `mistake_acknowledged` (relay only), plus `ayah_finalized` which is **persisted** AND **renamed → `mistake`** on the wire to RN for backwards compat.
- [backend/src/services/ai.service.js](backend/src/services/ai.service.js) — promise-returning `connect({...})` that wraps the Python WS with `sendAudio` / `sendStop` / `onEvent` / `close`. Connection URL precedence: `AI_SERVICE_WSS_URL` (full `wss://` for HF Space) → fallback to `ws://${AI_SERVICE_HOST}:${AI_SERVICE_PORT}/ws/evaluate` (local Docker). Sends `Authorization: Bearer ${AI_SERVICE_AUTH_TOKEN}` when set.
- [backend/src/services/tajweed.service.js](backend/src/services/tajweed.service.js) — memoized `getRuleByName()` lookup, used by the audio WS handler when mapping Python events to `Feedback` rows.
- [backend/src/services/feedback.service.js](backend/src/services/feedback.service.js) — `disputeFeedback()` flips `Feedback.disputed = true`. The dispute is excluded from `Progress.totalMistakes` aggregation in `completeSession`.
- [backend/scripts/test_audio_ws.js](backend/scripts/test_audio_ws.js) — replay a 16 kHz mono WAV through the full pipeline as if it were a live mic. Use this instead of the frontend during backend dev.

## Frontend (React Native via Expo)

`frontend/` is an Expo SDK 54 project (RN 0.81). The recitation audio flow is **already wired end-to-end** — `react-native-live-audio-stream` captures mic, `audioStreamService.js` streams to the backend WS, `expo-speech` plays back the corrected words via TTS.

### Folder layout (`frontend/src/`)

```
src/
├── components/
│   ├── common/        Button, Card, Header, Input, SidebarItem
│   ├── dashboard/     DashboardCard, SearchBar
│   ├── layout/        Sidebar, SearchActionModal
│   └── quran/         AyahItem
├── constants/         API_BASE_URL + WS_AUDIO_URL (platform-aware), colors, storage keys
├── context/           AuthContext (user, isAuthenticated, login/register/logout)
│                      AppContext (surahs, bookmarks, currentSession)
├── navigation/        AppNavigator.js — stack → drawer → bottom tabs
├── screens/           Auth, Dashboard, Detail, Onboarding, QuranList, Recite,
│                      Retain, RetainResults, Splash, Track + secondary/
│                      (Bookmarks, Help, Profile, Settings)
├── services/          apiClient, authService, quranService, sessionService,
│                      progressService, feedbackService, audioStreamService
└── utils/             storage helpers, formatters
```

### Navigation tree
```
Stack (root)
├── Onboarding → Auth                   (unauthenticated path)
└── Main (drawer)                       (authenticated)
    ├── Dashboard
    ├── MainTabs (bottom)
    │   ├── QuranList   (Read)
    │   ├── Retain
    │   ├── Recite      ← uses audioStreamService + expo-speech TTS
    │   ├── Track
    │   └── Bookmarks   (Save)
    ├── Profile · Settings · Help
    └── Detail · RetainResults          (pushed stack screens)
```

### Frontend services (`src/services/`)

| File | Talks to | Purpose |
|---|---|---|
| `apiClient.js` | backend `/api` | Axios instance with JWT auth + auto-refresh on 401 |
| `authService.js` | `/api/auth` | login/register/refresh + Google + Apple Sign-In |
| `quranService.js` | `/api/quran` | surah & ayah lookups |
| `sessionService.js` | `/api/sessions` | start / get / complete / abandon a recitation |
| `progressService.js` | `/api/progress` | trends, error summaries, tajweed breakdown |
| `feedbackService.js` | `/api/sessions/.../feedback` | log + dispute feedback |
| `audioStreamService.js` | `/ws/audio` (binary) | **the realtime pipe** — opens WS, captures mic via `react-native-live-audio-stream`, sends `[seqNo][int16 PCM]` frames, dispatches `onResult` / `onConnection` / `onFinalReport` callbacks. Has a built-in demo fallback (random mistakes) when the backend is unreachable. |
| `wordStateStore.js` | (in-memory, Zustand) | `{[ayahNum]: {[wordIdx]: 'pending'\|'mistake'\|'corrected'\|'acknowledged'}}` store + `setState(ayah, idx, state)` / `reset()`. Subscribed to by each `<WordToken>` in `ReciteScreen` via a granular Zustand selector so only the changed word re-renders. |

### Word-by-word recitation render (`screens/ReciteScreen.js`)

Each ayah in the carousel is rendered as a row of memoized `<WordToken>` components instead of a single `<Text>`. Each token reads its colour from `wordStateStore` keyed by `(ayahNumber, wordIndex)`. On the WS `partial_mistake` event the token turns **red** (`COLORS.wordMistake`) within a frame; `word_corrected` turns it **green**; `mistake_acknowledged` fades to **faded-red**. TTS for the corrected word fires immediately via `expo-speech` (`speakWord`) on `partial_mistake` — no waiting for ayah-end. Colour tokens live in [`src/constants/colors.js`](frontend/src/constants/colors.js) (`WORD_PENDING` / `WORD_MISTAKE` / `WORD_CORRECTED` / `WORD_ACKNOWLEDGED`).

### API base URL config

`src/constants/index.js` picks platform-aware URLs:

| Platform | REST | WS |
|---|---|---|
| Android emulator | `http://10.0.2.2:5000/api` | `ws://10.0.2.2:5000/ws/audio` |
| iOS / web        | `http://localhost:5000/api` | `ws://localhost:5000/ws/audio` |

Overridable via `EXPO_PUBLIC_API_BASE_URL` and `EXPO_PUBLIC_WS_AUDIO_URL` env vars.

### Run
```bash
cd frontend && npm install && npm start
```
Press `a` for Android, `i` for iOS, `w` for web in the Expo dev menu.

## Specs and plans (the source of truth)

When adding non-trivial features, follow this flow:
1. **Spec** lives in `docs/superpowers/specs/YYYY-MM-DD-<feature>-design.md` — design intent, message protocols, error matrix, success criteria. The current AI integration spec covers the entire ASR pipeline including alternative providers, false-positive handling, and testing without a frontend.
2. **Plan** lives in `docs/superpowers/plans/YYYY-MM-DD-<feature>.md` — bite-sized tasks with file paths, exact code, and verification steps. Plans are TDD-flavored and meant to be executable by parallel subagents.

Don't write a plan without an approved spec. Don't start coding without a plan for anything bigger than a one-file change.

## Conventions across all three services

- **Wire format is canonical** — anything that crosses a service boundary follows the JSON shapes in spec §4.1.1. Don't invent new event types ad hoc; extend the spec first.
- **Auth is Node.js's job, period.** Python and the frontend trust Node. Python doesn't even know what JWT is.
- **Realtime is word-grained** — `partial_mistake` events emit within ~0.7–1.0 s of a locked word, no user pause required. Don't chase "true mid-word" interception via streaming wav2vec2; it tanks accuracy on Arabic. Tarteel-base + 250 ms cadence + ≥2-run lock-in is the practical sweet spot.
- **Stateless Python** — every WS connection holds its own audio buffer + scope. Do not put per-user state in module globals on the Python side.
- **Persistence is per ayah, not per session** — every `verse_detected` / `mistake` event is persisted immediately. Disconnects keep partial feedback. Don't buffer Feedback rows in memory hoping to write them at STOP.
- **Disputed feedback is excluded from Progress** — when filtering aggregates in raw SQL, always include `AND f.disputed = false`.

## Environment variables (overview)

| Variable | Service | Required | Notes |
|---|---|---|---|
| `DATABASE_URL` | backend | ✅ | MySQL connection string. |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | backend | ✅ | Long random; backend startup throws if missing. |
| `AI_SERVICE_HOST`, `AI_SERVICE_PORT` | backend | ❌ (defaults `localhost:8000`) | Where to find the Python service in local mode. |
| `AI_SERVICE_WSS_URL` | backend | ❌ | Full `wss://` URL. When set, overrides `HOST`/`PORT`. Use for HF Space deployment. |
| `AI_SERVICE_AUTH_TOKEN` | backend + ai-service | ✅ when deploying ai-service publicly | Shared bearer token. Backend sends `Authorization: Bearer …`; ai-service `app/auth.py` constant-time-compares. Leave blank for local-only dev. |
| `TRANSCRIPTION_PROVIDER` | ai-service | ❌ (defaults `tarteel`) | `tarteel` is the only supported provider. Setting `groq` raises a clear error pointing you back to `tarteel`. |
| `WHISPER_MODEL_PATH` | ai-service | ❌ (defaults `./models/tarteel-ct2/`) | Where `faster-whisper` loads the CT2 model from. |
| `STREAM_CHUNK_SEC` / `STREAM_WINDOW_SEC` / `STREAM_LOCK_IN_RUNS` | ai-service | ❌ (`0.25`/`4.0`/`2`) | Streaming pipeline cadence tunables. Only relevant when `TRANSCRIPTION_PROVIDER=tarteel`. |
| `PENDING_CORRECTION_TIMEOUT_SEC` | ai-service | ❌ (defaults `2.0`) | How long a pending mistake waits before auto-ack. |
| `VAD_SILENCE_THRESHOLD_SEC` | ai-service | ❌ (defaults `0.7`) | Lower = faster feedback but risks splitting long ayahs. Was 1.0 pre-streaming. |
| `TTS_AUDIO_BASE_URL` | ai-service | ❌ (defaults EveryAyah CDN) | Base URL for ayah-level mp3s embedded in `partial_mistake` events. |
| `MYSQL_ROOT_PASSWORD` | docker-compose | ✅ in compose mode | Read by `mysql` and `backend` services. |
| `EXPO_PUBLIC_API_BASE_URL` / `EXPO_PUBLIC_WS_AUDIO_URL` | frontend `.env` | ✅ for physical device | When testing on a real phone, point both at your laptop's LAN IP (e.g. `http://192.168.x.x:5000/api`, `ws://192.168.x.x:5000/ws/audio`). The platform-default `10.0.2.2` only works on the Android emulator. |

Each service has its own `.env` (`backend/.env`, `ai-service/.env`) plus a project-root `.env` consumed by `docker-compose.yml`. **Never copy real keys between them — duplication is how secrets leak.**

## Common gotchas

- `ai-service/.env` files saved by Notepad on Windows can land as UTF-16 with BOM — `python-dotenv` won't parse those. Save as UTF-8 (no BOM) or write via `[System.IO.File]::WriteAllText(...)` in PowerShell.
- The `cors()` middleware is applied twice in the Node backend (`src/app.js` configured + `server.js` open). The second call overrides the first; tighten CORS by removing the one in `server.js`.
- `prisma/migrations/` is gitignored — if collaborating, agree on `db:push` workflow or change the gitignore.
- Tajweed rule **names in Python must match `ruleName` in MySQL exactly**. Mismatch silently produces `tajweedRuleId = null` on Feedback rows.
- **`react-native-live-audio-stream` is a native module** — does NOT work in Expo Go. You must use an EAS dev build (`npx expo prebuild && npx expo run:android` or an EAS-cloud-built dev client). If audio capture silently no-ops despite the mic button visibly toggling, the dev client is the missing piece. The screen falls back to demo mode without surfacing the underlying error.
- **Physical-device WS testing requires the laptop's LAN IP** in `frontend/.env` (`EXPO_PUBLIC_WS_AUDIO_URL=ws://192.168.x.x:5000/ws/audio` and the matching REST URL). The defaults in [`src/constants/index.js`](frontend/src/constants/index.js) target the Android emulator (`10.0.2.2`) which a real phone can't reach. `EXPO_PUBLIC_*` vars are inlined at bundle time — restart Metro with `npx expo start --clear` after editing the file, or rebuild the EAS dev client if the value lived in the binary.
- **Windows Firewall can block inbound WebSocket upgrades on port 5000 even when it allows REST**. If REST works from the phone but WS errors immediately with `readyState: 3` and the backend shows no `WS opened — user:…` line, add an explicit allow rule from an admin PowerShell: `New-NetFirewallRule -DisplayName "Node Dev 5000" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5000 -Profile Any`. Also check `Get-NetConnectionProfile` — if the WiFi shows `NetworkCategory: Public`, switch it to `Private` for the dev box.
- **Tarteel conversion is one-time but per-machine.** `ai-service/models/tarteel-ct2/` is gitignored. Anyone cloning the repo must run `py -3.11 -m scripts.convert_tarteel_model` before `TRANSCRIPTION_PROVIDER=tarteel` will work. The Dockerfile bakes this into the image at build time, so HF Space / Docker Compose users don't need a separate step.
- **`load_dotenv(override=True)` in `app/config.py` clobbers env-var patches set by tests.** Tests that need to exercise the provider factory must patch `transcription.TRANSCRIPTION_PROVIDER` directly via `monkeypatch.setattr(...)` rather than `os.environ` — see [`tests/test_provider_factory.py`](ai-service/tests/test_provider_factory.py) for the pattern.
- **Surface streaming errors via `StreamErrorCode`, not raw strings.** [`audioStreamService.js`](frontend/src/services/audioStreamService.js) throws a `StreamError` with a `code` field (mic perm denied, WS timeout, server-side 4001/4003/4503, etc.). [`ReciteScreen.js`](frontend/src/screens/ReciteScreen.js) maps each code to a human-readable popup via `STREAM_ERROR_MESSAGES`. When adding new failure modes, extend the enum + the message table together — don't `Alert.alert(err.message)` with raw technical text. The audioStreamService also fires an `onDropped(code)` callback if the WS drops mid-recording, so unexpected disconnects don't fail silently.
