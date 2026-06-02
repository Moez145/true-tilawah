# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

True Tilawah backend — Node.js + Express + Prisma ORM (MySQL) API for an AI-powered Quranic recitation app. Exposes a REST API under `/api` plus a binary WebSocket endpoint at `/ws/audio` for real-time audio analysis.

## Common Commands

```bash
npm install              # Install dependencies
npm run dev              # Start with nodemon (auto-restart)
npm start                # Production start (node server.js)

npm run db:push          # Push schema to DB without migrations (initial setup)
npm run db:migrate       # Run prisma migrate dev (versioned migrations)
npm run db:generate      # Regenerate Prisma client after schema changes
npm run db:studio        # Open Prisma Studio GUI
```

There is **no test runner, linter, or formatter configured**. Do not invent `npm test` / `npm run lint` — they don't exist.

After editing `prisma/schema.prisma`, always run `npm run db:generate` (and `db:push` or `db:migrate` if tables changed) before the new types are usable.

## Architecture

### Request flow
`server.js` → `src/app.js` (middleware stack) → `src/routes/index.js` → feature router → `validator → validate middleware → controller → service → prismaClient`. Controllers are intentionally **thin**: they parse `req`, call a service, and call `sendSuccess` / pass errors to `next`. Business logic lives in `src/services/*.service.js`.

