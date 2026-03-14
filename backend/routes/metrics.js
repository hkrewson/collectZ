'use strict';

const express = require('express');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { isFeatureEnabled } = require('../services/featureFlags');
const { renderMetrics } = require('../services/metrics');

const router = express.Router();
const DEBUG_LEVEL = Math.max(0, Math.min(2, Number(process.env.DEBUG || 0) || 0));
const METRICS_SCRAPE_TOKEN = String(process.env.METRICS_SCRAPE_TOKEN || '').trim();

async function assertMetricsEnabled() {
  const enabled = await isFeatureEnabled('metrics_enabled', false);
  if (DEBUG_LEVEL >= 1 && enabled) return;
  const error = new Error('Metrics are not available');
  error.status = 404;
  error.code = 'metrics_unavailable';
  throw error;
}

function hasValidMetricsScrapeToken(req) {
  if (!METRICS_SCRAPE_TOKEN) return false;
  const raw = String(req.headers?.authorization || '');
  if (!raw.startsWith('Bearer ')) return false;
  const token = raw.slice('Bearer '.length).trim();
  return token.length > 0 && token === METRICS_SCRAPE_TOKEN;
}

const requireMetricsAccess = [
  asyncHandler(async (req, res, next) => {
    await assertMetricsEnabled();
    if (hasValidMetricsScrapeToken(req)) {
      req.metricsAuth = 'scrape_token';
      return next();
    }
    return authenticateToken(req, res, next);
  }),
  asyncHandler(async (req, res, next) => {
    if (req.metricsAuth === 'scrape_token') return next();
    return requireRole('admin')(req, res, next);
  })
];

router.get('/', requireMetricsAccess, asyncHandler(async (_req, res) => {
  const payload = await renderMetrics();
  res.type('text/plain; version=0.0.4').send(payload);
}));

module.exports = router;
module.exports.hasValidMetricsScrapeToken = hasValidMetricsScrapeToken;
