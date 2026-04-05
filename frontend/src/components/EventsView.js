import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CameraCaptureModal, Icons, Spinner, SectionTabs, cx, posterUrl, ObjectPosterCard } from './app/AppPrimitives';

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

const toInputDate = (value) => {
  if (!value) return '';
  const text = String(value).trim();
  if (!text) return '';
  const isoDateMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDateMatch) return isoDateMatch[1];
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
};

const toDisplayDate = (value) => {
  const normalized = toInputDate(value);
  if (!normalized) return '';
  const [year, month, day] = normalized.split('-');
  return `${month}/${day}/${year}`;
};

const formatUploadError = (message) => {
  const raw = String(message || '');
  if (raw.includes('status code 413')) {
    return 'Image upload failed: file too large (max 10MB)';
  }
  return raw || 'Image upload failed';
};

const pluralizeArtifacts = (count) => `${count || 0} artifact${Number(count || 0) === 1 ? '' : 's'}`;

function MetaPill({ children, tone = 'default' }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium tracking-wide',
        tone === 'brand'
          ? 'border-brand/30 bg-brand/10 text-brand'
          : 'border-edge bg-surface text-dim'
      )}
    >
      {children}
    </span>
  );
}

function DetailField({ label, children, className = '' }) {
  if (!children) return null;
  return (
    <div className={className}>
      <p className="label">{label}</p>
      <div className="mt-1 text-sm text-ink">{children}</div>
    </div>
  );
}

function EventCard({ item, supportsHover, onOpen, onEdit, onDelete }) {
  return (
    <ObjectPosterCard
      title={item.title}
      imagePath={item.image_path}
      fallbackIcon={<Icons.Activity />}
      supportsHover={supportsHover}
      onOpen={() => onOpen(item)}
      leftBadges={[`#${item.id}`, toDisplayDate(item.date_start) || 'Date pending']}
      rightBadge={item.host ? <span className="badge badge-brand text-[10px] backdrop-blur-sm bg-brand/20 border-brand/30">{item.host}</span> : null}
      subtitle={item.location || 'Location not set'}
      meta={
        <>
          <MetaPill>{pluralizeArtifacts(item.artifact_count)}</MetaPill>
          {item.room ? <MetaPill>{`Room ${item.room}`}</MetaPill> : null}
        </>
      }
      onEdit={() => onEdit(item)}
      onDelete={() => onDelete(item.id)}
    />
  );
}

function EventListRow({ item, supportsHover, onOpen, onEdit, onDelete }) {
  return (
    <article className="group flex items-center gap-4 rounded-xl border border-edge bg-surface p-3 hover:border-muted hover:bg-raised cursor-pointer transition-all duration-150 animate-fade-in" onClick={() => onOpen(item)}>
      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-edge bg-raised text-ghost"><Icons.Activity /></div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ink truncate">{item.title}</p>
        <div className="mt-1 flex flex-wrap gap-2">
          <MetaPill>{toDisplayDate(item.date_start) || 'Date pending'}</MetaPill>
          {item.location ? <MetaPill>{item.location}</MetaPill> : null}
          <MetaPill>{pluralizeArtifacts(item.artifact_count)}</MetaPill>
        </div>
      </div>
      <span className="text-xs text-ghost font-mono">#{item.id}</span>
      <div className={cx('flex gap-2 transition-opacity duration-150', supportsHover ? 'opacity-0 group-hover:opacity-100' : 'opacity-100')}>
        <button className="btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); onEdit(item); }}><Icons.Edit />Edit</button>
        <button className="btn-ghost btn-sm text-err hover:bg-err/10" onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}><Icons.Trash /></button>
      </div>
    </article>
  );
}

