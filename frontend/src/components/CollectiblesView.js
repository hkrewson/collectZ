import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icons, Spinner, cx } from './app/AppPrimitives';

const CATEGORY_OPTIONS = [
  { key: 'lego', label: 'Lego' },
  { key: 'figures_statues', label: 'Figures / Statues' },
  { key: 'props_replicas_originals', label: 'Props / Replicas / Originals' },
  { key: 'funko', label: 'Funko' },
  { key: 'comic_panels', label: 'Comic Panels' },
  { key: 'anime', label: 'Anime' },
  { key: 'toys', label: 'Toys' },
  { key: 'clothing', label: 'Clothing' }
];

const ITEM_TYPES = [
  { value: 'art', label: 'Art' },
  { value: 'card', label: 'Card' },
  { value: 'collectible', label: 'Collectible' }
];

const DEFAULT_FORM = {
  title: '',
  subtype: 'collectible',
  category_key: '',
  event_id: '',
  booth_or_vendor: '',
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

function CollectibleCard({ item, supportsHover, onEdit, onDelete }) {
  return (
    <article className="group relative card p-4 border border-edge/80 animate-fade-in">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink truncate">{item.title}</p>
          <p className="text-xs text-ghost mt-1">
            {item.subtype || item.item_type || 'collectible'}
            {item.category ? ` · ${item.category}` : ''}
          </p>
          <p className="text-xs text-ghost mt-1">
            {item.event_title ? `Event: ${item.event_title}` : 'No linked event'}
          </p>
          {item.image_path ? <span className="badge badge-brand text-[10px] mt-2">Image attached</span> : null}
        </div>
        <span className="badge badge-dim text-[10px]">#{item.id}</span>
      </div>
      <div className={cx('mt-3 flex gap-2 transition-opacity duration-150', supportsHover ? 'opacity-0 group-hover:opacity-100' : 'opacity-100')}>
        <button className="btn-secondary btn-sm flex-1" onClick={() => onEdit(item)}><Icons.Edit />Edit</button>
        <button className="btn-icon btn-sm text-err hover:bg-err/20" onClick={() => onDelete(item.id)}><Icons.Trash /></button>
      </div>
    </article>
  );
}

function CollectibleRow({ item, supportsHover, onEdit, onDelete }) {
  return (
    <article className="group flex items-center gap-4 p-3 rounded-lg bg-surface border border-edge hover:border-muted hover:bg-raised transition-all duration-150 animate-fade-in">
      <div className="w-9 h-9 rounded bg-raised border border-edge flex items-center justify-center text-ghost"><Icons.Activity /></div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ink truncate">{item.title}</p>
        <p className="text-xs text-ghost">
          {item.subtype || item.item_type || 'collectible'}
          {item.category ? ` · ${item.category}` : ''}
          {item.event_title ? ` · ${item.event_title}` : ''}
        </p>
      </div>
      <span className="text-xs text-ghost font-mono">#{item.id}</span>
      <div className={cx('flex gap-2 transition-opacity duration-150', supportsHover ? 'opacity-0 group-hover:opacity-100' : 'opacity-100')}>
        <button className="btn-ghost btn-sm" onClick={() => onEdit(item)}><Icons.Edit /></button>
        <button className="btn-ghost btn-sm text-err hover:bg-err/10" onClick={() => onDelete(item.id)}><Icons.Trash /></button>
      </div>
    </article>
  );
}

function CollectibleDrawer({
  initial,
  events,
  saving,
  error,
  notice,
  onClose,
  onSave,
  onDelete,
  onClearImage
}) {
  const [form, setForm] = useState(() => ({
    ...DEFAULT_FORM,
    ...(initial || {}),
    subtype: initial?.subtype || initial?.item_type || 'collectible',
    category_key: initial?.category_key || '',
    event_id: initial?.event_id ? String(initial.event_id) : ''
  }));
  const [imageFile, setImageFile] = useState(null);

  useEffect(() => {
    setForm({
      ...DEFAULT_FORM,
      ...(initial || {}),
      subtype: initial?.subtype || initial?.item_type || 'collectible',
      category_key: initial?.category_key || '',
      event_id: initial?.event_id ? String(initial.event_id) : ''
    });
    setImageFile(null);
  }, [initial]);

  const submit = () => onSave(form, imageFile);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-void/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-xl h-full bg-abyss border-l border-edge flex flex-col animate-slide-in">
        <div className="px-6 pt-6 pb-4 border-b border-edge flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <h2 className="font-display text-2xl tracking-wider text-ink leading-tight">{initial?.id ? 'Edit Collectible' : 'Add Collectible'}</h2>
              {initial?.id ? <p className="text-sm text-ghost">#{initial.id}</p> : null}
            </div>
          </div>
          <button onClick={onClose} className="btn-icon btn-sm shrink-0"><Icons.X /></button>
        </div>
        <div className="flex-1 overflow-y-auto scroll-area p-6 space-y-3">
          {error ? <p className="text-xs text-err">{error}</p> : null}
          {notice ? <p className="text-xs text-ok">{notice}</p> : null}
          <div className="grid grid-cols-2 gap-3">
            <label className="field col-span-2"><span className="label">Title *</span><input className="input" value={form.title || ''} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} /></label>
            <label className="field"><span className="label">Type</span>
              <select className="select" value={form.subtype || 'collectible'} onChange={(e) => setForm((p) => ({ ...p, subtype: e.target.value }))}>
                {ITEM_TYPES.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </label>
            <label className="field"><span className="label">Category</span>
              <select className="select" value={form.category_key || ''} onChange={(e) => setForm((p) => ({ ...p, category_key: e.target.value }))}>
                <option value="">None</option>
                {CATEGORY_OPTIONS.map((cat) => <option key={cat.key} value={cat.key}>{cat.label}</option>)}
              </select>
            </label>
            <label className="field col-span-2"><span className="label">Linked Event</span>
              <select className="select" value={form.event_id || ''} onChange={(e) => setForm((p) => ({ ...p, event_id: e.target.value }))}>
                <option value="">None</option>
                {events.map((evt) => <option key={evt.id} value={String(evt.id)}>{evt.title}</option>)}
              </select>
            </label>
            <label className="field"><span className="label">Vendor/Booth</span><input className="input" value={form.booth_or_vendor || ''} onChange={(e) => setForm((p) => ({ ...p, booth_or_vendor: e.target.value }))} /></label>
            <label className="field"><span className="label">Price</span><input className="input" value={form.price ?? ''} onChange={(e) => setForm((p) => ({ ...p, price: e.target.value }))} /></label>
            <label className="field col-span-2 inline-flex items-center gap-2 text-sm text-dim">
              <input type="checkbox" checked={Boolean(form.exclusive)} onChange={(e) => setForm((p) => ({ ...p, exclusive: e.target.checked }))} />
              Exclusive item
            </label>
            <label className="field col-span-2"><span className="label">Image URL (optional)</span><input className="input" value={form.image_path || ''} onChange={(e) => setForm((p) => ({ ...p, image_path: e.target.value }))} /></label>
            <label className="field col-span-2"><span className="label">Upload/Capture image</span><input className="input" type="file" accept="image/*" capture="environment" onChange={(e) => setImageFile(e.target.files?.[0] || null)} /></label>
            {imageFile ? <p className="text-xs text-ghost col-span-2">Selected file: {imageFile.name}</p> : null}
            {form.image_path ? (
              <div className="col-span-2 flex items-center gap-2">
                <a className="btn-ghost btn-sm" href={form.image_path} target="_blank" rel="noreferrer"><Icons.Link />Open image</a>
                <button className="btn-ghost btn-sm" onClick={onClearImage}><Icons.X />Remove image</button>
              </div>
            ) : null}
            <label className="field col-span-2"><span className="label">Notes</span><textarea className="textarea min-h-[90px]" value={form.notes || ''} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} /></label>
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
      </div>
    </div>
  );
}

