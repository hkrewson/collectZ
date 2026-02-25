import React, { useEffect, useState } from 'react';

export default function AdminActivityView({ apiCall, Spinner }) {
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
      const data = await apiCall('get', `/admin/activity?${params}`);
      const rows = Array.isArray(data) ? data : [];
      setItems(rows);
      setHasMore(rows.length === pageSize);
      setPage(targetPage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(1); }, [pageSize]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="h-full overflow-y-auto p-6 max-w-4xl space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="section-title flex-1">Activity Log</h1>
      </div>
      <form
        className="flex gap-3 flex-wrap items-center"
        onSubmit={(e) => {
          e.preventDefault();
          load(1, search);
        }}
      >
        <input
          className="input flex-1 min-w-56"
          placeholder="Search action, entity, user, details… (Press Enter)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="select w-24" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
          <option value={10}>10</option>
          <option value={25}>25</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
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