function EventArtifactsEditor({ eventId, apiCall, onSaved }) {
  const [artifacts, setArtifacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [artifactEditorOpen, setArtifactEditorOpen] = useState(false);
  const [artifactForm, setArtifactForm] = useState(DEFAULT_ARTIFACT_FORM);
  const [editingArtifactId, setEditingArtifactId] = useState(null);
  const [artifactFile, setArtifactFile] = useState(null);
  const [artifactSaving, setArtifactSaving] = useState(false);
  const [artifactError, setArtifactError] = useState('');
  const [artifactNotice, setArtifactNotice] = useState('');

  const loadArtifacts = useCallback(async () => {
    setLoading(true);
    try {
      const artifactRows = await apiCall('get', `/events/${eventId}/artifacts`);
      setArtifacts(Array.isArray(artifactRows) ? artifactRows : []);
    } finally {
      setLoading(false);
    }
  }, [apiCall, eventId]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await loadArtifacts();
      } catch (_) {
        if (active) {
          setArtifactError('Failed to load event artifacts');
          setLoading(false);
        }
      }
    })();
    return () => { active = false; };
  }, [loadArtifacts]);

  const clearArtifactForm = useCallback(() => {
    setEditingArtifactId(null);
    setArtifactFile(null);
    setArtifactForm(DEFAULT_ARTIFACT_FORM);
    setArtifactError('');
    setArtifactNotice('');
  }, []);

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

      clearArtifactForm();
      await loadArtifacts();
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
    await loadArtifacts();
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

  const removeArtifactImage = async (artifact) => {
    if (!artifact?.id) return;
    await apiCall('delete', `/events/${eventId}/artifacts/${artifact.id}/image`);
    await loadArtifacts();
    onSaved?.();
  };

  const formatArtifactMeta = (artifact) => {
    const parts = [];
    if (artifact?.artifact_type) parts.push(artifact.artifact_type);
    if (artifact?.vendor) parts.push(artifact.vendor);
    if (artifact?.price !== null && artifact?.price !== undefined && artifact?.price !== '') {
      parts.push(`$${artifact.price}`);
    }
    return parts.join(' · ');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <p className="text-sm text-dim">{pluralizeArtifacts(artifacts.length)}</p>
        <div className="flex-1" />
        <button
          className="btn-ghost btn-sm"
          onClick={() => {
            setArtifactEditorOpen((open) => {
              const next = !open;
              if (!next) clearArtifactForm();
              return next;
            });
          }}
        >
          {artifactEditorOpen ? 'Done' : 'Edit schedule'}
        </button>
      </div>
      {loading ? <div className="flex items-center gap-2 text-dim"><Spinner size={16} />Loading schedule…</div> : null}
      {artifactError ? <p className="text-xs text-err">{artifactError}</p> : null}
      {artifactNotice ? <p className="text-xs text-ok">{artifactNotice}</p> : null}
      <div className="overflow-hidden rounded-md border border-edge bg-panel/20">
        {artifacts.map((artifact) => (
          <div key={artifact.id} className="flex items-start gap-3 border-b border-edge/60 px-3 py-3 last:border-b-0">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{artifact.title}</p>
              {formatArtifactMeta(artifact) ? (
                <p className="mt-1 text-xs text-dim">{formatArtifactMeta(artifact)}</p>
              ) : null}
              {artifact.description ? <p className="mt-2 text-sm text-ghost">{artifact.description}</p> : null}
            </div>
            {artifact.image_path ? (
              <a
                className="btn-ghost btn-sm"
                href={artifact.image_path}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                aria-label={`Open image for ${artifact.title}`}
              >
                <Icons.Link />
              </a>
            ) : null}
            {artifactEditorOpen && artifact.image_path ? (
              <button className="btn-ghost btn-sm" onClick={() => removeArtifactImage(artifact)} aria-label={`Remove image from ${artifact.title}`}>
                <Icons.X />
              </button>
            ) : null}
            {artifactEditorOpen ? (
              <button className="btn-ghost btn-sm" onClick={() => editArtifact(artifact)} aria-label={`Edit ${artifact.title}`}>
                <Icons.Edit />
              </button>
            ) : null}
            {artifactEditorOpen ? (
              <button className="btn-ghost btn-sm text-err hover:bg-err/10" onClick={() => removeArtifact(artifact.id)} aria-label={`Delete ${artifact.title}`}>
                <Icons.Trash />
              </button>
            ) : null}
          </div>
        ))}
        {!loading && artifacts.length === 0 ? (
          <div className="px-4 py-5 text-sm text-ghost">
            No schedule items yet.
          </div>
        ) : null}
      </div>
      {artifactEditorOpen ? (
        <div className="space-y-3 border-t border-edge/60 pt-4">
          <p className="text-sm font-medium text-ink">{editingArtifactId ? `Edit entry #${editingArtifactId}` : 'Add schedule item'}</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="field">
              <span className="label">Type</span>
              <select className="select" value={artifactForm.artifact_type} onChange={(e) => setArtifactForm((prev) => ({ ...prev, artifact_type: e.target.value }))}>
                <option value="note">Note</option>
                <option value="session">Session</option>
                <option value="person">Person</option>
                <option value="autograph">Autograph</option>
                <option value="purchase">Purchase</option>
                <option value="freebie">Freebie</option>
              </select>
            </label>
            <label className="field">
              <span className="label">Title</span>
              <input className="input" value={artifactForm.title} onChange={(e) => setArtifactForm((prev) => ({ ...prev, title: e.target.value }))} />
            </label>
            <label className="field">
              <span className="label">Vendor</span>
              <input className="input" value={artifactForm.vendor} onChange={(e) => setArtifactForm((prev) => ({ ...prev, vendor: e.target.value }))} />
            </label>
            <label className="field">
              <span className="label">Price</span>
              <input className="input" inputMode="decimal" value={artifactForm.price} onChange={(e) => setArtifactForm((prev) => ({ ...prev, price: e.target.value }))} />
            </label>
            <label className="field md:col-span-2">
              <span className="label">Image URL</span>
              <input className="input" placeholder="Optional" value={artifactForm.image_path} onChange={(e) => setArtifactForm((prev) => ({ ...prev, image_path: e.target.value }))} />
            </label>
            <label className="field md:col-span-2">
              <span className="label">Image</span>
              <input className="input" type="file" accept="image/*" capture="environment" onChange={(e) => setArtifactFile(e.target.files?.[0] || null)} />
            </label>
            {artifactFile ? <p className="text-xs text-ghost md:col-span-2">Selected file: {artifactFile.name}</p> : null}
            <label className="field md:col-span-2">
              <span className="label">Notes</span>
              <textarea className="textarea min-h-[88px]" value={artifactForm.description} onChange={(e) => setArtifactForm((prev) => ({ ...prev, description: e.target.value }))} />
            </label>
            <div className="md:col-span-2 flex gap-2">
              <button className="btn-secondary flex-1" onClick={saveArtifact} disabled={artifactSaving}>
                {artifactSaving
                  ? <><Spinner size={14} />Saving…</>
                  : (editingArtifactId ? <><Icons.Check />Save Entry</> : <><Icons.Plus />Add Entry</>)}
              </button>
              {editingArtifactId ? <button className="btn-ghost" onClick={clearArtifactForm}>Cancel</button> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function EventFormDrawer({ initial, apiCall, onClose, onSave, onDelete, onClearImage }) {
  const [form, setForm] = useState(() => ({
    ...DEFAULT_EVENT_FORM,
    ...(initial || {}),
    date_start: toInputDate(initial?.date_start),
    date_end: toInputDate(initial?.date_end)
  }));
  const [imageFile, setImageFile] = useState(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const eventTabs = useMemo(() => ([
    { id: 'core', label: 'Core Details' },
    { id: 'subevents', label: 'Schedule' },
    { id: 'storage', label: 'Storage & Notes' }
  ]), []);
  const [activeTab, setActiveTab] = useState('core');

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    setForm({
      ...DEFAULT_EVENT_FORM,
      ...(initial || {}),
      date_start: toInputDate(initial?.date_start),
      date_end: toInputDate(initial?.date_end)
    });
    setImageFile(null);
    setActiveTab('core');
  }, [initial]);

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
        image_path: form.image_path || null,
        notes: form.notes || null
      }, imageFile);
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to save event');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-[1px]" onClick={onClose} />
      <div className="ml-auto h-full w-full max-w-[40rem] bg-abyss border-l border-edge shadow-2xl relative flex flex-col">
        <div className="px-6 py-4 border-b border-edge flex items-center gap-3">
          <h2 className="section-title !text-xl">{initial?.id ? 'Edit Event' : 'Add Event'}</h2>
          <div className="flex-1" />
          <button className="btn-icon" onClick={onClose}><Icons.X /></button>
        </div>
        <div className="p-6 overflow-y-auto space-y-4">
          {error && <p className="text-sm text-err">{error}</p>}
          <SectionTabs
            tabs={eventTabs}
            activeId={activeTab}
            onChange={setActiveTab}
            showIndex
            stretch
            ariaLabel="Event editor steps"
          />
          <div className="space-y-4 border-t border-edge/60 pt-3">

            {activeTab === 'core' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="field md:col-span-2"><span className="label">Title *</span><input className="input" value={form.title || ''} onChange={(e) => set({ title: e.target.value })} /></label>
                <label className="field md:col-span-2"><span className="label">URL *</span><input className="input" value={form.url || ''} onChange={(e) => set({ url: e.target.value })} /></label>
                <label className="field"><span className="label">Location *</span><input className="input" value={form.location || ''} onChange={(e) => set({ location: e.target.value })} /></label>
                <label className="field"><span className="label">Host</span><input className="input" value={form.host || ''} onChange={(e) => set({ host: e.target.value })} /></label>
                <label className="field"><span className="label">Start Date *</span><input type="date" className="input" value={form.date_start || ''} onChange={(e) => set({ date_start: e.target.value })} /></label>
                <label className="field"><span className="label">End Date</span><input type="date" className="input" value={form.date_end || ''} onChange={(e) => set({ date_end: e.target.value })} /></label>
                <label className="field"><span className="label">Time</span><input className="input" value={form.time_label || ''} onChange={(e) => set({ time_label: e.target.value })} /></label>
                <label className="field"><span className="label">Room</span><input className="input" value={form.room || ''} onChange={(e) => set({ room: e.target.value })} /></label>
              </div>
            ) : null}

            {activeTab === 'subevents' ? (
              initial?.id ? (
                <EventArtifactsEditor eventId={initial.id} apiCall={apiCall} onSaved={() => {}} />
              ) : (
                <div className="rounded-md border border-dashed border-edge px-4 py-6 text-sm text-ghost">
                  Save the event first, then come back here to add panels, parties, signings, purchases, and other sub-event history.
                </div>
              )
            ) : null}

            {activeTab === 'storage' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="field md:col-span-2"><span className="label">Image URL (optional)</span><input className="input" value={form.image_path || ''} onChange={(e) => set({ image_path: e.target.value })} /></label>
                <label className="field md:col-span-2"><span className="label">Upload/Capture image</span><input className="input" type="file" accept="image/*" capture="environment" onChange={(e) => setImageFile(e.target.files?.[0] || null)} /></label>
                <div className="md:col-span-2 flex items-center gap-2">
                  <button type="button" onClick={() => setCameraOpen(true)} className="btn-secondary btn-sm"><Icons.Camera />Camera</button>
                </div>
                {imageFile ? <p className="text-xs text-ghost md:col-span-2">Selected file: {imageFile.name}</p> : null}
                {form.image_path ? (
                  <div className="md:col-span-2 flex items-center gap-2">
                    <a className="btn-ghost btn-sm" href={form.image_path} target="_blank" rel="noreferrer"><Icons.Link />Open image</a>
                    {initial?.id ? <button className="btn-ghost btn-sm" onClick={onClearImage}><Icons.X />Remove image</button> : null}
                  </div>
                ) : null}
                <label className="field md:col-span-2"><span className="label">Notes</span><textarea className="textarea min-h-[96px]" value={form.notes || ''} onChange={(e) => set({ notes: e.target.value })} /></label>
              </div>
            ) : null}
          </div>
        </div>
        <div className="shrink-0 border-t border-edge bg-abyss px-6 py-4 flex items-center gap-3">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          {initial?.id && <button type="button" onClick={onDelete} className="btn-danger"><Icons.Trash />Delete</button>}
          <div className="flex-1" />
          <button type="button" onClick={submit} disabled={saving} className="btn-primary min-w-[100px]">{saving ? <Spinner size={16} /> : 'Save'}</button>
        </div>
        <CameraCaptureModal
          open={cameraOpen}
          title="Capture event image"
          description="Capture an event image and attach it directly to this event."
          confirmLabel="Use event image"
          onClose={() => setCameraOpen(false)}
          onCapture={async (file) => {
            setImageFile(file);
          }}
        />
      </div>
    </div>
  );
}

