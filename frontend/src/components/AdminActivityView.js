import React, { useEffect, useState } from 'react';

export default function AdminActivityView({ apiCall, Icons, Spinner }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    search: '',
    action: '',
    entity: '',
    user: '',
    status: '',
    reason: '',
    from: '',
    to: ''
  });
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [pageSizeMode, setPageSizeMode] = useState('auto');
  const [autoPageSize, setAutoPageSize] = useState(50);
  const pageSize = pageSizeMode === 'auto' ? autoPageSize : Number(pageSizeMode);

  useEffect(() => {
    const computeAutoSize = () => {
      const raw = Math.floor((window.innerHeight - 320) / 72);
      const bounded = Math.max(10, Math.min(100, raw));
      setAutoPageSize(bounded);
    };
    computeAutoSize();
    window.addEventListener('resize', computeAutoSize);
    return () => window.removeEventListener('resize', computeAutoSize);
  }, []);

  const load = async (targetPage = page, filterOverride = null) => {
    setLoading(true);
    try {
      const effectiveFilters = filterOverride || filters;
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String((targetPage - 1) * pageSize)
      });
      if (effectiveFilters.search) params.set('search', effectiveFilters.search);
      if (effectiveFilters.action) params.set('action', effectiveFilters.action);
      if (effectiveFilters.entity) params.set('entity', effectiveFilters.entity);
      if (effectiveFilters.user) params.set('user', effectiveFilters.user);
      if (effectiveFilters.status) params.set('status', effectiveFilters.status);
      if (effectiveFilters.reason) params.set('reason', effectiveFilters.reason);
      if (effectiveFilters.from) params.set('from', effectiveFilters.from);
      if (effectiveFilters.to) params.set('to', effectiveFilters.to);
      const data = await apiCall('get', `/admin/activity?${params}`);
      const rows = Array.isArray(data) ? data : [];
      setItems(rows);
      setHasMore(rows.length === pageSize);
      setPage(targetPage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(1); }, [pageSizeMode, autoPageSize]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="h-full overflow-y-auto p-6 max-w-4xl space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="section-title flex-1">Activity Log</h1>
        <button onClick={load} className="btn-icon"><Icons.Refresh /></button>
      </div>
      <form
        className="grid gap-3 md:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          load(1);
        }}
      >
        <input
          className="input md:col-span-3"
          placeholder="Search action, entity, user, details… (Press Enter)"
          value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
        />
        <input
          className="input"
          placeholder="Action (exact)"
          value={filters.action}
          onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}
        />
        <input
          className="input"
          placeholder="Entity (exact)"
          value={filters.entity}
          onChange={(e) => setFilters((f) => ({ ...f, entity: e.target.value }))}
        />
        <input
          className="input"
          placeholder="User email or id"
          value={filters.user}
          onChange={(e) => setFilters((f) => ({ ...f, user: e.target.value }))}
        />
        <select className="select" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
          <option value="">Status: Any</option>
          <option value="2xx">Status: 2xx</option>
          <option value="4xx">Status: 4xx</option>
          <option value="5xx">Status: 5xx</option>
          <option value="401">Status: 401</option>
          <option value="403">Status: 403</option>
          <option value="404">Status: 404</option>
          <option value="429">Status: 429</option>
          <option value="500">Status: 500</option>
        </select>
        <input
          className="input"
          placeholder="Reason contains…"
          value={filters.reason}
          onChange={(e) => setFilters((f) => ({ ...f, reason: e.target.value }))}
        />
        <select className="select" value={pageSizeMode} onChange={(e) => setPageSizeMode(e.target.value)}>
          <option value="auto">Page size: Auto ({autoPageSize})</option>
          <option value="25">Page size: 25</option>
          <option value="50">Page size: 50</option>
          <option value="100">Page size: 100</option>
        </select>
        <input className="input" type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
        <input className="input" type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
        <div className="flex items-center gap-2">
          <button type="submit" className="btn-secondary btn-sm">Apply</button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => {
              const cleared = {
                search: '', action: '', entity: '', user: '', status: '', reason: '', from: '', to: ''
              };
              setFilters(cleared);
              load(1, cleared);
            }}
          >
            Clear
          </button>
        </div>
      </form>
      <div className="flex items-center gap-2">
        <button onClick={() => load(Math.max(1, page - 1))} disabled={loading || page <= 1} className="btn-secondary btn-sm">Previous</button>
        <span className="text-xs text-ghost font-mono">Page {page}</span>
        <button onClick={() => load(page + 1)} disabled={loading || !hasMore} className="btn-secondary btn-sm">Next</button>
      </div>
      {loading ? <div className="flex justify-center py-12"><Spinner size={28} /></div> : (
        <div className="card divide-y divide-edge">
          {items.length === 0 && <p className="px-4 py-6 text-sm text-ghost text-center">No activity entries</p>}
          {items.map((entry) => (
            <div key={entry.id} className="px-4 py-3 space-y-1">
              <div className="flex items-center gap-3">
                <span className="badge badge-dim font-mono text-[10px]">{entry.action}</span>
                {entry.details_status && <span className="badge badge-err font-mono text-[10px]">{entry.details_status}</span>}
                {entry.details_reason && <span className="badge badge-warn font-mono text-[10px]">{entry.details_reason}</span>}
                <span className="text-xs text-ghost ml-auto">{new Date(entry.created_at).toLocaleString()}</span>
              </div>
              <p className="text-xs text-ghost">
                {entry.entity_type && <span>entity: {entry.entity_type} #{entry.entity_id} · </span>}
                user: {entry.user_email || entry.user_id || '–'} · {entry.ip_address || '–'}
              </p>
              {entry.details && <p className="text-xs text-ghost/60 font-mono whitespace-pre-wrap break-words">{JSON.stringify(entry.details, null, 2)}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
