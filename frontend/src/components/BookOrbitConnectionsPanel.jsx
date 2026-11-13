import { useCallback, useEffect, useMemo, useState } from 'react';
import DurableJobStatusPanel from './DurableJobStatusPanel';

const EMPTY_FORM = Object.freeze({
  name: '',
  baseUrl: '',
  catalogPath: '/api/v1/opds',
  timeoutMs: '20000',
  maxPages: '100',
  automaticSync: false,
  syncIntervalMinutes: '360',
  libraryId: '',
  username: '',
  password: '',
  apiKey: ''
});

const SENSITIVE_OPERATION = {
  requireRecentReauthentication: true,
  reauthenticationReason: 'Confirm your password before using or changing stored BookOrbit credentials.'
};

function formFromConnection(connection) {
  return {
    ...EMPTY_FORM,
    name: connection?.displayName || '',
    baseUrl: connection?.endpointUrl || '',
    catalogPath: connection?.settings?.catalogPath || '/api/v1/opds',
    timeoutMs: String(connection?.settings?.timeoutMs || 20000),
    maxPages: String(connection?.settings?.maxPages || 100)
  };
}

export default function BookOrbitConnectionsPanel({ apiCall, endpointBase, onToast, Spinner }) {
  const [connections, setConnections] = useState([]);
  const [libraries, setLibraries] = useState([]);
  const [editingId, setEditingId] = useState('');
  const [form, setForm] = useState(() => ({ ...EMPTY_FORM }));
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [message, setMessage] = useState('');
  const [syncTarget, setSyncTarget] = useState(null);
  const connectionEndpoint = `${endpointBase}/bookorbit-connections`;
  const workspaceId = Number(endpointBase.match(/\/spaces\/(\d+)/)?.[1] || 0);

  const selected = useMemo(() => connections.find((connection) => connection.id === editingId) || null, [connections, editingId]);

  const loadConnections = useCallback(
    async ({ preserveSelection = true } = {}) => {
      setLoading(true);
      try {
        const [payload, libraryPayload] = await Promise.all([
          apiCall('get', `${connectionEndpoint}?includeArchived=true`),
          apiCall('get', '/libraries')
        ]);
        const next = Array.isArray(payload?.connections) ? payload.connections : [];
        setConnections(next);
        setLibraries(Array.isArray(libraryPayload?.libraries) ? libraryPayload.libraries : []);
        if (!preserveSelection || (editingId && !next.some((connection) => connection.id === editingId))) {
          setEditingId('');
          setForm({ ...EMPTY_FORM });
        }
      } catch (error) {
        setMessage(error?.response?.data?.error || 'BookOrbit connections could not be loaded.');
      } finally {
        setLoading(false);
      }
    },
    [apiCall, connectionEndpoint, editingId]
  );

  useEffect(() => {
    // The panel owns its remote connection inventory and refreshes it when the workspace endpoint changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadConnections();
  }, [loadConnections]);

  const chooseConnection = async (connection) => {
    setEditingId(connection.id);
    setForm(formFromConnection(connection));
    setSyncTarget(null);
    setMessage('');
    try {
      const payload = await apiCall('get', `${connectionEndpoint}/${connection.id}/sync-targets`);
      const target = Array.isArray(payload?.targets) ? payload.targets.find((entry) => entry.enabled) || payload.targets[0] : null;
      if (target) {
        setSyncTarget(target);
        setForm((current) => ({
          ...current,
          automaticSync: Boolean(target.enabled),
          syncIntervalMinutes: String(target.intervalMinutes || 360),
          libraryId: String(target.libraryId || '')
        }));
      }
    } catch (error) {
      setMessage(error?.response?.data?.error || 'Automatic sync settings could not be loaded.');
    }
  };

  const beginNew = () => {
    setEditingId('');
    setForm({ ...EMPTY_FORM });
    setSyncTarget(null);
    setMessage('');
  };

  const updateField = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const saveConnection = async () => {
    const hasUsername = Boolean(form.username.trim());
    const hasPassword = Boolean(form.password);
    const hasApiKey = Boolean(form.apiKey.trim());
    if (hasUsername !== hasPassword || (editingId && hasApiKey && (!hasUsername || !hasPassword))) {
      setMessage('Enter the OPDS username and password together when changing credentials or adding a native API key.');
      return;
    }
    if (!editingId && (!hasUsername || !hasPassword)) {
      setMessage('A username and password are required for a new BookOrbit connection.');
      return;
    }
    if (form.automaticSync && !form.libraryId) {
      setMessage('Choose the library that should receive automatic BookOrbit updates.');
      return;
    }

    setWorking('save');
    setMessage('');
    try {
      const details = {
        name: form.name,
        baseUrl: form.baseUrl,
        settings: {
          catalogPath: form.catalogPath,
          timeoutMs: Number(form.timeoutMs),
          maxPages: Number(form.maxPages)
        }
      };
      let saved;
      let savedTarget = null;
      if (editingId) {
        const response = await apiCall('patch', `${connectionEndpoint}/${editingId}`, details, SENSITIVE_OPERATION);
        saved = response?.connection;
        if (hasUsername && hasPassword) {
          await apiCall(
            'put',
            `${connectionEndpoint}/${editingId}/credentials`,
            {
              credentials: {
                username: form.username.trim(),
                password: form.password,
                ...(hasApiKey ? { apiKey: form.apiKey.trim() } : {})
              }
            },
            SENSITIVE_OPERATION
          );
        }
      } else {
        const response = await apiCall(
          'post',
          connectionEndpoint,
          {
            ...details,
            credentials: {
              username: form.username.trim(),
              password: form.password,
              ...(hasApiKey ? { apiKey: form.apiKey.trim() } : {})
            }
          },
          SENSITIVE_OPERATION
        );
        saved = response?.connection;
      }
      if (saved?.id && form.libraryId) {
        const targetResponse = await apiCall(
          'put',
          `${connectionEndpoint}/${saved.id}/sync-target`,
          {
            libraryId: Number(form.libraryId),
            enabled: Boolean(form.automaticSync),
            intervalMinutes: Number(form.syncIntervalMinutes)
          },
          SENSITIVE_OPERATION
        );
        savedTarget = targetResponse?.target || null;
      }
      await loadConnections({ preserveSelection: true });
      if (saved?.id) {
        setEditingId(saved.id);
        setSyncTarget(savedTarget);
        setForm({
          ...formFromConnection(saved),
          automaticSync: form.automaticSync,
          syncIntervalMinutes: form.syncIntervalMinutes,
          libraryId: form.libraryId,
          username: '',
          password: '',
          apiKey: ''
        });
      }
      setMessage(editingId ? 'BookOrbit connection updated.' : 'BookOrbit connection created.');
      onToast(editingId ? 'BookOrbit connection updated' : 'BookOrbit connection created');
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.response?.data?.error || 'BookOrbit connection could not be saved.';
      setMessage(detail);
      onToast(detail, 'error');
    } finally {
      setWorking('');
    }
  };

  const testConnection = async () => {
    if (!editingId) return;
    setWorking('test');
    setMessage('');
    try {
      const result = await apiCall('post', `${connectionEndpoint}/${editingId}/test`, {}, SENSITIVE_OPERATION);
      if (!result?.ok) throw new Error(result?.detail || 'BookOrbit connection test failed.');
      setMessage(
        `Connected. Found ${Number(result.publications || 0)} publication${Number(result.publications || 0) === 1 ? '' : 's'} across ${Number(result.pagesFetched || 0)} page${Number(result.pagesFetched || 0) === 1 ? '' : 's'}. ${result.nativeMetadata?.configured ? (result.nativeMetadata.available ? 'Native metadata is available.' : 'Native metadata is configured but unavailable; imports will use OPDS fallback.') : 'Native metadata is not configured; imports will use OPDS.'}`
      );
      onToast('BookOrbit connection succeeded');
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.response?.data?.error || error?.message || 'BookOrbit connection test failed.';
      setMessage(detail);
      onToast(detail, 'error');
    } finally {
      setWorking('');
    }
  };

  const changeStatus = async (status) => {
    if (!editingId) return;
    setWorking(status);
    setMessage('');
    try {
      const response = await apiCall('put', `${connectionEndpoint}/${editingId}/status`, { status }, SENSITIVE_OPERATION);
      const updated = response?.connection;
      await loadConnections({ preserveSelection: true });
      if (updated) setForm(formFromConnection(updated));
      setMessage(`BookOrbit connection ${status}.`);
      onToast(`BookOrbit connection ${status}`);
    } catch (error) {
      const detail = error?.response?.data?.error || 'BookOrbit connection status could not be changed.';
      setMessage(detail);
      onToast(detail, 'error');
    } finally {
      setWorking('');
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-medium text-ink">BookOrbit connections</p>
        <p className="mt-1 text-sm text-ghost">
          Keep each BookOrbit server as a separate provider connection. Credentials remain server-side and are never shown after saving.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="label">Configured servers</p>
            <button type="button" className="btn-secondary btn-sm" onClick={beginNew}>
              New connection
            </button>
          </div>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-ghost">
              <Spinner size={14} />
              Loading BookOrbit connections…
            </div>
          ) : connections.length === 0 ? (
            <p className="rounded-lg border border-edge/70 bg-raised/40 p-3 text-sm text-ghost">No BookOrbit connections yet.</p>
          ) : (
            <div className="space-y-2">
              {connections.map((connection) => (
                <button
                  type="button"
                  key={connection.id}
                  onClick={() => chooseConnection(connection)}
                  className={`w-full rounded-lg border p-3 text-left transition ${editingId === connection.id ? 'border-gold/50 bg-gold/5' : 'border-edge/70 bg-raised/40 hover:border-muted'}`}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-medium text-ink">{connection.displayName}</span>
                    <span
                      className={`badge ${connection.status === 'active' ? 'badge-ok' : connection.status === 'disabled' ? 'badge-warn' : 'badge-dim'}`}
                    >
                      {connection.status}
                    </span>
                  </span>
                  <span className="mt-1 block truncate text-xs text-ghost">{connection.endpointUrl}</span>
                  <span className="mt-1 block text-xs text-dim">
                    Credentials {connection.credentialsConfigured ? 'configured' : 'missing'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4 rounded-xl border border-edge/70 bg-raised/30 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-ink">{editingId ? 'Edit connection' : 'New connection'}</p>
            {selected ? (
              <span className="text-xs text-ghost">{selected.credentialsConfigured ? 'Credentials saved' : 'Credentials required'}</span>
            ) : null}
          </div>
          <div className="field">
            <label className="label" htmlFor="bookorbit-name">
              Name
            </label>
            <input
              id="bookorbit-name"
              className="input"
              value={form.name}
              onChange={(event) => updateField('name', event.target.value)}
              placeholder="BookOrbit Home"
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="bookorbit-base-url">
              Server URL
            </label>
            <input
              id="bookorbit-base-url"
              className="input"
              value={form.baseUrl}
              onChange={(event) => updateField('baseUrl', event.target.value)}
              placeholder="https://books.example.com"
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="bookorbit-catalog-path">
              OPDS catalog path
            </label>
            <input
              id="bookorbit-catalog-path"
              className="input font-mono"
              value={form.catalogPath}
              onChange={(event) => updateField('catalogPath', event.target.value)}
              placeholder="/api/v1/opds"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="field">
              <label className="label" htmlFor="bookorbit-timeout">
                Timeout (ms)
              </label>
              <input
                id="bookorbit-timeout"
                className="input"
                inputMode="numeric"
                value={form.timeoutMs}
                onChange={(event) => updateField('timeoutMs', event.target.value)}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="bookorbit-max-pages">
                Maximum pages
              </label>
              <input
                id="bookorbit-max-pages"
                className="input"
                inputMode="numeric"
                value={form.maxPages}
                onChange={(event) => updateField('maxPages', event.target.value)}
              />
              <p className="text-xs text-ghost">The full catalog may need dozens of pages; 100 is the recommended safety limit.</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="field">
              <label className="label" htmlFor="bookorbit-username">
                OPDS account username
              </label>
              <input
                id="bookorbit-username"
                className="input"
                autoComplete="off"
                value={form.username}
                onChange={(event) => updateField('username', event.target.value)}
                placeholder={editingId ? 'Enter to replace OPDS credentials' : 'OPDS account username'}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="bookorbit-password">
                OPDS account password
              </label>
              <input
                id="bookorbit-password"
                className="input font-mono"
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(event) => updateField('password', event.target.value)}
                placeholder={editingId ? 'Enter to replace OPDS credentials' : 'OPDS account password'}
              />
            </div>
          </div>
          <p className="text-xs text-ghost">Use the separate OPDS account configured in BookOrbit, not your normal BookOrbit sign-in.</p>
          <div className="field">
            <label className="label" htmlFor="bookorbit-api-key">
              Native API key (optional)
            </label>
            <input
              id="bookorbit-api-key"
              className="input font-mono"
              type="password"
              autoComplete="new-password"
              value={form.apiKey}
              onChange={(event) => updateField('apiKey', event.target.value)}
              placeholder={editingId ? 'Enter with OPDS credentials to enable or replace' : 'BookOrbit API key'}
            />
            <p className="text-xs text-ghost">
              Enables richer series, comic credits, and upstream provider IDs. When replacing credentials, re-enter this key to keep native
              enrichment enabled. OPDS remains the fallback if the native API is unavailable.
            </p>
          </div>
          <div className="space-y-3 rounded-lg border border-edge/70 bg-raised/40 p-3">
            <label className="flex items-center gap-2 text-sm text-ink" htmlFor="bookorbit-automatic-sync">
              <input
                id="bookorbit-automatic-sync"
                type="checkbox"
                checked={form.automaticSync}
                onChange={(event) => updateField('automaticSync', event.target.checked)}
              />
              Keep this BookOrbit server synchronized automatically
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="field">
                <label className="label" htmlFor="bookorbit-sync-library">
                  Destination library
                </label>
                <select
                  id="bookorbit-sync-library"
                  className="input"
                  value={form.libraryId}
                  onChange={(event) => updateField('libraryId', event.target.value)}
                >
                  <option value="">Choose a library</option>
                  {libraries
                    .filter((library) => !workspaceId || Number(library.space_id) === workspaceId)
                    .map((library) => (
                      <option key={library.id} value={library.id}>
                        {library.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="field">
                <label className="label" htmlFor="bookorbit-sync-interval">
                  Sync interval
                </label>
                <select
                  id="bookorbit-sync-interval"
                  className="input"
                  value={form.syncIntervalMinutes}
                  onChange={(event) => updateField('syncIntervalMinutes', event.target.value)}
                >
                  <option value="60">Every hour</option>
                  <option value="360">Every 6 hours</option>
                  <option value="720">Every 12 hours</option>
                  <option value="1440">Every day</option>
                  <option value="10080">Every week</option>
                </select>
              </div>
            </div>
            <p className="text-xs text-ghost">Changes are pulled into CollectZ. BookOrbit files and metadata are never modified.</p>
          </div>
          {editingId ? (
            <DurableJobStatusPanel
              apiCall={apiCall}
              endpointBase={endpointBase}
              provider="bookorbit"
              jobType="bookorbit_sync"
              providerConnectionId={editingId}
              cadence={syncTarget}
              onToast={onToast}
              Spinner={Spinner}
              title="BookOrbit sync activity"
            />
          ) : null}
          <div className="flex flex-wrap gap-2 border-t border-edge/70 pt-4">
            <button type="button" className="btn-primary btn-sm" onClick={saveConnection} disabled={Boolean(working)}>
              {working === 'save' ? <Spinner size={14} /> : null}
              {editingId ? 'Save changes' : 'Create connection'}
            </button>
            {editingId ? (
              <>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={testConnection}
                  disabled={Boolean(working) || selected?.status !== 'active'}
                >
                  {working === 'test' ? <Spinner size={14} /> : null}Test connection
                </button>
                {selected?.status === 'active' ? (
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => changeStatus('disabled')}
                    disabled={Boolean(working)}
                  >
                    Disable
                  </button>
                ) : (
                  <button type="button" className="btn-secondary btn-sm" onClick={() => changeStatus('active')} disabled={Boolean(working)}>
                    Reactivate
                  </button>
                )}
                {selected?.status !== 'archived' ? (
                  <button
                    type="button"
                    className="btn-ghost btn-sm text-err"
                    onClick={() => changeStatus('archived')}
                    disabled={Boolean(working)}
                  >
                    Archive
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
          {message ? (
            <p aria-live="polite" className="rounded-lg bg-raised/70 px-3 py-2 text-xs text-dim">
              {message}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