### Layered structure
- **routes/** — Express routers. Each feature router applies `authenticate` once via `router.use(authenticate)` (see [session.routes.js](src/routes/session.routes.js#L27)) instead of per-route. Validators are defined in [src/routes/validators/](src/routes/validators/) and chained as middleware before the `validate` middleware that converts errors to a 422 response.
- **controllers/** — HTTP adapters only. Always `try/catch` and forward errors via `next(error)` so the centralized handlers in [error.middleware.js](src/middleware/error.middleware.js) can run.
- **services/** — All business logic and Prisma calls. Services throw plain `Error` objects with a `statusCode` property attached (e.g. `err.statusCode = 404`); the global error handler reads that field. Don't call `res.*` from services.
- **middleware/** — Order in [app.js](src/app.js) is intentional: helmet → cors → morgan → body parsers → rate limiter (mounted on `/api`) → routes → `notFoundHandler` → `prismaErrorHandler` → `globalErrorHandler`. Error handlers must remain last.
- **models/prismaClient.js** — Singleton Prisma client. In dev it is cached on `global.__prisma` to survive nodemon hot reloads; never `new PrismaClient()` elsewhere.
- **utils/response.util.js** — Every endpoint returns `{ success, message, data? }` or `{ success, message, errors? }`. Use `sendSuccess` / `sendError` rather than `res.json` directly to keep the shape consistent.

### Authentication model
JWT bearer tokens. `signAccessToken` / `signRefreshToken` in [jwt.util.js](src/utils/jwt.util.js) — separate secrets (`JWT_SECRET`, `JWT_REFRESH_SECRET`) and TTLs (default 7d / 30d). The [authenticate middleware](src/middleware/auth.middleware.js) verifies the token **and re-checks the user exists in the DB** on every request, then attaches `req.user = { id, email, fullName }`. `req.user.id` is what services use for ownership checks.

### Ownership pattern
Every service that touches user-owned resources first does a `prisma.session.findFirst({ where: { id, userId } })` (or similar) before mutating. Don't trust the path param alone — the userId from `req.user` must match. See [session.service.js:73-93](src/services/session.service.js#L73-L93) for the canonical pattern.

### Transactions and progress aggregation
- Registration creates the User and seeds the 1:1 Progress row inside a `prisma.$transaction` ([auth.service.js:20-30](src/services/auth.service.js#L20-L30)).
- `completeSession` updates the session and recalculates Progress aggregates (totalSessions, averageAccuracy, totalTimeMin) using a **raw SQL** `prisma.$executeRaw` join inside the same transaction ([session.service.js:117-147](src/services/session.service.js#L117-L147)). If you change Progress fields, update both the schema and that raw query.
- `updateDailyStreak` exists in [progress.service.js](src/services/progress.service.js#L95-L122) but is **not currently wired into `completeSession`** — call it explicitly if you want streaks to advance.

### Error handling contract
- Services throw `new Error(msg)` with `err.statusCode` set (400/401/404/409). The global handler reads it.
- Prisma errors (`P2002` unique, `P2025` not-found, `P2003` FK) are mapped in `prismaErrorHandler` before falling through to `globalErrorHandler`.
- In production, the global handler hides the raw error message; in dev it forwards `error.message`.

### WebSocket: `/ws/audio`
Wired in [server.js](server.js) via `express-ws` *after* `app.listen` setup but *before* it actually listens; `registerAudioWebSocket(app)` ([audio.ws.js](src/routes/audio.ws.js)) attaches the route. Protocol:
- Connect with `?token=<accessToken>&sessionId=<uuid>` query params (no Authorization header — browsers can't set headers on `WebSocket`).
- Server validates the token and confirms the session is `ACTIVE` and owned by the user.
- Client sends **binary frames**: `[4-byte big-endian seqNo][int16 PCM 16kHz mono]`. Out-of-order packets (seq < expected) are dropped to keep broken chunks from reaching the ASR engine.
- `audio.ws.js` opens a child WS to the Python AI service (`AI_SERVICE_HOST:AI_SERVICE_PORT` → `/ws/evaluate`), sends a JSON config frame (`surahId/ayahStart/ayahEnd/userId/sessionId`), converts int16 → float32, and forwards the audio.
- Server relays JSON events from Python verbatim to the client: `{type: "ready" | "ok" | "mistake" | "unclear" | "out_of_scope" | "final_report" | "error", ...}`.
- On every `mistake` event, Node maps each item in `mistakes[]` to a `Feedback` row and persists via `createFeedbackBatch` (per-ayah, never buffered).
- On `final_report`, Node calls `completeSession()` which marks the Session COMPLETED and recalculates `Progress` (excluding `disputed=true` rows).
- On disconnect without `final_report`, Node calls `abandonSession()` after a 3 s grace period.
- WS close codes used: `4001` (auth failure), `4003` (session not active / not owned), `4503` (AI service unavailable).

## Database (Prisma / MySQL)

Models are in [prisma/schema.prisma](prisma/schema.prisma). All tables use `@@map` to snake_case names (`users`, `sessions`, `progress`, `feedbacks`, `tajweed_rules`, `quranic_texts`, `ayahs`, `recordings`).

Key relationships and gotchas:
- `User` ↔ `Progress` is **1:1** and seeded on registration. `getUserProgress` will 404 if missing — don't break the registration transaction.
- `Session.surahId` is an **Int** that references `QuranicText.surahNumber` (not the UUID `id`). The `Ayah` table joins by the `QuranicText.id` UUID instead — be careful which column you join on.
- `Ayah` has a composite unique `(surahId, ayahNumber)` and is queried via `where: { surahId_ayahNumber: { ... } }` in [quran.service.js](src/services/quran.service.js#L83).
- `onDelete: Cascade` is set on `Progress.userId`, `Session.userId`, `Recording.sessionId`, `Feedback.sessionId` — deleting a session removes its recordings + feedbacks automatically.
- `QuranicText`, `Ayah`, and `TajweedRule` are reference data — the schema doesn't include a seeder. The `/api/quran/*` endpoints will return empty until you populate these tables manually.

Enums: `SessionStatus` (ACTIVE/COMPLETED/ABANDONED), `ErrorType` (MISPRONUNCIATION/OMITTED_WORD/ADDED_WORD/TAJWEED_VIOLATION/UNCLEAR_SPEECH), `RuleSeverity` (LOW/MEDIUM/HIGH), `SurahType` (Makki/Madni). When adding new values, also update [feedback.validator.js](src/routes/validators/feedback.validator.js) and [session.validator.js](src/routes/validators/session.validator.js) — the `isIn(...)` arrays are duplicated there and not derived from Prisma.

## Conventions

- **CommonJS only** (`require` / `module.exports`) — not ESM. `package.json` has no `"type": "module"`.
- **No TypeScript.** Plain JS with JSDoc-style comments where helpful.
- File naming: `feature.layer.js` (e.g. `auth.controller.js`, `session.service.js`, `auth.validator.js`).
- Routes mounted under `/api` globally; rate limiter (`express-rate-limit`) is also scoped to `/api` only — health check and WS are not rate-limited.
- The `cors()` middleware is registered **twice**: once in [app.js](src/app.js#L24-L30) (configured) and again in [server.js](server.js#L25) (open). The second call is redundant; if tightening CORS, remove the one in `server.js`.

## Environment

`.env` is required at the backend root (loaded by `dotenv` at the top of `server.js`). The committed `.env` contains real-looking dev secrets — never copy those values into commits or shared docs. `JWT_SECRET` and `JWT_REFRESH_SECRET` are validated at startup in [jwt.util.js](src/utils/jwt.util.js#L8) and the process throws if either is missing.

See the env table in [README.md](README.md) for the full variable list. Note: `prisma/migrations/` is gitignored, so migration history is not shared between machines — use `db:push` for collaborative dev unless the team agrees on a migration workflow.

## AI integration (Python service)

Realtime recitation feedback flows through:
**RN → Node.js `/ws/audio` → Python AI service `/ws/evaluate` → faster-whisper (`tarteel-ai/whisper-base-ar-quran`)**.

- Python lives in `ai-service/`. Run with `uvicorn app.main:app --port 8000`. Tarteel is the only transcription engine; audio never leaves the host.
- Node.js connects via `src/services/ai.service.js`; configure with `AI_SERVICE_HOST` + `AI_SERVICE_PORT` for local mode, or `AI_SERVICE_WSS_URL` + `AI_SERVICE_AUTH_TOKEN` for HF Space.
- Wire protocol (streaming events `partial_mistake` / `word_corrected` / `mistake_acknowledged` / `ayah_finalized`): see [`docs/superpowers/specs/2026-05-12-streaming-tarteel-design.md`](../docs/superpowers/specs/2026-05-12-streaming-tarteel-design.md) §4. Only `ayah_finalized` (relayed to RN as `mistake`) is persisted as `Feedback` rows; the three streaming events are ephemeral UI signals.
- Test without a frontend: `node scripts/test_audio_ws.js scripts/fixtures/al-fatihah.wav`
- Tajweed rules must be seeded once: `npm run seed:tajweed`
- Disputed feedback: `PATCH /api/sessions/:id/feedback/:fbId/dispute` flips `Feedback.disputed=true`; excluded from `Progress.totalMistakes` aggregate.
