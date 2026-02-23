/**
 * collectZ backend entry point.
 *
 * This file is responsible for:
 *   - Express app setup and middleware stack
 *   - Mounting route modules
 *   - Running database migrations on startup
 *   - Starting the HTTP server
 *
 * Business logic, database queries, and service integrations live in:
 *   routes/     — HTTP handlers
 *   middleware/ — auth, validation, error handling
 *   services/   — TMDB, barcode, vision, crypto, audit
 *   db/         — connection pool and migration runner
 */

'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const appMeta = require('./app-meta.json');

const { runMigrations } = require('./db/migrations');
const { requestLogger, errorHandler } = require('./middleware/errors');
const { auditRequestOutcome, getMode } = require('./middleware/audit');

const authRouter = require('./routes/auth');
const mediaRouter = require('./routes/media');
const adminRouter = require('./routes/admin');
const integrationsRouter = require('./routes/integrations');
const { cleanupExpiredSessions, SESSION_MAX_PER_USER, SESSION_TTL_DAYS } = require('./services/sessions');

const app = express();
const PORT = process.env.PORT || 3001;
const APP_VERSION = process.env.APP_VERSION || appMeta.version || '1.9.9';
const GIT_SHA = process.env.GIT_SHA || appMeta?.build?.gitShaDefault || 'dev';
const BUILD_DATE = process.env.BUILD_DATE || appMeta?.build?.buildDateDefault || 'unknown';
const BUILD_LABEL = `v${APP_VERSION}+${GIT_SHA}`;
const SESSION_CLEANUP_INTERVAL_MINUTES = Math.max(1, Number(process.env.SESSION_CLEANUP_INTERVAL_MINUTES || 60));
const RATE_LIMIT_WINDOW_MINUTES = Math.max(1, Number(process.env.RATE_LIMIT_WINDOW_MINUTES || 15));
const RATE_LIMIT_WINDOW_MS = RATE_LIMIT_WINDOW_MINUTES * 60 * 1000;
const RATE_LIMIT_GLOBAL_MAX = Math.max(50, Number(process.env.RATE_LIMIT_GLOBAL_MAX || 600));
const RATE_LIMIT_AUTH_MAX = Math.max(5, Number(process.env.RATE_LIMIT_AUTH_MAX || 20));
const RATE_LIMIT_ADMIN_MAX = Math.max(30, Number(process.env.RATE_LIMIT_ADMIN_MAX || 300));
const RATE_LIMIT_MEDIA_READ_MAX = Math.max(60, Number(process.env.RATE_LIMIT_MEDIA_READ_MAX || 600));
const RATE_LIMIT_MEDIA_WRITE_MAX = Math.max(20, Number(process.env.RATE_LIMIT_MEDIA_WRITE_MAX || 240));
const RATE_LIMIT_IMPORT_START_MAX = Math.max(5, Number(process.env.RATE_LIMIT_IMPORT_START_MAX || 60));
const RATE_LIMIT_SYNC_POLL_MAX = Math.max(30, Number(process.env.RATE_LIMIT_SYNC_POLL_MAX || 600));

const parseTrustProxy = (value) => {
  if (value === undefined || value === null || value === '') {
    return process.env.NODE_ENV === 'production' ? 1 : false;
  }
  const normalized = String(value).toLowerCase().trim();
  if (normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
  if (normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
  const asNumber = Number(normalized);
  if (Number.isInteger(asNumber) && asNumber >= 0) return asNumber;
  return process.env.NODE_ENV === 'production' ? 1 : false;
};

const validateStartupSecurityConfig = () => {
  if (process.env.NODE_ENV === 'production' && !process.env.INTEGRATION_ENCRYPTION_KEY) {
    throw new Error('INTEGRATION_ENCRYPTION_KEY must be set in production');
  }
};

// ── Trust proxy (required when behind nginx/Traefik) ─────────────────────────
app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));

// ── Core middleware ───────────────────────────────────────────────────────────
// IMPORTANT: requestLogger must be first so all requests are captured.
app.use(requestLogger);

app.use(helmet());

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || 'http://localhost:3000',
  credentials: true  // Required for httpOnly cookie auth
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(auditRequestOutcome);

// ── Rate limiting ─────────────────────────────────────────────────────────────
const makeLimiter = ({ max, message, skip }) => rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  skip,
  message
});

