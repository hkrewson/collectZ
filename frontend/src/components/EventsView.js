import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Icons, Spinner, cx } from './app/AppPrimitives';

const DEFAULT_EVENT_FORM = {
  title: '',
  url: '',
  location: '',
  date_start: '',
  date_end: '',
  host: '',
  time_label: '',
  room: '',
  notes: ''
};

const DEFAULT_ARTIFACT_FORM = {
  artifact_type: 'note',
  title: '',
  description: '',
  vendor: '',
  price: '',
  image_path: ''
};

const formatUploadError = (message) => {
  const raw = String(message || '');
  if (raw.includes('status code 413')) {
    return 'Image upload failed: file too large (max 10MB)';
  }
  return raw || 'Image upload failed';
};

function EventCard({ item, supportsHover, onOpen, onEdit, onDelete }) {
  return (
    <article className="group relative card p-4 border border-edge/80 cursor-pointer animate-fade-in" onClick={() => onOpen(item)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink truncate">{item.title}</p>
          <p className="text-xs text-ghost mt-1">{item.date_start}{item.location ? ` · ${item.location}` : ''}</p>
          <p className="text-xs text-ghost mt-1">{item.artifact_count || 0} artifact{Number(item.artifact_count || 0) === 1 ? '' : 's'}</p>
        </div>
        <span className="badge badge-dim text-[10px]">#{item.id}</span>
      </div>
      <div className={cx('mt-3 flex gap-2 transition-opacity duration-150', supportsHover ? 'opacity-0 group-hover:opacity-100' : 'opacity-100')}>
        <button className="btn-secondary btn-sm flex-1" onClick={(e) => { e.stopPropagation(); onEdit(item); }}><Icons.Edit />Edit</button>
        <button className="btn-icon btn-sm text-err hover:bg-err/20" onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}><Icons.Trash /></button>
      </div>
    </article>
  );
}

function EventListRow({ item, supportsHover, onOpen, onEdit, onDelete }) {
  return (
    <article className="group flex items-center gap-4 p-3 rounded-lg bg-surface border border-edge hover:border-muted hover:bg-raised cursor-pointer transition-all duration-150 animate-fade-in" onClick={() => onOpen(item)}>
      <div className="w-9 h-9 rounded bg-raised border border-edge flex items-center justify-center text-ghost"><Icons.Activity /></div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ink truncate">{item.title}</p>
        <p className="text-xs text-ghost">{item.date_start}{item.location ? ` · ${item.location}` : ''} · {item.artifact_count || 0} artifacts</p>
      </div>
      <span className="text-xs text-ghost font-mono">#{item.id}</span>
      <div className={cx('flex gap-2 transition-opacity duration-150', supportsHover ? 'opacity-0 group-hover:opacity-100' : 'opacity-100')}>
        <button className="btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); onEdit(item); }}><Icons.Edit /></button>
        <button className="btn-ghost btn-sm text-err hover:bg-err/10" onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}><Icons.Trash /></button>
      </div>
    </article>
  );
}

