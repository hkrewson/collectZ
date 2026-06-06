import React, { useCallback, useEffect, useMemo, useState } from 'react';

const FEATURE_FLAG_LABELS = {
  self_registration_enabled: 'Self-Registration',
  events_enabled: 'Events Library',
  collectibles_enabled: 'Collectibles Library'
};
const SETTINGS_VISIBLE_FLAGS = [
  'events_enabled',
  'collectibles_enabled'
];

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

function ThemeSettingRow({ value, saving, onChange, label = 'Theme', description = 'Choose whether collectZ follows your system appearance or stays fixed to a light or dark theme.' }) {
  return (
    <div className="flex items-start justify-between gap-4 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{label}</p>
        {description ? <p className="mt-1 text-sm text-ghost">{description}</p> : null}
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

function EmailDeliveryCard({
  smtp,
  form,
  saving,
  testing,
  onChange,
  onSave,
  onUseEnv,
  onClearPassword,
  onSendTest
}) {
  const configured = Boolean(smtp?.configured);
  const statusTone = configured ? 'text-ok' : 'text-warn';
  const statusLabel = configured ? 'Configured' : 'Not configured';
  const usingAppSettings = form.mode === 'app_settings';
  return (
    <div className="rounded-xl border border-edge bg-panel px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">Email Delivery</p>
          <p className="mt-1 text-sm text-ghost">
            Platform SMTP is used for invites, password resets, and upcoming self-registration mail.
          </p>
        </div>
        <span className={`text-sm font-medium ${statusTone}`}>{statusLabel}</span>
      </div>
      <dl className="mt-4 grid gap-3 text-sm text-ghost sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Source</dt>
          <dd className="mt-1 text-ink">{smtp?.source === 'env' ? 'Environment' : 'App settings'}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-[0.14em] text-muted">SMTP Host</dt>
          <dd className="mt-1 text-ink">{smtp?.host || 'Not set'}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Port</dt>
          <dd className="mt-1 text-ink">{smtp?.port || 'Not set'}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Security</dt>
          <dd className="mt-1 text-ink">{smtp?.secure ? 'TLS / secure' : 'StartTLS / opportunistic'}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Auth</dt>
          <dd className="mt-1 text-ink">{smtp?.authConfigured ? 'Configured' : 'Anonymous / relay'}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-[0.14em] text-muted">From</dt>
          <dd className="mt-1 text-ink">{smtp?.from || 'Not set'}</dd>
        </div>
      </dl>
      <div className="mt-5 space-y-4 border-t border-edge/70 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-ink">SMTP Configuration Source</p>
            <p className="mt-1 text-sm text-ghost">
              Use environment defaults or store a platform-managed SMTP override inside the app.
            </p>
          </div>
          <select
            className="select min-w-[12rem] bg-raised"
            value={form.mode}
            disabled={saving}
            onChange={(e) => onChange('mode', e.target.value)}
          >
            <option value="env">Environment defaults</option>
            <option value="app_settings">App-managed SMTP</option>
          </select>
        </div>

        {usingAppSettings ? (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="field">
              <span className="label">SMTP Host</span>
              <input className="input" value={form.host} disabled={saving} onChange={(e) => onChange('host', e.target.value)} />
            </label>
            <label className="field">
              <span className="label">Port</span>
              <input className="input" type="number" min="1" max="65535" value={form.port} disabled={saving} onChange={(e) => onChange('port', e.target.value)} />
            </label>
            <label className="field">
              <span className="label">Username</span>
              <input className="input" value={form.user} disabled={saving} onChange={(e) => onChange('user', e.target.value)} />
            </label>
            <label className="field">
              <span className="label">From Email</span>
              <input className="input" type="email" value={form.from} disabled={saving} onChange={(e) => onChange('from', e.target.value)} />
            </label>
            <label className="field md:col-span-2">
              <span className="label">Password</span>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  className="input min-w-0 flex-1"
                  type="password"
                  placeholder={form.keepExistingPassword ? 'Stored password will be kept' : 'Enter SMTP password'}
                  value={form.password}
                  disabled={saving}
                  onChange={(e) => onChange('password', e.target.value)}
                />
                <button type="button" className="btn-secondary btn-sm" disabled={saving} onClick={onClearPassword}>
                  Clear stored password
                </button>
              </div>
              {form.keepExistingPassword ? (
                <p className="mt-1 text-xs text-ghost">The existing encrypted SMTP password will be kept until you enter a new one or clear it.</p>
              ) : null}
            </label>
            <label className="field">
              <span className="label">Security</span>
              <select className="select bg-raised" value={form.secure ? 'true' : 'false'} disabled={saving} onChange={(e) => onChange('secure', e.target.value === 'true')}>
                <option value="false">StartTLS / opportunistic</option>
                <option value="true">TLS / secure</option>
              </select>
            </label>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-primary" disabled={saving} onClick={onSave}>
            {saving ? 'Saving…' : 'Save Email Settings'}
          </button>
          <button type="button" className="btn-secondary" disabled={saving || testing} onClick={onSendTest}>
            {testing ? 'Sending Test…' : 'Send Test Email'}
          </button>
          {usingAppSettings ? (
            <button type="button" className="btn-secondary" disabled={saving} onClick={onUseEnv}>
              Revert to Environment
            </button>
          ) : null}
        </div>
      </div>
      {!configured ? (
        <p className="mt-4 text-sm text-ghost">
          Email sending will fall back to copy-link workflows until platform SMTP is configured.
        </p>
      ) : null}
    </div>
  );
}

function statusClass(status) {
  if (status === 'ok' || status === 'available' || status === 'fresh' || status === 'ready_for_manual_rehearsal') return 'text-ok';
  if (status === 'error' || status === 'failed' || status === 'invalid' || status === 'blocked') return 'text-err';
  return 'text-warn';
}

function BackupPortabilityCard({
  data,
  loading,
  error,
  exporting,
  exportFormat,
  lastExportedAt,
  onRefresh,
  onExport,
  onExportFormatChange,
  Spinner
}) {
  const checks = Array.isArray(data?.checks) ? data.checks : [];
  const coverage = Array.isArray(data?.export_capabilities?.database_records?.coverage)
    ? data.export_capabilities.database_records.coverage
    : [];
  const csvFiles = [
    { key: 'manifest', label: 'Manifest' },
    { key: 'restore_guidance', label: 'Restore guidance' },
    { key: 'uploads_manifest', label: 'Uploads manifest' },
    ...coverage.map((item) => ({
      key: `table:${item.key}`,
      label: item.label || item.key,
      count: item.count
    }))
  ];
  const docs = Array.isArray(data?.docs) ? data.docs : [];
  const guidance = Array.isArray(data?.restore_guidance) ? data.restore_guidance : [];
  const backupFreshness = data?.backup_freshness || null;
  const restoreRehearsal = data?.restore_rehearsal || null;
  const rehearsalSteps = Array.isArray(restoreRehearsal?.steps) ? restoreRehearsal.steps : [];

  return (
    <div className="rounded-xl border border-edge bg-panel px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">Backup and portability</p>
          <p className="mt-1 text-sm text-ghost">
            Read-only status for database records, uploaded images, provider metadata, and restore guidance.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <label className="sr-only" htmlFor="portability-export-format">Export format</label>
          <select
            id="portability-export-format"
            className="form-select h-9 min-w-[136px] text-sm"
            value={exportFormat}
            onChange={(event) => onExportFormatChange(event.target.value)}
            disabled={loading || exporting}
          >
            <option value="json">JSON file</option>
            <option value="csv">CSV files</option>
          </select>
          <button type="button" className="btn-secondary btn-sm" onClick={onRefresh} disabled={loading || exporting}>
            {loading ? <Spinner size={14} /> : 'Refresh'}
          </button>
          {exportFormat === 'json' ? (
            <button type="button" className="btn-primary btn-sm" onClick={() => onExport('json')} disabled={loading || exporting}>
              {exporting ? <Spinner size={14} /> : 'Download JSON'}
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-lg border border-err/30 bg-err/5 px-3 py-2 text-sm text-err">
          {error}
        </div>
      ) : null}

      {loading && !data ? (
        <div className="mt-4 flex items-center gap-3 text-sm text-ghost">
          <Spinner size={16} /> Loading backup and portability status…
        </div>
      ) : null}

      {data ? (
        <div className="mt-4 space-y-4">
          <div className="rounded-lg border border-edge/80 bg-raised/40 px-3 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">Manual export</p>
                <p className="mt-1 text-sm text-ghost">
                  {data.export_capabilities?.manual_archive?.note || 'Download a redacted collectZ export bundle.'}
                </p>
                <p className="mt-1 text-xs text-muted">
                  JSON downloads one portable file. CSV downloads separate spreadsheet files by table.
                </p>
              </div>
              <span className={`text-sm font-medium ${statusClass(data.export_capabilities?.manual_archive?.status)}`}>
                {data.export_capabilities?.manual_archive?.status || 'available'}
              </span>
            </div>
            <p className="mt-2 text-xs text-muted">
              {lastExportedAt ? `Last downloaded ${lastExportedAt}` : 'No export downloaded in this browser session.'}
            </p>
            {exportFormat === 'csv' ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {csvFiles.map((file) => (
                  <button
                    type="button"
                    key={file.key}
                    className="btn-secondary btn-sm justify-between"
                    onClick={() => onExport('csv', file.key)}
                    disabled={loading || exporting}
                  >
                    <span className="truncate">{file.label}</span>
                    {typeof file.count === 'number' ? <span className="text-muted">{file.count}</span> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-edge/80 bg-raised/40 px-3 py-3">
              <p className="text-sm font-medium text-ink">Database</p>
              <p className="mt-1 text-sm text-ghost">
                {data.database?.database || 'Unknown database'} on {data.database?.host || 'unknown host'}
              </p>
              <p className={`mt-2 text-sm font-medium ${data.database?.reachable ? 'text-ok' : 'text-err'}`}>
                {data.database?.reachable ? 'Reachable' : 'Unavailable'}
              </p>
            </div>
            <div className="rounded-lg border border-edge/80 bg-raised/40 px-3 py-3">
              <p className="text-sm font-medium text-ink">Images</p>
              <p className="mt-1 text-sm text-ghost">{data.storage?.location || 'Unknown storage location'}</p>
              <p className={`mt-2 text-sm font-medium ${data.storage?.configured ? 'text-ok' : 'text-warn'}`}>
                {data.storage?.configured ? `${data.storage?.file_count ?? 'Unknown'} files` : 'Needs attention'}
              </p>
            </div>
            <div className="rounded-lg border border-edge/80 bg-raised/40 px-3 py-3">
              <p className="text-sm font-medium text-ink">Provider metadata</p>
              <p className="mt-1 text-sm text-ghost">Identifiers and linked provider keys</p>
              <p className={`mt-2 text-sm font-medium ${statusClass(data.export_capabilities?.provider_metadata?.status)}`}>
                {data.export_capabilities?.provider_metadata?.linked_records ?? 0} linked records
              </p>
            </div>
            <div className="rounded-lg border border-edge/80 bg-raised/40 px-3 py-3">
              <p className="text-sm font-medium text-ink">Backup freshness</p>
              <p className="mt-1 text-sm text-ghost">
                {backupFreshness?.last_success_at
                  ? `Last success ${new Date(backupFreshness.last_success_at).toLocaleString()}`
                  : 'No scheduled backup marker connected'}
              </p>
              <p className={`mt-2 text-sm font-medium ${statusClass(backupFreshness?.status)}`}>
                {backupFreshness?.status || 'not configured'}
              </p>
            </div>
          </div>

          {checks.length > 0 ? (
            <div className="space-y-2">
              {checks.map((check) => (
                <div key={check.key} className="flex items-start justify-between gap-4 border-t border-edge/70 pt-3 first:border-t-0 first:pt-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{check.label}</p>
                    <p className="mt-1 text-sm text-ghost">{check.detail}</p>
                  </div>
                  <span className={`shrink-0 text-sm font-medium ${statusClass(check.status)}`}>{check.status}</span>
                </div>
              ))}
            </div>
          ) : null}

          {restoreRehearsal ? (
            <div className="rounded-lg border border-edge/80 bg-raised/40 px-3 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">Restore rehearsal</p>
                  <p className="mt-1 text-sm text-ghost">{restoreRehearsal.summary}</p>
                  <p className="mt-1 text-xs text-muted">No live restore action is available here.</p>
                </div>
                <span className={`text-sm font-medium ${statusClass(restoreRehearsal.status)}`}>
                  {restoreRehearsal.status || 'manual'}
                </span>
              </div>
              {rehearsalSteps.length > 0 ? (
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {rehearsalSteps.map((step) => (
                    <div key={step.key} className="rounded-md border border-edge/70 px-3 py-2">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-medium text-ink">{step.label}</p>
                        <span className={`shrink-0 text-xs font-medium ${statusClass(step.status)}`}>{step.status}</span>
                      </div>
                      <p className="mt-1 text-sm text-ghost">{step.detail}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {coverage.length > 0 ? (
            <div>
              <p className="text-sm font-medium text-ink">Export coverage</p>
              <dl className="mt-2 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                {coverage.map((item) => (
                  <div key={item.key} className="flex items-center justify-between gap-3 border-b border-edge/60 py-2">
                    <dt className="text-ghost">{item.label}</dt>
                    <dd className="font-medium text-ink">{item.count ?? 'n/a'}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <p className="text-sm font-medium text-ink">Restore guidance</p>
              <ol className="mt-2 space-y-2 text-sm text-ghost">
                {guidance.map((item, index) => (
                  <li key={item} className="flex gap-2">
                    <span className="text-muted">{index + 1}.</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <p className="text-sm font-medium text-ink">Runbook</p>
              {docs.length > 0 ? (
                <ul className="mt-2 space-y-2 text-sm text-ghost">
                  {docs.map((doc) => (
                    <li key={doc.path}>
                      <span className="text-ink">{doc.label}</span>
                      <span className="block font-mono text-xs text-muted">{doc.path}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-ghost">No runbook link is configured.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function AdminSettingsView({
  apiCall,
  onToast,
  onSettingsChange,
  Spinner,
  generalSettingsEndpoint = '/settings/general',
  updateGeneralSettingsEndpoint = '/admin/settings/general',
  featureFlagsEndpoint = '/admin/feature-flags',
  featureFlagUpdatePath = (key) => `/admin/feature-flags/${encodeURIComponent(key)}`,
  visibleFlagKeys = SETTINGS_VISIBLE_FLAGS,
  title = 'Settings',
  description = null,
  embedded = false,
  themeLabel = 'Theme',
  themeDescription = 'Choose whether collectZ follows your system appearance or stays fixed to a light or dark theme.',
  emptyFeatureFlagsMessage = 'No feature settings are currently available.',
  emailDeliveryEndpoint = null,
  portabilityEndpoint = null
}) {
  const [settings, setSettings] = useState({ theme: 'system', density: 'comfortable' });
  const [savingGeneral, setSavingGeneral] = useState(false);
  const [flags, setFlags] = useState([]);
  const [loadingFlags, setLoadingFlags] = useState(true);
  const [flagsReadOnly, setFlagsReadOnly] = useState(false);
  const [savingFlagKey, setSavingFlagKey] = useState('');
  const [flagsError, setFlagsError] = useState('');
  const [emailDelivery, setEmailDelivery] = useState(null);
  const [emailDeliveryError, setEmailDeliveryError] = useState('');
  const [emailForm, setEmailForm] = useState({
    mode: 'env',
    host: '',
    port: '587',
    secure: false,
    user: '',
    from: '',
    password: '',
    keepExistingPassword: true
  });
  const [savingEmailDelivery, setSavingEmailDelivery] = useState(false);
  const [testingEmailDelivery, setTestingEmailDelivery] = useState(false);
  const [portabilityStatus, setPortabilityStatus] = useState(null);
  const [portabilityError, setPortabilityError] = useState('');
  const [loadingPortability, setLoadingPortability] = useState(false);
  const [exportingPortability, setExportingPortability] = useState(false);
  const [portabilityExportFormat, setPortabilityExportFormat] = useState('json');
  const [lastPortabilityExportedAt, setLastPortabilityExportedAt] = useState('');
  const visibleFlagKeySet = useMemo(() => new Set(visibleFlagKeys), [visibleFlagKeys]);

  useEffect(() => {
    apiCall('get', generalSettingsEndpoint).then((data) => {
      setSettings(data);
      onSettingsChange?.(data);
    }).catch(() => {});
  }, [apiCall, generalSettingsEndpoint, onSettingsChange]);

  const loadFlags = useCallback(async () => {
    if (visibleFlagKeys.length === 0) {
      setFlags([]);
      setFlagsReadOnly(false);
      setFlagsError('');
      setLoadingFlags(false);
      return;
    }
    setLoadingFlags(true);
    setFlagsError('');
    try {
      const payload = await apiCall('get', featureFlagsEndpoint);
      setFlags(
        Array.isArray(payload?.flags)
          ? payload.flags.filter((flag) => visibleFlagKeySet.has(flag?.key))
          : []
      );
      setFlagsReadOnly(Boolean(payload?.readOnly));
    } catch (error) {
      setFlagsError(error?.response?.data?.error || 'Failed to load feature settings');
    } finally {
      setLoadingFlags(false);
    }
  }, [apiCall, featureFlagsEndpoint, visibleFlagKeySet, visibleFlagKeys.length]);

  useEffect(() => {
    loadFlags();
  }, [loadFlags]);

  useEffect(() => {
    if (!emailDeliveryEndpoint) {
      setEmailDelivery(null);
      setEmailDeliveryError('');
      return;
    }
    let cancelled = false;
    apiCall('get', emailDeliveryEndpoint)
      .then((payload) => {
        if (cancelled) return;
        const smtp = payload?.smtp || null;
        setEmailDelivery(smtp);
        setEmailForm({
          mode: smtp?.source === 'app_settings' ? 'app_settings' : 'env',
          host: smtp?.editor?.host || '',
          port: String(smtp?.editor?.port || smtp?.port || 587),
          secure: Boolean(smtp?.editor?.secure ?? smtp?.secure),
          user: smtp?.editor?.user || '',
          from: smtp?.editor?.from || '',
          password: '',
          keepExistingPassword: Boolean(smtp?.editor?.hasPassword)
        });
        setEmailDeliveryError('');
      })
      .catch((error) => {
        if (cancelled) return;
        setEmailDelivery(null);
        setEmailDeliveryError(error?.response?.data?.error || 'Failed to load email delivery status');
      });
    return () => {
      cancelled = true;
    };
  }, [apiCall, emailDeliveryEndpoint]);

  const loadPortabilityStatus = useCallback(async () => {
    if (!portabilityEndpoint) {
      setPortabilityStatus(null);
      setPortabilityError('');
      setLoadingPortability(false);
      return;
    }
    setLoadingPortability(true);
    setPortabilityError('');
    try {
      const payload = await apiCall('get', portabilityEndpoint);
      setPortabilityStatus(payload);
    } catch (error) {
      setPortabilityStatus(null);
      setPortabilityError(error?.response?.data?.error || 'Failed to load backup and portability status');
    } finally {
      setLoadingPortability(false);
    }
  }, [apiCall, portabilityEndpoint]);

  useEffect(() => {
    loadPortabilityStatus();
  }, [loadPortabilityStatus]);

  const downloadPortabilityExport = useCallback(async (format = 'json', fileKey = '') => {
    if (!portabilityEndpoint) return;
    const safeFormat = format === 'csv' ? 'csv' : 'json';
    const safeFileKey = String(fileKey || '').trim();
    if (safeFormat === 'csv' && !safeFileKey) {
      const message = 'Choose a CSV file to download.';
      setPortabilityError(message);
      onToast(message, 'error');
      return;
    }
    setExportingPortability(true);
    setPortabilityError('');
    try {
      const requestBody = safeFormat === 'csv' ? { format: safeFormat, file: safeFileKey } : { format: safeFormat };
      const response = await apiCall('post', `${portabilityEndpoint}/export`, requestBody, { responseType: 'blob', rawResponse: true });
      const disposition = String(response?.headers?.['content-disposition'] || '');
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/i);
      const filename = filenameMatch?.[1] || `collectz-export-${Date.now()}.${safeFormat === 'csv' ? 'csv' : 'json'}`;
      const blob = response instanceof Blob ? response : response?.data;
      if (!(blob instanceof Blob)) throw new Error('Export response was not a downloadable file');
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setLastPortabilityExportedAt(`${safeFormat.toUpperCase()} ${new Date().toLocaleString()}`);
      onToast(`${safeFormat.toUpperCase()} export downloaded`);
      await loadPortabilityStatus();
    } catch (error) {
      const message = error?.response?.data?.error || error?.message || 'Failed to download export';
      setPortabilityError(message);
      onToast(message, 'error');
    } finally {
      setExportingPortability(false);
    }
  }, [apiCall, loadPortabilityStatus, onToast, portabilityEndpoint]);

  const updateTheme = async (theme) => {
    setSavingGeneral(true);
    const nextSettings = { ...settings, theme };
    setSettings(nextSettings);
    try {
      const updated = await apiCall('put', updateGeneralSettingsEndpoint, nextSettings);
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
      const updated = await apiCall('patch', featureFlagUpdatePath(feature.key), { enabled });
      setFlags((prev) => prev.map((row) => (row.key === updated.key ? updated : row)));
      onToast(`${FEATURE_FLAG_LABELS[feature.key] || feature.key} ${enabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
      onToast(error?.response?.data?.error || 'Failed to update feature setting', 'error');
    } finally {
      setSavingFlagKey('');
    }
  };

  const updateEmailField = (key, value) => {
    setEmailForm((prev) => ({
      ...prev,
      [key]: value,
      ...(key === 'password' ? { keepExistingPassword: !String(value || '').trim() } : null)
    }));
  };

  const saveEmailDelivery = async (modeOverride = null) => {
    if (!emailDeliveryEndpoint) return;
    const mode = modeOverride || emailForm.mode;
    setSavingEmailDelivery(true);
    setEmailDeliveryError('');
    try {
      const payload = mode === 'env'
        ? { mode: 'env' }
        : {
            mode: 'app_settings',
            host: emailForm.host,
            port: Number(emailForm.port || 587),
            secure: Boolean(emailForm.secure),
            user: emailForm.user,
            from: emailForm.from,
            password: emailForm.keepExistingPassword ? null : emailForm.password,
            keep_existing_password: emailForm.keepExistingPassword
          };
      const result = await apiCall('put', emailDeliveryEndpoint, payload);
      const smtp = result?.smtp || null;
      setEmailDelivery(smtp);
      setEmailForm({
        mode: smtp?.source === 'app_settings' ? 'app_settings' : 'env',
        host: smtp?.editor?.host || '',
        port: String(smtp?.editor?.port || smtp?.port || 587),
        secure: Boolean(smtp?.editor?.secure ?? smtp?.secure),
        user: smtp?.editor?.user || '',
        from: smtp?.editor?.from || '',
        password: '',
        keepExistingPassword: Boolean(smtp?.editor?.hasPassword)
      });
      onToast('Email delivery settings updated');
    } catch (error) {
      setEmailDeliveryError(error?.response?.data?.error || 'Failed to update email delivery settings');
      onToast(error?.response?.data?.error || 'Failed to update email delivery settings', 'error');
    } finally {
      setSavingEmailDelivery(false);
    }
  };

  const sendEmailTest = async () => {
    if (!emailDeliveryEndpoint) return;
    setTestingEmailDelivery(true);
    setEmailDeliveryError('');
    try {
      const result = await apiCall('post', `${emailDeliveryEndpoint}/test`, {});
      if (result?.delivery?.sent) {
        onToast(`Test email sent to ${result.email}`);
      } else {
        onToast(result?.delivery?.reason || 'Test email could not be sent', 'error');
      }
    } catch (error) {
      setEmailDeliveryError(error?.response?.data?.error || 'Failed to send test email');
      onToast(error?.response?.data?.error || 'Failed to send test email', 'error');
    } finally {
      setTestingEmailDelivery(false);
    }
  };

  return (
    <div className={embedded ? 'space-y-4' : 'h-full overflow-y-auto p-4 sm:p-6 space-y-6'}>
      <section className="space-y-3">
        {title ? <h1 className={embedded ? 'text-xl font-medium text-ink' : 'section-title mb-6'}>{title}</h1> : null}
        {description ? <p className="text-sm text-ghost">{description}</p> : null}
        {emailDelivery ? (
          <EmailDeliveryCard
            smtp={emailDelivery}
            form={emailForm}
            saving={savingEmailDelivery}
            testing={testingEmailDelivery}
            onChange={updateEmailField}
            onSave={() => saveEmailDelivery()}
            onUseEnv={() => saveEmailDelivery('env')}
            onClearPassword={() => setEmailForm((prev) => ({ ...prev, password: '', keepExistingPassword: false }))}
            onSendTest={sendEmailTest}
          />
        ) : null}
        {emailDeliveryError ? (
          <div className="rounded-xl border border-err/30 bg-err/5 px-4 py-3 text-sm text-err">
            {emailDeliveryError}
          </div>
        ) : null}
        {portabilityEndpoint ? (
          <BackupPortabilityCard
            data={portabilityStatus}
            loading={loadingPortability}
            error={portabilityError}
            exporting={exportingPortability}
            exportFormat={portabilityExportFormat}
            lastExportedAt={lastPortabilityExportedAt}
            onRefresh={loadPortabilityStatus}
            onExport={downloadPortabilityExport}
            onExportFormatChange={setPortabilityExportFormat}
            Spinner={Spinner}
          />
        ) : null}
        <div className="space-y-1">
          <ThemeSettingRow
            value={settings.theme}
            saving={savingGeneral}
            onChange={updateTheme}
            label={themeLabel}
            description={themeDescription}
          />
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
          {!loadingFlags && flags.length === 0 && emptyFeatureFlagsMessage ? (
            <p className="py-6 text-sm text-ghost">{emptyFeatureFlagsMessage}</p>
          ) : null}
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
