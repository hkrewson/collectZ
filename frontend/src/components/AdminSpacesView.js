import React, { useCallback, useEffect, useMemo, useState } from 'react';

function emptyCreateForm() {
  return { name: '', slug: '', description: '', owner_user_id: '' };
}

export default function AdminSpacesView({ apiCall, onToast, Spinner, cx }) {
  const [spaces, setSpaces] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [createForm, setCreateForm] = useState(() => emptyCreateForm());
  const [creating, setCreating] = useState(false);
  const [ownerAssignments, setOwnerAssignments] = useState({});
  const [busySpaceId, setBusySpaceId] = useState(null);

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

  const createSpace = async (event) => {
    event.preventDefault();
    setCreating(true);
    try {
      const payload = {
        name: createForm.name,
        slug: createForm.slug || null,
        description: createForm.description || null
      };
      if (createForm.owner_user_id) payload.owner_user_id = Number(createForm.owner_user_id);
      await apiCall('post', '/admin/spaces', payload);
      setCreateForm(emptyCreateForm());
      await loadPlatformData();
      onToast('Space created');
    } catch (error) {
      onToast(error.response?.data?.detail || error.response?.data?.error || 'Failed to create space', 'error');
    } finally {
      setCreating(false);
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
    return <div className="p-6 flex items-center gap-3 text-dim"><Spinner />Loading spaces…</div>;
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6 max-w-6xl">
      <div className="space-y-2">
        <h1 className="section-title">Server Spaces</h1>
        <p className="text-sm text-ghost max-w-3xl">
          Platform control plane for global admins. Create spaces, recover owners, and archive or delete empty spaces without joining those tenant spaces.
        </p>
      </div>

      {loadError ? <p className="text-sm text-err">{loadError}</p> : null}

      <form className="card p-5 space-y-4" onSubmit={createSpace}>
        <div>
          <h2 className="text-xl font-medium text-ink">Create Space</h2>
          <p className="text-sm text-ghost mt-1">New spaces stay out of tenant management until their owner joins and works inside them.</p>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <label className="field">
            <span className="label">Name</span>
            <input className="input" value={createForm.name} onChange={(e) => setCreateForm((prev) => ({ ...prev, name: e.target.value }))} required />
          </label>
          <label className="field">
            <span className="label">Slug</span>
            <input className="input" value={createForm.slug} onChange={(e) => setCreateForm((prev) => ({ ...prev, slug: e.target.value }))} />
          </label>
          <label className="field xl:col-span-2">
            <span className="label">Description</span>
            <textarea className="textarea min-h-[96px]" value={createForm.description} onChange={(e) => setCreateForm((prev) => ({ ...prev, description: e.target.value }))} />
          </label>
          <label className="field xl:col-span-2">
            <span className="label">Initial Owner</span>
            <select className="select" value={createForm.owner_user_id} onChange={(e) => setCreateForm((prev) => ({ ...prev, owner_user_id: e.target.value }))}>
              <option value="">Current admin</option>
              {userOptions.map((user) => (
                <option key={user.id} value={user.id}>{user.label}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex justify-end">
          <button type="submit" className="btn-primary min-w-[132px]" disabled={creating}>
            {creating ? <Spinner size={14} /> : 'Create Space'}
          </button>
        </div>
      </form>

      <div className="card divide-y divide-edge">
        {spaces.length === 0 && <p className="px-5 py-8 text-sm text-ghost text-center">No spaces found.</p>}
        {spaces.map((space) => {
          const ownerSummary = Array.isArray(space.owners) ? space.owners : [];
          const selectedOwner = ownerAssignments[space.id] || '';
          const archived = Boolean(space.archived_at);
          const canArchive = !archived && Number(space.library_count || 0) === 0 && space.slug !== 'default';
          const canDelete = archived && Number(space.library_count || 0) === 0 && space.slug !== 'default';
          return (
            <div key={space.id} className="px-5 py-5 space-y-4">
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
                  <label className="field">
                    <span className="label">Recover or Add Owner</span>
                    <div className="flex gap-2">
                      <select
                        className="select flex-1"
                        value={selectedOwner}
                        onChange={(e) => setOwnerAssignments((prev) => ({ ...prev, [space.id]: e.target.value }))}
                      >
                        <option value="">Select user</option>
                        {userOptions.map((user) => (
                          <option key={user.id} value={user.id}>{user.label}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn-secondary btn-sm shrink-0"
                        disabled={!selectedOwner || busySpaceId === space.id}
                        onClick={() => assignOwner(space.id)}
                      >
                        {busySpaceId === space.id ? <Spinner size={12} /> : 'Assign'}
                      </button>
                    </div>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      disabled={!canArchive || busySpaceId === space.id}
                      onClick={() => setArchived(space.id, true)}
                      title={space.slug === 'default' ? 'Default space is protected' : Number(space.library_count || 0) > 0 ? 'Empty the space first' : 'Archive space'}
                    >
                      {busySpaceId === space.id ? <Spinner size={12} /> : 'Archive'}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      disabled={!archived || space.slug === 'default' || busySpaceId === space.id}
                      onClick={() => setArchived(space.id, false)}
                    >
                      {busySpaceId === space.id ? <Spinner size={12} /> : 'Unarchive'}
                    </button>
                    <button
                      type="button"
                      className="btn-danger btn-sm"
                      disabled={!canDelete || busySpaceId === space.id}
                      onClick={() => deleteSpace(space.id)}
                    >
                      {busySpaceId === space.id ? <Spinner size={12} /> : 'Delete'}
                    </button>
                  </div>
                  {!canArchive && !archived && Number(space.library_count || 0) > 0 ? (
                    <p className="text-xs text-ghost">Archive is limited to empty spaces in this slice.</p>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
