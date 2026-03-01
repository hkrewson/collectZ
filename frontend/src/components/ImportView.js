import React, { useEffect, useMemo, useRef, useState } from 'react';

export default function ImportView({
  apiCall,
  onToast,
  onImported,
  canImportPlex,
  onQueueJob,
  importJobs = [],
  apiUrl,
  Icons,
  Spinner,
  cx,
  activeLibrary = null
}) {
  const [tab, setTab] = useState(canImportPlex ? 'plex' : 'csv');
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState('');
  const [barcodeUpc, setBarcodeUpc] = useState('');
  const [barcodeResults, setBarcodeResults] = useState([]);
  const [barcodeLookupLoading, setBarcodeLookupLoading] = useState(false);
  const [barcodeAddingId, setBarcodeAddingId] = useState('');
  const [auditRows, setAuditRows] = useState([]);
  const [auditName, setAuditName] = useState('');
  const csvInputRef = useRef(null);
  const calibreInputRef = useRef(null);
  const deliciousInputRef = useRef(null);
  const completedJobIdsRef = useRef(new Set());

  const downloadAudit = () => {
    if (!auditRows.length) return;
    const esc = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [
      ['row', 'status', 'title', 'detail', 'match_mode', 'matched_by', 'enrichment_status', 'isbn', 'ean_upc', 'asin'].map(esc).join(','),
      ...auditRows.map((r) => [
        r.row,
        r.status,
        r.title,
        r.detail,
        r.match_mode || '',
        r.matched_by || '',
        r.enrichment_status || '',
        r.isbn || '',
        r.ean_upc || '',
        r.asin || ''
      ].map(esc).join(','))
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    a.download = `collectz-import-audit-${auditName || 'report'}-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const runPlexImport = async () => {
    if (!canImportPlex) return;
    setBusy('plex');
    setResult('');
    setAuditRows([]);
    setAuditName('');
    try {
      const res = await apiCall('post', '/media/import-plex?async=true', {});
      const jobId = res?.job?.id;
      if (!jobId) throw new Error('Missing import job id');
      onQueueJob?.({
        id: jobId,
        provider: 'plex',
        status: res?.job?.status || 'queued',
        progress: res?.job?.progress || null
      });
      setResult(`Plex import queued (job #${jobId})`);
      onToast('Plex import started');
    } catch (err) {
      const msg = err.response?.data?.error || 'Plex import failed';
      setResult(msg);
      onToast(msg, 'error');
    } finally { setBusy(''); }
  };

  const runCsvImport = async (file, endpoint, label) => {
    if (!file) return;
    setBusy(label);
    setResult('');
    setAuditRows([]);
    setAuditName('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await apiCall('post', `${endpoint}?async=true`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      const jobId = res?.job?.id;
      if (!jobId) throw new Error('Missing import job id');
      const provider = label === 'Delicious'
        ? 'csv_delicious'
        : label === 'Calibre'
          ? 'csv_calibre'
          : 'csv_generic';
      onQueueJob?.({
        id: jobId,
        provider,
        status: res?.job?.status || 'queued',
        progress: res?.job?.progress || null
      });
      setResult(`${label} import queued (job #${jobId})`);
      onToast(`${label} import started`);
    } catch (err) {
      const msg = err.response?.data?.error || `${label} import failed`;
      setResult(msg);
      onToast(msg, 'error');
    } finally {
      setBusy('');
    }
  };

  const lookupBarcode = async () => {
    const upc = barcodeUpc.trim();
    if (!upc) return;
    setBarcodeLookupLoading(true);
    setResult('');
    setBarcodeResults([]);
    try {
      const response = await apiCall('post', '/media/lookup-upc', { upc });
      const matches = Array.isArray(response?.matches) ? response.matches : [];
      setBarcodeResults(matches);
      if (!matches.length) setResult('No barcode matches found');
    } catch (err) {
      const msg = err.response?.data?.error || 'Barcode lookup failed';
      setResult(msg);
      onToast(msg, 'error');
    } finally {
      setBarcodeLookupLoading(false);
    }
  };

  const addBarcodeMatch = async (match, index) => {
    const addId = `${match?.upc || barcodeUpc}-${index}`;
    setBarcodeAddingId(addId);
    try {
      const tmdb = match?.tmdb || {};
      const releaseDate = tmdb?.release_date || '';
      const payload = {
        title: tmdb?.title || match?.title || `UPC ${barcodeUpc.trim()}`,
        original_title: tmdb?.original_title || null,
        release_date: releaseDate || null,
        year: tmdb?.release_year || (releaseDate ? Number(String(releaseDate).slice(0, 4)) : null),
        media_type: 'movie',
        format: 'Blu-ray',
        genre: Array.isArray(tmdb?.genre_names) ? tmdb.genre_names.join(', ') : null,
        rating: tmdb?.rating || null,
        upc: match?.upc || barcodeUpc.trim() || null,
        notes: match?.source ? `Imported via barcode (${match.source})` : 'Imported via barcode',
        overview: tmdb?.overview || match?.description || null,
        tmdb_id: tmdb?.id || null,
        tmdb_media_type: tmdb?.tmdb_media_type || 'movie',
        tmdb_url: tmdb?.id ? `https://www.themoviedb.org/${tmdb?.tmdb_media_type || 'movie'}/${tmdb.id}` : null,
        poster_path: tmdb?.poster_path || match?.image || null,
        backdrop_path: tmdb?.backdrop_path || null
      };
      await apiCall('post', '/media', payload);
      onImported?.();
      onToast(`Added "${payload.title}" from barcode`);
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to add barcode match';
      setResult(msg);
      onToast(msg, 'error');
    } finally {
      setBarcodeAddingId('');
    }
  };

  const tabs = [
    ...(canImportPlex ? [{ id: 'plex', label: 'Plex' }] : []),
    { id: 'barcode', label: 'Barcode' },
    { id: 'calibre', label: 'Calibre CSV' },
    { id: 'csv', label: 'Generic CSV' },
    { id: 'delicious', label: 'Delicious CSV' }
  ];
  const hasActiveLibrary = Boolean(activeLibrary?.id);
  const recentJobs = useMemo(
    () => importJobs.filter((job) => ['plex', 'csv_generic', 'csv_calibre', 'csv_delicious'].includes(job.provider)).slice(0, 5),
    [importJobs]
  );
  useEffect(() => {
    for (const job of recentJobs) {
      if (job.status !== 'succeeded') continue;
      const id = Number(job.id);
      if (completedJobIdsRef.current.has(id)) continue;
      completedJobIdsRef.current.add(id);
      const rows = Array.isArray(job?.summary?.auditRows) ? job.summary.auditRows : [];
      if (rows.length > 0) {
        setAuditRows(rows);
        setAuditName(job.provider || 'import');
      }
      onImported?.();
    }
  }, [recentJobs, onImported]);

  return (
    <div className="h-full overflow-y-auto p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="section-title">Import Media</h1>
        <p className="text-sm text-ghost mt-1">Add titles from external sources into your library.</p>
      </div>

      <div className="tab-strip w-full max-w-xl">
        {tabs.map((t) => (
          <button key={t.id} className={cx('tab flex-1', tab === t.id && 'active')} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="card p-5 space-y-4">
        {tab === 'plex' && (
          <>
            <p className="text-sm text-dim">Import titles from your configured Plex server and selected sections.</p>
            <p className="text-xs text-ghost">Uses saved Admin Integrations Plex settings. Import runs async with progress, deduplication, and TMDB enrichment when possible.</p>
            <button onClick={runPlexImport} className="btn-primary" disabled={busy === 'plex' || !hasActiveLibrary}>
              {busy === 'plex' ? <Spinner size={14} /> : <><Icons.Upload />Start Plex Import</>}
            </button>
            {recentJobs.length > 0 && (
              <div className="card p-3 text-xs text-dim font-mono whitespace-pre-wrap">
                {recentJobs.map((job) => (
                  <div key={job.id} className="mb-2 last:mb-0">
                    Job #{job.id} · {job.provider} · {job.status}
                    {job.progress && (
                      <>
                        {'\n'}Processed: {job.progress.processed || 0} / {job.progress.total || 0}
                        {'\n'}Created: {job.progress.created || 0} · Updated: {job.progress.updated || 0}
                        {'\n'}Skipped: {job.progress.skipped || 0} · Errors: {job.progress.errorCount || 0}
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'csv' && (
          <>
            <p className="text-sm text-dim">Import from a CSV file using collectZ columns.</p>
            <p className="text-xs text-ghost">Required: title. Optional: year, format, director, genre, rating, user_rating, runtime, upc, isbn, ean_upc, asin, location, notes.</p>
            <div className="flex flex-wrap gap-3">
              <button onClick={() => csvInputRef.current?.click()} className="btn-primary" disabled={busy === 'CSV' || !hasActiveLibrary}>
                {busy === 'CSV' ? <Spinner size={14} /> : <><Icons.Upload />Choose CSV File</>}
              </button>
              <a href={`${apiUrl}/media/import/template-csv`} className="btn-secondary"><Icons.Download />Download Template</a>
            </div>
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                runCsvImport(file, '/media/import-csv', 'CSV');
              }}
            />
          </>
        )}

        {tab === 'calibre' && (
          <>
            <p className="text-sm text-dim">Import a Calibre CSV export (books/comics baseline mapping).</p>
            <p className="text-xs text-ghost">Maps common Calibre columns (`title`, `authors`, `isbn`, `publisher`, `pubdate`, `tags`, `series`, `series_index`) and runs normal enrichment/dedup pipeline.</p>
            <button onClick={() => calibreInputRef.current?.click()} className="btn-primary" disabled={busy === 'Calibre' || !hasActiveLibrary}>
              {busy === 'Calibre' ? <Spinner size={14} /> : <><Icons.Upload />Choose Calibre CSV</>}
            </button>
            <input
              ref={calibreInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                runCsvImport(file, '/media/import-csv/calibre', 'Calibre');
              }}
            />
          </>
        )}

        {tab === 'delicious' && (
          <>
            <p className="text-sm text-dim">Import a Delicious export CSV.</p>
            <p className="text-xs text-ghost">Supports mixed media rows (movies, TV, books, audio, games). Uses provider enrichment + identifier-first matching when available.</p>
            <button onClick={() => deliciousInputRef.current?.click()} className="btn-primary" disabled={busy === 'Delicious' || !hasActiveLibrary}>
              {busy === 'Delicious' ? <Spinner size={14} /> : <><Icons.Upload />Choose Delicious CSV</>}
            </button>
            <input
              ref={deliciousInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                runCsvImport(file, '/media/import-csv/delicious', 'Delicious');
              }}
            />
          </>
        )}

        {tab === 'barcode' && (
          <>
            <p className="text-sm text-dim">Look up a UPC and add matched media to your library.</p>
            <p className="text-xs text-ghost">Uses Admin Integrations barcode + TMDB settings for quick physical media ingest.</p>
            <div className="flex gap-3">
              <input
                className="input flex-1 font-mono"
                placeholder="012345678901"
                value={barcodeUpc}
                onChange={(e) => setBarcodeUpc(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    lookupBarcode();
                  }
                }}
              />
              <button onClick={lookupBarcode} className="btn-primary" disabled={barcodeLookupLoading || !barcodeUpc.trim() || !hasActiveLibrary}>
                {barcodeLookupLoading ? <Spinner size={14} /> : <><Icons.Barcode />Lookup</>}
              </button>
            </div>
            {barcodeResults.length > 0 && (
              <div className="space-y-2">
                {barcodeResults.slice(0, 8).map((m, idx) => {
                  const addId = `${m?.upc || barcodeUpc}-${idx}`;
                  const title = m?.tmdb?.title || m?.title || 'Unknown';
                  const year = m?.tmdb?.release_year || (m?.tmdb?.release_date ? String(m.tmdb.release_date).slice(0, 4) : '');
                  return (
                    <div key={addId} className="card p-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-ink truncate">{title}</p>
                        <p className="text-xs text-ghost">
                          {year || 'n/a'}{m?.upc ? ` · UPC ${m.upc}` : ''}{m?.source ? ` · ${m.source}` : ''}
                        </p>
                      </div>
                      <button className="btn-secondary btn-sm" disabled={barcodeAddingId === addId || !hasActiveLibrary} onClick={() => addBarcodeMatch(m, idx)}>
                        {barcodeAddingId === addId ? <Spinner size={14} /> : 'Add'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      <div className="card p-4 text-xs text-ghost space-y-1">
        <p>Import behavior:</p>
        <p>- Existing titles are matched identifier-first (ISBN/EAN/ASIN), then provider IDs, then title/year fallback.</p>
        <p>- Audit downloads include normalized identifiers and per-row match mode.</p>
        <p>- Provider enrichment runs during import when configured.</p>
      </div>

      {result && <pre className="card p-4 text-xs text-dim whitespace-pre-wrap">{result}</pre>}
      {auditRows.length > 0 && (
        <div className="flex">
          <button onClick={downloadAudit} className="btn-secondary"><Icons.Download />Download Audit CSV</button>
        </div>
      )}
    </div>
  );
}
