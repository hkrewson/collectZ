import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FilterMenu, FixedPageShell, Icons as DefaultIcons, UtilityPageHeader, cx } from './app/AppPrimitives';

const SOURCE_OPTIONS = [
  { value: 'all', label: 'All sources' },
  { value: 'library', label: 'Library' },
  { value: 'capture', label: 'Capture' },
  { value: 'wishlist', label: 'Wishlist' },
  { value: 'plex', label: 'Plex' },
  { value: 'sync', label: 'Syncs' }
];

const TYPE_OPTIONS = [
  { value: 'all', label: 'All review types' },
  { value: 'missing_cover', label: 'Missing cover' },
  { value: 'missing_identifier', label: 'Missing identifier' },
  { value: 'sparse_metadata', label: 'Sparse metadata' },
  { value: 'capture_choice', label: 'Capture choice' },
  { value: 'capture_ready', label: 'Capture ready' },
  { value: 'capture_problem', label: 'Capture problem' },
  { value: 'price_hit', label: 'Target price hit' },
  { value: 'plex_conflict', label: 'Plex conflict' },
  { value: 'failed_sync', label: 'Failed sync' }
];

function formatDateTime(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function severityClass(severity) {
  const normalized = String(severity || '').toLowerCase();
  if (normalized === 'danger') return 'text-err';
  if (normalized === 'warning' || normalized === 'attention') return 'text-warn';
  if (normalized === 'ok') return 'text-ok';
  return 'text-dim';
}

function countLabel(counts, key) {
  const value = counts?.by_source?.[key] ?? counts?.by_type?.[key] ?? 0;
  return Number(value || 0);
}

function ReviewQueueRow({ item, onOpen }) {
  const timestamp = formatDateTime(item?.updated_at || item?.created_at);
  return (
    <div className="border-b border-edge/70 px-3 py-3 last:border-b-0">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <p className="min-w-0 truncate text-sm font-semibold text-ink">{item?.title || 'Untitled review item'}</p>
            <span className={cx('text-xs font-medium', severityClass(item?.severity))}>{item?.label || 'Review'}</span>
          </div>
          <p className="mt-1 truncate text-xs text-ghost">{[item?.source_label, item?.summary].filter(Boolean).join(' · ')}</p>
          {item?.reason ? <p className="mt-1 break-words text-xs text-dim">{item.reason}</p> : null}
        </div>
        {item?.action ? (
          <button type="button" className="btn-secondary btn-sm shrink-0" onClick={() => onOpen?.(item)}>
            Open
          </button>
        ) : null}
      </div>
      {timestamp ? <p className="mt-2 text-xs text-ghost">{timestamp}</p> : null}
    </div>
  );
}

export default function ReviewQueueView({
  apiCall,
  onToast,
  setActiveTab,
  setActiveIntegrationSection,
  setLibraryReviewFilter,
  Icons = DefaultIcons,
  Spinner
}) {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [source, setSource] = useState('all');
  const [type, setType] = useState('all');
  const [search, setSearch] = useState('');

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (source !== 'all') params.set('source', source);
    if (type !== 'all') params.set('type', type);
    if (search.trim()) params.set('search', search.trim());
    params.set('limit', '80');
    try {
      const next = await apiCall('get', `/review-queue?${params.toString()}`);
      setPayload(next || null);
    } catch (err) {
      const message = err?.response?.data?.error || err?.message || 'Could not load review queue.';
      setError(message);
      onToast?.(message, 'error');
    } finally {
      setLoading(false);
    }
  }, [apiCall, onToast, search, source, type]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      loadQueue();
    }, search ? 200 : 0);
    return () => window.clearTimeout(handle);
  }, [loadQueue, search]);

  const counts = payload?.counts || {};
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const activeFilterCount = [source !== 'all', type !== 'all'].filter(Boolean).length;
  const sourceSummary = useMemo(() => {
    const selectedSource = SOURCE_OPTIONS.find((option) => option.value === source)?.label || 'All sources';
    const selectedType = TYPE_OPTIONS.find((option) => option.value === type)?.label || 'All review types';
    return source === 'all' && type === 'all' ? 'All review items' : `${selectedSource} · ${selectedType}`;
  }, [source, type]);

  const openItem = (item) => {
    const action = item?.action || {};
    if (action.target_section) setActiveIntegrationSection?.(action.target_section);
    if (action.review_filter) {
      setLibraryReviewFilter?.({ type: action.review_filter, createdAt: Date.now() });
    }
    if (action.target_tab) setActiveTab?.(action.target_tab);
  };

  const clearFilters = () => {
    setSource('all');
    setType('all');
  };

  const header = (
    <UtilityPageHeader
      title="Review"
      subtitle="Items that need a decision, repair, or follow-up."
      actions={(
        <button type="button" className="btn-secondary btn-sm" onClick={loadQueue} disabled={loading}>
          {loading ? 'Refreshing' : 'Refresh'}
        </button>
      )}
      controls={(
        <div className="flex min-w-0 items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Icons.Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ghost" aria-hidden="true" />
            <input
              className="input h-9 w-full pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search review items"
              aria-label="Search review items"
            />
          </div>
          <FilterMenu
            summary={sourceSummary}
            activeCount={activeFilterCount}
            ariaLabel="Review filters"
            onClear={activeFilterCount > 0 ? clearFilters : null}
            Icons={Icons}
          >
            <label className="block text-xs text-ghost" htmlFor="review-source-filter">Source</label>
            <select id="review-source-filter" className="select w-full" value={source} onChange={(event) => setSource(event.target.value)}>
              {SOURCE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <label className="block text-xs text-ghost" htmlFor="review-type-filter">Type</label>
            <select id="review-type-filter" className="select w-full" value={type} onChange={(event) => setType(event.target.value)}>
              {TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </FilterMenu>
        </div>
      )}
      compact
      showTitleOnMobile={false}
    />
  );

  return (
    <FixedPageShell
      header={header}
      headerTestId="review-page-header"
      bodyTestId="review-page-body"
      bodyInnerClassName="mx-auto w-full max-w-6xl px-4 py-4 sm:px-6"
    >
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {SOURCE_OPTIONS.filter((option) => option.value !== 'all').map((option) => (
          <button
            key={option.value}
            type="button"
            className={cx(
              'rounded-lg border px-3 py-2 text-left transition',
              source === option.value ? 'border-brand bg-brand/10 text-ink' : 'border-edge bg-panel text-dim hover:border-dim hover:text-ink'
            )}
            onClick={() => setSource(option.value)}
          >
            <p className="text-xs text-ghost">{option.label}</p>
            <p className="mt-1 text-lg font-semibold text-ink">{countLabel(counts, option.value)}</p>
          </button>
        ))}
      </div>

      <section className="mt-4 overflow-hidden rounded-lg border border-edge bg-panel">
        <div className="flex items-center justify-between gap-3 border-b border-edge px-3 py-2">
          <h2 className="text-sm font-semibold text-ink">Queue</h2>
          <span className="text-xs text-ghost">{items.length} shown · {counts.total || 0} total signals</span>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 px-3 py-4 text-sm text-ghost">
            {Spinner ? <Spinner size={16} /> : null}
            Loading review items
          </div>
        ) : error ? (
          <div className="px-3 py-4 text-sm text-err">{error}</div>
        ) : items.length ? (
          <div>
            {items.map((item) => <ReviewQueueRow key={item.id} item={item} onOpen={openItem} />)}
          </div>
        ) : (
          <div className="px-3 py-6 text-sm text-ghost">No review items match this view.</div>
        )}
      </section>
    </FixedPageShell>
  );
}