function EventDetailDrawer({ eventId, apiCall, onClose, onEdit, onDeleted, onSaved }) {
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const row = await apiCall('get', `/events/${eventId}`);
      if (row) setEvent(row);
    } finally {
      setLoading(false);
    }
  }, [apiCall, eventId]);

  useEffect(() => { load(); }, [load]);

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
        {event?.image_path ? (
          <div className="relative h-48 shrink-0 overflow-hidden">
            <img src={posterUrl(event.image_path)} alt="" className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-hero-fade" />
          </div>
        ) : null}
        <div className="px-6 pt-6 pb-4 border-b border-edge">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <h2 className="font-display text-2xl tracking-wider text-ink leading-tight">{event?.title || `Event #${eventId}`}</h2>
                <p className="text-sm text-ghost">#{eventId}</p>
              </div>
              <p className="text-sm text-dim mt-1">{toDisplayDate(event?.date_start)}{event?.location ? ` · ${event.location}` : ''}</p>
            </div>
            <button onClick={onClose} className="btn-icon btn-sm shrink-0"><Icons.X /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto scroll-area p-6 space-y-4">
          {loading && <div className="flex items-center gap-2 text-dim"><Spinner size={16} />Loading…</div>}
          {!loading && (
            <>
              <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
                <DetailField label="Start Date">{toDisplayDate(event?.date_start) || 'Date pending'}</DetailField>
                <DetailField label="End Date">{event?.date_end ? toDisplayDate(event.date_end) : 'Single day event'}</DetailField>
                <DetailField label="Location">{event?.location}</DetailField>
                <DetailField label="Room">{event?.room}</DetailField>
                <DetailField label="Time">{event?.time_label}</DetailField>
                <DetailField label="Host">{event?.host}</DetailField>
                {event?.image_path ? (
                  <DetailField label="Image" className="md:col-span-2">
                    <a className="btn-secondary btn-sm w-fit" href={event.image_path} target="_blank" rel="noreferrer"><Icons.Link />Open image</a>
                  </DetailField>
                ) : null}
                {event?.url ? (
                  <DetailField label="URL" className="md:col-span-2">
                    <a className="btn-secondary btn-sm w-fit" href={event.url} target="_blank" rel="noreferrer"><Icons.Link />Open event site</a>
                  </DetailField>
                ) : null}
              </div>
              {event?.notes ? <DetailField label="Notes"><p className="text-dim">{event.notes}</p></DetailField> : null}
              <EventArtifactsEditor eventId={eventId} apiCall={apiCall} onSaved={onSaved} />
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
  const [sortDir, setSortDir] = useState('asc');
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
  const activeFilterCount = useMemo(() => [search.trim(), fromDate, toDate].filter(Boolean).length, [fromDate, search, toDate]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(pageSize));
      if (search.trim()) params.set('q', search.trim());
      params.set('sort_dir', sortDir);
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
  }, [apiCall, fromDate, page, pageSize, search, sortDir, toDate]);

  useEffect(() => { load(); }, [load]);

  const saveEvent = async (payload, imageFile) => {
    if (editing?.id) {
      await apiCall('patch', `/events/${editing.id}`, payload);
      if (imageFile) {
        const formData = new FormData();
        formData.append('image', imageFile);
        await apiCall('post', `/events/${editing.id}/upload-image`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
      }
      onToast?.('Event saved');
    } else {
      const created = await apiCall('post', '/events', payload);
      if (imageFile && created?.id) {
        const formData = new FormData();
        formData.append('image', imageFile);
        await apiCall('post', `/events/${created.id}/upload-image`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
      }
      onToast?.('Event created');
    }
    setAdding(false);
    setEditing(null);
    await load();
  };

  const clearEventImage = async () => {
    if (!editing?.id) return;
    await apiCall('delete', `/events/${editing.id}/image`);
    onToast?.('Event image removed');
    const refreshed = await apiCall('get', `/events/${editing.id}`);
    setEditing(refreshed);
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
        <div className="flex items-start gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="section-title">Events</h1>
              <span className="badge badge-dim">{pagination.total || items.length}</span>
              {activeFilterCount > 0 ? <MetaPill tone="brand">{`${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'} active`}</MetaPill> : null}
            </div>
            <p className="mt-1 text-sm text-ghost">Track conventions, screenings, meetups, and the artifacts you picked up along the way.</p>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ghost pointer-events-none"><Icons.Search /></span>
            <input className="input pl-9 w-56" placeholder="Search title or location…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
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
          <button
            onClick={() => { setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); setPage(1); }}
            className="btn-icon"
            title={sortDir === 'asc' ? 'Sort ascending' : 'Sort descending'}
          >
            {sortDir === 'asc' ? <Icons.ArrowUp /> : <Icons.ArrowDown />}
          </button>
          <button onClick={() => setAdding(true)} className="btn-primary"><Icons.Plus />Add</button>
          </div>
        </div>
        {activeFilterCount > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {search.trim() ? <MetaPill>{`Search: ${search.trim()}`}</MetaPill> : null}
            {fromDate ? <MetaPill>{`From ${toDisplayDate(fromDate)}`}</MetaPill> : null}
            {toDate ? <MetaPill>{`To ${toDisplayDate(toDate)}`}</MetaPill> : null}
            <button className="btn-ghost btn-sm" onClick={() => { setSearch(''); setFromDate(''); setToDate(''); setPage(1); }}>Clear filters</button>
          </div>
        ) : null}
      </div>
      <div className="flex-1 overflow-y-auto scroll-area p-6">
        {error && <p className="text-sm text-err mb-4">{error}</p>}
        {loading && <div className="flex items-center justify-center py-20"><Spinner size={32} /></div>}
        {!loading && items.length === 0 && (
          <div className="rounded-2xl border border-dashed border-edge bg-surface px-5 py-8 text-sm text-ghost">
            No events found. Start with a convention, screening, meetup, or release event so related artifacts have a home.
          </div>
        )}
        {!loading && viewMode === 'cards' && items.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
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
          apiCall={apiCall}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSave={saveEvent}
          onDelete={editing?.id ? async () => { await deleteEvent(editing.id); setEditing(null); } : null}
          onClearImage={clearEventImage}
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
