import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Spinner } from './app/AppPrimitives';

export default function ImportReviewView({ apiCall, onToast }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: 25, total: 0, totalPages: 1 });
  const [altMediaIdByRow, setAltMediaIdByRow] = useState({});

  const canPrev = page > 1;
  const canNext = page < (pagination.totalPages || 1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('status', 'pending');
      params.set('page', String(page));
      params.set('limit', String(pagination.limit || 25));
      if (search.trim()) params.set('search', search.trim());
      const payload = await apiCall('get', `/media/import-reviews?${params.toString()}`);
      setRows(Array.isArray(payload?.items) ? payload.items : []);
      setPagination(payload?.pagination || { page: 1, limit: 25, total: 0, totalPages: 1 });
    } catch (error) {
      onToast?.(error.response?.data?.error || 'Failed to load import reviews', 'error');
    } finally {
      setLoading(false);
    }
  }, [apiCall, onToast, page, pagination.limit, search]);

  useEffect(() => {
    load();
  }, [load]);

  const resolve = useCallback(async (row, action) => {
    setBusyId(row.id);
    try {
      const payload = { action };
      if (action === 'choose_alternate') {
        const chosen = Number(altMediaIdByRow[row.id]);
        if (!Number.isFinite(chosen) || chosen <= 0) {
          onToast?.('Provide a valid media id for alternate match', 'error');
          return;
        }
        payload.resolved_media_id = chosen;
      }
      await apiCall('patch', `/media/import-reviews/${row.id}`, payload);
      onToast?.('Import review updated');
      setRows((prev) => prev.filter((entry) => entry.id !== row.id));
    } catch (error) {
      onToast?.(error.response?.data?.error || 'Failed to resolve import review', 'error');
    } finally {
      setBusyId(null);
    }
  }, [altMediaIdByRow, apiCall, onToast]);

  const summaryText = useMemo(() => {
    const total = Number(pagination.total || 0);
    if (!total) return 'No pending import reviews';
    return `${total} pending review${total === 1 ? '' : 's'}`;
  }, [pagination.total]);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="card p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs text-dim mb-1">Search title</label>
            <input
              className="input w-full"
              placeholder="Search pending rows..."
              value={search}
              onChange={(e) => { setPage(1); setSearch(e.target.value); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') load();
              }}
            />
          </div>
          <button className="btn-secondary" onClick={load} disabled={loading}>Refresh</button>
          <div className="text-xs text-ghost">{summaryText}</div>
        </div>
      </div>

      {loading && (
        <div className="card p-6 text-dim flex items-center gap-2"><Spinner size={16} />Loading import reviews...</div>
      )}

      {!loading && rows.length === 0 && (
        <div className="card p-6 text-dim">No pending import reviews.</div>
      )}

      {!loading && rows.length > 0 && (
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.id} className="card p-4">
              <div className="flex flex-wrap gap-2 text-xs mb-2">
                <span className="badge badge-dim">#{row.id}</span>
                <span className="badge badge-dim">{row.import_source || row.provider || 'import'}</span>
                <span className="badge badge-dim">{row.media_type || 'movie'}</span>
                <span className="badge badge-dim">confidence {row.confidence_score ?? 'n/a'}</span>
                {row.match_mode && <span className="badge badge-dim">{row.match_mode}</span>}
                {row.enrichment_status && <span className="badge badge-dim">{row.enrichment_status}</span>}
                {row.collection_id && <span className="badge badge-dim">collection #{row.collection_id}</span>}
              </div>
              <p className="text-sm font-medium text-ink">{row.source_title || 'Untitled row'}</p>
              <p className="text-xs text-ghost mt-1">
                Suggested: {row.proposed_media_title || (row.proposed_media_id ? `#${row.proposed_media_id}` : 'None')}
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  className="btn-secondary btn-sm"
                  disabled={busyId === row.id}
                  onClick={() => resolve(row, 'accept_suggested')}
                >
                  Accept suggested
                </button>
                <button
                  className="btn-secondary btn-sm"
                  disabled={busyId === row.id}
                  onClick={() => resolve(row, 'search_again')}
                >
                  Search again
                </button>
                <button
                  className="btn-secondary btn-sm"
                  disabled={busyId === row.id}
                  onClick={() => resolve(row, 'skip_keep_manual')}
                >
                  Skip / Keep manual
                </button>
                <input
                  className="input input-sm w-28"
                  placeholder="Media ID"
                  value={altMediaIdByRow[row.id] || ''}
                  onChange={(e) => setAltMediaIdByRow((prev) => ({ ...prev, [row.id]: e.target.value }))}
                />
                <button
                  className="btn-secondary btn-sm"
                  disabled={busyId === row.id}
                  onClick={() => resolve(row, 'choose_alternate')}
                >
                  Choose alternate
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
        <button className="btn-secondary btn-sm" disabled={!canPrev || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
          Previous
        </button>
        <div className="text-xs text-ghost">
          Page {pagination.page || page} / {pagination.totalPages || 1}
        </div>
        <button className="btn-secondary btn-sm" disabled={!canNext || loading} onClick={() => setPage((p) => p + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}
