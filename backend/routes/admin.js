const express = require('express');
const pool = require('../db/pool');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { isHomelabEdition } = require('../config/productEdition');
const { validate, generalSettingsSchema } = require('../middleware/validate');
const { logActivity } = require('../services/audit');
const { loadGeneralSettings } = require('../services/integrations');
const { listFeatureFlags, getFeatureFlag, updateFeatureFlag, FEATURE_FLAGS_READ_ONLY } = require('../services/featureFlags');
const { buildPortabilityCsvFileExport, buildPortabilityJsonExport, buildPortabilityStatus } = require('../services/portability');

const commonRouter = express.Router();
const HOMELAB_EDITION = isHomelabEdition();
const HOMELAB_ALLOWED_FEATURE_FLAGS = new Set(['events_enabled', 'collectibles_enabled']);

// All mounted admin routes require authentication + admin role
commonRouter.use(authenticateToken, requireRole('admin'));

// ── General settings ──────────────────────────────────────────────────────────

commonRouter.put('/settings/general', validate(generalSettingsSchema), asyncHandler(async (req, res) => {
  const current = await loadGeneralSettings();
  const theme = req.body.theme || current.theme;
  const density = req.body.density || current.density;

  const result = await pool.query(
    `INSERT INTO app_settings (id, theme, density)
     VALUES (1, $1, $2)
     ON CONFLICT (id) DO UPDATE SET theme = EXCLUDED.theme, density = EXCLUDED.density
     RETURNING theme, density`,
    [theme, density]
  );
  await logActivity(req, 'admin.settings.general.update', 'app_settings', 1, { theme, density });
  res.json(result.rows[0]);
}));

commonRouter.get('/settings/portability', asyncHandler(async (_req, res) => {
  res.json(await buildPortabilityStatus());
}));

commonRouter.post('/settings/portability/export', asyncHandler(async (req, res) => {
  const format = String(req.body?.format || req.query?.format || 'json').trim().toLowerCase();
  if (format === 'csv') {
    const fileKey = String(req.body?.file || req.query?.file || '').trim();
    const archive = await buildPortabilityCsvFileExport(fileKey);
    if (!fileKey) {
      res.json({
        format: 'collectz.portability.csv.v1',
        files: archive.files
      });
      return;
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${archive.filename}"`);
    res.setHeader('X-CollectZ-Export-Format', 'collectz.portability.csv.v1');
    res.send(archive.buffer);
    return;
  }
  const archive = await buildPortabilityJsonExport();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${archive.filename}"`);
  res.setHeader('X-CollectZ-Export-Format', archive.payload?.manifest?.format || 'collectz.portability.export.v1');
  res.send(archive.buffer);
}));

// ── Feature flags ─────────────────────────────────────────────────────────────

commonRouter.get('/feature-flags', asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  const flags = (await listFeatureFlags()).filter((flag) => (
    !HOMELAB_EDITION || HOMELAB_ALLOWED_FEATURE_FLAGS.has(flag.key)
  ));
  res.json({ readOnly: FEATURE_FLAGS_READ_ONLY, flags });
}));

commonRouter.patch('/feature-flags/:key', asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const key = String(req.params.key || '').trim();
  const { enabled } = req.body || {};

  if (!key) return res.status(400).json({ error: 'Feature flag key is required' });
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be boolean' });
  if (HOMELAB_EDITION && !HOMELAB_ALLOWED_FEATURE_FLAGS.has(key)) {
    return res.status(404).json({ error: `Unknown feature flag: ${key}` });
  }

  const previous = await getFeatureFlag(key);
  if (!previous) return res.status(404).json({ error: `Unknown feature flag: ${key}` });

  try {
    const updated = await updateFeatureFlag({ key, enabled, updatedBy: req.user?.id || null });
    await logActivity(req, 'admin.feature_flag.update', 'feature_flag', null, {
      key,
      previousEnabled: previous.enabled,
      nextEnabled: updated.enabled,
      envOverride: updated.envOverride
    });
    res.json(updated);
  } catch (error) {
    if (error?.code === 'feature_flags_read_only') {
      await logActivity(req, 'admin.feature_flag.update.failed', 'feature_flag', null, {
        key,
        requestedEnabled: enabled,
        reason: 'read_only'
      });
    }
    throw error;
  }
}));

module.exports = {
  adminCommonRouter: commonRouter
};
