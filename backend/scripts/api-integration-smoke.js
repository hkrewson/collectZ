'use strict';

const axios = require('axios');

const BASE_URL = process.env.API_SMOKE_BASE_URL || 'http://localhost:3001/api';

async function request(method, path, options = {}) {
  const response = await axios({
    method,
    url: `${BASE_URL}${path}`,
    validateStatus: () => true,
    ...options
  });
  return response;
}

function assertStatus(response, expected, label) {
  if (response.status !== expected) {
    throw new Error(`${label} expected status ${expected}, got ${response.status}`);
  }
}

async function main() {
  console.log(`Running API integration smoke checks against ${BASE_URL}`);

  const health = await request('get', '/health');
  assertStatus(health, 200, 'GET /health');
  if (!health.data || health.data.status !== 'ok') {
    throw new Error('GET /health returned unexpected payload');
  }

  const csrf = await request('get', '/auth/csrf-token');
  assertStatus(csrf, 200, 'GET /auth/csrf-token');
  if (!csrf.data || !csrf.data.csrfToken) {
    throw new Error('GET /auth/csrf-token missing csrfToken');
  }

  const me = await request('get', '/auth/me');
  assertStatus(me, 401, 'GET /auth/me without session');

  const media = await request('get', '/media');
  assertStatus(media, 401, 'GET /media without session');

  const admin = await request('get', '/admin/activity');
  assertStatus(admin, 401, 'GET /admin/activity without session');

  console.log('API integration smoke checks passed');
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
