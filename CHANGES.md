# collectZ 1.6.4 — Changes

This archive contains every file that changed or was added in 1.6.4.
Copy each file to the path shown below, relative to your repo root.

## What changed and why

### Backend — full modular rewrite (security + structure)

The old `backend/server.js` (~1,500 lines doing everything) is replaced by
a modular tree. The old file is **deleted**; everything below replaces it.

| File in this archive | Destination in repo | What it does |
|---|---|---|
| `backend/server.js` | `backend/server.js` | ~80-line entry point. Mount routes, run migrations, start server. **Replaces** old monolith. |
| `backend/package.json` | `backend/package.json` | Version bumped to 1.6.4. Adds `cookie-parser` and `zod`. |
| `backend/db/pool.js` | `backend/db/pool.js` | PostgreSQL connection pool. **New file.** |
| `backend/db/migrations.js` | `backend/db/migrations.js` | Transactional migration runner (replaces `ensureSchema()`). **New file.** |
| `backend/middleware/auth.js` | `backend/middleware/auth.js` | `authenticateToken` reads JWT from httpOnly cookie (falls back to Bearer). **New file.** |
| `backend/middleware/errors.js` | `backend/middleware/errors.js` | `asyncHandler` wrapper + centralized `errorHandler` + `requestLogger`. **New file.** |
| `backend/middleware/validate.js` | `backend/middleware/validate.js` | Zod schemas + `validate()` middleware for all write endpoints. **New file.** |
| `backend/routes/auth.js` | `backend/routes/auth.js` | POST /register, /login, /logout, GET /me, /profile, PATCH /profile. **New file.** |
| `backend/routes/media.js` | `backend/routes/media.js` | All /api/media routes. Ownership enforcement on PATCH/DELETE. **New file.** |
| `backend/routes/admin.js` | `backend/routes/admin.js` | All /api/admin routes. Users, invites, activity log with filters. **New file.** |
| `backend/routes/integrations.js` | `backend/routes/integrations.js` | All integration settings routes. **New file.** |
| `backend/services/audit.js` | `backend/services/audit.js` | `logActivity()` and `logError()`. **New file.** |
| `backend/services/barcode.js` | `backend/services/barcode.js` | Barcode presets + lookup helpers. **New file.** |
| `backend/services/crypto.js` | `backend/services/crypto.js` | AES-256-GCM encrypt/decrypt/mask. **New file.** |
| `backend/services/integrations.js` | `backend/services/integrations.js` | Load/normalize integration config from DB. **New file.** |
| `backend/services/tmdb.js` | `backend/services/tmdb.js` | TMDB search + details fetch. **New file.** |
| `backend/services/vision.js` | `backend/services/vision.js` | Vision/OCR helpers. **New file.** |

### Database

| File in this archive | Destination in repo | What it does |
|---|---|---|
| `init.sql` | `init.sql` | Seed user block **removed**. `schema_migrations` table added. Both migrations pre-marked as applied so the runner doesn't re-run them on first boot of a fresh deploy. |

### Frontend — full UI rewrite (Tailwind, dark cinematic)

| File in this archive | Destination in repo | What it does |
|---|---|---|
| `frontend/package.json` | `frontend/package.json` | Version bumped to 1.6.4. Adds `tailwindcss`, `autoprefixer`, `postcss` as devDeps. |
| `frontend/tailwind.config.js` | `frontend/tailwind.config.js` | Tailwind config with custom color tokens (void, abyss, gold, etc). **New file.** |
| `frontend/postcss.config.js` | `frontend/postcss.config.js` | PostCSS wiring for Tailwind + autoprefixer. **New file.** |
| `frontend/src/App.js` | `frontend/src/App.js` | Complete UI rewrite. All views: auth, library, add/edit form, detail drawer, admin, profile. **Replaces** old App.js. |
| `frontend/src/index.css` | `frontend/src/index.css` | Tailwind directives + Google Fonts import + component layer. **Replaces** old index.css. |

`frontend/src/index.js` and `frontend/public/index.html` are **unchanged** — do not touch them.

## Install steps after copying files

### Backend

```bash
cd backend
npm install          # picks up cookie-parser and zod
```

### Frontend

```bash
cd frontend
npm install          # picks up tailwindcss, autoprefixer, postcss
```

### Docker (full rebuild)

```bash
APP_VERSION=1.6.4 \
GIT_SHA=$(git rev-parse --short HEAD) \
BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
docker compose --env-file .env up -d --build
```

## API changes in 1.6.4

- `POST /api/auth/logout` added (clears session cookie)
- `PATCH /api/media/:id` and `DELETE /api/media/:id` now enforce ownership (non-admins blocked from editing others' items)
- `GET /api/admin/activity` now accepts optional filters: `action`, `userId`, `from`, `to`, `q`, `limit`
- Login and register now set an httpOnly `session_token` cookie in addition to returning a token in the response body (backward compatible — Bearer header still works)

## No breaking changes to existing data

The migration runner creates a `schema_migrations` table and pre-populates it,
so no ALTER TABLE statements will fire against an existing database.
Existing media, users, invites, and integration settings are untouched.
