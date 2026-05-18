import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CollectionPaginationFooter, SectionTabs, cx } from './app/AppPrimitives';
import { getOwnedFormatOptions } from './app/mediaFormats';

const STATUS_TABS = [
  { id: 'active', label: 'Active' },
  { id: 'wanted', label: 'Wanted' },
  { id: 'watching', label: 'Watching' },
  { id: 'preordered', label: 'Preordered' },
  { id: 'ordered', label: 'Ordered' },
  { id: 'acquired', label: 'Acquired' },
  { id: 'dismissed', label: 'Dismissed' },
  { id: 'all', label: 'All' }
];

const OBJECT_TYPES = [
  { value: 'movie', label: 'Movie' },
  { value: 'tv_series', label: 'TV' },
  { value: 'book', label: 'Book' },
  { value: 'comic_book', label: 'Comic' },
  { value: 'audio', label: 'Audio' },
  { value: 'game', label: 'Game' },
  { value: 'art', label: 'Art' },
  { value: 'collectible', label: 'Collectible' },
  { value: 'event_item', label: 'Event item' },
  { value: 'other', label: 'Other' }
];

const MEDIA_TYPES = new Set(['movie', 'tv_series', 'book', 'comic_book', 'audio', 'game']);

const WISHLIST_FORMAT_OPTIONS = {
  art: ['Original', 'Print', 'Poster', 'Commission', 'Sketch', 'Digital'],
  collectible: ['Figure', 'Statue', 'Card', 'Prop', 'Pin', 'Apparel', 'Merch'],
  event_item: ['Badge', 'Program', 'Exclusive', 'Print', 'Merch', 'Ticket'],
  other: ['Physical', 'Digital', 'Service', 'Part', 'Upgrade']
};

const EMPTY_FORM = {
  title: '',
  object_type: 'book',
  status: 'wanted',
  priority: 'normal',
  year: '',
  desired_format: '',
  desired_edition: '',
  provider: '',
  provider_key: '',
  vendor: '',
  target_price: '',
  notes: '',
  identifiers_text: ''
};

function statusLabel(status) {
  return STATUS_TABS.find((tab) => tab.id === status)?.label || status || 'Wanted';
}

function typeLabel(type) {
  return OBJECT_TYPES.find((item) => item.value === type)?.label || type || 'Item';
}

function getWishlistFormatOptions(objectType, currentValue = '') {
  const baseOptions = MEDIA_TYPES.has(objectType)
    ? getOwnedFormatOptions(objectType).map((entry) => entry.label)
    : (WISHLIST_FORMAT_OPTIONS[objectType] || WISHLIST_FORMAT_OPTIONS.other);
  const seen = new Set();
  const options = baseOptions
    .filter(Boolean)
    .map((label) => String(label).trim())
    .filter((label) => {
      const key = label.toLowerCase();
      if (!label || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((label) => ({ value: label, label }));

  const customValue = String(currentValue || '').trim();
  if (customValue && !seen.has(customValue.toLowerCase())) {
    options.push({ value: customValue, label: customValue });
  }

  return options;
}

function normalizeWishlistFormatForType(objectType, value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = getWishlistFormatOptions(objectType).find((option) => (
    option.value.toLowerCase() === raw.toLowerCase() || option.label.toLowerCase() === raw.toLowerCase()
  ));
  return match?.value || '';
}

function parseIdentifiers(value) {
  const raw = String(value || '').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    const pairs = raw
      .split(/[,\n]/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [key, ...rest] = entry.split(':');
        return [String(key || '').trim(), rest.join(':').trim()];
      })
      .filter(([key, val]) => key && val);
    return Object.fromEntries(pairs);
  }
}

function stringifyIdentifiers(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length === 0) return '';
  return Object.entries(value)
    .map(([key, val]) => `${key}: ${val}`)
    .join('\n');
}

function identifierSummary(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return Object.entries(value)
    .filter(([key, val]) => key && val !== null && val !== undefined && String(val).trim())
    .slice(0, 3)
    .map(([key, val]) => `${key}: ${val}`)
    .join(' · ');
}

function formFromItem(item) {
  if (!item) return EMPTY_FORM;
  return {
    title: item.title || '',
    object_type: item.object_type || 'book',
    status: item.status || 'wanted',
    priority: item.priority || 'normal',
    year: item.year || '',
    desired_format: item.desired_format || '',
    desired_edition: item.desired_edition || '',
    provider: item.provider || '',
    provider_key: item.provider_key || '',
    vendor: item.vendor || '',
    target_price: item.target_price ?? '',
    notes: item.notes || '',
    identifiers_text: stringifyIdentifiers(item.identifiers)
  };
}

