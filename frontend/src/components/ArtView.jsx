import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CameraCaptureModal, CollectionPaginationFooter, Icons, Spinner, SectionTabPanel, SectionTabs, cx, posterUrl, ObjectPosterCard } from './app/AppPrimitives';

const DEFAULT_FORM = {
  title: '',
  series: '',
  artist: '',
  event_id: '',
  vendor: '',
  booth: '',
  price: '',
  exclusive: false,
  image_path: '',
  notes: ''
};

const parseUploadError = (message) => {
  const raw = String(message || '');
  if (raw.includes('status code 413')) return 'Image upload failed: file too large (max 10MB)';
  return raw || 'Image upload failed';
};

const hasPurchaseContext = (item) => {
  const record = item || {};
  return Boolean(
    record.event_id
    || record.event_title
    || record.vendor
    || record.booth
    || record.booth_or_vendor
  );
};

function FilterPill({ children, tone = 'default' }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-md border px-2 py-1 text-[11px] font-medium',
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

function ArtCard({ item, supportsHover, onOpen, onEdit, onDelete }) {
  const subtitle = [item.series, item.artist, item.event_title].filter(Boolean).join(' · ');
  return (
    <ObjectPosterCard
      title={item.title}
      imagePath={item.image_path}
      fallbackIcon={<Icons.Library />}
      supportsHover={supportsHover}
      onOpen={() => onOpen(item)}
      leftBadges={[`#${item.id}`, 'Art']}
      rightBadge={item.exclusive ? <span className="badge badge-brand text-[10px] bg-brand/20 border-brand/30">Exclusive</span> : null}
      subtitle={subtitle || 'Artwork'}
      meta={
        <>
          {item.artist ? <FilterPill>{item.artist}</FilterPill> : null}
          {item.series ? <FilterPill>{item.series}</FilterPill> : null}
          {item.event_title ? <FilterPill>{item.event_title}</FilterPill> : null}
        </>
      }
      onEdit={() => onEdit(item)}
      onDelete={() => onDelete(item.id)}
    />
  );
}

function ArtRow({ item, supportsHover, onOpen, onEdit, onDelete }) {
  return (
    <article className="group flex items-center gap-4 rounded-xl border border-edge bg-surface p-3 hover:border-muted hover:bg-raised transition-colors duration-150 animate-fade-in cursor-pointer" onClick={() => onOpen(item)}>
      <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-edge bg-raised text-ghost"><Icons.Activity /></div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ink truncate">{item.title}</p>
        <div className="mt-1 flex flex-wrap gap-2">
          <FilterPill>Art</FilterPill>
          {item.series ? <FilterPill>{item.series}</FilterPill> : null}
          {item.artist ? <FilterPill>{item.artist}</FilterPill> : null}
          {item.event_title ? <FilterPill>{item.event_title}</FilterPill> : null}
          {item.exclusive ? <FilterPill tone="brand">Exclusive</FilterPill> : null}
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

function ArtDetailDrawer({ artId, apiCall, events, onClose, onEdit, onDeleted }) {
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const row = await apiCall('get', `/art/${artId}`);
      setItem(row || null);
    } finally {
      setLoading(false);
    }
  }, [apiCall, artId]);

  useEffect(() => { load(); }, [load]);

  const deleteArt = async () => {
    if (!item?.id) return;
    if (!window.confirm('Delete this art piece?')) return;
    await apiCall('delete', `/art/${item.id}`);
    onDeleted?.();
    onClose();
  };

  const resolvedEvent = item?.event_title
    || events.find((evt) => String(evt.id) === String(item?.event_id))?.title
    || null;
  const showPurchaseContext = hasPurchaseContext(item);
  const factSummary = [item?.series, item?.artist, resolvedEvent].filter(Boolean);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-void/72" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-xl h-full bg-abyss border-l border-edge flex flex-col animate-slide-in">
        {item?.image_path ? (
          <div className="relative h-48 shrink-0 overflow-hidden">
            <img src={posterUrl(item.image_path)} alt="" className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-hero-fade" />
          </div>
        ) : null}
        <div className="flex items-start gap-4 px-6 pt-6 pb-4 shrink-0">
          {item?.image_path ? (
            <div className="relative z-10 -mt-16 w-20 shrink-0 shadow-card">
              <div className="poster rounded-md">
                <img src={posterUrl(item.image_path)} alt={item?.title || 'Art'} className="absolute inset-0 h-full w-full object-cover" />
              </div>
            </div>
          ) : null}
          <div className={cx('min-w-0 flex-1', item?.image_path ? 'mt-1' : '')}>
            <div className="flex items-baseline gap-2">
              <h2 className="text-2xl font-semibold tracking-tight text-ink leading-tight">{item?.title || `Art #${artId}`}</h2>
              <p className="text-sm text-ghost">#{artId}</p>
            </div>
            <p className="mt-1 text-sm text-dim">{factSummary.join(' · ')}</p>
          </div>
          <button onClick={onClose} className="btn-icon btn-sm shrink-0"><Icons.X /></button>
        </div>
        <div className="divider" />
        <div className="flex-1 overflow-y-auto scroll-area p-6 space-y-5">
          {loading ? <div className="flex items-center gap-2 text-dim"><Spinner size={16} />Loading…</div> : null}
          {!loading && item ? (
            <div className="grid grid-cols-1 gap-x-8 gap-y-5 text-sm md:grid-cols-2">
              <DetailField label="Series">{item.series}</DetailField>
              <DetailField label="Artist">{item.artist}</DetailField>
              <DetailField label="Event">{resolvedEvent || 'None linked'}</DetailField>
              <DetailField label="Exclusive">{item.exclusive ? 'Yes' : 'No'}</DetailField>
              {showPurchaseContext ? <DetailField label="Vendor">{item.vendor || item.booth_or_vendor}</DetailField> : null}
              {showPurchaseContext ? <DetailField label="Booth">{item.booth}</DetailField> : null}
              <DetailField label="Price">{item.price !== null && item.price !== undefined && item.price !== '' ? `$${item.price}` : null}</DetailField>
              {item.image_path ? (
                <DetailField label="Image">
                  <a className="inline-flex items-center gap-2 text-dim transition-colors hover:text-ink" href={item.image_path} target="_blank" rel="noreferrer"><Icons.Link />Open image</a>
                </DetailField>
              ) : null}
              {item.notes ? (
                <DetailField label="Notes" className="md:col-span-2">
                  <p className="max-w-3xl text-dim leading-7">{item.notes}</p>
                </DetailField>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="p-4 border-t border-edge flex gap-3 shrink-0">
          <button onClick={onClose} className="btn-ghost">Close</button>
          <button onClick={() => onEdit(item)} className="btn-ghost flex-1" disabled={!item}><Icons.Edit />Edit</button>
          <button onClick={deleteArt} className="btn-ghost text-err hover:bg-err/10" disabled={!item}><Icons.Trash />Delete</button>
        </div>
      </div>
    </div>
  );
}

function ArtDrawer({ initial, events, saving, error, notice, onClose, onSave, onDelete, onClearImage }) {
  const [form, setForm] = useState(() => ({
    ...DEFAULT_FORM,
    ...(initial || {}),
    event_id: initial?.event_id ? String(initial.event_id) : '',
    vendor: initial?.vendor || '',
    booth: initial?.booth || ''
  }));
  const [imageFile, setImageFile] = useState(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const tabs = useMemo(() => ([
    { id: 'core', label: 'Artwork' },
    { id: 'notes', label: 'Image & Notes' }
  ]), []);
  const [activeTab, setActiveTab] = useState('core');

  useEffect(() => {
    setForm({
      ...DEFAULT_FORM,
      ...(initial || {}),
      event_id: initial?.event_id ? String(initial.event_id) : '',
      vendor: initial?.vendor || '',
      booth: initial?.booth || ''
    });
    setImageFile(null);
    setActiveTab('core');
  }, [initial]);

  const showPurchaseContext = hasPurchaseContext(form);
  const submit = () => onSave(form, imageFile);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-void/72" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-[40rem] h-full bg-abyss border-l border-edge flex flex-col animate-slide-in">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-edge shrink-0">
          <h2 className="section-title !text-xl">{initial?.id ? 'Edit Art' : 'Add Art'}</h2>
          <div className="flex-1" />
          {initial?.id ? <p className="text-sm text-ghost">#{initial.id}</p> : null}
          <button onClick={onClose} className="btn-icon btn-sm shrink-0"><Icons.X /></button>
        </div>
        <div className="flex-1 overflow-y-auto scroll-area p-6 space-y-4">
          {error ? <p className="text-xs text-err">{error}</p> : null}
          {notice ? <p className="text-xs text-ok">{notice}</p> : null}
          <SectionTabs
            tabs={tabs}
            activeId={activeTab}
            onChange={setActiveTab}
            showIndex
            stretch
            ariaLabel="Art editor steps"
            idBase="art-editor-steps"
          />
          <div className="space-y-4 border-t border-edge/60 pt-3">
            <SectionTabPanel activeId={activeTab} tabKey="core" idBase="art-editor-steps">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="field"><span className="label">Title *</span><input className="input" value={form.title || ''} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} /></label>
                <label className="field"><span className="label">Series</span><input className="input" value={form.series || ''} onChange={(e) => setForm((p) => ({ ...p, series: e.target.value }))} /></label>
                <label className="field"><span className="label">Artist</span><input className="input" value={form.artist || ''} onChange={(e) => setForm((p) => ({ ...p, artist: e.target.value }))} /></label>
                <label className="field"><span className="label">Price</span><input className="input" value={form.price ?? ''} onChange={(e) => setForm((p) => ({ ...p, price: e.target.value }))} /></label>
                <label className="field md:col-span-2"><span className="label">Linked Event</span>
                  <select className="select" value={form.event_id || ''} onChange={(e) => setForm((p) => ({ ...p, event_id: e.target.value }))}>
                    <option value="">None</option>
                    {events.map((evt) => <option key={evt.id} value={String(evt.id)}>{evt.title}</option>)}
                  </select>
                </label>
                {showPurchaseContext ? (
                  <>
                    <label className="field"><span className="label">Vendor</span><input className="input" value={form.vendor || ''} onChange={(e) => setForm((p) => ({ ...p, vendor: e.target.value }))} /></label>
                    <label className="field"><span className="label">Booth</span><input className="input" value={form.booth || ''} onChange={(e) => setForm((p) => ({ ...p, booth: e.target.value }))} /></label>
                  </>
                ) : null}
                <label className="field md:col-span-2 inline-flex items-center gap-2 text-sm text-dim">
                  <input type="checkbox" checked={Boolean(form.exclusive)} onChange={(e) => setForm((p) => ({ ...p, exclusive: e.target.checked }))} />
                  Exclusive item
                </label>
              </div>
            </SectionTabPanel>
            <SectionTabPanel activeId={activeTab} tabKey="notes" idBase="art-editor-steps">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="field md:col-span-2"><span className="label">Image URL (optional)</span><input className="input" value={form.image_path || ''} onChange={(e) => setForm((p) => ({ ...p, image_path: e.target.value }))} /></label>
                <label className="field md:col-span-2"><span className="label">Upload/Capture image</span><input className="input" type="file" accept="image/*" capture="environment" onChange={(e) => setImageFile(e.target.files?.[0] || null)} /></label>
                <div className="md:col-span-2 flex items-center gap-2">
                  <button type="button" onClick={() => setCameraOpen(true)} className="btn-secondary btn-sm"><Icons.Camera />Camera</button>
                </div>
                {imageFile ? <p className="text-xs text-ghost md:col-span-2">Selected file: {imageFile.name}</p> : null}
                {form.image_path ? (
                  <div className="md:col-span-2 flex items-center gap-2">
                    <a className="btn-ghost btn-sm" href={form.image_path} target="_blank" rel="noreferrer"><Icons.Link />Open image</a>
                    <button className="btn-ghost btn-sm" onClick={onClearImage}><Icons.X />Remove image</button>
                  </div>
                ) : null}
                <label className="field md:col-span-2"><span className="label">Notes</span><textarea className="textarea min-h-[90px]" value={form.notes || ''} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} /></label>
              </div>
            </SectionTabPanel>
          </div>
        </div>
        <div className="p-4 border-t border-edge flex gap-3 shrink-0">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          {initial?.id ? <button onClick={onDelete} className="btn-danger"><Icons.Trash />Delete</button> : null}
          <div className="flex-1" />
          <button onClick={submit} disabled={saving} className="btn-primary min-w-[120px]">
            {saving ? <><Spinner size={14} />Saving…</> : <><Icons.Check />Save</>}
          </button>
        </div>
        <CameraCaptureModal
          open={cameraOpen}
          title="Capture art image"
          description="Capture an art image and attach it directly to this piece."
          confirmLabel="Use art image"
          onClose={() => setCameraOpen(false)}
          onCapture={async (file) => setImageFile(file)}
        />
      </div>
    </div>
  );
}

export default function ArtView({ apiCall, onToast }) {
  const api = useCallback((method, path, data, config = {}) => (
    apiCall(method, path, data, { timeout: 15000, ...config })
  ), [apiCall]);

  const [items, setItems] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [sortDir, setSortDir] = useState('asc');
  const [viewMode, setViewMode] = useState('cards');
  const [eventFilter, setEventFilter] = useState('');
  const [exclusiveFilter, setExclusiveFilter] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
  const [editing, setEditing] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [adding, setAdding] = useState(false);
  const filterMenuRef = useRef(null);

  const supportsHover = useMemo(() => window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches, []);
  const activeFilterCount = useMemo(
    () => [search.trim(), eventFilter, exclusiveFilter].filter(Boolean).length,
    [eventFilter, exclusiveFilter, search]
  );

  const loadEvents = useCallback(async () => {
    try {
      const payload = await api('get', '/events?page=1&limit=200');
      setEvents(Array.isArray(payload?.items) ? payload.items : []);
    } catch (_) {
      setEvents([]);
    }
  }, [api]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(pageSize));
      params.set('sort_dir', sortDir);
      if (search.trim()) params.set('q', search.trim());
      if (eventFilter) params.set('event_id', eventFilter);
      if (exclusiveFilter) params.set('exclusive', exclusiveFilter);
      const payload = await api('get', `/art?${params.toString()}`);
      setItems(Array.isArray(payload?.items) ? payload.items : []);
      setPagination(payload?.pagination || { page, limit: pageSize, total: 0, totalPages: 1, hasMore: false });
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load art');
    } finally {
      setLoading(false);
    }
  }, [api, eventFilter, exclusiveFilter, page, pageSize, search, sortDir]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadEvents(); }, [loadEvents]);
  useEffect(() => {
    const onPointerDown = (event) => {
      if (!filterMenuRef.current) return;
      if (filterMenuRef.current.contains(event.target)) return;
      setFilterOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const closeDrawer = () => {
    setAdding(false);
    setEditing(null);
    setDetailId(null);
    setError('');
    setNotice('');
  };

  const saveArt = async (form, imageFile) => {
    if (!String(form.title || '').trim()) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const payload = {
        title: String(form.title || '').trim(),
        series: form.series || null,
        subtype: 'art',
        event_id: form.event_id ? Number(form.event_id) : null,
        artist: form.artist || null,
        vendor: form.vendor || null,
        booth: form.booth || null,
        price: form.price === '' ? null : Number(form.price),
        exclusive: Boolean(form.exclusive),
        image_path: form.image_path || null,
        notes: form.notes || null
      };
      let id = editing?.id;
      if (editing?.id) {
        await api('patch', `/art/${editing.id}`, payload);
      } else {
        const created = await api('post', '/art', payload);
        id = created?.id;
      }
      if (imageFile && id) {
        try {
          const formData = new FormData();
          formData.append('image', imageFile);
          await api('post', `/art/${id}/upload-image`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
        } catch (uploadErr) {
          setError(parseUploadError(uploadErr?.response?.data?.error || uploadErr?.message));
        }
      }
      onToast?.(editing?.id ? 'Art saved' : 'Art created');
      setNotice(editing?.id ? 'Art saved' : 'Art created');
      setAdding(false);
      setEditing(null);
      await load();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to save art piece');
    } finally {
      setSaving(false);
    }
  };

  const deleteArt = async (id) => {
    if (!window.confirm('Delete this art piece?')) return;
    await api('delete', `/art/${id}`);
    onToast?.('Art deleted');
    await load();
    if (editing?.id === id) closeDrawer();
    if (detailId === id) setDetailId(null);
  };

  const clearImage = async () => {
    if (!editing?.id) return;
    await api('delete', `/art/${editing.id}/image`);
    onToast?.('Image removed');
    const refreshed = await api('get', `/art/${editing.id}`);
    setEditing(refreshed);
    await load();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-edge shrink-0">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="section-title">Art</h1>
              <span className="badge badge-dim">{pagination.total || items.length}</span>
              {activeFilterCount > 0 ? <FilterPill tone="brand">{`${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'} active`}</FilterPill> : null}
            </div>
            <p className="mt-1 text-sm text-ghost">Track original art, prints, and sketch commissions as their own library while keeping event purchase context attached.</p>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ghost pointer-events-none"><Icons.Search /></span>
              <input className="input pl-9 w-56" placeholder="Search…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            </div>
            <div className="relative" ref={filterMenuRef}>
              <button className="btn-secondary" onClick={() => setFilterOpen((v) => !v)}>Filter<Icons.ChevronDown /></button>
              {filterOpen ? (
                <div className="absolute right-0 mt-2 w-80 rounded-xl border border-edge bg-raised p-3 z-20 shadow-2xl space-y-3">
                  <div>
                    <p className="text-xs text-ghost mb-2">Events</p>
                    <select className="select w-full" value={eventFilter} onChange={(e) => { setEventFilter(e.target.value); setPage(1); }}>
                      <option value="">All events</option>
                      {events.map((evt) => <option key={evt.id} value={String(evt.id)}>{evt.title}</option>)}
                    </select>
                  </div>
                  <div>
                    <p className="text-xs text-ghost mb-2">Exclusives</p>
                    <div className="flex gap-2">
                      <button className={cx('btn-ghost btn-sm', exclusiveFilter === '' && 'bg-brand/20 text-brand')} onClick={() => { setExclusiveFilter(''); setPage(1); }}>All</button>
                      <button className={cx('btn-ghost btn-sm', exclusiveFilter === 'true' && 'bg-brand/20 text-brand')} onClick={() => { setExclusiveFilter('true'); setPage(1); }}>Exclusive</button>
                      <button className={cx('btn-ghost btn-sm', exclusiveFilter === 'false' && 'bg-brand/20 text-brand')} onClick={() => { setExclusiveFilter('false'); setPage(1); }}>Non-exclusive</button>
                    </div>
                  </div>
                  <div className="pt-1 border-t border-edge flex justify-end">
                    <button className="btn-ghost btn-sm" onClick={() => { setEventFilter(''); setExclusiveFilter(''); setPage(1); }}>Clear filters</button>
                  </div>
                </div>
              ) : null}
            </div>
            <SectionTabs
              tabs={[
                { id: 'cards', label: <><span aria-hidden="true"><Icons.Film /></span><span className="sr-only">Cards</span></> },
                { id: 'list', label: <><span aria-hidden="true"><Icons.List /></span><span className="sr-only">List</span></> }
              ]}
              activeId={viewMode}
              onChange={setViewMode}
              semantics="buttons"
              showDivider={false}
              ariaLabel="Art view mode"
              listClassName="gap-2"
              buttonClassName="px-2"
            />
            <button className="btn-icon" onClick={() => { setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); setPage(1); }} title={sortDir === 'asc' ? 'Sort ascending' : 'Sort descending'}>
              {sortDir === 'asc' ? <Icons.ArrowUp /> : <Icons.ArrowDown />}
            </button>
            <button className="btn-primary" onClick={() => setAdding(true)}><Icons.Plus />Add Art</button>
          </div>
        </div>
        {activeFilterCount > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {search.trim() ? <FilterPill>{`Search: ${search.trim()}`}</FilterPill> : null}
            {eventFilter ? <FilterPill>{`Event: ${events.find((evt) => String(evt.id) === String(eventFilter))?.title || eventFilter}`}</FilterPill> : null}
            {exclusiveFilter ? <FilterPill>{exclusiveFilter === 'true' ? 'Exclusive only' : 'Non-exclusive only'}</FilterPill> : null}
            <button className="btn-ghost btn-sm" onClick={() => { setEventFilter(''); setExclusiveFilter(''); setSearch(''); setPage(1); }}>Clear filters</button>
          </div>
        ) : null}
      </div>
      <div className="flex-1 overflow-y-auto scroll-area p-6">
        {error ? <p className="text-sm text-err mb-3">{error}</p> : null}
        {loading ? <div className="flex items-center justify-center py-20"><Spinner size={32} /></div> : null}
        {!loading && items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-edge bg-surface px-5 py-8 text-sm text-ghost">
            No art found yet. Add commissions, prints, and original pieces here so artist, series, and event purchase history stay together.
          </div>
        ) : null}
        {!loading && viewMode === 'cards' && items.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {items.map((item) => (
              <ArtCard key={item.id} item={item} supportsHover={supportsHover} onOpen={(row) => setDetailId(row.id)} onEdit={setEditing} onDelete={deleteArt} />
            ))}
          </div>
        ) : null}
        {!loading && viewMode === 'list' && items.length > 0 ? (
          <div className="space-y-2">
            {items.map((item) => (
              <ArtRow key={item.id} item={item} supportsHover={supportsHover} onOpen={(row) => setDetailId(row.id)} onEdit={setEditing} onDelete={deleteArt} />
            ))}
          </div>
        ) : null}
      </div>
      <CollectionPaginationFooter
        page={page}
        totalPages={pagination.totalPages || 1}
        hasMore={pagination.hasMore}
        loading={loading}
        pageSize={pageSize}
        pageSizeOptions={[25, 50, 100]}
        onPrevious={() => setPage((p) => Math.max(1, p - 1))}
        onNext={() => setPage((p) => p + 1)}
        onPageSizeChange={(value) => { setPageSize(value); setPage(1); }}
      />
      {(adding || editing) ? (
        <ArtDrawer
          initial={editing}
          events={events}
          saving={saving}
          error={error}
          notice={notice}
          onClose={closeDrawer}
          onSave={saveArt}
          onDelete={editing?.id ? () => deleteArt(editing.id) : null}
          onClearImage={clearImage}
        />
      ) : null}
      {detailId ? (
        <ArtDetailDrawer
          artId={detailId}
          apiCall={api}
          events={events}
          onClose={() => setDetailId(null)}
          onEdit={(item) => { setDetailId(null); setEditing(item); }}
          onDeleted={load}
        />
      ) : null}
    </div>
  );
}
