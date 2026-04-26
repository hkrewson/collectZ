import React, { useEffect, useRef, useState } from 'react';
import { CheckboxControl, posterUrl } from './app/AppPrimitives';

export default function ProfileView({ user, apiCall, onToast, Spinner, onUserUpdate }) {
  const [form, setForm] = useState({ name: user?.name || '', email: user?.email || '', image_path: user?.image_path || '', current_password: '', password: '' });
  const [saving, setSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [patScopes, setPatScopes] = useState([]);
  const [patTokens, setPatTokens] = useState([]);
  const [patLoading, setPatLoading] = useState(true);
  const [patBusy, setPatBusy] = useState(false);
  const [patName, setPatName] = useState('');
  const [patSelectedScopes, setPatSelectedScopes] = useState(['media:read']);
  const [patExpiresAt, setPatExpiresAt] = useState('');
  const [createdPatToken, setCreatedPatToken] = useState('');
  const avatarInputRef = useRef(null);

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

  useEffect(() => {
    setForm((current) => ({
      ...current,
      name: user?.name || '',
      email: user?.email || '',
      image_path: user?.image_path || ''
    }));
  }, [user?.email, user?.image_path, user?.name]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { name: form.name, email: form.email, image_path: form.image_path || null };
      if (form.password) {
        payload.current_password = form.current_password;
        payload.password = form.password;
      }
      const nextUser = await apiCall('patch', '/profile', payload);
      onUserUpdate?.(nextUser);
      onToast('Profile updated');
      setForm((current) => ({ ...current, current_password: '', password: '' }));
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

  const uploadAvatar = async (file) => {
    if (!file) return;
    setAvatarUploading(true);
    try {
      const body = new FormData();
      body.append('cover', file);
      const uploaded = await apiCall('post', '/media/upload-cover', body, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      if (!uploaded?.path) throw new Error('Profile image upload did not return a path');
      setForm((current) => ({ ...current, image_path: uploaded.path }));
      onToast('Profile image ready to save');
    } catch (err) {
      onToast(err.response?.data?.error || err.message || 'Profile image upload failed', 'error');
    } finally {
      setAvatarUploading(false);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  };

  const profileImage = posterUrl(form.image_path || user?.image_path || '');

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="space-y-2">
          <h1 className="section-title !mb-0">My profile</h1>
          <p className="max-w-2xl text-sm text-ghost">
            Update your account details, change your password, and manage personal access tokens for scripts and automation.
          </p>
        </header>

        <div className="grid gap-10 xl:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="space-y-4 xl:sticky xl:top-6">
            <div className="rounded-lg border border-edge/70 bg-surface/40 p-4">
              <div className="flex items-center gap-4 xl:flex-col xl:items-start">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gold/20 bg-gold/8 font-display text-2xl text-gold">
                  {profileImage
                    ? <img src={profileImage} alt={user?.name || 'Profile'} className="h-full w-full object-cover" />
                    : (user?.name?.[0]?.toUpperCase() || '?')}
                </div>
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-base font-medium text-ink">{user?.name || 'Unknown user'}</p>
                  <p className="truncate text-sm text-dim">{user?.email || 'No email'}</p>
                  <span className="badge badge-dim mt-1 capitalize">{user?.role || 'member'}</span>
                </div>
              </div>
            </div>
          </aside>

          <div className="space-y-10">
            <section className="space-y-5">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold text-ink">Account details</h2>
                <p className="text-sm text-ghost">Keep your name, email, and password up to date.</p>
              </div>

              <form onSubmit={save} className="space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="field">
                    <label className="label">Name</label>
                    <input className="input" value={form.name} onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label className="label">Email</label>
                    <input className="input" type="email" value={form.email} onChange={(e) => setForm((current) => ({ ...current, email: e.target.value }))} />
                  </div>
                </div>

                <div className="field">
                  <label className="label">Profile image</label>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => uploadAvatar(e.target.files?.[0] || null)}
                  />
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    className="group flex min-h-28 w-full items-center gap-4 rounded-lg border border-edge/70 bg-surface/40 px-4 py-4 text-left transition-colors hover:border-edge hover:bg-surface/55"
                    disabled={avatarUploading}
                  >
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-edge/70 bg-surface/60 font-display text-3xl text-gold">
                      {avatarUploading ? (
                        <Spinner size={18} />
                      ) : profileImage
                        ? <img src={profileImage} alt={user?.name || 'Profile'} className="h-full w-full object-cover" />
                        : (user?.name?.[0]?.toUpperCase() || '?')}
                    </div>
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm font-medium text-ink">{avatarUploading ? 'Uploading image…' : 'Upload profile image'}</p>
                      <p className="text-sm text-dim">Click to choose a file. The avatar updates in the sidebar account menu and on this page.</p>
                      <p className="text-xs text-ghost">PNG, JPG, WEBP, or GIF</p>
                    </div>
                  </button>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="field">
                    <label className="label">Current password</label>
                    <input className="input" type="password" value={form.current_password} onChange={(e) => setForm((current) => ({ ...current, current_password: e.target.value }))} />
                    <p className="text-xs text-ghost">Required only when changing your password.</p>
                  </div>
                  <div className="field">
                    <label className="label">New password</label>
                    <input className="input" type="password" value={form.password} onChange={(e) => setForm((current) => ({ ...current, password: e.target.value }))} />
                    <p className="text-xs text-ghost">Leave blank to keep your current password.</p>
                  </div>
                </div>

                <div className="border-t border-edge/70 pt-4">
                  <button type="submit" disabled={saving} className="btn-primary">
                    {saving ? <Spinner size={16} /> : 'Save changes'}
                  </button>
                </div>
              </form>
            </section>

            <section className="space-y-5 border-t border-edge pt-6">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold text-ink">Personal access tokens</h2>
                <p className="text-sm text-ghost">Create tokens for API scripts and automation. New tokens are shown once when created.</p>
              </div>

              {createdPatToken ? (
                <div className="rounded-lg border border-gold/25 bg-gold/5 px-4 py-3 space-y-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-ink">New token</p>
                    <code className="block break-all font-mono text-xs text-gold">{createdPatToken}</code>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn-secondary btn-sm" onClick={() => copyText(createdPatToken, 'Token copied')}>
                      Copy token
                    </button>
                    <button type="button" className="btn-ghost btn-sm" onClick={() => setCreatedPatToken('')}>
                      Hide
                    </button>
                  </div>
                </div>
              ) : null}

              <form onSubmit={createPat} className="space-y-5">
                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
                  <div className="field">
                    <label className="label">Token name</label>
                    <input className="input" value={patName} onChange={(e) => setPatName(e.target.value)} placeholder="Automation token" />
                  </div>
                  <div className="field">
                    <label className="label">Expires at</label>
                    <input className="input" type="datetime-local" value={patExpiresAt} onChange={(e) => setPatExpiresAt(e.target.value)} />
                  </div>
                </div>

                <div className="field">
                  <div className="flex items-center justify-between gap-3">
                    <label className="label !mb-0">Scopes</label>
                    <span className="text-xs text-ghost">{patSelectedScopes.length} selected</span>
                  </div>
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    {patScopes.map((scope) => {
                      const active = patSelectedScopes.includes(scope);
                      return (
                        <CheckboxControl
                          key={scope}
                          id={`pat-scope-${scope.replace(/[^a-z0-9_-]/gi, '-')}`}
                          checked={active}
                          labelClassName="px-3 py-2"
                          onChange={() => togglePatScope(scope)}
                        >
                          {scope}
                        </CheckboxControl>
                      );
                    })}
                  </div>
                </div>

                <div className="border-t border-edge/70 pt-4">
                  <button type="submit" disabled={patBusy || patLoading} className="btn-primary">
                    {patBusy ? <Spinner size={16} /> : 'Create token'}
                  </button>
                </div>
              </form>

              <div className="space-y-3 border-t border-edge/70 pt-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-medium text-ink">Existing tokens</h3>
                  {patLoading ? <span className="text-xs text-ghost">Loading…</span> : null}
                </div>

                {patLoading ? (
                  <div className="flex items-center gap-3 text-dim">
                    <Spinner size={16} />
                    Loading tokens…
                  </div>
                ) : patTokens.length === 0 ? (
                  <p className="text-sm text-ghost">No personal access tokens yet.</p>
                ) : (
                  <div className="divide-y divide-edge/60 rounded-lg border border-edge/60">
                    {patTokens.map((token) => {
                      const isRevoked = Boolean(token.revoked_at);
                      const isExpired = Boolean(token.expires_at) && new Date(token.expires_at).getTime() <= Date.now();
                      const status = isRevoked ? 'Revoked' : (isExpired ? 'Expired' : 'Active');
                      return (
                        <div key={token.id} className="space-y-3 px-4 py-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-ink">{token.name}</p>
                              <p className="mt-1 font-mono text-xs text-ghost">••••{token.token_last_four}</p>
                            </div>
                            <span className="badge badge-dim">{status}</span>
                          </div>
                          <p className="text-xs leading-5 text-ghost">
                            Created {token.created_at ? new Date(token.created_at).toLocaleString() : '—'}
                            {token.last_used_at ? ` · Last used ${new Date(token.last_used_at).toLocaleString()}` : ' · Never used'}
                            {token.expires_at ? ` · Expires ${new Date(token.expires_at).toLocaleString()}` : ' · No expiry'}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {(Array.isArray(token.scopes) ? token.scopes : []).map((scope) => (
                              <span key={`${token.id}-${scope}`} className="badge badge-dim">{scope}</span>
                            ))}
                          </div>
                          {!isRevoked ? (
                            <button type="button" className="btn-danger btn-sm" disabled={patBusy} onClick={() => revokePat(token.id)}>
                              Revoke
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