function formatMoney(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

function priorityClass(priority) {
  if (priority === 'grail') return 'text-gold';
  if (priority === 'high') return 'text-err';
  if (priority === 'low') return 'text-ghost';
  return 'text-dim';
}

function Field({ label, className = '', children }) {
  return (
    <label className={cx('space-y-1', className)}>
      <span className="text-xs font-medium text-ghost">{label}</span>
      {children}
    </label>
  );
}

function WishlistEditor({ form, setForm, editingItem, saving, onCancel, onSave }) {
  const hasSourceDetails = Boolean(form.provider || form.provider_key || form.identifiers_text);
  const formatOptions = getWishlistFormatOptions(form.object_type, form.desired_format);

  return (
    <form
      className="max-w-[980px]"
      onSubmit={(event) => {
        event.preventDefault();
        onSave?.();
      }}
    >
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold text-ink">{editingItem ? 'Edit wishlist item' : 'Add wishlist item'}</h2>
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-12">
        <Field label="Title" className="md:col-span-6">
          <input
            className="input w-full"
            value={form.title}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
            required
          />
        </Field>
        <Field label="Type" className="md:col-span-2">
          <select
            className="select w-full"
            value={form.object_type}
            onChange={(event) => {
              const objectType = event.target.value;
              setForm((current) => ({
                ...current,
                object_type: objectType,
                desired_format: normalizeWishlistFormatForType(objectType, current.desired_format)
              }));
            }}
          >
            {OBJECT_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <Field label="Status" className="md:col-span-2">
          <select
            className="select w-full"
            value={form.status}
            onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
          >
            {STATUS_TABS.filter((tab) => tab.id !== 'active' && tab.id !== 'all').map((tab) => (
              <option key={tab.id} value={tab.id}>{tab.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Priority" className="md:col-span-2">
          <select
            className="select w-full"
            value={form.priority}
            onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="grail">Grail</option>
          </select>
        </Field>
        <Field label="Year" className="md:col-span-2">
          <input
            className="input w-full"
            inputMode="numeric"
            value={form.year}
            onChange={(event) => setForm((current) => ({ ...current, year: event.target.value }))}
          />
        </Field>
        <Field label="Format" className="md:col-span-3">
          <select
            className="select w-full"
            value={form.desired_format}
            onChange={(event) => setForm((current) => ({ ...current, desired_format: event.target.value }))}
          >
            <option value="">No preference</option>
            {formatOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <Field label="Edition" className="md:col-span-3">
          <input
            className="input w-full"
            value={form.desired_edition}
            onChange={(event) => setForm((current) => ({ ...current, desired_edition: event.target.value }))}
          />
        </Field>
        <Field label="Vendor" className="md:col-span-2">
          <input
            className="input w-full"
            value={form.vendor}
            onChange={(event) => setForm((current) => ({ ...current, vendor: event.target.value }))}
          />
        </Field>
        <Field label="Target price" className="md:col-span-2">
          <input
            className="input w-full"
            inputMode="decimal"
            value={form.target_price}
            onChange={(event) => setForm((current) => ({ ...current, target_price: event.target.value }))}
          />
        </Field>
        <Field label="Notes" className="md:col-span-8">
          <textarea
            className="textarea min-h-[72px] w-full"
            value={form.notes}
            onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
          />
        </Field>
      </div>

      <details className="mt-4 border-t border-edge/70 pt-3" open={hasSourceDetails}>
        <summary className="cursor-pointer text-sm font-medium text-dim">Source details</summary>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-12">
          <Field label="Source" className="md:col-span-3">
            <input
              className="input w-full"
              value={form.provider}
              onChange={(event) => setForm((current) => ({ ...current, provider: event.target.value }))}
            />
          </Field>
          <Field label="Source item ID" className="md:col-span-3">
            <input
              className="input w-full"
              value={form.provider_key}
              onChange={(event) => setForm((current) => ({ ...current, provider_key: event.target.value }))}
            />
          </Field>
          <Field label="Identifiers" className="md:col-span-6">
            <textarea
              className="textarea min-h-[72px] w-full"
              value={form.identifiers_text}
              onChange={(event) => setForm((current) => ({ ...current, identifiers_text: event.target.value }))}
              placeholder="isbn: 978..."
            />
          </Field>
        </div>
      </details>

      <div className="mt-4 flex justify-start gap-2">
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Saving...' : editingItem ? 'Save changes' : 'Add item'}
        </button>
      </div>
    </form>
  );
}

export default function WishlistView({ apiCall, onToast, activeLibrary, Icons, Spinner }) {
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, total_pages: 1 });
  const [status, setStatus] = useState('active');
  const [objectType, setObjectType] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const loadWishlist = useCallback(async (page = 1) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('status', status);
      params.set('page', String(page));
      params.set('limit', '50');
      if (objectType !== 'all') params.set('object_type', objectType);
      if (search.trim()) params.set('search', search.trim());
      const payload = await apiCall('get', `/wishlist?${params.toString()}`);
      setItems(Array.isArray(payload?.items) ? payload.items : []);
      setPagination(payload?.pagination || { page, limit: 50, total: 0, total_pages: 1 });
    } catch (err) {
      setError(err?.message || 'Could not load wishlist.');
    } finally {
      setLoading(false);
    }
  }, [apiCall, objectType, search, status]);

  useEffect(() => {
    loadWishlist(1);
  }, [loadWishlist]);

  const activeCounts = useMemo(() => {
    const counts = { media: 0, nonmedia: 0 };
    items.forEach((item) => {
      if (MEDIA_TYPES.has(item.object_type)) counts.media += 1;
      else counts.nonmedia += 1;
    });
    return counts;
  }, [items]);

  const openNew = () => {
    setEditingItem(null);
    setForm(EMPTY_FORM);
    setEditorOpen(true);
  };

  const openEdit = (item) => {
    setEditingItem(item);
    setForm(formFromItem(item));
    setEditorOpen(true);
  };

  const payloadFromForm = () => ({
    title: form.title,
    object_type: form.object_type,
    status: form.status,
    priority: form.priority,
    year: form.year || null,
    desired_format: form.desired_format || null,
    desired_edition: form.desired_edition || null,
    provider: form.provider || null,
    provider_key: form.provider_key || null,
    vendor: form.vendor || null,
    target_price: form.target_price || null,
    notes: form.notes || null,
    identifiers: parseIdentifiers(form.identifiers_text)
  });

  const saveItem = async () => {
    setSaving(true);
    try {
      if (editingItem?.id) {
        await apiCall('patch', `/wishlist/${editingItem.id}`, payloadFromForm());
        onToast?.('Wishlist item updated.', 'success');
      } else {
        await apiCall('post', '/wishlist', payloadFromForm());
        onToast?.('Wishlist item added.', 'success');
      }
      setEditorOpen(false);
      setEditingItem(null);
      setForm(EMPTY_FORM);
      await loadWishlist(pagination.page || 1);
    } catch (err) {
      onToast?.(err?.message || 'Could not save wishlist item.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (item, nextStatus) => {
    try {
      await apiCall('patch', `/wishlist/${item.id}`, { status: nextStatus });
      onToast?.(`Marked ${statusLabel(nextStatus).toLowerCase()}.`, 'success');
      await loadWishlist(pagination.page || 1);
    } catch (err) {
      onToast?.(err?.message || 'Could not update wishlist item.', 'error');
    }
  };

  const convertItem = async (item) => {
    try {
      const payload = await apiCall('post', `/wishlist/${item.id}/convert`, {});
      onToast?.(`${payload?.media?.title || item.title} added to the library.`, 'success');
      await loadWishlist(pagination.page || 1);
    } catch (err) {
      onToast?.(err?.message || 'Could not convert wishlist item.', 'error');
    }
  };

  const deleteItem = async (item) => {
    if (!window.confirm(`Delete "${item.title}" from the wishlist?`)) return;
    try {
      await apiCall('delete', `/wishlist/${item.id}`);
      onToast?.('Wishlist item deleted.', 'success');
      await loadWishlist(pagination.page || 1);
    } catch (err) {
      onToast?.(err?.message || 'Could not delete wishlist item.', 'error');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Wishlist</h1>
          <p className="mt-1 text-sm text-ghost">{activeLibrary?.name || 'Current library'}</p>
        </div>
        <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={openNew}>
          {Icons?.Plus ? <Icons.Plus /> : null}
          Add item
        </button>
      </div>

      <div className="border-y border-edge py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTabs
            tabs={STATUS_TABS}
            activeId={status}
            onChange={(next) => setStatus(next)}
            showDivider={false}
            className="min-w-0"
            listClassName="gap-3"
            buttonClassName="py-1.5 text-xs"
            ariaLabel="Wishlist status"
          />
          <div className="flex flex-wrap items-center gap-2">
            <select className="select h-9 min-w-36" value={objectType} onChange={(event) => setObjectType(event.target.value)}>
              <option value="all">All types</option>
              {OBJECT_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <input
              className="input h-9 w-64 max-w-full"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search title, source, note"
            />
            <button type="button" className="btn-ghost h-9" onClick={() => loadWishlist(1)}>Search</button>
          </div>
        </div>
      </div>

      {editorOpen ? (
        <div className="border-b border-edge/70 py-4">
          <WishlistEditor
            form={form}
            setForm={setForm}
            editingItem={editingItem}
            saving={saving}
            onCancel={() => {
              setEditorOpen(false);
              setEditingItem(null);
            }}
            onSave={saveItem}
          />
        </div>
      ) : null}

      {editorOpen && items.length === 0 ? null : loading ? (
        <div className="flex min-h-52 items-center justify-center text-ghost">
          {Spinner ? <Spinner /> : 'Loading...'}
        </div>
      ) : error ? (
        <div className="py-4 text-sm text-err">{error}</div>
      ) : items.length === 0 ? (
        <div className="border-b border-edge/70 py-6 text-sm text-ghost">No wishlist items match this view.</div>
      ) : (
        <div className="divide-y divide-edge/70 border-b border-edge/70">
          {items.map((item) => {
            const canConvert = MEDIA_TYPES.has(item.object_type) && item.status !== 'acquired';
            const price = formatMoney(item.target_price);
            const sourceText = item.provider ? [item.provider, item.provider_key].filter(Boolean).join(' ') : '';
            const idText = identifierSummary(item.identifiers);
            return (
              <div key={item.id} className="grid gap-3 py-3 md:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h2 className="truncate text-sm font-semibold text-ink">{item.title}</h2>
                    {item.year ? <span className="text-xs text-ghost">{item.year}</span> : null}
                    <span className="text-xs text-ghost">{typeLabel(item.object_type)}</span>
                    {item.priority && item.priority !== 'normal' ? <span className={cx('text-xs capitalize', priorityClass(item.priority))}>{item.priority}</span> : null}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ghost">
                    <span>{statusLabel(item.status)}</span>
                    {item.desired_format ? <span>{item.desired_format}</span> : null}
                    {item.desired_edition ? <span>{item.desired_edition}</span> : null}
                    {price ? <span>{price}</span> : null}
                    {item.linked_media_id ? <span>Library #{item.linked_media_id}</span> : null}
                  </div>
                  {sourceText || idText ? (
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-dim">
                      {sourceText ? <span>Source: {sourceText}</span> : null}
                      {idText ? <span>{idText}</span> : null}
                    </div>
                  ) : null}
                  {item.notes ? <p className="mt-2 line-clamp-2 text-sm text-dim">{item.notes}</p> : null}
                </div>
                <div className="flex flex-wrap items-start justify-end gap-2">
                  {canConvert ? <button type="button" className="btn-secondary h-8" onClick={() => convertItem(item)}>Add to library</button> : null}
                  {item.status !== 'dismissed' && item.status !== 'acquired' ? (
                    <button type="button" className="btn-ghost h-8" onClick={() => updateStatus(item, 'dismissed')}>Dismiss</button>
                  ) : null}
                  <button type="button" className="btn-ghost h-8" onClick={() => openEdit(item)}>Edit</button>
                  <button type="button" className="btn-ghost h-8 text-err" onClick={() => deleteItem(item)}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editorOpen && items.length === 0 ? null : (
        <CollectionPaginationFooter
          page={pagination.page || 1}
          totalPages={pagination.total_pages || 1}
          hasMore={(pagination.page || 1) < (pagination.total_pages || 1)}
          loading={loading}
          pageSize={pagination.limit || 50}
          className="px-0"
          onPrevious={() => loadWishlist(Math.max(1, (pagination.page || 1) - 1))}
          onNext={() => loadWishlist(Math.min(pagination.total_pages || 1, (pagination.page || 1) + 1))}
          onPageSizeChange={() => {}}
          leadingContent={`${pagination.total || 0} item${Number(pagination.total || 0) === 1 ? '' : 's'} · ${activeCounts.media} library-ready · ${activeCounts.nonmedia} other`}
          showPageSize={false}
        />
      )}
    </div>
  );
}
