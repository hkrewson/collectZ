import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { SectionTabPanel, SectionTabs } from './app/AppPrimitives';

function emptyCreateForm() {
  return { name: '', owner_user_id: '' };
}

function emptyInitialInvite() {
  return { email: '', role: 'member' };
}

function emptyInviteForm() {
  return { email: '', role: 'member' };
}

function emptyExistingUserForm() {
  return { user_id: '', role: 'member' };
}

function OneTimeLinkPanel({ label, link, onCopy, onDismiss, Icons }) {
  if (!link) return null;
  return (
    <div className="p-3 space-y-2 bg-raised rounded-lg border border-edge">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.18em] text-ghost">{label}</p>
        {onDismiss ? (
          <button type="button" className="btn-secondary btn-sm" onClick={onDismiss}>
            Dismiss
          </button>
        ) : null}
      </div>
      <div className="flex items-center gap-3">
        <code className="flex-1 text-xs text-gold font-mono truncate">{link}</code>
        <button type="button" className="btn-icon btn-sm shrink-0" onClick={onCopy}>
          <Icons.Copy />
        </button>
      </div>
    </div>
  );
}

function roleBadgeClass(role) {
  const normalized = String(role || '').trim().toLowerCase();
  if (normalized === 'owner') return 'badge-warn';
  if (normalized === 'admin') return 'badge-ok';
  if (normalized === 'viewer') return 'badge-dim';
  return 'badge-dim';
}

