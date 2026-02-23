import React, { useEffect, useState } from 'react';

export default function AdminActivityView({ apiCall, Icons, Spinner }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ action: '', entity: '', user: '', from: '', to: '', q: '' });
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

  const load = async (targetPage = page) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String((targetPage - 1) * pageSize)
      });
      if (filters.action) params.set('action', filters.action);
      if (filters.entity) params.set('entity', filters.entity);
      if (filters.user) params.set('user', filters.user);
      if (filters.from) params.set('from', filters.from);
      if (filters.to) params.set('to', filters.to);
      if (filters.q) params.set('q', filters.q);
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
      <div className="flex gap-3 flex-wrap">
        <input className="input w-44" placeholder="Filter by action…" value={filters.action} onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))} />
        <input className="input w-40" placeholder="Entity…" value={filters.entity} onChange={(e) => setFilters((f) => ({ ...f, entity: e.target.value }))} />
        <input className="input w-56" placeholder="User email or ID…" value={filters.user} onChange={(e) => setFilters((f) => ({ ...f, user: e.target.value }))} />
        <input className="input w-36" type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
        <input className="input w-36" type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
        <input className="input flex-1 min-w-36" placeholder="Search details…" value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} />
        <button onClick={() => load(1)} className="btn-primary">Apply</button>
        <select className="select w-36" value={pageSizeMode} onChange={(e) => setPageSizeMode(e.target.value)}>
          <option value="auto">Page size: Auto ({autoPageSize})</option>
          <option value="25">Page size: 25</option>
          <option value="50">Page size: 50</option>
          <option value="100">Page size: 100</option>
        </select>
      </div>
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
