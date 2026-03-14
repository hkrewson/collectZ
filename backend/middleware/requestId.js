'use strict';

const crypto = require('crypto');

function generateRequestId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
}

function requestIdMiddleware(req, res, next) {
  const incoming = String(req.headers['x-request-id'] || '').trim();
  const requestId = incoming || generateRequestId();
  req.requestId = requestId;
  req.headers['x-request-id'] = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}

module.exports = { generateRequestId, requestIdMiddleware };
