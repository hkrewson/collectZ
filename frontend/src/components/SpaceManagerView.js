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
  const [peopleTab, setPeopleTab] = useState('members');
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
    setPeopleTab('members');
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
    <div className="h-full overflow-y-auto p-4 sm:p-6 space-y-8">
      <div>
        <div>
          <h1 className="section-title">Space</h1>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="badge badge-dim">{activeMembershipRole || 'no membership role'}</span>
            {activeLibraryId ? <span className="badge badge-dim">library #{activeLibraryId}</span> : null}
            <span className="badge badge-dim">{spaces.length} accessible space{spaces.length === 1 ? '' : 's'}</span>
            <span className="badge badge-dim">{libraries.length} visible librar{libraries.length === 1 ? 'y' : 'ies'}</span>
          </div>
        </div>
      </div>

      {!canManage && (
        <div>
          <p className="text-sm text-ghost">
            The active space can be viewed, but only its owner or admins can manage members, invites, and settings here.
          </p>
        </div>
      )}

      {loadError ? <div className="text-sm text-err">{loadError}</div> : null}

      {canManage && (
        <>
          <div className="max-w-2xl">
            <form className="space-y-4" onSubmit={saveSpace}>
              <div>
                <h2 className="text-xl font-medium text-ink">General</h2>
                <p className="text-sm text-ghost mt-1">Update your Space&apos;s name.</p>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <label className="field min-w-[240px] flex-1">
                  <span className="label">Name</span>
                  <input className="input" value={editingSpace.name} onChange={(e) => setEditingSpace((prev) => ({ ...prev, name: e.target.value }))} required />
                </label>
                <button type="submit" className="btn-primary min-w-[120px] shrink-0" disabled={savingSpace}>
                  {savingSpace ? <Spinner size={14} /> : 'Save Space'}
                </button>
              </div>
            </form>
          </div>

          <div className="space-y-4">
            <div className="tab-strip w-fit">
              <button
                type="button"
                className={cx('tab', peopleTab === 'members' && 'active')}
                onClick={() => setPeopleTab('members')}
              >
                Members
              </button>
              <button
                type="button"
                className={cx('tab', peopleTab === 'invitations' && 'active')}
                onClick={() => setPeopleTab('invitations')}
              >
                Invitations
              </button>
            </div>

            {peopleTab === 'members' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-medium text-ink">Members</h2>
                  <p className="text-sm text-ghost mt-1">Change roles or remove members.</p>
                </div>
                {loading ? <Spinner size={16} /> : <span className="badge badge-dim">{members.length} member{members.length === 1 ? '' : 's'}</span>}
              </div>
              <div className="space-y-1">
                {!loading && members.length === 0 ? <p className="py-8 text-sm text-ghost text-center">No members found for this space.</p> : null}
                {members.map((member) => (
                  <div
                    key={member.id}
                    className="py-4 flex flex-wrap items-center gap-4"
                  >
                    <div className="w-10 h-10 rounded-lg bg-raised border border-edge flex items-center justify-center text-dim font-display">
                      {member.name?.[0]?.toUpperCase() || member.email?.[0]?.toUpperCase() || '?'}
                    </div>
                    <div className="min-w-[220px] flex-1">
                      <p className="text-sm font-medium text-ink">{member.name || 'Unnamed user'}</p>
                      <p className="text-xs text-ghost">{member.email}</p>
                    </div>
                    <div className="min-w-[120px]">
                      <p className="text-[11px] uppercase tracking-wide text-ghost">App Role</p>
                      <p className="text-sm text-ink">{member.user_role || 'user'}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-ghost mb-1">Space Role</p>
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
                      </div>
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
            )}

            {peopleTab === 'invitations' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-medium text-ink">Invitations</h2>
                <p className="text-sm text-ghost mt-1">Review live and historical invites scoped to this space.</p>
              </div>
              <form className="space-y-4" onSubmit={createInvite}>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="field min-w-[220px] flex-1">
                    <span className="label">Email</span>
                    <input className="input" type="email" value={inviteForm.email} onChange={(e) => setInviteForm((prev) => ({ ...prev, email: e.target.value }))} required />
                  </label>
                  <label className="field w-[150px] shrink-0">
                    <span className="label">Role</span>
                    <select className="select" value={inviteForm.role} onChange={(e) => setInviteForm((prev) => ({ ...prev, role: e.target.value }))}>
                      {assignableRoles.map((role) => <option key={role} value={role}>{role}</option>)}
                    </select>
                  </label>
                  <div className="flex items-end gap-2 shrink-0">
                    <button
                      type="button"
                      className={cx(
                        'btn-icon btn-sm',
                        inviteForm.expose_token && 'bg-raised border-muted text-ink'
                      )}
                      aria-pressed={Boolean(inviteForm.expose_token)}
                      title={inviteForm.expose_token ? 'Copy-link enabled' : 'Copy-link disabled'}
                      onClick={() => setInviteForm((prev) => ({ ...prev, expose_token: !prev.expose_token }))}
                    >
                      <Icons.Link />
                    </button>
                    <button type="submit" className="btn-primary min-w-[120px]" disabled={creatingInvite}>
                      {creatingInvite ? <Spinner size={14} /> : 'Create Invite'}
                    </button>
                  </div>
                </div>
                {inviteUrl ? (
                  <div className="p-3 flex items-center gap-3 bg-raised rounded-lg border border-edge">
                    <code className="flex-1 text-xs text-gold font-mono truncate">{inviteUrl}</code>
                    <button type="button" className="btn-icon btn-sm shrink-0" onClick={() => copy(inviteUrl)}><Icons.Copy /></button>
                  </div>
                ) : null}
                <div className="flex justify-between items-center gap-3">
                  <label className="inline-flex items-center gap-2 text-xs text-ghost">
                    <input type="checkbox" checked={showInviteHistory} onChange={(e) => setShowInviteHistory(e.target.checked)} />
                    Show invite history
                  </label>
                  <span className="text-xs text-ghost">{inviteForm.expose_token ? 'Copy-link enabled' : 'Email-only invite'}</span>
                </div>
              </form>
              <div className="space-y-1">
                {!loading && visibleInvites.length === 0 ? <p className="py-8 text-sm text-ghost text-center">No invites to show.</p> : null}
                {visibleInvites.map((invite) => {
                  const expired = new Date(invite.expires_at).getTime() <= Date.now();
                  return (
                    <div key={invite.id} className="py-4 flex flex-wrap items-center gap-4">
                      <div className="w-10 h-10 rounded-lg bg-raised border border-edge flex items-center justify-center text-dim font-display">
                        {invite.email?.[0]?.toUpperCase() || '?'}
                      </div>
                      <div className="min-w-[220px] flex-1">
                        <p className="text-sm font-medium text-ink">{invite.email}</p>
                        <p className="text-xs text-ghost">expires {formatDateTime(invite.expires_at)}</p>
                      </div>
                      <div className="min-w-[120px]">
                        <p className="text-[11px] uppercase tracking-wide text-ghost">Role</p>
                        <p className="text-sm text-ink">{invite.space_role || 'member'}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div>
                          <p className="text-[11px] uppercase tracking-wide text-ghost mb-1">Status</p>
                          <span className={cx('badge text-[10px]', invite.used ? 'badge-dim' : invite.revoked ? 'badge-err' : expired ? 'badge-warn' : 'badge-ok')}>
                            {invite.used ? 'Used' : invite.revoked ? 'Revoked' : expired ? 'Expired' : 'Active'}
                          </span>
                        </div>
                        {!invite.used && !invite.revoked && !expired ? (
                          <button
                            type="button"
                            className="btn-ghost btn-sm text-err hover:bg-err/10"
                            onClick={() => revokeInvite(invite.id)}
                          >
                            Revoke
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            )}
          </div>

        </>
      )}
    </div>
  );
}
