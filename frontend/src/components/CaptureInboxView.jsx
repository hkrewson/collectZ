import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CollectionPaginationFooter, SectionTabs, cx } from './app/AppPrimitives';

const STATUS_TABS = [
  { id: 'active', label: 'Active' },
  { id: 'new', label: 'New' },
  { id: 'reviewed', label: 'Reviewed' },
  { id: 'converted', label: 'Converted' },
  { id: 'discarded', label: 'Discarded' },
  { id: 'all', label: 'All' }
];

const CAPTURE_TYPES = [
  { value: 'manual_note', label: 'Note' },
  { value: 'barcode', label: 'Barcode' },
  { value: 'photo', label: 'Photo' },
  { value: 'ocr_text', label: 'OCR text' }
];

const OBJECT_TYPES = [
  { value: 'other', label: 'Other' },
  { value: 'book', label: 'Book' },
  { value: 'comic_book', label: 'Comic' },
  { value: 'movie', label: 'Movie' },
  { value: 'tv_series', label: 'TV' },
  { value: 'audio', label: 'Audio' },
  { value: 'game', label: 'Game' },
  { value: 'art', label: 'Art' },
  { value: 'collectible', label: 'Collectible' },
  { value: 'event_item', label: 'Event item' }
];

const EMPTY_FORM = {
  title: '',
  capture_type: 'manual_note',
  object_type: 'other',
  barcode: '',
  symbology: '',
  image_path: '',
  ocr_text: '',
  notes: ''
};

function typeLabel(value, options) {
  return options.find((option) => option.value === value)?.label || value || 'Item';
}

function dateLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function Field({ label, className = '', children }) {
  return (
    <label className={cx('space-y-1', className)}>
      <span className="text-xs font-medium text-ghost">{label}</span>
      {children}
    </label>
  );
}

