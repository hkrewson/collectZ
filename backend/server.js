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

const app = express();
const PORT = process.env.PORT || 3001;
const APP_VERSION = process.env.APP_VERSION || appMeta.version || '1.9.1';
const GIT_SHA = process.env.GIT_SHA || appMeta?.build?.gitShaDefault || 'dev';
const BUILD_DATE = process.env.BUILD_DATE || appMeta?.build?.buildDateDefault || 'unknown';
const BUILD_LABEL = `v${APP_VERSION}+${GIT_SHA}`;

// ── Trust proxy (required when behind nginx/Traefik) ─────────────────────────
app.set('trust proxy', 1);

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
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later' }
});

app.use('/api/', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

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
    await runMigrations();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`collectZ backend ${BUILD_LABEL} listening on port ${PORT} (audit=${getMode()})`);
    });
  } catch (error) {
    console.error('Fatal startup error:', error.message);
    process.exit(1);
  }
};

startServer();
