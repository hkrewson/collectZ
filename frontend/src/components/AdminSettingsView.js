import React, { useCallback, useEffect, useState } from 'react';

const FEATURE_FLAG_LABELS = {
  lookup_upc_enabled: 'Barcode Lookup',
  recognize_cover_enabled: 'Cover Recognition',
  events_enabled: 'Events Library',
  collectibles_enabled: 'Collectibles Library',
  metrics_enabled: 'Metrics Export',
  external_log_export_enabled: 'External Log Export'
};
const SETTINGS_VISIBLE_FLAGS = new Set([
  'events_enabled',
  'collectibles_enabled'
]);

function FeatureToggle({ feature, disabled, saving, onToggle }) {
  const enabled = Boolean(feature?.enabled);
  return (
    <div className="flex items-start justify-between gap-4 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">
          {FEATURE_FLAG_LABELS[feature.key] || feature.key}
        </p>
        <p className="mt-1 text-sm text-ghost">
          {feature.description || 'No description'}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={`${enabled ? 'Disable' : 'Enable'} ${FEATURE_FLAG_LABELS[feature.key] || feature.key}`}
        disabled={disabled || saving}
        onClick={() => onToggle(feature, !enabled)}
        className={[
          'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-all duration-150',
          'focus:outline-none focus:ring-2 focus:ring-gold/30 focus:ring-offset-2 focus:ring-offset-surface',
          enabled ? 'border-gold/30 bg-gold/15' : 'border-edge bg-raised/80',
          (disabled || saving) ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-muted'
        ].join(' ')}
      >
        <span
          className={[
            'inline-block h-5 w-5 rounded-full transition-transform duration-150 shadow-sm',
            enabled ? 'bg-gold' : 'bg-dim',
            enabled ? 'translate-x-6' : 'translate-x-1'
          ].join(' ')}
        />
      </button>
    </div>
  );
}

function ThemeSettingRow({ value, saving, onChange }) {
  return (
    <div className="flex items-start justify-between gap-4 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">Theme</p>
        <p className="mt-1 text-sm text-ghost">
          Choose whether collectZ follows your system appearance or stays fixed to a light or dark theme.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {saving && <span className="text-xs text-ghost">Saving…</span>}
        <select
          className="select min-w-[8.5rem] bg-raised"
          value={value}
          disabled={saving}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </div>
    </div>
  );
}

export default function AdminSettingsView({ apiCall, onToast, onSettingsChange, Spinner }) {
  const [settings, setSettings] = useState({ theme: 'system', density: 'comfortable' });
  const [savingGeneral, setSavingGeneral] = useState(false);
  const [flags, setFlags] = useState([]);
  const [loadingFlags, setLoadingFlags] = useState(true);
  const [flagsReadOnly, setFlagsReadOnly] = useState(false);
  const [savingFlagKey, setSavingFlagKey] = useState('');
  const [flagsError, setFlagsError] = useState('');

  useEffect(() => {
    apiCall('get', '/settings/general').then((data) => {
      setSettings(data);
      onSettingsChange?.(data);
    }).catch(() => {});
  }, [apiCall, onSettingsChange]);

  const loadFlags = useCallback(async () => {
    setLoadingFlags(true);
    setFlagsError('');
    try {
      const payload = await apiCall('get', '/admin/feature-flags');
      setFlags(
        Array.isArray(payload?.flags)
          ? payload.flags.filter((flag) => SETTINGS_VISIBLE_FLAGS.has(flag?.key))
          : []
      );
      setFlagsReadOnly(Boolean(payload?.readOnly));
    } catch (error) {
      setFlagsError(error?.response?.data?.error || 'Failed to load feature settings');
    } finally {
      setLoadingFlags(false);
    }
  }, [apiCall]);

  useEffect(() => {
    loadFlags();
  }, [loadFlags]);

  const updateTheme = async (theme) => {
    setSavingGeneral(true);
    const nextSettings = { ...settings, theme };
    setSettings(nextSettings);
    try {
      const updated = await apiCall('put', '/admin/settings/general', nextSettings);
      setSettings(updated);
      onSettingsChange?.(updated);
      onToast('Theme updated');
    } catch {
      setSettings((prev) => ({ ...prev, theme: settings.theme }));
      onToast('Theme update failed', 'error');
    } finally {
      setSavingGeneral(false);
    }
  };

  const toggleFeature = async (feature, enabled) => {
    if (!feature?.key) return;
    setSavingFlagKey(feature.key);
    try {
      const updated = await apiCall('patch', `/admin/feature-flags/${encodeURIComponent(feature.key)}`, { enabled });
      setFlags((prev) => prev.map((row) => (row.key === updated.key ? updated : row)));
      onToast(`${FEATURE_FLAG_LABELS[feature.key] || feature.key} ${enabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
      onToast(error?.response?.data?.error || 'Failed to update feature setting', 'error');
    } finally {
      setSavingFlagKey('');
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 space-y-6">
      <section className="space-y-3">
        <h1 className="section-title mb-6">Settings</h1>
        <div className="space-y-1">
          <ThemeSettingRow value={settings.theme} saving={savingGeneral} onChange={updateTheme} />
          {flagsReadOnly && (
            <div className="p-3 text-sm text-warn">
              Feature settings are read-only in this environment (`FEATURE_FLAGS_READ_ONLY=true`).
            </div>
          )}

          {flagsError && (
            <div className="p-3 text-sm text-err">
              {flagsError}
            </div>
          )}
          {loadingFlags && (
            <div className="flex items-center gap-3 py-6 text-dim">
              <Spinner size={16} /> Loading feature settings…
            </div>
          )}
          {!loadingFlags && flags.length === 0 && (
            <p className="py-6 text-sm text-ghost">No feature settings are currently available.</p>
          )}
          {!loadingFlags && flags.map((feature) => (
            <FeatureToggle
              key={feature.key}
              feature={feature}
              disabled={flagsReadOnly || feature.envOverride !== null}
              saving={savingFlagKey === feature.key}
              onToggle={toggleFeature}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
