import React, { useCallback, useEffect, useMemo, useState } from 'react';

const USER_ROLES = ['admin', 'user', 'viewer'];

export default function AdminUsersView({ apiCall, onToast, currentUserId, Icons, Spinner, cx }) {
  const [activeTab, setActiveTab] = useState('members');
  const [users, setUsers] = useState([]);
  const [libraries, setLibraries] = useState([]);
  const [invites, setInvites] = useState([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const [showInviteHistory, setShowInviteHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [pendingRoles, setPendingRoles] = useState({});
  const [selectedMemberId, setSelectedMemberId] = useState(null);
  const [memberSummary, setMemberSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [resetLink, setResetLink] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [transferTargets, setTransferTargets] = useState({});

  const loadMembersData = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const [usersRes, invitesRes, librariesRes] = await Promise.allSettled([
      apiCall('get', '/admin/users'),
      apiCall('get', '/admin/invites'),
      apiCall('get', '/libraries')
    ]);

    if (usersRes.status === 'fulfilled') setUsers(usersRes.value || []);
    else setLoadError('Failed to load members.');

    if (invitesRes.status === 'fulfilled') setInvites(invitesRes.value || []);
    else setLoadError((prev) => (prev ? `${prev} Failed to load invitations.` : 'Failed to load invitations.'));

    if (librariesRes?.status === 'fulfilled') {
      const libraryRows = Array.isArray(librariesRes.value?.libraries) ? librariesRes.value.libraries : [];
      setLibraries(libraryRows);
    } else {
      setLoadError((prev) => (prev ? `${prev} Failed to load libraries.` : 'Failed to load libraries.'));
    }

    setLoading(false);
  }, [apiCall]);

  useEffect(() => { loadMembersData(); }, [loadMembersData]);

  useEffect(() => {
    if (!selectedMemberId) {
      setMemberSummary(null);
      setResetLink('');
      return;
    }
    let active = true;
    setSummaryLoading(true);
    apiCall('get', `/admin/users/${selectedMemberId}/summary`)
      .then((data) => {
        if (!active) return;
        setMemberSummary(data);
      })
      .catch(() => {
        if (!active) return;
        setMemberSummary(null);
      })
      .finally(() => {
        if (active) setSummaryLoading(false);
      });
    return () => { active = false; };
  }, [apiCall, selectedMemberId]);

  const createInvite = async (e) => {
    e.preventDefault();
    try {
      const data = await apiCall('post', '/admin/invites', { email: inviteEmail });
      const url = `${window.location.origin}/register?invite=${encodeURIComponent(data.token)}&email=${encodeURIComponent(data.email)}`;
      setInviteUrl(url);
      setInviteEmail('');
      const { token: _token, ...safeInvite } = data;
      setInvites((i) => [safeInvite, ...i]);
      onToast(`Invite created for ${data.email}`);
    } catch (err) {
      onToast(err.response?.data?.error || err.response?.data?.detail || 'Failed to create invite', 'error');
    }
  };

  const saveRole = async (id) => {
    const role = pendingRoles[id];
    if (!role) return;
    try {
      await apiCall('patch', `/admin/users/${id}/role`, { role });
      setUsers((u) => u.map((x) => (x.id === id ? { ...x, role } : x)));
      setPendingRoles((r) => { const next = { ...r }; delete next[id]; return next; });
      onToast('Role updated');
      if (selectedMemberId === id) {
        setMemberSummary((prev) => (prev ? { ...prev, user: { ...prev.user, role } } : prev));
      }
    } catch (err) {
      onToast(err.response?.data?.error || 'Failed', 'error');
    }
  };

  const deleteUser = async (id) => {
    if (!window.confirm('Delete this member? This cannot be undone.')) return;
    try {
      await apiCall('delete', `/admin/users/${id}`);
      setUsers((u) => u.filter((x) => x.id !== id));
      if (selectedMemberId === id) setSelectedMemberId(null);
      onToast('Member deleted');
    } catch (err) {
      onToast(err.response?.data?.error || 'Failed', 'error');
    }
  };

  const revokeInvite = async (inviteId) => {
    if (!window.confirm('Invalidate this invitation link?')) return;
    try {
      const data = await apiCall('patch', `/admin/invites/${inviteId}/revoke`);
      setInvites((list) => list.map((inv) => (inv.id === inviteId ? { ...inv, ...data } : inv)));
      onToast('Invitation invalidated');
    } catch (err) {
      onToast(err.response?.data?.error || 'Failed to invalidate invitation', 'error');
    }
  };

  const deleteLibrary = async (library) => {
    const ownerName = library?.created_by_name || library?.created_by_email || 'unknown owner';
    const phrase = `DELETE ${library.name}`;
    const confirmName = window.prompt(
      `You are about to permanently delete a library owned by ${ownerName}.\nType "${phrase}" to confirm deletion:`
    );
    if (!confirmName) return;
    if (confirmName !== phrase) {
      onToast('Delete confirmation phrase did not match', 'error');
      return;
    }
    try {
      await apiCall('delete', `/libraries/${library.id}`, { confirm_name: library.name });
      setLibraries((rows) => rows.filter((row) => Number(row.id) !== Number(library.id)));
      onToast('Library deleted');
    } catch (err) {
      onToast(err.response?.data?.detail || err.response?.data?.error || 'Failed to delete library', 'error');
    }
  };

  const archiveLibrary = async (library) => {
    const phrase = `ARCHIVE ${library.name}`;
    const confirmName = window.prompt(
      `Archive "${library.name}"?\nType "${phrase}" to confirm archive:`
    );
    if (!confirmName) return;
    if (confirmName !== phrase) {
      onToast('Archive confirmation phrase did not match', 'error');
      return;
    }
    try {
      await apiCall('post', `/libraries/${library.id}/archive`, { confirm_name: library.name });
      setLibraries((rows) => rows.filter((row) => Number(row.id) !== Number(library.id)));
      onToast('Library archived');
    } catch (err) {
      onToast(err.response?.data?.detail || err.response?.data?.error || 'Failed to archive library', 'error');
    }
  };

  const transferLibrary = async (library) => {
    const targetUserId = Number(transferTargets[library.id] || 0);
    if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
      onToast('Select a new owner', 'error');
      return;
    }
    if (Number(targetUserId) === Number(library.created_by)) {
      onToast('Selected user already owns this library', 'error');
      return;
    }
    const transferPhrase = window.prompt(
      `Transfer "${library.name}" ownership?\nType "TRANSFER" to confirm.`
    );
    if (transferPhrase !== 'TRANSFER') {
      if (transferPhrase !== null) onToast('Transfer confirmation phrase did not match', 'error');
      return;
    }
    try {
      const result = await apiCall('post', `/libraries/${library.id}/transfer`, {
        new_owner_user_id: targetUserId
      });
      setLibraries((rows) => rows.map((row) => (
        Number(row.id) === Number(library.id)
          ? {
              ...row,
              created_by: result.new_owner_user_id,
              created_by_name: result.new_owner_name || row.created_by_name,
              created_by_email: result.new_owner_email || row.created_by_email
            }
          : row
      )));
      onToast('Library ownership transferred');
    } catch (err) {
      onToast(err.response?.data?.error || 'Failed to transfer ownership', 'error');
    }
  };

  const createPasswordReset = async () => {
    if (!selectedMemberId) return;
    setResetLoading(true);
    try {
      const data = await apiCall('post', `/admin/users/${selectedMemberId}/password-reset`);
      const link = data?.reset_url || '';
      setResetLink(link);
      if (link) onToast('Password reset link created');
      else onToast('Reset token created, but URL unavailable', 'info');
    } catch (err) {
      onToast(err.response?.data?.error || 'Failed to create reset link', 'error');
    } finally {
      setResetLoading(false);
    }
  };

  const invalidatePasswordResets = async () => {
    if (!selectedMemberId) return;
    if (!window.confirm('Invalidate all active password reset links for this member?')) return;
    setResetLoading(true);
    try {
      const data = await apiCall('post', `/admin/users/${selectedMemberId}/password-reset/invalidate`);
      setResetLink('');
      onToast(`Invalidated ${data?.invalidated_count ?? 0} reset link(s)`);
    } catch (err) {
      onToast(err.response?.data?.error || 'Failed to invalidate reset links', 'error');
    } finally {
      setResetLoading(false);
    }
  };

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      onToast('Copied');
    } catch {
      onToast('Copy failed', 'error');
    }
  };

  const activeInvites = useMemo(
    () => invites.filter((inv) => !inv.used && !inv.revoked && new Date(inv.expires_at).getTime() > Date.now()),
    [invites]
  );

  const displayInvites = showInviteHistory ? invites : activeInvites;

  if (loading) return <div className="p-6 flex items-center gap-3 text-dim"><Spinner />Loading…</div>;

  return (
    <>
      <div className="h-full overflow-y-auto p-6 space-y-6 max-w-5xl">
        <div className="space-y-3">
          <h1 className="section-title">Members</h1>
          <div className="tab-strip w-fit">
            <button type="button" className={cx('tab', activeTab === 'members' && 'active')} onClick={() => setActiveTab('members')}>
              Members ({users.length})
            </button>
            <button type="button" className={cx('tab', activeTab === 'invitations' && 'active')} onClick={() => setActiveTab('invitations')}>
              Invitations ({displayInvites.length})
            </button>
            <button type="button" className={cx('tab', activeTab === 'libraries' && 'active')} onClick={() => setActiveTab('libraries')}>
              Libraries ({libraries.length})
            </button>
          </div>
        </div>
        {loadError && <p className="text-sm text-err">{loadError}</p>}

        {activeTab === 'members' && (
          <div className="card divide-y divide-edge">
            {users.length === 0 && <p className="px-4 py-6 text-sm text-ghost text-center">No members found</p>}
            {users.map((u) => (
              <div key={u.id} onClick={() => setSelectedMemberId(u.id)} className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-raised/60 transition-colors">
                <div className="w-9 h-9 rounded-lg bg-raised border border-edge flex items-center justify-center text-dim font-display">
                  {u.name?.[0]?.toUpperCase() || '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink truncate">{u.name || 'Unnamed'}</p>
                  <p className="text-xs text-ghost truncate">{u.email}</p>
                </div>
                <select
                  className="select w-28"
                  value={pendingRoles[u.id] ?? u.role}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setPendingRoles((r) => ({ ...r, [u.id]: e.target.value }))}>
                  {USER_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                {pendingRoles[u.id] && pendingRoles[u.id] !== u.role && (
                  <button onClick={(e) => { e.stopPropagation(); saveRole(u.id); }} className="btn-primary btn-sm">Save</button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); deleteUser(u.id); }}
                  disabled={u.id === currentUserId}
                  className="btn-ghost btn-sm text-err hover:bg-err/10 disabled:opacity-30"
                  title={u.id === currentUserId ? 'You cannot delete your own account' : 'Delete member'}>
                  <Icons.Trash />
                </button>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'invitations' && (
          <div className="space-y-4">
            <form onSubmit={createInvite} className="flex gap-3 flex-wrap">
              <input className="input flex-1 min-w-[14rem]" type="email" placeholder="teammate@example.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} required />
              <button type="submit" className="btn-primary shrink-0">Create Invite</button>
            </form>
            <label className="inline-flex items-center gap-2 text-xs text-ghost cursor-pointer">
              <input type="checkbox" checked={showInviteHistory} onChange={(e) => setShowInviteHistory(e.target.checked)} />
              Show used/revoked/expired invitations
            </label>
            {inviteUrl && (
              <div className="card p-3 flex items-center gap-3">
                <code className="text-xs text-gold flex-1 truncate font-mono">{inviteUrl}</code>
                <button onClick={() => copy(inviteUrl)} className="btn-icon btn-sm shrink-0"><Icons.Copy /></button>
              </div>
            )}
            <div className="card divide-y divide-edge">
              {displayInvites.length === 0 && (
                <p className="px-4 py-6 text-sm text-ghost text-center">
                  {showInviteHistory ? 'No invitations yet' : 'No active invitations'}
                </p>
              )}
              {displayInvites.map((inv) => {
                const expired = new Date(inv.expires_at).getTime() <= Date.now();
                let status = 'Active';
                let statusClass = 'badge-ok';
                if (inv.used) {
                  status = 'Used';
                  statusClass = 'badge-dim';
                } else if (inv.revoked) {
                  status = 'Revoked';
                  statusClass = 'badge-err';
                } else if (expired) {
                  status = 'Expired';
                  statusClass = 'badge-warn';
                }
                return (
                  <div key={inv.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-ink truncate">{inv.email}</p>
                      <p className="text-xs text-ghost truncate">
                        Expires {new Date(inv.expires_at).toLocaleString()}
                        {inv.used_by_email ? ` · Claimed by ${inv.used_by_email}` : ''}
                      </p>
                    </div>
                    <span className={cx('badge', statusClass)}>{status}</span>
                    {!inv.used && !inv.revoked && !expired && (
                      <button onClick={() => revokeInvite(inv.id)} className="btn-danger btn-sm">Invalidate</button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'libraries' && (
          <div className="card divide-y divide-edge">
            <div className="px-4 py-3 bg-raised/60 border-b border-edge/70">
              <p className="text-xs text-ghost">
                Admin guardrails: transfer changes ownership, archive hides a library, delete permanently removes an empty library.
              </p>
            </div>
            {libraries.length === 0 && <p className="px-4 py-6 text-sm text-ghost text-center">No libraries found</p>}
            {libraries.map((library) => (
              <div key={library.id} className="px-4 py-3 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-ink font-medium truncate">{library.name}</p>
                    <p className="text-xs text-ghost truncate">
                      Owner: {library.created_by_name || library.created_by_email || 'Unassigned'} · Items: {library.item_count ?? 0}
                    </p>
                  </div>
                  <span className="badge badge-dim">#{library.id}</span>
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <select
                    className="select min-w-[12rem]"
                    value={transferTargets[library.id] ?? ''}
                    onChange={(e) => setTransferTargets((prev) => ({ ...prev, [library.id]: e.target.value }))}
                  >
                    <option value="">Transfer owner to…</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name || u.email} ({u.email})
                      </option>
                    ))}
                  </select>
                  <button className="btn-secondary btn-sm" onClick={() => transferLibrary(library)}>Transfer</button>
                  <button className="btn-secondary btn-sm" onClick={() => archiveLibrary(library)}>Archive</button>
                  <button className="btn-danger btn-sm" onClick={() => deleteLibrary(library)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedMemberId && (
        <>
          <div className="fixed inset-0 bg-void/70 z-40" onClick={() => setSelectedMemberId(null)} />
          <aside className="fixed top-0 right-0 h-full w-full max-w-md bg-abyss border-l border-edge z-50 overflow-y-auto">
            <div className="p-5 border-b border-edge flex items-start gap-3">
              <div className="flex-1">
                <h2 className="font-display text-2xl tracking-wider text-ink">Member Details</h2>
                {memberSummary?.user?.email && <p className="text-xs text-ghost mt-1">{memberSummary.user.email}</p>}
              </div>
              <button onClick={() => setSelectedMemberId(null)} className="btn-icon btn-sm"><Icons.X /></button>
            </div>
            <div className="p-5 space-y-4">
              {summaryLoading && (
                <div className="flex items-center gap-3 text-dim"><Spinner />Loading member details…</div>
              )}
              {!summaryLoading && memberSummary && (
                <>
                  <div className="card p-4 space-y-2">
                    <p className="text-xs text-ghost">Name</p>
                    <p className="text-sm text-ink font-medium">{memberSummary.user?.name || 'Unnamed'}</p>
                    <p className="text-xs text-ghost mt-3">Role</p>
                    <span className="badge badge-dim">{memberSummary.user?.role || 'user'}</span>
                    <p className="text-xs text-ghost mt-3">Created</p>
                    <p className="text-sm text-ink">{memberSummary.user?.created_at ? new Date(memberSummary.user.created_at).toLocaleString() : '—'}</p>
                  </div>

                  <div className="card p-4 space-y-3">
                    <p className="text-xs text-ghost">Password reset</p>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={createPasswordReset} disabled={resetLoading} className="btn-secondary btn-sm">
                        {resetLoading ? <Spinner size={14} /> : 'Generate reset link'}
                      </button>
                      <button type="button" onClick={invalidatePasswordResets} disabled={resetLoading} className="btn-danger btn-sm">
                        Invalidate active links
                      </button>
                    </div>
                    {resetLink && (
                      <div className="flex items-center gap-2">
                        <code className="text-xs text-gold flex-1 truncate font-mono">{resetLink}</code>
                        <button onClick={() => copy(resetLink)} className="btn-icon btn-sm shrink-0"><Icons.Copy /></button>
                      </div>
                    )}
                  </div>

                  <div className="card p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-ghost">Last login</p>
                      <p className="text-sm text-ink">{memberSummary.metrics?.lastLoginAt ? new Date(memberSummary.metrics.lastLoginAt).toLocaleString() : 'Never'}</p>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-ghost">Library additions</p>
                      <p className="text-sm text-ink">{memberSummary.metrics?.additionsCount ?? 0}</p>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-ghost">Last media edit</p>
                      <p className="text-sm text-ink">{memberSummary.metrics?.lastMediaEditAt ? new Date(memberSummary.metrics.lastMediaEditAt).toLocaleString() : '—'}</p>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-ghost">Contribution score</p>
                      <p className="text-sm text-ink font-medium">{memberSummary.metrics?.contributionScore ?? 0}</p>
                    </div>
                  </div>
                </>
              )}
              {!summaryLoading && !memberSummary && (
                <p className="text-sm text-err">Failed to load member details.</p>
              )}
            </div>
          </aside>
        </>
      )}
    </>
  );
}
