import React, { useCallback, useEffect, useMemo, useState } from 'react';
import SyncJobDetailDrawer from './SyncJobDetailDrawer';
import { SectionTabs } from './app/AppPrimitives';

const DASHBOARD_SAMPLE_LIMIT = 5;
const DASHBOARD_SECTION_TABS = [
  { id: 'attention', label: 'Review' },
  { id: 'syncs', label: 'Syncs' },
  { id: 'activity', label: 'Activity' },
  { id: 'health', label: 'Health' },
  { id: 'events', label: 'Events' }
];

function formatDate(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function providerStatusLabel(provider) {
  if (!provider?.configured) return 'Not configured';
  if (provider?.last_received_at) return `Last event ${formatDateTime(provider.last_received_at)}`;
  return provider?.detail || 'Configured';
}

function statusClass(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'failed') return 'text-err';
  if (normalized === 'succeeded') return 'text-ok';
  if (normalized === 'running' || normalized === 'queued') return 'text-warn';
  return 'text-dim';
}

function severityClasses(severity) {
  if (severity === 'danger') return 'border-err/40 bg-err/10 text-err';
  if (severity === 'warn') return 'border-warn/40 bg-warn/10 text-warn';
  if (severity === 'info') return 'border-gold/30 bg-gold/10 text-gold';
  return 'border-edge bg-raised/30 text-ok';
}

function EmptyLine({ children }) {
  return <p className="text-sm text-ghost">{children}</p>;
}

function mediaTypeLabel(value) {
  const normalized = String(value || '').trim();
  if (normalized === 'comic_book') return 'Comic';
  if (normalized === 'tv_series' || normalized === 'tv') return 'TV';
  if (normalized === 'movie') return 'Movie';
  if (normalized === 'book') return 'Book';
  if (normalized === 'audio') return 'Audio';
  if (normalized === 'game') return 'Game';
  return normalized || 'Item';
}

function itemMeta(item) {
  return [
    mediaTypeLabel(item?.media_type),
    item?.year,
    item?.series,
    item?.issue_number ? `#${item.issue_number}` : null,
    item?.author,
    item?.provider_name || item?.import_source
  ].filter(Boolean).join(' · ');
}

function reviewClue(item) {
  const reasons = Array.isArray(item?.review_reasons) ? item.review_reasons.filter(Boolean) : [];
  const recommended = Array.isArray(item?.recommended_identifiers) ? item.recommended_identifiers.filter(Boolean) : [];
  const reason = reasons[0] || '';
  const recommendation = recommended.length ? `Add ${recommended.join(' or ')}.` : '';
  return [reason, recommendation].filter(Boolean).join('. ').replace('..', '.');
}

function Panel({ title, action, children, className = '' }) {
  return (
    <section className={`min-w-0 rounded-lg border border-edge bg-panel ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-edge px-3 py-2">
        <h2 className="min-w-0 truncate text-sm font-semibold text-ink">{title}</h2>
        {action}
      </div>
      <div className="min-w-0 p-3">{children}</div>
    </section>
  );
}

function MetricButton({ label, value, onClick, disabled = false }) {
  const content = (
    <>
      <p className="truncate text-[11px] leading-tight text-ghost sm:text-xs">{label}</p>
      <p className="mt-1 text-lg font-semibold leading-tight text-ink sm:text-xl">{value}</p>
    </>
  );
  if (!onClick) {
    return <div className="min-w-0 rounded-lg border border-edge bg-panel px-2 py-2 sm:px-3 sm:py-2.5">{content}</div>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`Open ${label.toLowerCase()} review`}
      className="min-w-0 rounded-lg border border-edge bg-panel px-2 py-2 text-left transition hover:border-dim hover:bg-raised/40 disabled:cursor-default disabled:hover:border-edge disabled:hover:bg-panel sm:px-3 sm:py-2.5"
    >
      {content}
    </button>
  );
}

function AttentionListHeader({ count, itemCount, actionLabel, onAction }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-ghost">
        Showing {Math.min(itemCount, DASHBOARD_SAMPLE_LIMIT)} of {count}
      </p>
      {onAction ? (
        <button type="button" className="btn-secondary btn-sm" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function MediaAttentionList({ items, emptyText }) {
  if (!items.length) return <EmptyLine>{emptyText}</EmptyLine>;
  const visibleItems = items.slice(0, DASHBOARD_SAMPLE_LIMIT);
  return (
    <div className="divide-y divide-edge overflow-hidden rounded-lg border border-edge">
      {visibleItems.map((item) => {
        const clue = reviewClue(item);
        return (
          <div key={item.id} className="bg-raised/20 px-3 py-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{item.title || 'Untitled'}</p>
                <p className="mt-1 truncate text-xs text-ghost">{itemMeta(item)}</p>
                {clue ? <p className="mt-1 break-words text-xs text-dim">{clue}</p> : null}
              </div>
              <span className="shrink-0 text-xs text-ghost">#{item.id}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FailedSyncList({ jobs, onOpenJob }) {
  if (!jobs.length) return <EmptyLine>No failed sync jobs in this scope.</EmptyLine>;
  return (
    <div className="min-w-0 divide-y divide-edge overflow-hidden rounded-lg border border-err/30">
      {jobs.map((job) => (
        <button
          key={job.id}
          type="button"
          onClick={() => onOpenJob?.(job)}
          className="w-full bg-err/10 px-3 py-2 text-left transition hover:bg-err/15"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">{job.provider || job.job_type || `Job #${job.id}`}</p>
              <p className="mt-1 text-xs text-ghost">{job.job_type || 'sync'} · {formatDateTime(job.updated_at || job.created_at)}</p>
              <p className="mt-1 break-words text-xs text-err">{job.error || job.summary?.message || 'No failure detail was recorded.'}</p>
            </div>
            <span className="shrink-0 text-xs font-medium text-err">Open</span>
          </div>
        </button>
      ))}
    </div>
  );
}

