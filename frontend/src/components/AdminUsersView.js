import React, { useCallback, useEffect, useState } from 'react';

const USER_ROLES = ['admin', 'user', 'viewer'];

export default function AdminUsersView({ apiCall, onToast, currentUserId, Icons, Spinner }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [pendingRoles, setPendingRoles] = useState({});
  const [selectedMemberId, setSelectedMemberId] = useState(null);
  const [memberSummary, setMemberSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [resetLink, setResetLink] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  const loadMembersData = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const usersRes = await apiCall('get', '/admin/users');
      setUsers(Array.isArray(usersRes) ? usersRes : []);
    } catch (_) {
      setLoadError('Failed to load members.');
    }
    setLoading(false);
  }, [apiCall]);

  useEffect(() => {
    loadMembersData();
  }, [loadMembersData]);

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
    return () => {
      active = false;
    };
  }, [apiCall, selectedMemberId]);

  const saveRole = async (id) => {
    const role = pendingRoles[id];
    if (!role) return;
    try {
      await apiCall('patch', `/admin/users/${id}/role`, { role });
      setUsers((items) => items.map((item) => (item.id === id ? { ...item, role } : item)));
      setPendingRoles((pending) => {
        const next = { ...pending };
        delete next[id];
        return next;
      });
      onToast('Role updated');
      if (selectedMemberId === id) {
        setMemberSummary((prev) => (prev ? { ...prev, user: { ...prev.user, role } } : prev));
      }
    } catch (error) {
      onToast(error.response?.data?.error || 'Failed', 'error');
    }
  };

  const deleteUser = async (id) => {
    if (!window.confirm('Delete this member? This cannot be undone.')) return;
    try {
      await apiCall('delete', `/admin/users/${id}`);
      setUsers((items) => items.filter((item) => item.id !== id));
      if (selectedMemberId === id) setSelectedMemberId(null);
      onToast('Member deleted');
    } catch (error) {
      onToast(error.response?.data?.error || 'Failed', 'error');
    }
  };

  const createPasswordReset = async (exposeToken = false) => {
    if (!selectedMemberId) return;
    setResetLoading(true);
    try {
      const data = await apiCall('post', `/admin/users/${selectedMemberId}/password-reset`, { expose_token: exposeToken });
      const link = data?.reset_url || '';
      setResetLink(link);
      if (data?.delivery?.sent) onToast('Password reset email sent');
      else if (link) onToast('Password reset link created (copy-link fallback)', 'info');
      else onToast('Password reset created but no copy-link available', 'info');
    } catch (error) {
      onToast(error.response?.data?.error || 'Failed to create reset link', 'error');
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
    } catch (error) {
      onToast(error.response?.data?.error || 'Failed to invalidate reset links', 'error');
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

  if (loading) return <div className="p-6 flex items-center gap-3 text-dim"><Spinner />Loading…</div>;

  return (
    <>
      <div className="h-full overflow-y-auto p-6 space-y-6 max-w-5xl">
        <div className="space-y-3">
          <h1 className="section-title">Members</h1>
          <p className="text-sm text-ghost max-w-3xl">
            Platform-level member administration. Tenant invites and space governance live in the space-specific controls, not in this server-admin screen.
          </p>
        </div>
        {loadError && <p className="text-sm text-err">{loadError}</p>}

        <div className="card divide-y divide-edge">
          {users.length === 0 && <p className="px-4 py-6 text-sm text-ghost text-center">No members found</p>}
          {users.map((user) => (
            <div key={user.id} onClick={() => setSelectedMemberId(user.id)} className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-raised/60 transition-colors">
              <div className="w-9 h-9 rounded-lg bg-raised border border-edge flex items-center justify-center text-dim font-display">
                {user.name?.[0]?.toUpperCase() || '?'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink truncate">{user.name || 'Unnamed'}</p>
                <p className="text-xs text-ghost truncate">{user.email}</p>
              </div>
              <select
                className="select w-28"
                value={pendingRoles[user.id] ?? user.role}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => setPendingRoles((pending) => ({ ...pending, [user.id]: event.target.value }))}
              >
                {USER_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
              {pendingRoles[user.id] && pendingRoles[user.id] !== user.role && (
                <button onClick={(event) => { event.stopPropagation(); saveRole(user.id); }} className="btn-primary btn-sm">Save</button>
              )}
              <button
                onClick={(event) => { event.stopPropagation(); deleteUser(user.id); }}
                disabled={user.id === currentUserId}
                className="btn-ghost btn-sm text-err hover:bg-err/10 disabled:opacity-30"
                title={user.id === currentUserId ? 'You cannot delete your own account' : 'Delete member'}
              >
                <Icons.Trash />
              </button>
            </div>
          ))}
        </div>
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
                      <button type="button" onClick={() => createPasswordReset(false)} disabled={resetLoading} className="btn-secondary btn-sm">
                        {resetLoading ? <Spinner size={14} /> : 'Email reset link'}
                      </button>
                      <button type="button" onClick={() => createPasswordReset(true)} disabled={resetLoading} className="btn-secondary btn-sm">
                        {resetLoading ? <Spinner size={14} /> : 'Create copy link'}
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
                      <p className="text-xs text-ghost">Space memberships</p>
                      <p className="text-sm text-ink">{memberSummary.metrics?.membershipCount ?? 0}</p>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-ghost">Owned spaces</p>
                      <p className="text-sm text-ink">{memberSummary.metrics?.ownerCount ?? 0}</p>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-ghost">Space-admin roles</p>
                      <p className="text-sm text-ink">{memberSummary.metrics?.adminCount ?? 0}</p>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-ghost">Active scope</p>
                      <p className="text-sm text-ink font-mono">
                        s:{memberSummary.user?.active_space_id ?? '—'} / l:{memberSummary.user?.active_library_id ?? '—'}
                      </p>
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
