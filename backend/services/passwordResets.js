'use strict';

const crypto = require('crypto');
const pool = require('../db/pool');
const { hashInviteToken } = require('./invites');

async function issuePasswordResetToken({ userId, createdBy = null, expiresInMs = 24 * 60 * 60 * 1000 }) {
  const numericUserId = Number(userId || 0);
  if (!Number.isFinite(numericUserId) || numericUserId <= 0) {
    throw new Error('Valid userId is required');
  }

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashInviteToken(token);
  const expiresAt = new Date(Date.now() + Number(expiresInMs || 0));

  await pool.query(
    `UPDATE password_reset_tokens
     SET revoked = true
     WHERE user_id = $1
       AND used = false
       AND revoked = false`,
    [numericUserId]
  );

  const insert = await pool.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id, user_id, expires_at, created_at`,
    [numericUserId, tokenHash, expiresAt, createdBy]
  );

  return {
    id: insert.rows[0].id,
    user_id: insert.rows[0].user_id,
    expires_at: insert.rows[0].expires_at,
    created_at: insert.rows[0].created_at,
    token,
    token_hash: tokenHash
  };
}

module.exports = {
  issuePasswordResetToken
};
