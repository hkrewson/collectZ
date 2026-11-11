import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FixedPageShell, SectionTabPanel, SectionTabs, UtilityPageHeader } from './app/AppPrimitives';

function importJobStatusLabel(job) {
  const status = String(job?.status || 'unknown');
  if (status !== 'succeeded') return status;
  if (Number(job?.progress?.errorCount || job?.summary?.errorCount || 0) > 0 || job?.summary?.completedWithErrors) {
    return 'completed with errors';
  }
  if (Number(job?.progress?.skipped || 0) > 0 || job?.summary?.completedWithSkips) {
    return 'completed with skips';
  }
  return 'succeeded';
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
  activeLibrary = null,
  onOpenCaptureInbox
}) {
  const importSections = useMemo(
    () => [
      { id: 'capture', label: 'Capture Inbox', enabled: true },
      { id: 'bookorbit', label: 'BookOrbit', enabled: true },
      { id: 'calibre', label: 'Calibre', enabled: true },
      { id: 'csv', label: 'CSV', enabled: true },
      { id: 'delicious', label: 'Delicious', enabled: true },
      { id: 'plex', label: 'Plex', enabled: canImportPlex }
    ],
    [canImportPlex]
  );
  const firstEnabledSection = importSections.find((section) => section.enabled && section.id !== 'capture')?.id || 'csv';
  const [tab, setTab] = useState(firstEnabledSection);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState('');
  const [auditRows, setAuditRows] = useState([]);
  const [auditName, setAuditName] = useState('');
  const [bookOrbitConnections, setBookOrbitConnections] = useState([]);
  const [bookOrbitConnectionId, setBookOrbitConnectionId] = useState('');
  const [bookOrbitLoading, setBookOrbitLoading] = useState(() => Boolean(activeLibrary?.space_id));
  const csvInputRef = useRef(null);
  const calibreInputRef = useRef(null);
  const deliciousInputRef = useRef(null);
  const completedJobIdsRef = useRef(new Set());

  const downloadAudit = () => {
    if (!auditRows.length) return;
    const esc = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [
      [
        'row',
        'media_type',
        'status',
        'audit_outcome',
        'classification_detail',
        'title',
        'detail',
        'match_mode',
        'matched_by',
        'enrichment_status',
        'lookup_path',
        'lookup_status',
        'confidence_score',
        'diagnostic_flagged',
        'provider_item_id',
        'current_media_type',
        'proposed_media_type',
        'transition_reason',
        'dropped_fields',
        'review_reasons',
        'isbn',
        'ean_upc',
        'asin'
      ]
        .map(esc)
        .join(','),
      ...auditRows.map((r) =>
        [
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
          r.provider_item_id || '',
          r.current_media_type || r.provider_type_transition?.from || '',
          r.proposed_media_type || r.provider_type_transition?.to || '',
          r.transition_reason || r.provider_type_transition?.reason || '',
          Array.isArray(r.dropped_fields) ? r.dropped_fields.join('; ') : '',
          Array.isArray(r.review_reasons) ? r.review_reasons.join('; ') : '',
          r.isbn || '',
          r.ean_upc || '',
          r.asin || ''
        ]
          .map(esc)
          .join(',')
      )
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
    } finally {
      setBusy('');
    }
  };

  const runBookOrbitImport = async () => {
    if (!bookOrbitConnectionId) return;
    setBusy('bookorbit');
    setResult('');
    setAuditRows([]);
    setAuditName('');
    try {
      const response = await apiCall('post', '/media/import-bookorbit?async=true', {
        connectionId: bookOrbitConnectionId
      });
      const jobId = response?.job?.id;
      if (!jobId) throw new Error('Missing import job id');
      onQueueJob?.({
        id: jobId,
        provider: 'bookorbit',
        status: response?.job?.status || 'queued',
        progress: response?.job?.progress || null
      });
      setResult(`BookOrbit import queued (job #${jobId})`);
      onToast('BookOrbit import started');
    } catch (error) {
      const message = error?.response?.data?.error || 'BookOrbit import failed';
      setResult(message);
      onToast(message, 'error');
    } finally {
      setBusy('');
    }
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
      const provider = label === 'Delicious' ? 'csv_delicious' : label === 'Calibre' ? 'csv_calibre' : 'csv_generic';
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

  useEffect(() => {
    if (importSections.some((section) => section.id === tab && section.enabled)) return;
    // Provider availability can invalidate the selected import source after render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTab(firstEnabledSection);
  }, [firstEnabledSection, importSections, tab]);

  const hasActiveLibrary = Boolean(activeLibrary?.id);
  const activeSpaceId = Number(activeLibrary?.space_id || 0) || null;

  useEffect(() => {
    if (!activeSpaceId) return () => {};
    let active = true;
    apiCall('get', '/media/bookorbit-connections')
      .then((payload) => {
        if (!active) return;
        const connections = Array.isArray(payload?.connections) ? payload.connections : [];
        setBookOrbitConnections(connections);
        setBookOrbitConnectionId((current) =>
          connections.some((connection) => connection.id === current) ? current : connections[0]?.id || ''
        );
      })
      .catch(() => {
        if (!active) return;
        setBookOrbitConnections([]);
        setBookOrbitConnectionId('');
      })
      .finally(() => {
        if (active) setBookOrbitLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeSpaceId, apiCall]);

  const recentJobs = useMemo(
    () =>
      importJobs
        .filter((job) => ['bookorbit', 'plex', 'csv_generic', 'csv_calibre', 'csv_delicious'].includes(job.provider))
        .sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0))
        .slice(0, 5),
    [importJobs]
  );

  useEffect(() => {
    const newlyCompleted = recentJobs.filter((job) => {
      if (job.status !== 'succeeded') return false;
      const id = Number(job.id);
      return id > 0 && !completedJobIdsRef.current.has(id);
    });
    if (newlyCompleted.length === 0) return () => {};
    for (const job of newlyCompleted) completedJobIdsRef.current.add(Number(job.id));
    onImported?.();

    let active = true;
    const newest = newlyCompleted[0];
    apiCall('get', `/media/sync-jobs/${newest.id}/result`)
      .then((fullJob) => {
        if (!active) return;
        const rows = Array.isArray(fullJob?.summary?.auditRows) ? fullJob.summary.auditRows : [];
        if (rows.length === 0) return;
        setAuditRows(rows);
        setAuditName(newest.provider || 'import');
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [apiCall, recentJobs, onImported]);

  const [headerCompact, setHeaderCompact] = useState(false);
  const handleBodyScroll = useCallback((event) => {
    setHeaderCompact(event.currentTarget.scrollTop > 24);
  }, []);
  const enabledImportSections = importSections.filter((section) => section.enabled);
  const handleImportSectionChange = useCallback(
    (nextTab) => {
      if (nextTab === 'capture') {
        onOpenCaptureInbox?.();
        return;
      }
      setTab(nextTab);
    },
    [onOpenCaptureInbox]
  );

  const header = (
    <UtilityPageHeader
      title="Import Media"
      compact={headerCompact}
      controls={
        <SectionTabs
          tabs={enabledImportSections}
          activeId={tab}
          onChange={handleImportSectionChange}
          ariaLabel="Import sources"
          showDivider={false}
          listClassName="gap-5"
          buttonClassName="py-1.5 text-xs sm:text-sm"
        />
      }
    />
  );

  return (
    <FixedPageShell
      header={header}
      headerInnerClassName="max-w-3xl"
      bodyInnerClassName="max-w-3xl space-y-6 p-4 sm:p-6"
      onBodyScroll={handleBodyScroll}
      headerTestId="import-page-header"
      bodyTestId="import-page-body"
    >
      <div className="space-y-6">
        <SectionTabPanel activeId={tab} tabKey="plex" idBase="import-source-tabs" className="space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-ink">Plex</p>
            <p className="text-sm text-ghost">Pull titles from your configured Plex sources and queue them for import.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button onClick={runPlexImport} className="btn-primary" disabled={busy === 'plex' || !hasActiveLibrary}>
              {busy === 'plex' ? (
                <Spinner size={14} />
              ) : (
                <>
                  <Icons.Upload />
                  Start Plex Import
                </>
              )}
            </button>
          </div>
        </SectionTabPanel>

        <SectionTabPanel activeId={tab} tabKey="csv" idBase="import-source-tabs" className="space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-ink">CSV</p>
            <p className="text-sm text-ghost">Import a generic collectZ CSV. Use `|` to separate multiple owned formats.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button onClick={() => csvInputRef.current?.click()} className="btn-primary" disabled={busy === 'CSV' || !hasActiveLibrary}>
              {busy === 'CSV' ? (
                <Spinner size={14} />
              ) : (
                <>
                  <Icons.Upload />
                  Choose CSV File
                </>
              )}
            </button>
            <a href={`${apiUrl}/media/import/template-csv`} className="btn-secondary">
              <Icons.Download />
              Download Template
            </a>
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
        </SectionTabPanel>

        <SectionTabPanel activeId={tab} tabKey="bookorbit" idBase="import-source-tabs" className="space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-ink">BookOrbit</p>
            <p className="text-sm text-ghost">
              Import books and comics from one configured BookOrbit server using its stable provider identities.
            </p>
          </div>
          {bookOrbitLoading ? (
            <div className="flex items-center gap-2 text-sm text-ghost">
              <Spinner size={14} />
              Loading BookOrbit connections…
            </div>
          ) : bookOrbitConnections.length > 0 ? (
            <div className="space-y-4">
              <div className="field">
                <label className="label" htmlFor="bookorbit-import-connection">
                  BookOrbit server
                </label>
                <select
                  id="bookorbit-import-connection"
                  className="select"
                  value={bookOrbitConnectionId}
                  onChange={(event) => setBookOrbitConnectionId(event.target.value)}
                >
                  {bookOrbitConnections.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.displayName}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={runBookOrbitImport}
                className="btn-primary"
                disabled={busy === 'bookorbit' || !hasActiveLibrary || !bookOrbitConnectionId}
              >
                {busy === 'bookorbit' ? <Spinner size={14} /> : <Icons.Upload />}Start BookOrbit Import
              </button>
            </div>
          ) : (
            <p className="rounded-lg border border-edge/70 bg-raised/40 p-3 text-sm text-ghost">
              No active BookOrbit connection is available. A workspace administrator can add one under Integrations.
            </p>
          )}
        </SectionTabPanel>

        <SectionTabPanel activeId={tab} tabKey="calibre" idBase="import-source-tabs" className="space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-ink">Calibre</p>
            <p className="text-sm text-ghost">
              Import a Calibre CSV export for books and comics using the normal dedupe and enrichment path.
            </p>
          </div>
          <button
            onClick={() => calibreInputRef.current?.click()}
            className="btn-primary"
            disabled={busy === 'Calibre' || !hasActiveLibrary}
          >
            {busy === 'Calibre' ? (
              <Spinner size={14} />
            ) : (
              <>
                <Icons.Upload />
                Choose Calibre CSV
              </>
            )}
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
        </SectionTabPanel>

        <SectionTabPanel activeId={tab} tabKey="delicious" idBase="import-source-tabs" className="space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-ink">Delicious</p>
            <p className="text-sm text-ghost">
              Import a Delicious export with mixed media rows and identifier-first matching where possible.
            </p>
          </div>
          <button
            onClick={() => deliciousInputRef.current?.click()}
            className="btn-primary"
            disabled={busy === 'Delicious' || !hasActiveLibrary}
          >
            {busy === 'Delicious' ? (
              <Spinner size={14} />
            ) : (
              <>
                <Icons.Upload />
                Choose Delicious CSV
              </>
            )}
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
        </SectionTabPanel>
      </div>

      {recentJobs.length > 0 && (
        <section className="space-y-2 border-t border-edge/60 pt-4" aria-label="Recent import jobs">
          <p className="text-xs font-medium text-ghost">Recent jobs</p>
          <div className="space-y-2">
            {recentJobs.map((job) => {
              const reviewCount = Number(
                job?.summary?.duplicateTitleReviewRows || (job?.provider === 'bookorbit' ? 0 : job?.summary?.diagnosticsFlagged) || 0
              );
              const typeTransitionReviewCount = Number(job?.summary?.typeTransitionReviewRows || 0);
              return (
                <div key={job.id} className="border-t border-edge/60 px-1 pt-2 text-xs text-dim first:border-t-0 first:px-0 first:pt-0">
                  <div className="font-mono text-[11px] text-ghost">
                    Job #{job.id} · {job.provider} · {importJobStatusLabel(job)}
                  </div>
                  {job.progress ? (
                    <div className="mt-1 text-xs text-dim">
                      Processed {job.progress.processed || 0} / {job.progress.total || 0} · Created {job.progress.created || 0} · Updated{' '}
                      {job.progress.updated || 0} · Skipped {job.progress.skipped || 0} · Errors {job.progress.errorCount || 0}
                    </div>
                  ) : null}
                  {reviewCount > 0 ? (
                    <p className="mt-1 text-xs text-warn">
                      Review {reviewCount} provider records with duplicate or low-confidence metadata in the audit report.
                    </p>
                  ) : null}
                  {typeTransitionReviewCount > 0 ? (
                    <p className="mt-1 text-xs text-warn">
                      Review {typeTransitionReviewCount} BookOrbit book/comic type change{typeTransitionReviewCount === 1 ? '' : 's'} in the
                      audit report.
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="space-y-1 border-t border-edge/60 pt-4 text-xs text-ghost">
        <p>Imports match identifier-first, then provider IDs, then title and year fallback.</p>
        <p>Audit downloads include normalized identifiers, match mode, and duplicate-vs-near-match outcomes.</p>
      </div>

      {result && (
        <pre aria-live="polite" className="border-t border-edge/60 pt-4 text-xs text-dim whitespace-pre-wrap">
          {result}
        </pre>
      )}
      {auditRows.length > 0 && (
        <div className="space-y-2">
          {auditRows.some((row) => row?.status === 'review_required') ? (
            <p className="text-xs text-warn">
              BookOrbit proposed a book/comic type change that could not be applied safely. The existing item was preserved; download the
              audit for the reason and affected fields.
            </p>
          ) : null}
          {auditRows.some((row) => row?.diagnostic_flagged) ? (
            <p className="text-xs text-warn">
              The audit report identifies distinct provider records that share visible metadata; review them before merging anything.
            </p>
          ) : null}
          <button onClick={downloadAudit} className="btn-secondary">
            <Icons.Download />
            Download Audit CSV
          </button>
        </div>
      )}
    </FixedPageShell>
  );
}
