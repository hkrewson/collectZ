import React, { useCallback, useEffect, useMemo, useState } from 'react';

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

function defaultSpaceRole(hasOwner) {
  return hasOwner ? 'member' : 'owner';
}

function buildSpaceSlug(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

export default function AdminSpacesView({ apiCall, onToast, Spinner, cx, Icons }) {
  const [spaces, setSpaces] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [createForm, setCreateForm] = useState(() => emptyCreateForm());
  const [initialInvites, setInitialInvites] = useState([]);
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState(null);
  const [ownerAssignments, setOwnerAssignments] = useState({});
  const [busySpaceId, setBusySpaceId] = useState(null);
  const [selectedSpaceId, setSelectedSpaceId] = useState(null);
  const [ownerResetUserId, setOwnerResetUserId] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetLink, setResetLink] = useState('');
  const [inviteForm, setInviteForm] = useState(() => emptyInviteForm());
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [existingUserForm, setExistingUserForm] = useState(() => emptyExistingUserForm());
  const [addingExistingUser, setAddingExistingUser] = useState(false);

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
      setLoadError('Failed to load spaces.');
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
  const selectedSpaceOwners = useMemo(
    () => (Array.isArray(selectedSpace?.owners) ? selectedSpace.owners : []),
    [selectedSpace]
  );

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
    setInviteLink('');
    if (!selectedSpace) {
      setInviteForm(emptyInviteForm());
      setExistingUserForm(emptyExistingUserForm());
      return;
    }
    const nextRole = defaultSpaceRole(selectedSpaceOwners.length > 0);
    setInviteForm({ email: '', role: nextRole });
    setExistingUserForm({ user_id: '', role: nextRole });
  }, [selectedSpace, selectedSpaceId, selectedSpaceOwners]);

  const createSpace = async (event) => {
    event.preventDefault();
    setCreating(true);
    try {
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
      setCreateResult(result || null);
      setCreateForm(emptyCreateForm());
      setInitialInvites([]);
      await loadPlatformData();
      const failed = Number(result?.summary?.failed || 0);
      const created = Number(result?.summary?.created || 0);
      if (failed > 0) {
        onToast(`Space created with ${created} invite${created === 1 ? '' : 's'} and ${failed} failure${failed === 1 ? '' : 's'}`, 'info');
      } else if (created > 0) {
        onToast(`Space created with ${created} invite${created === 1 ? '' : 's'}`);
      } else {
        onToast('Space created');
      }
    } catch (error) {
      onToast(error.response?.data?.detail || error.response?.data?.error || 'Failed to create space', 'error');
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

  const copyText = async (value) => {
    try {
      await navigator.clipboard.writeText(value);
      onToast('Copied');
    } catch {
      onToast('Copy failed', 'error');
    }
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

  const createDirectInvite = async () => {
    if (!selectedSpaceId) return;
    setCreatingInvite(true);
    try {
      const data = await apiCall('post', `/spaces/${selectedSpaceId}/invites`, {
        email: inviteForm.email,
        role: inviteForm.role,
        expose_token: true
      });
      setInviteLink(data?.invite_url || '');
      setInviteForm({ email: '', role: defaultSpaceRole(selectedSpaceOwners.length > 0) });
      if (data?.delivery?.sent) onToast('Invite sent');
      else onToast('Invite created', 'info');
    } catch (error) {
      onToast(error.response?.data?.error || 'Failed to create invite', 'error');
    } finally {
      setCreatingInvite(false);
    }
  };

  const addExistingUserToSpace = async () => {
    if (!selectedSpaceId) return;
    const userId = Number(existingUserForm.user_id || 0);
    if (!userId) return;
    setAddingExistingUser(true);
    try {
      await apiCall('post', `/spaces/${selectedSpaceId}/members`, {
        user_id: userId,
        role: existingUserForm.role
      });
      setExistingUserForm({ user_id: '', role: defaultSpaceRole(selectedSpaceOwners.length > 0) });
      await loadPlatformData();
      onToast('User added to space');
    } catch (error) {
      onToast(error.response?.data?.detail || error.response?.data?.error || 'Failed to add user to space', 'error');
    } finally {
      setAddingExistingUser(false);
    }
  };

  const setArchived = async (spaceId, archived) => {
    const actionLabel = archived ? 'archive' : 'unarchive';
    if (!window.confirm(`${archived ? 'Archive' : 'Unarchive'} this space?`)) return;
    setBusySpaceId(spaceId);
    try {
      await apiCall('patch', `/admin/spaces/${spaceId}/archive`, { archived });
      await loadPlatformData();
      onToast(`Space ${actionLabel}d`);
    } catch (error) {
      onToast(error.response?.data?.detail || error.response?.data?.error || `Failed to ${actionLabel} space`, 'error');
    } finally {
      setBusySpaceId(null);
    }
  };

  const deleteSpace = async (spaceId) => {
    if (!window.confirm('Delete this archived space permanently? This cannot be undone.')) return;
    setBusySpaceId(spaceId);
    try {
      await apiCall('delete', `/admin/spaces/${spaceId}`);
      await loadPlatformData();
      onToast('Space deleted');
    } catch (error) {
      onToast(error.response?.data?.detail || error.response?.data?.error || 'Failed to delete space', 'error');
    } finally {
      setBusySpaceId(null);
    }
  };

  if (loading) {
    return <div className="p-4 sm:p-6 flex items-center gap-3 text-dim"><Spinner />Loading spaces…</div>;
  }

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 space-y-6">
      <div className="space-y-2">
        <h1 className="section-title">All Spaces</h1>
        <p className="text-sm text-ghost max-w-3xl">
          Platform control plane for global admins. Create spaces, recover owners, and archive or delete empty spaces without joining those tenant spaces.
        </p>
      </div>

      {loadError ? <p className="text-sm text-err">{loadError}</p> : null}

      <form className="space-y-4 max-w-3xl" onSubmit={createSpace}>
        <div>
          <h2 className="text-xl font-medium text-ink">Create Space</h2>
          <p className="text-sm text-ghost mt-1">Create a space, set its first owner, and optionally prepare its first space-scoped invites.</p>
        </div>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:flex-nowrap">
          <label className="field xl:max-w-[360px] xl:flex-1">
            <span className="label">Name</span>
            <input
              className="input"
              value={createForm.name}
              onChange={(e) => {
                setCreateResult(null);
                setCreateForm((prev) => ({ ...prev, name: e.target.value }));
              }}
              required
            />
          </label>
          <label className="field xl:w-[240px] xl:shrink-0">
            <span className="label">Initial Owner</span>
            <select
              className="select"
              value={createForm.owner_user_id}
              onChange={(e) => {
                setCreateResult(null);
                setCreateForm((prev) => ({ ...prev, owner_user_id: e.target.value }));
              }}
            >
              <option value="">Current admin</option>
              {userOptions.map((user) => (
                <option key={user.id} value={user.id}>{user.label}</option>
              ))}
            </select>
          </label>
          <div className="xl:shrink-0 xl:pb-[1px]">
            <button type="submit" className="btn-primary min-w-[132px] w-full xl:w-auto" disabled={creating}>
              {creating ? <Spinner size={14} /> : 'Create Space'}
            </button>
          </div>
        </div>

        <div className="space-y-3 pt-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-medium text-ink">Initial Invites</h3>
              <p className="text-sm text-ghost mt-1">Optional. Add the first people who should join this space after the owner.</p>
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
                        setCreateResult(null);
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
                        setCreateResult(null);
                        updateInitialInvite(index, { role: e.target.value });
                      }}
                    >
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

      {createResult ? (
        <div className="max-w-4xl rounded-2xl border border-edge bg-raised/50 p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-medium text-ink">Latest onboarding result</h2>
              <p className="text-sm text-ghost mt-1">
                {createResult?.space?.name || 'Space'} was created with {Number(createResult?.summary?.created || 0)} successful invite{Number(createResult?.summary?.created || 0) === 1 ? '' : 's'}
                {Number(createResult?.summary?.failed || 0) > 0 ? ` and ${Number(createResult?.summary?.failed || 0)} failure${Number(createResult?.summary?.failed || 0) === 1 ? '' : 's'}` : ''}.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="badge badge-dim">requested {Number(createResult?.summary?.requested || 0)}</span>
              <span className="badge badge-dim">created {Number(createResult?.summary?.created || 0)}</span>
              <span className={cx('badge', Number(createResult?.summary?.failed || 0) > 0 ? 'badge-warn' : 'badge-ok')}>
                failed {Number(createResult?.summary?.failed || 0)}
              </span>
            </div>
          </div>

          <div className="text-sm text-ghost">
            Owner: <span className="text-ink">{createResult?.owner?.email || 'unknown'}</span>
          </div>

          {Array.isArray(createResult?.invite_results) && createResult.invite_results.length > 0 ? (
            <div className="space-y-2">
              {createResult.invite_results.map((invite, index) => (
                <div key={`result-invite-${invite.id || invite.email || index}`} className="rounded-xl border border-edge bg-abyss/50 p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-[220px] flex-1">
                      <p className="text-sm font-medium text-ink">{invite.email}</p>
                      <p className="text-xs text-ghost">{invite.role}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cx('badge text-[10px]', invite.created ? 'badge-ok' : 'badge-warn')}>
                        {invite.created ? 'Created' : 'Needs attention'}
                      </span>
                      {invite.invite_url ? (
                        <button type="button" className="btn-icon btn-sm shrink-0" onClick={() => copyText(invite.invite_url)} title="Copy invite link">
                          <Icons.Copy />
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {invite.created ? (
                    <p className="text-xs text-ghost">
                      {invite.delivery?.sent
                        ? 'Invite email sent.'
                        : invite.invite_url
                          ? 'Invite created with copy-link available.'
                          : 'Invite created.'}
                    </p>
                  ) : (
                    <p className="text-xs text-err">{invite.error || 'Invite could not be created.'}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ghost">No initial invites were requested.</p>
          )}
        </div>
      ) : null}

      <div className="space-y-1">
        {spaces.length === 0 && <p className="px-5 py-8 text-sm text-ghost text-center">No spaces found.</p>}
        {spaces.map((space) => {
          const ownerSummary = Array.isArray(space.owners) ? space.owners : [];
          const archived = Boolean(space.archived_at);
          const canArchive = !archived && Number(space.library_count || 0) === 0 && space.slug !== 'default';
          const canDelete = archived && Number(space.library_count || 0) === 0 && space.slug !== 'default';
          return (
            <div
              key={space.id}
              className="py-4 space-y-4 cursor-pointer"
              onClick={() => setSelectedSpaceId(space.id)}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-[240px] flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-medium text-ink">{space.name}</h2>
                    <span className={cx('badge text-[10px]', archived ? 'badge-warn' : 'badge-ok')}>
                      {archived ? 'Archived' : 'Active'}
                    </span>
                    {space.slug ? <span className="badge badge-dim text-[10px]">{space.slug}</span> : null}
                    {space.slug === 'default' ? <span className="badge badge-dim text-[10px]">default</span> : null}
                  </div>
                  <p className="text-sm text-ghost mt-1">{space.description || 'No description provided.'}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="badge badge-dim">{space.owner_count} owner{Number(space.owner_count) === 1 ? '' : 's'}</span>
                    <span className="badge badge-dim">{space.member_count} member{Number(space.member_count) === 1 ? '' : 's'}</span>
                    <span className="badge badge-dim">{space.library_count} librar{Number(space.library_count) === 1 ? 'y' : 'ies'}</span>
                  </div>
                  <p className="text-xs text-ghost mt-3">
                    Owners: {ownerSummary.length > 0 ? ownerSummary.map((owner) => owner.email || owner.name || `user #${owner.user_id}`).join(', ') : 'none'}
                  </p>
                </div>

                <div className="min-w-[280px] space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      disabled={!canArchive || busySpaceId === space.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        setArchived(space.id, true);
                      }}
                      title={space.slug === 'default' ? 'Default space is protected' : Number(space.library_count || 0) > 0 ? 'Empty the space first' : 'Archive space'}
                    >
                      {busySpaceId === space.id ? <Spinner size={12} /> : 'Archive'}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      disabled={!archived || space.slug === 'default' || busySpaceId === space.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        setArchived(space.id, false);
                      }}
                    >
                      {busySpaceId === space.id ? <Spinner size={12} /> : 'Unarchive'}
                    </button>
                    <button
                      type="button"
                      className="btn-danger btn-sm"
                      disabled={!canDelete || busySpaceId === space.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteSpace(space.id);
                      }}
                    >
                      {busySpaceId === space.id ? <Spinner size={12} /> : 'Delete'}
                    </button>
                  </div>
                  {!canArchive && !archived && Number(space.library_count || 0) > 0 ? (
                    <p className="text-xs text-ghost">Archive an empty space.</p>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {selectedSpace && (
        <>
          <div className="fixed inset-0 bg-void/70 z-40" onClick={() => setSelectedSpaceId(null)} />
          <aside className="fixed top-0 right-0 h-full w-full max-w-lg bg-abyss border-l border-edge z-50 overflow-y-auto">
            <div className="p-5 border-b border-edge flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <h2 className="font-display text-2xl tracking-wider text-ink">Space Controls</h2>
                <p className="text-sm text-ghost mt-1">{selectedSpace.name}</p>
              </div>
              <button onClick={() => setSelectedSpaceId(null)} className="btn-icon btn-sm">
                <Icons.X />
              </button>
            </div>

            <div className="p-5 space-y-6">
              <section className="space-y-3">
                <div>
                  <h3 className="text-lg font-medium text-ink">
                    {selectedSpaceOwners.length > 0 ? "Reset an owner's password" : 'Add an owner'}
                  </h3>
                  <p className="text-sm text-ghost mt-1">
                    {selectedSpaceOwners.length > 0
                      ? 'Create a password reset link for a current owner.'
                      : 'This space is currently empty.'}
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
                <div>
                  <h3 className="text-lg font-medium text-ink">Add people</h3>
                  <p className="text-sm text-ghost mt-1">Invite someone directly to this space or add an existing user to it.</p>
                </div>

                <div className="space-y-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-ghost">Direct space-scoped invite</p>
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
                        <option value="owner">owner</option>
                        <option value="admin">admin</option>
                        <option value="member">member</option>
                        <option value="viewer">viewer</option>
                      </select>
                    </label>
                    <button type="button" className="btn-primary min-w-[120px]" disabled={!inviteForm.email || creatingInvite} onClick={createDirectInvite}>
                      {creatingInvite ? <Spinner size={14} /> : 'Create Invite'}
                    </button>
                  </div>
                  {inviteLink && (
                    <div className="p-3 flex items-center gap-3 bg-raised rounded-lg border border-edge">
                      <code className="flex-1 text-xs text-gold font-mono truncate">{inviteLink}</code>
                      <button type="button" className="btn-icon btn-sm shrink-0" onClick={() => navigator.clipboard.writeText(inviteLink).then(() => onToast('Copied')).catch(() => onToast('Copy failed', 'error'))}>
                        <Icons.Copy />
                      </button>
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-ghost">Add existing user to this space</p>
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="field min-w-[240px] flex-1">
                      <span className="label">User</span>
                      <select
                        className="select"
                        value={existingUserForm.user_id}
                        onChange={(e) => setExistingUserForm((prev) => ({ ...prev, user_id: e.target.value }))}
                      >
                        <option value="">Select user</option>
                        {userOptions.map((user) => (
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
                        <option value="owner">owner</option>
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
              </section>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
