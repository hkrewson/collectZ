const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const pool = require('../db/pool');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken, requireSessionAuth } = require('../middleware/auth');
const { getProductEdition, isHomelabEdition } = require('../config/productEdition');
const { hashMobileAuthToken: hash, createMobileAuthSession, TV_AUTH_SCOPES } = require('../services/mobileAuthTokens');
const { logActivity } = require('../services/audit');
const router = express.Router();
const limit = (max) => rateLimit({ windowMs: 60 * 1000, limit: max, standardHeaders: true, legacyHeaders: false,
  message: { error: 'slow_down' } });
const normalizeCode = value => String(value || '').toUpperCase().replace(/[- ]/g, '');
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.get('/tv/capabilities', (_req, res) => res.json({ capabilityVersion: 1,
  supported: isHomelabEdition(getProductEdition()), edition: isHomelabEdition(getProductEdition()) ? 'core' : 'platform',
  deviceAuthorization: true, readOnly: true }));
router.use('/auth/device', (_req, res, next) => isHomelabEdition(getProductEdition())
  ? next() : res.status(403).json({ error: 'unsupported_edition' }));
router.post('/auth/device/start', limit(6), asyncHandler(async (req, res) => {
  const deviceName = String(req.body?.device_name || 'Apple TV').trim().slice(0, 80) || 'Apple TV';
  const deviceCode = crypto.randomBytes(32).toString('base64url');
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const userCode = Array.from({ length: 8 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  await pool.query('DELETE FROM tv_device_authorizations WHERE expires_at < NOW() - INTERVAL \'1 day\'');
  await pool.query(`INSERT INTO tv_device_authorizations(device_hash,user_code_hash,device_name,expires_at)
    VALUES($1,$2,$3,NOW() + INTERVAL '10 minutes')`, [hash(deviceCode), hash(userCode), deviceName]);
  res.status(201).json({ device_code: deviceCode, user_code: `${userCode.slice(0,4)}-${userCode.slice(4)}`,
    verification_path: '/activate', expires_in: 600, interval: 5 });
}));
router.post('/auth/device/decision', limit(10), (req, res, next) => req.get('authorization') ? res.status(403).json({ error: 'Browser session required' }) : next(), authenticateToken, requireSessionAuth, asyncHandler(async (req, res) => {
  const code = normalizeCode(req.body?.user_code);
  if (!/^[A-Z2-9]{8}$/.test(code) || !['approve', 'deny'].includes(req.body?.decision)) {
    return res.status(400).json({ error: 'invalid_code' });
  }
  const result = await pool.query(`UPDATE tv_device_authorizations SET status=$2,user_id=$3
    WHERE user_code_hash=$1 AND status='pending' AND expires_at>NOW() RETURNING id`,
  [hash(code), req.body.decision === 'approve' ? 'approved' : 'denied', req.user.id]);
  if (!result.rows[0]) return res.status(400).json({ error: 'invalid_or_expired_code' });
  await logActivity(req, 'auth.tv.device.decision', 'tv_device_authorization', result.rows[0].id,
    { decision: req.body.decision });
  res.json({ approved: req.body.decision === 'approve' });
}));
router.post('/auth/device/token', limit(30), asyncHandler(async (req, res) => {
  const code = String(req.body?.device_code || '');
  if (!/^[A-Za-z0-9_-]{43}$/.test(code)) return res.status(400).json({ error: 'invalid_grant' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`SELECT *, expires_at <= NOW() AS expired,
      next_poll_at > NOW() AS too_soon FROM tv_device_authorizations WHERE device_hash=$1 FOR UPDATE`, [hash(code)]);
    const row = result.rows[0];
    let error;
    if (!row || row.status === 'consumed') error = 'invalid_grant';
    else if (row.expired) error = 'expired_token';
    else if (row.status === 'denied') error = 'access_denied';
    else if (row.too_soon) {
      await client.query(`UPDATE tv_device_authorizations SET poll_interval=LEAST(poll_interval+5,60),
        next_poll_at=NOW() + (LEAST(poll_interval+5,60) * INTERVAL '1 second') WHERE id=$1`, [row.id]);
      error = 'slow_down';
    } else if (row.status === 'pending') {
      await client.query(`UPDATE tv_device_authorizations SET next_poll_at=NOW() + (poll_interval * INTERVAL '1 second') WHERE id=$1`, [row.id]);
      error = 'authorization_pending';
    }
    if (error) { await client.query('COMMIT'); return res.status(400).json({ error }); }
    const pair = await createMobileAuthSession({ userId: row.user_id, deviceName: row.device_name,
      platform: 'tvos', scopes: TV_AUTH_SCOPES, client });
    await client.query("UPDATE tv_device_authorizations SET status='consumed' WHERE id=$1", [row.id]);
    await client.query('COMMIT');
    const { session, ...tokens } = pair;
    res.json(tokens);
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}));
module.exports = router;
