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
  emailDeliveryEndpoint = null
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