// Authoritative layer: app-level limits are the source of truth.
// Nginx proxy intentionally does not enforce request-rate limits.
const globalLimiter = makeLimiter({
  max: RATE_LIMIT_GLOBAL_MAX,
  message: { error: 'Rate limit exceeded for API traffic' },
  // Import status polling is governed by a dedicated limiter below.
  skip: (req) => req.path === '/media/sync-jobs'
});
const authLimiter = makeLimiter({
  max: RATE_LIMIT_AUTH_MAX,
  message: { error: 'Too many login attempts, please try again later' }
});
const adminLimiter = makeLimiter({
  max: RATE_LIMIT_ADMIN_MAX,
  message: { error: 'Too many admin requests, please slow down' }
});
const mediaReadLimiter = makeLimiter({
  max: RATE_LIMIT_MEDIA_READ_MAX,
  message: { error: 'Too many media read requests, please slow down' },
  skip: (req) => !['GET', 'HEAD'].includes(req.method)
});
const mediaWriteLimiter = makeLimiter({
  max: RATE_LIMIT_MEDIA_WRITE_MAX,
  message: { error: 'Too many media write requests, please slow down' },
  skip: (req) => ['GET', 'HEAD'].includes(req.method)
});
const importStartLimiter = makeLimiter({
  max: RATE_LIMIT_IMPORT_START_MAX,
  message: { error: 'Too many import start requests, please wait and retry' }
});
const syncPollLimiter = makeLimiter({
  max: RATE_LIMIT_SYNC_POLL_MAX,
  message: { error: 'Too many import status checks, please slow down' }
});

app.use('/api/', globalLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/admin', adminLimiter);
app.use('/api/media', mediaReadLimiter);
app.use('/api/media', mediaWriteLimiter);
app.use('/api/media/import-plex', importStartLimiter);
app.use('/api/media/import-csv', importStartLimiter);
app.use('/api/media/sync-jobs', syncPollLimiter);

// ── Static file serving (cover uploads) ──────────────────────────────────────
app.use('/uploads', express.static('uploads'));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
// Profile endpoints live under auth routes but are exposed at /api/profile
// for backward compatibility with existing frontend calls
app.use('/api', authRouter);
app.use('/api/media', mediaRouter);
app.use('/api', integrationsRouter);
app.use('/api/admin', adminRouter);

// ── Health check ──────────────────────────────────────────────────────────────
const healthPayload = () => ({
  status: 'ok',
  version: APP_VERSION,
  gitSha: GIT_SHA,
  buildDate: BUILD_DATE,
  build: BUILD_LABEL
});

app.get('/health', (_req, res) => res.json(healthPayload()));
app.get('/api/health', (_req, res) => res.json(healthPayload()));

// 404 JSON for unmatched API routes so failures are explicit and loggable.
app.use('/api', (req, _res, next) => {
  const err = new Error(`API route not found: ${req.method} ${req.originalUrl}`);
  err.status = 404;
  next(err);
});

// ── Centralized error handler ─────────────────────────────────────────────────
// Must be registered LAST, after all routes.
app.use(errorHandler);

// ── Server startup ────────────────────────────────────────────────────────────
const startServer = async () => {
  try {
    validateStartupSecurityConfig();
    await runMigrations();
    // Run one cleanup pass on startup so stale rows are removed quickly.
    await cleanupExpiredSessions();
    const cleanupTimer = setInterval(async () => {
      try {
        await cleanupExpiredSessions();
      } catch (error) {
        console.error('Session cleanup job failed:', error.message);
      }
    }, SESSION_CLEANUP_INTERVAL_MINUTES * 60 * 1000);
    cleanupTimer.unref();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(
        `collectZ backend ${BUILD_LABEL} listening on port ${PORT} (audit=${getMode()}, ` +
        `sessionTtlDays=${SESSION_TTL_DAYS}, sessionMaxPerUser=${SESSION_MAX_PER_USER}, ` +
        `sessionCleanupMinutes=${SESSION_CLEANUP_INTERVAL_MINUTES}, ` +
        `rateWindowMin=${RATE_LIMIT_WINDOW_MINUTES}, globalMax=${RATE_LIMIT_GLOBAL_MAX})`
      );
    });
  } catch (error) {
    console.error('Fatal startup error:', error.message);
    process.exit(1);
  }
};

startServer();