function CaptureEditor({ form, setForm, saving, onSave, onCancel }) {
  return (
    <form
      className="border-b border-edge/70 pb-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSave?.();
      }}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
        <Field label="Capture" className="md:col-span-2">
          <select
            className="select w-full"
            value={form.capture_type}
            onChange={(event) => setForm((current) => ({ ...current, capture_type: event.target.value }))}
          >
            {CAPTURE_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <Field label="Type" className="md:col-span-2">
          <select
            className="select w-full"
            value={form.object_type}
            onChange={(event) => setForm((current) => ({ ...current, object_type: event.target.value }))}
          >
            {OBJECT_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <Field label="Title" className="md:col-span-5">
          <input
            className="input w-full"
            value={form.title}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
          />
        </Field>
        <Field label="Barcode / ISBN" className="md:col-span-3">
          <input
            className="input w-full"
            value={form.barcode}
            onChange={(event) => setForm((current) => ({ ...current, barcode: event.target.value }))}
          />
        </Field>
        <Field label="Symbology" className="md:col-span-2">
          <input
            className="input w-full"
            value={form.symbology}
            onChange={(event) => setForm((current) => ({ ...current, symbology: event.target.value }))}
            placeholder="EAN-13"
          />
        </Field>
        <Field label="Image path" className="md:col-span-4">
          <input
            className="input w-full"
            value={form.image_path}
            onChange={(event) => setForm((current) => ({ ...current, image_path: event.target.value }))}
          />
        </Field>
        <Field label="OCR text" className="md:col-span-6">
          <textarea
            className="textarea min-h-[72px] w-full"
            value={form.ocr_text}
            onChange={(event) => setForm((current) => ({ ...current, ocr_text: event.target.value }))}
          />
        </Field>
        <Field label="Notes" className="md:col-span-12">
          <textarea
            className="textarea min-h-[64px] w-full"
            value={form.notes}
            onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
          />
        </Field>
      </div>
      <div className="mt-4 flex gap-2">
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Saving...' : 'Save capture'}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export default function CaptureInboxView({ apiCall, onToast, activeLibrary, Icons, Spinner }) {
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, total_pages: 1 });
  const [status, setStatus] = useState('active');
  const [captureType, setCaptureType] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState(null);

  const loadCaptures = useCallback(async (page = 1) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('status', status);
      params.set('page', String(page));
      params.set('limit', '50');
      if (captureType !== 'all') params.set('capture_type', captureType);
      if (search.trim()) params.set('search', search.trim());
      const payload = await apiCall('get', `/capture-items?${params.toString()}`);
      setItems(Array.isArray(payload?.items) ? payload.items : []);
      setPagination(payload?.pagination || { page, limit: 50, total: 0, total_pages: 1 });
    } catch (err) {
      setError(err?.message || 'Could not load capture inbox.');
    } finally {
      setLoading(false);
    }
  }, [apiCall, captureType, search, status]);

  useEffect(() => {
    loadCaptures(1);
  }, [loadCaptures]);

  const visibleCounts = useMemo(() => {
    const counts = { active: 0, barcode: 0, photo: 0, ocr: 0 };
    items.forEach((item) => {
      if (item.status === 'new' || item.status === 'reviewed') counts.active += 1;
      if (item.capture_type === 'barcode') counts.barcode += 1;
      if (item.capture_type === 'photo') counts.photo += 1;
      if (item.capture_type === 'ocr_text') counts.ocr += 1;
    });
    return counts;
  }, [items]);

  const payloadFromForm = () => ({
    title: form.title || null,
    capture_type: form.capture_type,
    object_type: form.object_type,
    barcode: form.barcode || null,
    symbology: form.symbology || null,
    image_path: form.image_path || null,
    ocr_text: form.ocr_text || null,
    notes: form.notes || null,
    source_context: { source: 'web_capture_inbox' }
  });

  const saveCapture = async () => {
    setSaving(true);
    try {
      await apiCall('post', '/capture-items', payloadFromForm());
      onToast?.('Capture saved.', 'success');
      setEditorOpen(false);
      setForm(EMPTY_FORM);
      await loadCaptures(1);
    } catch (err) {
      onToast?.(err?.message || 'Could not save capture.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (item, nextStatus) => {
    try {
      await apiCall('patch', `/capture-items/${item.id}`, { status: nextStatus });
      onToast?.(`Capture marked ${nextStatus}.`, 'success');
      await loadCaptures(pagination.page || 1);
    } catch (err) {
      onToast?.(err?.message || 'Could not update capture.', 'error');
    }
  };

  const convertToWishlist = async (item) => {
    try {
      await apiCall('post', `/capture-items/${item.id}/convert-wishlist`, {});
      onToast?.('Capture added to Wishlist.', 'success');
      await loadCaptures(pagination.page || 1);
    } catch (err) {
      onToast?.(err?.message || 'Could not convert capture.', 'error');
    }
  };

  const deleteCapture = async (item) => {
    if (!window.confirm('Delete this capture?')) return;
    try {
      await apiCall('delete', `/capture-items/${item.id}`);
      onToast?.('Capture deleted.', 'success');
      await loadCaptures(pagination.page || 1);
    } catch (err) {
      onToast?.(err?.message || 'Could not delete capture.', 'error');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Capture Inbox</h1>
          <p className="mt-1 text-sm text-ghost">{activeLibrary?.name || 'Current library'}</p>
        </div>
        <button
          type="button"
          className="btn-primary inline-flex items-center gap-2"
          onClick={() => {
            setForm(EMPTY_FORM);
            setEditorOpen(true);
          }}
        >
          {Icons?.Camera ? <Icons.Camera /> : null}
          New capture
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="border-b border-edge pb-2">
          <div className="text-xs text-ghost">Active</div>
          <div className="mt-1 text-xl font-semibold text-ink">{visibleCounts.active}</div>
        </div>
        <div className="border-b border-edge pb-2">
          <div className="text-xs text-ghost">Barcode</div>
          <div className="mt-1 text-xl font-semibold text-ink">{visibleCounts.barcode}</div>
        </div>
        <div className="border-b border-edge pb-2">
          <div className="text-xs text-ghost">Photo</div>
          <div className="mt-1 text-xl font-semibold text-ink">{visibleCounts.photo}</div>
        </div>
        <div className="border-b border-edge pb-2">
          <div className="text-xs text-ghost">OCR</div>
          <div className="mt-1 text-xl font-semibold text-ink">{visibleCounts.ocr}</div>
        </div>
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
            ariaLabel="Capture status"
          />
          <div className="flex flex-wrap items-center gap-2">
            <select className="select h-9 min-w-36" value={captureType} onChange={(event) => setCaptureType(event.target.value)}>
              <option value="all">All captures</option>
              {CAPTURE_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <input
              className="input h-9 w-64 max-w-full"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search title, barcode, OCR, note"
            />
            <button type="button" className="btn-ghost h-9" onClick={() => loadCaptures(1)}>Search</button>
          </div>
        </div>
      </div>

      {editorOpen ? (
        <CaptureEditor
          form={form}
          setForm={setForm}
          saving={saving}
          onSave={saveCapture}
          onCancel={() => {
            setEditorOpen(false);
            setForm(EMPTY_FORM);
          }}
        />
      ) : null}

      {editorOpen && items.length === 0 ? null : loading ? (
        <div className="flex min-h-52 items-center justify-center text-ghost">
          {Spinner ? <Spinner /> : 'Loading...'}
        </div>
      ) : error ? (
        <div className="py-4 text-sm text-err">{error}</div>
      ) : items.length === 0 ? (
        <div className="border-b border-edge/70 py-6 text-sm text-ghost">No captures match this view.</div>
      ) : (
        <div className="divide-y divide-edge/70 border-b border-edge/70">
          {items.map((item) => {
            const primary = item.title || item.barcode || item.ocr_text || item.notes || 'Untitled capture';
            const secondary = [
              typeLabel(item.capture_type, CAPTURE_TYPES),
              typeLabel(item.object_type, OBJECT_TYPES),
              item.barcode,
              dateLabel(item.updated_at)
            ].filter(Boolean).join(' · ');
            return (
              <div key={item.id} className="grid gap-3 py-3 md:grid-cols-[1fr_auto] md:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="truncate text-sm font-medium text-ink">{primary}</div>
                    <span className="text-xs text-ghost">#{item.id}</span>
                    <span className="text-xs text-dim">{item.status}</span>
                  </div>
                  <div className="mt-1 text-xs text-ghost">{secondary}</div>
                  {item.ocr_text ? <div className="mt-1 line-clamp-2 text-xs text-dim">{item.ocr_text}</div> : null}
                  {item.notes ? <div className="mt-1 line-clamp-2 text-xs text-dim">{item.notes}</div> : null}
                </div>
                <div className="flex flex-wrap gap-2 md:justify-end">
                  {item.status !== 'reviewed' && item.status !== 'converted' && (
                    <button type="button" className="btn-ghost btn-sm" onClick={() => updateStatus(item, 'reviewed')}>
                      {Icons?.Check ? <Icons.Check /> : null}
                      Reviewed
                    </button>
                  )}
                  {item.status !== 'converted' && (
                    <button type="button" className="btn-ghost btn-sm" onClick={() => convertToWishlist(item)}>
                      Wishlist
                    </button>
                  )}
                  {item.status !== 'discarded' && item.status !== 'converted' && (
                    <button type="button" className="btn-ghost btn-sm text-err" onClick={() => updateStatus(item, 'discarded')}>
                      Discard
                    </button>
                  )}
                  <button type="button" className="btn-ghost btn-sm text-err" onClick={() => deleteCapture(item)}>
                    {Icons?.Trash ? <Icons.Trash /> : null}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CollectionPaginationFooter
        page={pagination.page}
        totalPages={pagination.total_pages}
        hasMore={(pagination.page || 1) < (pagination.total_pages || 1)}
        loading={loading}
        pageSize={pagination.limit || 50}
        showPageSize={false}
        onPrevious={() => loadCaptures(Math.max(1, (pagination.page || 1) - 1))}
        onNext={() => loadCaptures(Math.min(pagination.total_pages || 1, (pagination.page || 1) + 1))}
        leadingContent={`${pagination.total || 0} captures`}
        className="px-0"
      />
    </div>
  );
}