export default function CollectiblesView({ apiCall, onToast }) {
  const api = useCallback((method, path, data, config = {}) => (
    apiCall(method, path, data, { timeout: 15000, ...config })
  ), [apiCall]);

  const [items, setItems] = useState([]);
  const [events, setEvents] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [sortDir, setSortDir] = useState('asc');
  const [subtypeFilter, setSubtypeFilter] = useState('');
  const [viewMode, setViewMode] = useState('cards');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [eventFilter, setEventFilter] = useState('');
  const [exclusiveFilter, setExclusiveFilter] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const filterMenuRef = useRef(null);

  const supportsHover = useMemo(() => window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches, []);

  const loadEvents = useCallback(async () => {
    try {
      const payload = await api('get', '/events?page=1&limit=200');
      setEvents(Array.isArray(payload?.items) ? payload.items : []);
    } catch (_) {
      setEvents([]);
    }
  }, [api]);

  const loadCategories = useCallback(async () => {
    try {
      const payload = await api('get', '/collectibles/categories');
      const list = Array.isArray(payload?.categories) ? payload.categories : [];
      setCategories(list.map((entry) => ({ key: entry.key, label: entry.label })));
    } catch (_) {
      setCategories([]);
    }
  }, [api]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(pageSize));
      if (search.trim()) params.set('q', search.trim());
      params.set('sort_dir', sortDir);
      if (subtypeFilter) params.set('subtype', subtypeFilter);
      if (categoryFilter) params.set('category_key', categoryFilter);
      if (eventFilter) params.set('event_id', eventFilter);
      if (exclusiveFilter) params.set('exclusive', exclusiveFilter);
      const payload = await api('get', `/collectibles?${params.toString()}`);
      setItems(Array.isArray(payload?.items) ? payload.items : []);
      setPagination(payload?.pagination || { page, limit: pageSize, total: 0, totalPages: 1, hasMore: false });
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load collectibles');
    } finally {
      setLoading(false);
    }
  }, [api, categoryFilter, eventFilter, exclusiveFilter, page, pageSize, search, sortDir, subtypeFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadEvents(); }, [loadEvents]);
  useEffect(() => { loadCategories(); }, [loadCategories]);
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
    setError('');
    setNotice('');
  };

  const saveCollectible = async (form, imageFile) => {
    if (!String(form.title || '').trim()) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const payload = {
        title: String(form.title || '').trim(),
        subtype: form.subtype || 'collectible',
        category_key: form.category_key || null,
        event_id: form.event_id ? Number(form.event_id) : null,
        booth_or_vendor: form.booth_or_vendor || null,
        price: form.price === '' ? null : Number(form.price),
        exclusive: Boolean(form.exclusive),
        image_path: form.image_path || null,
        notes: form.notes || null
      };
      let id = editing?.id;
      if (editing?.id) {
        await api('patch', `/collectibles/${editing.id}`, payload);
      } else {
        const created = await api('post', '/collectibles', payload);
        id = created?.id;
      }
      if (imageFile && id) {
        try {
          const formData = new FormData();
          formData.append('image', imageFile);
          await api('post', `/collectibles/${id}/upload-image`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
        } catch (uploadErr) {
          setError(parseUploadError(uploadErr?.response?.data?.error || uploadErr?.message));
        }
      }
      onToast?.(editing?.id ? 'Collectible saved' : 'Collectible created');
      setNotice(editing?.id ? 'Collectible saved' : 'Collectible created');
      closeDrawer();
      await load();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to save collectible');
    } finally {
      setSaving(false);
    }
  };

  const deleteCollectible = async (id) => {
    if (!window.confirm('Delete this collectible?')) return;
    await api('delete', `/collectibles/${id}`);
    onToast?.('Collectible deleted');
    await load();
    if (editing?.id === id) closeDrawer();
  };

  const clearImage = async () => {
    if (!editing?.id) return;
    await api('delete', `/collectibles/${editing.id}/image`);
    onToast?.('Image removed');
    const refreshed = await api('get', `/collectibles/${editing.id}`);
    setEditing(refreshed);
    await load();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-edge shrink-0">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="section-title">Collectibles</h1>
          <span className="badge badge-dim ml-1">{pagination.total || items.length}</span>
          <div className="flex-1" />
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ghost pointer-events-none"><Icons.Search /></span>
            <input className="input pl-9 w-56" placeholder="Search…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <div className="relative" ref={filterMenuRef}>
            <button className="btn-secondary" onClick={() => setFilterOpen((v) => !v)}>
              Filter
              <Icons.ChevronDown />
            </button>
            {filterOpen ? (
              <div className="absolute right-0 mt-2 w-80 rounded-xl border border-edge bg-raised p-3 z-20 shadow-2xl space-y-3">
                <div>
                  <p className="text-xs text-ghost mb-2">Categories</p>
                  <select
                    className="select w-full"
                    value={categoryFilter}
                    onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
                  >
                    <option value="">All categories</option>
                    {(categories.length > 0 ? categories : CATEGORY_OPTIONS).map((cat) => (
                      <option key={cat.key} value={cat.key}>{cat.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className="text-xs text-ghost mb-2">Events</p>
                  <select
                    className="select w-full"
                    value={eventFilter}
                    onChange={(e) => { setEventFilter(e.target.value); setPage(1); }}
                  >
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
                <div>
                  <p className="text-xs text-ghost mb-2">Types</p>
                  <div className="flex gap-2">
                    <button className={cx('btn-ghost btn-sm', subtypeFilter === '' && 'bg-brand/20 text-brand')} onClick={() => { setSubtypeFilter(''); setPage(1); }}>All</button>
                    {ITEM_TYPES.map((opt) => (
                      <button
                        key={opt.value}
                        className={cx('btn-ghost btn-sm', subtypeFilter === opt.value && 'bg-brand/20 text-brand')}
                        onClick={() => { setSubtypeFilter(opt.value); setPage(1); }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="pt-1 border-t border-edge flex justify-end">
                  <button
                    className="btn-ghost btn-sm"
                    onClick={() => {
                      setSubtypeFilter('');
                      setCategoryFilter('');
                      setEventFilter('');
                      setExclusiveFilter('');
                      setPage(1);
                    }}
                  >
                    Clear filters
                  </button>
                </div>
              </div>
            ) : null}
          </div>
          <div className="tab-strip">
            <button className={cx('tab', viewMode === 'cards' && 'active')} onClick={() => setViewMode('cards')}><Icons.Film /></button>
            <button className={cx('tab', viewMode === 'list' && 'active')} onClick={() => setViewMode('list')}><Icons.List /></button>
          </div>
          <button
            className="btn-icon"
            onClick={() => { setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); setPage(1); }}
            title={sortDir === 'asc' ? 'Sort ascending' : 'Sort descending'}
          >
            {sortDir === 'asc' ? <Icons.ArrowUp /> : <Icons.ArrowDown />}
          </button>
          <button className="btn-primary" onClick={() => setAdding(true)}><Icons.Plus />Add</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto scroll-area p-6">
        {error ? <p className="text-sm text-err mb-3">{error}</p> : null}
        {loading ? <div className="flex items-center justify-center py-20"><Spinner size={32} /></div> : null}
        {!loading && items.length === 0 ? <div className="text-sm text-ghost">No collectibles found.</div> : null}
        {!loading && viewMode === 'cards' && items.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {items.map((item) => (
              <CollectibleCard key={item.id} item={item} supportsHover={supportsHover} onEdit={setEditing} onDelete={deleteCollectible} />
            ))}
          </div>
        ) : null}
        {!loading && viewMode === 'list' && items.length > 0 ? (
          <div className="space-y-2">
            {items.map((item) => (
              <CollectibleRow key={item.id} item={item} supportsHover={supportsHover} onEdit={setEditing} onDelete={deleteCollectible} />
            ))}
          </div>
        ) : null}
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
      {(adding || editing) ? (
        <CollectibleDrawer
          initial={editing}
          events={events}
          saving={saving}
          error={error}
          notice={notice}
          onClose={closeDrawer}
          onSave={saveCollectible}
          onDelete={editing?.id ? () => deleteCollectible(editing.id) : null}
          onClearImage={clearImage}
        />
      ) : null}
    </div>
  );
}