function EventFormDrawer({ initial, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(() => ({ ...DEFAULT_EVENT_FORM, ...(initial || {}) }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      await onSave({
        ...form,
        date_end: form.date_end || null,
        host: form.host || null,
        time_label: form.time_label || null,
        room: form.room || null,
        notes: form.notes || null
      });
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to save event');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-[1px]" onClick={onClose} />
      <div className="ml-auto h-full w-full max-w-3xl bg-abyss border-l border-edge shadow-2xl relative flex flex-col">
        <div className="px-6 py-4 border-b border-edge flex items-center gap-3">
          <h2 className="section-title !text-xl">{initial?.id ? 'Edit Event' : 'Add Event'}</h2>
          <div className="flex-1" />
          <button className="btn-icon" onClick={onClose}><Icons.X /></button>
        </div>
        <div className="p-6 overflow-y-auto space-y-4">
          {error && <p className="text-sm text-err">{error}</p>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="field md:col-span-2"><span className="label">Title *</span><input className="input" value={form.title || ''} onChange={(e) => set({ title: e.target.value })} /></label>
            <label className="field md:col-span-2"><span className="label">URL *</span><input className="input" value={form.url || ''} onChange={(e) => set({ url: e.target.value })} /></label>
            <label className="field"><span className="label">Location *</span><input className="input" value={form.location || ''} onChange={(e) => set({ location: e.target.value })} /></label>
            <label className="field"><span className="label">Host</span><input className="input" value={form.host || ''} onChange={(e) => set({ host: e.target.value })} /></label>
            <label className="field"><span className="label">Start Date *</span><input type="date" className="input" value={form.date_start || ''} onChange={(e) => set({ date_start: e.target.value })} /></label>
            <label className="field"><span className="label">End Date</span><input type="date" className="input" value={form.date_end || ''} onChange={(e) => set({ date_end: e.target.value })} /></label>
            <label className="field"><span className="label">Time</span><input className="input" value={form.time_label || ''} onChange={(e) => set({ time_label: e.target.value })} /></label>
            <label className="field"><span className="label">Room</span><input className="input" value={form.room || ''} onChange={(e) => set({ room: e.target.value })} /></label>
            <label className="field md:col-span-2"><span className="label">Notes</span><textarea className="textarea min-h-[96px]" value={form.notes || ''} onChange={(e) => set({ notes: e.target.value })} /></label>
          </div>
        </div>
        <div className="shrink-0 border-t border-edge bg-abyss px-6 py-4 flex items-center gap-3">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          {initial?.id && <button type="button" onClick={onDelete} className="btn-danger"><Icons.Trash />Delete</button>}
          <div className="flex-1" />
          <button type="button" onClick={submit} disabled={saving} className="btn-primary min-w-[100px]">{saving ? <Spinner size={16} /> : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

function EventDetailDrawer({ eventId, apiCall, onClose, onEdit, onDeleted, onSaved }) {
  const [event, setEvent] = useState(null);
  const [artifacts, setArtifacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [artifactForm, setArtifactForm] = useState(DEFAULT_ARTIFACT_FORM);
  const [editingArtifactId, setEditingArtifactId] = useState(null);
  const [artifactFile, setArtifactFile] = useState(null);
  const [artifactSaving, setArtifactSaving] = useState(false);
  const [artifactError, setArtifactError] = useState('');
  const [artifactNotice, setArtifactNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const row = await apiCall('get', `/events/${eventId}`);
      if (row) setEvent(row);
      const artifactRows = await apiCall('get', `/events/${eventId}/artifacts`);
      setArtifacts(Array.isArray(artifactRows) ? artifactRows : []);
    } finally {
      setLoading(false);
    }
  }, [apiCall, eventId]);

  useEffect(() => { load(); }, [load]);

  const saveArtifact = async () => {
    if (!artifactForm.title.trim()) return;
    if (artifactSaving) return;
    setArtifactSaving(true);
    setArtifactError('');
    setArtifactNotice('');
    try {
      const payload = {
        artifact_type: artifactForm.artifact_type,
        title: artifactForm.title.trim(),
        description: artifactForm.description || null,
        vendor: artifactForm.vendor || null,
        price: artifactForm.price === '' ? null : Number(artifactForm.price),
        image_path: artifactForm.image_path || null
      };
      let artifactId = editingArtifactId;
      if (editingArtifactId) {
        await apiCall('patch', `/events/${eventId}/artifacts/${editingArtifactId}`, payload);
      } else {
        const created = await apiCall('post', `/events/${eventId}/artifacts`, payload);
        artifactId = created?.id || null;
      }
      let uploadError = '';
      if (artifactFile && artifactId) {
        try {
          const formData = new FormData();
          formData.append('image', artifactFile);
          await apiCall('post', `/events/${eventId}/artifacts/${artifactId}/upload-image`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
          });
        } catch (primaryErr) {
          try {
            const fallbackForm = new FormData();
            fallbackForm.append('cover', artifactFile);
            const uploaded = await apiCall('post', '/media/upload-cover', fallbackForm, {
              headers: { 'Content-Type': 'multipart/form-data' }
            });
            if (uploaded?.path) {
              await apiCall('patch', `/events/${eventId}/artifacts/${artifactId}`, { image_path: uploaded.path });
            } else {
              throw new Error('Fallback upload returned no image path');
            }
          } catch (fallbackErr) {
            const primaryMsg = primaryErr?.response?.data?.error || primaryErr?.message || 'primary upload failed';
            const fallbackMsg = fallbackErr?.response?.data?.error || fallbackErr?.message || 'fallback upload failed';
            uploadError = `${formatUploadError(primaryMsg)}; ${formatUploadError(fallbackMsg)}`;
          }
        }
      }
      setArtifactForm(DEFAULT_ARTIFACT_FORM);
      setEditingArtifactId(null);
      setArtifactFile(null);
      await load();
      onSaved?.();
      if (uploadError) {
        setArtifactError(`Artifact saved, but image upload failed: ${uploadError}`);
      } else {
        setArtifactNotice('Artifact saved');
      }
    } catch (err) {
      setArtifactError(err?.response?.data?.error || 'Failed to save artifact');
    } finally {
      setArtifactSaving(false);
    }
  };

  const removeArtifact = async (artifactId) => {
    if (!window.confirm('Delete this artifact?')) return;
    await apiCall('delete', `/events/${eventId}/artifacts/${artifactId}`);
    await load();
    onSaved?.();
  };

  const editArtifact = (artifact) => {
    setEditingArtifactId(artifact.id);
    setArtifactFile(null);
    setArtifactForm({
      artifact_type: artifact.artifact_type || 'note',
      title: artifact.title || '',
      description: artifact.description || '',
      vendor: artifact.vendor || '',
      price: artifact.price ?? '',
      image_path: artifact.image_path || ''
    });
  };

  const clearArtifactForm = () => {
    setEditingArtifactId(null);
    setArtifactFile(null);
    setArtifactForm(DEFAULT_ARTIFACT_FORM);
    setArtifactError('');
    setArtifactNotice('');
  };

  const removeArtifactImage = async (artifact) => {
    if (!artifact?.id) return;
    await apiCall('delete', `/events/${eventId}/artifacts/${artifact.id}/image`);
    await load();
    onSaved?.();
  };

  const deleteEvent = async () => {
    if (!window.confirm('Delete this event?')) return;
    await apiCall('delete', `/events/${eventId}`);
    onDeleted?.();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-void/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-xl h-full bg-abyss border-l border-edge flex flex-col animate-slide-in">
        <div className="px-6 pt-6 pb-4 border-b border-edge">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <h2 className="font-display text-2xl tracking-wider text-ink leading-tight">{event?.title || `Event #${eventId}`}</h2>
                <p className="text-sm text-ghost">#{eventId}</p>
              </div>
              <p className="text-sm text-dim mt-1">{event?.date_start || ''}{event?.location ? ` · ${event.location}` : ''}</p>
            </div>
            <button onClick={onClose} className="btn-icon btn-sm shrink-0"><Icons.X /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto scroll-area p-6 space-y-4">
          {loading && <div className="flex items-center gap-2 text-dim"><Spinner size={16} />Loading…</div>}
          {!loading && (
            <>
              <div className="grid grid-cols-2 gap-4 text-sm">
                {event?.url && <div><p className="label">URL</p><p className="text-ink break-all">{event.url}</p></div>}
                {event?.host && <div><p className="label">Host</p><p className="text-ink">{event.host}</p></div>}
                {event?.time_label && <div><p className="label">Time</p><p className="text-ink">{event.time_label}</p></div>}
                {event?.room && <div><p className="label">Room</p><p className="text-ink">{event.room}</p></div>}
                {event?.date_end && <div><p className="label">End Date</p><p className="text-ink">{event.date_end}</p></div>}
              </div>
              {event?.notes && <div><p className="label mb-1">Notes</p><p className="text-sm text-dim">{event.notes}</p></div>}
              <div>
                <p className="label mb-2">Artifacts</p>
                <div className="space-y-2">
                  {artifacts.map((a) => (
                    <div key={a.id} className="card p-2 border border-edge/70 flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-ink truncate">{a.title}</p>
                        <p className="text-xs text-ghost">{a.artifact_type}{a.vendor ? ` · ${a.vendor}` : ''}{a.price !== null && a.price !== undefined ? ` · $${a.price}` : ''}</p>
                        {a.image_path ? <span className="badge badge-brand text-[10px] mt-1">Image attached</span> : null}
                      </div>
                      {a.image_path ? (
                        <a className="btn-ghost btn-sm" href={a.image_path} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                          <Icons.Link />
                        </a>
                      ) : null}
                      {a.image_path ? (
                        <button className="btn-ghost btn-sm" onClick={() => removeArtifactImage(a)}>
                          <Icons.X />
                        </button>
                      ) : null}
                      <button className="btn-ghost btn-sm" onClick={() => editArtifact(a)}><Icons.Edit /></button>
                      <button className="btn-ghost btn-sm text-err hover:bg-err/10" onClick={() => removeArtifact(a.id)}><Icons.Trash /></button>
                    </div>
                  ))}
                  {artifacts.length === 0 && <p className="text-xs text-ghost">No artifacts yet.</p>}
                </div>
              </div>
              <div className="card p-3 border border-edge/70">
                <p className="label mb-2">{editingArtifactId ? `Edit Artifact #${editingArtifactId}` : 'Add Artifact'}</p>
                {artifactError ? <p className="text-xs text-err mb-2">{artifactError}</p> : null}
                {artifactNotice ? <p className="text-xs text-ok mb-2">{artifactNotice}</p> : null}
                <div className="grid grid-cols-2 gap-2">
                  <select className="select" value={artifactForm.artifact_type} onChange={(e) => setArtifactForm((p) => ({ ...p, artifact_type: e.target.value }))}>
                    <option value="note">Note</option>
                    <option value="session">Session</option>
                    <option value="person">Person</option>
                    <option value="autograph">Autograph</option>
                    <option value="purchase">Purchase</option>
                    <option value="freebie">Freebie</option>
                  </select>
                  <input className="input" placeholder="Title" value={artifactForm.title} onChange={(e) => setArtifactForm((p) => ({ ...p, title: e.target.value }))} />
                  <input className="input" placeholder="Vendor" value={artifactForm.vendor} onChange={(e) => setArtifactForm((p) => ({ ...p, vendor: e.target.value }))} />
                  <input className="input" placeholder="Price" value={artifactForm.price} onChange={(e) => setArtifactForm((p) => ({ ...p, price: e.target.value }))} />
                  <input className="input col-span-2" placeholder="Image URL (optional)" value={artifactForm.image_path} onChange={(e) => setArtifactForm((p) => ({ ...p, image_path: e.target.value }))} />
                  <input className="input col-span-2" type="file" accept="image/*" capture="environment" onChange={(e) => setArtifactFile(e.target.files?.[0] || null)} />
                  {artifactFile ? <p className="text-xs text-ghost col-span-2">Selected file: {artifactFile.name}</p> : null}
                  <textarea className="textarea col-span-2 min-h-[70px]" placeholder="Description" value={artifactForm.description} onChange={(e) => setArtifactForm((p) => ({ ...p, description: e.target.value }))} />
                  <div className="col-span-2 flex gap-2">
                    <button className="btn-secondary flex-1" onClick={saveArtifact} disabled={artifactSaving}>
                      {artifactSaving
                        ? <><Spinner size={14} />Saving…</>
                        : (editingArtifactId ? <><Icons.Check />Save Artifact</> : <><Icons.Plus />Add Artifact</>)}
                    </button>
                    {editingArtifactId ? <button className="btn-ghost" onClick={clearArtifactForm}>Cancel</button> : null}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
        <div className="p-4 border-t border-edge flex gap-3 shrink-0">
          <button onClick={onClose} className="btn-ghost">Close</button>
          <button onClick={() => onEdit(event)} className="btn-secondary flex-1"><Icons.Edit />Edit</button>
          <button onClick={deleteEvent} className="btn-danger"><Icons.Trash />Delete</button>
        </div>
      </div>
    </div>
  );
}

export default function EventsView({ apiCall, onToast }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [viewMode, setViewMode] = useState('cards');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [detailId, setDetailId] = useState(null);

  const supportsHover = useMemo(() => window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(pageSize));
      if (search.trim()) params.set('q', search.trim());
      if (locationFilter.trim()) params.set('location', locationFilter.trim());
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
      const payload = await apiCall('get', `/events?${params.toString()}`);
      setItems(Array.isArray(payload?.items) ? payload.items : []);
      setPagination(payload?.pagination || { page, limit: pageSize, total: 0, totalPages: 1, hasMore: false });
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load events');
    } finally {
      setLoading(false);
    }
  }, [apiCall, fromDate, locationFilter, page, pageSize, search, toDate]);

  useEffect(() => { load(); }, [load]);

  const saveEvent = async (payload) => {
    if (editing?.id) {
      await apiCall('patch', `/events/${editing.id}`, payload);
      onToast?.('Event saved');
    } else {
      await apiCall('post', '/events', payload);
      onToast?.('Event created');
    }
    setAdding(false);
    setEditing(null);
    await load();
  };

  const deleteEvent = async (id) => {
    if (!window.confirm('Delete this event?')) return;
    await apiCall('delete', `/events/${id}`);
    onToast?.('Event deleted');
    await load();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-edge shrink-0">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="section-title">Events</h1>
          <span className="badge badge-dim ml-1">{pagination.total || items.length}</span>
          <div className="flex-1" />
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ghost pointer-events-none"><Icons.Search /></span>
            <input className="input pl-9 w-56" placeholder="Search events…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <input
            className="input w-44"
            placeholder="Location filter"
            value={locationFilter}
            onChange={(e) => { setLocationFilter(e.target.value); setPage(1); }}
          />
          <input
            type="date"
            className="input w-40"
            value={fromDate}
            onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
            title="From date"
          />
          <input
            type="date"
            className="input w-40"
            value={toDate}
            onChange={(e) => { setToDate(e.target.value); setPage(1); }}
            title="To date"
          />
          <div className="tab-strip">
            <button className={cx('tab', viewMode === 'cards' && 'active')} onClick={() => setViewMode('cards')}><Icons.Film /></button>
            <button className={cx('tab', viewMode === 'list' && 'active')} onClick={() => setViewMode('list')}><Icons.List /></button>
          </div>
          <button onClick={() => setAdding(true)} className="btn-primary"><Icons.Plus />Add</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto scroll-area p-6">
        {error && <p className="text-sm text-err mb-4">{error}</p>}
        {loading && <div className="flex items-center justify-center py-20"><Spinner size={32} /></div>}
        {!loading && items.length === 0 && <div className="text-sm text-ghost">No events found.</div>}
        {!loading && viewMode === 'cards' && items.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {items.map((item) => (
              <EventCard
                key={item.id}
                item={item}
                supportsHover={supportsHover}
                onOpen={() => setDetailId(item.id)}
                onEdit={() => setEditing(item)}
                onDelete={deleteEvent}
              />
            ))}
          </div>
        )}
        {!loading && viewMode === 'list' && items.length > 0 && (
          <div className="space-y-2">
            {items.map((item) => (
              <EventListRow
                key={item.id}
                item={item}
                supportsHover={supportsHover}
                onOpen={() => setDetailId(item.id)}
                onEdit={() => setEditing(item)}
                onDelete={deleteEvent}
              />
            ))}
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-edge px-6 py-3 flex items-center gap-3 flex-wrap">
        <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={loading || page <= 1} className="btn-secondary btn-sm">Previous</button>
        <span className="text-xs text-ghost font-mono">Page {page} / {pagination.totalPages || 1}</span>
        <button onClick={() => setPage((p) => p + 1)} disabled={loading || !pagination.hasMore} className="btn-secondary btn-sm">Next</button>
        <div className="ml-auto flex items-center gap-2">
          <label className="text-xs text-ghost">Page size</label>
          <select className="select w-24" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
      </div>
      {(adding || editing) && (
        <EventFormDrawer
          initial={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSave={saveEvent}
          onDelete={editing?.id ? async () => { await deleteEvent(editing.id); setEditing(null); } : null}
        />
      )}
      {detailId && (
        <EventDetailDrawer
          eventId={detailId}
          apiCall={apiCall}
          onClose={() => setDetailId(null)}
          onEdit={(item) => { setDetailId(null); setEditing(item); }}
          onDeleted={load}
          onSaved={load}
        />
      )}
    </div>
  );
}