export default function DashboardCommandCenterView({
  apiCall,
  onToast,
  setActiveTab,
  setActiveIntegrationSection,
  setLibraryReviewFilter,
  activeSpace,
  activeLibrary,
  Icons,
  Spinner
}) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeDashboardTab, setActiveDashboardTab] = useState('attention');
  const [activeAttentionTab, setActiveAttentionTab] = useState('failed-syncs');
  const [selectedSyncJob, setSelectedSyncJob] = useState(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const payload = await apiCall('get', '/dashboard/summary');
      setSummary(payload || null);
    } catch (err) {
      const message = err?.response?.data?.error || 'Failed to load Dashboard summary';
      setError(message);
      onToast?.(message, 'error');
    } finally {
      setLoading(false);
    }
  }, [apiCall, onToast]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const attention = Array.isArray(summary?.attention) ? summary.attention : [];
  const recentJobs = Array.isArray(summary?.recent_sync_jobs) ? summary.recent_sync_jobs : [];
  const failedJobs = Array.isArray(summary?.failed_sync_jobs) ? summary.failed_sync_jobs : [];
  const providers = Array.isArray(summary?.providers) ? summary.providers : [];
  const upcomingEvents = Array.isArray(summary?.upcoming_events) ? summary.upcoming_events : [];
  const recentActivity = Array.isArray(summary?.recent_activity) ? summary.recent_activity : [];
  const missingCoverItems = Array.isArray(summary?.attention_details?.missing_cover_items)
    ? summary.attention_details.missing_cover_items
    : [];
  const missingIdentifierItems = Array.isArray(summary?.attention_details?.missing_identifier_items)
    ? summary.attention_details.missing_identifier_items
    : [];
  const attentionCounts = useMemo(
    () => Object.fromEntries(attention.map((item) => [item.id, Number(item.count || 0)])),
    [attention]
  );

  const scopeLabel = useMemo(() => {
    const libraryName = activeLibrary?.name || '';
    const spaceName = activeSpace?.name || '';
    if (libraryName && spaceName) return `${spaceName} / ${libraryName}`;
    return libraryName || spaceName || 'Current collection';
  }, [activeLibrary, activeSpace]);

  const go = (tab, section) => {
    if (section) setActiveIntegrationSection?.(section);
    setActiveTab?.(tab);
  };

  const openLibrary = (reviewFilter = null) => {
    setLibraryReviewFilter?.(reviewFilter ? { type: reviewFilter, createdAt: Date.now() } : null);
    setActiveTab?.('library');
  };

  const plexConflictAttention = attention.find((item) => item.id === 'plex-conflicts');
  const attentionTabs = useMemo(() => [
    {
      id: 'failed-syncs',
      label: 'Failed syncs',
      shortLabel: 'Failed',
      count: failedJobs.length,
      content: <FailedSyncList jobs={failedJobs} onOpenJob={setSelectedSyncJob} />
    },
    {
      id: 'missing-covers',
      label: 'Missing covers',
      shortLabel: 'Covers',
      count: attentionCounts['missing-covers'] || missingCoverItems.length,
      content: (
        <div className="space-y-2">
          <AttentionListHeader
            count={attentionCounts['missing-covers'] || missingCoverItems.length}
            itemCount={missingCoverItems.length}
            actionLabel="View all"
            onAction={() => openLibrary('missing_covers')}
          />
          <MediaAttentionList items={missingCoverItems} emptyText="No items without cover art found." />
        </div>
      )
    },
    {
      id: 'missing-identifiers',
      label: 'Missing identifiers',
      shortLabel: 'IDs',
      count: attentionCounts['missing-identifiers'] || missingIdentifierItems.length,
      content: (
        <div className="space-y-2">
          <AttentionListHeader
            count={attentionCounts['missing-identifiers'] || missingIdentifierItems.length}
            itemCount={missingIdentifierItems.length}
            actionLabel="View all"
            onAction={() => openLibrary('missing_identifiers')}
          />
          <MediaAttentionList items={missingIdentifierItems} emptyText="No items missing identifiers found." />
        </div>
      )
    },
    {
      id: 'plex-conflicts',
      label: 'Plex conflicts',
      shortLabel: 'Plex',
      count: attentionCounts['plex-conflicts'] || 0,
      content: plexConflictAttention && Number(plexConflictAttention.count || 0) > 0 ? (
        <button
          type="button"
          onClick={() => go(plexConflictAttention.target_tab, plexConflictAttention.target_section)}
          className={`w-full rounded-lg border p-3 text-left transition hover:bg-raised/60 ${severityClasses(plexConflictAttention.severity)}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-ink">{plexConflictAttention.label}</p>
              <p className="mt-1 text-xs text-ghost">{plexConflictAttention.description}</p>
            </div>
            <span className="text-xl font-semibold">{plexConflictAttention.count}</span>
          </div>
        </button>
      ) : (
        <EmptyLine>No open Plex reconciliation conflicts in this scope.</EmptyLine>
      )
    }
  ], [attentionCounts, failedJobs, missingCoverItems, missingIdentifierItems, plexConflictAttention]);

  const activeAttention = attentionTabs.find((tab) => tab.id === activeAttentionTab) || attentionTabs[0];

  useEffect(() => {
    const preferredTab = attentionTabs.find((tab) => Number(tab.count || 0) > 0) || attentionTabs[0];
    if (preferredTab && activeAttentionTab !== preferredTab.id) {
      setActiveAttentionTab(preferredTab.id);
    }
  }, [summary]);

  const attentionPanel = (
    <Panel title="Review">
      <div className="space-y-3">
        <div className="flex min-w-0 items-center gap-4 overflow-x-auto border-b border-edge" role="tablist" aria-label="Review sections">
          {attentionTabs.map((tab) => {
            const active = tab.id === activeAttention.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={`${tab.label} ${tab.count}`}
                onClick={() => setActiveAttentionTab(tab.id)}
                className={`shrink-0 border-b-2 px-0 pb-2 text-sm transition ${
                  active
                    ? 'border-accent text-ink'
                    : 'border-transparent text-ghost hover:text-ink'
                }`}
              >
                <span>{tab.shortLabel || tab.label}</span>
                <span className="ml-2 text-xs tabular-nums text-ghost">{tab.count}</span>
              </button>
            );
          })}
        </div>
        <div className="min-w-0" role="tabpanel" aria-label={activeAttention.label}>
          {activeAttention.content}
        </div>
      </div>
    </Panel>
  );

  const providerHealthPanel = (
    <Panel
      title="Provider health"
      action={<button type="button" className="btn-secondary btn-sm" onClick={() => go('admin-integrations')}>Settings</button>}
    >
      <div className="space-y-2">
        {providers.map((provider) => (
          <button
            key={provider.id}
            type="button"
            onClick={() => go('admin-integrations', provider.id === 'kavita' ? 'kavita' : provider.id)}
            className="w-full rounded-lg border border-edge bg-raised/25 px-3 py-2 text-left transition hover:bg-raised/60"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-ink">{provider.label}</p>
              <span className={provider.configured ? 'text-xs text-ok' : 'text-xs text-ghost'}>
                {provider.configured ? 'Configured' : 'Off'}
              </span>
            </div>
            <p className="mt-1 truncate text-xs text-ghost">{providerStatusLabel(provider)}</p>
          </button>
        ))}
      </div>
    </Panel>
  );

  const recentSyncsPanel = (
    <Panel title="Recent syncs">
      {recentJobs.length > 0 ? (
        <div className="space-y-2">
          {recentJobs.slice(0, DASHBOARD_SAMPLE_LIMIT).map((job) => (
            <div key={job.id} className="flex items-start justify-between gap-3 border-t border-edge/70 pt-2 first:border-t-0 first:pt-0">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{job.provider || job.job_type || `Job #${job.id}`}</p>
                <p className="mt-1 text-xs text-ghost">{job.job_type || 'sync'} · {formatDateTime(job.updated_at || job.created_at)}</p>
                {job.error ? <p className="mt-1 truncate text-xs text-err">{job.error}</p> : null}
              </div>
              <span className={`shrink-0 text-xs font-medium ${statusClass(job.status)}`}>{job.status}</span>
            </div>
          ))}
        </div>
      ) : (
        <EmptyLine>No sync jobs have run in this scope yet.</EmptyLine>
      )}
    </Panel>
  );

  const recentActivityPanel = (
    <Panel title="Recent activity">
      {recentActivity.length > 0 ? (
        <div className="space-y-2">
          {recentActivity.slice(0, DASHBOARD_SAMPLE_LIMIT).map((item) => (
            <div key={item.id} className="border-t border-edge/70 pt-2 first:border-t-0 first:pt-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{item.title || item.action}</p>
                <span className="shrink-0 text-xs text-ghost">{formatDateTime(item.created_at)}</span>
              </div>
              <p className="mt-1 min-w-0 truncate text-xs text-ghost">{item.action}{item.summary ? ` · ${item.summary}` : ''}</p>
            </div>
          ))}
        </div>
      ) : (
        <EmptyLine>No recent activity found for this scope.</EmptyLine>
      )}
    </Panel>
  );

  const upcomingEventsPanel = (
    <Panel
      title="Upcoming events"
      action={<button type="button" className="btn-secondary btn-sm" onClick={() => go('library-events')}>Events</button>}
    >
      {upcomingEvents.length > 0 ? (
        <div className="space-y-2">
          {upcomingEvents.slice(0, DASHBOARD_SAMPLE_LIMIT).map((event) => (
            <button
              key={event.id}
              type="button"
              onClick={() => go('library-events')}
              className="w-full rounded-lg border border-edge bg-raised/25 px-3 py-2 text-left transition hover:bg-raised/60"
            >
              <p className="truncate text-sm font-medium text-ink">{event.title}</p>
              <p className="mt-1 truncate text-xs text-ghost">{formatDate(event.date_start)}{event.location ? ` · ${event.location}` : ''}</p>
            </button>
          ))}
        </div>
      ) : (
        <EmptyLine>No upcoming events in this scope.</EmptyLine>
      )}
    </Panel>
  );

  const dashboardSectionContent = {
    attention: attentionPanel,
    syncs: recentSyncsPanel,
    activity: recentActivityPanel,
    health: providerHealthPanel,
    events: upcomingEventsPanel
  };

  if (loading && !summary) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={32} />
      </div>
    );
  }

  if (error && !summary) {
    return (
      <div className="h-full overflow-y-auto p-4 sm:p-6">
        <div className="rounded-lg border border-err/40 bg-err/10 p-4 text-sm text-err">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-w-0 overflow-y-auto overflow-x-hidden p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="section-title">Dashboard</h1>
          <p className="mt-1 truncate text-sm text-ghost">{scopeLabel}</p>
        </div>
        <button type="button" className="btn-secondary btn-sm" onClick={loadSummary} disabled={loading}>
          <Icons.Refresh />{loading ? 'Refreshing' : 'Refresh'}
        </button>
      </div>

      <div className="mb-4 grid min-w-0 grid-cols-3 gap-2">
        <MetricButton label="Items" value={summary?.collection?.total_items || 0} onClick={() => openLibrary(null)} />
        <MetricButton
          label="Missing covers"
          value={summary?.collection?.missing_covers || 0}
          onClick={() => openLibrary('missing_covers')}
          disabled={!Number(summary?.collection?.missing_covers || 0)}
        />
        <MetricButton
          label="Missing identifiers"
          value={summary?.collection?.missing_identifiers || 0}
          onClick={() => openLibrary('missing_identifiers')}
          disabled={!Number(summary?.collection?.missing_identifiers || 0)}
        />
      </div>

      <div className="mb-3 xl:hidden">
        <SectionTabs
          tabs={DASHBOARD_SECTION_TABS}
          activeId={activeDashboardTab}
          onChange={setActiveDashboardTab}
          showDivider={false}
          listClassName="gap-3"
          buttonClassName="py-1.5 text-xs"
          ariaLabel="Dashboard sections"
          idBase="dashboard-mobile-sections"
        />
      </div>

      <div
        id={`dashboard-mobile-sections-panel-${activeDashboardTab}`}
        role="tabpanel"
        aria-labelledby={`dashboard-mobile-sections-tab-${activeDashboardTab}`}
        className="min-w-0 xl:hidden"
      >
        {dashboardSectionContent[activeDashboardTab] || attentionPanel}
      </div>

      <div className="hidden min-w-0 gap-4 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.72fr)]">
        {attentionPanel}
        {providerHealthPanel}
      </div>

      <div className="mt-4 hidden min-w-0 gap-4 xl:grid xl:grid-cols-3">
        {recentSyncsPanel}
        {recentActivityPanel}
        {upcomingEventsPanel}
      </div>

      {selectedSyncJob ? (
        <SyncJobDetailDrawer
          apiCall={apiCall}
          jobId={selectedSyncJob.id}
          initialJob={selectedSyncJob}
          onClose={() => setSelectedSyncJob(null)}
          Spinner={Spinner}
        />
      ) : null}
    </div>
  );
}
