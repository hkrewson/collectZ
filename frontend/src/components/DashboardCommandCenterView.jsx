import React, { useCallback, useEffect, useMemo, useState } from 'react';
import SyncJobDetailDrawer from './SyncJobDetailDrawer';
import { CoverImagePicker, DetailDrawerShell, SectionTabs, inferTmdbSearchType, posterUrl } from './app/AppPrimitives';

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
  const identifierRecommendations = Array.isArray(item?.recommended_identifiers) ? item.recommended_identifiers.filter(Boolean) : [];
  const metadataRecommendations = Array.isArray(item?.recommended_metadata) ? item.recommended_metadata.filter(Boolean) : [];
  const reason = reasons[0] || '';
  const recommendation = identifierRecommendations.length
    ? `Add ${identifierRecommendations.join(' or ')}.`
    : metadataRecommendations.length
      ? `Add ${metadataRecommendations.join(', ')}.`
      : '';
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

function AttentionListHeader({ count, itemCount }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-ghost">
        Showing {Math.min(itemCount, DASHBOARD_SAMPLE_LIMIT)} of {count}
      </p>
    </div>
  );
}

function MediaAttentionList({ items, emptyText, reviewType, onOpenItem }) {
  if (!items.length) return <EmptyLine>{emptyText}</EmptyLine>;
  const visibleItems = items.slice(0, DASHBOARD_SAMPLE_LIMIT);
  return (
    <div className="divide-y divide-edge overflow-hidden rounded-lg border border-edge">
      {visibleItems.map((item) => {
        const clue = reviewClue(item);
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onOpenItem?.(item, reviewType)}
            className="w-full bg-raised/20 px-3 py-2 text-left transition hover:bg-raised/45"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{item.title || 'Untitled'}</p>
                <p className="mt-1 truncate text-xs text-ghost">{itemMeta(item)}</p>
                {clue ? <p className="mt-1 break-words text-xs text-dim">{clue}</p> : null}
              </div>
              <span className="shrink-0 text-xs font-medium text-accent">Open</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

const DETAIL_FIELDS_BY_TYPE = {
  movie: [
    ['tmdb_id', 'TMDB ID', 'top'],
    ['upc', 'UPC / barcode', 'top'],
    ['poster_path', 'Cover image URL/path', 'top'],
    ['edition', 'Edition', 'detail'],
    ['provider_name', 'Provider', 'detail'],
    ['provider_item_id', 'Provider ID', 'detail']
  ],
  tv_series: [
    ['tmdb_id', 'TMDB ID', 'top'],
    ['upc', 'UPC / barcode', 'top'],
    ['poster_path', 'Cover image URL/path', 'top']
  ],
  book: [
    ['isbn', 'ISBN', 'detail'],
    ['isbn13', 'ISBN-13', 'detail'],
    ['google_books_id', 'Google Books ID', 'detail'],
    ['upc', 'UPC / barcode', 'top'],
    ['poster_path', 'Cover image URL/path', 'top'],
    ['author', 'Author', 'detail'],
    ['publisher', 'Publisher', 'detail'],
    ['edition', 'Edition', 'detail'],
    ['kavita_series_id', 'Kavita series ID', 'detail']
  ],
  comic_book: [
    ['series', 'Series', 'detail'],
    ['issue_number', 'Issue #', 'detail'],
    ['provider_issue_id', 'Provider issue ID', 'detail'],
    ['isbn', 'ISBN', 'detail'],
    ['isbn13', 'ISBN-13', 'detail'],
    ['google_books_id', 'Google Books ID', 'detail'],
    ['upc', 'UPC / barcode', 'top'],
    ['poster_path', 'Cover image URL/path', 'top'],
    ['publisher', 'Publisher', 'detail'],
    ['kavita_series_id', 'Kavita series ID', 'detail']
  ],
  audio: [
    ['upc', 'UPC / barcode', 'top'],
    ['poster_path', 'Cover image URL/path', 'top'],
    ['artist', 'Artist', 'detail'],
    ['album', 'Album', 'detail'],
    ['track_count', 'Track count', 'detail']
  ],
  game: [
    ['upc', 'UPC / barcode', 'top'],
    ['poster_path', 'Cover image URL/path', 'top'],
    ['platform', 'Platform', 'detail'],
    ['developer', 'Developer', 'detail'],
    ['provider_name', 'Provider', 'detail'],
    ['provider_item_id', 'Provider ID', 'detail']
  ]
};

function coerceFieldValue(value) {
  if (value === undefined || value === null) return '';
  return String(value);
}

function fieldValueForRecord(record, field, bucket) {
  if (bucket === 'detail') return coerceFieldValue(record?.type_details?.[field]);
  return coerceFieldValue(record?.[field]);
}

function buildReviewForm(record) {
  const mediaType = record?.media_type || 'movie';
  const fields = DETAIL_FIELDS_BY_TYPE[mediaType] || DETAIL_FIELDS_BY_TYPE.movie;
  const values = {};
  fields.forEach(([field, _label, bucket]) => {
    values[field] = fieldValueForRecord(record, field, bucket);
  });
  values.title = coerceFieldValue(record?.title);
  values.year = coerceFieldValue(record?.year);
  values.format = coerceFieldValue(record?.format);
  values.tmdb_media_type = coerceFieldValue(record?.tmdb_media_type);
  values.tmdb_url = coerceFieldValue(record?.tmdb_url);
  return values;
}

function ReviewField({ field, label, value, onChange }) {
  return (
    <label className="block min-w-0">
      <span className="text-xs font-medium text-ghost">{label}</span>
      <input
        className="input mt-1 w-full"
        value={value || ''}
        onChange={(event) => onChange(field, event.target.value)}
      />
    </label>
  );
}

function lookupCandidateTitle(candidate) {
  return candidate?.title || candidate?.name || candidate?.normalizedTitle || 'Untitled match';
}

function lookupCandidateYear(candidate) {
  if (candidate?.release_year) return candidate.release_year;
  if (candidate?.year) return candidate.year;
  const releaseDate = candidate?.release_date || candidate?.first_air_date;
  return releaseDate ? String(releaseDate).slice(0, 4) : '';
}

function lookupCandidateImage(candidate) {
  return candidate?.poster_path || candidate?.image || candidate?.type_details?.poster_path || null;
}

function lookupProviderLabel(mediaType) {
  if (mediaType === 'movie' || mediaType === 'tv_series') return 'TMDB';
  if (mediaType === 'book') return 'Google Books';
  if (mediaType === 'comic_book') return 'Metron';
  if (mediaType === 'audio') return 'Discogs';
  if (mediaType === 'game') return 'Game search';
  return 'Provider';
}

function lookupActionConfig(mediaType) {
  if (mediaType === 'movie' || mediaType === 'tv_series') {
    return {
      title: 'Search TMDB',
      help: 'Use title and year when the imported name is too rough for an automatic movie or TV match.',
      queryLabel: 'Title',
      queryPlaceholder: 'Search title',
      contextLabel: 'Year',
      contextPlaceholder: 'Year',
      contextKey: 'year'
    };
  }
  if (mediaType === 'book') {
    return {
      title: 'Search Google Books',
      help: 'Use title and author when the row may be a variant, alternate title, or barcode-only book.',
      queryLabel: 'Title',
      queryPlaceholder: 'Search title',
      contextLabel: 'Author',
      contextPlaceholder: 'Author',
      contextKey: 'author'
    };
  }
  if (mediaType === 'comic_book') {
    return {
      title: 'Search comic issue',
      help: 'Use series and issue wording when the row needs provider issue identity or cleaner issue metadata.',
      queryLabel: 'Series or issue title',
      queryPlaceholder: 'Series or issue title',
      contextLabel: '',
      contextPlaceholder: '',
      contextKey: ''
    };
  }
  if (mediaType === 'audio') {
    return {
      title: 'Search Discogs',
      help: 'Use album title and artist when a physical audio item needs a retail or release identity.',
      queryLabel: 'Album title',
      queryPlaceholder: 'Album title',
      contextLabel: 'Artist',
      contextPlaceholder: 'Artist',
      contextKey: 'artist'
    };
  }
  if (mediaType === 'game') {
    return {
      title: 'Search games',
      help: 'Use the game title; platform stays visible below as context for choosing the right match.',
      queryLabel: 'Game title',
      queryPlaceholder: 'Game title',
      contextLabel: 'Platform',
      contextPlaceholder: 'Platform',
      contextKey: 'platform'
    };
  }
  return {
    title: 'Search for a match',
    help: 'Use this when the title or imported name may be keeping collectZ from matching the item.',
    queryLabel: 'Search title',
    queryPlaceholder: 'Search title',
    contextLabel: '',
    contextPlaceholder: '',
    contextKey: ''
  };
}

function lookupContextValue(record = {}) {
  const mediaType = record?.media_type || 'movie';
  const details = record?.type_details && typeof record.type_details === 'object' ? record.type_details : {};
  if (mediaType === 'movie' || mediaType === 'tv_series') return coerceFieldValue(record?.year);
  if (mediaType === 'book') return coerceFieldValue(details.author);
  if (mediaType === 'audio') return coerceFieldValue(details.artist);
  if (mediaType === 'game') return coerceFieldValue(details.platform);
  return '';
}

function reviewDecisionFindingType(reviewType) {
  if (reviewType === 'missing-covers') return 'missing_covers';
  if (reviewType === 'missing-identifiers') return 'missing_identifiers';
  if (reviewType === 'sparse-metadata') return 'sparse_metadata';
  return '';
}

function MediaReviewDrawer({
  item,
  reviewType,
  record,
  form,
  loading,
  saving,
  decisionSaving,
  error,
  coverUploading,
  lookupQuery,
  lookupContext,
  lookupMatches,
  lookupLoading,
  lookupError,
  onChange,
  onCoverSelect,
  onLookupQueryChange,
  onLookupContextChange,
  onRunLookup,
  onApplyLookup,
  onReviewDecision,
  onSave,
  onClose,
  Spinner
}) {
  const mediaType = record?.media_type || item?.media_type || 'movie';
  const fields = DETAIL_FIELDS_BY_TYPE[mediaType] || DETAIL_FIELDS_BY_TYPE.movie;
  const manualFields = fields.filter(([field]) => reviewType !== 'missing-covers' || field !== 'poster_path');
  const clue = reviewClue(item);
  const recommendation = [
    ...(Array.isArray(item?.recommended_identifiers) ? item.recommended_identifiers : []),
    ...(Array.isArray(item?.recommended_metadata) ? item.recommended_metadata : [])
  ].filter(Boolean);
  const canLookup = reviewType === 'missing-identifiers';
  const canUploadCover = reviewType === 'missing-covers';
  const lookupConfig = lookupActionConfig(mediaType);
  const busy = saving || Boolean(decisionSaving);

  return (
    <DetailDrawerShell onClose={onClose} panelClassName="max-w-lg" testId="dashboard-review-drawer">
      <div className="space-y-4 p-4 sm:p-5">
        <div>
          <p className="text-xs font-medium text-ghost">Dashboard Review</p>
          <h2 className="mt-1 text-lg font-semibold text-ink">{form.title || record?.title || item?.title || 'Untitled'}</h2>
          <p className="mt-1 text-sm text-ghost">{itemMeta(record || item)}</p>
        </div>

        {clue ? (
          <div className="rounded-lg border border-edge bg-raised/30 p-3">
            <p className="text-sm font-medium text-ink">Why it is here</p>
            <p className="mt-1 text-sm text-dim">{clue}</p>
            {recommendation.length ? (
              <p className="mt-2 text-xs text-ghost">Recommended: {recommendation.join(', ')}</p>
            ) : null}
          </div>
        ) : null}

        {loading ? (
          <div className="flex min-h-40 items-center justify-center">
            <Spinner size={28} />
          </div>
        ) : (
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
            {canUploadCover ? (
              <div className="rounded-lg border border-edge bg-panel p-3">
                <CoverImagePicker
                  label="Cover image"
                  imagePath={form.poster_path}
                  emptyLabel="Upload cover"
                  replaceLabel="Replace cover"
                  className="max-w-36"
                  disabled={coverUploading || busy}
                  onSelectFile={onCoverSelect}
                  onRemove={() => onChange('poster_path', '')}
                />
                <label className="mt-3 block min-w-0">
                  <span className="text-xs font-medium text-ghost">Image URL/path</span>
                  <input
                    className="input mt-1 w-full"
                    value={form.poster_path || ''}
                    onChange={(event) => onChange('poster_path', event.target.value)}
                    placeholder="Paste a cover URL or upload an image"
                  />
                </label>
                {coverUploading ? <p className="mt-2 text-xs text-ghost">Uploading cover...</p> : null}
              </div>
            ) : null}

            {canLookup ? (
              <div className="rounded-lg border border-edge bg-panel p-3">
                <p className="text-sm font-medium text-ink">{lookupConfig.title}</p>
                <p className="mt-1 text-xs leading-5 text-ghost">
                  {lookupConfig.help}
                </p>
                <div className={`mt-3 grid gap-2 ${lookupConfig.contextKey ? 'sm:grid-cols-[1fr_9rem_auto]' : 'sm:grid-cols-[1fr_auto]'}`}>
                  <label className="min-w-0">
                    <span className="sr-only">{lookupConfig.queryLabel}</span>
                    <input
                      className="input w-full"
                      value={lookupQuery}
                      onChange={(event) => onLookupQueryChange(event.target.value)}
                      placeholder={lookupConfig.queryPlaceholder}
                    />
                  </label>
                  {lookupConfig.contextKey ? (
                    <label className="min-w-0">
                      <span className="sr-only">{lookupConfig.contextLabel}</span>
                      <input
                        className="input w-full"
                        value={lookupContext}
                        onChange={(event) => onLookupContextChange(event.target.value)}
                        placeholder={lookupConfig.contextPlaceholder}
                      />
                    </label>
                  ) : null}
                  <button type="button" className="btn-secondary" onClick={onRunLookup} disabled={lookupLoading || busy}>
                    {lookupLoading ? 'Searching' : 'Search'}
                  </button>
                </div>
                {lookupError ? <p className="mt-2 text-xs text-err">{lookupError}</p> : null}
                {lookupMatches.length ? (
                  <div className="mt-3 divide-y divide-edge overflow-hidden rounded-lg border border-edge">
                    {lookupMatches.slice(0, 5).map((candidate, index) => {
                      const title = lookupCandidateTitle(candidate);
                      const year = lookupCandidateYear(candidate);
                      const image = lookupCandidateImage(candidate);
                      return (
                        <button
                          key={`${candidate.id || candidate.provider_item_id || title}:${index}`}
                          type="button"
                          onClick={() => onApplyLookup(candidate)}
                          className="flex w-full items-center gap-3 bg-raised/20 px-3 py-2 text-left transition hover:bg-raised/45"
                        >
                          <span className="relative h-12 w-8 shrink-0 overflow-hidden rounded border border-edge bg-abyss">
                            {posterUrl(image) ? <img src={posterUrl(image)} alt="" className="h-full w-full object-cover" /> : null}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-ink">{title}</span>
                            <span className="mt-0.5 block truncate text-xs text-ghost">
                              {[lookupProviderLabel(mediaType), year].filter(Boolean).join(' · ')}
                            </span>
                          </span>
                          <span className="shrink-0 text-xs font-medium text-accent">Use</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}

            <details className="rounded-lg border border-edge bg-panel p-3" open={!canLookup && !canUploadCover}>
              <summary className="cursor-pointer text-sm font-medium text-ink">Manual details</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <ReviewField field="title" label="Title" value={form.title} onChange={onChange} />
                <ReviewField field="year" label="Year" value={form.year} onChange={onChange} />
                <ReviewField field="format" label="Format" value={form.format} onChange={onChange} />
                {manualFields.map(([field, label]) => (
                  <ReviewField
                    key={`${mediaType}:${field}`}
                    field={field}
                    label={label}
                    value={form[field]}
                    onChange={onChange}
                  />
                ))}
              </div>
            </details>
            {error ? <p className="rounded-lg border border-err/40 bg-err/10 p-3 text-sm text-err">{error}</p> : null}
            <div className="flex flex-col gap-3 border-t border-edge pt-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary" onClick={() => onReviewDecision?.('defer')} disabled={busy || !record}>
                  {decisionSaving === 'defer' ? 'Deferring' : 'Defer 7 days'}
                </button>
                <button type="button" className="btn-secondary" onClick={() => onReviewDecision?.('dismiss')} disabled={busy || !record}>
                  {decisionSaving === 'dismiss' ? 'Dismissing' : 'Dismiss'}
                </button>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={busy || !record}>
                  {saving ? 'Saving' : `Save ${reviewType === 'missing-covers' ? 'cover' : 'updates'}`}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </DetailDrawerShell>
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
  const [selectedReview, setSelectedReview] = useState(null);
  const [selectedReviewRecord, setSelectedReviewRecord] = useState(null);
  const [reviewForm, setReviewForm] = useState({});
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewDecisionSaving, setReviewDecisionSaving] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [reviewCoverUploading, setReviewCoverUploading] = useState(false);
  const [reviewLookupQuery, setReviewLookupQuery] = useState('');
  const [reviewLookupContext, setReviewLookupContext] = useState('');
  const [reviewLookupMatches, setReviewLookupMatches] = useState([]);
  const [reviewLookupLoading, setReviewLookupLoading] = useState(false);
  const [reviewLookupError, setReviewLookupError] = useState('');

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
  const sparseMetadataItems = Array.isArray(summary?.attention_details?.sparse_metadata_items)
    ? summary.attention_details.sparse_metadata_items
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

  const focusReviewTab = (tabId) => {
    setActiveDashboardTab('attention');
    setActiveAttentionTab(tabId);
  };

  const openReviewItem = useCallback(async (item, reviewType) => {
    if (!item?.id) return;
    setSelectedReview({ item, reviewType });
    setSelectedReviewRecord(null);
    setReviewForm(buildReviewForm(item));
    setReviewError('');
    setReviewLookupQuery(item?.title || '');
    setReviewLookupContext(lookupContextValue(item));
    setReviewLookupMatches([]);
    setReviewLookupError('');
    setReviewLoading(true);
    try {
      const record = await apiCall('get', `/media/${item.id}`);
      setSelectedReviewRecord(record);
      setReviewForm(buildReviewForm(record));
      setReviewLookupQuery(record?.title || item?.title || '');
      setReviewLookupContext(lookupContextValue(record) || lookupContextValue(item));
    } catch (err) {
      const message = err?.response?.data?.error || 'Failed to load this review item';
      setReviewError(message);
      onToast?.(message, 'error');
    } finally {
      setReviewLoading(false);
    }
  }, [apiCall, onToast]);

  const closeReviewItem = () => {
    setSelectedReview(null);
    setSelectedReviewRecord(null);
    setReviewForm({});
    setReviewError('');
    setReviewLoading(false);
    setReviewSaving(false);
    setReviewDecisionSaving('');
    setReviewCoverUploading(false);
    setReviewLookupQuery('');
    setReviewLookupContext('');
    setReviewLookupMatches([]);
    setReviewLookupError('');
    setReviewLookupLoading(false);
  };

  const updateReviewField = (field, value) => {
    setReviewForm((current) => ({ ...current, [field]: value }));
  };

  const uploadReviewCover = async (file) => {
    if (!file) return;
    setReviewCoverUploading(true);
    setReviewError('');
    try {
      const body = new FormData();
      body.append('cover', file);
      const uploaded = await apiCall('post', '/media/upload-cover', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      if (!uploaded?.path) throw new Error('Cover upload did not return a path');
      setReviewForm((current) => ({ ...current, poster_path: uploaded.path }));
      onToast?.('Cover image uploaded', 'success');
    } catch (err) {
      const message = err?.response?.data?.error || err.message || 'Cover upload failed';
      setReviewError(message);
      onToast?.(message, 'error');
    } finally {
      setReviewCoverUploading(false);
    }
  };

  const searchReviewMatches = async () => {
    const record = selectedReviewRecord || selectedReview?.item;
    const mediaType = record?.media_type || 'movie';
    const title = String(reviewLookupQuery || reviewForm.title || record?.title || '').trim();
    if (!title) {
      setReviewLookupError('Enter a title to search.');
      return;
    }

    setReviewLookupLoading(true);
    setReviewLookupError('');
    setReviewLookupMatches([]);
    try {
      let matches = [];
      if (mediaType === 'movie' || mediaType === 'tv_series') {
        matches = await apiCall('post', '/media/search-tmdb', {
          title,
          year: String(reviewLookupContext || reviewForm.year || '').trim() || undefined,
          mediaType: inferTmdbSearchType(mediaType)
        });
      } else if (mediaType === 'book') {
        const data = await apiCall('post', '/media/enrich/book/search', {
          title,
          author: String(reviewLookupContext || reviewForm.author || record?.type_details?.author || '').trim()
        });
        matches = data?.matches || [];
      } else if (mediaType === 'comic_book') {
        const data = await apiCall('post', '/media/enrich/comic/search', { title });
        matches = data?.matches || [];
      } else if (mediaType === 'audio') {
        const data = await apiCall('post', '/media/enrich/audio/search', {
          title,
          artist: String(reviewLookupContext || reviewForm.artist || record?.type_details?.artist || '').trim()
        });
        matches = data?.matches || [];
      } else if (mediaType === 'game') {
        const data = await apiCall('post', '/media/enrich/game/search', { title });
        matches = data?.matches || [];
      }
      setReviewLookupMatches(Array.isArray(matches) ? matches : []);
      if (!matches?.length) setReviewLookupError('No matches found. Try a shorter or corrected title.');
    } catch (err) {
      const message = err?.response?.data?.error || err.message || 'Search failed';
      setReviewLookupError(message);
      onToast?.(message, 'error');
    } finally {
      setReviewLookupLoading(false);
    }
  };

  const applyReviewMatch = (candidate) => {
    const record = selectedReviewRecord || selectedReview?.item;
    const mediaType = record?.media_type || 'movie';
    const title = lookupCandidateTitle(candidate);
    const year = lookupCandidateYear(candidate);
    const image = lookupCandidateImage(candidate);
    const next = {};

    if (title) next.title = title;
    if (year) next.year = String(year);
    if (image) next.poster_path = image;

    if (mediaType === 'movie' || mediaType === 'tv_series') {
      const tmdbType = candidate?.tmdb_media_type || inferTmdbSearchType(mediaType);
      if (candidate?.id) {
        next.tmdb_id = String(candidate.id);
        next.tmdb_media_type = tmdbType;
        next.tmdb_url = `https://www.themoviedb.org/${tmdbType}/${candidate.id}`;
      }
    } else if (mediaType === 'book') {
      const details = candidate?.type_details || {};
      if (details.isbn) next.isbn = details.isbn;
      if (details.isbn13) next.isbn13 = details.isbn13;
      if (candidate?.id) next.google_books_id = String(candidate.id);
      if (details.author) next.author = details.author;
      if (details.publisher) next.publisher = details.publisher;
    } else if (mediaType === 'comic_book') {
      const details = candidate?.type_details || {};
      if (details.series) next.series = details.series;
      if (details.issue_number) next.issue_number = details.issue_number;
      if (details.provider_issue_id || candidate?.id) next.provider_issue_id = String(details.provider_issue_id || candidate.id);
      if (details.publisher) next.publisher = details.publisher;
      if (details.isbn) next.isbn = details.isbn;
      if (details.isbn13) next.isbn13 = details.isbn13;
    } else if (mediaType === 'audio') {
      const details = candidate?.type_details || {};
      if (details.artist) next.artist = details.artist;
      if (details.album || title) next.album = details.album || title;
      if (details.track_count) next.track_count = String(details.track_count);
    } else if (mediaType === 'game') {
      const details = candidate?.type_details || {};
      if (details.platform) next.platform = details.platform;
      if (details.developer) next.developer = details.developer;
      if (candidate?.provider_item_id || candidate?.id) next.provider_item_id = String(candidate.provider_item_id || candidate.id);
    }

    setReviewForm((current) => ({ ...current, ...next }));
    onToast?.('Match details applied. Save to update the item.', 'success');
  };

  const saveReviewItem = async () => {
    const record = selectedReviewRecord;
    if (!record?.id) return;
    const mediaType = record.media_type || 'movie';
    const fields = DETAIL_FIELDS_BY_TYPE[mediaType] || DETAIL_FIELDS_BY_TYPE.movie;
    const payload = { media_type: mediaType };
    const nextTypeDetails = { ...(record.type_details || {}) };
    let hasDetailChange = false;

    const applyTopField = (field) => {
      const nextValue = String(reviewForm[field] || '').trim();
      if (!nextValue || nextValue === coerceFieldValue(record[field])) return;
      payload[field] = field === 'year' ? Number(nextValue) || nextValue : nextValue;
    };

    applyTopField('title');
    applyTopField('year');
    applyTopField('format');
    applyTopField('tmdb_media_type');
    applyTopField('tmdb_url');

    fields.forEach(([field, _label, bucket]) => {
      const nextValue = String(reviewForm[field] || '').trim();
      if (!nextValue) return;
      if (bucket === 'detail') {
        if (nextValue !== coerceFieldValue(record.type_details?.[field])) {
          nextTypeDetails[field] = nextValue;
          hasDetailChange = true;
        }
      } else if (nextValue !== coerceFieldValue(record[field])) {
        payload[field] = nextValue;
      }
    });

    if (hasDetailChange) payload.type_details = nextTypeDetails;
    if (Object.keys(payload).length <= 1) {
      closeReviewItem();
      return;
    }

    setReviewSaving(true);
    setReviewError('');
    try {
      await apiCall('patch', `/media/${record.id}`, payload);
      onToast?.('Review item updated', 'success');
      closeReviewItem();
      await loadSummary();
    } catch (err) {
      const message = err?.response?.data?.error || 'Failed to save review item';
      setReviewError(message);
      onToast?.(message, 'error');
    } finally {
      setReviewSaving(false);
    }
  };

  const applyReviewDecision = async (action) => {
    const record = selectedReviewRecord || selectedReview?.item;
    const findingType = reviewDecisionFindingType(selectedReview?.reviewType);
    if (!record?.id || !findingType) return;
    setReviewDecisionSaving(action);
    setReviewError('');
    try {
      await apiCall('post', '/dashboard/review-decisions', {
        media_id: Number(record.id),
        finding_type: findingType,
        action
      });
      onToast?.(action === 'defer' ? 'Review item deferred for 7 days' : 'Review item dismissed until it changes', 'success');
      closeReviewItem();
      await loadSummary();
    } catch (err) {
      const message = err?.response?.data?.error || 'Failed to update this review item';
      setReviewError(message);
      onToast?.(message, 'error');
    } finally {
      setReviewDecisionSaving('');
    }
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
          />
          <MediaAttentionList
            items={missingCoverItems}
            emptyText="No items without cover art found."
            reviewType="missing-covers"
            onOpenItem={openReviewItem}
          />
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
          />
          <MediaAttentionList
            items={missingIdentifierItems}
            emptyText="No items missing identifiers found."
            reviewType="missing-identifiers"
            onOpenItem={openReviewItem}
          />
        </div>
      )
    },
    {
      id: 'sparse-metadata',
      label: 'Sparse metadata',
      shortLabel: 'Meta',
      count: attentionCounts['sparse-metadata'] || sparseMetadataItems.length,
      content: (
        <div className="space-y-2">
          <AttentionListHeader
            count={attentionCounts['sparse-metadata'] || sparseMetadataItems.length}
            itemCount={sparseMetadataItems.length}
          />
          <MediaAttentionList
            items={sparseMetadataItems}
            emptyText="No sparse metadata items found."
            reviewType="sparse-metadata"
            onOpenItem={openReviewItem}
          />
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
  ], [attentionCounts, failedJobs, missingCoverItems, missingIdentifierItems, sparseMetadataItems, plexConflictAttention, openReviewItem]);

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

      <div className="mb-4 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricButton label="Items" value={summary?.collection?.total_items || 0} onClick={() => openLibrary(null)} />
        <MetricButton
          label="Missing covers"
          value={summary?.collection?.missing_covers || 0}
          onClick={() => focusReviewTab('missing-covers')}
          disabled={!Number(summary?.collection?.missing_covers || 0)}
        />
        <MetricButton
          label="Missing identifiers"
          value={summary?.collection?.missing_identifiers || 0}
          onClick={() => focusReviewTab('missing-identifiers')}
          disabled={!Number(summary?.collection?.missing_identifiers || 0)}
        />
        <MetricButton
          label="Sparse metadata"
          value={summary?.collection?.sparse_metadata || 0}
          onClick={() => focusReviewTab('sparse-metadata')}
          disabled={!Number(summary?.collection?.sparse_metadata || 0)}
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

      {selectedReview ? (
        <MediaReviewDrawer
          item={selectedReview.item}
          reviewType={selectedReview.reviewType}
          record={selectedReviewRecord}
          form={reviewForm}
          loading={reviewLoading}
          saving={reviewSaving}
          decisionSaving={reviewDecisionSaving}
          error={reviewError}
          coverUploading={reviewCoverUploading}
          lookupQuery={reviewLookupQuery}
          lookupContext={reviewLookupContext}
          lookupMatches={reviewLookupMatches}
          lookupLoading={reviewLookupLoading}
          lookupError={reviewLookupError}
          onChange={updateReviewField}
          onCoverSelect={uploadReviewCover}
          onLookupQueryChange={setReviewLookupQuery}
          onLookupContextChange={setReviewLookupContext}
          onRunLookup={searchReviewMatches}
          onApplyLookup={applyReviewMatch}
          onReviewDecision={applyReviewDecision}
          onSave={saveReviewItem}
          onClose={closeReviewItem}
          Spinner={Spinner}
        />
      ) : null}
    </div>
  );
}
