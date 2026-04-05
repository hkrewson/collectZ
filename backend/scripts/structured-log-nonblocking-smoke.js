#!/usr/bin/env node

'use strict';

const pool = require('../db/pool');
const {
  BASE_URL,
  FEATURE_KEY,
  fetchJson,
  withStructuredLogSmokeEvent
} = require('./structured-log-smoke-shared');

async function getRecentActivityRows() {
  const result = await pool.query(
    `SELECT id, action, details, created_at
     FROM activity_log
     WHERE action = 'admin.feature_flag.update'
       AND details->>'key' = $1
     ORDER BY id DESC
     LIMIT 5`,
    [FEATURE_KEY]
  );
  return result.rows;
}

async function verifyHealth() {
  const result = await fetchJson(`${BASE_URL}/api/health`, {
    headers: { Accept: 'application/json' }
  });
  if (!result.response.ok) {
    throw new Error(`/api/health failed (${result.response.status}): ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

async function main() {
  const beforeRows = await getRecentActivityRows();
  const beforeMaxId = Number(beforeRows[0]?.id || 0) || 0;

  const verification = await withStructuredLogSmokeEvent(async ({ requestId }) => {
    const health = await verifyHealth();
    const afterRows = await getRecentActivityRows();
    const latest = afterRows.find((row) => Number(row.id) > beforeMaxId);

    if (!latest) {
      throw new Error('Expected a new admin.feature_flag.update row in activity_log even while the collector path is unavailable');
    }

    const details = latest.details || {};
    if (String(details.key || '') !== FEATURE_KEY) {
      throw new Error(`Expected activity_log details.key=${FEATURE_KEY}, got ${JSON.stringify(details)}`);
    }

    return {
      requestId,
      health,
      activityId: Number(latest.id),
      activityCreatedAt: latest.created_at,
      details
    };
  });

  console.log('Structured log non-blocking smoke passed.');
  console.log(`Request ID: ${verification.requestId}`);
  console.log(`Activity row: ${verification.activityId}`);
  console.log(`Health version: ${verification.health?.version || 'unknown'}`);
}

main().catch((error) => {
  console.error(`Structured log non-blocking smoke failed: ${error.message}`);
  process.exit(1);
});
