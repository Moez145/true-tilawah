# True Tilawah — Backend API

> Node.js + Express + Prisma ORM + MySQL  
> AI-powered Quranic Recitation backend for the **True Tilawah** mobile app.

---

## Project Structure

```
true-tilawah-backend/
│
├── prisma/
│   └── schema.prisma            # Database schema (all models + enums)
│
├── src/
│   ├── app.js                   # Express app (middleware stack)
│   ├── config/
│   │   └── database.js          # DB connect / disconnect helpers
│   │
│   ├── controllers/             # HTTP handlers (thin — delegate to services)
│   │   ├── auth.controller.js
│   │   ├── feedback.controller.js
│   │   ├── progress.controller.js
│   │   ├── quran.controller.js
│   │   └── session.controller.js
│   │
│   ├── middleware/
│   │   ├── auth.middleware.js   # JWT Bearer token verification
│   │   ├── error.middleware.js  # Prisma errors + global fallback + 404
│   │   └── validate.middleware.js # express-validator result checker
│   │
│   ├── models/
│   │   └── prismaClient.js      # Singleton PrismaClient instance
│   │
│   ├── routes/
│   │   ├── index.js             # Mounts all routers under /api
│   │   ├── auth.routes.js
│   │   ├── session.routes.js
│   │   ├── progress.routes.js
│   │   ├── quran.routes.js
│   │   └── validators/          # express-validator rule chains
│   │       ├── auth.validator.js
│   │       ├── session.validator.js
│   │       └── feedback.validator.js
│   │
│   ├── services/                # Business logic layer
│   │   ├── auth.service.js
│   │   ├── feedback.service.js
│   │   ├── progress.service.js
│   │   ├── quran.service.js
│   │   └── session.service.js
│   │
│   └── utils/
│       ├── hash.util.js         # bcryptjs helpers
│       ├── jwt.util.js          # Sign / verify access & refresh tokens
│       └── response.util.js     # Standardised sendSuccess / sendError
│
├── server.js                    # Entry point — boots DB then Express
├── .env.example                 # Copy to .env and fill in values
├── .gitignore
└── package.json
```

---

## Prerequisites

| Tool    | Version  |
|---------|----------|
| Node.js | ≥ 18.x   |
| npm     | ≥ 9.x    |
| MySQL   | ≥ 8.0    |

---

## Quick Start

### 1. Clone & Install

```bash
git clone <repo-url>
cd true-tilawah-backend
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Open `.env` and set at minimum:

```env
DATABASE_URL="mysql://root:yourpassword@localhost:3306/true_tilawah"
JWT_SECRET=replace_with_a_long_random_string
JWT_REFRESH_SECRET=replace_with_another_long_random_string
```

### 3. Create the MySQL Database

Log into MySQL and run:

```sql
CREATE DATABASE true_tilawah CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 4. Push Schema to Database

This creates all tables without running migrations (best for initial setup):

```bash
npm run db:push
```

Or use migrations for a version-controlled approach:

```bash
npm run db:migrate
```

### 5. Generate Prisma Client

```bash
npm run db:generate
```

### 6. Start the Server

```bash
# Development (auto-restarts on file change)
npm run dev

# Production
npm start
```

Server starts at: `http://localhost:5000`

---

## API Endpoints

### Auth — `/api/auth`

| Method | Path         | Auth | Description              |
|--------|--------------|------|--------------------------|
| POST   | `/register`  | ❌   | Create account           |
| POST   | `/login`     | ❌   | Login, receive tokens    |
| POST   | `/refresh`   | ❌   | Refresh access token     |
| GET    | `/profile`   | ✅   | Get authenticated profile|

### Sessions — `/api/sessions`

| Method | Path                           | Auth | Description                  |
|--------|--------------------------------|------|------------------------------|
| POST   | `/`                            | ✅   | Start a new recitation session|
| GET    | `/`                            | ✅   | List all sessions (paginated)|
| GET    | `/:id`                         | ✅   | Get single session + details |
| PATCH  | `/:id/complete`                | ✅   | Mark session as completed    |
| PATCH  | `/:id/abandon`                 | ✅   | Mark session as abandoned    |
| DELETE | `/:id`                         | ✅   | Delete session               |
| POST   | `/:sessionId/feedback`         | ✅   | Log a single mistake         |
| POST   | `/:sessionId/feedback/batch`   | ✅   | Bulk-log mistakes            |
| GET    | `/:sessionId/feedback`         | ✅   | Get all session feedback     |

### Progress — `/api/progress`

| Method | Path       | Auth | Description                     |
|--------|------------|------|---------------------------------|
| GET    | `/`        | ✅   | Overall progress stats          |
| GET    | `/trend`   | ✅   | Accuracy trend (last N sessions)|
| GET    | `/errors`  | ✅   | Error type breakdown            |
| GET    | `/tajweed` | ✅   | Most violated Tajweed rules     |

### Quran Reference — `/api/quran` (public)

| Method | Path                                    | Description                   |
|--------|-----------------------------------------|-------------------------------|
| GET    | `/surahs`                               | List all 114 Surahs           |
| GET    | `/surahs/:number`                       | Get Surah metadata            |
| GET    | `/surahs/:number/ayahs`                 | Get all Ayahs in a Surah      |
| GET    | `/surahs/:number/ayahs/:ayahNumber`     | Get a specific Ayah           |
| GET    | `/surahs/:number/range?start=1&end=7`   | Get Ayah range                |
| GET    | `/tajweed-rules`                        | List all Tajweed rules        |

### Health Check

```
GET /api/health
```

---

## Authentication Flow

1. Register → receive `accessToken` + `refreshToken`
2. Attach `Authorization: Bearer <accessToken>` to all protected requests
3. When access token expires (7d), call `POST /api/auth/refresh` with `refreshToken`

---

## Database Models

| Table           | Purpose                                      |
|-----------------|----------------------------------------------|
| `users`         | Account credentials and profile              |
| `progress`      | 1:1 analytics per user (accuracy, streaks)   |
| `sessions`      | Each recitation attempt                      |
| `recordings`    | Audio file references per session            |
| `feedbacks`     | Per-word mistake log with error type         |
| `tajweed_rules` | Reference table of all Tajweed rules         |
| `quranic_texts` | Surah metadata (1–114)                       |
| `ayahs`         | Individual verse text + translations         |

---

## Environment Variables Reference

| Variable                | Required | Default      | Description                     |
|-------------------------|----------|--------------|---------------------------------|
| `DATABASE_URL`          | ✅       | —            | MySQL connection string         |
| `JWT_SECRET`            | ✅       | —            | Access token signing secret     |
| `JWT_REFRESH_SECRET`    | ✅       | —            | Refresh token signing secret    |
| `JWT_EXPIRES_IN`        | ❌       | `7d`         | Access token TTL                |
| `JWT_REFRESH_EXPIRES_IN`| ❌       | `30d`        | Refresh token TTL               |
| `PORT`                  | ❌       | `5000`       | HTTP port                       |
| `NODE_ENV`              | ❌       | `development`| Environment flag                |
| `BCRYPT_SALT_ROUNDS`    | ❌       | `12`         | Password hashing cost           |
| `CORS_ORIGIN`           | ❌       | `*`          | Allowed CORS origin             |
| `RATE_LIMIT_MAX`        | ❌       | `100`        | Max requests per window         |
| `RATE_LIMIT_WINDOW_MS`  | ❌       | `900000`     | Rate limit window (ms)          |
