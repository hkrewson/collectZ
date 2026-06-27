const express = require('express');
const rateLimit = require('express-rate-limit');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken } = require('../middleware/auth');
const { loadReleaseNotesFeed } = require('../services/releaseNotes');

const sharedRouter = express.Router();
const supportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Math.max(30, Number(process.env.RATE_LIMIT_SUPPORT_MAX || 300)),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many support requests, please slow down' }
});

sharedRouter.use(supportLimiter);

sharedRouter.get('/releases', authenticateToken, asyncHandler(async (req, res) => {
  const requestedLimit = Number(req.query.limit || 5);
  const limit = Math.max(1, Math.min(10, Number.isFinite(requestedLimit) ? requestedLimit : 5));
  res.json({
    releases: loadReleaseNotesFeed({ limit })
  });
}));

sharedRouter.use((req, res) => {
  res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
});

module.exports = {
  supportSharedRouter: sharedRouter
};
