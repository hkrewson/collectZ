#!/usr/bin/env node

'use strict';

const pool = require('../db/pool');

async function main() {
  const tokenColumn = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'invites'
          AND column_name = 'token'
     ) AS present`
  );
  const plaintextColumnPresent = tokenColumn.rows[0]?.present === true;
  const plaintextCounts = plaintextColumnPresent
    ? await pool.query(
      `SELECT
         COUNT(*) FILTER (
           WHERE used = false AND revoked = false AND expires_at > NOW() AND token IS NOT NULL
         )::int AS active_plaintext_token_count,
         COUNT(*) FILTER (WHERE token IS NOT NULL)::int AS historical_plaintext_token_count
       FROM invites`
    )
    : { rows: [{}] };
  const result = await pool.query(
    `SELECT
       COUNT(*) FILTER (
         WHERE used = false
           AND revoked = false
           AND expires_at > NOW()
       )::int AS active_invite_count,
       COUNT(*) FILTER (
         WHERE used = false
           AND revoked = false
           AND expires_at > NOW()
           AND token_hash IS NULL
       )::int AS active_missing_hash_count
     FROM invites`
  );

  const row = result.rows[0] || {};
  const plaintextRow = plaintextCounts.rows[0] || {};
  const inventory = {
    status: 'completed',
    activeInviteCount: Number(row.active_invite_count || 0),
    plaintextColumnPresent,
    activePlaintextTokenCount: Number(plaintextRow.active_plaintext_token_count || 0),
    activeMissingHashCount: Number(row.active_missing_hash_count || 0),
    historicalPlaintextTokenCount: Number(plaintextRow.historical_plaintext_token_count || 0)
  };
  inventory.fallbackRemovalReady = (
    inventory.plaintextColumnPresent === false
    && inventory.activePlaintextTokenCount === 0
    && inventory.activeMissingHashCount === 0
  );

  console.log(JSON.stringify(inventory));
}

main()
  .catch((error) => {
    console.error(`Invite token inventory failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
