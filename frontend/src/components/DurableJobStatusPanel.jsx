import { useCallback, useEffect, useMemo, useState } from 'react';

const ACTIVE_STATUSES = new Set(['queued', 'running', 'retry_wait']);

function formatTimestamp(value, fallback = 'Not yet') {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toLocaleString();
}

function statusTone(status) {
  if (status === 'succeeded') return 'badge-ok';
  if (status === 'failed') return 'badge-err';
  if (status === 'cancelled') return 'badge-dim';
  if (status === 'retry_wait') return 'badge-warn';
  return 'badge-dim';
}

function summaryFacts(summary) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return [];
  return Object.entries(summary)
    .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
    .slice(0, 8);
}

export default function DurableJobStatusPanel({
  apiCall,
  endpointBase,
  provider,
  jobType,
  providerConnectionId = '',
  cadence = null,
  onToast,
  Spinner,
  title = 'Recent sync jobs'
}) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState('');
  const [confirmId, setConfirmId] = useState('');
  const [error, setError] = useState('');
  const [refreshedAt, setRefreshedAt] = useState(null);

  const query = useMemo(() => {
    const params = new URLSearchParams({ provider, jobType, limit: '10' });
    if (providerConnectionId) params.set('providerConnectionId', providerConnectionId);
    return params.toString();
  }, [jobType, provider, providerConnectionId]);

  const loadJobs = useCallback(
    async ({ quiet = false } = {}) => {
      if (!endpointBase || !provider || !jobType) return;
      if (!quiet) setLoading(true);
      try {
        const payload = await apiCall('get', `${endpointBase}/jobs?${query}`);
        setJobs(Array.isArray(payload?.jobs) ? payload.jobs : []);
        setRefreshedAt(Date.now());
        setError('');
      } catch (loadError) {
        setError(loadError?.response?.data?.error || 'Durable job status could not be loaded.');
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [apiCall, endpointBase, jobType, provider, query]
  );

  useEffect(() => {
    let active = true;
    let timer = null;
    const refresh = async (quiet = true) => {
      if (!active) return;
      await loadJobs({ quiet });
      if (active) timer = window.setTimeout(refresh, 5000);
    };
    timer = window.setTimeout(() => refresh(false), 0);
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [loadJobs]);

  const cancelJob = async (job) => {
    setWorkingId(job.publicId);
    try {
      const payload = await apiCall('post', `${endpointBase}/jobs/${job.publicId}/cancel`, {});
      const updated = payload?.job;
      if (updated) setJobs((current) => current.map((entry) => (entry.publicId === updated.publicId ? updated : entry)));
      setConfirmId('');
      onToast?.('Sync job cancellation requested');
      await loadJobs({ quiet: true });
    } catch (cancelError) {
      const detail = cancelError?.response?.data?.error || 'Sync job could not be cancelled.';
      setError(detail);
      onToast?.(detail, 'error');
    } finally {
      setWorkingId('');
    }
  };

  const hasActiveJobs = jobs.some((job) => ACTIVE_STATUSES.has(job.status));
  const cadenceDueNow =
    Boolean(cadence?.enabled) &&
    (Boolean(cadence?.dueNow) ||
      !cadence?.nextEligibleAt ||
      (refreshedAt !== null && new Date(cadence.nextEligibleAt).getTime() <= refreshedAt));

  return (
    <section className="space-y-3 border-t border-edge/70 pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-ink">{title}</p>
          <p className="mt-1 text-xs text-ghost">
            Safe workspace readback refreshes {hasActiveJobs ? 'while work is active' : 'every few seconds'}.
          </p>
        </div>
        <button type="button" className="btn-secondary btn-sm" onClick={() => loadJobs()} disabled={loading}>
          {loading ? <Spinner size={14} /> : null}
          Refresh
        </button>
      </div>

      {cadence ? (
        <dl className="grid gap-2 rounded-lg border border-edge/70 bg-raised/40 p-3 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-ghost">Automatic sync</dt>
            <dd className="mt-1 text-ink">{cadence.enabled ? `Every ${cadence.intervalMinutes} minutes` : 'Disabled'}</dd>
          </div>
          <div>
            <dt className="text-ghost">Last queued</dt>
            <dd className="mt-1 text-ink">{formatTimestamp(cadence.lastEnqueuedAt)}</dd>
          </div>
          <div>
            <dt className="text-ghost">Next eligible</dt>
            <dd className="mt-1 text-ink">
              {cadenceDueNow ? 'Due now' : formatTimestamp(cadence.nextEligibleAt, cadence.enabled ? 'Due now' : 'Disabled')}
            </dd>
          </div>
        </dl>
      ) : null}

      {error ? <p className="text-sm text-err">{error}</p> : null}
      {loading && jobs.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-ghost">
          <Spinner size={14} /> Loading job status…
        </div>
      ) : jobs.length === 0 ? (
        <p className="rounded-lg border border-edge/70 bg-raised/40 p-3 text-sm text-ghost">
          No durable jobs have run for this integration yet.
        </p>
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => {
            const facts = summaryFacts(job.summary);
            return (
              <div key={job.publicId} className="rounded-lg border border-edge/70 bg-raised/40 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`badge ${statusTone(job.status)}`}>{String(job.status || 'unknown').replace('_', ' ')}</span>
                      <span className="text-xs text-ghost">
                        Attempt {job.attemptCount}/{job.maxAttempts}
                      </span>
                      <span className="font-mono text-xs text-ghost">{job.publicId?.slice(0, 8)}</span>
                    </div>
                    <p className="mt-2 text-xs text-ghost">
                      Queued {formatTimestamp(job.createdAt)}
                      {job.nextEligibleAt ? ` · Next attempt ${formatTimestamp(job.nextEligibleAt)}` : ''}
                    </p>
                  </div>
                  {job.canCancel ? (
                    confirmId === job.publicId ? (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn-danger btn-sm"
                          onClick={() => cancelJob(job)}
                          disabled={workingId === job.publicId}
                        >
                          {workingId === job.publicId ? <Spinner size={14} /> : null}
                          Confirm cancel
                        </button>
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          onClick={() => setConfirmId('')}
                          disabled={Boolean(workingId)}
                        >
                          Keep running
                        </button>
                      </div>
                    ) : (
                      <button type="button" className="btn-secondary btn-sm" onClick={() => setConfirmId(job.publicId)}>
                        Cancel
                      </button>
                    )
                  ) : null}
                </div>
                {job.failureReason ? <p className="mt-2 text-xs text-err">{job.failureReason}</p> : null}
                {facts.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-dim">
                    {facts.map(([label, value]) => (
                      <span key={label}>
                        {label}: {String(value)}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