function buildSpaceSlug(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
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

function SupportSessionStartPanel({
  spaceName,
  libraries,
  value,
  onChange,
  onCancel,
  onSubmit,
  submitting,
  Spinner
}) {
  return (
    <section className="rounded-2xl border border-amber-300/25 bg-[linear-gradient(180deg,rgba(245,158,11,0.12),rgba(217,119,6,0.08),rgba(10,14,20,0.96))] p-4 space-y-4">
      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-[0.22em] text-amber-100/80">Start Support Session</p>
        <h3 className="text-lg font-medium text-amber-50">Open explicit support access for {spaceName}</h3>
        <p className="text-sm text-amber-100/70">
          Support access is audited and stays scoped to this tenant until you explicitly end the session.
        </p>
      </div>

      {libraries.length > 1 ? (
        <label className="field">
          <span className="label text-amber-100/75">Initial Library</span>
          <select
            className="select border-amber-300/30 bg-amber-950/20 text-amber-50"
            value={value.libraryId}
            onChange={(event) => onChange({ libraryId: event.target.value })}
          >
            {libraries.map((library) => (
              <option key={library.id} value={library.id}>
                {library.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="field">
        <span className="label text-amber-100/75">Reason</span>
        <textarea
          className="input min-h-[88px] border-amber-300/30 bg-amber-950/20 text-amber-50 placeholder:text-amber-100/35"
          value={value.reason}
          onChange={(event) => onChange({ reason: event.target.value })}
          placeholder="Optional, but useful for audit context"
        />
      </label>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" className="btn-secondary btn-sm" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button type="button" className="btn-primary btn-sm" onClick={onSubmit} disabled={submitting}>
          {submitting ? <Spinner size={12} /> : 'Start Support Session'}
        </button>
      </div>
    </section>
  );
}

export default function AdminSpacesView({
  apiCall,
  onToast,
  Spinner,
  cx,
  Icons,
  supportSession = null,
  onStartSupportSession,
  onEndSupportSession
}) {
  const [spaces, setSpaces] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [createForm, setCreateForm] = useState(() => emptyCreateForm());
  const [initialInvites, setInitialInvites] = useState([]);
  const [creating, setCreating] = useState(false);
  const [ownerAssignments, setOwnerAssignments] = useState({});
  const [busySpaceId, setBusySpaceId] = useState(null);
  const [selectedSpaceId, setSelectedSpaceId] = useState(null);
  const [selectedSpaceDetails, setSelectedSpaceDetails] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [drawerTab, setDrawerTab] = useState('add');
  const [ownerResetUserId, setOwnerResetUserId] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetLink, setResetLink] = useState('');
  const [inviteForm, setInviteForm] = useState(() => emptyInviteForm());
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [inviteLinkLabel, setInviteLinkLabel] = useState('Invite link');
  const [existingUserForm, setExistingUserForm] = useState(() => emptyExistingUserForm());
  const [addingExistingUser, setAddingExistingUser] = useState(false);
  const [reissuingInviteId, setReissuingInviteId] = useState(null);
  const [openRowMenuId, setOpenRowMenuId] = useState(null);
  const [startingSupportSession, setStartingSupportSession] = useState(false);
  const [supportStartDraft, setSupportStartDraft] = useState({ open: false, libraryId: '', reason: '' });

  const loadPlatformData = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const [spacesRes, usersRes] = await Promise.allSettled([
      apiCall('get', '/admin/spaces'),
      apiCall('get', '/admin/users')
    ]);

    if (spacesRes.status === 'fulfilled') {
      setSpaces(Array.isArray(spacesRes.value?.spaces) ? spacesRes.value.spaces : []);
    } else {
      setLoadError('Failed to load workspaces.');
    }

    if (usersRes.status === 'fulfilled') {
      setUsers(Array.isArray(usersRes.value) ? usersRes.value : []);
    } else {
      setLoadError((prev) => (prev ? `${prev} Failed to load users.` : 'Failed to load users.'));
    }
    setLoading(false);
  }, [apiCall]);

  useEffect(() => {
    loadPlatformData();
  }, [loadPlatformData]);

  const userOptions = useMemo(
    () => users.map((user) => ({ id: Number(user.id), label: `${user.name || 'Unnamed'} (${user.email})` })),
    [users]
  );
  const selectedSpace = useMemo(
    () => spaces.find((space) => Number(space.id) === Number(selectedSpaceId)) || null,
    [spaces, selectedSpaceId]
  );
  const selectedSpaceMembers = useMemo(
    () => (Array.isArray(selectedSpaceDetails?.members) ? selectedSpaceDetails.members : []),
    [selectedSpaceDetails]
  );
  const selectedSpaceInvites = useMemo(
    () => (Array.isArray(selectedSpaceDetails?.invites) ? selectedSpaceDetails.invites : []),
    [selectedSpaceDetails]
  );
  const selectedSpaceLibraries = useMemo(
    () => (Array.isArray(selectedSpaceDetails?.libraries) ? selectedSpaceDetails.libraries : []),
    [selectedSpaceDetails]
  );
  const selectedSpaceOwners = useMemo(
    () => {
      if (selectedSpaceMembers.length > 0) {
        return selectedSpaceMembers
          .filter((member) => member.role === 'owner')
          .map((member) => ({
            user_id: member.user_id,
            email: member.email,
            name: member.name
          }));
      }
      return Array.isArray(selectedSpace?.owners) ? selectedSpace.owners : [];
    },
    [selectedSpace, selectedSpaceMembers]
  );
  const selectedNonOwnerMembers = useMemo(
    () => selectedSpaceMembers.filter((member) => member.role !== 'owner'),
    [selectedSpaceMembers]
  );
  const supportSessionActiveForSelectedSpace = Number(supportSession?.space_id || 0) === Number(selectedSpaceId || 0);
  const addableUserOptions = useMemo(() => {
    const memberIds = new Set(selectedSpaceMembers.map((member) => Number(member.user_id)));
    return userOptions.filter((user) => !memberIds.has(Number(user.id)));
  }, [selectedSpaceMembers, userOptions]);
  const initialOwnerInvite = useMemo(
    () => initialInvites.find((invite) => String(invite?.role || '').trim() === 'owner') || null,
    [initialInvites]
  );
  const ownerSelectionLockedToInvite = Boolean(initialOwnerInvite);

  const loadSelectedSpaceDetails = useCallback(async (spaceId) => {
    if (!spaceId) {
      setSelectedSpaceDetails(null);
      setDetailError('');
      return;
    }
    setDetailLoading(true);
    setDetailError('');
    try {
      const data = await apiCall('get', `/admin/spaces/${spaceId}`);
      setSelectedSpaceDetails(data || null);
    } catch (error) {
      setSelectedSpaceDetails(null);
      setDetailError(error.response?.data?.error || 'Failed to load space detail.');
    } finally {
      setDetailLoading(false);
    }
  }, [apiCall]);

  useEffect(() => {
    if (!selectedSpaceId) {
      setSelectedSpaceDetails(null);
      setDetailError('');
      setDrawerTab('add');
      return;
    }
    loadSelectedSpaceDetails(selectedSpaceId);
  }, [loadSelectedSpaceDetails, selectedSpaceId]);

  useEffect(() => {
    if (!selectedSpace) {
      setOwnerResetUserId('');
      return;
    }
    setOwnerResetUserId((prev) => {
      if (prev && selectedSpaceOwners.some((owner) => Number(owner.user_id) === Number(prev))) return prev;
      return selectedSpaceOwners[0]?.user_id ? String(selectedSpaceOwners[0].user_id) : '';
    });
  }, [selectedSpace, selectedSpaceOwners]);

  useEffect(() => {
    setResetLink('');
    if (!selectedSpace) {
      setInviteLink('');
      setInviteLinkLabel('Invite link');
      setInviteForm(emptyInviteForm());
      setExistingUserForm(emptyExistingUserForm());
      setSupportStartDraft({ open: false, libraryId: '', reason: '' });
      return;
    }
    const nextRole = selectedSpaceOwners.length > 0 ? 'member' : 'viewer';
    setInviteForm({ email: '', role: nextRole });
    setExistingUserForm({ user_id: '', role: nextRole });
  }, [selectedSpace, selectedSpaceId, selectedSpaceOwners]);

  const createSpace = async (event) => {
    event.preventDefault();
    setCreating(true);
    try {
      const ownerInviteCount = initialInvites.filter((invite) => String(invite.role || '').trim() === 'owner').length;
      if (createForm.owner_user_id && ownerInviteCount > 0) {
        throw new Error('Choose either an existing initial owner or one invited owner, not both');
      }
      if (ownerInviteCount > 1) {
        throw new Error('Only one initial owner invite is supported');
      }
      const slug = buildSpaceSlug(createForm.name);
      const payload = {
        name: createForm.name,
        slug: slug || null,
        expose_invite_tokens: true
      };
      if (createForm.owner_user_id) payload.owner_user_id = Number(createForm.owner_user_id);
      if (initialInvites.length > 0) {
        payload.initial_invites = initialInvites
          .map((invite) => ({
            email: String(invite.email || '').trim(),
            role: String(invite.role || 'member').trim() || 'member'
          }))
          .filter((invite) => invite.email);
      }
      const result = await apiCall('post', '/admin/spaces/create-with-onboarding', payload);
      setCreateForm(emptyCreateForm());
      setInitialInvites([]);
      await loadPlatformData();
      if (result?.space?.id) {
        setSelectedSpaceId(result.space.id);
        setDrawerTab('add');
      }
      const failed = Number(result?.summary?.failed || 0);
      const created = Number(result?.summary?.created || 0);
      if (failed > 0) {
        onToast(`Workspace created with ${created} invite${created === 1 ? '' : 's'} and ${failed} failure${failed === 1 ? '' : 's'}`, 'info');
      } else if (created > 0) {
        onToast(`Workspace created with ${created} invite${created === 1 ? '' : 's'}`);
      } else {
        onToast('Workspace created');
      }
    } catch (error) {
      onToast(error.response?.data?.detail || error.response?.data?.error || 'Failed to create workspace', 'error');
    } finally {
      setCreating(false);
    }
  };

  const addInitialInviteRow = () => {
    setInitialInvites((prev) => [...prev, emptyInitialInvite()]);
  };

  const updateInitialInvite = (index, nextPatch) => {
    setInitialInvites((prev) => prev.map((invite, inviteIndex) => (
      inviteIndex === index ? { ...invite, ...nextPatch } : invite
    )));
  };

  const removeInitialInvite = (index) => {
    setInitialInvites((prev) => prev.filter((_, inviteIndex) => inviteIndex !== index));
  };

  const assignOwner = async (spaceId) => {
    const ownerUserId = Number(ownerAssignments[spaceId] || 0);
    if (!ownerUserId) return;
    setBusySpaceId(spaceId);
    try {
      await apiCall('patch', `/admin/spaces/${spaceId}/owner`, { owner_user_id: ownerUserId });
      await loadPlatformData();
      onToast('Owner assigned');
    } catch (error) {
      onToast(error.response?.data?.detail || error.response?.data?.error || 'Failed to assign owner', 'error');
    } finally {
      setBusySpaceId(null);
    }
  };

  const createOwnerReset = async () => {
    const ownerUserId = Number(ownerResetUserId || 0);
    if (!ownerUserId) return;
    setResetLoading(true);
    try {
      const data = await apiCall('post', `/admin/users/${ownerUserId}/password-reset`, { expose_token: true });
      const link = data?.reset_url || '';
      setResetLink(link);
      if (data?.delivery?.sent) onToast('Owner reset email sent');
      else if (link) onToast('Owner reset link created', 'info');
      else onToast('Password reset created but no copy-link available', 'info');
    } catch (error) {
      onToast(error.response?.data?.error || 'Failed to create owner reset link', 'error');
    } finally {
      setResetLoading(false);
    }
  };

  const createMemberReset = async (userId) => {
    const numericUserId = Number(userId || 0);
    if (!numericUserId) return;
    setResetLoading(true);
    try {
      const data = await apiCall('post', `/admin/users/${numericUserId}/password-reset`, { expose_token: true });
      const link = data?.reset_url || '';
      setResetLink(link);
      if (data?.delivery?.sent) onToast('Password reset email sent');
      else if (link) onToast('Password reset link created', 'info');
      else onToast('Password reset created but no copy-link available', 'info');
    } catch (error) {
      onToast(error.response?.data?.error || 'Failed to create password reset link', 'error');
    } finally {
      setResetLoading(false);
    }
  };

  const createDirectInvite = async () => {
    if (!selectedSpaceId) return;
    setCreatingInvite(true);
    try {
      const data = await apiCall('post', `/admin/spaces/${selectedSpaceId}/invites`, {
        email: inviteForm.email,
        role: inviteForm.role,
        expose_token: true
      });
      setInviteLink(data?.invite_url || '');
      setInviteLinkLabel('Invite link');
      setInviteForm({ email: '', role: selectedSpaceOwners.length > 0 ? 'member' : 'viewer' });
      await loadSelectedSpaceDetails(selectedSpaceId);
      if (data?.delivery?.sent) onToast('Invite sent');
      else onToast('Invite created', 'info');
    } catch (error) {
      onToast(error.response?.data?.error || 'Failed to create invite', 'error');
    } finally {
      setCreatingInvite(false);
    }
  };

  const dismissInviteLink = () => {
    setInviteLink('');
    setInviteLinkLabel('Invite link');
  };

  const createFreshInviteLink = async (invite) => {
    if (!selectedSpaceId || !invite?.email) return;
    const isActive = !invite.used && !invite.revoked && (!invite.expires_at || new Date(invite.expires_at).getTime() > Date.now());
    const actionLabel = isActive ? 'replace the current invite with a new link' : 'create a new invite link';
    if (!window.confirm(`Do you want to ${actionLabel} for ${invite.email}?`)) return;

    setReissuingInviteId(invite.id);
    try {
      if (isActive) {
        await apiCall('patch', `/admin/spaces/${selectedSpaceId}/invites/${invite.id}/revoke`);
      }

      const data = await apiCall('post', `/admin/spaces/${selectedSpaceId}/invites`, {
        email: invite.email,
        role: invite.space_role || 'member',
        expose_token: true
      });

      setInviteLink(data?.invite_url || '');
      setInviteLinkLabel(`Fresh invite link for ${invite.email}`);
      setDrawerTab('invites');
      await loadSelectedSpaceDetails(selectedSpaceId);

      if (data?.delivery?.sent) onToast('Fresh invite email sent');
      else onToast('Fresh invite link created', 'info');
    } catch (error) {
      onToast(error.response?.data?.error || 'Failed to create a fresh invite link', 'error');
    } finally {
      setReissuingInviteId(null);
    }
  };

  const addExistingUserToSpace = async () => {
    if (!selectedSpaceId) return;
    const userId = Number(existingUserForm.user_id || 0);
    if (!userId) return;
    setAddingExistingUser(true);
    try {
      await apiCall('post', `/admin/spaces/${selectedSpaceId}/members`, {
        user_id: userId,
        role: existingUserForm.role
      });
      setExistingUserForm({ user_id: '', role: selectedSpaceOwners.length > 0 ? 'member' : 'viewer' });
      await loadPlatformData();
      await loadSelectedSpaceDetails(selectedSpaceId);
      onToast('User added to workspace');
    } catch (error) {
      onToast(error.response?.data?.detail || error.response?.data?.error || 'Failed to add user to workspace', 'error');
    } finally {
      setAddingExistingUser(false);
    }
  };

  const revokeInvite = async (inviteId) => {
    if (!selectedSpaceId || !inviteId) return;
    if (!window.confirm('Revoke this invitation?')) return;
    try {
      await apiCall('patch', `/admin/spaces/${selectedSpaceId}/invites/${inviteId}/revoke`);
      await loadSelectedSpaceDetails(selectedSpaceId);
      onToast('Invite revoked');
    } catch (error) {
      onToast(error.response?.data?.error || 'Failed to revoke invite', 'error');
    }
  };

  const deleteSpace = async (spaceId) => {
    if (!window.confirm('Delete this empty workspace permanently? This cannot be undone.')) return;
    setBusySpaceId(spaceId);
    try {
      await apiCall('delete', `/admin/spaces/${spaceId}`);
      await loadPlatformData();
      setOpenRowMenuId((prev) => (Number(prev) === Number(spaceId) ? null : prev));
      onToast('Workspace deleted');
    } catch (error) {
      onToast(error.response?.data?.detail || error.response?.data?.error || 'Failed to delete workspace', 'error');
    } finally {
      setBusySpaceId(null);
    }
  };

  const handleSupportSession = async () => {
    if (!selectedSpace) return;
    if (supportSessionActiveForSelectedSpace) {
      await onEndSupportSession?.();
      return;
    }

    setSupportStartDraft({
      open: true,
      libraryId: String(selectedSpaceLibraries[0]?.id || ''),
      reason: supportSession?.active ? `Switch support access from ${supportSession.space_name || 'current space'}` : ''
    });
  };

  const submitSupportSession = async () => {
    if (!selectedSpace) return;
    setStartingSupportSession(true);
    try {
      const started = await onStartSupportSession?.(selectedSpace, {
        reason: supportStartDraft.reason,
        libraryId: supportStartDraft.libraryId
      });
      if (started !== false) {
        setSupportStartDraft({ open: false, libraryId: '', reason: '' });
        setSelectedSpaceId(null);
      }
    } finally {
      setStartingSupportSession(false);
    }
  };

  if (loading) {
    return <div className="p-4 sm:p-6 flex items-center gap-3 text-dim"><Spinner />Loading workspaces…</div>;
  }

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 space-y-6">
      <div className="space-y-2">
        <h1 className="section-title">All Workspaces</h1>
        <p className="text-sm text-ghost max-w-3xl">
          Workspace administration for global admins. Create workspaces, recover owners, and run explicit support sessions without falling back to casual tenant-workspace browsing.
        </p>
      </div>

      {loadError ? <p className="text-sm text-err">{loadError}</p> : null}

      <form className="space-y-4 max-w-3xl" onSubmit={createSpace}>
        <div>
          <h2 className="text-xl font-medium text-ink">Create Workspace</h2>
          <p className="text-sm text-ghost mt-1">Create a workspace, set its first owner, and optionally prepare workspace-scoped invites, including one invited owner if the owner should claim later.</p>
        </div>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:flex-nowrap">
          <label className="field xl:max-w-[360px] xl:flex-1">
            <span className="label">Name</span>
            <input
              className="input"
              value={createForm.name}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, name: e.target.value }))}
              required
            />
          </label>
          <label className="field xl:w-[240px] xl:shrink-0">
            <span className="label">Initial Owner</span>
            <select
              className="select"
              value={createForm.owner_user_id}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, owner_user_id: e.target.value }))}
              disabled={ownerSelectionLockedToInvite}
            >
              <option value="">{ownerSelectionLockedToInvite ? 'Invited owner below' : 'Current admin'}</option>
              {userOptions.map((user) => (
                <option key={user.id} value={user.id}>{user.label}</option>
              ))}
            </select>
            <span className="mt-2 text-xs text-ghost">
              {ownerSelectionLockedToInvite
                ? `First owner will be ${initialOwnerInvite.email} after they claim the invite below.`
                : 'Leave this as Current admin, or choose an existing active user as the initial owner.'}
            </span>
          </label>
          <div className="xl:shrink-0 xl:pb-[1px]">
            <button type="submit" className="btn-primary min-w-[132px] w-full xl:w-auto" disabled={creating}>
              {creating ? <Spinner size={14} /> : 'Create Workspace'}
            </button>
          </div>
        </div>

        <div className="space-y-3 pt-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-medium text-ink">Initial Invites</h3>
              <p className="text-sm text-ghost mt-1">Optional. Add the first people who should join this workspace, including one invited owner if the owner does not exist yet.</p>
              <p className="text-xs text-ghost mt-2">Set one invite role to <span className="text-ink">owner</span> if a brand-new invited user should become the first owner when they claim the invite.</p>
            </div>
            <button type="button" className="btn-secondary btn-sm" onClick={addInitialInviteRow}>
              Add invite
            </button>
          </div>

          {initialInvites.length === 0 ? (
            <p className="text-sm text-ghost">No initial invites yet.</p>
          ) : (
            <div className="space-y-3">
              {initialInvites.map((invite, index) => (
                <div key={`initial-invite-${index}`} className="flex flex-col gap-3 xl:flex-row xl:items-end">
                  <label className="field xl:flex-1">
                    <span className="label">Email</span>
                    <input
                      className="input"
                      type="email"
                      value={invite.email}
                      onChange={(e) => {
                        updateInitialInvite(index, { email: e.target.value });
                      }}
                      placeholder="name@example.com"
                    />
                  </label>
                  <label className="field xl:w-[150px] xl:shrink-0">
                    <span className="label">Role</span>
                    <select
                      className="select"
                      value={invite.role}
                      onChange={(e) => {
                        const nextRole = e.target.value;
                        if (nextRole === 'owner') {
                          setCreateForm((prev) => ({ ...prev, owner_user_id: '' }));
                          setInitialInvites((prev) => prev.map((currentInvite, currentIndex) => {
                            if (currentIndex === index) return { ...currentInvite, role: 'owner' };
                            if (String(currentInvite?.role || '').trim() === 'owner') {
                              return { ...currentInvite, role: 'member' };
                            }
                            return currentInvite;
                          }));
                          return;
                        }
                        updateInitialInvite(index, { role: nextRole });
                      }}
                    >
                      <option value="owner">owner</option>
                      <option value="admin">admin</option>
                      <option value="member">member</option>
                      <option value="viewer">viewer</option>
                    </select>
                  </label>
                  <div className="xl:pb-[1px]">
                    <button type="button" className="btn-secondary btn-sm w-full xl:w-auto" onClick={() => removeInitialInvite(index)}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </form>

      <div className="space-y-1">
        {spaces.length === 0 ? <p className="px-5 py-8 text-sm text-ghost text-center">No workspaces found.</p> : null}
        {spaces.length > 0 ? (
          <div className="overflow-x-auto pb-2">
            <div className="min-w-full w-max">
              <div className="grid min-w-full grid-cols-[minmax(320px,2.2fr)_minmax(260px,1.5fr)_minmax(110px,0.7fr)_minmax(110px,0.7fr)_minmax(110px,0.8fr)_minmax(190px,1fr)] gap-4 px-1 pb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-ghost">
                <div>Workspace</div>
                <div>Owners</div>
                <div>Members</div>
                <div>Libraries</div>
                <div>Status</div>
                <div>Actions</div>
              </div>
              {spaces.map((space) => {
                const ownerSummary = Array.isArray(space.owners) ? space.owners : [];
                const archived = Boolean(space.archived_at);
                const canDelete = Number(space.library_count || 0) === 0 && space.slug !== 'default';
                return (
                  <div
                    key={space.id}
                    className="py-4 border-t border-edge/60 first:border-t-0 cursor-pointer"
                    onClick={() => setSelectedSpaceId(space.id)}
                  >
                    <div className="grid min-w-full grid-cols-[minmax(320px,2.2fr)_minmax(260px,1.5fr)_minmax(110px,0.7fr)_minmax(110px,0.7fr)_minmax(110px,0.8fr)_minmax(190px,1fr)] gap-4 items-start">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-sm font-medium text-ink leading-6">{space.name}</h2>
                        </div>
                      </div>

                      <div className="min-w-0">
                        <p className="text-sm text-ink leading-6 break-words">
                          {ownerSummary.length > 0 ? ownerSummary.map((owner) => owner.email || owner.name || `user #${owner.user_id}`).join(', ') : 'none'}
                        </p>
                      </div>

                      <div>
                        <p className="text-lg font-medium text-ink">{space.member_count}</p>
                      </div>

                      <div>
                        <p className="text-lg font-medium text-ink">{space.library_count}</p>
                      </div>

                      <div className="space-y-2">
                        <span className={cx('badge text-[10px]', archived ? 'badge-warn' : 'badge-ok')}>
                          {archived ? 'Archived' : 'Active'}
                        </span>
                      </div>

                      <div className="space-y-3">
                        <div className="relative inline-flex items-center">
                          <button
                            type="button"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ghost transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge"
                            aria-label="More actions"
                            onClick={(event) => {
                              event.stopPropagation();
                              setOpenRowMenuId((prev) => (Number(prev) === Number(space.id) ? null : space.id));
                            }}
                        >
                          <KebabIcon />
                        </button>
                          {Number(openRowMenuId) === Number(space.id) ? (
                            <div
                              className="absolute left-[calc(100%+4px)] top-1/2 z-10 min-w-[140px] -translate-y-1/2 rounded-xl border border-edge bg-abyss p-2 shadow-lg"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <button
                                type="button"
                                className="w-full rounded-lg px-3 py-2 text-left text-sm text-err hover:bg-err/10 disabled:opacity-60"
                                disabled={!canDelete || busySpaceId === space.id}
                                onClick={() => deleteSpace(space.id)}
                              >
                                {busySpaceId === space.id ? 'Deleting…' : 'Delete'}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      {selectedSpace && (
        <>
          <div className="fixed inset-0 bg-void/70 z-40" onClick={() => setSelectedSpaceId(null)} />
          <aside className="fixed top-0 right-0 h-full w-full max-w-lg bg-abyss border-l border-edge z-50 overflow-y-auto">
            <div className="p-5 border-b border-edge flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <h2 className="panel-title">Workspace Controls</h2>
                <p className="text-sm text-ghost mt-1">{selectedSpaceDetails?.space?.name || selectedSpace.name}</p>
              </div>
              <button
                type="button"
                className="btn-secondary btn-sm shrink-0"
                disabled={startingSupportSession}
                onClick={handleSupportSession}
              >
                {startingSupportSession
                  ? <Spinner size={12} />
                  : supportSessionActiveForSelectedSpace
                    ? 'End Support Session'
                    : supportSession?.active
                      ? 'Switch Support Session'
                      : 'Start Support Session'}
              </button>
              <button onClick={() => setSelectedSpaceId(null)} className="btn-icon btn-sm">
                <Icons.X />
              </button>
            </div>

            <div className="p-5 space-y-6">
              {supportStartDraft.open ? (
                <SupportSessionStartPanel
                  spaceName={selectedSpaceDetails?.space?.name || selectedSpace.name}
                  libraries={selectedSpaceLibraries}
                  value={supportStartDraft}
                  onChange={(patch) => setSupportStartDraft((prev) => ({ ...prev, ...patch }))}
                  onCancel={() => setSupportStartDraft({ open: false, libraryId: '', reason: '' })}
                  onSubmit={submitSupportSession}
                  submitting={startingSupportSession}
                  Spinner={Spinner}
                />
              ) : null}

              {detailLoading ? <p className="text-sm text-ghost flex items-center gap-2"><Spinner size={14} />Loading workspace detail…</p> : null}
              {detailError ? <p className="text-sm text-err">{detailError}</p> : null}

              <section className="space-y-3">
                <div>
                  <h3 className="text-lg font-medium text-ink">
                    {selectedSpaceOwners.length > 0 ? "Reset an owner's password" : 'Add an owner'}
                  </h3>
                  <p className="text-sm text-ghost mt-1">
                    {selectedSpaceOwners.length > 0
                      ? 'Create a password reset link for a current owner.'
                      : 'This workspace is currently empty.'}
                  </p>
                </div>

                {selectedSpaceOwners.length > 0 ? (
                  <>
                    <label className="field">
                      <span className="label">Owner</span>
                      <select
                        className="select"
                        value={ownerResetUserId}
                        onChange={(e) => setOwnerResetUserId(e.target.value)}
                      >
                        {selectedSpaceOwners.map((owner) => (
                          <option key={owner.user_id} value={owner.user_id}>
                            {owner.email || owner.name || `user #${owner.user_id}`}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="flex justify-end">
                      <button type="button" className="btn-secondary" disabled={!ownerResetUserId || resetLoading} onClick={createOwnerReset}>
                        {resetLoading ? <Spinner size={14} /> : 'Create reset link'}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <label className="field">
                      <span className="label">Owner</span>
                      <div className="flex gap-2">
                        <select
                          className="select flex-1"
                          value={ownerAssignments[selectedSpace.id] || ''}
                          onChange={(e) => setOwnerAssignments((prev) => ({ ...prev, [selectedSpace.id]: e.target.value }))}
                        >
                          <option value="">Select user</option>
                          {userOptions.map((user) => (
                            <option key={user.id} value={user.id}>{user.label}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="btn-secondary btn-sm shrink-0"
                          disabled={!ownerAssignments[selectedSpace.id] || busySpaceId === selectedSpace.id}
                          onClick={() => assignOwner(selectedSpace.id)}
                        >
                          {busySpaceId === selectedSpace.id ? <Spinner size={12} /> : 'Assign'}
                        </button>
                      </div>
                    </label>
                  </>
                )}

                {resetLink && (
                  <div className="p-3 flex items-center gap-3 bg-raised rounded-lg border border-edge">
                    <code className="flex-1 text-xs text-gold font-mono truncate">{resetLink}</code>
                    <button type="button" className="btn-icon btn-sm shrink-0" onClick={() => navigator.clipboard.writeText(resetLink).then(() => onToast('Copied')).catch(() => onToast('Copy failed', 'error'))}>
                      <Icons.Copy />
                    </button>
                  </div>
                )}
              </section>

              <section className="space-y-4">
                <SectionTabs
                  tabs={[
                    { id: 'add', label: 'Add People' },
                    { id: 'members', label: `Members (${selectedNonOwnerMembers.length})` },
                    { id: 'invites', label: `Invitations (${selectedSpaceInvites.length})` }
                  ]}
                  activeId={drawerTab}
                  onChange={setDrawerTab}
                  ariaLabel="Workspace drawer sections"
                  idBase="space-drawer-sections"
                />

                <SectionTabPanel activeId={drawerTab} tabKey="add" idBase="space-drawer-sections">
                  <>
                <div>
                  <h3 className="text-lg font-medium text-ink">Add people</h3>
                  <p className="text-sm text-ghost mt-1">Invite someone directly to this workspace or add an existing user to it.</p>
                </div>

                <div className="space-y-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-ghost">Direct workspace-scoped invite</p>
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="field min-w-[220px] flex-1">
                      <span className="label">Email</span>
                      <input
                        className="input"
                        type="email"
                        value={inviteForm.email}
                        onChange={(e) => setInviteForm((prev) => ({ ...prev, email: e.target.value }))}
                      />
                    </label>
                    <label className="field w-[150px] shrink-0">
                      <span className="label">Role</span>
                      <select className="select" value={inviteForm.role} onChange={(e) => setInviteForm((prev) => ({ ...prev, role: e.target.value }))}>
                        <option value="admin">admin</option>
                        <option value="member">member</option>
                        <option value="viewer">viewer</option>
                      </select>
                    </label>
                    <button type="button" className="btn-primary min-w-[120px]" disabled={!inviteForm.email || creatingInvite} onClick={createDirectInvite}>
                      {creatingInvite ? <Spinner size={14} /> : 'Create Invite'}
                    </button>
                  </div>
                  <OneTimeLinkPanel
                    label={inviteLinkLabel}
                    link={inviteLink}
                    Icons={Icons}
                    onDismiss={dismissInviteLink}
                    onCopy={() => navigator.clipboard.writeText(inviteLink).then(() => onToast('Copied')).catch(() => onToast('Copy failed', 'error'))}
                  />
                </div>

                <div className="space-y-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-ghost">Add existing user to this workspace</p>
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="field min-w-[240px] flex-1">
                      <span className="label">User</span>
                      <select
                        className="select"
                        value={existingUserForm.user_id}
                        onChange={(e) => setExistingUserForm((prev) => ({ ...prev, user_id: e.target.value }))}
                      >
                        <option value="">Select user</option>
                        {addableUserOptions.map((user) => (
                          <option key={user.id} value={user.id}>{user.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="field w-[150px] shrink-0">
                      <span className="label">Role</span>
                      <select
                        className="select"
                        value={existingUserForm.role}
                        onChange={(e) => setExistingUserForm((prev) => ({ ...prev, role: e.target.value }))}
                      >
                        <option value="admin">admin</option>
                        <option value="member">member</option>
                        <option value="viewer">viewer</option>
                      </select>
                    </label>
                    <button type="button" className="btn-secondary min-w-[120px]" disabled={!existingUserForm.user_id || addingExistingUser} onClick={addExistingUserToSpace}>
                      {addingExistingUser ? <Spinner size={14} /> : 'Add User'}
                    </button>
                  </div>
                </div>
                  </>
                </SectionTabPanel>

                <SectionTabPanel activeId={drawerTab} tabKey="members" idBase="space-drawer-sections">
                  <section className="space-y-3">
                <div>
                  <h3 className="text-lg font-medium text-ink">Members</h3>
                  <p className="text-sm text-ghost mt-1">Reset passwords for existing users and review current access within this workspace.</p>
                </div>
                {selectedNonOwnerMembers.length === 0 ? (
                  <p className="text-sm text-ghost">No non-owner members are currently assigned to this space.</p>
                ) : (
                  <div className="space-y-2">
                    {selectedNonOwnerMembers.map((member) => (
                      <div key={member.id} className="rounded-xl border border-edge bg-abyss/50 p-3 flex flex-wrap items-center gap-3 justify-between">
                        <div className="min-w-[220px] flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-ink">{member.email || member.name || `user #${member.user_id}`}</p>
                            <span className={cx('badge text-[10px]', roleBadgeClass(member.role))}>{member.role}</span>
                          </div>
                          <p className="text-xs text-ghost mt-1">{member.name ? member.name : `user #${member.user_id}`}</p>
                        </div>
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          disabled={resetLoading}
                          onClick={() => createMemberReset(member.user_id)}
                        >
                          {resetLoading ? <Spinner size={12} /> : 'Reset password'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                  </section>
                </SectionTabPanel>

                <SectionTabPanel activeId={drawerTab} tabKey="invites" idBase="space-drawer-sections">
                  <section className="space-y-3">
                <div>
                  <h3 className="text-lg font-medium text-ink">Invitations</h3>
                  <p className="text-sm text-ghost mt-1">Review pending and historical invitations for this workspace.</p>
                </div>
                <OneTimeLinkPanel
                  label={inviteLinkLabel}
                  link={inviteLink}
                  Icons={Icons}
                  onDismiss={dismissInviteLink}
                  onCopy={() => navigator.clipboard.writeText(inviteLink).then(() => onToast('Copied')).catch(() => onToast('Copy failed', 'error'))}
                />
                {selectedSpaceInvites.length === 0 ? (
                  <p className="text-sm text-ghost">No invitations yet.</p>
                ) : (
                  <div className="space-y-2">
                    {selectedSpaceInvites.map((invite) => {
                      const expired = new Date(invite.expires_at).getTime() <= Date.now();
                      const active = !invite.used && !invite.revoked && !expired;
                      return (
                        <div key={invite.id} className="rounded-xl border border-edge bg-abyss/50 p-3 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-[220px] flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-medium text-ink">{invite.email}</p>
                                <span className={cx('badge text-[10px]', roleBadgeClass(invite.space_role || 'member'))}>{invite.space_role || 'member'}</span>
                              </div>
                              <p className="text-xs text-ghost mt-1">Expires {invite.expires_at ? new Date(invite.expires_at).toLocaleString() : 'unknown'}</p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={cx('badge text-[10px]', invite.used ? 'badge-dim' : invite.revoked ? 'badge-err' : expired ? 'badge-warn' : 'badge-ok')}>
                                {invite.used ? 'Used' : invite.revoked ? 'Revoked' : expired ? 'Expired' : 'Active'}
                              </span>
                              {!invite.used ? (
                                <button
                                  type="button"
                                  className="btn-secondary btn-sm"
                                  disabled={reissuingInviteId === invite.id}
                                  onClick={() => createFreshInviteLink(invite)}
                                >
                                  {reissuingInviteId === invite.id ? <Spinner size={12} /> : (active ? 'New link' : 'Create new link')}
                                </button>
                              ) : null}
                              {active ? (
                                <button type="button" className="btn-secondary btn-sm" onClick={() => revokeInvite(invite.id)}>
                                  Revoke
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                  </section>
                </SectionTabPanel>
              </section>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
