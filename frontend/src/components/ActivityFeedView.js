import React, { useEffect, useState } from 'react';

function formatActionLabel(action) {
  return String(action || 'activity')
    .split('.')
    .filter(Boolean)
    .map((part) => part.replace(/_/g, ' '))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' / ');
}

function formatEntityLabel(entry) {
  if (!entry?.entity_type) return 'No entity target';
  return `${entry.entity_type}${entry.entity_id ? ` #${entry.entity_id}` : ''}`;
}

export default function ActivityFeedView({
  apiCall,
  Spinner,
  endpoint,
  title = 'Activity',
  description = '',
  emptyMessage = 'No activity entries',
  embedded = false
}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [pageSize, setPageSize] = useState(50);

  const load = async (targetPage = page, searchOverride = null) => {
    setLoading(true);
    try {
      const effectiveSearch = searchOverride !== null ? searchOverride : search;
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String((targetPage - 1) * pageSize)
      });
      if (effectiveSearch) params.set('search', effectiveSearch);
      const data = await apiCall('get', `${endpoint}?${params}`);
      const rows = Array.isArray(data) ? data : [];
      setItems(rows);
      setHasMore(rows.length === pageSize);
      setPage(targetPage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, pageSize]);

  const headingClassName = embedded ? 'text-xl font-medium text-ink' : 'section-title';
  const wrapperClassName = embedded ? 'space-y-6' : 'h-full overflow-y-auto p-4 sm:p-6 space-y-6';

  return (
    <div className={wrapperClassName}>
      <div className="space-y-2">
        <h1 className={headingClassName}>{title}</h1>
        {description ? (
          <p className="text-sm text-ghost max-w-3xl">
            {description}
          </p>
        ) : null}
      </div>
      <form
        className="flex gap-3 flex-wrap items-end"
        onSubmit={(e) => {
          e.preventDefault();
          load(1, search);
        }}
      >
        <label className="field flex-1 min-w-56">
          <span className="label">Search</span>
          <input
            className="input"
            placeholder="Action, user, target, or details"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="field w-24">
          <span className="label">Rows</span>
          <select className="select" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </label>
      </form>
      <div className="flex items-center gap-2">
        <button onClick={() => load(Math.max(1, page - 1))} disabled={loading || page <= 1} className="btn-secondary btn-sm">Previous</button>
        <span className="text-xs text-ghost font-mono">Page {page}</span>
        <button onClick={() => load(page + 1)} disabled={loading || !hasMore} className="btn-secondary btn-sm">Next</button>
      </div>
      {loading ? <div className="flex justify-center py-12"><Spinner size={28} /></div> : (
        <div className="space-y-1">
          {items.length === 0 && <p className="px-4 py-6 text-sm text-ghost text-center">{emptyMessage}</p>}
          {items.map((entry) => (
            <div key={entry.id} className="py-4 space-y-2">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-ink">{formatActionLabel(entry.action)}</p>
                    <span className="badge badge-dim font-mono text-[10px]">{entry.action}</span>
                  </div>
                  <p className="mt-1 text-xs text-ghost">
                    {entry.user_email || entry.user_id || 'Unknown user'} · {formatEntityLabel(entry)} · {entry.ip_address || 'No IP captured'}
                  </p>
                </div>
                {entry.details_status && <span className="badge badge-err font-mono text-[10px]">{entry.details_status}</span>}
                {entry.details_reason && <span className="badge badge-warn font-mono text-[10px]">{entry.details_reason}</span>}
                <span className="text-xs text-ghost shrink-0">{new Date(entry.created_at).toLocaleString()}</span>
              </div>
              {entry.details && Object.keys(entry.details).length > 0 && (
                <details className="text-xs text-ghost">
                  <summary className="cursor-pointer select-none text-dim">Details</summary>
                  <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-raised px-3 py-2 font-mono text-[11px] text-ghost/80">
                    {JSON.stringify(entry.details, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
