import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckboxControl, SectionTabs } from './app/AppPrimitives';
import ActivityFeedView from './ActivityFeedView';
import AdminIntegrationsView from './AdminIntegrationsView';
import AdminSettingsView from './AdminSettingsView';

function formatDateTime(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString();
}

function createEmptySpaceForm() {
  return { name: '' };
}

function KebabIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-current">
      <circle cx="4" cy="10" r="1.6" />
      <circle cx="10" cy="10" r="1.6" />
      <circle cx="16" cy="10" r="1.6" />
    </svg>
  );
}

export default function SpaceManagerView({
  apiCall,
  onToast,
  activeSpace,
  activeSpaceId,
  activeMembershipRole,
  onScopeRefresh,
  onSettingsChange,
  Icons,
  Spinner,
  cx,
  onTimelineNavigate = null
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
  const [memberResetLink, setMemberResetLink] = useState('');
  const [memberResetLabel, setMemberResetLabel] = useState('Workspace password reset link');
  const [showInviteHistory, setShowInviteHistory] = useState(false);
  const [managerTab, setManagerTab] = useState('settings');
  const [peopleTab, setPeopleTab] = useState('members');
  const [openMemberMenuId, setOpenMemberMenuId] = useState(null);
  const [inviteStatusNow, setInviteStatusNow] = useState(() => Date.now());
  const memberLoadSeqRef = useRef(0);
  const inviteLoadSeqRef = useRef(0);

  const canManage = ['owner', 'admin'].includes(activeMembershipRole);

  useEffect(() => {
    // The workspace settings form mirrors the currently selected workspace.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditingSpace({
      name: activeSpace?.name || ''
    });
  }, [activeSpace]);

  const assignableRoles = useMemo(() => {
    if (activeMembershipRole === 'owner') return ['admin', 'member', 'viewer'];
    if (activeMembershipRole === 'admin') return ['member', 'viewer'];
    return ['member'];
  }, [activeMembershipRole]);

  useEffect(() => {
    // Active workspace or permission changes reset workspace-management local state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMembers([]);
    setInvites([]);
    setInviteUrl('');
    setMemberResetLink('');
    setMemberResetLabel('Workspace password reset link');
    setShowInviteHistory(false);
    setManagerTab(canManage ? 'settings' : 'activity');
    setPeopleTab('members');
    setOpenMemberMenuId(null);
    setLoadError('');
    setLoading(Boolean(activeSpaceId && canManage));
    setInviteStatusNow(Date.now());
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
      setLoadError('Failed to load workspace members.');
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
    // Members are backend-owned workspace state keyed by the active scope.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    // Invites are backend-owned workspace state keyed by the active scope.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      onToast('Workspace updated');
    } catch (error) {
      onToast(error.response?.data?.error || 'Failed to update workspace', 'error');
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
    if (!window.confirm('Invalidate this workspace invite?')) return;
    try {
      const payload = await apiCall('patch', `/spaces/${activeSpaceId}/invites/${inviteId}/revoke`);
      setInvites((prev) => prev.map((invite) => (invite.id === inviteId ? { ...invite, ...payload } : invite)));
      onToast('Invite revoked');
    } catch (error) {
      onToast(error.response?.data?.error || 'Failed to revoke invite', 'error');
    }
  };

  const createMemberPasswordReset = async (member, exposeToken = false) => {
    if (!activeSpaceId || !member?.id) return;
    setMemberBusyId(member.id);
    try {
      const payload = await apiCall('post', `/spaces/${activeSpaceId}/members/${member.id}/password-reset`, {
        expose_token: exposeToken
      });
      const link = payload?.reset_url || '';
      setMemberResetLink(link);
      setMemberResetLabel(`Password reset for ${member.email}`);
      setOpenMemberMenuId((prev) => (Number(prev) === Number(member.id) ? null : prev));
      if (payload?.delivery?.sent) onToast('Password reset email sent');
      else if (link) onToast('Password reset link created', 'info');
      else onToast('Password reset created but no copy-link available', 'info');
    } catch (error) {
      onToast(error.response?.data?.error || 'Failed to create password reset link', 'error');
    } finally {
      setMemberBusyId(null);
    }
  };

  const updateMemberRole = async (memberId, role) => {
    setMemberBusyId(memberId);
    try {
      const payload = await apiCall('patch', `/spaces/${activeSpaceId}/members/${memberId}`, { role });
      setMembers((prev) => prev.map((member) => (member.id === memberId ? { ...member, ...payload } : member)));
      setOpenMemberMenuId((prev) => (Number(prev) === Number(memberId) ? null : prev));
      await onScopeRefresh?.({ silent: true });
      onToast('Membership updated');
    } catch (error) {
      onToast(error.response?.data?.error || 'Failed to update member', 'error');
    } finally {
      setMemberBusyId(null);
    }
  };

  const updateMemberSuspension = async (memberId, suspended) => {
    const confirmationMessage = suspended
      ? 'Suspend this member from the workspace? They will lose access until restored.'
      : 'Restore this member to the workspace?';
    if (!window.confirm(confirmationMessage)) return;
    setMemberBusyId(memberId);
    try {
      const payload = await apiCall('patch', `/spaces/${activeSpaceId}/members/${memberId}/suspension`, { suspended });
      setMembers((prev) => prev.map((member) => (member.id === memberId ? { ...member, ...payload } : member)));
      setOpenMemberMenuId((prev) => (Number(prev) === Number(memberId) ? null : prev));
      await onScopeRefresh?.({ silent: true });
      onToast(suspended ? 'Member suspended' : 'Member restored');
    } catch (error) {
      onToast(error.response?.data?.error || (suspended ? 'Failed to suspend member' : 'Failed to restore member'), 'error');
    } finally {
      setMemberBusyId(null);
    }
  };

  const removeMember = async (memberId) => {
    if (!window.confirm('Remove this member from the workspace? Their content stays here, but they will lose access.')) return;
    setMemberBusyId(memberId);
    try {
      await apiCall('delete', `/spaces/${activeSpaceId}/members/${memberId}`);
      setMembers((prev) => prev.filter((member) => member.id !== memberId));
      setOpenMemberMenuId((prev) => (Number(prev) === Number(memberId) ? null : prev));
      onToast('Member removed from workspace');
    } catch (error) {
      const detail = error.response?.data?.detail;
      onToast(detail || error.response?.data?.error || 'Failed to remove member', 'error');
    } finally {
      setMemberBusyId(null);
    }
  };

  const managerTabs = useMemo(() => ([
    ...(canManage ? [
      { id: 'settings', label: 'Settings' },
      { id: 'backup', label: 'Backup' },
      { id: 'export', label: 'Export' },
      { id: 'integrations', label: 'Integrations' },
      { id: 'people', label: 'People' }
    ] : []),
    { id: 'activity', label: 'Activity' }
  ]), [canManage]);

  const visibleInvites = useMemo(() => {
    if (showInviteHistory) return invites;
    return invites.filter((invite) => !invite.used && !invite.revoked && new Date(invite.expires_at).getTime() > inviteStatusNow);
  }, [inviteStatusNow, invites, showInviteHistory]);

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 space-y-5">
      {!canManage && (
        <div>
          <p className="text-sm text-ghost">
            The active workspace can be viewed here, and only its owner or admins can change settings, members, invites, and integrations.
          </p>
        </div>
      )}

      {loadError ? <div className="text-sm text-err">{loadError}</div> : null}

      <div className="space-y-5">
        <SectionTabs
          tabs={managerTabs}
          activeId={managerTab}
          onChange={setManagerTab}
          semantics="buttons"
          ariaLabel="Workspace sections"
          className="w-fit"
        />

        {canManage && managerTab === 'settings' && (
          <div className="max-w-3xl">
            <form className="flex flex-wrap items-end gap-3" onSubmit={saveSpace}>
              <label className="field min-w-[220px] flex-1">
                <span className="label">Name</span>
                <input
                  className="input"
                  value={editingSpace.name}
                  onChange={(e) => setEditingSpace((prev) => ({ ...prev, name: e.target.value }))}
                  required
                />
              </label>
              <div className="shrink-0">
                <button type="submit" className="btn-primary min-w-[140px]" disabled={savingSpace}>
                  {savingSpace ? <Spinner size={14} /> : 'Save'}
                </button>
              </div>
            </form>
            <div className="mt-6">
              <AdminSettingsView
                apiCall={apiCall}
                onToast={onToast}
                onSettingsChange={onSettingsChange}
                Spinner={Spinner}
                title=""
                description={null}
                embedded
                generalSettingsEndpoint={`/spaces/${activeSpaceId}/settings/general`}
                updateGeneralSettingsEndpoint={`/spaces/${activeSpaceId}/settings/general`}
                featureFlagsEndpoint={`/spaces/${activeSpaceId}/feature-flags`}
                featureFlagUpdatePath={(key) => `/spaces/${activeSpaceId}/feature-flags/${encodeURIComponent(key)}`}
              />
            </div>
          </div>
        )}

        {canManage && managerTab === 'backup' && activeSpaceId ? (
          <div className="max-w-3xl">
            <AdminSettingsView
              apiCall={apiCall}
              onToast={onToast}
              Spinner={Spinner}
              title=""
              description={null}
              embedded
              showGeneralSettings={false}
              visibleFlagKeys={[]}
              generalSettingsEndpoint={`/spaces/${activeSpaceId}/settings/general`}
              updateGeneralSettingsEndpoint={`/spaces/${activeSpaceId}/settings/general`}
              portabilityEndpoint={`/spaces/${activeSpaceId}/portability`}
              portabilityMode="backup"
            />
          </div>
        ) : null}

        {canManage && managerTab === 'export' && activeSpaceId ? (
          <div className="max-w-3xl">
            <AdminSettingsView
              apiCall={apiCall}
              onToast={onToast}
              Spinner={Spinner}
              title=""
              description={null}
              embedded
              showGeneralSettings={false}
              visibleFlagKeys={[]}
              generalSettingsEndpoint={`/spaces/${activeSpaceId}/settings/general`}
              updateGeneralSettingsEndpoint={`/spaces/${activeSpaceId}/settings/general`}
              portabilityEndpoint={`/spaces/${activeSpaceId}/portability`}
              portabilityMode="export"
            />
          </div>
        ) : null}

        {canManage && managerTab === 'people' && (
          <div className="space-y-4">
            <SectionTabs
              tabs={[
                { id: 'members', label: 'Members' },
                { id: 'invitations', label: 'Invitations' }
              ]}
              activeId={peopleTab}
              onChange={setPeopleTab}
              semantics="buttons"
              ariaLabel="Workspace people sections"
              className="w-fit"
            />

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
                {!loading && members.length === 0 ? <p className="py-8 text-sm text-ghost text-center">No members found for this workspace.</p> : null}
                {memberResetLink ? (
                  <div className="p-3 mb-4 flex items-center gap-3 bg-raised rounded-lg border border-edge">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-ghost">{memberResetLabel}</p>
                      <code className="mt-2 block text-xs text-gold font-mono truncate">{memberResetLink}</code>
                    </div>
                    <button type="button" className="btn-icon btn-sm shrink-0" onClick={() => copy(memberResetLink)}><Icons.Copy /></button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm shrink-0"
                      onClick={() => {
                        setMemberResetLink('');
                        setMemberResetLabel('Workspace password reset link');
                      }}
                    >
                      Dismiss
                    </button>
                  </div>
                ) : null}
                {members.length > 0 ? (
                  <div className="overflow-x-auto pb-2">
                    <div className="min-w-full w-max">
                      <div className="grid min-w-full grid-cols-[minmax(140px,1.7fr)_minmax(160px,1.8fr)_minmax(140px,1fr)_minmax(88px,0.8fr)] gap-4 px-1 pb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-ghost">
                        <div>Member</div>
                        <div>Email</div>
                        <div>Role</div>
                        <div>Actions</div>
                      </div>
                      {members.map((member) => (
                        <div
                          key={member.id}
                          className="py-4 border-t border-edge/60 first:border-t-0"
                        >
                          <div className="grid min-w-full grid-cols-[minmax(140px,1.7fr)_minmax(160px,1.8fr)_minmax(140px,1fr)_minmax(88px,0.8fr)] gap-4 items-start">
                            <div className="min-w-0 flex items-center gap-3">
                              <div className="w-10 h-10 rounded-lg bg-raised border border-edge flex items-center justify-center text-dim font-display shrink-0">
                                {member.name?.[0]?.toUpperCase() || member.email?.[0]?.toUpperCase() || '?'}
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-ink">{member.name || 'Unnamed user'}</p>
                              </div>
                            </div>

                            <div className="min-w-0">
                              <p className="text-sm text-ghost truncate">{member.email}</p>
                            </div>

                            <div>
                              <p className="text-sm text-ink">
                                {member.role}{member.user_role ? ` (${member.user_role})` : ''}
                              </p>
                              {member.suspended_at ? (
                                <p className="mt-1 text-xs text-amber-300">Suspended</p>
                              ) : null}
                            </div>

                            <div className="relative inline-flex items-center">
                              <button
                                type="button"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ghost transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge"
                                aria-label="Member actions"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setOpenMemberMenuId((prev) => (Number(prev) === Number(member.id) ? null : member.id));
                                }}
                              >
                                <KebabIcon />
                              </button>
                              {Number(openMemberMenuId) === Number(member.id) ? (
                                <div
                                  className="absolute right-[calc(100%+4px)] top-1/2 z-10 min-w-[190px] -translate-y-1/2 rounded-xl border border-edge bg-abyss p-2 shadow-lg"
                                >
                                  <p className="px-3 py-2 text-[11px] font-medium uppercase tracking-[0.18em] text-ghost">Change Role</p>
                                  <div className="space-y-1">
                                    {(member.role === 'owner' ? ['owner'] : assignableRoles).map((role) => (
                                      <button
                                        key={role}
                                        type="button"
                                        className="w-full rounded-lg px-3 py-2 text-left text-sm text-ink hover:bg-raised disabled:opacity-60"
                                        disabled={memberBusyId === member.id || role === member.role}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          updateMemberRole(member.id, role);
                                        }}
                                      >
                                        {role}
                                      </button>
                                    ))}
                                  </div>
                                  <div className="mt-2 border-t border-edge pt-2">
                                    {member.role !== 'owner' ? (
                                      <>
                                        <button
                                          type="button"
                                          className="w-full rounded-lg px-3 py-2 text-left text-sm text-ink hover:bg-raised disabled:opacity-60"
                                          disabled={memberBusyId === member.id}
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            updateMemberSuspension(member.id, !member.suspended_at);
                                          }}
                                        >
                                          {member.suspended_at ? 'Restore access' : 'Suspend access'}
                                        </button>
                                        <button
                                          type="button"
                                          className="w-full rounded-lg px-3 py-2 text-left text-sm text-ink hover:bg-raised disabled:opacity-60"
                                          disabled={memberBusyId === member.id}
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            createMemberPasswordReset(member, false);
                                          }}
                                        >
                                          Email reset link
                                        </button>
                                        <button
                                          type="button"
                                          className="w-full rounded-lg px-3 py-2 text-left text-sm text-ink hover:bg-raised disabled:opacity-60"
                                          disabled={memberBusyId === member.id}
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            createMemberPasswordReset(member, true);
                                          }}
                                        >
                                          Create copy link
                                        </button>
                                      </>
                                    ) : null}
                                    <button
                                    type="button"
                                    className="w-full rounded-lg px-3 py-2 text-left text-sm text-err hover:bg-err/10 disabled:opacity-60"
                                    disabled={memberBusyId === member.id}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      removeMember(member.id);
                                    }}
                                  >
                                    Remove
                                  </button>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            )}

            {peopleTab === 'invitations' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-medium text-ink">Invitations</h2>
                  <p className="text-sm text-ghost mt-1">Review live and historical invites scoped to this workspace.</p>
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
                  <CheckboxControl
                    id="space-show-invite-history"
                    checked={showInviteHistory}
                    labelClassName="min-h-0 text-xs text-ghost"
                    onChange={(e) => {
                      setInviteStatusNow(Date.now());
                      setShowInviteHistory(e.target.checked);
                    }}
                  >
                    Show invite history
                  </CheckboxControl>
                  <span className="text-xs text-ghost">{inviteForm.expose_token ? 'Copy-link enabled' : 'Email-only invite'}</span>
                </div>
              </form>
              <div className="space-y-1">
                {!loading && visibleInvites.length === 0 ? <p className="py-8 text-sm text-ghost text-center">No invites to show.</p> : null}
                {visibleInvites.length > 0 ? (
                  <div className="overflow-x-auto pb-2">
                    <div className="min-w-full w-max">
                      <div className="grid min-w-full grid-cols-[minmax(180px,2fr)_minmax(88px,0.8fr)_minmax(140px,1fr)_minmax(104px,0.8fr)_minmax(88px,0.7fr)] gap-4 px-1 pb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-ghost">
                        <div>Invite</div>
                        <div>Role</div>
                        <div>Expires</div>
                        <div>Status</div>
                        <div>Actions</div>
                      </div>
                      {visibleInvites.map((invite) => {
                        const expired = new Date(invite.expires_at).getTime() <= inviteStatusNow;
                        return (
                          <div key={invite.id} className="py-4 border-t border-edge/60 first:border-t-0">
                            <div className="grid min-w-full grid-cols-[minmax(180px,2fr)_minmax(88px,0.8fr)_minmax(140px,1fr)_minmax(104px,0.8fr)_minmax(88px,0.7fr)] gap-4 items-start">
                              <div className="min-w-0 flex items-center gap-3">
                                <div className="w-10 h-10 rounded-lg bg-raised border border-edge flex items-center justify-center text-dim font-display shrink-0">
                                  {invite.email?.[0]?.toUpperCase() || '?'}
                                </div>
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-ink">{invite.email}</p>
                                </div>
                              </div>

                              <div>
                                <p className="text-sm text-ink">{invite.space_role || 'member'}</p>
                              </div>

                              <div>
                                <p className="text-sm text-ink">{formatDateTime(invite.expires_at)}</p>
                              </div>

                              <div>
                                <span className={cx('badge text-[10px]', invite.used ? 'badge-dim' : invite.revoked ? 'badge-err' : expired ? 'badge-warn' : 'badge-ok')}>
                                  {invite.used ? 'Used' : invite.revoked ? 'Revoked' : expired ? 'Expired' : 'Active'}
                                </span>
                              </div>

                              <div className="flex flex-wrap items-center gap-2">
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
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            )}
          </div>
        )}

        {canManage && managerTab === 'integrations' && activeSpaceId ? (
          <AdminIntegrationsView
            apiCall={apiCall}
            onToast={onToast}
            Spinner={Spinner}
            cx={cx}
            endpointBase={`/spaces/${activeSpaceId}/integrations`}
            title=""
            includeRuntimeSections={false}
            allowImports
            visibleSections={['audio', 'barcode', 'books', 'cwa', 'comics', 'games', 'kavita', 'plex', 'tmdb']}
          />
        ) : null}

        {managerTab === 'activity' && activeSpaceId ? (
          <ActivityFeedView
            apiCall={apiCall}
            Spinner={Spinner}
            endpoint={`/spaces/${activeSpaceId}/activity`}
            title=""
            emptyMessage="No activity has been recorded for this workspace yet."
            context="workspace"
            onNavigate={(target) => {
              if (target?.managerTab) {
                setManagerTab(target.managerTab);
                if (target.managerTab === 'people') setPeopleTab('members');
                return;
              }
              onTimelineNavigate?.(target);
            }}
            embedded
          />
        ) : null}
      </div>
    </div>
  );
}
