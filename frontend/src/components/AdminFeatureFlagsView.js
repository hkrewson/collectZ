import React, { useCallback, useEffect, useState } from 'react';

export default function AdminFeatureFlagsView({ apiCall, onToast, Spinner, cx }) {
  const [flags, setFlags] = useState([]);
  const [readOnly, setReadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState('');
  const [error, setError] = useState('');

  const loadFlags = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const payload = await apiCall('get', '/admin/feature-flags');
      setFlags(Array.isArray(payload?.flags) ? payload.flags : []);
      setReadOnly(Boolean(payload?.readOnly));
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load feature flags');
    } finally {
      setLoading(false);
    }
  }, [apiCall]);

  useEffect(() => {
    loadFlags();
  }, [loadFlags]);

  const toggle = async (flag, enabled) => {
    if (!flag?.key) return;
    setSavingKey(flag.key);
    try {
      const updated = await apiCall('patch', `/admin/feature-flags/${encodeURIComponent(flag.key)}`, { enabled });
      setFlags((prev) => prev.map((row) => (row.key === updated.key ? updated : row)));
      onToast?.(`Updated ${flag.key}`);
    } catch (err) {
      onToast?.(err?.response?.data?.error || 'Failed to update flag', 'error');
    } finally {
      setSavingKey('');
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 max-w-5xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="section-title">Feature Flags</h1>
          <p className="text-sm text-ghost mt-1">Operational controls for staged rollout and fallback behavior.</p>
        </div>
        <button type="button" className="btn-secondary btn-sm" onClick={loadFlags} disabled={loading}>
          {loading ? <Spinner size={14} /> : 'Refresh'}
        </button>
      </div>

      {readOnly && (
        <div className="card p-3 border border-warn/40 bg-warn/10 text-sm text-warn">
          Feature flags are read-only in this environment (`FEATURE_FLAGS_READ_ONLY=true`).
        </div>
      )}
      {error && <div className="card p-3 border border-err/40 bg-err/10 text-sm text-err">{error}</div>}

      <div className="card divide-y divide-edge">
        {loading && (
          <div className="px-4 py-6 flex items-center gap-3 text-dim">
            <Spinner size={16} /> Loading flags…
          </div>
        )}
        {!loading && flags.length === 0 && (
          <p className="px-4 py-6 text-sm text-ghost">No feature flags defined.</p>
        )}
        {!loading && flags.map((flag) => {
          const disabled = readOnly || savingKey === flag.key || flag.envOverride !== null;
          return (
            <div key={flag.key} className="px-4 py-3 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-ink font-medium font-mono">{flag.key}</p>
                <p className="text-xs text-ghost mt-1">{flag.description || 'No description'}</p>
                <p className="text-[11px] text-ghost mt-1">
                  {flag.envOverride !== null
                    ? `Env override active: ${flag.envOverride ? 'enabled' : 'disabled'}`
                    : `Last updated: ${flag.updatedAt ? new Date(flag.updatedAt).toLocaleString() : 'never'}`}
                  {flag.updatedByEmail ? ` · by ${flag.updatedByEmail}` : ''}
                </p>
              </div>
              <span className={cx('badge', flag.enabled ? 'badge-ok' : 'badge-dim')}>
                {flag.enabled ? 'Enabled' : 'Disabled'}
              </span>
              <button
                type="button"
                className={cx('btn-sm', flag.enabled ? 'btn-danger' : 'btn-primary')}
                disabled={disabled}
                onClick={() => toggle(flag, !flag.enabled)}>
                {savingKey === flag.key ? <Spinner size={14} /> : flag.enabled ? 'Disable' : 'Enable'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
