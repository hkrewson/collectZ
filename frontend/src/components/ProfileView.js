import React, { useEffect, useState } from 'react';

export default function ProfileView({ user, apiCall, onToast, Spinner }) {
  const [form, setForm] = useState({ name: user?.name || '', email: user?.email || '', current_password: '', password: '' });
  const [saving, setSaving] = useState(false);
  const [patScopes, setPatScopes] = useState([]);
  const [patTokens, setPatTokens] = useState([]);
  const [patLoading, setPatLoading] = useState(true);
  const [patBusy, setPatBusy] = useState(false);
  const [patName, setPatName] = useState('');
  const [patSelectedScopes, setPatSelectedScopes] = useState(['media:read']);
  const [patExpiresAt, setPatExpiresAt] = useState('');
  const [createdPatToken, setCreatedPatToken] = useState('');

  useEffect(() => {
    let active = true;
    setPatLoading(true);
    apiCall('get', '/auth/personal-access-tokens')
      .then((data) => {
        if (!active) return;
        setPatScopes(Array.isArray(data?.scopes) ? data.scopes : []);
        setPatTokens(Array.isArray(data?.tokens) ? data.tokens : []);
      })
      .catch((err) => {
        if (!active) return;
        onToast(err.response?.data?.error || 'Failed to load personal access tokens', 'error');
      })
      .finally(() => {
        if (active) setPatLoading(false);
      });
    return () => { active = false; };
  }, [apiCall, onToast]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { name: form.name, email: form.email };
      if (form.password) {
        payload.current_password = form.current_password;
        payload.password = form.password;
      }
      await apiCall('patch', '/profile', payload);
      onToast('Profile updated');
      setForm((f) => ({ ...f, current_password: '', password: '' }));
    } catch (err) {
      onToast(err.response?.data?.error || 'Update failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const copyText = async (text, successLabel = 'Copied') => {
    try {
      await navigator.clipboard.writeText(text);
      onToast(successLabel);
    } catch {
      onToast('Copy failed', 'error');
    }
  };

  const togglePatScope = (scope) => {
    setPatSelectedScopes((current) => (
      current.includes(scope)
        ? current.filter((item) => item !== scope)
        : [...current, scope]
    ));
  };

  const createPat = async (e) => {
    e.preventDefault();
    if (!patName.trim()) {
      onToast('Token name is required', 'error');
      return;
    }
    if (patSelectedScopes.length === 0) {
      onToast('Select at least one scope', 'error');
      return;
    }
    setPatBusy(true);
    try {
      const payload = {
        name: patName.trim(),
        scopes: patSelectedScopes,
        expires_at: patExpiresAt ? new Date(patExpiresAt).toISOString() : null
      };
      const data = await apiCall('post', '/auth/personal-access-tokens', payload);
      setCreatedPatToken(data?.token || '');
      setPatTokens((current) => [data.record, ...current]);
      setPatName('');
      setPatSelectedScopes(['media:read']);
      setPatExpiresAt('');
      onToast('Personal access token created');
    } catch (err) {
      onToast(err.response?.data?.error || 'Failed to create personal access token', 'error');
    } finally {
      setPatBusy(false);
    }
  };

  const revokePat = async (tokenId) => {
    if (!window.confirm('Revoke this personal access token?')) return;
    setPatBusy(true);
    try {
      const revoked = await apiCall('delete', `/auth/personal-access-tokens/${tokenId}`);
      setPatTokens((current) => current.map((item) => (item.id === tokenId ? revoked : item)));
      onToast('Personal access token revoked');
    } catch (err) {
      onToast(err.response?.data?.error || 'Failed to revoke personal access token', 'error');
    } finally {
      setPatBusy(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 max-w-4xl">
      <h1 className="section-title mb-6">Profile</h1>
      <div className="space-y-6">
        <div className="card p-6 space-y-4">
          <div className="flex items-center gap-4 pb-4 border-b border-edge">
            <div className="w-14 h-14 rounded-xl bg-gold/10 border border-gold/20 flex items-center justify-center text-gold font-display text-2xl">
              {user?.name?.[0]?.toUpperCase() || '?'}
            </div>
            <div>
              <p className="font-medium text-ink">{user?.name}</p>
              <p className="text-sm text-ghost">{user?.email}</p>
              <span className="badge badge-gold mt-1">{user?.role}</span>
            </div>
          </div>
          <form onSubmit={save} className="space-y-4">
            <div className="field">
              <label className="label">Name</label>
              <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="field">
              <label className="label">Email</label>
              <input className="input" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="field">
              <label className="label">Current Password <span className="normal-case text-ghost font-normal">(required for password change)</span></label>
              <input className="input" type="password" value={form.current_password} onChange={(e) => setForm((f) => ({ ...f, current_password: e.target.value }))} />
            </div>
            <div className="field">
              <label className="label">New Password <span className="normal-case text-ghost font-normal">(leave blank to keep)</span></label>
              <input className="input" type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
            </div>
            <button type="submit" disabled={saving} className="btn-primary">{saving ? <Spinner size={16} /> : 'Save Changes'}</button>
          </form>
        </div>

        <div className="card p-6 space-y-4">
          <div className="space-y-1">
            <h2 className="section-title !mb-0">Personal Access Tokens</h2>
            <p className="text-sm text-ghost">Use these for API scripts and automation. Tokens are shown only once when created.</p>
          </div>

          {createdPatToken && (
            <div className="rounded-xl border border-gold/20 bg-gold/5 p-4 space-y-3">
              <p className="text-sm text-ink">New token</p>
              <code className="block text-xs text-gold break-all font-mono">{createdPatToken}</code>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary btn-sm" onClick={() => copyText(createdPatToken, 'Token copied')}>
                  Copy token
                </button>
                <button type="button" className="btn-ghost btn-sm" onClick={() => setCreatedPatToken('')}>
                  Hide
                </button>
              </div>
            </div>
          )}

          <form onSubmit={createPat} className="space-y-4">
            <div className="field">
              <label className="label">Token Name</label>
              <input className="input" value={patName} onChange={(e) => setPatName(e.target.value)} placeholder="Automation token" />
            </div>
            <div className="field">
              <label className="label">Expires At <span className="normal-case text-ghost font-normal">(optional)</span></label>
              <input className="input" type="datetime-local" value={patExpiresAt} onChange={(e) => setPatExpiresAt(e.target.value)} />
            </div>
            <div className="field">
              <label className="label">Scopes</label>
              <p className="text-xs text-ghost mb-2">Selected: {patSelectedScopes.length}</p>
              <div className="grid gap-2 md:grid-cols-2">
                {patScopes.map((scope) => (
                  <label
                    key={scope}
                    className={`inline-flex items-center gap-3 rounded-lg border px-3 py-2 text-sm cursor-pointer transition-colors ${
                      patSelectedScopes.includes(scope)
                        ? 'border-gold/40 bg-gold/10 text-gold'
                        : 'border-edge text-ink hover:bg-raised/60'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-current"
                      checked={patSelectedScopes.includes(scope)}
                      onChange={() => togglePatScope(scope)}
                    />
                    <span className="font-medium">{scope}</span>
                  </label>
                ))}
              </div>
            </div>
            <button type="submit" disabled={patBusy || patLoading} className="btn-primary">
              {patBusy ? <Spinner size={16} /> : 'Create Token'}
            </button>
          </form>

          <div className="space-y-3 pt-2 border-t border-edge">
            <p className="text-sm text-ink">Existing tokens</p>
            {patLoading ? (
              <div className="flex items-center gap-3 text-dim"><Spinner size={16} />Loading tokens…</div>
            ) : patTokens.length === 0 ? (
              <p className="text-sm text-ghost">No personal access tokens yet.</p>
            ) : (
              <div className="space-y-3">
                {patTokens.map((token) => {
                  const isRevoked = Boolean(token.revoked_at);
                  const isExpired = Boolean(token.expires_at) && new Date(token.expires_at).getTime() <= Date.now();
                  const status = isRevoked ? 'Revoked' : (isExpired ? 'Expired' : 'Active');
                  return (
                    <div key={token.id} className="rounded-xl border border-edge p-4 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm text-ink font-medium">{token.name}</p>
                          <p className="text-xs text-ghost font-mono">••••{token.token_last_four}</p>
                        </div>
                        <span className="badge badge-dim">{status}</span>
                      </div>
                      <p className="text-xs text-ghost">
                        Created {token.created_at ? new Date(token.created_at).toLocaleString() : '—'}
                        {token.last_used_at ? ` · Last used ${new Date(token.last_used_at).toLocaleString()}` : ' · Never used'}
                        {token.expires_at ? ` · Expires ${new Date(token.expires_at).toLocaleString()}` : ' · No expiry'}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {(Array.isArray(token.scopes) ? token.scopes : []).map((scope) => (
                          <span key={`${token.id}-${scope}`} className="badge badge-gold">{scope}</span>
                        ))}
                      </div>
                      {!isRevoked && (
                        <button type="button" className="btn-danger btn-sm" disabled={patBusy} onClick={() => revokePat(token.id)}>
                          Revoke
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
