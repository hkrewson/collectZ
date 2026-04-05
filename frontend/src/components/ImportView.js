import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CameraCaptureModal, detectBarcodeCapturePayloadFromFile, extractIdentifierCandidatesFromFile, inferBookBarcodeIdentifier, isLikelyRetailBookBarcode, normalizeBarcodeInput, supportsBarcodeCapture } from './app/AppPrimitives';

const cx = (...classes) => classes.filter(Boolean).join(' ');

function BookCaptureStatusCard({ state }) {
  if (!state) return null;
  const toneClasses = state.tone === 'warning'
    ? 'border-gold/30 bg-gold/5'
    : state.tone === 'success'
      ? 'border-ok/30 bg-ok/5'
      : 'border-edge bg-raised';
  const headingClasses = state.tone === 'warning'
    ? 'text-gold'
    : state.tone === 'success'
      ? 'text-ok'
      : 'text-ink';
  return (
    <div className={cx('rounded-xl border p-3 space-y-2', toneClasses)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={cx('label', headingClasses)}>{state.heading}</p>
          {state.detail ? <p className="text-sm text-dim">{state.detail}</p> : null}
        </div>
        <span className="text-[11px] uppercase tracking-[0.16em] text-ghost">{state.source}</span>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <div className="rounded-lg border border-edge bg-surface/60 px-3 py-2">
          <p className="text-[11px] uppercase tracking-[0.16em] text-ghost">Retail Barcode</p>
          <p className="mt-1 font-mono text-sm text-ink">{state.capturedBarcode || 'Not captured'}</p>
        </div>
        <div className="rounded-lg border border-edge bg-surface/60 px-3 py-2">
          <p className="text-[11px] uppercase tracking-[0.16em] text-ghost">Recovered ISBN</p>
          <p className="mt-1 font-mono text-sm text-ink">{state.recoveredIsbn || 'Not recovered yet'}</p>
        </div>
      </div>
      {state.nextStep ? <p className="text-xs text-ghost">{state.nextStep}</p> : null}
    </div>
  );
}

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
  const importSections = useMemo(
    () => ([
      { id: 'barcode', label: 'Barcode', enabled: true },
      { id: 'calibre', label: 'Calibre', enabled: true },
      { id: 'csv', label: 'CSV', enabled: true },
      { id: 'delicious', label: 'Delicious', enabled: true },
      { id: 'plex', label: 'Plex', enabled: canImportPlex }
    ]),
    [canImportPlex]
  );
  const firstEnabledSection = importSections.find((section) => section.enabled)?.id || 'barcode';
  const [tab, setTab] = useState(firstEnabledSection);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState('');
  const [barcodeUpc, setBarcodeUpc] = useState('');
  const [barcodeResults, setBarcodeResults] = useState([]);
  const [barcodeLookupLoading, setBarcodeLookupLoading] = useState(false);
  const [barcodeCaptureLoading, setBarcodeCaptureLoading] = useState(false);
  const [barcodeCameraOpen, setBarcodeCameraOpen] = useState(false);
  const [barcodeAddingId, setBarcodeAddingId] = useState('');
  const [bookCaptureState, setBookCaptureState] = useState(null);
  const [auditRows, setAuditRows] = useState([]);
  const [auditName, setAuditName] = useState('');
  const csvInputRef = useRef(null);
  const calibreInputRef = useRef(null);
  const deliciousInputRef = useRef(null);
  const barcodeCaptureInputRef = useRef(null);
  const completedJobIdsRef = useRef(new Set());
  const canCaptureBarcode = supportsBarcodeCapture();

  const downloadAudit = () => {
    if (!auditRows.length) return;
    const esc = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [
      ['row', 'media_type', 'status', 'audit_outcome', 'classification_detail', 'title', 'detail', 'match_mode', 'matched_by', 'enrichment_status', 'lookup_path', 'lookup_status', 'confidence_score', 'diagnostic_flagged', 'isbn', 'ean_upc', 'asin'].map(esc).join(','),
      ...auditRows.map((r) => [
        r.row,
        r.media_type || '',
        r.status,
        r.audit_outcome || '',
        r.classification_detail || '',
        r.title,
        r.detail,
        r.match_mode || '',
        r.matched_by || '',
        r.enrichment_status || '',
        r.lookup_path || '',
        r.lookup_status || '',
        r.confidence_score ?? '',
        r.diagnostic_flagged ?? '',
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

  const lookupBarcode = async (upcOverride = null) => {
    const normalizedOverride = typeof upcOverride === 'string' || typeof upcOverride === 'number'
      ? upcOverride
      : null;
    const upc = normalizeBarcodeInput(normalizedOverride ?? barcodeUpc);
    if (!upc) return;
    const inferredBookIsbn = inferBookBarcodeIdentifier(upc);
    setBarcodeLookupLoading(true);
    setResult('');
    setBarcodeResults([]);
    try {
      const response = await apiCall('post', '/media/lookup-upc', {
        upc,
        ...(inferredBookIsbn ? { mediaType: 'book' } : {})
      });
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

  const resolveCapturedLookupValue = async (file, detectedCode = '', barcodeBoundingBox = null) => {
    const normalizedDetected = normalizeBarcodeInput(detectedCode);
    let ocrCandidates = { isbnCandidates: [], strictIsbnCandidates: [], labeledIsbnCandidates: [], upcCandidates: [], asinCandidates: [] };
    const shouldTryOcr = !inferBookBarcodeIdentifier(normalizedDetected);

    if (shouldTryOcr) {
      try {
        ocrCandidates = await extractIdentifierCandidatesFromFile(file, { boundingBox: barcodeBoundingBox });
      } catch (_) {
        // OCR is a best-effort capture fallback, not a required path.
      }
    }

    const inferredBookIsbn = ocrCandidates.labeledIsbnCandidates?.[0] || ocrCandidates.strictIsbnCandidates?.[0] || inferBookBarcodeIdentifier(normalizedDetected);
    const lookupValue = inferredBookIsbn || normalizedDetected || ocrCandidates.upcCandidates?.[0] || '';

    return {
      normalizedDetected,
      inferredBookIsbn,
      lookupValue,
      shouldDeferAmbiguousBookLookup: Boolean(
        normalizedDetected &&
        isLikelyRetailBookBarcode(normalizedDetected) &&
        !inferredBookIsbn
      )
    };
  };

  const handleBarcodeCapture = async (event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = '';
    if (!file) return;
    setBarcodeCaptureLoading(true);
    try {
      let detected = '';
      let barcodeBoundingBox = null;
      try {
        const payload = await detectBarcodeCapturePayloadFromFile(file);
        detected = normalizeBarcodeInput(payload?.code || '');
        barcodeBoundingBox = payload?.boundingBox || null;
      } catch (error) {
        if (error?.message !== 'not-found') throw error;
      }

      const { normalizedDetected, inferredBookIsbn, lookupValue, shouldDeferAmbiguousBookLookup } = await resolveCapturedLookupValue(file, detected, barcodeBoundingBox);
      if (!lookupValue) {
        throw new Error('not-found');
      }
      setBarcodeUpc(normalizedDetected || lookupValue);
      if (inferredBookIsbn || isLikelyRetailBookBarcode(normalizedDetected)) {
        setBookCaptureState({
          tone: shouldDeferAmbiguousBookLookup ? 'warning' : (inferredBookIsbn ? 'success' : 'info'),
          source: 'Photo',
          heading: shouldDeferAmbiguousBookLookup ? 'Retail barcode captured' : (inferredBookIsbn ? 'ISBN recovered from photo' : 'Barcode captured'),
          detail: shouldDeferAmbiguousBookLookup
            ? 'We saw the store barcode, but not a trustworthy ISBN from the still image.'
            : (inferredBookIsbn
              ? 'We recovered a book identifier from the still image and will prefer that for lookup.'
              : 'The captured identifier can be used for lookup.'),
          capturedBarcode: normalizedDetected || '',
          recoveredIsbn: inferredBookIsbn || '',
          nextStep: shouldDeferAmbiguousBookLookup
            ? 'Try another still image with the ISBN line fully visible, or type the ISBN manually before lookup.'
            : 'ISBN is the best match key for books. Retail barcodes are secondary context.'
        });
      } else {
        setBookCaptureState(null);
      }
      if (shouldDeferAmbiguousBookLookup) {
        throw new Error('book-upc-only');
      }
      onToast(inferredBookIsbn ? `Recovered book identifier ${inferredBookIsbn}` : `Captured barcode ${lookupValue}`);
      await lookupBarcode(lookupValue);
    } catch (error) {
      const reason = error?.message;
      if (reason === 'unsupported') {
        onToast('This browser could capture the image, but barcode decoding is not available yet. Enter the UPC manually instead.', 'error');
      } else if (reason === 'book-upc-only') {
        onToast('Captured a retail book barcode, but no ISBN was recovered from the image. Try Photo mode for a sharper still or type the ISBN manually.', 'error');
      } else if (reason === 'not-found') {
        onToast('No barcode was detected in that image. Try a clearer photo or enter the UPC manually.', 'error');
      } else {
        onToast('Barcode capture failed. Enter the UPC manually instead.', 'error');
      }
    } finally {
      setBarcodeCaptureLoading(false);
    }
  };

  const addBarcodeMatch = async (match, index) => {
    const addId = `${match?.upc || barcodeUpc}-${index}`;
    setBarcodeAddingId(addId);
    try {
      const tmdb = match?.tmdb || {};
      const book = match?.book || null;
      const releaseDate = tmdb?.release_date || '';
      const guessedBook = match?.mediaTypeGuess === 'book' || Boolean(book);
      const normalizedTitle = match?.normalizedTitle || match?.title || `UPC ${barcodeUpc.trim()}`;
      const parsedFormat = match?.typeDetails?.format || '';
      const parsedAuthor = match?.typeDetails?.author || null;
      const parsedIsbn = match?.typeDetails?.isbn || null;
      const parsedPublisher = match?.typeDetails?.publisher || null;
      const bookTypeDetails = book?.type_details || {};
      const finalBookTitle = book?.title || normalizedTitle;
      const finalBookAuthor = bookTypeDetails?.author || parsedAuthor;
      const finalBookIsbn = bookTypeDetails?.isbn || parsedIsbn || match?.upc || barcodeUpc.trim() || null;
      const finalBookPublisher = bookTypeDetails?.publisher || parsedPublisher;
      const finalBookEdition = bookTypeDetails?.edition || parsedFormat || null;
      const payload = {
        title: guessedBook ? finalBookTitle : (tmdb?.title || normalizedTitle),
        original_title: guessedBook ? null : (tmdb?.original_title || null),
        release_date: guessedBook ? (book?.release_date || null) : (releaseDate || null),
        year: guessedBook ? (book?.year || (match?.year ? Number(match.year) : null)) : (tmdb?.release_year || (releaseDate ? Number(String(releaseDate).slice(0, 4)) : null)),
        media_type: guessedBook ? 'book' : 'movie',
        format: guessedBook ? (finalBookEdition || 'Paperback') : 'Blu-ray',
        genre: guessedBook ? (book?.genre || null) : (Array.isArray(tmdb?.genre_names) ? tmdb.genre_names.join(', ') : null),
        rating: guessedBook ? null : (tmdb?.rating || null),
        upc: match?.upc || barcodeUpc.trim() || null,
        notes: match?.source ? `Imported via barcode (${match.source})` : 'Imported via barcode',
        overview: guessedBook ? (book?.overview || match?.description || null) : (tmdb?.overview || match?.description || null),
        tmdb_id: guessedBook ? null : (tmdb?.id || null),
        tmdb_media_type: guessedBook ? null : (tmdb?.tmdb_media_type || 'movie'),
        tmdb_url: guessedBook ? null : (tmdb?.id ? `https://www.themoviedb.org/${tmdb?.tmdb_media_type || 'movie'}/${tmdb.id}` : null),
        poster_path: guessedBook ? (book?.poster_path || match?.image || null) : (tmdb?.poster_path || match?.image || null),
        backdrop_path: guessedBook ? null : (tmdb?.backdrop_path || null),
        type_details: guessedBook
          ? {
              author: finalBookAuthor,
              isbn: finalBookIsbn,
              publisher: finalBookPublisher,
              edition: finalBookEdition
            }
          : null
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

  useEffect(() => {
    if (importSections.some((section) => section.id === tab && section.enabled)) return;
    setTab(firstEnabledSection);
  }, [firstEnabledSection, importSections, tab]);

  const hasActiveLibrary = Boolean(activeLibrary?.id);
  const activeSectionLabel = importSections.find((section) => section.id === tab)?.label || tab;
  const recentJobs = useMemo(
    () => importJobs
      .filter((job) => ['plex', 'csv_generic', 'csv_calibre', 'csv_delicious'].includes(job.provider))
      .sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0))
      .slice(0, 5),
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
    <div className="h-full overflow-y-auto p-4 sm:p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="section-title">Import Media</h1>
        <p className="text-sm text-ghost mt-1">Add titles from external sources into your library.</p>
      </div>

      <div className="md:hidden">
        <label className="label">Import Source</label>
        <select className="select mt-1" value={tab} onChange={(e) => setTab(e.target.value)}>
          {importSections.map((section) => (
            <option key={section.id} value={section.id} disabled={!section.enabled}>
              {section.label}{section.enabled ? '' : ' (Unavailable)'}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)] items-start">
        <div className="hidden md:block card p-2 space-y-1">
          {importSections.map((section) => (
            <button
              key={section.id}
              onClick={() => { if (section.enabled) setTab(section.id); }}
              disabled={!section.enabled}
              className={cx(
                'w-full flex items-center gap-2 px-3 h-9 rounded-md text-sm text-left transition-colors',
                tab === section.id
                  ? 'bg-raised border border-edge text-ink'
                  : 'text-dim hover:text-ink hover:bg-raised',
                !section.enabled && 'opacity-50 cursor-not-allowed hover:bg-transparent hover:text-dim'
              )}
            >
              <span className="flex-1">{section.label}</span>
            </button>
          ))}
        </div>

      <div className="card p-5 space-y-4 min-w-0">
        <div className="flex items-center justify-between gap-3 border-b border-edge pb-3">
          <h2 className="text-sm font-semibold tracking-wide uppercase text-dim">{activeSectionLabel}</h2>
        </div>
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
            <p className="text-sm text-dim">Look up a barcode or Bookland ISBN and add matched media to your library.</p>
            <p className="text-xs text-ghost">Uses Admin Integrations barcode + TMDB settings for quick physical media ingest.</p>
            <div className="flex gap-3">
              <input
                className="input flex-1 font-mono"
                placeholder="012345678901 or 9780358447849"
                value={barcodeUpc}
                onChange={(e) => {
                  setBarcodeUpc(normalizeBarcodeInput(e.target.value));
                  setBookCaptureState(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    lookupBarcode();
                  }
                }}
              />
              <button onClick={() => setBarcodeCameraOpen(true)} className="btn-secondary" disabled={barcodeCaptureLoading || !hasActiveLibrary}>
                {barcodeCaptureLoading ? <Spinner size={14} /> : <><Icons.Camera />Camera</>}
              </button>
              <button onClick={() => barcodeCaptureInputRef.current?.click()} className="btn-secondary" disabled={barcodeCaptureLoading || !hasActiveLibrary}>
                <Icons.Upload />Photo
              </button>
              <button onClick={() => lookupBarcode()} className="btn-primary" disabled={barcodeLookupLoading || !barcodeUpc.trim() || !hasActiveLibrary}>
                {barcodeLookupLoading ? <Spinner size={14} /> : <><Icons.Barcode />Lookup</>}
              </button>
            </div>
            <input
              ref={barcodeCaptureInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleBarcodeCapture}
            />
            <p className="text-xs text-ghost">Use a live camera frame or a barcode photo. {canCaptureBarcode ? "We'll try to decode it automatically, including Bookland ISBN barcodes." : 'Some browsers may still require you to type the UPC or ISBN manually.'}</p>
            <BookCaptureStatusCard state={bookCaptureState} />
            {barcodeResults.length > 0 && (
              <div className="space-y-2">
                {barcodeResults.slice(0, 8).map((m, idx) => {
                  const addId = `${m?.upc || barcodeUpc}-${idx}`;
                  const isBook = m?.mediaTypeGuess === 'book' || Boolean(m?.book);
                  const title = isBook
                    ? (m?.book?.title || m?.normalizedTitle || m?.title || 'Unknown')
                    : (m?.tmdb?.title || m?.title || 'Unknown');
                  const year = isBook
                    ? (m?.book?.year || m?.year || '')
                    : (m?.tmdb?.release_year || (m?.tmdb?.release_date ? String(m.tmdb.release_date).slice(0, 4) : ''));
                  const subtitle = isBook
                    ? (m?.book?.type_details?.author || m?.typeDetails?.author || '')
                    : '';
                  return (
                    <div key={addId} className="card p-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-ink truncate">{title}</p>
                        {subtitle ? (
                          <p className="text-xs text-ghost truncate">{subtitle}</p>
                        ) : null}
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
      </div>

      <div className="card p-4 text-xs text-ghost space-y-1">
        <p>Import behavior:</p>
        <p>- Existing titles are matched identifier-first (ISBN/EAN/ASIN), then provider IDs, then title/year fallback.</p>
        <p>- Audit downloads include normalized identifiers, match mode, duplicate-vs-near-match outcome, and debug diagnostic flags.</p>
        <p>- Provider enrichment runs during import when configured.</p>
        <p>- When debug logging and external log export are enabled, ambiguous rows can ship to the operator log pipeline without reopening a review queue.</p>
      </div>

      {result && <pre className="card p-4 text-xs text-dim whitespace-pre-wrap">{result}</pre>}
      {auditRows.length > 0 && (
        <div className="flex">
          <button onClick={downloadAudit} className="btn-secondary"><Icons.Download />Download Audit CSV</button>
        </div>
      )}
      <CameraCaptureModal
        open={barcodeCameraOpen}
        title="Capture barcode"
        description="Frame the barcode in the camera preview, capture it, and we'll try to decode it into a UPC or Bookland ISBN automatically."
        confirmLabel="Use barcode capture"
        onClose={() => setBarcodeCameraOpen(false)}
        onCapture={async (file) => {
          setBarcodeCaptureLoading(true);
          try {
            let detected = '';
            let barcodeBoundingBox = null;
            try {
              const payload = await detectBarcodeCapturePayloadFromFile(file);
              detected = normalizeBarcodeInput(payload?.code || '');
              barcodeBoundingBox = payload?.boundingBox || null;
            } catch (error) {
              if (error?.message !== 'not-found') throw error;
            }

            const { normalizedDetected, inferredBookIsbn, lookupValue, shouldDeferAmbiguousBookLookup } = await resolveCapturedLookupValue(file, detected, barcodeBoundingBox);
            if (!lookupValue) {
              throw new Error('not-found');
            }
            setBarcodeUpc(normalizedDetected || lookupValue);
            if (inferredBookIsbn || isLikelyRetailBookBarcode(normalizedDetected)) {
              setBookCaptureState({
                tone: shouldDeferAmbiguousBookLookup ? 'warning' : (inferredBookIsbn ? 'success' : 'info'),
                source: 'Live camera',
                heading: shouldDeferAmbiguousBookLookup ? 'Retail barcode captured' : (inferredBookIsbn ? 'ISBN recovered from live capture' : 'Barcode captured'),
                detail: shouldDeferAmbiguousBookLookup
                  ? 'Live camera captured the retail barcode, but we did not get a trustworthy ISBN from the frame.'
                  : (inferredBookIsbn
                    ? 'We recovered a book identifier from the live frame and will prefer that for lookup.'
                    : 'The captured identifier can be used for lookup.'),
                capturedBarcode: normalizedDetected || '',
                recoveredIsbn: inferredBookIsbn || '',
                nextStep: shouldDeferAmbiguousBookLookup
                  ? 'Use Photo for a sharper still image or type the ISBN manually before lookup.'
                  : 'ISBN is the best match key for books. Retail barcodes are secondary context.'
              });
            } else {
              setBookCaptureState(null);
            }
            if (shouldDeferAmbiguousBookLookup) {
              throw new Error('book-upc-only');
            }
            onToast(inferredBookIsbn ? `Recovered book identifier ${inferredBookIsbn}` : `Captured barcode ${lookupValue}`);
            await lookupBarcode(lookupValue);
          } catch (error) {
            const reason = error?.message;
            if (reason === 'unsupported') {
              onToast('This browser could capture the frame, but barcode decoding is not available yet. Enter the UPC manually instead.', 'error');
            } else if (reason === 'book-upc-only') {
              onToast('Captured a retail book barcode, but no ISBN was recovered from the live frame. Try Photo mode for a sharper still or type the ISBN manually.', 'error');
            } else if (reason === 'not-found') {
              onToast('No barcode was detected in that capture. Try again with a clearer frame or enter the UPC manually.', 'error');
            } else {
              onToast('Barcode capture failed. Enter the UPC manually instead.', 'error');
            }
          } finally {
            setBarcodeCaptureLoading(false);
          }
        }}
      />
    </div>
  );
}
