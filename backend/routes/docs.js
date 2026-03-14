const express = require('express');
const fs = require('fs');
const path = require('path');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { isFeatureEnabled } = require('../services/featureFlags');

const router = express.Router();
const DEBUG_LEVEL = Math.max(0, Math.min(2, Number(process.env.DEBUG || 0) || 0));
const OPENAPI_SPEC_PATH = path.resolve(__dirname, '..', 'openapi', 'openapi.yaml');

function loadOpenApiSpec() {
  return JSON.parse(fs.readFileSync(OPENAPI_SPEC_PATH, 'utf8'));
}

async function assertApiDocsEnabled() {
  const docsFlagEnabled = await isFeatureEnabled('api_docs_enabled', false);
  if (DEBUG_LEVEL >= 1 && docsFlagEnabled) return;
  const error = new Error('API docs are not available');
  error.status = 404;
  error.code = 'api_docs_unavailable';
  throw error;
}

router.use(authenticateToken, requireRole('admin'));

router.get('/', asyncHandler(async (_req, res) => {
  await assertApiDocsEnabled();
  res.set('Content-Security-Policy', [
    "default-src 'self'",
    "img-src 'self' data: https:",
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "font-src 'self' https://cdn.jsdelivr.net",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'"
  ].join('; '));
  res.type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>collectZ API Docs</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      body { margin: 0; background: #f5f1e8; }
      .topbar { display: none; }
      .swagger-ui .information-container { padding-bottom: 0; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: '/api/docs/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        docExpansion: 'list',
        persistAuthorization: true
      });
    </script>
  </body>
</html>`);
}));

router.get('/openapi.json', asyncHandler(async (_req, res) => {
  await assertApiDocsEnabled();
  res.json(loadOpenApiSpec());
}));

module.exports = router;
