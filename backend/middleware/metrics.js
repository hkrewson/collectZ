'use strict';

const { recordHttpRequestMetric } = require('../services/metrics');

const metricsMiddleware = (req, res, next) => {
  if (!req.originalUrl?.startsWith('/api/')) return next();
  const startedAt = Date.now();

  res.on('finish', () => {
    try {
      recordHttpRequestMetric(req, res.statusCode, Date.now() - startedAt);
    } catch (_) {
      // Metrics must never break request handling.
    }
  });

  next();
};

module.exports = { metricsMiddleware };
