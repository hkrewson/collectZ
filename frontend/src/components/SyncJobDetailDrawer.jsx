import React, { useEffect, useMemo, useState } from 'react';
import { DetailDrawerShell, Icons } from './app/AppPrimitives';

function formatDateTime(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function titleLabel(job) {
  if (!job) return 'Sync job';
  return job.provider || job.job_type || `Sync job #${job.id}`;
}

function statusClass(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'failed') return 'border-err/40 bg-err/10 text-err';
  if (normalized === 'succeeded') return 'border-ok/30 bg-ok/10 text-ok';
  if (normalized === 'running' || normalized === 'queued') return 'border-warn/40 bg-warn/10 text-warn';
  return 'border-edge bg-raised/30 text-dim';
}

function readableKey(key) {
  return String(key || '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function compactValue(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  return '';
}

function pickSummaryStats(summary) {
  if (!summary || typeof summary !== 'object') return [];
  const preferredKeys = [
    'total', 'rows', 'rowCount', 'totalRows', 'processed', 'created', 'createdCount',
    'updated', 'updatedCount', 'imported', 'importedCount', 'matched', 'linked',
    'skipped', 'skippedCount', 'deleted', 'deletedCount', 'conflicts',
    'errorCount', 'errors', 'coverErrors', 'missingCovers'
  ];
  const stats = [];
  for (const key of preferredKeys) {
    const value = compactValue(summary[key]);
    if (value) stats.push({ key, label: readableKey(key), value });
  }
  return stats.slice(0, 12);
}

function pickProgressStats(progress) {
  if (!progress || typeof progress !== 'object') return [];
  return Object.entries(progress)
    .map(([key, value]) => ({ key, label: readableKey(key), value: compactValue(value) }))
    .filter((item) => item.value)
    .slice(0, 8);
}

function DetailRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-4 border-t border-edge/70 py-2 first:border-t-0">
      <dt className="text-xs text-ghost">{label}</dt>
      <dd className="max-w-[65%] text-right text-sm text-ink">{value}</dd>
    </div>
  );
}

export default function SyncJobDetailDrawer({ apiCall, jobId, initialJob = null, onClose, Spinner }) {
  const [job, setJob] = useState(initialJob);
  const [loading, setLoading] = useState(Boolean(jobId));
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    if (!jobId) return () => {};
    setLoading(true);
    setError('');
    apiCall('get', `/media/sync-jobs/${jobId}/result`)
      .then((payload) => {
        if (!mounted) return;
        setJob(payload || null);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err?.response?.data?.error || 'Failed to load sync job details');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [apiCall, jobId]);

  const summaryStats = useMemo(() => pickSummaryStats(job?.summary), [job?.summary]);
  const progressStats = useMemo(() => pickProgressStats(job?.progress), [job?.progress]);
  const status = job?.status || initialJob?.status || 'unknown';
  const failureText = job?.error || job?.summary?.error || job?.summary?.message || '';

  return (
    <DetailDrawerShell onClose={onClose} panelClassName="max-w-lg" testId="sync-job-detail-drawer">
      <div className="flex items-start justify-between gap-4 border-b border-edge px-5 py-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-ghost">Sync detail</p>
          <h2 className="mt-1 truncate text-lg font-semibold text-ink">{titleLabel(job || initialJob)}</h2>
          <p className="mt-1 text-sm text-ghost">Job #{jobId || job?.id}</p>
        </div>
        <button type="button" onClick={onClose} className="btn-icon btn-sm shrink-0" aria-label="Close sync detail">
          <Icons.X />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {loading ? (
          <div className="flex justify-center py-10">
            {Spinner ? <Spinner size={24} /> : <span className="text-sm text-ghost">Loading...</span>}
          </div>
        ) : error ? (
          <div className="rounded-lg border border-err/40 bg-err/10 p-3 text-sm text-err">{error}</div>
        ) : (
          <div className="space-y-5">
            <div className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusClass(status)}`}>
              {status}
            </div>

            {failureText ? (
              <div className="rounded-lg border border-err/40 bg-err/10 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-err">Failure</p>
                <p className="mt-1 text-sm text-ink">{failureText}</p>
              </div>
            ) : null}

            <dl className="rounded-lg border border-edge bg-raised/20 px-3">
              <DetailRow label="Provider" value={job?.provider} />
              <DetailRow label="Job type" value={job?.job_type} />
              <DetailRow label="Created" value={formatDateTime(job?.created_at)} />
              <DetailRow label="Updated" value={formatDateTime(job?.updated_at)} />
              <DetailRow label="Started" value={formatDateTime(job?.started_at)} />
              <DetailRow label="Finished" value={formatDateTime(job?.finished_at)} />
            </dl>

            {summaryStats.length > 0 ? (
              <section>
                <h3 className="text-sm font-semibold text-ink">Result</h3>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {summaryStats.map((item) => (
                    <div key={item.key} className="rounded-lg border border-edge bg-panel px-3 py-2">
                      <p className="text-xs text-ghost">{item.label}</p>
                      <p className="mt-1 text-base font-semibold text-ink">{item.value}</p>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {progressStats.length > 0 ? (
              <section>
                <h3 className="text-sm font-semibold text-ink">Progress</h3>
                <dl className="mt-2 rounded-lg border border-edge bg-raised/20 px-3">
                  {progressStats.map((item) => (
                    <DetailRow key={item.key} label={item.label} value={item.value} />
                  ))}
                </dl>
              </section>
            ) : null}

            <details className="rounded-lg border border-edge bg-panel p-3 text-xs text-ghost">
              <summary className="cursor-pointer select-none text-dim">Technical payload</summary>
              <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-abyss px-3 py-2 font-mono text-[11px] text-ghost/85">
                {JSON.stringify(job || {}, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
    </DetailDrawerShell>
  );
}
