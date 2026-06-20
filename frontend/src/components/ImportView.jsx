import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FixedPageShell,
  SectionTabPanel,
  SectionTabs,
  UtilityPageHeader
} from './app/AppPrimitives';

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
    () => ([
      { id: 'capture', label: 'Capture Inbox', enabled: true },
      { id: 'calibre', label: 'Calibre', enabled: true },
      { id: 'csv', label: 'CSV', enabled: true },
      { id: 'delicious', label: 'Delicious', enabled: true },
      { id: 'plex', label: 'Plex', enabled: canImportPlex }
    ]),
    [canImportPlex]
  );
  const firstEnabledSection = importSections.find((section) => section.enabled && section.id !== 'capture')?.id || 'csv';
  const [tab, setTab] = useState(firstEnabledSection);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState('');
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

  useEffect(() => {
    if (importSections.some((section) => section.id === tab && section.enabled)) return;
    setTab(firstEnabledSection);
  }, [firstEnabledSection, importSections, tab]);

  const hasActiveLibrary = Boolean(activeLibrary?.id);
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

  const [headerCompact, setHeaderCompact] = useState(false);
  const handleBodyScroll = useCallback((event) => {
    setHeaderCompact(event.currentTarget.scrollTop > 24);
  }, []);
  const enabledImportSections = importSections.filter((section) => section.enabled);
  const handleImportSectionChange = useCallback((nextTab) => {
    if (nextTab === 'capture') {
      onOpenCaptureInbox?.();
      return;
    }
    setTab(nextTab);
  }, [onOpenCaptureInbox]);

  const header = (
    <UtilityPageHeader
      title="Import Media"
      compact={headerCompact}
      controls={(
          <SectionTabs
            tabs={enabledImportSections}
            activeId={tab}
            onChange={handleImportSectionChange}
            ariaLabel="Import sources"
          showDivider={false}
          listClassName="gap-5"
          buttonClassName="py-1.5 text-xs sm:text-sm"
        />
      )}
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
              {busy === 'plex' ? <Spinner size={14} /> : <><Icons.Upload />Start Plex Import</>}
            </button>
          </div>
          {recentJobs.length > 0 && (
            <div className="space-y-2 border-t border-edge/60 pt-4">
              <p className="text-xs text-ghost">Recent jobs</p>
              <div className="space-y-2">
                {recentJobs.map((job) => (
                  <div key={job.id} className="border-t border-edge/60 px-1 pt-2 text-xs text-dim first:border-t-0 first:px-0 first:pt-0">
                    <div className="font-mono text-[11px] text-ghost">Job #{job.id} · {job.provider} · {job.status}</div>
                    {job.progress ? (
                      <div className="mt-1 text-xs text-dim">
                        Processed {job.progress.processed || 0} / {job.progress.total || 0} · Created {job.progress.created || 0} · Updated {job.progress.updated || 0} · Skipped {job.progress.skipped || 0} · Errors {job.progress.errorCount || 0}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          )}
        </SectionTabPanel>

        <SectionTabPanel activeId={tab} tabKey="csv" idBase="import-source-tabs" className="space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-ink">CSV</p>
            <p className="text-sm text-ghost">Import a generic collectZ CSV. Use `|` to separate multiple owned formats.</p>
          </div>
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
        </SectionTabPanel>

        <SectionTabPanel activeId={tab} tabKey="calibre" idBase="import-source-tabs" className="space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-ink">Calibre</p>
            <p className="text-sm text-ghost">Import a Calibre CSV export for books and comics using the normal dedupe and enrichment path.</p>
          </div>
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
        </SectionTabPanel>

        <SectionTabPanel activeId={tab} tabKey="delicious" idBase="import-source-tabs" className="space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-ink">Delicious</p>
            <p className="text-sm text-ghost">Import a Delicious export with mixed media rows and identifier-first matching where possible.</p>
          </div>
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
        </SectionTabPanel>
      </div>

      <div className="space-y-1 border-t border-edge/60 pt-4 text-xs text-ghost">
        <p>Imports match identifier-first, then provider IDs, then title and year fallback.</p>
        <p>Audit downloads include normalized identifiers, match mode, and duplicate-vs-near-match outcomes.</p>
      </div>

      {result && <pre aria-live="polite" className="border-t border-edge/60 pt-4 text-xs text-dim whitespace-pre-wrap">{result}</pre>}
      {auditRows.length > 0 && (
        <div className="flex">
          <button onClick={downloadAudit} className="btn-secondary"><Icons.Download />Download Audit CSV</button>
        </div>
      )}
    </FixedPageShell>
  );
}
