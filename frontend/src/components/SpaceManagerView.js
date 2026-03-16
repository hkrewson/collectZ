import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

function formatDateTime(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString();
}

function createEmptySpaceForm() {
  return { name: '', slug: '', description: '' };
}

export default function SpaceManagerView({
  apiCall,
  onToast,
  spaces,
  activeSpace,
  activeSpaceId,
  activeMembershipRole,
  libraries,
  activeLibraryId,
  onScopeRefresh,
  Icons,
  Spinner,
  cx
}) {
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'member', expose_token: true });
  const [inviteUrl, setInviteUrl] = useState('');
  const [editingSpace, setEditingSpace] = useState(() => createEmptySpaceForm());
  const [savingSpace, setSavingSpace] = useState(false);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [memberBusyId, setMemberBusyId] = useState(null);
  const [showInviteHistory, setShowInviteHistory] = useState(false);
  const memberLoadSeqRef = useRef(0);
  const inviteLoadSeqRef = useRef(0);

  const canManage = ['owner', 'admin'].includes(activeMembershipRole);

  useEffect(() => {
    setEditingSpace({
      name: activeSpace?.name || '',
      slug: activeSpace?.slug || '',
      description: activeSpace?.description || ''
    });
  }, [activeSpace]);

  const assignableRoles = useMemo(() => {
    if (activeMembershipRole === 'owner') return ['admin', 'member', 'viewer'];
    if (activeMembershipRole === 'admin') return ['member', 'viewer'];
    return ['member'];
  }, [activeMembershipRole]);

  useEffect(() => {
    setMembers([]);
    setInvites([]);
    setInviteUrl('');
    setShowInviteHistory(false);
    setLoadError('');
    setLoading(Boolean(activeSpaceId && canManage));
  }, [activeSpaceId, canManage]);

  const loadMembers = useCallback(async () => {
    const requestSeq = ++memberLoadSeqRef.current;
    if (!activeSpaceId || !canManage) {
      setMembers([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError('');
    setMembers([]);
    const requestConfig = {
      params: { _space: activeSpaceId, _ts: Date.now() },
      headers: { 'cache-control': 'no-cache', pragma: 'no-cache' }
    };
    const membersRes = await Promise.resolve(apiCall('get', `/spaces/${activeSpaceId}/members`, null, requestConfig))
      .then((value) => ({ status: 'fulfilled', value }))
      .catch((reason) => ({ status: 'rejected', reason }));

    if (requestSeq !== memberLoadSeqRef.current) {
      return;
    }

    if (membersRes.status === 'fulfilled') {
      setMembers(Array.isArray(membersRes.value?.members) ? membersRes.value.members : []);
    } else {
      setLoadError('Failed to load space members.');
    }

    setLoading(false);
  }, [activeSpaceId, apiCall, canManage]);

  const loadInvites = useCallback(async () => {
    const requestSeq = ++inviteLoadSeqRef.current;
    if (!activeSpaceId || !canManage) {
      setInvites([]);
      return;
    }

    setInvites([]);
    const requestConfig = {
      params: { _space: activeSpaceId, _ts: Date.now() },
      headers: { 'cache-control': 'no-cache', pragma: 'no-cache' }
    };
    const invitesRes = await Promise.resolve(apiCall('get', `/spaces/${activeSpaceId}/invites`, null, requestConfig))
      .then((value) => ({ status: 'fulfilled', value }))
      .catch((reason) => ({ status: 'rejected', reason }));

    if (requestSeq !== inviteLoadSeqRef.current) {
      return;
    }

    if (invitesRes.status === 'fulfilled') {
      const responseSpaceId = Number(invitesRes.value?.space?.id || 0) || null;
      if (responseSpaceId !== Number(activeSpaceId)) {
        return;
      }
      setInvites(Array.isArray(invitesRes.value?.invites) ? invitesRes.value.invites : []);
    } else {
      setLoadError((prev) => (prev ? `${prev} Failed to load invites.` : 'Failed to load invites.'));
    }
  }, [activeSpaceId, apiCall, canManage]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    loadInvites();
  }, [loadInvites]);

  const copy = useCallback(async (text) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      onToast('Copied');
    } catch (_) {
      onToast('Copy failed', 'error');
    }
  }, [onToast]);

  const saveSpace = async (event) => {
    event.preventDefault();
    if (!activeSpaceId) return;
    setSavingSpace(true);
    try {
      await apiCall('patch', `/spaces/${activeSpaceId}`, editingSpace);
      await onScopeRefresh?.({ silent: true });
      await Promise.all([loadMembers(), loadInvites()]);
      onToast('Space updated');
    } catch (error) {
      onToast(error.response?.data?.error || 'Failed to update space', 'error');
    } finally {
      setSavingSpace(false);
    }
  };

  const createInvite = async (event) => {
    event.preventDefault();
    if (!activeSpaceId) return;
    setCreatingInvite(true);
    try {
      const payload = await apiCall('post', `/spaces/${activeSpaceId}/invites`, inviteForm);
      const url = payload?.invite_url || (payload?.token
        ? `${window.location.origin}/register?invite=${encodeURIComponent(payload.token)}&email=${encodeURIComponent(payload.email)}`
        : '');
      setInviteUrl(url);
      setInvites((prev) => [payload, ...prev]);
      setInviteForm({ email: '', role: 'member', expose_token: true });
      onToast(payload?.delivery?.sent ? 'Invite sent' : 'Invite created', payload?.delivery?.sent ? 'ok' : 'info');
    } catch (error) {
      onToast(error.response?.data?.error || 'Failed to create invite', 'error');
    } finally {
      setCreatingInvite(false);
    }
  };

  const revokeInvite = async (inviteId) => {
    if (!window.confirm('Invalidate this space invite?')) return;
    try {
      const payload = await apiCall('patch', `/spaces/${activeSpaceId}/invites/${inviteId}/revoke`);
      setInvites((prev) => prev.map((invite) => (invite.id === inviteId ? { ...invite, ...payload } : invite)));
      onToast('Invite revoked');
    } catch (error) {
      onToast(error.response?.data?.error || 'Failed to revoke invite', 'error');
    }
  };

  const updateMemberRole = async (memberId, role) => {
    setMemberBusyId(memberId);
    try {
      const payload = await apiCall('patch', `/spaces/${activeSpaceId}/members/${memberId}`, { role });
      setMembers((prev) => prev.map((member) => (member.id === memberId ? { ...member, ...payload } : member)));
      await onScopeRefresh?.({ silent: true });
      onToast('Membership updated');
    } catch (error) {
      onToast(error.response?.data?.error || 'Failed to update member', 'error');
    } finally {
      setMemberBusyId(null);
    }
  };

  const removeMember = async (memberId) => {
    if (!window.confirm('Remove this member from the space?')) return;
    setMemberBusyId(memberId);
    try {
      await apiCall('delete', `/spaces/${activeSpaceId}/members/${memberId}`);
      setMembers((prev) => prev.filter((member) => member.id !== memberId));
      onToast('Member removed');
    } catch (error) {
      const detail = error.response?.data?.detail;
      onToast(detail || error.response?.data?.error || 'Failed to remove member', 'error');
    } finally {
      setMemberBusyId(null);
    }
  };

  const visibleInvites = useMemo(() => {
    if (showInviteHistory) return invites;
    return invites.filter((invite) => !invite.used && !invite.revoked && new Date(invite.expires_at).getTime() > Date.now());
  }, [invites, showInviteHistory]);

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="section-title">Space Control</h1>
          <p className="text-sm text-ghost mt-2 max-w-3xl">
            Switch active scope and manage the current space only when you are an owner or admin of that space.
          </p>
        </div>
        <div className="card p-4 min-w-[260px]">
          <p className="text-xs uppercase tracking-[0.18em] text-ghost">Current Scope</p>
          <p className="mt-2 text-lg font-medium text-ink">{activeSpace?.name || 'No active space'}</p>
          <p className="text-sm text-ghost">{activeSpace?.description || 'Select a space from the sidebar to continue.'}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="badge badge-dim">{activeMembershipRole || 'no membership role'}</span>
            {activeLibraryId ? <span className="badge badge-dim">library #{activeLibraryId}</span> : null}
            <span className="badge badge-dim">{spaces.length} accessible space{spaces.length === 1 ? '' : 's'}</span>
            <span className="badge badge-dim">{libraries.length} visible librar{libraries.length === 1 ? 'y' : 'ies'}</span>
          </div>
        </div>
      </div>

      {!canManage && (
        <div className="card p-5">
          <p className="text-sm text-ghost">
            The active space can be viewed, but only its owner or admins can manage members, invites, and settings here.
          </p>
        </div>
      )}

      {loadError ? <div className="card p-4 text-sm text-err">{loadError}</div> : null}

      {canManage && (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <form className="card p-5 space-y-4" onSubmit={saveSpace}>
              <div>
                <h2 className="text-xl font-medium text-ink">Space Details</h2>
                <p className="text-sm text-ghost mt-1">Update the active space name, slug, and description without leaving the tenancy workspace.</p>
              </div>
              <label className="field">
                <span className="label">Name</span>
                <input className="input" value={editingSpace.name} onChange={(e) => setEditingSpace((prev) => ({ ...prev, name: e.target.value }))} required />
              </label>
              <label className="field">
                <span className="label">Slug</span>
                <input className="input" value={editingSpace.slug || ''} onChange={(e) => setEditingSpace((prev) => ({ ...prev, slug: e.target.value }))} />
              </label>
              <label className="field">
                <span className="label">Description</span>
                <textarea className="textarea min-h-[104px]" value={editingSpace.description || ''} onChange={(e) => setEditingSpace((prev) => ({ ...prev, description: e.target.value }))} />
              </label>
              <div className="flex justify-end">
                <button type="submit" className="btn-primary min-w-[120px]" disabled={savingSpace}>
                  {savingSpace ? <Spinner size={14} /> : 'Save Space'}
                </button>
              </div>
            </form>

            <form className="card p-5 space-y-4" onSubmit={createInvite}>
              <div>
                <h2 className="text-xl font-medium text-ink">Scoped Invites</h2>
                <p className="text-sm text-ghost mt-1">Invite users directly into this space with the role they should receive on first login.</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="field md:col-span-2">
                  <span className="label">Email</span>
                  <input className="input" type="email" value={inviteForm.email} onChange={(e) => setInviteForm((prev) => ({ ...prev, email: e.target.value }))} required />
                </label>
                <label className="field">
                  <span className="label">Role</span>
                  <select className="select" value={inviteForm.role} onChange={(e) => setInviteForm((prev) => ({ ...prev, role: e.target.value }))}>
                    {assignableRoles.map((role) => <option key={role} value={role}>{role}</option>)}
                  </select>
                </label>
                <label className="field justify-end">
                  <span className="label">Copy Link</span>
                  <label className="inline-flex items-center gap-2 text-sm text-dim">
                    <input type="checkbox" checked={Boolean(inviteForm.expose_token)} onChange={(e) => setInviteForm((prev) => ({ ...prev, expose_token: e.target.checked }))} />
                    Expose invite URL
                  </label>
                </label>
              </div>
              {inviteUrl ? (
                <div className="card-raised p-3 flex items-center gap-3">
                  <code className="flex-1 text-xs text-gold font-mono truncate">{inviteUrl}</code>
                  <button type="button" className="btn-icon btn-sm shrink-0" onClick={() => copy(inviteUrl)}><Icons.Copy /></button>
                </div>
              ) : null}
              <div className="flex justify-between items-center gap-3">
                <label className="inline-flex items-center gap-2 text-xs text-ghost">
                  <input type="checkbox" checked={showInviteHistory} onChange={(e) => setShowInviteHistory(e.target.checked)} />
                  Show invite history
                </label>
                <button type="submit" className="btn-primary min-w-[120px]" disabled={creatingInvite}>
                  {creatingInvite ? <Spinner size={14} /> : 'Create Invite'}
                </button>
              </div>
            </form>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1.35fr,1fr] gap-6">
            <div className="card overflow-hidden">
              <div className="px-5 py-4 border-b border-edge flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-medium text-ink">Memberships</h2>
                  <p className="text-sm text-ghost mt-1">Owners and admins for this space can manage only this roster.</p>
                </div>
                {loading ? <Spinner size={16} /> : <span className="badge badge-dim">{members.length} member{members.length === 1 ? '' : 's'}</span>}
              </div>
              <div className="divide-y divide-edge">
                {!loading && members.length === 0 ? <p className="px-5 py-8 text-sm text-ghost text-center">No members found for this space.</p> : null}
                {members.map((member) => (
                  <div key={member.id} className="px-5 py-4 flex flex-wrap items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-raised border border-edge flex items-center justify-center text-dim font-display">
                      {member.name?.[0]?.toUpperCase() || member.email?.[0]?.toUpperCase() || '?'}
                    </div>
                    <div className="min-w-[180px] flex-1">
                      <p className="text-sm font-medium text-ink">{member.name || 'Unnamed user'}</p>
                      <p className="text-xs text-ghost">{member.email}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="badge badge-dim text-[10px]">app {member.user_role}</span>
                      <select
                        className="select min-w-[120px]"
                        value={member.role}
                        disabled={memberBusyId === member.id || member.role === 'owner'}
                        onChange={(e) => updateMemberRole(member.id, e.target.value)}
                      >
                        {(member.role === 'owner' ? ['owner'] : assignableRoles).map((role) => (
                          <option key={role} value={role}>{role}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn-ghost btn-sm text-err hover:bg-err/10"
                        disabled={memberBusyId === member.id}
                        onClick={() => removeMember(member.id)}
                      >
                        {memberBusyId === member.id ? <Spinner size={12} /> : <Icons.Trash />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card overflow-hidden">
              <div className="px-5 py-4 border-b border-edge">
                <h2 className="text-xl font-medium text-ink">Invite Queue</h2>
                <p className="text-sm text-ghost mt-1">Review live and historical invites scoped to this space.</p>
              </div>
              <div className="divide-y divide-edge">
                {!loading && visibleInvites.length === 0 ? <p className="px-5 py-8 text-sm text-ghost text-center">No invites to show.</p> : null}
                {visibleInvites.map((invite) => {
                  const expired = new Date(invite.expires_at).getTime() <= Date.now();
                  return (
                    <div key={invite.id} className="px-5 py-4 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-ink">{invite.email}</p>
                          <p className="text-xs text-ghost">
                            {invite.space_role || 'member'} · expires {formatDateTime(invite.expires_at)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={cx('badge text-[10px]', invite.used ? 'badge-dim' : invite.revoked ? 'badge-err' : expired ? 'badge-warn' : 'badge-ok')}>
                            {invite.used ? 'Used' : invite.revoked ? 'Revoked' : expired ? 'Expired' : 'Active'}
                          </span>
                          {!invite.used && !invite.revoked && !expired ? (
                            <button type="button" className="btn-ghost btn-sm text-err hover:bg-err/10" onClick={() => revokeInvite(invite.id)}>
                              Revoke
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

        </>
      )}
    </div>
  );
}
