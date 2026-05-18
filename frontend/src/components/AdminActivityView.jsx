import React, { useCallback, useEffect, useState } from 'react';
import ActivityFeedView from './ActivityFeedView';

function formatTimestamp(value) {
  const raw = String(value || '').trim();
  if (!raw) return '—';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleString();
}

function formatFailureReason(value) {
  return String(value || 'send_failed')
    .split(/[_\s.]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export default function AdminActivityView({ apiCall, Spinner, onTimelineNavigate = null }) {
  const [operations, setOperations] = useState(null);
  const [loadingOperations, setLoadingOperations] = useState(true);

  const loadOperations = useCallback(async () => {
    setLoadingOperations(true);
    try {
      const payload = await apiCall('get', '/admin/loan-reminder-operations');
      setOperations(payload || null);
    } finally {
      setLoadingOperations(false);
    }
  }, [apiCall]);

  useEffect(() => {
    loadOperations();
  }, [loadOperations]);

  const latestRun = operations?.latest_run || null;
  const recentFailures = Array.isArray(operations?.recent_failures) ? operations.recent_failures.slice(0, 5) : [];

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 space-y-6">
      <div className="space-y-2">
        <h1 className="section-title">Platform Activity</h1>
        <p className="text-sm text-ghost max-w-3xl">
          Human-readable platform timeline for admin actions, account changes, and cross-workspace management events. Workspace-local timeline entries live in Workspace.
        </p>
      </div>

      <section className="rounded-lg border border-edge bg-panel">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-edge px-4 py-4 sm:px-5">
          <div>
            <h2 className="text-base font-semibold text-ink">Loan reminder operations</h2>
            <p className="mt-1 text-sm text-ghost">
              Recent automatic reminder runtime state, latest sweep results, and recent failures.
            </p>
          </div>
          <button type="button" className="btn-secondary btn-sm" onClick={loadOperations} disabled={loadingOperations}>
            {loadingOperations ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {loadingOperations && !operations ? (
          <div className="flex justify-center py-12"><Spinner size={28} /></div>
        ) : (
          <div className="space-y-5 px-4 py-4 sm:px-5">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <div className="rounded-lg border border-edge bg-raised/25 p-4">
                <p className="text-sm font-medium text-ink">Runtime</p>
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-ghost">Automation</dt>
                    <dd className="text-ink">{operations?.runtime?.enabled ? 'Enabled' : 'Disabled'}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-ghost">SMTP</dt>
                    <dd className="text-ink">{operations?.runtime?.smtpConfigured ? 'Configured' : 'Unavailable'}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-ghost">Interval</dt>
                    <dd className="text-ink">{operations?.runtime?.intervalMinutes || 0} min</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-ghost">Batch size</dt>
                    <dd className="text-ink">{operations?.runtime?.batchSize || 0}</dd>
                  </div>
                </dl>
              </div>

              <div className="rounded-lg border border-edge bg-raised/25 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-ink">Latest automatic run</p>
                    <p className="mt-1 text-xs text-ghost">
                      {latestRun ? formatTimestamp(latestRun.created_at) : 'No automatic reminder run recorded yet'}
                    </p>
                  </div>
                  {latestRun?.summary?.reason ? (
                    <span className="badge badge-dim font-mono text-[10px]">{latestRun.summary.reason}</span>
                  ) : null}
                </div>
                {latestRun ? (
                  <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
                    <div>
                      <p className="text-xs text-ghost">Sent</p>
                      <p className="mt-1 text-base font-medium text-ink">{latestRun.summary.sent}</p>
                    </div>
                    <div>
                      <p className="text-xs text-ghost">Eligible</p>
                      <p className="mt-1 text-base font-medium text-ink">{latestRun.summary.eligible}</p>
                    </div>
                    <div>
                      <p className="text-xs text-ghost">Skipped</p>
                      <p className="mt-1 text-base font-medium text-ink">
                        {(latestRun.summary.skippedAlreadySent || 0) + (latestRun.summary.skippedNoEmail || 0) + (latestRun.summary.skippedNotEligible || 0)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-ghost">Failed</p>
                      <p className="mt-1 text-base font-medium text-ink">{latestRun.summary.failed}</p>
                    </div>
                    <div>
                      <p className="text-xs text-ghost">Due soon</p>
                      <p className="mt-1 text-sm text-dim">{latestRun.summary.dueSoonSent}</p>
                    </div>
                    <div>
                      <p className="text-xs text-ghost">Overdue</p>
                      <p className="mt-1 text-sm text-dim">{latestRun.summary.overdueSent}</p>
                    </div>
                    <div>
                      <p className="text-xs text-ghost">No email</p>
                      <p className="mt-1 text-sm text-dim">{latestRun.summary.skippedNoEmail}</p>
                    </div>
                    <div>
                      <p className="text-xs text-ghost">Already sent</p>
                      <p className="mt-1 text-sm text-dim">{latestRun.summary.skippedAlreadySent}</p>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-lg border border-edge bg-raised/25 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-ink">Recent failures</p>
                  <p className="mt-1 text-xs text-ghost">
                    The latest automatic reminder failures, if any, from the reminder activity log.
                  </p>
                </div>
                <span className="text-xs text-ghost font-mono">{recentFailures.length} shown</span>
              </div>
              {recentFailures.length === 0 ? (
                <p className="mt-4 text-sm text-ghost">No automatic reminder failures have been recorded recently.</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {recentFailures.map((failure) => (
                    <div key={failure.id} className="flex flex-wrap items-start justify-between gap-3 border-t border-edge/70 pt-3 first:border-t-0 first:pt-0">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-ink">{formatFailureReason(failure.reason)}</p>
                          {failure.reminder_phase ? (
                            <span className="badge badge-dim font-mono text-[10px]">{failure.reminder_phase}</span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-ghost">
                          {failure.borrower_email || 'No borrower email'}{failure.loan_id ? ` · Loan #${failure.loan_id}` : ''}{failure.media_id ? ` · Media #${failure.media_id}` : ''}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-ghost">{formatTimestamp(failure.created_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      <ActivityFeedView
        apiCall={apiCall}
        Spinner={Spinner}
        endpoint="/admin/activity"
        title="Timeline"
        description="Readable activity entries first, technical details only when needed."
        context="platform"
        onNavigate={onTimelineNavigate}
      />
    </div>
  );
}
