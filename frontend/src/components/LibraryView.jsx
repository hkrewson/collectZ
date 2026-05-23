import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Icons,
  Spinner,
  SectionTabs,
  SectionTabPanel,
  DisclosureList,
  DetailDrawerShell,
  DrawerBackdrop,
  CollectionPaginationFooter,
  cx,
  posterUrl,
  ObjectPosterCard,
  mediaTypeLabel,
  inferTmdbSearchType,
  isInteractiveTarget,
  detectBarcodeCapturePayloadFromFile,
  extractIdentifierCandidatesFromFile,
  inferBookBarcodeIdentifier,
  isLikelyRetailBookBarcode,
  normalizeIsbnCandidate,
  normalizeBarcodeInput
} from './app/AppPrimitives';
import SignatureManager from './app/SignatureManager';
import {
  getOwnedFormatLabels,
  getOwnedFormatOptions,
  normalizeOwnedFormats,
  sortOwnedFormats
} from './app/mediaFormats';

const ENTRY_MEDIA_TABS = [
  { value: 'audio', label: 'Audio' },
  { value: 'book', label: 'Book' },
  { value: 'comic_book', label: 'Comic Book' },
  { value: 'game', label: 'Game' },
  { value: 'movie', label: 'Movie' },
  { value: 'tv_series', label: 'TV' }
];
const DEFAULT_MEDIA_FORM = {
  media_type: 'movie',
  title: '', original_title: '', release_date: '', year: '', format: 'Blu-ray', owned_formats: ['bluray'], genre: '',
  director: '', cast: '', rating: '', user_rating: 0, runtime: '', upc: '', location: '', notes: '',
  signed_by: '', signed_role: '', signed_on: '', signed_at: '', signed_proof_path: '',
  overview: '', tmdb_id: '', tmdb_media_type: 'movie', tmdb_url: '', trailer_url: '', poster_path: '', backdrop_path: '',
  season_number: '', episode_number: '', episode_title: '', network: '',
  book_author: '', book_isbn: '', book_publisher: '', book_edition: '',
  movie_edition: '',
  comic_series: '', comic_issue_number: '', comic_volume: '', comic_writer: '', comic_artist: '', comic_inker: '', comic_colorist: '', comic_cover_date: '', comic_provider_issue_id: '', comic_barcode_addon: '',
  audio_artist: '', audio_album: '', audio_track_count: '',
  game_platform: '', game_developer: '', game_region: ''
};
const OVERVIEW_MAX_LENGTH = 10000;

function normalizeReviewFilter(value) {
  const raw = typeof value === 'string' ? value : value?.type;
  const normalized = String(raw || '').trim().toLowerCase().replace(/-/g, '_');
  if (normalized === 'missing_covers' || normalized === 'missing_cover') return 'missing_covers';
  if (normalized === 'missing_identifiers' || normalized === 'missing_identifier') return 'missing_identifiers';
  return '';
}

function reviewFilterLabel(value) {
  if (value === 'missing_covers') return 'Missing covers';
  if (value === 'missing_identifiers') return 'Missing identifiers';
  return 'Review filter';
}

function clampOverviewText(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  return raw.slice(0, OVERVIEW_MAX_LENGTH);
}

function getOwnedFormatSummary(item = {}) {
  const labels = getOwnedFormatLabels(item.media_type || 'movie', item.owned_formats || []);
  if (labels.length > 0) return labels;
  return item.format ? [item.format] : ['—'];
}

function OwnedFormatPicker({ mediaType, value = [], onChange }) {
  const options = getOwnedFormatOptions(mediaType);
  if (!options.length) return null;
  const selected = new Set(sortOwnedFormats(mediaType, value));

  return (
    <div className="overflow-x-auto pb-1 no-scrollbar">
      <div
        role="group"
        aria-label="Owned formats"
        className="inline-flex min-w-full flex-nowrap gap-2 whitespace-nowrap"
      >
        {options.map((option) => {
          const active = selected.has(option.value);
          return (
            <button
              key={option.value}
              type="button"
              className={cx(
                'inline-flex h-7 shrink-0 items-center rounded-md border px-2 text-[12px] font-medium leading-none transition-colors',
                active
                  ? 'border-brand bg-brand/10 text-ink'
                  : 'border-edge bg-surface text-dim hover:border-muted hover:text-ink'
              )}
              aria-pressed={active}
              onClick={() => {
                const next = active
                  ? [...selected].filter((entry) => entry !== option.value)
                  : [...selected, option.value];
                onChange(sortOwnedFormats(mediaType, next));
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PlexWritebackControls({ item, loading, onWriteRating, onWriteWatchState }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="plex-writeback-controls">
      <button
        type="button"
        className="btn-secondary btn-sm"
        onClick={onWriteRating}
        disabled={Boolean(loading)}
        data-testid="plex-rating-writeback-button"
      >
        {loading === 'rating' ? <Spinner size={14} /> : <Icons.Star />}
        Push rating to Plex
      </button>
      {item?.media_type !== 'tv_series' ? (
        <>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => onWriteWatchState('scrobble')}
            disabled={Boolean(loading)}
            data-testid="plex-watch-scrobble-button"
          >
            {loading === 'scrobble' ? <Spinner size={14} /> : <Icons.Check />}
            Mark watched in Plex
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => onWriteWatchState('unscrobble')}
            disabled={Boolean(loading)}
            data-testid="plex-watch-unscrobble-button"
          >
            {loading === 'unscrobble' ? <Spinner size={14} /> : <Icons.Refresh />}
            Mark unwatched in Plex
          </button>
        </>
      ) : null}
    </div>
  );
}

function normalizeDateInput(value) {
  if (!value) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function formatDate(value) {
  const normalized = normalizeDateInput(value);
  if (!normalized) return '—';
  const parsed = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return normalized;
  return parsed.toLocaleDateString();
}

function addDaysToIsoDate(value, days) {
  const base = normalizeDateInput(value) || new Date().toISOString().slice(0, 10);
  const parsed = new Date(`${base}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return base;
  parsed.setDate(parsed.getDate() + Number(days || 0));
  return parsed.toISOString().slice(0, 10);
}

function buildLoanFormState(item = {}) {
  const primaryFormat = getOwnedFormatSummary(item).find((entry) => entry && entry !== '—') || '';
  const today = new Date().toISOString().slice(0, 10);
  return {
    borrower_name: '',
    borrower_email: '',
    loaned_at: today,
    due_at: addDaysToIsoDate(today, 14),
    loan_format: primaryFormat,
    notes: ''
  };
}

function loanReminderLabel(loan) {
  if (!loan || loan.returned_at) return 'Not needed';
  if (loan.reminder_sent_today) return 'Sent today';
  if (loan.reminder_phase === 'overdue') return 'Overdue reminder';
  if (loan.reminder_phase === 'due_soon') return 'Due soon reminder';
  if (!loan.borrower_email) return 'Add email';
  return 'Waiting';
}

function formatReminderTimestamp(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleString();
}

function formatReminderEventLabel(event) {
  if (!event) return 'Reminder event';
  const trigger = event.trigger_source === 'automatic' ? 'Automatic' : 'Manual';
  const phase = event.phase === 'overdue' ? 'overdue' : 'due soon';
  if (event.status === 'failed') return `${phase} reminder failed (${trigger.toLowerCase()})`;
  if (event.status === 'skipped') return `${phase} reminder skipped (${trigger.toLowerCase()})`;
  return `${phase} reminder sent (${trigger.toLowerCase()})`;
}

function ReminderHistorySummary({ events = [], className = '' }) {
  if (!Array.isArray(events) || events.length === 0) return null;
  return (
    <div className={cx('mt-4 pt-2', className)}>
      <p className="text-xs text-ghost">Reminder history</p>
      <div className="mt-2 space-y-2">
        {events.slice(0, 3).map((event) => (
          <div
            key={event.id || `${event.sent_at || 'event'}-${event.delivery_window_key || ''}`}
            className="flex items-start justify-between gap-4 text-sm"
          >
            <div className="min-w-0">
              <p className="text-ink">{formatReminderEventLabel(event)}</p>
              {event.failure_summary ? (
                <p className="mt-1 text-xs text-dim">{event.failure_summary}</p>
              ) : null}
            </div>
            <span className="shrink-0 text-xs text-ghost">{formatReminderTimestamp(event.sent_at)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StarRating({ value = 0, onChange, readOnly = false }) {
  const safe = Math.max(0, Math.min(5, Number(value) || 0));
  return (
    <div className="star-wrap">
      {[1, 2, 3, 4, 5].map((star) => {
        const fill = Math.max(0, Math.min(1, safe - (star - 1)));
        return (
          <button
            key={star}
            type="button"
            disabled={readOnly}
            className={cx('star-btn', !readOnly && 'hover:scale-110 transition-transform')}
            onClick={(e) => {
              if (readOnly || !onChange) return;
              const half = e.clientX - e.currentTarget.getBoundingClientRect().left < e.currentTarget.offsetWidth / 2;
              onChange(half ? star - 0.5 : star);
            }}
          >
            <span className="star-base">★</span>
            <span className="star-fill" style={{ width: `${fill * 100}%` }}>★</span>
          </button>
        );
      })}
      <span className="ml-1.5 text-xs text-ghost font-mono">{safe.toFixed(1)}</span>
    </div>
  );
}

function userRatingToStars(value) {
  const rating = Number(value);
  if (!Number.isFinite(rating)) return 0;
  return Math.max(0, Math.min(5, rating / 2));
}

function starsToUserRating(value) {
  const stars = Number(value);
  if (!Number.isFinite(stars)) return null;
  return Number((Math.max(0, Math.min(5, stars)) * 2).toFixed(1));
}

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

function EmptyState({ icon, title, subtitle, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
      <div className="w-16 h-16 rounded-2xl bg-raised border border-edge flex items-center justify-center text-ghost">
        {icon}
      </div>
      <div>
        <p className="font-display text-2xl tracking-wider text-dim">{title}</p>
        {subtitle && <p className="text-sm text-ghost mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function LabeledField({ label, className = '', children }) {
  return (
    <div className={cx('field', className)}>
      <label className="mb-1.5 block text-xs font-medium text-dim">{label}</label>
      {children}
    </div>
  );
}

function getComicSeriesName(item = {}) {
  const details = item?.type_details && typeof item.type_details === 'object' ? item.type_details : {};
  const explicit = String(details.series || '').trim();
  if (explicit) return explicit;
  const title = String(item?.title || '').trim();
  const match = title.match(/^(.+?)\s+#\s*[\w.-]+/);
  if (match?.[1]) return match[1].trim();
  return title || 'Unknown Series';
}

function extractComicIssueRaw(item = {}) {
  const details = item?.type_details && typeof item.type_details === 'object' ? item.type_details : {};
  const direct = String(details.issue_number || '').trim();
  if (direct) return direct.replace(/^#\s*/, '');
  const title = String(item?.title || '').trim();
  const match = title.match(/#\s*([A-Za-z0-9.-]+)/);
  if (match?.[1]) return String(match[1]).trim();
  return '';
}

function parseComicIssueOrdinal(rawIssue = '') {
  const raw = String(rawIssue || '')
    .trim()
    .replace(/^#\s*/, '')
    .replace(/^(issue|no\.?)\s*/i, '')
    .trim();
  if (!raw) return { kind: 2, num: Number.POSITIVE_INFINITY, suffix: '', pad: 0, raw: '' };

  const decimal = raw.match(/^(\d+)\.(\d+)(.*)$/);
  if (decimal) {
    return {
      kind: 0,
      num: Number(`${decimal[1]}.${decimal[2]}`),
      suffix: String(decimal[3] || '').trim().toLowerCase(),
      pad: decimal[1].length,
      raw
    };
  }

  const numeric = raw.match(/^(\d+)(.*)$/);
  if (numeric) {
    return {
      kind: 0,
      num: Number(numeric[1]),
      suffix: String(numeric[2] || '').trim().toLowerCase(),
      pad: numeric[1].length,
      raw
    };
  }

  return { kind: 1, num: Number.POSITIVE_INFINITY, suffix: raw.toLowerCase(), pad: 0, raw };
}

function compareComicIssueOrder(aItem, bItem) {
  const a = parseComicIssueOrdinal(extractComicIssueRaw(aItem));
  const b = parseComicIssueOrdinal(extractComicIssueRaw(bItem));
  if (a.kind !== b.kind) return a.kind - b.kind;
  if (a.kind === 0) {
    if (a.num !== b.num) return a.num - b.num;
    if (a.suffix !== b.suffix) {
      if (!a.suffix && b.suffix) return -1;
      if (a.suffix && !b.suffix) return 1;
      return a.suffix.localeCompare(b.suffix, undefined, { sensitivity: 'base' });
    }
    if (a.num === 0 && a.pad !== b.pad) return b.pad - a.pad;
  }
  if (a.kind === 1 && a.suffix !== b.suffix) return a.suffix.localeCompare(b.suffix, undefined, { sensitivity: 'base' });
  const aTitle = String(aItem?.title || '');
  const bTitle = String(bItem?.title || '');
  return aTitle.localeCompare(bTitle, undefined, { sensitivity: 'base' });
}

function reviewClue(item) {
  const reasons = Array.isArray(item?.review_reasons) ? item.review_reasons.filter(Boolean) : [];
  const recommended = Array.isArray(item?.recommended_identifiers) ? item.recommended_identifiers.filter(Boolean) : [];
  const reason = reasons[0] || '';
  const recommendation = recommended.length ? `Add ${recommended.join(' or ')}.` : '';
  return [reason, recommendation].filter(Boolean).join('. ').replace('..', '.');
}

function MediaCard({ item, onOpen, onEdit, onDelete, onRating, supportsHover, selected = false, onToggleSelect = null, onSelectionGesture = null, selectionEnabled = false }) {
  const onPointerUp = (e) => {
    if (e.pointerType !== 'touch') return;
    if (isInteractiveTarget(e.target)) return;
    onOpen(item);
  };
  const handleOpen = (e) => {
    if (selectionEnabled && e?.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      onToggleSelect?.(item.id, e);
      return;
    }
    onOpen(item);
  };
  const handleMouseDown = (e) => {
    if (!selectionEnabled) return;
    onSelectionGesture?.(e);
  };
  const clue = reviewClue(item);

  return (
    <ObjectPosterCard
      title={item.title}
      imagePath={item.poster_path}
      fallbackIcon={<Icons.Film />}
      supportsHover={supportsHover}
      onOpen={handleOpen}
      onMouseDown={handleMouseDown}
      onPointerUp={onPointerUp}
      selected={selected}
      leftBadges={getOwnedFormatSummary(item)}
      rightBadge={<span className="badge badge-dim text-[10px] backdrop-blur-sm bg-void/60 border-ghost/20">{mediaTypeLabel(item.media_type)}</span>}
      overlayChildren={selectionEnabled ? (
        <button
          type="button"
          className={cx(
            'absolute left-2 top-9 z-10 inline-flex h-6 w-6 items-center justify-center rounded-md border bg-abyss/92 shadow-sm transition-colors',
            selected ? 'border-muted bg-abyss text-ink' : 'border-edge/90 text-ghost hover:border-muted hover:text-ink'
          )}
          aria-label={`Select ${item.title}`}
          aria-pressed={selected}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect?.(item.id, e);
          }}
        >
          {selected ? <Icons.Check /> : null}
        </button>
      ) : null}
      subtitle={clue || `${item.year || '—'}${item.director ? ` · ${item.director}` : ''}${item.media_type === 'tv_series' && item.tv_all_seasons_completed ? ' · Completed' : ''}`}
      meta={
        <div onClick={(e) => e.stopPropagation()}>
          <StarRating value={userRatingToStars(item.user_rating)} onChange={(r) => onRating(item.id, starsToUserRating(r))} />
        </div>
      }
    />
  );
}

function CollectionCard({ item, supportsHover, onOpen, onEdit, onConvert }) {
  const title = item.name || item.source_title || `Collection #${item.id}`;
  const onPointerUp = (e) => {
    if (e.pointerType !== 'touch') return;
    if (isInteractiveTarget(e.target)) return;
    onOpen(item);
  };
  return (
    <ObjectPosterCard
      title={title}
      imagePath={item.poster_path}
      fallbackIcon={<Icons.Library />}
      supportsHover={supportsHover}
      onOpen={() => onOpen(item)}
      onPointerUp={onPointerUp}
      leftBadges={[item.has_digital ? 'Digital' : 'Collection']}
      rightBadge={<span className="badge badge-dim text-[10px] backdrop-blur-sm bg-void/60 border-ghost/20">{mediaTypeLabel(item.media_type)}</span>}
      subtitle={`${item.item_count || 0} item${Number(item.item_count || 0) === 1 ? '' : 's'}${Number.isFinite(Number(item.expected_item_count)) && Number(item.expected_item_count) > 0 ? ` · expected ${item.expected_item_count}` : ''}`}
    />
  );
}

function MediaListRow({ item, onOpen, onEdit, onDelete, onRating, supportsHover, selected = false, onToggleSelect = null, onSelectionGesture = null, selectionEnabled = false }) {
  const onPointerUp = (e) => {
    if (e.pointerType !== 'touch') return;
    if (isInteractiveTarget(e.target)) return;
    onOpen(item);
  };
  const handleOpen = (e) => {
    if (selectionEnabled && e?.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      onToggleSelect?.(item.id, e);
      return;
    }
    onOpen(item);
  };
  const handleMouseDown = (e) => {
    if (!selectionEnabled) return;
    onSelectionGesture?.(e);
  };
  const clue = reviewClue(item);

  return (
    <article onMouseDown={handleMouseDown} onClick={handleOpen} onPointerUp={onPointerUp} className={cx('group flex items-start gap-3 rounded-lg border bg-surface p-3 transition-all duration-150 animate-fade-in sm:items-center', selected ? 'border-brand/55' : 'border-edge hover:border-muted hover:bg-raised', onOpen && 'cursor-pointer')}>
      {selectionEnabled && (
        <div onClick={(e) => e.stopPropagation()} className="shrink-0 pt-1 sm:pt-0">
          <button
            type="button"
            className={cx(
              'inline-flex h-6 w-6 items-center justify-center rounded-md border bg-surface shadow-sm transition-colors',
              selected ? 'border-muted bg-raised text-ink' : 'border-edge/90 text-ghost hover:border-muted hover:text-ink hover:bg-raised/70'
            )}
            aria-label={`Select ${item.title}`}
            aria-pressed={selected}
            onClick={(e) => onToggleSelect?.(item.id, e)}
          >
            {selected ? <Icons.Check /> : null}
          </button>
        </div>
      )}
      <div className="w-10 shrink-0" style={{ aspectRatio: '2/3' }}>
        <div className="poster rounded w-full h-full">
          {posterUrl(item.poster_path)
            ? <img src={posterUrl(item.poster_path)} alt={item.title} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
            : <div className="absolute inset-0 flex items-center justify-center text-ghost"><Icons.Film /></div>}
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate text-ink">{item.title}</p>
        <p className="text-sm text-ghost break-words">{[item.year, getOwnedFormatSummary(item).join(', '), mediaTypeLabel(item.media_type), item.director].filter(Boolean).join(' · ')}</p>
        {item.media_type === 'tv_series' && item.tv_all_seasons_completed && (
          <p className="text-xs text-ok mt-0.5 inline-flex items-center gap-1"><Icons.Check />All seasons completed</p>
        )}
        {clue ? <p className="mt-0.5 break-words text-xs text-dim">{clue}</p> : null}
        {item.genre && <p className="text-xs text-ghost/70 mt-0.5 truncate">{item.genre}</p>}
      </div>
      <div onClick={(e) => e.stopPropagation()} className="sm:shrink-0"><StarRating value={userRatingToStars(item.user_rating)} onChange={(r) => onRating(item.id, starsToUserRating(r))} /></div>
      <div className={cx('flex flex-wrap gap-2 transition-opacity duration-150 sm:shrink-0', supportsHover ? 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100' : 'opacity-100')}>
        <button onClick={(e) => { e.stopPropagation(); onEdit(item); }} className="btn-ghost btn-sm"><Icons.Edit /></button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(item.id); }} className="btn-ghost btn-sm text-err hover:bg-err/10"><Icons.Trash /></button>
      </div>
    </article>
  );
}

function MergeEvidenceSection({
  mergeDetailsLoading,
  mergeSummary,
  mergeDisclosureItems,
  openMergeEntryId,
  setOpenMergeEntryId,
  itemTitle,
  formatMergeSourceLabel,
  formatMergeTimestamp,
  formatMergeValue,
  formatMergeTechnicalLabel
}) {
  if (!(mergeDetailsLoading || (mergeSummary && Number(mergeSummary.active_merge_count || 0) > 0))) {
    return null;
  }

  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="label">Match evidence</p>
          {mergeDetailsLoading ? (
            <p className="mt-1 text-sm text-ghost">Loading merge evidence…</p>
          ) : (
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-dim">
              <span>{`${Number(mergeSummary?.active_merge_count || 0)} ${Number(mergeSummary?.active_merge_count || 0) === 1 ? 'merge event' : 'merge events'}`}</span>
              {mergeSummary?.source_count ? <span>{`${mergeSummary.source_count} supporting sources`}</span> : null}
            </div>
          )}
        </div>
      </div>
      {!mergeDetailsLoading && mergeDisclosureItems.length > 0 ? (
        <DisclosureList
          items={mergeDisclosureItems}
          openId={openMergeEntryId}
          onToggle={setOpenMergeEntryId}
          renderSummary={(itemEntry) => {
            const entry = itemEntry.entry;
            return (
              <>
                <p className="text-sm font-medium text-ink">{entry?.match_summary || 'Merged record'}</p>
                <p className="mt-1 text-sm text-ghost">
                  {`Canonical: ${formatMergeSourceLabel(entry?.canonical)} · Matched: ${formatMergeSourceLabel(entry?.merged)}`}
                </p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ghost">
                  {entry?.confidence ? <span>{String(entry.confidence).charAt(0).toUpperCase() + String(entry.confidence).slice(1)} confidence</span> : null}
                  {entry?.applied_at ? <span>{formatMergeTimestamp(entry.applied_at)}</span> : null}
                </div>
              </>
            );
          }}
          renderContent={(itemEntry) => {
            const entry = itemEntry.entry;
            const provenanceRows = Array.isArray(entry?.field_provenance) ? entry.field_provenance : [];
            return (
              <div className="space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="text-[11px] font-medium text-ghost">Canonical record</p>
                    <p className="mt-1 text-sm text-ink">{entry?.canonical?.title || itemTitle}</p>
                    <p className="mt-1 text-xs text-ghost">Source: {formatMergeSourceLabel(entry?.canonical)}</p>
                    {entry?.technical_details?.canonical_id ? (
                      <p className="mt-1 text-xs text-ghost">Record #{entry.technical_details.canonical_id}</p>
                    ) : null}
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-ghost">Matched record</p>
                    <p className="mt-1 text-sm text-ink">{entry?.merged?.title || 'Merged record'}</p>
                    <p className="mt-1 text-xs text-ghost">Source: {formatMergeSourceLabel(entry?.merged)}</p>
                    {entry?.technical_details?.duplicate_id ? (
                      <p className="mt-1 text-xs text-ghost">Record #{entry.technical_details.duplicate_id}</p>
                    ) : null}
                  </div>
                </div>
                {provenanceRows.length > 0 ? (
                  <div>
                    <p className="text-[11px] font-medium text-ghost">Compared fields</p>
                    <div className="mt-3 overflow-hidden rounded-[10px] border border-edge/60">
                      <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] border-b border-edge/60 bg-panel/40 px-3 py-2 text-[11px] font-medium text-ghost">
                        <p>Matched on</p>
                        <p>This record</p>
                        <p>Matched record</p>
                      </div>
                      {provenanceRows.map((row) => (
                        <div
                          key={row.key}
                          className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 border-t border-edge/50 px-3 py-2 text-sm text-ink first:border-t-0"
                        >
                          <p className="text-dim">{row.label}</p>
                          <p>{formatMergeValue(row.canonical_value)}</p>
                          <p>{formatMergeValue(row.merged_value)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="grid gap-2 text-xs text-ghost sm:grid-cols-2">
                  {entry?.applied_at ? <p>Merged at: {formatMergeTimestamp(entry.applied_at)}</p> : null}
                  {entry?.confidence ? <p>Confidence: {String(entry.confidence).charAt(0).toUpperCase() + String(entry.confidence).slice(1)}</p> : null}
                  {Array.isArray(entry?.rationale) && entry.rationale.length > 0 ? (
                    <p className="sm:col-span-2">Matched on: {entry.rationale.join(' · ')}</p>
                  ) : null}
                  {formatMergeTechnicalLabel(entry?.repair_type) ? (
                    <p>Repair type: {formatMergeTechnicalLabel(entry?.repair_type)}</p>
                  ) : null}
                </div>
              </div>
            );
          }}
        />
      ) : null}
    </div>
  );
}

function MediaDetail({ item, onClose, onEdit, onDelete, onRating, apiCall, onValuationUpdated, onToast, onFindPossibleDuplicates, canWritePlex = false }) {
  const [variants, setVariants] = useState([]);
  const [variantLoading, setVariantLoading] = useState(false);
  const [mergeDetails, setMergeDetails] = useState(null);
  const [mergeDetailsLoading, setMergeDetailsLoading] = useState(false);
  const [openMergeEntryId, setOpenMergeEntryId] = useState(null);
  const [, setSeasonDrafts] = useState({});
  const [seasonSaving, setSeasonSaving] = useState({});
  const [openSeason, setOpenSeason] = useState(null);
  const [seasonDetailLoading, setSeasonDetailLoading] = useState({});
  const [seasonDetails, setSeasonDetails] = useState({});
  const [valuationRefreshing, setValuationRefreshing] = useState(false);
  const [comicOverviewExpanded, setComicOverviewExpanded] = useState(false);
  const [loanHistory, setLoanHistory] = useState([]);
  const [loanLoading, setLoanLoading] = useState(false);
  const [loanSaving, setLoanSaving] = useState(false);
  const [loanReminderSending, setLoanReminderSending] = useState(false);
  const [showLoanItemDetails, setShowLoanItemDetails] = useState(false);
  const [loanFormOpen, setLoanFormOpen] = useState(false);
  const [loanForm, setLoanForm] = useState(() => buildLoanFormState(item));
  const [kavitaPreview, setKavitaPreview] = useState(null);
  const [kavitaPreviewLoading, setKavitaPreviewLoading] = useState(false);
  const [kavitaApplyLoading, setKavitaApplyLoading] = useState(false);
  const [kavitaSelectedFields, setKavitaSelectedFields] = useState([]);
  const [kavitaProgress, setKavitaProgress] = useState(null);
  const [kavitaProgressLoading, setKavitaProgressLoading] = useState(false);
  const [kavitaProgressSaving, setKavitaProgressSaving] = useState(false);
  const [kavitaProgressResetting, setKavitaProgressResetting] = useState(false);
  const [kavitaMarkReadSaving, setKavitaMarkReadSaving] = useState(false);
  const [kavitaReaderInfo, setKavitaReaderInfo] = useState(null);
  const [kavitaReaderLoading, setKavitaReaderLoading] = useState(false);
  const [kavitaReaderError, setKavitaReaderError] = useState('');
  const [kavitaReaderImageStatus, setKavitaReaderImageStatus] = useState('idle');
  const [kavitaReaderPage, setKavitaReaderPage] = useState(0);
  const [plexWritebackLoading, setPlexWritebackLoading] = useState('');
  const typeDetails = item?.type_details && typeof item.type_details === 'object' ? item.type_details : {};
  const isBook = item?.media_type === 'book';
  const isComic = item?.media_type === 'comic_book';
  const comicOverviewNeedsClamp = isComic && typeof item?.overview === 'string' && item.overview.trim().length > 420;
  const calibreExternalUrl = String(typeDetails.calibre_external_url || '').trim();
  const providerExternalUrl = String(typeDetails.provider_external_url || '').trim();
  const kavitaLaunchUrl = String(typeDetails.kavita_launch_url || '').trim();
  const kavitaLaunchLabel = String(typeDetails.kavita_launch_label || '').trim() || 'Open in Kavita';
  const calibreDownloadUrl = String(typeDetails.calibre_download_url || '').trim();
  const providerDownloadUrl = String(typeDetails.provider_download_url || '').trim();
  const externalMediaUrl = calibreExternalUrl || kavitaLaunchUrl || providerExternalUrl || item.tmdb_url || '';
  const externalMediaLabel = (() => {
    if (calibreExternalUrl) return 'Open in Calibre';
    if (String(typeDetails.provider_name || '').trim().toLowerCase() === 'kavita' || kavitaLaunchUrl) return kavitaLaunchLabel;
    if (item.media_type === 'game') return 'View on IGDB';
    if (item.media_type === 'movie' || item.media_type === 'tv_series') return 'View on TMDB';
    return 'Open source';
  })();
  const titleClassName = 'text-2xl font-semibold tracking-tight text-ink leading-tight';
  const bookDetailRows = isBook
    ? [
        ['Author', typeDetails.author],
        ['Publisher', typeDetails.publisher],
        ['Edition', typeDetails.edition],
        ['ISBN', typeDetails.isbn]
      ].filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
    : [];
  const hiddenTypeDetailKeys = new Set(
    isBook
      ? ['author', 'publisher', 'edition', 'isbn', 'calibre_external_url', 'provider_external_url', 'calibre_download_url', 'provider_download_url', 'kavita_cover_url', 'kavita_cover_proxy_url', 'kavita_cover_source', 'kavita_cover_status', 'kavita_series_url', 'kavita_launch_url', 'kavita_launch_label', 'kavita_launch_target']
      : isComic
        ? ['calibre_entry_id', 'provider_item_id', 'calibre_external_url', 'provider_external_url', 'calibre_download_url', 'provider_download_url', 'provider_name', 'kavita_cover_url', 'kavita_cover_proxy_url', 'kavita_cover_source', 'kavita_cover_status', 'kavita_series_url', 'kavita_launch_url', 'kavita_launch_label', 'kavita_launch_target', 'kavita_chapter_fanout', 'kavita_parent_provider_item_id', 'kavita_series_provider_item_id', 'kavita_chapter_provider_item_id']
        : []
  );
  const visibleTypeDetailEntries = Object.entries(typeDetails)
    .filter(([key, value]) => (
      value !== null
      && value !== undefined
      && String(value).trim() !== ''
      && !hiddenTypeDetailKeys.has(key)
    ));
  const defaultTypeDetailEntries = isBook
    ? []
    : visibleTypeDetailEntries;
  const inferBookSourceLabel = (href) => {
    const value = String(href || '').trim();
    if (!value) return 'Open source';
    try {
      const host = new URL(value).hostname.toLowerCase();
      if (host.includes('google')) return 'View on Google Books';
      if (host.includes('openlibrary')) return 'View on Open Library';
      if (host.includes('archive.org')) return 'View on Internet Archive';
      if (host.includes('metron')) return 'View on Metron';
    } catch {
      // fall back to provider-aware labels below
    }
    if (String(typeDetails.provider_name || '').trim().toLowerCase() === 'googlebooks') {
      return 'View on Google Books';
    }
    if (String(typeDetails.provider_name || '').trim().toLowerCase() === 'kavita') {
      return 'Open in Kavita';
    }
    return 'Open source';
  };
  const inferDownloadLabel = (href, fallback = 'Download file') => {
    const value = String(href || '').trim().toLowerCase();
    if (!value) return fallback;
    if (value.includes('.epub')) return 'Download EPUB';
    if (value.includes('.pdf')) return 'Download PDF';
    if (value.includes('.cbz')) return 'Download CBZ';
    if (value.includes('.cbr')) return 'Download CBR';
    return fallback;
  };
  const inferComicSourceLabel = (href) => {
    const value = String(href || '').trim();
    if (!value) return 'Open source';
    const providerName = String(typeDetails.provider_name || '').trim().toLowerCase();
    try {
      const parsed = new URL(value);
      const host = parsed.hostname.toLowerCase();
      const path = parsed.pathname.toLowerCase();
      if (providerName.includes('cwa_opds') || providerName.includes('calibre') || host.includes('calibre') || path.includes('/opds/')) {
        return path.includes('/download/') ? 'Download on Calibre' : 'View on Calibre';
      }
      if (providerName.includes('kavita') || host.includes('kavita')) return 'Open in Kavita';
      if (host.includes('metron')) return 'View on Metron';
      if (host.includes('comicvine')) return 'View on Comic Vine';
      if (host.includes('leagueofcomicgeeks')) return 'View on League of Comic Geeks';
      if (host.includes('marvel')) return 'View on Marvel';
      if (host.includes('dc.com')) return 'View on DC';
    } catch {
      // fall back to provider-aware labels below
    }
    if (providerName.includes('cwa_opds') || providerName.includes('calibre')) return 'View on Calibre';
    if (providerName.includes('kavita')) return 'Open in Kavita';
    if (providerName.includes('metron')) return 'View on Metron';
    if (providerName.includes('comicvine')) return 'View on Comic Vine';
    return 'Open source';
  };
  const bookSourceLinks = (() => {
    const seen = new Set();
    const candidates = [
      kavitaLaunchUrl ? [kavitaLaunchLabel, kavitaLaunchUrl] : null,
      calibreExternalUrl ? ['Read in Calibre', calibreExternalUrl] : null,
      providerExternalUrl ? [inferBookSourceLabel(providerExternalUrl), providerExternalUrl] : null,
      calibreDownloadUrl ? [inferDownloadLabel(calibreDownloadUrl, 'Download from Calibre'), calibreDownloadUrl] : null,
      providerDownloadUrl ? [inferDownloadLabel(providerDownloadUrl), providerDownloadUrl] : null,
      item.tmdb_url ? [inferBookSourceLabel(item.tmdb_url), item.tmdb_url] : null,
      item.trailer_url ? ['Watch trailer', item.trailer_url] : null
    ].filter(Boolean);
    return candidates.filter((entry) => {
      const href = String(entry[1] || '').trim();
      if (!href || seen.has(href)) return false;
      seen.add(href);
      return true;
    });
  })();
  const comicSourceLinks = (() => {
    const seen = new Set();
    const candidates = [
      kavitaLaunchUrl ? [kavitaLaunchLabel, kavitaLaunchUrl] : null,
      providerExternalUrl ? [inferComicSourceLabel(providerExternalUrl), providerExternalUrl] : null,
      calibreDownloadUrl ? [inferDownloadLabel(calibreDownloadUrl, 'Download from Calibre'), calibreDownloadUrl] : null,
      providerDownloadUrl ? [inferDownloadLabel(providerDownloadUrl, 'Download from Calibre'), providerDownloadUrl] : null,
      item.tmdb_url ? [inferComicSourceLabel(item.tmdb_url), item.tmdb_url] : null,
      item.trailer_url ? ['Watch trailer', item.trailer_url] : null
    ].filter(Boolean);
    return candidates.filter((entry) => {
      const href = String(entry[1] || '').trim();
      if (!href || seen.has(href)) return false;
      seen.add(href);
      return true;
    });
  })();
  const isKavitaLinked = String(typeDetails.provider_name || '').trim().toLowerCase() === 'kavita'
    || Boolean(typeDetails.kavita_series_id || typeDetails.kavita_chapter_id);
  const isPlexLinked = Boolean(item?.plex_linked)
    || String(item?.import_source || '').trim().toLowerCase().includes('plex')
    || String(typeDetails.provider_name || '').trim().toLowerCase().includes('plex');
  const showPlexWritebackControls = canWritePlex && isPlexLinked;
  const isKavitaChapterBacked = String(typeDetails.provider_item_id || '').trim().toLowerCase().startsWith('kavita:chapter:')
    || String(typeDetails.kavita_chapter_provider_item_id || '').trim().toLowerCase().startsWith('kavita:chapter:')
    || String(typeDetails.kavita_chapter_fanout || '').trim().toLowerCase() === 'true';
  const formatValuation = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: String(item.valuation_currency || 'USD').trim().toUpperCase() || 'USD',
        maximumFractionDigits: 2
      }).format(numeric);
    } catch (_) {
      return `${String(item.valuation_currency || 'USD').trim().toUpperCase() || 'USD'} ${numeric.toFixed(2)}`;
    }
  };
  const valuationSummaryRows = [
    ['Low', formatValuation(item.estimated_value_low)],
    ['Mid', formatValuation(item.estimated_value_mid)],
    ['High', formatValuation(item.estimated_value_high)]
  ].filter(([, value]) => value);
  const valuationMetaRows = [
    ['Valuation source', item.valuation_source],
    ['Valuation updated', item.valuation_last_updated ? new Date(item.valuation_last_updated).toLocaleString() : null]
  ].filter(([, value]) => value);
  const hasValuationData = valuationSummaryRows.length > 0 || valuationMetaRows.length > 0;
  const formatMergeTimestamp = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return raw;
    return parsed.toLocaleString();
  };
  const formatMergeSourceLabel = (record = {}) => {
    if (record?.source_label) return record.source_label;
    const parts = [record?.source_label, record?.import_source, record?.provider_name].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : 'Library record';
  };
  const formatMergeValue = (value) => {
    if (value === null || value === undefined || String(value).trim() === '') return '—';
    return String(value);
  };
  const formatMergeTechnicalLabel = (value) => {
    const normalized = String(value || '').trim();
    if (!normalized) return null;
    if (normalized === 'duplicate_attach') return 'Duplicate attach';
    return normalized.replace(/_/g, ' ');
  };
  const mergeEntries = Array.isArray(mergeDetails?.entries) ? mergeDetails.entries : [];
  const mergeSummary = mergeDetails?.summary || null;
  const mergeDisclosureItems = mergeEntries.map((entry) => ({
    id: String(entry.duplicate_id || entry.applied_at || Math.random()),
    entry
  }));
  const activeLoan = loanHistory.find((entry) => !entry?.returned_at) || null;
  const showLoanFocusedView = Boolean(activeLoan) && !showLoanItemDetails;

  const refreshLoans = useCallback(async () => {
    if (!item?.id) return null;
    setLoanLoading(true);
    try {
      const payload = await apiCall('get', `/media/${item.id}/loans`);
      const nextHistory = Array.isArray(payload?.history) ? payload.history : [];
      setLoanHistory(nextHistory);
      return payload;
    } catch (error) {
      setLoanHistory([]);
      return null;
    } finally {
      setLoanLoading(false);
    }
  }, [apiCall, item?.id]);

  const submitLoan = async (event) => {
    event.preventDefault();
    if (!item?.id || loanSaving) return;
    setLoanSaving(true);
    try {
      await apiCall('post', `/media/${item.id}/loans`, loanForm);
      await refreshLoans();
      setLoanForm(buildLoanFormState(item));
      setLoanFormOpen(false);
      onToast?.('Loan recorded');
    } catch (error) {
      onToast?.(error?.response?.data?.error || 'Failed to record loan', 'error');
    } finally {
      setLoanSaving(false);
    }
  };

  const markLoanReturned = async (loanId) => {
    if (!loanId || loanSaving) return;
    setLoanSaving(true);
    try {
      await apiCall('patch', `/media/loans/${loanId}/return`, {
        returned_at: new Date().toISOString().slice(0, 10)
      });
      await refreshLoans();
      onToast?.('Loan marked returned');
    } catch (error) {
      onToast?.(error?.response?.data?.error || 'Failed to mark loan returned', 'error');
    } finally {
      setLoanSaving(false);
    }
  };

  const sendLoanReminder = async (loanId) => {
    if (!loanId || loanReminderSending) return;
    setLoanReminderSending(true);
    try {
      await apiCall('post', `/media/loans/${loanId}/reminder`, {});
      await refreshLoans();
      onToast?.('Reminder sent');
    } catch (error) {
      onToast?.(error?.response?.data?.error || 'Failed to send reminder', 'error');
    } finally {
      setLoanReminderSending(false);
    }
  };

  const refreshValuation = async () => {
    if (!item?.id || valuationRefreshing) return;
    setValuationRefreshing(true);
    try {
      const payload = await apiCall('post', `/media/${item.id}/valuation-refresh`, {});
      if (payload?.queued && payload?.job_id) {
        const startedAt = Date.now();
        let finalJob = null;
        while (Date.now() - startedAt < 30000) {
          // eslint-disable-next-line no-await-in-loop
          const job = await apiCall('get', `/media/sync-jobs/${payload.job_id}`);
          const status = String(job?.status || '').toLowerCase();
          if (status === 'succeeded') {
            finalJob = job;
            break;
          }
          if (status === 'failed') {
            throw new Error(job?.error || 'Valuation refresh failed');
          }
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        if (!finalJob) {
          throw new Error('Timed out waiting for valuation refresh');
        }
      }
      await onValuationUpdated?.(item.id);
      onToast?.('Valuation refreshed');
    } catch (error) {
      onToast?.(error?.response?.data?.error || error?.message || 'Valuation refresh failed', 'error');
    } finally {
      setValuationRefreshing(false);
    }
  };

  const writePlexRating = async () => {
    if (!item?.id || plexWritebackLoading) return;
    setPlexWritebackLoading('rating');
    try {
      const numericRating = Number(item.user_rating);
      const payload = { mediaId: item.id };
      if (Number.isFinite(numericRating)) payload.rating = numericRating;
      await apiCall('post', '/media/write-plex-rating', payload);
      await onValuationUpdated?.(item.id);
      onToast?.('Plex rating updated');
    } catch (error) {
      onToast?.(error?.response?.data?.error || 'Failed to update Plex rating', 'error');
    } finally {
      setPlexWritebackLoading('');
    }
  };

  const writePlexWatchState = async (action, options = {}) => {
    if (!item?.id || plexWritebackLoading) return;
    const seasonNumber = Number(options.seasonNumber);
    const loadingKey = Number.isInteger(seasonNumber) && seasonNumber > 0
      ? `${action}:season:${seasonNumber}`
      : action;
    setPlexWritebackLoading(loadingKey);
    try {
      const payload = {
        mediaId: item.id,
        action
      };
      if (Number.isInteger(seasonNumber) && seasonNumber > 0) payload.seasonNumber = seasonNumber;
      const response = await apiCall('post', '/media/write-plex-watch-state', payload);
      await onValuationUpdated?.(item.id);
      const episodeCount = Number(response?.episodeWriteback?.episodeCount || 0);
      const seasonLabel = Number.isInteger(seasonNumber) && seasonNumber > 0 ? ` season ${seasonNumber}` : '';
      onToast?.(episodeCount > 0
        ? `${episodeCount} Plex episode${episodeCount === 1 ? '' : 's'} updated for${seasonLabel || ' this series'}`
        : (action === 'scrobble' ? 'Marked watched in Plex' : 'Marked unwatched in Plex'));
    } catch (error) {
      onToast?.(error?.response?.data?.error || 'Failed to update Plex watched state', 'error');
    } finally {
      setPlexWritebackLoading('');
    }
  };

  const loadKavitaWritebackPreview = async () => {
    if (!item?.id || kavitaPreviewLoading) return;
    setKavitaPreviewLoading(true);
    try {
      const payload = await apiCall('post', `/media/${item.id}/kavita-writeback-preview`, { target: 'auto' });
      const preview = payload?.preview || null;
      setKavitaPreview(preview);
      setKavitaSelectedFields(Array.isArray(preview?.changedFields) ? preview.changedFields : []);
      onToast?.('Kavita preview loaded');
    } catch (error) {
      setKavitaPreview(null);
      setKavitaSelectedFields([]);
      onToast?.(error?.response?.data?.error || 'Failed to preview Kavita metadata', 'error');
    } finally {
      setKavitaPreviewLoading(false);
    }
  };

  const applyKavitaWriteback = async () => {
    if (!item?.id || kavitaApplyLoading) return;
    const changedFieldSet = new Set(Array.isArray(kavitaPreview?.changedFields) ? kavitaPreview.changedFields : []);
    const selectedFields = kavitaSelectedFields.filter((field) => changedFieldSet.has(field));
    if (selectedFields.length === 0) {
      onToast?.('Select at least one changed Kavita field to apply', 'error');
      return;
    }
    setKavitaApplyLoading(true);
    try {
      const payload = await apiCall('post', `/media/${item.id}/kavita-writeback-apply`, {
        target: kavitaPreview?.target || 'auto',
        selectedFields,
        confirm: true
      });
      const preview = payload?.preview || null;
      setKavitaPreview(preview);
      setKavitaSelectedFields(Array.isArray(preview?.changedFields) ? preview.changedFields : []);
      onToast?.(`Applied ${selectedFields.length} Kavita metadata field${selectedFields.length === 1 ? '' : 's'}`);
    } catch (error) {
      onToast?.(error?.response?.data?.error || 'Failed to apply Kavita metadata', 'error');
    } finally {
      setKavitaApplyLoading(false);
    }
  };

  const formatKavitaPreviewValue = (value) => {
    if (value === null || value === undefined || value === '') return '—';
    if (Array.isArray(value)) return value.length ? value.map((entry) => String(entry)).join(', ') : '—';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };

  const toggleKavitaSelectedField = (field) => {
    setKavitaSelectedFields((prev) => (
      prev.includes(field)
        ? prev.filter((entry) => entry !== field)
        : [...prev, field]
    ));
  };

  const loadKavitaProgress = async () => {
    if (!item?.id || kavitaProgressLoading) return;
    setKavitaProgressLoading(true);
    try {
      const payload = await apiCall('get', `/media/${item.id}/kavita-progress`);
      setKavitaProgress(payload?.progress || null);
      onToast?.('Kavita progress loaded');
    } catch (error) {
      setKavitaProgress(null);
      onToast?.(error?.response?.data?.error || 'Failed to read Kavita progress', 'error');
    } finally {
      setKavitaProgressLoading(false);
    }
  };

  const loadKavitaReaderInfo = async () => {
    if (!item?.id || kavitaReaderLoading) return;
    setKavitaReaderLoading(true);
    setKavitaReaderError('');
    try {
      const payload = await apiCall('get', `/media/${item.id}/kavita-reader-info?includeDimensions=true`);
      const reader = payload?.reader || null;
      setKavitaReaderInfo(reader);
      const progressPage = Number(kavitaProgress?.pageNum);
      if (Number.isInteger(progressPage) && progressPage >= 0) {
        setKavitaReaderPage(progressPage);
      }
      onToast?.('Kavita reader page loaded');
    } catch (error) {
      setKavitaReaderInfo(null);
      const message = error?.response?.data?.error || 'Failed to load Kavita reader page';
      setKavitaReaderError(message);
      onToast?.(message, 'error');
    } finally {
      setKavitaReaderLoading(false);
    }
  };

  const saveKavitaProgress = async () => {
    if (!item?.id || kavitaProgressSaving) return;
    setKavitaProgressSaving(true);
    try {
      const payload = await apiCall('post', `/media/${item.id}/kavita-progress`, {
        pageNum: kavitaReaderPage,
        bookScrollId: kavitaProgress?.bookScrollId || null,
        confirm: true
      });
      setKavitaProgress(payload?.progress || null);
      onToast?.('Kavita progress saved');
    } catch (error) {
      onToast?.(error?.response?.data?.error || 'Failed to save Kavita progress', 'error');
    } finally {
      setKavitaProgressSaving(false);
    }
  };

  const markKavitaChapterRead = async () => {
    if (!item?.id || kavitaMarkReadSaving) return;
    setKavitaMarkReadSaving(true);
    try {
      await apiCall('post', `/media/${item.id}/kavita-read-state`, {
        generateReadingSession: false,
        confirm: true
      });
      onToast?.('Kavita chapter marked read');
    } catch (error) {
      onToast?.(error?.response?.data?.error || 'Failed to mark Kavita chapter read', 'error');
    } finally {
      setKavitaMarkReadSaving(false);
    }
  };

  const resetKavitaProgress = async () => {
    if (!item?.id || kavitaProgressResetting) return;
    setKavitaProgressResetting(true);
    try {
      const payload = await apiCall('post', `/media/${item.id}/kavita-reset-progress`, {
        confirm: true
      });
      setKavitaProgress(payload?.progress || null);
      setKavitaReaderPage(0);
      onToast?.('Kavita progress reset');
    } catch (error) {
      onToast?.(error?.response?.data?.error || 'Failed to reset Kavita progress', 'error');
    } finally {
      setKavitaProgressResetting(false);
    }
  };

  const formatKavitaProgressTimestamp = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return raw;
    return parsed.toLocaleString();
  };

  const kavitaProgressRows = kavitaProgress ? [
    ['Page', kavitaProgress.pageNum],
    ['Chapter', kavitaProgress.chapterId],
    ['Series', kavitaProgress.seriesId],
    ['Volume', kavitaProgress.volumeId],
    ['Scroll', kavitaProgress.bookScrollId],
    ['Updated', formatKavitaProgressTimestamp(kavitaProgress.lastModifiedUtc)]
  ].filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '') : [];
  const kavitaReaderTotalPages = Number(kavitaReaderInfo?.pages || 0);
  const kavitaReaderPageUrl = item?.id && kavitaReaderInfo
    ? `/api/media/${item.id}/kavita-reader-page?page=${encodeURIComponent(String(kavitaReaderPage))}`
    : '';
  const kavitaReaderDisplayPage = kavitaReaderPage + 1;
  const kavitaProgressPageNumber = Number(kavitaProgress?.pageNum);
  const kavitaProgressDisplayPage = Number.isInteger(kavitaProgressPageNumber) && kavitaProgressPageNumber >= 0
    ? kavitaProgressPageNumber + 1
    : null;
  const kavitaReaderTotalLabel = kavitaReaderTotalPages > 0 ? String(kavitaReaderTotalPages) : '—';
  const setBoundedKavitaReaderPage = (nextPage) => {
    const numeric = Number(nextPage);
    if (!Number.isInteger(numeric)) return;
    const maxPage = kavitaReaderTotalPages > 0 ? Math.max(0, kavitaReaderTotalPages - 1) : numeric;
    setKavitaReaderPage(Math.max(0, Math.min(maxPage, numeric)));
  };
  const setKavitaReaderDisplayPage = (nextPage) => {
    const numeric = Number(nextPage);
    if (!Number.isInteger(numeric)) return;
    setBoundedKavitaReaderPage(numeric - 1);
  };

  useEffect(() => {
    if (!kavitaReaderPageUrl) {
      setKavitaReaderImageStatus('idle');
      return;
    }
    setKavitaReaderImageStatus('loading');
  }, [kavitaReaderPageUrl]);

  const markSeasonWatched = async (seasonNumber) => {
    if (!item?.id || !Number.isInteger(Number(seasonNumber))) return;
    const key = Number(seasonNumber);
    setSeasonSaving((prev) => ({ ...prev, [key]: true }));
    try {
      const payload = {
        watch_state: 'completed',
        last_watched_at: new Date().toISOString()
      };
      const result = await apiCall('patch', `/media/${item.id}/tv-seasons/${key}`, payload);
      const updated = result?.season;
      if (updated) {
        setVariants((prev) => prev.map((row) => (
          Number(row.season_number) === key
            ? { ...row, ...updated, edition: `Season ${updated.season_number}` }
            : row
        )));
        setSeasonDrafts((prev) => ({
          ...prev,
          [key]: {
            ...(prev[key] || {}),
            watch_state: 'completed'
          }
        }));
      }
    } catch {
      // no-op toast surface here; Activity log captures errors
    } finally {
      setSeasonSaving((prev) => ({ ...prev, [key]: false }));
    }
  };

  const loadSeasonDetail = async (seasonNumber, { force = false } = {}) => {
    if (!item?.id || !Number.isInteger(Number(seasonNumber))) return;
    const key = Number(seasonNumber);
    setOpenSeason(key);
    if (seasonDetails[key] && !force) return;
    setSeasonDetailLoading((prev) => ({ ...prev, [key]: true }));
    try {
      const payload = await apiCall('get', `/media/${item.id}/tv-seasons/${key}`);
      if (payload?.season) {
        setVariants((prev) => prev.map((row) => (
          Number(row.season_number) === key
            ? { ...row, ...payload.season, edition: `Season ${payload.season.season_number}` }
            : row
        )));
      }
      setSeasonDetails((prev) => ({ ...prev, [key]: payload || null }));
    } catch {
      setSeasonDetails((prev) => ({ ...prev, [key]: null }));
    } finally {
      setSeasonDetailLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  useEffect(() => {
    if (!item?.id) {
      setVariants([]);
      setVariantLoading(false);
      setMergeDetails(null);
      setMergeDetailsLoading(false);
      setOpenMergeEntryId(null);
      setSeasonDrafts({});
      setSeasonSaving({});
      setOpenSeason(null);
      setSeasonDetailLoading({});
      setSeasonDetails({});
      setLoanHistory([]);
      setLoanLoading(false);
      setLoanSaving(false);
      setLoanReminderSending(false);
      setShowLoanItemDetails(false);
      setLoanFormOpen(false);
      setLoanForm(buildLoanFormState({}));
      return;
    }
    let active = true;
    setVariantLoading(true);
    apiCall('get', `/media/${item.id}/variants`)
      .then((rows) => {
        if (!active) return;
        const nextRows = Array.isArray(rows) ? rows : [];
        setVariants(nextRows);
        if (item.media_type === 'tv_series') {
          const nextDrafts = {};
          nextRows.forEach((row) => {
            const seasonNum = Number(row.season_number);
            if (!Number.isInteger(seasonNum) || seasonNum <= 0) return;
            nextDrafts[seasonNum] = {
              watch_state: row.watch_state || 'unwatched',
              is_complete: Boolean(row.is_complete),
              watchlist: Boolean(row.watchlist)
            };
          });
          setSeasonDrafts(nextDrafts);
          const firstSeason = nextRows
            .map((row) => Number(row.season_number))
            .find((seasonNum) => Number.isInteger(seasonNum) && seasonNum > 0);
          setOpenSeason((prev) => (Number.isInteger(prev) && nextDrafts[prev] ? prev : (firstSeason || null)));
        }
      })
      .catch(() => { if (active) setVariants([]); })
      .finally(() => { if (active) setVariantLoading(false); });
    return () => { active = false; };
  }, [apiCall, item?.id, item?.media_type]);

  useEffect(() => {
    if (!item?.id) {
      setMergeDetails(null);
      setMergeDetailsLoading(false);
      setOpenMergeEntryId(null);
      return;
    }
    let active = true;
    setMergeDetailsLoading(true);
    apiCall('get', `/media/${item.id}/merge-details`)
      .then((payload) => {
        if (!active) return;
        setMergeDetails(payload || null);
      })
      .catch(() => {
        if (!active) return;
        setMergeDetails(null);
      })
      .finally(() => {
        if (active) setMergeDetailsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [apiCall, item?.id]);

  useEffect(() => {
    setComicOverviewExpanded(false);
  }, [item?.id, item?.overview]);

  useEffect(() => {
    setLoanForm(buildLoanFormState(item));
    setShowLoanItemDetails(false);
    setLoanFormOpen(false);
  }, [item?.id]);

  useEffect(() => {
    if (!item?.id) return;
    void refreshLoans();
  }, [item?.id, refreshLoans]);

  useEffect(() => {
    if (item?.media_type !== 'tv_series' || !Number.isInteger(openSeason) || seasonDetails[openSeason] || seasonDetailLoading[openSeason]) return;
    loadSeasonDetail(openSeason);
  }, [item?.media_type, openSeason, seasonDetails, seasonDetailLoading]);

  const tvSeasonVariants = variants
    .filter((v) => Boolean(v.edition))
    .sort((a, b) => Number(a.season_number || 0) - Number(b.season_number || 0));
  const activeSeasonVariant = item?.media_type === 'tv_series'
    ? tvSeasonVariants.find((row) => Number(row.season_number) === openSeason) || tvSeasonVariants[0] || null
    : null;

  if (!item) return null;

  return (
    <DetailDrawerShell onClose={onClose} panelClassName={isBook ? 'max-w-2xl' : 'max-w-xl'} testId="media-detail-drawer">
        <DrawerBackdrop
          imagePath={item.backdrop_path || item.poster_path}
          className="h-48 border-b border-edge/60 bg-panel"
          imageClassName="w-full h-full object-cover"
          renderWhenEmpty
          testId="media-detail-backdrop"
        />

        <div className="flex items-start gap-4 px-4 pt-4 pb-3 shrink-0 sm:px-6 sm:pt-6 sm:pb-4">
          <div className="w-20 shrink-0 -mt-16 relative z-10 shadow-card">
            <div className="poster rounded-md">
              {posterUrl(item.poster_path)
                ? <img src={posterUrl(item.poster_path)} alt={item.title} className="absolute inset-0 w-full h-full object-cover" />
                : <div className="absolute inset-0 flex items-center justify-center text-ghost"><Icons.Film /></div>}
            </div>
          </div>
          <div className="flex-1 min-w-0 mt-1">
            <div className="flex items-baseline gap-2">
              <h2 className={titleClassName}>{item.title}</h2>
              {!isComic ? <p className="text-sm text-ghost">#{item.id}</p> : null}
            </div>
            <p className="text-sm text-dim mt-1">{[item.year, item.director, item.cast].filter(Boolean).join(' · ')}</p>
            <div className="flex flex-wrap gap-2 mt-2">
              {getOwnedFormatSummary(item).map((formatLabel) => <span key={formatLabel} className="badge badge-gold">{formatLabel}</span>)}
              {item.media_type && <span className="badge badge-dim">{mediaTypeLabel(item.media_type)}</span>}
              {item.genre?.split(',').slice(0, 2).map((g) => <span key={g} className="badge badge-dim">{g.trim()}</span>)}
            </div>
            {activeLoan ? (
              <p className={cx(
                'mt-3 text-sm',
                activeLoan.is_overdue ? 'text-err' : 'text-gold'
              )}>
                {activeLoan.is_overdue ? 'Loaned out · overdue' : 'Loaned out'}
                {' · '}
                {activeLoan.borrower_name || 'Borrower'}
                {' · Due '}
                {formatDate(activeLoan.due_at)}
              </p>
            ) : null}
          </div>
          <button onClick={onClose} className="btn-icon btn-sm shrink-0"><Icons.X /></button>
        </div>

        <div className="divider" />

        <div className="flex-1 overflow-y-auto scroll-area p-6 space-y-6">
          {!showLoanFocusedView && item.overview && (
            <div className={cx(isBook || isComic ? 'max-w-3xl' : '')}>
              <p className="label mb-2">Overview</p>
              <p
                className={cx('text-sm text-dim leading-relaxed', isBook ? 'leading-7' : '')}
                style={comicOverviewNeedsClamp && !comicOverviewExpanded
                  ? {
                      display: '-webkit-box',
                      WebkitBoxOrient: 'vertical',
                      WebkitLineClamp: 6,
                      overflow: 'hidden'
                    }
                  : undefined}
              >
                {item.overview}
              </p>
              {comicOverviewNeedsClamp ? (
                <button
                  type="button"
                  className="mt-2 text-sm font-medium text-dim transition-colors hover:text-ink"
                  onClick={() => setComicOverviewExpanded((value) => !value)}
                >
                  {comicOverviewExpanded ? 'Show less' : 'Show more'}
                </button>
              ) : null}
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="label">Loans</p>
                <p className="mt-1 text-sm text-ghost">
                  {activeLoan
                    ? `Currently loaned to ${activeLoan.borrower_name || 'Borrower'}`
                    : 'Record when this title leaves the shelf and when it should come back.'}
                </p>
              </div>
              {!activeLoan ? (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setLoanFormOpen((value) => !value)}
                  disabled={loanSaving}
                >
                  {loanFormOpen ? 'Hide Loan Form' : 'Loan Out'}
                </button>
              ) : (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => setShowLoanItemDetails((value) => !value)}
                  >
                    {showLoanItemDetails ? 'Hide Details' : 'Show Details'}
                  </button>
                  {activeLoan.reminder_eligible ? (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => sendLoanReminder(activeLoan.id)}
                      disabled={loanReminderSending}
                    >
                      <Icons.Mail />
                      {loanReminderSending ? 'Sending…' : 'Send Reminder'}
                    </button>
                  ) : (
                    <div className="inline-flex h-9 items-center gap-2 px-1 text-sm text-dim">
                      <Icons.Mail />
                      <span>
                        {!activeLoan.borrower_email
                          ? 'Add email to send reminder'
                          : activeLoan.reminder_sent_today
                            ? 'Reminder sent today'
                            : loanReminderLabel(activeLoan)}
                      </span>
                    </div>
                  )}
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => markLoanReturned(activeLoan.id)}
                    disabled={loanSaving || loanLoading}
                  >
                    <Icons.Check />
                    {loanSaving ? 'Returning…' : 'Mark Returned'}
                  </button>
                </div>
              )}
            </div>

            {loanLoading ? (
              <div className="flex items-center gap-2 text-sm text-ghost"><Spinner size={16} />Loading loans…</div>
            ) : null}

            {activeLoan ? (
              <div className={cx(
                'rounded-lg border bg-panel px-4 py-4',
                activeLoan.is_overdue ? 'border-err/30' : 'border-edge'
              )}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cx(
                        'badge',
                        activeLoan.is_overdue
                          ? 'border border-err/25 bg-err/10 text-err'
                          : 'border border-edge/70 bg-abyss text-dim'
                      )}>
                        {activeLoan.is_overdue ? 'Overdue' : 'Active'}
                      </span>
                      <p className="text-sm font-medium text-ink">{activeLoan.borrower_name || 'Borrower'}</p>
                    </div>
                    {activeLoan.borrower_email ? <p className="mt-1 text-sm text-dim">{activeLoan.borrower_email}</p> : null}
                  </div>
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
                    <div>
                      <dt className="text-xs font-medium text-ghost">Loaned</dt>
                      <dd className="mt-1 text-ink">{formatDate(activeLoan.loaned_at)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium text-ghost">Due Back</dt>
                      <dd className="mt-1 text-ink">{formatDate(activeLoan.due_at)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium text-ghost">Format</dt>
                      <dd className="mt-1 text-ink">{activeLoan.loan_format || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium text-ghost">Reminder</dt>
                      <dd className="mt-1 text-ink">{loanReminderLabel(activeLoan)}</dd>
                      {activeLoan.reminder_last_sent_at ? (
                        <p className="mt-1 text-xs text-dim">Last sent {formatReminderTimestamp(activeLoan.reminder_last_sent_at)}</p>
                      ) : null}
                    </div>
                  </dl>
                </div>
                {activeLoan.notes ? <p className="mt-3 text-sm text-dim">{activeLoan.notes}</p> : null}
                {!activeLoan.borrower_email ? (
                  <p className="mt-3 text-sm text-dim">Add borrower email to send reminders.</p>
                ) : null}
                <ReminderHistorySummary events={activeLoan.reminder_events} />
              </div>
            ) : null}

            {loanFormOpen ? (
              <form className="rounded-lg border border-edge bg-panel px-4 py-4" onSubmit={submitLoan}>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-ghost">Borrower</span>
                    <input
                      className="input w-full"
                      value={loanForm.borrower_name}
                      onChange={(event) => setLoanForm((current) => ({ ...current, borrower_name: event.target.value }))}
                      required
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-ghost">Borrower Email</span>
                    <input
                      className="input w-full"
                      type="email"
                      value={loanForm.borrower_email}
                      onChange={(event) => setLoanForm((current) => ({ ...current, borrower_email: event.target.value }))}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-ghost">Loaned On</span>
                    <input
                      className="input w-full"
                      type="date"
                      value={loanForm.loaned_at}
                      onChange={(event) => setLoanForm((current) => ({
                        ...current,
                        loaned_at: event.target.value,
                        due_at: current.due_at && current.due_at >= event.target.value ? current.due_at : addDaysToIsoDate(event.target.value, 14)
                      }))}
                      required
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-ghost">Due Back</span>
                    <input
                      className="input w-full"
                      type="date"
                      value={loanForm.due_at}
                      onChange={(event) => setLoanForm((current) => ({ ...current, due_at: event.target.value }))}
                      required
                    />
                  </label>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,220px),1fr]">
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-ghost">Loan Format</span>
                    <input
                      className="input w-full"
                      value={loanForm.loan_format}
                      onChange={(event) => setLoanForm((current) => ({ ...current, loan_format: event.target.value }))}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-ghost">Notes</span>
                    <input
                      className="input w-full"
                      value={loanForm.notes}
                      onChange={(event) => setLoanForm((current) => ({ ...current, notes: event.target.value }))}
                    />
                  </label>
                </div>
                <div className="mt-4 flex items-center justify-end gap-2">
                  <button type="button" className="btn-secondary" onClick={() => setLoanFormOpen(false)} disabled={loanSaving}>Cancel</button>
                  <button type="submit" className="btn-primary" disabled={loanSaving}>
                    {loanSaving ? 'Saving…' : 'Save Loan'}
                  </button>
                </div>
              </form>
            ) : null}

            {!loanLoading && loanHistory.length > 0 ? (
              <div className="pt-1">
                <p className="text-sm text-dim">History</p>
                <div className="mt-3 space-y-0">
                  {loanHistory.slice(0, 3).map((loan) => (
                    <div key={loan.id} className="flex items-start justify-between gap-3 border-t border-edge/70 py-3 first:border-t-0 first:pt-0">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-ink">{loan.borrower_name || 'Borrower'}</p>
                        <p className="mt-1 text-sm text-ghost">
                          {formatDate(loan.loaned_at)} to {loan.returned_at ? formatDate(loan.returned_at) : formatDate(loan.due_at)}
                        </p>
                        <ReminderHistorySummary events={loan.reminder_events} className="mt-2 pt-0" />
                      </div>
                      <span className={cx(
                        'badge shrink-0',
                        loan.returned_at ? 'border border-edge/70 bg-abyss text-dim' : 'border border-gold/25 bg-gold/10 text-gold'
                      )}>
                        {loan.returned_at ? 'Returned' : (loan.is_overdue ? 'Overdue' : 'Out')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {!showLoanFocusedView ? (
          <>
          <div className="grid grid-cols-2 gap-4 text-sm">
            {[
              ['Runtime', item.runtime ? `${item.runtime} min` : null],
              ['Rating', item.rating ? `${item.rating} / 10` : null],
              ['Release', item.release_date ? String(item.release_date).slice(0, 10) : null],
              ['UPC', item.upc],
              ['Cast', item.cast],
              ['Signed by', item.signed_by],
              ['Signed as', item.signed_role],
              ['Signed on', item.signed_on ? String(item.signed_on).slice(0, 10) : null],
              ['Signed at', item.signed_at],
              ['Location', item.location]
            ].filter(([, v]) => v).map(([k, v]) => (
              <div key={k}><p className="label">{k}</p><p className="text-ink">{v}</p></div>
            ))}
          </div>

          {hasValuationData && (
            <div>
              <div className="mb-2 flex items-center gap-3">
                <p className="label">Valuation</p>
                <button
                  type="button"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ghost transition-colors hover:bg-raised/70 hover:text-ink disabled:cursor-default disabled:opacity-50"
                  onClick={refreshValuation}
                  disabled={valuationRefreshing}
                  aria-label="Refresh valuation"
                  title="Refresh valuation"
                >
                  {valuationRefreshing ? <Spinner size={14} /> : <Icons.Refresh />}
                </button>
              </div>
              {valuationSummaryRows.length > 0 ? (
                <div className="grid grid-cols-3 gap-4 border-b border-edge/60 pb-3">
                  {valuationSummaryRows.map(([label, value]) => (
                    <div key={label} className="min-w-0">
                      <p className="text-[11px] font-medium text-ghost">{label}</p>
                      <p className="mt-1 truncate text-sm font-medium text-ink">{value}</p>
                    </div>
                  ))}
                </div>
              ) : null}
              {valuationMetaRows.length > 0 ? (
                <div className="mt-3 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                  {valuationMetaRows.map(([label, value]) => (
                    <div key={label}>
                      <p className="label">{label}</p>
                      <p className="text-ink">{value}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )}
          {!hasValuationData && (
            <div>
              <div className="mb-2 flex items-center gap-3">
                <p className="label">Valuation</p>
                <button
                  type="button"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ghost transition-colors hover:bg-raised/70 hover:text-ink disabled:cursor-default disabled:opacity-50"
                  onClick={refreshValuation}
                  disabled={valuationRefreshing}
                  aria-label="Refresh valuation"
                  title="Refresh valuation"
                >
                  {valuationRefreshing ? <Spinner size={14} /> : <Icons.Refresh />}
                </button>
              </div>
              <p className="text-sm text-ghost">No values yet.</p>
            </div>
          )}

          {item.signed_proof_path && (
            <div>
              <p className="label mb-2">Signing proof</p>
              <a
                href={posterUrl(item.signed_proof_path)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 text-sm text-dim transition-colors hover:text-ink"
              >
                <Icons.Link />
                Open proof image
              </a>
            </div>
          )}

          {Array.isArray(item.signatures) && item.signatures.length > 1 && (
            <div>
              <p className="label mb-2">All signatures</p>
              <div className="space-y-2">
                {item.signatures.map((signature) => (
                  <div key={signature.id} className="border-t border-edge/70 pt-2 first:border-t-0 first:pt-0">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm text-dim">
                        {[signature.signer_name, signature.signer_role, signature.signed_on, signature.signed_at].filter(Boolean).join(' · ') || 'Signed copy'}
                      </p>
                      {signature.is_primary ? <span className="badge badge-dim shrink-0">Primary</span> : null}
                    </div>
                    {signature.notes ? <p className="mt-1 text-xs text-ghost">{signature.notes}</p> : null}
                    {Array.isArray(signature.proofs) && signature.proofs.length ? (
                      <div className="mt-1 flex flex-wrap gap-2">
                        {signature.proofs.map((proof, index) => (
                          <a
                            key={proof.id || `${signature.id}:proof:${index}`}
                            href={posterUrl(proof.proof_path)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 text-xs text-dim transition-colors hover:text-ink"
                          >
                            <Icons.Link />
                            {proof.label || proof.proof_type || (proof.is_primary ? 'Primary proof' : `Proof ${index + 1}`)}
                          </a>
                        ))}
                      </div>
                    ) : signature.proof_path ? (
                      <a
                        href={posterUrl(signature.proof_path)}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-2 text-xs text-dim transition-colors hover:text-ink"
                      >
                        <Icons.Link />
                        Open proof image
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          )}

          {isBook && bookDetailRows.length > 0 && (
            <div>
              <p className="label mb-2">Book details</p>
              <div className="grid gap-x-8 gap-y-3 text-sm md:grid-cols-2">
                {bookDetailRows.map(([label, value]) => (
                  <div key={label} className="border-b border-edge/60 pb-3 last:border-b-0">
                    <p className="text-[11px] font-medium text-ghost">{label}</p>
                    <p className="mt-1 text-sm text-ink">{String(value)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!isBook && item.type_details && typeof item.type_details === 'object' && defaultTypeDetailEntries.length > 0 && (
            <div>
              <p className="label mb-2">Type Details</p>
              <div className="grid grid-cols-2 gap-4 text-sm">
                {defaultTypeDetailEntries.map(([k, v]) => (
                  <div key={k}>
                    <p className="label">{k.replace(/_/g, ' ')}</p>
                    <p className="text-ink">{String(v)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <MergeEvidenceSection
            mergeDetailsLoading={mergeDetailsLoading}
            mergeSummary={mergeSummary}
            mergeDisclosureItems={mergeDisclosureItems}
            openMergeEntryId={openMergeEntryId}
            setOpenMergeEntryId={setOpenMergeEntryId}
            itemTitle={item.title}
            formatMergeSourceLabel={formatMergeSourceLabel}
            formatMergeTimestamp={formatMergeTimestamp}
            formatMergeValue={formatMergeValue}
            formatMergeTechnicalLabel={formatMergeTechnicalLabel}
          />

          {isBook && bookSourceLinks.length > 0 && (
            <div>
              <p className="label mb-2">Sources</p>
              <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
                {bookSourceLinks.map(([label, href]) => (
                  <a
                    key={`${label}-${href}`}
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 text-dim transition-colors hover:text-ink"
                  >
                    <Icons.Link />
                    <span>{label}</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {isComic && comicSourceLinks.length > 0 && (
            <div>
              <p className="label mb-2">Sources</p>
              <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
                {comicSourceLinks.map(([label, href]) => (
                  <a
                    key={`${label}-${href}`}
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 text-dim transition-colors hover:text-ink"
                  >
                    <Icons.Link />
                    <span>{label}</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {isKavitaLinked ? (
            <div className="border-t border-edge/60 pt-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="label">Kavita Metadata</p>
                  <p className="mt-1 text-sm text-ghost">Review the diff before writing selected collectZ values to Kavita.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={loadKavitaWritebackPreview}
                    disabled={kavitaPreviewLoading || kavitaApplyLoading}
                  >
                    {kavitaPreviewLoading ? <Spinner size={14} /> : <Icons.Refresh />}
                    {kavitaPreviewLoading ? 'Loading…' : 'Preview Diff'}
                  </button>
                  {kavitaPreview ? (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={applyKavitaWriteback}
                      disabled={kavitaApplyLoading || kavitaPreviewLoading || kavitaSelectedFields.length === 0}
                    >
                      {kavitaApplyLoading ? <Spinner size={14} /> : <Icons.Check />}
                      {kavitaApplyLoading ? 'Applying…' : 'Apply to Kavita'}
                    </button>
                  ) : null}
                </div>
              </div>
              {kavitaPreview ? (
                <div className="mt-4 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <span className="badge badge-dim">{kavitaPreview.target}</span>
                    <span className="badge badge-dim">{(kavitaPreview.changedFields || []).length} changed</span>
                    <span className="badge badge-dim">{kavitaSelectedFields.length} selected</span>
                    {(kavitaPreview.skippedFields || []).length > 0 ? (
                      <span className="badge badge-dim">{kavitaPreview.skippedFields.length} skipped</span>
                    ) : null}
                  </div>
                  {Array.isArray(kavitaPreview.diff) && kavitaPreview.diff.length > 0 ? (
                    <div className="divide-y divide-edge/60 rounded-lg border border-edge bg-panel">
                      {kavitaPreview.diff.slice(0, 8).map((entry) => (
                        <div key={entry.field} className="grid gap-2 px-3 py-3 text-sm sm:grid-cols-[150px,1fr]">
                          <div className="flex items-center gap-2">
                            {entry.changed ? (
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-edge bg-panel text-accent"
                                checked={kavitaSelectedFields.includes(entry.field)}
                                onChange={() => toggleKavitaSelectedField(entry.field)}
                                aria-label={`Apply ${entry.field} to Kavita`}
                              />
                            ) : (
                              <span className="h-4 w-4" aria-hidden="true" />
                            )}
                            <span className={cx('h-2 w-2 rounded-full', entry.changed ? 'bg-gold' : 'bg-ok')} />
                            <span className="min-w-0 break-words font-medium text-ink">{entry.field}</span>
                          </div>
                          <div className="grid gap-2 sm:grid-cols-2">
                            <div>
                              <p className="text-[11px] font-medium text-ghost">Kavita</p>
                              <p className="mt-1 break-words text-dim">{formatKavitaPreviewValue(entry.currentValue)}</p>
                            </div>
                            <div>
                              <p className="text-[11px] font-medium text-ghost">collectZ</p>
                              <p className="mt-1 break-words text-dim">{formatKavitaPreviewValue(entry.proposedValue)}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-ghost">No writable fields have local values to preview.</p>
                  )}
                  {Array.isArray(kavitaPreview.skippedFields) && kavitaPreview.skippedFields.length > 0 ? (
                    <p className="text-xs text-ghost">
                      Skipped {kavitaPreview.skippedFields.map((entry) => `${entry.field}: ${entry.reason}`).join(', ')}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {isKavitaLinked && isKavitaChapterBacked ? (
            <div className="border-t border-edge/60 pt-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="label">Kavita Reader</p>
                  <p className="mt-1 text-sm text-ghost">Chapter page, progress, and read-state controls for the linked Kavita row.</p>
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={loadKavitaProgress}
                  disabled={kavitaProgressLoading}
                >
                  {kavitaProgressLoading ? <Spinner size={14} /> : <Icons.Refresh />}
                  {kavitaProgressLoading ? 'Loading…' : 'Read Progress'}
                </button>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <span className="badge badge-dim">
                  Reader {kavitaReaderInfo ? 'ready' : 'not loaded'}
                </span>
                <span className="badge badge-dim">
                  Page {kavitaReaderInfo ? kavitaReaderDisplayPage : '—'} / {kavitaReaderTotalLabel}
                </span>
                <span className="badge badge-dim">
                  Saved {kavitaProgressDisplayPage ? `page ${kavitaProgressDisplayPage}` : 'not loaded'}
                </span>
                {kavitaReaderImageStatus === 'error' ? (
                  <span className="badge border-err/40 bg-err/10 text-err">Page image failed</span>
                ) : null}
              </div>
              {kavitaProgressRows.length > 0 ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  {kavitaProgressRows.map(([label, value]) => (
                    <div key={label} className="rounded-md border border-edge bg-panel px-3 py-2">
                      <p className="text-[11px] font-medium text-ghost">{label}</p>
                      <p className="mt-1 break-words text-sm text-ink">{String(value)}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-ghost">No Kavita progress has been loaded for this chapter.</p>
              )}
              <div className="mt-5 rounded-md border border-edge bg-panel/70 p-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-sm font-medium text-ink">Page preview</p>
                    <p className="mt-1 text-xs text-ghost">Page images are proxied one at a time; Kavita credentials stay server-side.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={loadKavitaReaderInfo}
                      disabled={kavitaReaderLoading}
                    >
                      {kavitaReaderLoading ? <Spinner size={14} /> : <Icons.Eye />}
                      {kavitaReaderLoading ? 'Loading…' : 'Load Reader'}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={saveKavitaProgress}
                      disabled={kavitaProgressSaving || !kavitaReaderInfo}
                    >
                      {kavitaProgressSaving ? <Spinner size={14} /> : <Icons.Check />}
                      {kavitaProgressSaving ? 'Saving…' : 'Save Progress'}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={resetKavitaProgress}
                      disabled={kavitaProgressResetting}
                    >
                      {kavitaProgressResetting ? <Spinner size={14} /> : <Icons.Refresh />}
                      {kavitaProgressResetting ? 'Resetting…' : 'Reset Progress'}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={markKavitaChapterRead}
                      disabled={kavitaMarkReadSaving}
                    >
                      {kavitaMarkReadSaving ? <Spinner size={14} /> : <Icons.Check />}
                      {kavitaMarkReadSaving ? 'Marking…' : 'Mark Read in Kavita'}
                    </button>
                  </div>
                </div>
                {kavitaReaderError ? (
                  <p className="mt-3 rounded-md border border-err/30 bg-err/10 px-3 py-2 text-sm text-err">{kavitaReaderError}</p>
                ) : null}
                {kavitaReaderInfo ? (
                  <div className="mt-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-edge bg-raised/70 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-ghost">Page</span>
                        <span className="text-sm font-semibold text-ink">{kavitaReaderDisplayPage}</span>
                        <span className="text-xs text-ghost">of {kavitaReaderTotalLabel}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="btn-icon btn-sm"
                        onClick={() => setBoundedKavitaReaderPage(kavitaReaderPage - 1)}
                        disabled={kavitaReaderPage <= 0}
                        aria-label="Previous Kavita page"
                        title="Previous page"
                      >
                        <Icons.ChevronLeft />
                      </button>
                      <label className="flex items-center gap-2 text-xs text-ghost">
                        <span>Go to</span>
                        <input
                          className="input h-8 w-20 px-2 py-1 text-sm"
                          type="number"
                          min="1"
                          max={kavitaReaderTotalPages > 0 ? kavitaReaderTotalPages : undefined}
                          value={kavitaReaderDisplayPage}
                          onChange={(event) => setKavitaReaderDisplayPage(Number(event.target.value))}
                        />
                      </label>
                      <button
                        type="button"
                        className="btn-icon btn-sm"
                        onClick={() => setBoundedKavitaReaderPage(kavitaReaderPage + 1)}
                        disabled={kavitaReaderTotalPages > 0 && kavitaReaderPage >= kavitaReaderTotalPages - 1}
                        aria-label="Next Kavita page"
                        title="Next page"
                      >
                        <Icons.ChevronRight />
                      </button>
                      </div>
                    </div>
                    <div className="relative min-h-[220px] overflow-hidden rounded-md border border-edge bg-black">
                      {kavitaReaderImageStatus === 'loading' ? (
                        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 text-sm text-white">
                          <Spinner size={18} />
                          <span className="ml-2">Loading page…</span>
                        </div>
                      ) : null}
                      {kavitaReaderImageStatus === 'error' ? (
                        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/85 px-4 text-center text-sm text-white">
                          This Kavita page could not be loaded.
                        </div>
                      ) : null}
                      {kavitaReaderPageUrl ? (
                        <img
                          src={kavitaReaderPageUrl}
                          alt={`${item.title || 'Kavita chapter'} page ${kavitaReaderDisplayPage}`}
                          className="mx-auto max-h-[72vh] w-auto max-w-full object-contain"
                          onLoad={() => setKavitaReaderImageStatus('loaded')}
                          onError={() => setKavitaReaderImageStatus('error')}
                        />
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {!isBook && !isComic && (externalMediaUrl || item.trailer_url) && (
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              {externalMediaUrl && (
                <a
                  href={externalMediaUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 text-dim transition-colors hover:text-ink"
                >
                  <Icons.Link />
                  <span>{externalMediaLabel}</span>
                </a>
              )}
              {item.trailer_url && (
                <a
                  href={item.trailer_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 text-dim transition-colors hover:text-ink"
                >
                  <Icons.Play />
                  <span>Trailer</span>
                </a>
              )}
            </div>
          )}

          {isBook ? (
            <div className="grid gap-6 border-t border-edge/60 pt-5 md:grid-cols-[minmax(0,1fr)_220px]">
              <div>
                <p className="label mb-2">Editions</p>
                {variantLoading && <p className="text-sm text-ghost">Loading variants…</p>}
                {!variantLoading && variants.length === 0 && (
                  <p className="text-sm text-ghost">No edition data yet</p>
                )}
                {!variantLoading && variants.length > 0 && (
                  <div className="space-y-2">
                    {variants
                      .filter((v) => Boolean(v.edition))
                      .map((v) => (
                        <div key={v.id} className="border-b border-edge/60 pb-2 last:border-b-0">
                          <p className="text-sm font-medium text-ink">{v.edition || 'Default edition'}</p>
                          <p className="mt-1 text-xs text-ghost">{[v.resolution, v.container, v.video_codec, v.audio_codec, v.audio_channels ? `${v.audio_channels}ch` : null].filter(Boolean).join(' · ')}</p>
                          {v.file_path ? <p className="mt-1 break-all font-mono text-[11px] text-ghost/80">{v.file_path}</p> : null}
                        </div>
                      ))}
                  </div>
                )}
              </div>

              <div className="space-y-5">
                <div>
                  <p className="label mb-2">Your Rating</p>
                  <StarRating value={userRatingToStars(item.user_rating)} onChange={(r) => onRating(item.id, starsToUserRating(r))} />
                  {showPlexWritebackControls ? (
                    <PlexWritebackControls
                      item={item}
                      loading={plexWritebackLoading}
                      onWriteRating={writePlexRating}
                      onWriteWatchState={writePlexWatchState}
                    />
                  ) : null}
                </div>
                {item.notes ? (
                  <div>
                    <p className="label mb-1">Notes</p>
                    <p className="text-sm text-dim">{item.notes}</p>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              <div>
                <p className="label mb-2">{item.media_type === 'tv_series' ? 'Seasons' : 'Editions'}</p>
                {variantLoading && <p className="text-sm text-ghost">Loading variants…</p>}
                {!variantLoading && variants.length === 0 && (
                  <p className="text-sm text-ghost">{item.media_type === 'tv_series' ? 'No season data yet' : 'No edition data yet'}</p>
                )}
                {!variantLoading && variants.length > 0 && (
                  item.media_type === 'tv_series' ? (
                    <div className="space-y-4">
                      <div className="overflow-x-auto no-scrollbar border-b border-edge/70">
                        <div className="flex min-w-full gap-4 whitespace-nowrap">
                          {tvSeasonVariants.map((v) => {
                            const seasonKey = Number(v.season_number);
                            const isActive = seasonKey === (activeSeasonVariant ? Number(activeSeasonVariant.season_number) : null);
                            return (
                              <button
                                key={v.id}
                                type="button"
                                className={cx(
                                  'inline-flex items-center gap-2 border-b-2 px-0 py-2 text-sm transition-colors',
                                  isActive
                                    ? 'border-brand text-ink'
                                    : 'border-transparent text-dim hover:text-ink'
                                )}
                                onClick={() => loadSeasonDetail(seasonKey)}
                              >
                                <span>{`S${seasonKey}`}</span>
                                {v.watch_state === 'completed' ? (
                                  <span className="text-ok" aria-label="Watched" title="Watched">
                                    <Icons.Check />
                                  </span>
                                ) : null}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      {activeSeasonVariant && (() => {
                        const key = Number(activeSeasonVariant.season_number);
                        const details = seasonDetails[key];
                        const tmdbEpisodeCount = Number(details?.tmdb?.episode_count);
                        const tmdbDerivedCount = Array.isArray(details?.tmdb?.episodes)
                          ? details.tmdb.episodes.length
                          : null;
                        const expectedEpisodes = Number.isFinite(Number(activeSeasonVariant.expected_episodes))
                          && Number(activeSeasonVariant.expected_episodes) > 0
                          ? Number(activeSeasonVariant.expected_episodes)
                          : ((Number.isFinite(tmdbEpisodeCount) && tmdbEpisodeCount > 0)
                            ? tmdbEpisodeCount
                            : ((Number.isInteger(tmdbDerivedCount) && tmdbDerivedCount > 0) ? tmdbDerivedCount : null));
                        const ownedEpisodes = Number.isFinite(Number(activeSeasonVariant.available_episodes)) ? Number(activeSeasonVariant.available_episodes) : null;
                        const episodesLabel = ownedEpisodes !== null
                          ? `Episodes ${ownedEpisodes}/${expectedEpisodes ?? '?'}`
                          : `Episodes ?/${expectedEpisodes ?? '?'}`;
                        return (
                          <div className="space-y-3 pt-1">
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0">
                                <p className="mt-1 text-xs text-ghost">
                                  {[episodesLabel, expectedEpisodes !== null && ownedEpisodes !== null && ownedEpisodes < expectedEpisodes ? 'Missing episodes' : null].filter(Boolean).join(' · ')}
                                </p>
                                <p className="mt-1 text-xs text-ghost">
                                  {[
                                    details?.tmdb?.air_date ? `Air date: ${details.tmdb.air_date}` : null,
                                    Number.isFinite(tmdbEpisodeCount) && tmdbEpisodeCount > 0 ? `TMDB episodes: ${tmdbEpisodeCount}` : null
                                  ].filter(Boolean).join(' · ') || 'No TMDB season metadata available'}
                                </p>
                              </div>
                              <div className="flex shrink-0 flex-wrap justify-end gap-2">
                                <button
                                  type="button"
                                  className="text-sm font-medium text-dim transition-colors hover:text-ink disabled:cursor-default disabled:opacity-50"
                                  onClick={() => markSeasonWatched(key)}
                                  disabled={Boolean(seasonSaving[key]) || activeSeasonVariant.watch_state === 'completed'}
                                >
                                  {seasonSaving[key] ? <Spinner size={14} /> : null}
                                  {seasonSaving[key] ? 'Saving…' : 'Mark season watched'}
                                </button>
                                {showPlexWritebackControls ? (
                                  <>
                                    <button
                                      type="button"
                                      className="btn-secondary btn-sm"
                                      onClick={() => writePlexWatchState('scrobble', { seasonNumber: key })}
                                      disabled={Boolean(plexWritebackLoading)}
                                      data-testid="plex-season-watch-scrobble-button"
                                    >
                                      {plexWritebackLoading === `scrobble:season:${key}` ? <Spinner size={14} /> : <Icons.Check />}
                                      Plex watched
                                    </button>
                                    <button
                                      type="button"
                                      className="btn-secondary btn-sm"
                                      onClick={() => writePlexWatchState('unscrobble', { seasonNumber: key })}
                                      disabled={Boolean(plexWritebackLoading)}
                                      data-testid="plex-season-watch-unscrobble-button"
                                    >
                                      {plexWritebackLoading === `unscrobble:season:${key}` ? <Spinner size={14} /> : <Icons.Refresh />}
                                      Plex unwatched
                                    </button>
                                  </>
                                ) : null}
                              </div>
                            </div>
                            {seasonDetailLoading[key] && (
                              <p className="text-xs text-ghost">Loading season metadata…</p>
                            )}
                            {!seasonDetailLoading[key] && Array.isArray(details?.tmdb?.episodes) && details.tmdb.episodes.length > 0 ? (
                              <div className="max-h-48 overflow-auto pr-1 space-y-1">
                                {details.tmdb.episodes.map((episode) => (
                                  <div key={episode.id || `ep-${episode.episode_number}`} className="text-xs text-dim">
                                    <span className="text-ink">E{episode.episode_number}:</span> {episode.name || 'Untitled'}
                                    {episode.watched
                                      ? <span className="text-ok"> · watched</span>
                                      : <span className="text-brand-300"> · unwatched</span>}
                                    {episode.in_library ? <span className="text-ghost"> · in library</span> : null}
                                    {episode.air_date ? <span className="text-ghost"> · {episode.air_date}</span> : null}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        );
                      })()}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {variants
                        .filter((v) => Boolean(v.edition))
                        .map((v) => (
                          <div key={v.id} className="card p-3">
                            <p className="text-sm text-ink font-medium flex items-center gap-2">
                              <span>{v.edition || (item.media_type === 'movie' ? 'Theatrical' : 'Default edition')}</span>
                            </p>
                            <p className="text-xs text-ghost mt-1">{[v.resolution, v.container, v.video_codec, v.audio_codec, v.audio_channels ? `${v.audio_channels}ch` : null].filter(Boolean).join(' · ')}</p>
                            {v.file_path && <p className="text-xs text-ghost/80 font-mono mt-1 break-all">{v.file_path}</p>}
                          </div>
                        ))}
                    </div>
                  )
                )}
              </div>

              {item.notes && (
                <div>
                  <p className="label mb-1">Notes</p>
                  <p className="max-w-3xl text-sm text-dim leading-7">{item.notes}</p>
                </div>
              )}

              <div>
                <p className="label mb-2">Your Rating</p>
                <StarRating value={userRatingToStars(item.user_rating)} onChange={(r) => onRating(item.id, starsToUserRating(r))} />
                {showPlexWritebackControls ? (
                  <PlexWritebackControls
                    item={item}
                    loading={plexWritebackLoading}
                    onWriteRating={writePlexRating}
                    onWriteWatchState={writePlexWatchState}
                  />
                ) : null}
              </div>
            </>
          )}
          </>
          ) : null}
        </div>

        <div className="p-4 border-t border-edge flex gap-3 shrink-0">
          <button onClick={onClose} className="btn-ghost">Close</button>
          {onFindPossibleDuplicates ? (
            <button
              onClick={() => {
                onFindPossibleDuplicates(item);
                onClose();
              }}
              className="btn-ghost"
            >
              <Icons.Link />
              Find possible duplicates
            </button>
          ) : null}
          <button onClick={() => onEdit(item)} className="btn-ghost flex-1"><Icons.Edit />Edit</button>
          <button
            onClick={() => { if (window.confirm('Delete this item?')) { onDelete(item.id); onClose(); } }}
            className="btn-ghost text-err hover:bg-err/10"
          >
            <Icons.Trash />
          </button>
        </div>
    </DetailDrawerShell>
  );
}

function CollectionEditor({ collectionId, apiCall, onClose, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [data, setData] = useState(null);
  const [newItemTitle, setNewItemTitle] = useState('');
  const [searchMatches, setSearchMatches] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedMatchId, setSelectedMatchId] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const payload = await apiCall('get', `/media/collections/${collectionId}`);
      setData(payload);
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load collection');
    } finally {
      setLoading(false);
    }
  }, [apiCall, collectionId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let active = true;
    const title = newItemTitle.trim();
    const mediaType = data?.collection?.media_type;
    if (!title || !mediaType) {
      setSearchMatches([]);
      setSelectedMatchId(null);
      return () => { active = false; };
    }
    const timer = setTimeout(async () => {
      try {
        setSearchLoading(true);
        const params = new URLSearchParams();
        params.set('media_type', String(mediaType));
        params.set('search', title);
        params.set('page', '1');
        params.set('limit', '8');
        const payload = await apiCall('get', `/media?${params.toString()}`);
        if (!active) return;
        const items = Array.isArray(payload?.items) ? payload.items : [];
        setSearchMatches(items);
        const normalized = title.toLowerCase();
        const exact = items.find((row) => String(row?.title || '').trim().toLowerCase() === normalized);
        setSelectedMatchId(exact?.id || null);
      } catch (_err) {
        if (active) {
          setSearchMatches([]);
          setSelectedMatchId(null);
        }
      } finally {
        if (active) setSearchLoading(false);
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [apiCall, data?.collection?.media_type, newItemTitle]);

  const addManualItem = async () => {
    if (!newItemTitle.trim()) return;
    setSaving(true);
    setError('');
    try {
      const payload = { contained_title: newItemTitle.trim() };
      if (Number.isFinite(Number(selectedMatchId)) && Number(selectedMatchId) > 0) {
        payload.media_id = Number(selectedMatchId);
      } else if (searchMatches.length > 0) {
        setError('Select an existing match before adding. New item creation is only used when no matches exist.');
        setSaving(false);
        return;
      }
      await apiCall('post', `/media/collections/${collectionId}/items`, payload);
      setNewItemTitle('');
      setSearchMatches([]);
      setSelectedMatchId(null);
      await load();
      onSaved?.('Collection item added');
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to add item');
    } finally {
      setSaving(false);
    }
  };

  const removeItem = async (itemId) => {
    if (!window.confirm('Remove this item from collection?')) return;
    setSaving(true);
    setError('');
    try {
      await apiCall('delete', `/media/collections/${collectionId}/items/${itemId}`);
      await load();
      onSaved?.('Collection item removed');
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to remove item');
    } finally {
      setSaving(false);
    }
  };

  const convertToIndividuals = async () => {
    if (!window.confirm('Convert this collection to individual titles and remove the collection?')) return;
    setDeleting(true);
    setError('');
    try {
      await apiCall('post', `/media/collections/${collectionId}/convert-to-individual`, {});
      onSaved?.('Collection converted to title');
      onClose();
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to convert collection');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-void/72" onClick={onClose} />
      <div className="relative ml-auto h-full w-full max-w-4xl bg-abyss border-l border-edge shadow-card flex flex-col animate-slide-in" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-edge flex items-center gap-3 shrink-0">
          <h2 className="section-title !text-xl">Edit Collection</h2>
          <div className="flex-1" />
          <button className="btn-icon" onClick={onClose}><Icons.X /></button>
        </div>
      <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {error && <p className="text-sm text-err">{error}</p>}
          {loading && <div className="flex items-center gap-2 text-dim"><Spinner size={16} />Loading...</div>}
          {!loading && data?.collection && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm text-dim">
                <div><span className="text-ghost">Collection:</span> <span className="text-ink">{data.collection.name || data.collection.source_title || `Collection #${collectionId}`}</span></div>
                <div><span className="text-ghost">Media type:</span> <span className="text-ink">{data.collection.media_type || 'movie'}</span></div>
                <div><span className="text-ghost">Import source:</span> <span className="text-ink">{data.collection.import_source || 'manual'}</span></div>
              </div>
              <div className="flex gap-2">
                <button className="btn-secondary" disabled={deleting} onClick={convertToIndividuals}>Convert to Title</button>
              </div>

              <div className="pt-2 border-t border-edge space-y-2">
                <p className="text-sm font-medium text-ink">Collection Items</p>
                <div className="flex gap-2">
                  <input
                    className="input flex-1"
                    placeholder="Type a title (existing matches are preferred)"
                    value={newItemTitle}
                    onChange={(e) => setNewItemTitle(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addManualItem(); }}
                  />
                  <button className="btn-secondary" disabled={saving || !newItemTitle.trim()} onClick={addManualItem}>Add</button>
                </div>
                {newItemTitle.trim() && (
                  <div className="rounded-lg border border-edge bg-surface p-2 text-xs">
                    {searchLoading && <p className="text-ghost">Searching existing titles…</p>}
                    {!searchLoading && searchMatches.length > 0 && (
                      <>
                        <p className="text-ghost mb-1">Select existing title (same media type):</p>
                        <div className="space-y-1 max-h-36 overflow-y-auto">
                          {searchMatches.map((row) => (
                            <button
                              key={row.id}
                              type="button"
                              className={cx('w-full text-left px-2 py-1 rounded border border-edge', Number(selectedMatchId) === Number(row.id) ? 'bg-veil text-ink' : 'text-dim')}
                              onClick={() => setSelectedMatchId(row.id)}
                            >
                              {row.title} {row.year ? `(${row.year})` : ''} · #{row.id}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                    {!searchLoading && searchMatches.length === 0 && (
                      <p className="text-ghost">No existing matches found. Add will create/link from provider enrichment.</p>
                    )}
                  </div>
                )}
                <div className="space-y-2">
                  {(data.items || []).map((item) => (
                    <div key={item.id} className="p-2 rounded bg-surface border border-edge flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-ink truncate">{item.media_title || item.contained_title || `Item #${item.id}`}</p>
                        <p className="text-xs text-ghost">#{item.id} · {item.media_id ? `Media ${item.media_id}` : 'Unlinked'}</p>
                      </div>
                      <button className="btn-ghost btn-sm text-err" disabled={saving} onClick={() => removeItem(item.id)}><Icons.Trash /></button>
                    </div>
                  ))}
                  {!data.items?.length && <p className="text-xs text-ghost">No collection items yet.</p>}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CollectionDetail({ collectionId, apiCall, onClose, onEdit, onConvert }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [payload, setPayload] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const result = await apiCall('get', `/media/collections/${collectionId}`);
        if (!active) return;
        setPayload(result);
      } catch (err) {
        if (!active) return;
        setError(err?.response?.data?.error || 'Failed to load collection details');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [apiCall, collectionId]);

  const collection = payload?.collection || {};
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const posterPath = collection.poster_path || items.find((row) => row.media_poster_path)?.media_poster_path || '';
  const title = collection.name || collection.source_title || `Collection #${collectionId}`;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-void/72" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-xl h-full bg-abyss border-l border-edge flex flex-col animate-slide-in">
        <div className="flex items-start gap-4 px-6 pt-6 pb-4 shrink-0">
          <div className="w-20 shrink-0 relative z-10 shadow-card">
            <div className="poster rounded-md">
              {posterUrl(posterPath)
                ? <img src={posterUrl(posterPath)} alt={title} className="absolute inset-0 w-full h-full object-cover" />
                : <div className="absolute inset-0 flex items-center justify-center text-ghost"><Icons.Library /></div>}
            </div>
          </div>
          <div className="flex-1 min-w-0 mt-1">
            <div className="flex items-baseline gap-2">
              <h2 className="text-2xl font-semibold tracking-tight text-ink leading-tight">{title}</h2>
              <p className="text-sm text-ghost">#{collectionId}</p>
            </div>
            <p className="text-sm text-dim mt-1">{mediaTypeLabel(collection.media_type)} · {items.length} item{items.length === 1 ? '' : 's'}</p>
            {Number.isFinite(Number(collection.expected_item_count)) && Number(collection.expected_item_count) > 0 && (
              <p className="text-xs text-ghost mt-1">Expected items: {collection.expected_item_count}</p>
            )}
          </div>
          <button onClick={onClose} className="btn-icon btn-sm shrink-0"><Icons.X /></button>
        </div>

        <div className="divider" />

        <div className="flex-1 overflow-y-auto scroll-area p-6 space-y-4">
          {loading && <div className="flex items-center gap-2 text-dim"><Spinner size={16} />Loading…</div>}
          {error && <p className="text-sm text-err">{error}</p>}
          {!loading && !error && (
            <>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><p className="label">Collection type</p><p className="text-ink">{mediaTypeLabel(collection.media_type)}</p></div>
                <div><p className="label">Import source</p><p className="text-ink">{collection.import_source || 'manual'}</p></div>
              </div>
              <div>
                <p className="label mb-2">Items</p>
                <div className="space-y-2">
                  {items.map((row) => (
                    <div key={row.id} className="card p-2 flex items-center gap-3">
                      <div className="w-10 shrink-0" style={{ aspectRatio: '2/3' }}>
                        <div className="poster rounded w-full h-full">
                          {posterUrl(row.media_poster_path)
                            ? <img src={posterUrl(row.media_poster_path)} alt={row.media_title || row.contained_title || ''} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
                            : <div className="absolute inset-0 flex items-center justify-center text-ghost"><Icons.Film /></div>}
                        </div>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm text-ink truncate">{row.media_title || row.contained_title || `Item #${row.id}`}</p>
                        <p className="text-xs text-ghost">{row.media_year ? `${row.media_year} · ` : ''}{row.media_id ? `Media #${row.media_id}` : 'Unlinked'}</p>
                      </div>
                    </div>
                  ))}
                  {items.length === 0 && <p className="text-xs text-ghost">No items in this collection.</p>}
                </div>
              </div>
            </>
          )}
        </div>
        <div className="p-4 border-t border-edge flex gap-3 shrink-0">
          <button onClick={onClose} className="btn-ghost">Close</button>
          <button onClick={onEdit} className="btn-ghost flex-1"><Icons.Edit />Edit</button>
          <button onClick={onConvert} className="btn-ghost"><Icons.Film />Convert</button>
        </div>
      </div>
    </div>
  );
}

function MediaForm({ initial = DEFAULT_MEDIA_FORM, onSave, onCancel, onDelete, onConvertToCollection, title = 'Add Media', apiCall }) {
  const hasInitialLookupContext = (rawInitial) => {
    if (!rawInitial?.id) return false;
    const details = rawInitial?.type_details || {};
    return Boolean(
      rawInitial?.overview
      || rawInitial?.genre
      || rawInitial?.year
      || rawInitial?.release_date
      || rawInitial?.poster_path
      || rawInitial?.upc
      || details?.isbn
      || details?.author
      || details?.platform
      || details?.artist
      || details?.series
      || details?.developer
    );
  };

  const mergeTypeDetails = (rawInitial) => {
    const details = rawInitial?.type_details || {};
    const ownedFormats = sortOwnedFormats(
      rawInitial?.media_type || 'movie',
      normalizeOwnedFormats(rawInitial?.media_type || 'movie', rawInitial?.owned_formats, rawInitial?.format)
    );
    return {
      ...rawInitial,
      release_date: normalizeDateInput(rawInitial?.release_date),
      signed_on: normalizeDateInput(rawInitial?.signed_on),
      signed_proof_path: rawInitial?.signed_proof_path || '',
      owned_formats: ownedFormats,
      cast: rawInitial?.cast || rawInitial?.cast_members || '',
      book_author: details?.author || '',
      book_isbn: details?.isbn || '',
      book_publisher: details?.publisher || '',
      book_edition: details?.edition || '',
      movie_edition: details?.edition || '',
      comic_series: details?.series || '',
      comic_issue_number: details?.issue_number || '',
      comic_volume: details?.volume || '',
      comic_writer: details?.writer || '',
      comic_artist: details?.artist || '',
      comic_inker: details?.inker || '',
      comic_colorist: details?.colorist || '',
      comic_cover_date: details?.cover_date || '',
      comic_provider_issue_id: details?.provider_issue_id || '',
      comic_barcode_addon: details?.barcode_addon || '',
      audio_artist: details?.artist || '',
      audio_album: details?.album || '',
      audio_track_count: details?.track_count ? String(details.track_count) : '',
      game_platform: details?.platform || '',
      game_developer: details?.developer || '',
      game_region: details?.region || ''
    };
  };
  const [form, setForm] = useState(mergeTypeDetails(initial));
  const [tvSeasonsText, setTvSeasonsText] = useState(Array.isArray(initial?.tv_seasons) ? initial.tv_seasons.join(', ') : '');
  const [lookupPanel, setLookupPanel] = useState(() => ({
    expanded: !hasInitialLookupContext(initial),
    matches: [],
    error: null,
    loading: false,
    appliedSummary: null
  }));
  const [lookupCaptureLoading, setLookupCaptureLoading] = useState(false);
  const [coverUploadLoading, setCoverUploadLoading] = useState(false);
  const [proofFile, setProofFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState('ok');
  const [bookCaptureState, setBookCaptureState] = useState(null);
  const [bookIdentifierInput, setBookIdentifierInput] = useState(() => normalizeBarcodeInput(initial?.type_details?.isbn || initial?.upc || ''));
  const [comicIdentifierInput, setComicIdentifierInput] = useState(() => normalizeBarcodeInput(initial?.type_details?.isbn || initial?.upc || '') + (initial?.type_details?.barcode_addon ? ` ${normalizeBarcodeInput(initial.type_details.barcode_addon)}` : ''));
  const lookupCaptureInputRef = useRef(null);
  const coverImageInputRef = useRef(null);
  const lookupPanelMeasureRef = useRef(null);
  const [lookupOverlayTop, setLookupOverlayTop] = useState(null);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setOwnedFormats = (nextFormats) => {
    set({ owned_formats: sortOwnedFormats(form.media_type, nextFormats) });
  };
  const patchLookupPanel = (patch) => setLookupPanel((current) => ({ ...current, ...patch }));
  const notify = (text, type = 'ok') => { setMsg(text); setMsgType(type); };
  const isMovieOrTv = ['movie', 'tv_series', 'tv_episode'].includes(form.media_type);
  const isBook = form.media_type === 'book';
  const isComic = form.media_type === 'comic_book';
  const isAudio = form.media_type === 'audio';
  const isGame = form.media_type === 'game';
  const canUniversalLookup = isMovieOrTv || isBook || isComic || isAudio || isGame;
  const canIdentifierLookup = isMovieOrTv || isBook || isComic || isAudio || isGame;
  const {
    expanded: lookupPanelExpanded,
    matches: lookupMatches,
    error: lookupError,
    loading: lookupLoading,
    appliedSummary: appliedLookupSummary
  } = lookupPanel;
  const canConvertToCollection = Boolean(onConvertToCollection) && ['movie', 'game'].includes(form.media_type);
  const editorTabs = useMemo(() => {
    const tabs = [{ id: 'core', label: 'Core Details' }];
    if (isMovieOrTv) tabs.push({ id: 'people', label: 'Cast & Crew' });
    tabs.push({ id: 'signatures', label: 'Signatures' });
    tabs.push({ id: 'storage', label: 'Storage & Notes' });
    return tabs;
  }, [isMovieOrTv]);
  const [activeEditorTab, setActiveEditorTab] = useState('core');
  const activeMediaTypeTab = form.media_type === 'tv_episode' ? 'tv_series' : form.media_type;

  const handleMediaTypeChange = (nextType) => {
    const nextOwnedFormats = normalizeOwnedFormats(nextType, form.owned_formats, form.format);
    const patch = { media_type: nextType, owned_formats: sortOwnedFormats(nextType, nextOwnedFormats) };
    if (!['movie', 'tv_series', 'tv_episode'].includes(nextType)) {
      patch.original_title = '';
      patch.director = '';
      patch.cast = '';
      patch.runtime = '';
      patch.rating = '';
      patch.tmdb_id = '';
      patch.tmdb_media_type = 'movie';
      patch.trailer_url = '';
      patch.backdrop_path = '';
    }
    if (nextType !== 'movie') patch.movie_edition = '';
    set(patch);
    setBookCaptureState(null);
    patchLookupPanel({
      expanded: true,
      matches: [],
      error: null,
      appliedSummary: null
    });
  };

  useEffect(() => {
    if (!editorTabs.some((tab) => tab.id === activeEditorTab)) {
      setActiveEditorTab('core');
    }
  }, [activeEditorTab, editorTabs]);

  useEffect(() => {
    if (!isBook) {
      setBookCaptureState(null);
    }
  }, [isBook]);

  useEffect(() => {
    if (!isBook) return;
    const next = normalizeBarcodeInput(form.book_isbn || form.upc || '');
    setBookIdentifierInput((current) => (current === next ? current : next));
  }, [form.book_isbn, form.upc, isBook]);

  useEffect(() => {
    if (!isComic) return;
    const nextBase = normalizeBarcodeInput(form.book_isbn || form.upc || '');
    const nextAddon = normalizeBarcodeInput(form.comic_barcode_addon || '');
    const next = [nextBase, nextAddon].filter(Boolean).join(' ');
    setComicIdentifierInput((current) => (current === next ? current : next));
  }, [form.book_isbn, form.upc, form.comic_barcode_addon, isComic]);

  useLayoutEffect(() => {
    if (!lookupPanelExpanded) {
      setLookupOverlayTop(null);
      return undefined;
    }

    const measure = () => {
      const panel = lookupPanelMeasureRef.current;
      if (!panel) {
        setLookupOverlayTop(null);
        return;
      }
      setLookupOverlayTop(panel.offsetHeight);
    };

    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [lookupPanelExpanded, form.media_type, lookupCaptureLoading, lookupLoading, bookCaptureState, bookIdentifierInput, comicIdentifierInput, form.upc, form.title]);

  const resolveLookupTitle = () => String(form.title || '').trim();
  const resolveLookupYear = () => {
    const directYear = Number(String(form.year || '').trim());
    if (Number.isFinite(directYear) && directYear > 0) return directYear;
    const releaseDate = String(form.release_date || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) return Number(releaseDate.slice(0, 4));
    return null;
  };
  const resolveLookupIdentifier = (upcOverride = null) => {
    const normalizedOverride = typeof upcOverride === 'string' || typeof upcOverride === 'number'
      ? upcOverride
      : null;
    const preferredLookupValue = normalizedOverride ?? (isBook ? (form.book_isbn || form.upc) : form.upc);
    return normalizeBarcodeInput(preferredLookupValue);
  };

  const annotateLookupMatches = (matches, source) => (matches || []).map((match) => ({
    ...match,
    lookupSources: [source]
  }));

  const resolveLookupThumbnailPath = (match) => (
    match?.image
    || match?.typeEnrichment?.poster_path
    || match?.book?.poster_path
    || match?.tmdb?.poster_path
    || match?.poster_path
    || null
  );

  const buildLookupMatchKey = (match) => {
    if (match?.tmdb?.id) return `tmdb:${match.tmdb.tmdb_media_type || form.media_type}:${match.tmdb.id}`;
    if (match?.book?.id) return `book:${match.book.id}`;
    if (match?.typeEnrichment?.id) return `${form.media_type}:${match.typeEnrichment.id}`;
    if (match?.upc) return `upc:${match.upc}`;
    return `${String(match?.normalizedTitle || match?.title || '').toLowerCase()}|${String(match?.release_date || match?.year || '')}`;
  };

  const mergeLookupMatches = (...groups) => {
    const merged = new Map();
    for (const group of groups) {
      for (const match of group || []) {
        const key = buildLookupMatchKey(match);
        if (!merged.has(key)) {
          merged.set(key, {
            ...match,
            lookupSources: Array.from(new Set(match?.lookupSources || []))
          });
          continue;
        }
        const current = merged.get(key);
        merged.set(key, {
          ...current,
          ...match,
          tmdb: current.tmdb || match.tmdb || null,
          book: current.book || match.book || null,
          typeEnrichment: current.typeEnrichment || match.typeEnrichment || null,
          typeDetails: {
            ...(current.typeDetails || {}),
            ...(match.typeDetails || {})
          },
          lookupSources: Array.from(new Set([...(current.lookupSources || []), ...(match.lookupSources || [])]))
        });
      }
    }
    return Array.from(merged.values());
  };

  const normalizeLookupTitleForCompare = (value) => String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  const resolveLookupMatchTitle = (match) => (
    match?.typeEnrichment?.title
      || match?.book?.title
      || match?.normalizedTitle
      || match?.tmdb?.title
      || match?.title
      || ''
  );

  const resolveLookupMatchYear = (match) => (
    match?.typeEnrichment?.year
      || match?.book?.year
      || match?.tmdb?.release_year
      || (match?.tmdb?.release_date ? Number(String(match.tmdb.release_date).slice(0, 4)) : null)
      || (match?.release_date ? Number(String(match.release_date).slice(0, 4)) : null)
      || (match?.year ? Number(match.year) : null)
      || null
  );

  const mergeLookupCandidateData = (baseMatch, enrichmentMatch) => ({
    ...baseMatch,
    ...enrichmentMatch,
    upc: baseMatch?.upc || enrichmentMatch?.upc || null,
    tmdb: enrichmentMatch?.tmdb || baseMatch?.tmdb || null,
    book: enrichmentMatch?.book || baseMatch?.book || null,
    typeEnrichment: enrichmentMatch?.typeEnrichment || baseMatch?.typeEnrichment || null,
    typeDetails: {
      ...(baseMatch?.typeDetails || {}),
      ...(enrichmentMatch?.typeDetails || {})
    },
    lookupSources: Array.from(new Set([...(baseMatch?.lookupSources || []), ...(enrichmentMatch?.lookupSources || [])]))
  });

  const pickBestTitleEnrichmentMatch = (baseMatch, enrichmentMatches) => {
    if (!Array.isArray(enrichmentMatches) || enrichmentMatches.length === 0) return null;
    const baseTitle = normalizeLookupTitleForCompare(resolveLookupMatchTitle(baseMatch));
    const baseYear = resolveLookupMatchYear(baseMatch);

    const exact = enrichmentMatches.find((candidate) => (
      normalizeLookupTitleForCompare(resolveLookupMatchTitle(candidate)) === baseTitle
        && (!baseYear || !resolveLookupMatchYear(candidate) || resolveLookupMatchYear(candidate) === baseYear)
    ));
    if (exact) return exact;

    const sameTitle = enrichmentMatches.find((candidate) => (
      normalizeLookupTitleForCompare(resolveLookupMatchTitle(candidate)) === baseTitle
    ));
    if (sameTitle) return sameTitle;

    return enrichmentMatches[0] || null;
  };

  const formatLookupSourceLabel = (source) => {
    if (source === 'identifier') return 'Identifier';
    if (source === 'title') return 'Title';
    return source;
  };

  const resolveLookupProviderLabel = (match) => {
    if (match?.tmdb) return 'TMDB';
    if (match?.book) return 'Google Books';
    if (isComic && match?.typeEnrichment) return 'Metron';
    if (isAudio && match?.typeEnrichment) return 'Discogs';
    if (isGame && match?.typeEnrichment) return 'Game Search';
    if ((match?.lookupSources || []).includes('identifier')) return 'Identifier';
    return '';
  };

  const buildAppliedLookupSummary = (match) => ({
    title: resolveLookupMatchTitle(match) || String(form.title || '').trim() || 'Matched title',
    identifier: String(match?.upc || '').trim() || resolveLookupIdentifier(),
    sourceLabels: Array.from(new Set((match?.lookupSources || []).map(formatLookupSourceLabel))),
    provider: resolveLookupProviderLabel(match)
  });

  const clearAppliedLookupSummary = () => {
    patchLookupPanel({ appliedSummary: null, expanded: true, error: null });
  };

  const lookupByIdentifier = async (identifier) => {
    const data = await apiCall('post', '/media/lookup-upc', { upc: identifier, mediaType: form.media_type });
    return annotateLookupMatches(data.matches || [], 'identifier');
  };

  const lookupByTitle = async (title) => {
    if (isMovieOrTv) {
      const matches = await apiCall('post', '/media/search-tmdb', {
        title,
        year: resolveLookupYear(),
        mediaType: inferTmdbSearchType(form.media_type)
      });
      return annotateLookupMatches((matches || []).map((row) => ({
        title: row?.title || row?.name || '',
        normalizedTitle: row?.title || row?.name || '',
        description: row?.overview || '',
        image: row?.poster_path || null,
        tmdb: row
      })), 'title');
    }

    if (isBook) {
      const data = await apiCall('post', '/media/enrich/book/search', {
        title,
        author: String(form.book_author || '').trim()
      });
      return annotateLookupMatches((data?.matches || []).map((row) => ({
        mediaTypeGuess: 'book',
        title: row?.title || '',
        normalizedTitle: row?.title || '',
        description: row?.overview || '',
        image: row?.poster_path || null,
        book: row,
        typeDetails: row?.type_details || {}
      })), 'title');
    }

    if (isComic) {
      const data = await apiCall('post', '/media/enrich/comic/search', { title });
      return annotateLookupMatches((data?.matches || []).map((row) => ({
        title: row?.title || '',
        normalizedTitle: row?.title || '',
        description: row?.overview || '',
        image: row?.poster_path || null,
        typeEnrichment: row,
        typeDetails: row?.type_details || {}
      })), 'title');
    }

    if (isAudio) {
      const data = await apiCall('post', '/media/enrich/audio/search', {
        title,
        artist: String(form.audio_artist || '').trim()
      });
      return annotateLookupMatches((data?.matches || []).map((row) => ({
        title: row?.title || '',
        normalizedTitle: row?.title || '',
        description: row?.overview || '',
        image: row?.poster_path || null,
        typeEnrichment: row,
        typeDetails: row?.type_details || {}
      })), 'title');
    }

    if (isGame) {
      const data = await apiCall('post', '/media/enrich/game/search', { title });
      return annotateLookupMatches((data?.matches || []).map((row) => ({
        title: row?.title || '',
        normalizedTitle: row?.title || '',
        description: row?.overview || '',
        image: row?.poster_path || null,
        typeEnrichment: row,
        typeDetails: row?.type_details || {}
      })), 'title');
    }

    return [];
  };

  const enrichIdentifierSelection = async (match) => {
    const lookupSources = match?.lookupSources || [];
    if (!lookupSources.includes('identifier') || lookupSources.includes('title')) {
      return match;
    }
    if (match?.tmdb || match?.book || match?.typeEnrichment) {
      return match;
    }

    const selectedTitle = String(resolveLookupMatchTitle(match) || '').trim();
    if (!selectedTitle) return match;

    try {
      const enrichmentMatches = await lookupByTitle(selectedTitle);
      const bestMatch = pickBestTitleEnrichmentMatch(match, enrichmentMatches);
      return bestMatch ? mergeLookupCandidateData(match, bestMatch) : match;
    } catch (error) {
      return match;
    }
  };

  const runUniversalLookup = async (options = {}) => {
    const {
      identifierOverride = null,
      forceIdentifierOnly = false
    } = options;
    const title = forceIdentifierOnly ? '' : resolveLookupTitle();
    const identifier = resolveLookupIdentifier(identifierOverride);

    if (!title && !identifier) {
      notify('Enter a title or identifier first', 'error');
      return;
    }

    patchLookupPanel({
      loading: true,
      matches: [],
      error: null,
      expanded: true
    });

    try {
      const titleOnly = Boolean(title) && !identifier;
      const identifierOnly = Boolean(identifier) && (!title || forceIdentifierOnly);
      const dualSource = Boolean(title) && Boolean(identifier) && !forceIdentifierOnly;
      let matches = [];

      if (dualSource) {
        const [titleResult, identifierResult] = await Promise.allSettled([
          lookupByTitle(title),
          lookupByIdentifier(identifier)
        ]);
        const fulfilledGroups = [titleResult, identifierResult]
          .filter((result) => result.status === 'fulfilled')
          .map((result) => result.value || []);
        const rejected = [titleResult, identifierResult]
          .filter((result) => result.status === 'rejected')
          .map((result) => result.reason);

        matches = mergeLookupMatches(...fulfilledGroups);
        if (rejected.length) {
          const payload = rejected[0]?.response?.data || null;
          if (payload) patchLookupPanel({ error: payload });
        }
      } else if (identifierOnly) {
        matches = await lookupByIdentifier(identifier);
      } else if (titleOnly) {
        matches = await lookupByTitle(title);
      }

      patchLookupPanel({ matches });

      if (!matches.length) {
        notify('No matches found', 'error');
        return;
      }

      if (dualSource) {
        const sharedMatches = matches.filter((match) => (match.lookupSources || []).length > 1).length;
        if (sharedMatches > 0) {
          notify(`Found ${matches.length} matches across title and identifier search`);
        } else {
          notify('Showing title and identifier matches together');
        }
        return;
      }

      notify(matches.length === 1 ? 'Found 1 match' : `Found ${matches.length} matches`);
    } catch (e) {
      const payload = e?.response?.data || null;
      patchLookupPanel({ error: payload });
      notify(payload?.error || payload?.detail || 'Lookup failed', 'error');
    } finally {
      patchLookupPanel({ loading: false });
    }
  };

  const handleBookIdentifierChange = (value) => {
    const raw = String(value || '').toUpperCase();
    const normalized = normalizeBarcodeInput(raw);
    const normalizedIsbn = normalizeIsbnCandidate(raw);
    const barcodeCandidate = inferBookBarcodeIdentifier(normalized) || (isLikelyRetailBookBarcode(normalized) ? normalized.replace(/\D+/g, '') : '');
    setBookIdentifierInput(raw);
    set({
      book_isbn: normalizedIsbn || '',
      upc: barcodeCandidate || ''
    });
    setBookCaptureState(null);
  };

  const handleComicIdentifierChange = (value) => {
    const raw = String(value || '').toUpperCase();
    const normalizedIsbn = normalizeIsbnCandidate(raw);
    const digits = normalizeBarcodeInput(raw).replace(/\D+/g, '');
    let barcodeBase = '';
    let barcodeAddon = '';

    if (!normalizedIsbn) {
      if (digits.length >= 17) {
        barcodeBase = digits.slice(0, 12);
        barcodeAddon = digits.slice(12, 17);
      } else if (digits.length >= 14) {
        barcodeBase = digits.slice(0, 12);
        barcodeAddon = digits.slice(12, 14);
      } else if (digits.length >= 12) {
        barcodeBase = digits.slice(0, 12);
      } else {
        barcodeBase = digits;
      }
    }

    setComicIdentifierInput(raw);
    set({
      book_isbn: normalizedIsbn || '',
      upc: barcodeBase || '',
      comic_barcode_addon: barcodeAddon || ''
    });
  };

  const resolveCapturedLookupValue = async (file, detectedCode = '', barcodeBoundingBox = null) => {
    const normalizedDetected = normalizeBarcodeInput(detectedCode);
    let ocrCandidates = { isbnCandidates: [], strictIsbnCandidates: [], labeledIsbnCandidates: [], upcCandidates: [], asinCandidates: [] };
    const shouldTryOcr = isBook && !inferBookBarcodeIdentifier(normalizedDetected);

    if (shouldTryOcr) {
      try {
        ocrCandidates = await extractIdentifierCandidatesFromFile(file, { boundingBox: barcodeBoundingBox });
      } catch (_) {
        // OCR is a best-effort fallback for books, not a hard dependency.
      }
    }

    const trustedRecoveredIsbn = isBook
      ? (ocrCandidates.labeledIsbnCandidates?.[0] || ocrCandidates.strictIsbnCandidates?.[0] || inferBookBarcodeIdentifier(normalizedDetected))
      : '';
    const inferredBookIsbn = trustedRecoveredIsbn;
    const lookupValue = inferredBookIsbn || normalizedDetected || ocrCandidates.upcCandidates?.[0] || '';
    const shouldDeferAmbiguousBookLookup = Boolean(
      isBook &&
      normalizedDetected &&
      isLikelyRetailBookBarcode(normalizedDetected) &&
      !inferredBookIsbn
    );

    return {
      normalizedDetected,
      inferredBookIsbn,
      lookupValue,
      shouldDeferAmbiguousBookLookup
    };
  };

  const handleLookupCapture = async (event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = '';
    if (!file) return;
    setLookupCaptureLoading(true);
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
      set({
        upc: normalizedDetected || lookupValue,
        ...(inferredBookIsbn ? { book_isbn: inferredBookIsbn } : {})
      });
      if (isBook) {
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
            ? 'Try another photo with the ISBN line fully visible, or type the ISBN manually in the field beside the retail barcode.'
            : 'ISBN is the best match key for books. You can still adjust either field before saving.'
        });
      }
      if (shouldDeferAmbiguousBookLookup) {
        notify('Captured a retail book barcode, but no ISBN was recovered from the frame. Use Photo for sharper OCR or type the ISBN to avoid ambiguous matches.', 'error');
        return;
      }
      notify(inferredBookIsbn ? `Recovered book identifier ${inferredBookIsbn}` : `Captured barcode ${lookupValue}`);
      if (canIdentifierLookup) {
        await runUniversalLookup({ identifierOverride: lookupValue, forceIdentifierOnly: true });
      }
    } catch (error) {
      const reason = error?.message;
      if (reason === 'unsupported') {
        notify('This browser could capture the image, but barcode decoding is not available yet. Enter the UPC manually instead.', 'error');
      } else if (reason === 'not-found') {
        notify('No barcode was detected in that image. Try a clearer photo or enter the UPC manually.', 'error');
      } else {
        notify('Barcode capture failed. Enter the UPC manually instead.', 'error');
      }
    } finally {
      setLookupCaptureLoading(false);
    }
  };

  const applyLookupResult = async (match) => {
    const resolvedMatch = await enrichIdentifierSelection(match);
    const notifyIfOverviewClamped = (incomingOverview, appliedOverview) => {
      if (typeof incomingOverview === 'string' && incomingOverview.trim().length > OVERVIEW_MAX_LENGTH && appliedOverview.length <= OVERVIEW_MAX_LENGTH) {
        notify('Provider overview was truncated to fit the save limit');
      }
    };
    const guessedBook = resolvedMatch?.mediaTypeGuess === 'book' || Boolean(resolvedMatch?.book);
    if (guessedBook) {
      const book = resolvedMatch?.book || null;
      const bookTypeDetails = book?.type_details || {};
      const preferredCapturedIsbn = String(form.book_isbn || '').trim();
      const nextOverview = clampOverviewText(book?.overview || resolvedMatch?.description || form.overview);
      set({
        media_type: 'book',
        title: book?.title || resolvedMatch?.normalizedTitle || resolvedMatch?.title || form.title,
        release_date: book?.release_date || form.release_date,
        year: book?.year ? String(book.year) : form.year,
        overview: nextOverview,
        genre: book?.genre || form.genre,
        owned_formats: sortOwnedFormats('book', normalizeOwnedFormats('book', form.owned_formats, resolvedMatch?.typeDetails?.format || form.format || 'paperback')),
        poster_path: book?.poster_path || resolvedMatch?.image || form.poster_path,
        upc: resolvedMatch?.upc || form.upc,
        book_isbn: preferredCapturedIsbn || bookTypeDetails?.isbn || resolvedMatch?.typeDetails?.isbn || form.book_isbn,
        book_author: bookTypeDetails?.author || resolvedMatch?.typeDetails?.author || form.book_author,
        book_publisher: bookTypeDetails?.publisher || resolvedMatch?.typeDetails?.publisher || form.book_publisher,
        book_edition: bookTypeDetails?.edition || resolvedMatch?.typeDetails?.format || form.book_edition
      });
      patchLookupPanel({
        error: null,
        appliedSummary: buildAppliedLookupSummary(resolvedMatch),
        expanded: false
      });
      notifyIfOverviewClamped(book?.overview || resolvedMatch?.description || '', nextOverview);
      notify('Lookup data applied');
      return;
    }

    const typeEnrichment = resolvedMatch?.typeEnrichment || null;
    if (isComic && typeEnrichment) {
      const nextOverview = clampOverviewText(typeEnrichment.overview || resolvedMatch?.description || form.overview);
      set({
        title: typeEnrichment.title || resolvedMatch?.normalizedTitle || resolvedMatch?.title || form.title,
        year: typeEnrichment.year ? String(typeEnrichment.year) : form.year,
        release_date: typeEnrichment.release_date || form.release_date,
        genre: typeEnrichment.genre || form.genre,
        overview: nextOverview,
        poster_path: typeEnrichment.poster_path || resolvedMatch?.image || form.poster_path,
        upc: resolvedMatch?.upc || form.upc,
        book_author: typeEnrichment.type_details?.author || form.book_author,
        book_publisher: typeEnrichment.type_details?.publisher || resolvedMatch?.typeDetails?.publisher || form.book_publisher,
        book_isbn: typeEnrichment.type_details?.isbn || resolvedMatch?.typeDetails?.isbn || form.book_isbn,
        book_edition: typeEnrichment.type_details?.edition || form.book_edition,
        comic_series: typeEnrichment.type_details?.series || resolvedMatch?.typeDetails?.series || form.comic_series,
        comic_issue_number: typeEnrichment.type_details?.issue_number || form.comic_issue_number,
        comic_volume: typeEnrichment.type_details?.volume || form.comic_volume,
        comic_writer: typeEnrichment.type_details?.writer || form.comic_writer,
        comic_artist: typeEnrichment.type_details?.artist || form.comic_artist,
        comic_inker: typeEnrichment.type_details?.inker || form.comic_inker,
        comic_colorist: typeEnrichment.type_details?.colorist || form.comic_colorist,
        comic_cover_date: typeEnrichment.type_details?.cover_date || form.comic_cover_date,
        comic_provider_issue_id: typeEnrichment.type_details?.provider_issue_id || typeEnrichment.id || form.comic_provider_issue_id,
        comic_barcode_addon: typeEnrichment.type_details?.barcode_addon || form.comic_barcode_addon
      });
      patchLookupPanel({
        error: null,
        appliedSummary: buildAppliedLookupSummary(resolvedMatch),
        expanded: false
      });
      notifyIfOverviewClamped(typeEnrichment.overview || resolvedMatch?.description || '', nextOverview);
      notify('Lookup data applied');
      return;
    }

    if (isAudio && typeEnrichment) {
      const nextOverview = clampOverviewText(typeEnrichment.overview || resolvedMatch?.description || form.overview);
      set({
        title: typeEnrichment.title || resolvedMatch?.normalizedTitle || resolvedMatch?.title || form.title,
        year: typeEnrichment.year ? String(typeEnrichment.year) : form.year,
        release_date: typeEnrichment.release_date || form.release_date,
        genre: typeEnrichment.genre || form.genre,
        overview: nextOverview,
        poster_path: typeEnrichment.poster_path || resolvedMatch?.image || form.poster_path,
        upc: resolvedMatch?.upc || form.upc,
        audio_artist: typeEnrichment.type_details?.artist || form.audio_artist,
        audio_album: typeEnrichment.type_details?.album || typeEnrichment.title || form.audio_album || form.title,
        audio_track_count: typeEnrichment.type_details?.track_count ? String(typeEnrichment.type_details.track_count) : form.audio_track_count
      });
      patchLookupPanel({
        error: null,
        appliedSummary: buildAppliedLookupSummary(resolvedMatch),
        expanded: false
      });
      notifyIfOverviewClamped(typeEnrichment.overview || resolvedMatch?.description || '', nextOverview);
      notify('Lookup data applied');
      return;
    }

    if (isGame && typeEnrichment) {
      const nextOverview = clampOverviewText(typeEnrichment.overview || resolvedMatch?.description || form.overview);
      set({
        title: typeEnrichment.title || resolvedMatch?.normalizedTitle || resolvedMatch?.title || form.title,
        year: typeEnrichment.year ? String(typeEnrichment.year) : form.year,
        release_date: typeEnrichment.release_date || form.release_date,
        genre: typeEnrichment.genre || form.genre,
        overview: nextOverview,
        poster_path: typeEnrichment.poster_path || resolvedMatch?.image || form.poster_path,
        upc: resolvedMatch?.upc || form.upc,
        game_platform: typeEnrichment.type_details?.platform || form.game_platform,
        game_developer: typeEnrichment.type_details?.developer || form.game_developer,
        game_region: typeEnrichment.type_details?.region || form.game_region
      });
      patchLookupPanel({
        error: null,
        appliedSummary: buildAppliedLookupSummary(resolvedMatch),
        expanded: false
      });
      notifyIfOverviewClamped(typeEnrichment.overview || resolvedMatch?.description || '', nextOverview);
      notify('Lookup data applied');
      return;
    }

    const tmdb = resolvedMatch.tmdb;
    let details = null;
    if (tmdb?.id) {
      try {
        const tmdbType = tmdb?.tmdb_media_type || inferTmdbSearchType(form.media_type);
        details = await apiCall('get', `/media/tmdb/${tmdb.id}/details?mediaType=${tmdbType}`);
      } catch (_) {
        details = null;
      }
    }
    const genres = Array.isArray(tmdb?.genre_names) ? tmdb.genre_names.join(', ') : '';
    const releaseDate = tmdb?.release_date || '';
    const tmdbType = tmdb?.tmdb_media_type || inferTmdbSearchType(form.media_type);
    const nextOverview = clampOverviewText(tmdb?.overview || resolvedMatch.description || form.overview);
    set({
      title: tmdb?.title || resolvedMatch.title || form.title,
      original_title: tmdb?.original_title || form.original_title,
      release_date: releaseDate || form.release_date,
      year: tmdb?.release_year ? String(tmdb.release_year) : (releaseDate ? String(releaseDate).slice(0, 4) : form.year),
      genre: genres || form.genre,
      director: details?.director || form.director,
      cast: details?.cast || form.cast,
      overview: nextOverview,
      tmdb_id: tmdb?.id || form.tmdb_id,
      tmdb_media_type: tmdbType,
      tmdb_url: details?.tmdb_url || (tmdb?.id ? `https://www.themoviedb.org/${tmdbType}/${tmdb.id}` : form.tmdb_url),
      trailer_url: details?.trailer_url || form.trailer_url,
      poster_path: tmdb?.poster_path || resolvedMatch.image || form.poster_path,
      backdrop_path: tmdb?.backdrop_path || form.backdrop_path,
      runtime: details?.runtime || form.runtime,
      upc: resolvedMatch?.upc || form.upc
    });
    patchLookupPanel({
      error: null,
      appliedSummary: buildAppliedLookupSummary(resolvedMatch),
      expanded: false
    });
    notifyIfOverviewClamped(tmdb?.overview || resolvedMatch?.description || '', nextOverview);
    notify('Lookup data applied');
  };

  const uploadCoverImage = async (file) => {
    if (!file) return;
    setCoverUploadLoading(true);
    try {
      const body = new FormData();
      body.append('cover', file);
      const uploaded = await apiCall('post', '/media/upload-cover', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      if (!uploaded?.path) throw new Error('Cover upload did not return a path');
      set({ poster_path: uploaded.path });
      notify('Cover image applied');
    } catch (e) {
      notify(e.response?.data?.error || e.message || 'Cover upload failed', 'error');
    } finally {
      setCoverUploadLoading(false);
    }
  };

  const handleCoverImageSelection = async (event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = '';
    if (!file) return;
    await uploadCoverImage(file);
  };

  const uploadSigningProof = async () => {
    if (!proofFile) return;
    if (!form.id) {
      notify('Save item first, then upload signing proof', 'error');
      return;
    }
    const body = new FormData();
    body.append('proof', proofFile);
    try {
      const data = await apiCall('post', `/media/${form.id}/upload-signing-proof`, body, { headers: { 'Content-Type': 'multipart/form-data' } });
      set({ signed_proof_path: data.signed_proof_path || '' });
      notify('Signing proof uploaded');
    } catch (e) {
      notify(e.response?.data?.error || 'Signing proof upload failed', 'error');
    }
  };

  const removeSigningProof = async () => {
    if (!form.id || !form.signed_proof_path) return;
    try {
      await apiCall('delete', `/media/${form.id}/signing-proof`);
      set({ signed_proof_path: '' });
      notify('Signing proof removed');
    } catch (e) {
      notify(e.response?.data?.error || 'Failed to remove signing proof', 'error');
    }
  };

  const applySignatureChange = ({ owner, signatures }) => {
    const media = owner || {};
    set({
      signatures: Array.isArray(signatures) ? signatures : (media.signatures || []),
      signed_by: media.signed_by || '',
      signed_role: media.signed_role || '',
      signed_on: normalizeDateInput(media.signed_on),
      signed_at: media.signed_at || '',
      signed_proof_path: media.signed_proof_path || ''
    });
    notify('Signature records updated');
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const parsedTvSeasons = tvSeasonsText
        .split(',')
        .map((v) => Number(String(v).trim()))
        .filter((n) => Number.isInteger(n) && n > 0 && n <= 999);
      const typeDetails = form.media_type === 'book'
        ? {
            author: form.book_author || null,
            isbn: form.book_isbn || null,
            publisher: form.book_publisher || null,
            edition: form.book_edition || null
          }
        : form.media_type === 'movie'
          ? {
              edition: String(form.movie_edition || '').trim() || 'Theatrical'
            }
        : form.media_type === 'comic_book'
          ? {
              author: form.book_author || null,
              isbn: form.book_isbn || null,
              publisher: form.book_publisher || null,
              edition: form.book_edition || null,
              series: form.comic_series || null,
              issue_number: form.comic_issue_number || null,
              volume: form.comic_volume || null,
              writer: form.comic_writer || null,
              artist: form.comic_artist || null,
              inker: form.comic_inker || null,
              colorist: form.comic_colorist || null,
              cover_date: form.comic_cover_date || null,
              provider_issue_id: form.comic_provider_issue_id || null,
              barcode_addon: form.comic_barcode_addon || null
            }
        : form.media_type === 'audio'
          ? {
              artist: form.audio_artist || null,
              album: form.audio_album || null,
              track_count: form.audio_track_count ? Number(form.audio_track_count) : null
            }
          : form.media_type === 'game'
            ? {
                platform: form.game_platform || null,
                developer: form.game_developer || null,
                region: form.game_region || null
              }
            : null;
      const payload = {
        media_type: form.media_type,
        title: String(form.title || '').trim(),
        original_title: isMovieOrTv ? (String(form.original_title || '').trim() || null) : null,
        release_date: normalizeDateInput(form.release_date) || null,
        year: form.year ? Number(form.year) : null,
        owned_formats: sortOwnedFormats(form.media_type, form.owned_formats || []),
        genre: String(form.genre || '').trim() || null,
        director: isMovieOrTv ? (String(form.director || '').trim() || null) : null,
        cast: isMovieOrTv ? (String(form.cast || '').trim() || null) : null,
        rating: isMovieOrTv ? (form.rating ? Number(form.rating) : null) : null,
        user_rating: form.user_rating ? Number(form.user_rating) : null,
        runtime: isMovieOrTv ? (form.runtime ? Number(form.runtime) : null) : null,
        upc: String(form.upc || '').trim() || null,
        location: String(form.location || '').trim() || null,
        notes: String(form.notes || '').trim() || null,
        overview: clampOverviewText(form.overview) || null,
        tmdb_id: isMovieOrTv ? (form.tmdb_id ? Number(form.tmdb_id) : null) : null,
        tmdb_media_type: isMovieOrTv ? (form.tmdb_media_type || null) : null,
        tmdb_url: form.tmdb_url ? String(form.tmdb_url).trim() || null : null,
        trailer_url: isMovieOrTv ? (form.trailer_url ? String(form.trailer_url).trim() || null : null) : null,
        poster_path: form.poster_path ? String(form.poster_path).trim() || null : null,
        backdrop_path: isMovieOrTv ? (form.backdrop_path ? String(form.backdrop_path).trim() || null : null) : null,
        signed_by: form.signed_by ? String(form.signed_by).trim() || null : null,
        signed_role: form.signed_role || null,
        signed_on: normalizeDateInput(form.signed_on) || null,
        signed_at: form.signed_at ? String(form.signed_at).trim() || null : null,
        signed_proof_path: form.signed_proof_path ? String(form.signed_proof_path).trim() || null : null,
        type_details: typeDetails
      };

      if (['tv_series', 'tv_episode'].includes(form.media_type)) {
        payload.season_number = form.season_number ? Number(form.season_number) : null;
        payload.episode_number = form.episode_number ? Number(form.episode_number) : null;
        payload.episode_title = String(form.episode_title || '').trim() || null;
        payload.network = String(form.network || '').trim() || null;
      }

      const saved = await onSave(payload);
      if (form.media_type === 'tv_series' && saved?.id && parsedTvSeasons.length > 0) {
        await apiCall('put', `/media/${saved.id}/tv-seasons`, { seasons: parsedTvSeasons });
      }
    } catch (e2) {
      notify(e2.response?.data?.error || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const lookupSummary = appliedLookupSummary || {
    title: resolveLookupTitle() || 'Search title or identifier',
    identifier: resolveLookupIdentifier(),
    sourceLabels: [],
    provider: ''
  };
  const lookupSummaryMeta = [
    ...(lookupSummary.sourceLabels || []),
    lookupSummary.provider || '',
    lookupSummary.identifier ? `ID ${lookupSummary.identifier}` : ''
  ].filter(Boolean);
  const searchActionLabel = (form.id || appliedLookupSummary) ? 'Search again' : 'Search';
  const showLookupOverlay = Boolean(canUniversalLookup && lookupPanelExpanded && lookupOverlayTop !== null && (lookupMatches.length > 0 || lookupError));

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-edge shrink-0">
        <button onClick={onCancel} className="btn-icon btn-sm"><Icons.ChevronLeft /></button>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold leading-tight text-ink truncate">{title}</h2>
        </div>
        {canConvertToCollection && (
          <button
            type="button"
            onClick={async () => {
              if (window.confirm('Convert this title to a collection? This removes the title entry and creates a collection.')) {
                try {
                  await onConvertToCollection();
                  notify('Converted to collection');
                } catch (err) {
                  notify(err?.response?.data?.error || 'Convert to collection failed', 'error');
                }
              }
            }}
            className="btn-secondary btn-sm"
          >
            Convert to Collection
          </button>
        )}
        {onDelete && (
          <button onClick={() => { if (window.confirm('Delete this item?')) onDelete(); }} className="btn-danger btn-sm"><Icons.Trash />Delete</button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scroll-area">
        <div className="p-6 space-y-6 pb-32">
          <SectionTabs
            tabs={editorTabs}
            activeId={activeEditorTab}
            onChange={setActiveEditorTab}
            showIndex
            stretch
            ariaLabel="Editor steps"
            idBase="media-editor-steps"
          />

          <div className="space-y-4 border-t border-edge/60 pt-3">
            <SectionTabPanel activeId={activeEditorTab} tabKey="core" idBase="media-editor-steps">
              <>
                <SectionTabs
                  tabs={ENTRY_MEDIA_TABS.map((tab) => ({ id: tab.value, label: tab.label }))}
                  activeId={activeMediaTypeTab}
                  onChange={handleMediaTypeChange}
                  ariaLabel="Media types"
                  className="pb-1"
                  listClassName="lg:max-w-[34rem]"
                  idBase="media-type-tabs"
                  semantics="buttons"
                />

                <div className="relative">
                {canUniversalLookup && (
                  <div className="border-b border-edge/60 pb-4" ref={lookupPanelMeasureRef}>
                    {lookupPanelExpanded ? (
                      <div className="space-y-4 pt-3" aria-label="Search panel">
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
                          <LabeledField label={isAudio ? 'Album Title' : 'Title'} className={canIdentifierLookup ? 'md:col-span-7' : 'md:col-span-12'}>
                            <input
                              className="input min-w-0"
                              placeholder={form.media_type === 'movie' ? 'Movie title' : isAudio ? 'Album title' : 'Title'}
                              value={form.title}
                              onChange={(e) => set({ title: e.target.value })}
                            />
                          </LabeledField>

                          {canIdentifierLookup && (
                            <LabeledField label={isBook ? 'ISBN / UPC' : isComic ? 'ISBN / UPC' : 'Identifier'} className="md:col-span-5">
                              {isBook ? (
                                <div className="flex flex-wrap gap-2 md:flex-nowrap">
                                  <input
                                    className="input min-w-0 flex-1 font-mono"
                                    placeholder="055357275X, 9780553572755, or 012345678901"
                                    value={bookIdentifierInput}
                                    onChange={(e) => handleBookIdentifierChange(e.target.value)}
                                  />
                                  <button type="button" onClick={() => lookupCaptureInputRef.current?.click()} disabled={lookupCaptureLoading} className="btn-secondary btn-sm shrink-0 min-w-[76px]">
                                    {lookupCaptureLoading ? <Spinner size={14} /> : <><Icons.Camera />Scan</>}
                                  </button>
                                </div>
                              ) : isComic ? (
                                <div className="flex flex-wrap gap-2 md:flex-nowrap">
                                  <input
                                    className="input min-w-0 flex-1 font-mono"
                                    placeholder="012345678901 01 or 9781565048010"
                                    value={comicIdentifierInput}
                                    onChange={(e) => handleComicIdentifierChange(e.target.value)}
                                  />
                                  <button type="button" onClick={() => lookupCaptureInputRef.current?.click()} disabled={lookupCaptureLoading} className="btn-secondary btn-sm shrink-0 min-w-[76px]">
                                    {lookupCaptureLoading ? <Spinner size={14} /> : <><Icons.Camera />Scan</>}
                                  </button>
                                </div>
                              ) : (
                                <div className="flex flex-wrap gap-2 md:flex-nowrap">
                                  <input
                                    className="input min-w-0 flex-1 font-mono"
                                    placeholder="012345678901"
                                    value={form.upc}
                                    onChange={(e) => set({ upc: normalizeBarcodeInput(e.target.value) })}
                                  />
                                  <button type="button" onClick={() => lookupCaptureInputRef.current?.click()} disabled={lookupCaptureLoading} className="btn-secondary btn-sm shrink-0 min-w-[76px]">
                                    {lookupCaptureLoading ? <Spinner size={14} /> : <><Icons.Camera />Scan</>}
                                  </button>
                                </div>
                              )}
                            </LabeledField>
                          )}
                        </div>

                        {isBook && <BookCaptureStatusCard state={bookCaptureState} />}

                        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-edge/60 pt-3">
                          <div className="text-sm text-ghost">Use title or identifier.</div>
                          <div className="flex flex-wrap gap-2">
                            {appliedLookupSummary ? (
                              <button type="button" onClick={clearAppliedLookupSummary} className="btn-secondary btn-sm">
                                Clear match
                              </button>
                            ) : null}
                            <button type="button" onClick={() => runUniversalLookup()} disabled={lookupLoading} className="btn-secondary btn-sm min-w-[84px]">
                              {lookupLoading ? <Spinner size={14} /> : <><Icons.Search />Search</>}
                            </button>
                          </div>
                        </div>

                        <input
                          ref={lookupCaptureInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleLookupCapture}
                        />
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-3" aria-label="Search summary">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-ink">{lookupSummary.title}</p>
                          {lookupSummaryMeta.length > 0 ? (
                            <p className="mt-1 text-xs text-ghost">{lookupSummaryMeta.join(' · ')}</p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {appliedLookupSummary ? (
                            <button type="button" onClick={clearAppliedLookupSummary} className="btn-secondary btn-sm">
                              Clear match
                            </button>
                          ) : null}
                          <button type="button" onClick={() => patchLookupPanel({ expanded: true })} className="btn-secondary btn-sm">
                            {searchActionLabel}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex flex-col gap-5 pt-3 lg:flex-row lg:items-start">
                  <div className="w-full shrink-0 lg:w-32 xl:w-28">
                    <div className="space-y-3">
                      <button
                        type="button"
                        onClick={() => coverImageInputRef.current?.click()}
                        disabled={coverUploadLoading}
                        className="poster relative w-full overflow-hidden rounded-md border border-edge bg-panel text-left transition-colors hover:border-muted disabled:cursor-not-allowed"
                      >
                        {posterUrl(form.poster_path)
                          ? <img src={posterUrl(form.poster_path)} alt="poster" className="absolute inset-0 w-full h-full object-cover" />
                          : <div className="absolute inset-0 flex items-center justify-center text-ghost"><Icons.Film /></div>}
                        <div className="absolute inset-x-0 bottom-0 border-t border-edge bg-panel/95 p-3">
                          <p className="text-sm font-medium text-ink">{form.poster_path ? 'Replace cover' : 'Add cover'}</p>
                          {!form.poster_path ? <p className="text-[11px] leading-4 text-dim">Photo library, camera, or file</p> : null}
                        </div>
                      </button>
                      {form.poster_path ? (
                        <button type="button" onClick={() => set({ poster_path: '' })} disabled={coverUploadLoading} className="btn-secondary btn-sm w-full text-err">
                          <Icons.Trash />Remove cover
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className="min-w-0 flex-1 space-y-4 xl:max-w-[28rem] 2xl:max-w-[30rem]">
                    {isMovieOrTv && (
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
                        <LabeledField label="Original Title" className="md:col-span-12">
                          <input className="input" value={form.original_title} onChange={(e) => set({ original_title: e.target.value })} />
                        </LabeledField>
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
                      {(isMovieOrTv || isBook || isComic || isAudio || isGame) && (
                        <LabeledField label="Owned Formats" className="md:col-span-12">
                          <OwnedFormatPicker mediaType={form.media_type} value={form.owned_formats || []} onChange={setOwnedFormats} />
                        </LabeledField>
                      )}
                      {!isGame && (
                        <LabeledField label="Year" className={cx('md:col-span-3 xl:col-span-2', isComic && 'md:col-span-2 xl:col-span-2')}>
                          <input className="input" placeholder="2024" value={form.year} onChange={(e) => set({ year: e.target.value })} inputMode="numeric" />
                        </LabeledField>
                      )}
                      {isMovieOrTv && (
                        <LabeledField label="Runtime (min)" className="md:col-span-4 xl:col-span-3">
                          <input className="input" inputMode="numeric" value={form.runtime} onChange={(e) => set({ runtime: e.target.value })} />
                        </LabeledField>
                      )}
                      {form.media_type === 'movie' && (
                        <LabeledField label="Edition" className="md:col-span-2 xl:col-span-3">
                          <input className="input" placeholder="Theatrical" value={form.movie_edition} onChange={(e) => set({ movie_edition: e.target.value })} />
                        </LabeledField>
                      )}
                      {isComic && (
                        <LabeledField label="Issue #" className="md:col-span-3 xl:col-span-2">
                          <input className="input" inputMode="numeric" value={form.comic_issue_number} onChange={(e) => set({ comic_issue_number: e.target.value })} />
                        </LabeledField>
                      )}
                      {isComic && (
                        <LabeledField label="Volume" className="md:col-span-3 xl:col-span-2">
                          <input className="input" inputMode="numeric" value={form.comic_volume} onChange={(e) => set({ comic_volume: e.target.value })} />
                        </LabeledField>
                      )}
                    </div>

                    <input
                      ref={coverImageInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleCoverImageSelection}
                      className="hidden"
                    />
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:max-w-[28rem] 2xl:max-w-[30rem]">
                  {isMovieOrTv && (
                    <>
                      <LabeledField label="Genre"><input className="input" placeholder="Action, Drama…" value={form.genre} onChange={(e) => set({ genre: e.target.value })} /></LabeledField>
                      <LabeledField label="Release Date"><input className="input" type="date" value={form.release_date} onChange={(e) => set({ release_date: e.target.value })} /></LabeledField>
                    </>
                  )}

                  {isBook && (
                    <>
                      <LabeledField label="Author"><input className="input" value={form.book_author} onChange={(e) => set({ book_author: e.target.value })} /></LabeledField>
                      <LabeledField label="Publisher"><input className="input" value={form.book_publisher} onChange={(e) => set({ book_publisher: e.target.value })} /></LabeledField>
                      <LabeledField label="Edition"><input className="input" value={form.book_edition} onChange={(e) => set({ book_edition: e.target.value })} /></LabeledField>
                      <LabeledField label="Genre"><input className="input" value={form.genre} onChange={(e) => set({ genre: e.target.value })} /></LabeledField>
                    </>
                  )}

                  {isComic && (
                    <>
                      <LabeledField label="Author"><input className="input" value={form.book_author} onChange={(e) => set({ book_author: e.target.value })} /></LabeledField>
                      <LabeledField label="Publisher"><input className="input" value={form.book_publisher} onChange={(e) => set({ book_publisher: e.target.value })} /></LabeledField>
                      <LabeledField label="Series"><input className="input" value={form.comic_series} onChange={(e) => set({ comic_series: e.target.value })} /></LabeledField>
                      <LabeledField label="Writer"><input className="input" value={form.comic_writer} onChange={(e) => set({ comic_writer: e.target.value })} /></LabeledField>
                      <LabeledField label="Artist"><input className="input" value={form.comic_artist} onChange={(e) => set({ comic_artist: e.target.value })} /></LabeledField>
                      <LabeledField label="Inker"><input className="input" value={form.comic_inker} onChange={(e) => set({ comic_inker: e.target.value })} /></LabeledField>
                      <LabeledField label="Colorist"><input className="input" value={form.comic_colorist} onChange={(e) => set({ comic_colorist: e.target.value })} /></LabeledField>
                      <LabeledField label="Cover Date"><input className="input" type="date" value={form.comic_cover_date} onChange={(e) => set({ comic_cover_date: e.target.value })} /></LabeledField>
                    </>
                  )}

                  {isGame && (
                    <>
                      <LabeledField label="Platform"><input className="input" value={form.game_platform} onChange={(e) => set({ game_platform: e.target.value })} /></LabeledField>
                      <LabeledField label="Developer"><input className="input" value={form.game_developer} onChange={(e) => set({ game_developer: e.target.value })} /></LabeledField>
                      <LabeledField label="Genre"><input className="input" value={form.genre} onChange={(e) => set({ genre: e.target.value })} /></LabeledField>
                      <LabeledField label="Release Date"><input className="input" type="date" value={form.release_date} onChange={(e) => set({ release_date: e.target.value })} /></LabeledField>
                    </>
                  )}

                  {isAudio && (
                    <>
                      <LabeledField label="Artist"><input className="input" value={form.audio_artist} onChange={(e) => set({ audio_artist: e.target.value })} /></LabeledField>
                      <LabeledField label="Track Count"><input className="input" inputMode="numeric" value={form.audio_track_count} onChange={(e) => set({ audio_track_count: e.target.value })} /></LabeledField>
                      <LabeledField label="Release Date"><input className="input" type="date" value={form.release_date} onChange={(e) => set({ release_date: e.target.value })} /></LabeledField>
                    </>
                  )}
                  {form.media_type === 'tv_episode' && (
                    <>
                      <LabeledField label="Season"><input className="input" inputMode="numeric" value={form.season_number} onChange={(e) => set({ season_number: e.target.value })} /></LabeledField>
                      <LabeledField label="Episode"><input className="input" inputMode="numeric" value={form.episode_number} onChange={(e) => set({ episode_number: e.target.value })} /></LabeledField>
                      <LabeledField label="Episode Title" className="md:col-span-2"><input className="input" value={form.episode_title} onChange={(e) => set({ episode_title: e.target.value })} /></LabeledField>
                    </>
                  )}

                  {!isMovieOrTv && <LabeledField label="Your Rating" className="md:col-span-2"><StarRating value={userRatingToStars(form.user_rating)} onChange={(v) => set({ user_rating: starsToUserRating(v) })} /></LabeledField>}
                </div>

                {isMovieOrTv && (
                  <div className={cx('mt-3 grid grid-cols-1 gap-3 xl:max-w-[28rem] 2xl:max-w-[30rem]', form.media_type === 'tv_series' ? 'md:grid-cols-3' : 'md:grid-cols-2')}>
                    {form.media_type === 'tv_series' && (
                      <LabeledField label="Owned Seasons">
                        <input className="input" placeholder="1, 2, 3" value={tvSeasonsText} onChange={(e) => setTvSeasonsText(e.target.value)} />
                      </LabeledField>
                    )}
                    <LabeledField label="TMDB Rating">
                      <input className="input" inputMode="decimal" placeholder="0.0 – 10.0" value={form.rating} onChange={(e) => set({ rating: e.target.value })} />
                    </LabeledField>
                    <LabeledField label="Your Rating">
                      <StarRating value={userRatingToStars(form.user_rating)} onChange={(v) => set({ user_rating: starsToUserRating(v) })} />
                    </LabeledField>
                  </div>
                )}
                {showLookupOverlay && (
                  <div
                    aria-label="Search results overlay"
                    className="absolute inset-x-0 bottom-0 z-20 overflow-hidden border-t border-edge/60 bg-abyss"
                    style={{ top: `${lookupOverlayTop}px` }}
                  >
                    <div className="h-full overflow-y-auto scroll-area px-1 py-3">
                      {lookupMatches.length > 0 ? (
                        <div>
                          {lookupMatches.map((m, i) => {
                            const title = m?.typeEnrichment?.title || m?.book?.title || m?.normalizedTitle || m.tmdb?.title || m.title || 'Unknown';
                            const providerLabel = resolveLookupProviderLabel(m);
                            const supportingDetail = m?.typeEnrichment?.type_details?.artist
                              || m?.typeEnrichment?.type_details?.platform
                              || m?.typeEnrichment?.type_details?.series
                              || m?.book?.type_details?.author
                              || m?.typeDetails?.author
                              || m.description
                              || '';
                            const thumbnailSrc = posterUrl(resolveLookupThumbnailPath(m));
                            return (
                              <button
                                key={i}
                                type="button"
                                onClick={() => applyLookupResult(m)}
                                className="flex w-full items-start gap-3 border-b border-edge/60 px-3 py-2 text-left last:border-b-0 hover:bg-panel/50"
                              >
                                <div
                                  aria-label="Search result thumbnail"
                                  className="relative mt-0.5 h-16 w-11 shrink-0 overflow-hidden rounded-[4px] border border-edge/70 bg-panel"
                                >
                                  {thumbnailSrc ? (
                                    <img src={thumbnailSrc} alt={title} className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                                  ) : (
                                    <div className="absolute inset-0 flex items-center justify-center bg-panel text-[10px] font-medium uppercase tracking-[0.18em] text-dim">
                                      {String(title).trim().charAt(0) || '?'}
                                    </div>
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="truncate text-sm font-medium text-ink">{title}</p>
                                    {(m.lookupSources || []).map((source) => (
                                      <span key={source} className="badge badge-dim">
                                        {formatLookupSourceLabel(source)}
                                      </span>
                                    ))}
                                  </div>
                                  <p className="text-xs text-ghost">
                                    {providerLabel}
                                    {(providerLabel && supportingDetail) ? ' · ' : ''}
                                    {supportingDetail}
                                  </p>
                                </div>
                                <span className="shrink-0 pt-1 text-xs text-dim">Apply</span>
                              </button>
                            );
                          })}
                        </div>
                      ) : null}

                      {lookupError ? (
                        <div className="px-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm text-ink">{lookupError?.error || 'Search failed'}</p>
                              {lookupError?.detail ? <p className="mt-1 text-xs text-ghost">{lookupError.detail}</p> : null}
                            </div>
                            {lookupError?.stage ? <span className="badge badge-dim">{lookupError.stage}</span> : null}
                          </div>
                          {lookupError?.request ? (
                            <pre className="mt-2 overflow-x-auto border border-edge bg-panel p-2 text-xs text-ghost whitespace-pre-wrap break-all">
{JSON.stringify(lookupError.request, null, 2)}
                            </pre>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}
                </div>
              </>
            </SectionTabPanel>

            <SectionTabPanel activeId={activeEditorTab} tabKey="people" idBase="media-editor-steps">
              {isMovieOrTv ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <LabeledField label="Director"><input className="input" value={form.director} onChange={(e) => set({ director: e.target.value })} /></LabeledField>
                <LabeledField label="Cast" className="md:col-span-2"><input className="input" placeholder="Actor 1, Actor 2…" value={form.cast} onChange={(e) => set({ cast: e.target.value })} /></LabeledField>
              </div>
              ) : null}
            </SectionTabPanel>

            <SectionTabPanel activeId={activeEditorTab} tabKey="signatures" idBase="media-editor-steps">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <LabeledField label="Signed by"><input className="input" value={form.signed_by} onChange={(e) => set({ signed_by: e.target.value })} /></LabeledField>
                <LabeledField label="Signed as">
                  <select className="select" value={form.signed_role} onChange={(e) => set({ signed_role: e.target.value })}>
                    <option value="">Not signed</option>
                    <option value="author">Author</option>
                    <option value="producer">Producer</option>
                    <option value="cast">Cast</option>
                  </select>
                </LabeledField>
                <LabeledField label="Signed on"><input className="input" type="date" value={form.signed_on} onChange={(e) => set({ signed_on: e.target.value })} /></LabeledField>
                <LabeledField label="Signed at"><input className="input" value={form.signed_at} onChange={(e) => set({ signed_at: e.target.value })} /></LabeledField>
                <p className="md:col-span-2 text-xs leading-5 text-ghost">Proof file upload and removal live on each signature record below, keeping media and Art evidence on the same workflow.</p>
                <SignatureManager
                  apiCall={apiCall}
                  endpointBase={form.id ? `/media/${form.id}` : ''}
                  ownerId={form.id}
                  ownerLabel="media item"
                  signatures={form.signatures || []}
                  onChange={applySignatureChange}
                />
              </div>
            </SectionTabPanel>

            <SectionTabPanel activeId={activeEditorTab} tabKey="storage" idBase="media-editor-steps">
              <div className="space-y-4">
                <LabeledField label="Storage Location"><input className="input" placeholder="Shelf A3, Box 2…" value={form.location} onChange={(e) => set({ location: e.target.value })} /></LabeledField>
                <LabeledField label="Overview">
                  <div className="space-y-1">
                    <textarea className="textarea" rows={4} value={form.overview} onChange={(e) => set({ overview: e.target.value })} />
                    <p className="text-xs text-ghost">
                      {Math.min(String(form.overview || '').trim().length, OVERVIEW_MAX_LENGTH)} / {OVERVIEW_MAX_LENGTH} characters
                    </p>
                  </div>
                </LabeledField>
                <LabeledField label="Notes"><textarea className="textarea" rows={3} value={form.notes} onChange={(e) => set({ notes: e.target.value })} /></LabeledField>

                {isMovieOrTv && (
                  <details className="group">
                    <summary className="cursor-pointer text-xs text-ghost hover:text-dim list-none flex items-center gap-2 select-none">
                      <span className="transition-transform group-open:rotate-90"><Icons.ChevronRight /></span>
                      Advanced (TMDB links, poster path)
                    </summary>
                    <div className="mt-3 grid grid-cols-1 gap-3">
                      <LabeledField label="TMDB ID" className="md:max-w-[220px]"><input className="input font-mono" value={form.tmdb_id} onChange={(e) => set({ tmdb_id: e.target.value })} /></LabeledField>
                      <LabeledField label="TMDB Media Type" className="md:max-w-[220px]"><input className="input font-mono" value={form.tmdb_media_type} onChange={(e) => set({ tmdb_media_type: e.target.value })} /></LabeledField>
                      <LabeledField label="TMDB URL"><input className="input" value={form.tmdb_url} onChange={(e) => set({ tmdb_url: e.target.value })} /></LabeledField>
                      <LabeledField label="Trailer URL"><input className="input" value={form.trailer_url} onChange={(e) => set({ trailer_url: e.target.value })} /></LabeledField>
                      <LabeledField label="Poster Path"><input className="input" value={form.poster_path} onChange={(e) => set({ poster_path: e.target.value })} /></LabeledField>
                    </div>
                  </details>
                )}
              </div>
            </SectionTabPanel>
          </div>
        </div>
      </div>
      <div className="shrink-0 border-t border-edge bg-abyss px-6 py-4 flex items-center gap-3">
        {msg && <span className={cx('text-sm flex-1', msgType === 'error' ? 'text-err' : 'text-ok')}>{msg}</span>}
        <div className="flex gap-3 ml-auto">
          <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
          <button type="button" onClick={submit} disabled={saving} className="btn-primary min-w-[100px]">{saving ? <Spinner size={16} /> : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

export default function LibraryView({
  mediaItems,
  loading,
  error,
  pagination,
  onRefresh,
  onToast,
  onOpen,
  onEdit,
  onDelete,
  onBulkDelete,
  onRating,
  apiCall,
  forcedMediaType,
  title = 'Library',
  reviewFilter = null,
  onClearReviewFilter = null,
  focusTarget = null,
  onFindPossibleDuplicates = null,
  canWritePlex = false
}) {
  const PAGE_SIZE_STORAGE_KEY = 'collectz_library_page_size';
  const VIEW_MODE_STORAGE_KEY = 'collectz_library_view_mode';
  const [searchInput, setSearchInput] = useState('');
  const [resolutionInput, setResolutionInput] = useState('all');
  const [platformInput, setPlatformInput] = useState('all');
  const [publisherInput, setPublisherInput] = useState('all');
  const normalizedReviewFilter = normalizeReviewFilter(reviewFilter);
  const [filters, setFilters] = useState({
    media_type: forcedMediaType || 'movie',
    search: '',
    resolution: 'all',
    platform: 'all',
    publisher: 'all',
    review_filter: normalizedReviewFilter,
    sortBy: forcedMediaType === 'comic_book' ? 'comic_issue' : 'title',
    sortDir: 'asc'
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => {
    const saved = Number(window.localStorage.getItem(PAGE_SIZE_STORAGE_KEY));
    return [25, 50, 100, 200].includes(saved) ? saved : 50;
  });
  const [viewMode, setViewMode] = useState(() => {
    const saved = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    return saved === 'list' ? 'list' : 'cards';
  });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [detail, setDetail] = useState(null);
  const [collectionMode, setCollectionMode] = useState('all');
  const [collectionRows, setCollectionRows] = useState([]);
  const [collectionLoading, setCollectionLoading] = useState(false);
  const [collectionError, setCollectionError] = useState('');
  const [collectionPagination, setCollectionPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
  const [comicSeriesRows, setComicSeriesRows] = useState([]);
  const [comicSeriesLoading, setComicSeriesLoading] = useState(false);
  const [comicSeriesError, setComicSeriesError] = useState('');
  const [comicSeriesPagination, setComicSeriesPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
  const [comicSeriesIssueRows, setComicSeriesIssueRows] = useState([]);
  const [comicSeriesIssueLoading, setComicSeriesIssueLoading] = useState(false);
  const [comicSeriesIssueError, setComicSeriesIssueError] = useState('');
  const [comicSeriesIssuePagination, setComicSeriesIssuePagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
  const [editingCollectionId, setEditingCollectionId] = useState(null);
  const [viewingCollectionId, setViewingCollectionId] = useState(null);
  const [comicView, setComicView] = useState('issues');
  const [comicSeries, setComicSeries] = useState('all');
  const [debouncedSearchInput, setDebouncedSearchInput] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [selectingAllMatching, setSelectingAllMatching] = useState(false);
  const selectionAnchorIdRef = useRef(null);
  const shiftPressedRef = useRef(false);
  const selectionGestureRef = useRef(false);
  const supportsHover = useMemo(() => window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches, []);
  const addFormMediaType = useMemo(() => {
    if (forcedMediaType === 'tv') return 'tv_series';
    if (['movie', 'book', 'audio', 'game', 'comic_book'].includes(forcedMediaType)) return forcedMediaType;
    return 'movie';
  }, [forcedMediaType]);
  const addFormInitial = useMemo(
    () => ({
      ...DEFAULT_MEDIA_FORM,
      media_type: addFormMediaType,
      tmdb_media_type: addFormMediaType === 'tv_series' ? 'tv' : 'movie'
    }),
    [addFormMediaType]
  );

  const activeReviewFilterLabel = reviewFilterLabel(filters.review_filter);
  const isComicsLibrary = forcedMediaType === 'comic_book';
  const supportsCollections = forcedMediaType === 'movie' || forcedMediaType === 'game';
  const isCollectionMode = supportsCollections && collectionMode === 'collections';
  const useComicSeriesIssueQuery = isComicsLibrary && comicView === 'series_issues' && comicSeries !== 'all';
  const useComicFullFetch = false;
  const requestPage = useComicFullFetch ? 1 : page;
  const requestLimit = useComicFullFetch ? 5000 : pageSize;
  const quickFilterConfig = useMemo(() => {
    if (forcedMediaType === 'movie' || forcedMediaType === 'tv') {
      return {
        key: 'resolution',
        label: 'Resolution',
        value: resolutionInput,
        options: [
          { value: 'all', label: 'All resolutions' },
          { value: 'SD', label: 'SD' },
          { value: '720p', label: '720p' },
          { value: '1080p', label: '1080p' },
          { value: '4K', label: '4K' }
        ]
      };
    }
    if (forcedMediaType === 'game') {
      const platforms = [...new Set(
        mediaItems
          .map((item) => String(item?.type_details?.platform || '').trim())
          .filter(Boolean)
      )].sort((a, b) => a.localeCompare(b));
      return {
        key: 'platform',
        label: 'Platform',
        value: platformInput,
        options: [{ value: 'all', label: 'All platforms' }, ...platforms.map((value) => ({ value, label: value }))]
      };
    }
    if (forcedMediaType === 'comic_book') {
      const publishers = [...new Set(
        mediaItems
          .map((item) => String(item?.type_details?.publisher || '').trim())
          .filter(Boolean)
      )].sort((a, b) => a.localeCompare(b));
      return {
        key: 'publisher',
        label: 'Publisher',
        value: publisherInput,
        options: [{ value: 'all', label: 'All publishers' }, ...publishers.map((value) => ({ value, label: value }))]
      };
    }
    return null;
  }, [forcedMediaType, mediaItems, platformInput, publisherInput, resolutionInput]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedSearchInput(searchInput.trim());
    }, 250);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    setFilters((f) => {
      if ((f.search || '') === debouncedSearchInput) return f;
      return { ...f, search: debouncedSearchInput };
    });
    setPage(1);
  }, [debouncedSearchInput]);

  useEffect(() => {
    if (isCollectionMode || (isComicsLibrary && (comicView === 'series' || useComicSeriesIssueQuery))) return;
    onRefresh({ page: requestPage, limit: requestLimit, ...filters });
  }, [comicView, filters, isCollectionMode, isComicsLibrary, onRefresh, page, pageSize, requestLimit, requestPage, useComicSeriesIssueQuery]);

  useEffect(() => {
    if (!forcedMediaType) return;
    setFilters((f) => ({
      ...f,
      media_type: forcedMediaType,
      resolution: 'all',
      platform: 'all',
      publisher: 'all',
      review_filter: normalizedReviewFilter,
      sortBy: forcedMediaType === 'comic_book' ? 'comic_issue' : 'title',
      sortDir: 'asc'
    }));
    setPage(1);
    setResolutionInput('all');
    setPlatformInput('all');
    setPublisherInput('all');
    setCollectionMode('all');
    setCollectionRows([]);
    setCollectionError('');
    setComicSeriesRows([]);
    setComicSeriesError('');
    setComicSeriesIssueRows([]);
    setComicSeriesIssueError('');
    if (forcedMediaType !== 'comic_book') {
      setComicView('issues');
      setComicSeries('all');
    }
  }, [forcedMediaType, normalizedReviewFilter]);

  const refreshComicSeries = useCallback(async (targetPage = page) => {
    if (!isComicsLibrary) return;
    setComicSeriesLoading(true);
    setComicSeriesError('');
    try {
      const params = new URLSearchParams();
      params.set('page', String(targetPage));
      params.set('limit', String(pageSize));
      if (debouncedSearchInput) params.set('search', debouncedSearchInput);
      if (publisherInput && publisherInput !== 'all') params.set('publisher', publisherInput);
      const payload = await apiCall('get', `/media/comic-series?${params.toString()}`);
      setComicSeriesRows(Array.isArray(payload?.items) ? payload.items : []);
      const nextPagination = payload?.pagination || { page: 1, limit: pageSize, total: 0, totalPages: 1 };
      setComicSeriesPagination({
        ...nextPagination,
        hasMore: Number(nextPagination.page || 1) < Number(nextPagination.totalPages || 1)
      });
    } catch (err) {
      setComicSeriesError(err?.response?.data?.error || 'Failed to load comic series');
    } finally {
      setComicSeriesLoading(false);
    }
  }, [apiCall, debouncedSearchInput, isComicsLibrary, page, pageSize, publisherInput]);

  useEffect(() => {
    if (!isComicsLibrary || comicView !== 'series') return undefined;
    let active = true;
    (async () => {
      if (!active) return;
      await refreshComicSeries(page);
    })();
    return () => {
      active = false;
    };
  }, [comicView, isComicsLibrary, page, refreshComicSeries]);

  const refreshComicSeriesIssues = useCallback(async (targetPage = page) => {
    if (!isComicsLibrary || comicSeries === 'all') return;
    setComicSeriesIssueLoading(true);
    setComicSeriesIssueError('');
    try {
      const params = new URLSearchParams();
      params.set('series', comicSeries);
      params.set('page', String(targetPage));
      params.set('limit', String(pageSize));
      if (debouncedSearchInput) params.set('search', debouncedSearchInput);
      if (publisherInput && publisherInput !== 'all') params.set('publisher', publisherInput);
      const payload = await apiCall('get', `/media/comic-series/issues?${params.toString()}`);
      setComicSeriesIssueRows(Array.isArray(payload?.items) ? payload.items : []);
      const nextPagination = payload?.pagination || { page: 1, limit: pageSize, total: 0, totalPages: 1 };
      setComicSeriesIssuePagination({
        ...nextPagination,
        hasMore: Number(nextPagination.page || 1) < Number(nextPagination.totalPages || 1)
      });
    } catch (err) {
      setComicSeriesIssueError(err?.response?.data?.error || 'Failed to load comic issues for series');
    } finally {
      setComicSeriesIssueLoading(false);
    }
  }, [apiCall, comicSeries, debouncedSearchInput, isComicsLibrary, page, pageSize, publisherInput]);

  useEffect(() => {
    if (!useComicSeriesIssueQuery) return undefined;
    let active = true;
    (async () => {
      if (!active) return;
      await refreshComicSeriesIssues(page);
    })();
    return () => {
      active = false;
    };
  }, [page, refreshComicSeriesIssues, useComicSeriesIssueQuery]);

  const refreshCollections = useCallback(async (targetPage = page) => {
    if (!supportsCollections) return;
    setCollectionLoading(true);
    setCollectionError('');
    try {
      const params = new URLSearchParams();
      params.set('media_type', forcedMediaType || 'movie');
      params.set('page', String(targetPage));
      params.set('limit', String(pageSize));
      if (debouncedSearchInput) params.set('search', debouncedSearchInput);
      const payload = await apiCall('get', `/media/collections?${params.toString()}`);
      setCollectionRows(Array.isArray(payload?.items) ? payload.items : []);
      const nextPagination = payload?.pagination || { page: 1, limit: pageSize, total: 0, totalPages: 1 };
      setCollectionPagination({
        ...nextPagination,
        hasMore: Number(nextPagination.page || 1) < Number(nextPagination.totalPages || 1)
      });
    } catch (err) {
      setCollectionError(err?.response?.data?.error || 'Failed to load collections');
    } finally {
      setCollectionLoading(false);
    }
  }, [apiCall, debouncedSearchInput, forcedMediaType, page, pageSize, supportsCollections]);

  useEffect(() => {
    if (!supportsCollections) return undefined;
    let active = true;
    (async () => {
      if (!active) return;
      await refreshCollections(page);
    })();
    return () => {
      active = false;
    };
  }, [supportsCollections, page, refreshCollections]);

  useEffect(() => {
    window.localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(pageSize));
  }, [pageSize]);

  useEffect(() => {
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
  }, [viewMode]);

  const rate = async (id, rating) => {
    await onRating(id, rating);
    setDetail((d) => (d && d.id === id ? { ...d, user_rating: rating } : d));
  };

  const refreshDetailItem = useCallback(async (mediaId) => {
    const fresh = await apiCall('get', `/media/${mediaId}`);
    setDetail((current) => (current && Number(current.id) === Number(mediaId) ? fresh : current));
    onRefresh({ page: requestPage, limit: requestLimit, ...filters });
    return fresh;
  }, [apiCall, filters, onRefresh, requestLimit, requestPage]);

  useEffect(() => {
    if (focusTarget?.entityType !== 'media' || !focusTarget?.entityId) return undefined;
    let active = true;
    (async () => {
      try {
        const fresh = await apiCall('get', `/media/${focusTarget.entityId}`);
        if (active) setDetail(fresh);
      } catch (_) {
        if (active && focusTarget.title) {
          setSearchInput(String(focusTarget.title));
          setFilters((prev) => ({ ...prev, search: String(focusTarget.title) }));
          setPage(1);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [apiCall, focusTarget?.createdAt, focusTarget?.entityId, focusTarget?.entityType, focusTarget?.title]);

  const displayedTotal = isCollectionMode
    ? (collectionPagination?.total ?? collectionRows.length)
    : (isComicsLibrary && comicView === 'series')
      ? (comicSeriesPagination?.total ?? comicSeriesRows.length)
    : useComicSeriesIssueQuery
      ? (comicSeriesIssuePagination?.total ?? comicSeriesIssueRows.length)
    : ((pagination?.total ?? mediaItems.length) + (supportsCollections ? collectionRows.length : 0));
  const selectionScopeLabel = useMemo(() => {
    switch (forcedMediaType) {
      case 'movie':
        return 'movies';
      case 'tv':
        return 'TV titles';
      case 'book':
        return 'books';
      case 'audio':
        return 'audio titles';
      case 'game':
        return 'games';
      case 'comic_book':
        return 'comics';
      default:
        return 'titles';
    }
  }, [forcedMediaType]);

  const comicSeriesOptions = useMemo(() => {
    const map = new Map();
    for (const item of mediaItems) {
      const key = getComicSeriesName(item);
      map.set(key, (map.get(key) || 0) + 1);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }));
  }, [mediaItems]);

  const comicSeriesSummaries = useMemo(() => {
    if (isComicsLibrary && comicView === 'series') return comicSeriesRows;
    const bySeries = new Map();
    for (const item of mediaItems) {
      const seriesName = getComicSeriesName(item);
      const entry = bySeries.get(seriesName) || { name: seriesName, count: 0, yearMin: null, yearMax: null, poster_path: null };
      entry.count += 1;
      if (Number.isFinite(Number(item.year))) {
        const year = Number(item.year);
        entry.yearMin = entry.yearMin === null ? year : Math.min(entry.yearMin, year);
        entry.yearMax = entry.yearMax === null ? year : Math.max(entry.yearMax, year);
      }
      if (!entry.poster_path && item.poster_path) entry.poster_path = item.poster_path;
      bySeries.set(seriesName, entry);
    }
    return [...bySeries.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [comicSeriesRows, comicView, isComicsLibrary, mediaItems]);

  const visibleItems = useMemo(() => {
    if (!isComicsLibrary) return mediaItems;
    let items = useComicSeriesIssueQuery ? comicSeriesIssueRows : mediaItems;
    if (comicView === 'issues') {
      return items;
    }
    if (comicView === 'series_issues') {
      return useComicSeriesIssueQuery ? items : [...items].sort(compareComicIssueOrder);
    }
    return items;
  }, [comicSeries, comicSeriesIssueRows, comicView, isComicsLibrary, mediaItems, useComicSeriesIssueQuery]);

  useEffect(() => {
    const availableIds = new Set(mediaItems.map((item) => Number(item.id)).filter((id) => Number.isFinite(id) && id > 0));
    setSelectedIds((prev) => prev.filter((id) => availableIds.has(Number(id))));
  }, [mediaItems]);

  useEffect(() => {
    if (isCollectionMode || (isComicsLibrary && comicView === 'series')) {
      setSelectedIds([]);
      selectionAnchorIdRef.current = null;
      selectionGestureRef.current = false;
    }
  }, [comicView, isCollectionMode, isComicsLibrary]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Shift') shiftPressedRef.current = true;
    };
    const handleKeyUp = (event) => {
      if (event.key === 'Shift') shiftPressedRef.current = false;
    };
    const handleBlur = () => {
      shiftPressedRef.current = false;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  const inlineCards = useMemo(() => {
    if (!supportsCollections || isCollectionMode || isComicsLibrary || viewMode !== 'cards') return null;
    const toSortTitle = (value) => String(value || '').trim().toLowerCase();
    const mixed = [
      ...collectionRows.map((collection) => ({
        kind: 'collection',
        id: `collection-${collection.id}`,
        sortTitle: toSortTitle(collection.name || collection.source_title || ''),
        item: collection
      })),
      ...visibleItems.map((media) => ({
        kind: 'media',
        id: `media-${media.id}`,
        sortTitle: toSortTitle(media.title || ''),
        item: media
      }))
    ];
    mixed.sort((a, b) => {
      const titleCmp = a.sortTitle.localeCompare(b.sortTitle, undefined, { sensitivity: 'base' });
      if (titleCmp !== 0) return filters.sortDir === 'asc' ? titleCmp : -titleCmp;
      if (a.kind !== b.kind) return a.kind === 'collection' ? -1 : 1;
      return String(a.id).localeCompare(String(b.id));
    });
    return mixed;
  }, [collectionRows, filters.sortDir, isCollectionMode, isComicsLibrary, supportsCollections, viewMode, visibleItems]);

  const renderedCardEntries = useMemo(() => {
    if (viewMode !== 'cards' || isCollectionMode || (isComicsLibrary && comicView === 'series')) return [];
    return inlineCards || visibleItems.map((item) => ({ kind: 'media', id: `media-${item.id}`, item }));
  }, [comicView, inlineCards, isCollectionMode, isComicsLibrary, viewMode, visibleItems]);

  const comicPagedState = useMemo(() => {
    if (!isComicsLibrary || !useComicFullFetch) {
      return {
        items: visibleItems,
        cardEntries: renderedCardEntries,
        seriesSummaries: comicSeriesSummaries,
        totalPages: comicView === 'series'
          ? (comicSeriesPagination?.totalPages || 1)
          : useComicSeriesIssueQuery
            ? (comicSeriesIssuePagination?.totalPages || 1)
          : (pagination?.totalPages || 1),
        hasMore: comicView === 'series'
          ? (comicSeriesPagination?.hasMore || false)
          : useComicSeriesIssueQuery
            ? (comicSeriesIssuePagination?.hasMore || false)
          : (pagination?.hasMore || false)
      };
    }
    const sourceLength = comicView === 'series'
      ? comicSeriesSummaries.length
      : (viewMode === 'cards' ? renderedCardEntries.length : visibleItems.length);
    const totalPages = sourceLength > 0 ? Math.max(1, Math.ceil(sourceLength / pageSize)) : 1;
    const clampedPage = Math.min(page, totalPages);
    const start = (clampedPage - 1) * pageSize;
    const end = start + pageSize;
    return {
      items: visibleItems.slice(start, end),
      cardEntries: renderedCardEntries.slice(start, end),
      seriesSummaries: comicSeriesSummaries.slice(start, end),
      totalPages,
      hasMore: clampedPage < totalPages
    };
  }, [comicSeriesIssuePagination?.hasMore, comicSeriesIssuePagination?.totalPages, comicSeriesPagination?.hasMore, comicSeriesPagination?.totalPages, comicSeriesSummaries, comicView, isComicsLibrary, page, pageSize, pagination?.hasMore, pagination?.totalPages, renderedCardEntries, useComicFullFetch, useComicSeriesIssueQuery, viewMode, visibleItems]);

  const displayedVisibleItems = isComicsLibrary ? comicPagedState.items : visibleItems;
  const displayedCardEntries = isComicsLibrary ? comicPagedState.cardEntries : renderedCardEntries;
  const displayedComicSeriesSummaries = isComicsLibrary ? comicPagedState.seriesSummaries : comicSeriesSummaries;
  const footerTotalPages = isCollectionMode
    ? (collectionPagination?.totalPages || 1)
    : (isComicsLibrary ? comicPagedState.totalPages : (pagination?.totalPages || 1));
  const footerHasMore = isCollectionMode
    ? Boolean(collectionPagination?.hasMore)
    : (isComicsLibrary ? comicPagedState.hasMore : Boolean(pagination?.hasMore));
  const filtersPending = useMemo(() => {
    const normalizedSearchInput = searchInput.trim();
    return normalizedSearchInput !== debouncedSearchInput
      || debouncedSearchInput !== (filters.search || '')
      || resolutionInput !== filters.resolution
      || platformInput !== filters.platform
      || publisherInput !== filters.publisher;
  }, [
    debouncedSearchInput,
    filters.platform,
    filters.publisher,
    filters.resolution,
    filters.search,
    platformInput,
    publisherInput,
    resolutionInput,
    searchInput
  ]);

  useEffect(() => {
    if (!isComicsLibrary) return;
    if (page > comicPagedState.totalPages) {
      setPage(comicPagedState.totalPages);
    }
  }, [comicPagedState.totalPages, isComicsLibrary, page]);

  const visibleSelectableIds = useMemo(() => {
    if (isCollectionMode || (isComicsLibrary && comicView === 'series')) return [];
    if (viewMode === 'cards') {
      return displayedCardEntries
        .filter((entry) => entry.kind === 'media')
        .map((entry) => Number(entry.item.id))
        .filter((id) => Number.isFinite(id) && id > 0);
    }
    return displayedVisibleItems.map((item) => Number(item.id)).filter((id) => Number.isFinite(id) && id > 0);
  }, [comicView, displayedCardEntries, displayedVisibleItems, isCollectionMode, isComicsLibrary, viewMode]);
  const selectedIdSet = useMemo(() => new Set(selectedIds.map((id) => Number(id))), [selectedIds]);
  const selectedVisibleCount = useMemo(
    () => visibleSelectableIds.filter((id) => selectedIdSet.has(id)).length,
    [selectedIdSet, visibleSelectableIds]
  );
  const allVisibleSelected = visibleSelectableIds.length > 0 && selectedVisibleCount === visibleSelectableIds.length;
  const selectableResultTotal = useMemo(() => {
    if (isCollectionMode || (isComicsLibrary && comicView === 'series')) return 0;
    if (useComicFullFetch) return visibleItems.length;
    return Number(pagination?.total ?? mediaItems.length ?? 0);
  }, [comicView, isCollectionMode, mediaItems.length, pagination?.total, useComicFullFetch, visibleItems.length]);
  const allMatchingSelected = selectableResultTotal > 0 && selectedIds.length === selectableResultTotal;
  const showSelectAllMatchingPrompt = allVisibleSelected
    && selectableResultTotal > visibleSelectableIds.length
    && !allMatchingSelected;
  const canSelectVisiblePage = visibleSelectableIds.length > 0 && !allVisibleSelected;
  const showSelectionControls = !isCollectionMode && !(isComicsLibrary && comicView === 'series');
  const selectionControlsPending = loading || filtersPending;
  const hasResultsTabs = supportsCollections || isComicsLibrary;

  const noteSelectionGesture = useCallback((event) => {
    selectionGestureRef.current = Boolean(event?.shiftKey || shiftPressedRef.current);
  }, []);
  const comicSeriesViewActive = isComicsLibrary && comicView === 'series';
  const comicSeriesIssuesViewActive = isComicsLibrary && comicView === 'series_issues' && useComicSeriesIssueQuery;
  const activeMediaError = comicSeriesViewActive
    ? comicSeriesError
    : comicSeriesIssuesViewActive
      ? comicSeriesIssueError
      : error;
  const activeMediaLoading = comicSeriesViewActive
    ? comicSeriesLoading
    : comicSeriesIssuesViewActive
      ? comicSeriesIssueLoading
      : loading;
  const activeMediaResultCount = comicSeriesViewActive
    ? comicSeriesRows.length
    : comicSeriesIssuesViewActive
      ? comicSeriesIssueRows.length
      : mediaItems.length;

  const toggleSelectedId = useCallback((idRaw, event = null) => {
    const id = Number(idRaw);
    if (!Number.isFinite(id) || id <= 0) return;
    const shiftKey = Boolean(event?.shiftKey || shiftPressedRef.current || selectionGestureRef.current);
    const anchorIdBeforeToggle = selectionAnchorIdRef.current;
    selectionGestureRef.current = false;
    setSelectedIds((prev) => {
      const prevSet = new Set(prev.map((entry) => Number(entry)));
      const anchorId = Number(anchorIdBeforeToggle);
      const anchorIndex = visibleSelectableIds.indexOf(anchorId);
      const targetIndex = visibleSelectableIds.indexOf(id);
      if (shiftKey && anchorIdBeforeToggle !== null) {
        if (anchorIndex !== -1 && targetIndex !== -1) {
          const [start, end] = anchorIndex <= targetIndex
            ? [anchorIndex, targetIndex]
            : [targetIndex, anchorIndex];
          const next = new Set(prevSet);
          visibleSelectableIds.slice(start, end + 1).forEach((entryId) => next.add(entryId));
          return [...next];
        }
      }
      if (prevSet.has(id)) prevSet.delete(id);
      else prevSet.add(id);
      return [...prevSet];
    });
    selectionAnchorIdRef.current = id;
  }, [visibleSelectableIds]);

  const handleSelectAllVisible = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      visibleSelectableIds.forEach((id) => next.add(id));
      return [...next];
    });
    if (visibleSelectableIds.length > 0) {
      selectionAnchorIdRef.current = visibleSelectableIds[visibleSelectableIds.length - 1];
    }
  }, [visibleSelectableIds]);

  const handleSelectAllMatching = useCallback(async () => {
    if (selectingAllMatching || selectableResultTotal <= visibleSelectableIds.length) return;
    setSelectingAllMatching(true);
    try {
      if (useComicFullFetch) {
        const allIds = visibleItems
          .map((item) => Number(item.id))
          .filter((id) => Number.isFinite(id) && id > 0);
        setSelectedIds([...new Set(allIds)]);
        selectionAnchorIdRef.current = allIds.length > 0 ? allIds[allIds.length - 1] : null;
        return;
      }

      const pageLimit = 200;
      const paramsForPage = (targetPage) => {
        const params = new URLSearchParams();
        params.set('page', String(targetPage));
        params.set('limit', String(pageLimit));
        if (filters.media_type && filters.media_type !== 'all') params.set('media_type', filters.media_type);
        if (filters.search) params.set('search', filters.search);
        if (filters.sortBy) params.set('sortBy', filters.sortBy);
        if (filters.sortDir) params.set('sortDir', filters.sortDir);
        if (filters.resolution && filters.resolution !== 'all') params.set('resolution', filters.resolution);
        if (filters.platform && filters.platform !== 'all') params.set('platform', filters.platform);
        if (filters.publisher && filters.publisher !== 'all') params.set('publisher', filters.publisher);
        if (filters.review_filter) params.set('review_filter', filters.review_filter);
        return params;
      };

      const firstPayload = await apiCall('get', `/media?${paramsForPage(1).toString()}`);
      const collectedIds = new Set(
        (Array.isArray(firstPayload?.items) ? firstPayload.items : [])
          .map((item) => Number(item.id))
          .filter((id) => Number.isFinite(id) && id > 0)
      );
      const totalPages = Math.max(1, Number(firstPayload?.pagination?.totalPages || 1));

      for (let targetPage = 2; targetPage <= totalPages; targetPage += 1) {
        const payload = await apiCall('get', `/media?${paramsForPage(targetPage).toString()}`);
        (Array.isArray(payload?.items) ? payload.items : []).forEach((item) => {
          const id = Number(item.id);
          if (Number.isFinite(id) && id > 0) collectedIds.add(id);
        });
      }

      const nextIds = [...collectedIds];
      setSelectedIds(nextIds);
      selectionAnchorIdRef.current = nextIds.length > 0 ? nextIds[nextIds.length - 1] : null;
    } catch (error) {
      onToast?.(error?.response?.data?.error || `Failed to select all ${selectionScopeLabel}`, 'error');
    } finally {
      setSelectingAllMatching(false);
    }
  }, [
    apiCall,
    filters.media_type,
    filters.platform,
    filters.publisher,
    filters.resolution,
    filters.search,
    filters.sortBy,
    filters.sortDir,
    onToast,
    selectableResultTotal,
    selectingAllMatching,
    selectionScopeLabel,
    useComicFullFetch,
    visibleItems,
    visibleSelectableIds.length
  ]);

  const handleClearSelection = useCallback(() => {
    setSelectedIds([]);
    selectionAnchorIdRef.current = null;
    selectionGestureRef.current = false;
    setSelectingAllMatching(false);
  }, []);

  const clearReviewFilter = useCallback(() => {
    setFilters((f) => ({ ...f, review_filter: '' }));
    onClearReviewFilter?.();
    setPage(1);
  }, [onClearReviewFilter]);

  const handleBulkDelete = useCallback(async () => {
    const targetIds = [...selectedIds];
    if (!targetIds.length || !onBulkDelete) return;
    const confirmed = window.confirm(`Delete ${targetIds.length} selected item${targetIds.length === 1 ? '' : 's'}? This cannot be undone.`);
    if (!confirmed) return;
    const { deletedIds = [], failedIds = [] } = await onBulkDelete(targetIds);
    if (deletedIds.some((id) => Number(detail?.id) === Number(id))) setDetail(null);
    if (deletedIds.some((id) => Number(editing?.id) === Number(id))) setEditing(null);
    setSelectedIds(failedIds);
    selectionAnchorIdRef.current = failedIds.length > 0 ? Number(failedIds[failedIds.length - 1]) : null;
  }, [detail?.id, editing?.id, onBulkDelete, selectedIds]);

  const activeEdit = editing || null;
  const isEditingMode = Boolean(activeEdit);
  const convertCollectionToTitles = useCallback(async (collection) => {
    if (!collection?.id) return;
    if (!window.confirm('Convert this collection to individual titles and remove the collection?')) return;
    await apiCall('post', `/media/collections/${collection.id}/convert-to-individual`, {});
    await refreshCollections(1);
    setPage(1);
    onRefresh({ page: requestPage, limit: requestLimit, ...filters });
  }, [apiCall, filters, onRefresh, refreshCollections, requestLimit, requestPage]);
  const renderMediaForm = () => (
    <MediaForm
      title={isEditingMode ? 'Edit Media' : 'Add to Library'}
      initial={isEditingMode ? {
        ...DEFAULT_MEDIA_FORM,
        ...activeEdit,
        cast: activeEdit.cast || activeEdit.cast_members || '',
        release_date: normalizeDateInput(activeEdit.release_date),
        signed_on: normalizeDateInput(activeEdit.signed_on)
      } : addFormInitial}
      apiCall={apiCall}
      onCancel={() => { setAdding(false); setEditing(null); }}
      onDelete={isEditingMode ? () => { onDelete(activeEdit.id); setEditing(null); } : undefined}
      onConvertToCollection={isEditingMode ? async () => {
        await apiCall('post', `/media/${activeEdit.id}/convert-to-collection`, {});
        setEditing(null);
        onRefresh({ page: requestPage, limit: requestLimit, ...filters });
      } : undefined}
      onSave={async (payload) => {
        if (isEditingMode) {
          const updated = await onEdit(activeEdit.id, payload);
          setEditing(null);
          return updated;
        }
        const created = await onOpen(payload);
        setAdding(false);
        return created;
      }}
    />
  );

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-edge shrink-0 sm:px-6 sm:py-4" data-testid="library-mobile-header">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
          <div className="flex items-center justify-end gap-2 min-w-0 sm:justify-between">
            <div className="hidden min-w-0 items-center gap-2.5 sm:flex">
              <h1 className="section-title !text-3xl">{title}</h1>
              <span className="badge badge-dim shrink-0">{displayedTotal}</span>
            </div>
            <div className="flex shrink-0 items-center justify-end gap-1.5 sm:hidden">
              <SectionTabs
                tabs={[
                  {
                    id: 'cards',
                    label: (
                      <>
                        <span aria-hidden="true"><Icons.Film /></span>
                        <span className="sr-only">Cards</span>
                      </>
                    )
                  },
                  {
                    id: 'list',
                    label: (
                      <>
                        <span aria-hidden="true"><Icons.List /></span>
                        <span className="sr-only">List</span>
                      </>
                    )
                  }
                ]}
                activeId={viewMode}
                onChange={setViewMode}
                semantics="buttons"
                showDivider={false}
                ariaLabel="Library view mode"
                className="shrink-0"
                listClassName="gap-1.5"
                buttonClassName="px-1.5 py-1.5"
              />
              <button onClick={() => { setFilters((f) => ({ ...f, sortDir: f.sortDir === 'asc' ? 'desc' : 'asc' })); setPage(1); }} className="btn-icon" title={filters.sortDir === 'asc' ? 'Sort ascending' : 'Sort descending'}>
                {filters.sortDir === 'asc' ? <Icons.ArrowUp /> : <Icons.ArrowDown />}
              </button>
              <button onClick={() => setAdding(true)} className="btn-primary px-3" aria-label="Add media"><Icons.Plus /></button>
            </div>
          </div>
          <div
            className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-2 sm:flex sm:flex-wrap sm:items-center lg:justify-end"
            data-testid="library-mobile-toolbar"
          >
          <div className="relative min-w-0 sm:w-72">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ghost pointer-events-none"><Icons.Search /></span>
            <input className="input pl-9 w-full" placeholder="Search title, director…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
          </div>
            {quickFilterConfig && (
              <select
                className="select min-w-0 !w-36 sm:!w-48"
                value={quickFilterConfig.value}
                aria-label={quickFilterConfig.label}
                onChange={(e) => {
                  const value = e.target.value;
                  if (quickFilterConfig.key === 'resolution') {
                    setResolutionInput(value);
                    setFilters((f) => ({ ...f, resolution: value }));
                  } else if (quickFilterConfig.key === 'platform') {
                    setPlatformInput(value);
                    setFilters((f) => ({ ...f, platform: value }));
                  } else if (quickFilterConfig.key === 'publisher') {
                    setPublisherInput(value);
                    setFilters((f) => ({ ...f, publisher: value }));
                  }
                  setPage(1);
                }}
              >
                {quickFilterConfig.options.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            )}
            <div className="hidden items-center justify-end gap-2 sm:flex">
              <SectionTabs
                tabs={[
                  {
                    id: 'cards',
                    label: (
                      <>
                        <span aria-hidden="true"><Icons.Film /></span>
                        <span className="sr-only">Cards</span>
                      </>
                    )
                  },
                  {
                    id: 'list',
                    label: (
                      <>
                        <span aria-hidden="true"><Icons.List /></span>
                        <span className="sr-only">List</span>
                      </>
                    )
                  }
                ]}
                activeId={viewMode}
                onChange={setViewMode}
                semantics="buttons"
                showDivider={false}
                ariaLabel="Library view mode"
                className="shrink-0"
                listClassName="gap-2"
                buttonClassName="px-2"
              />
              <button onClick={() => { setFilters((f) => ({ ...f, sortDir: f.sortDir === 'asc' ? 'desc' : 'asc' })); setPage(1); }} className="btn-icon" title={filters.sortDir === 'asc' ? 'Sort ascending' : 'Sort descending'}>
                {filters.sortDir === 'asc' ? <Icons.ArrowUp /> : <Icons.ArrowDown />}
              </button>
              <button onClick={() => setAdding(true)} className="btn-primary whitespace-nowrap px-3 sm:px-4" aria-label="Add media"><Icons.Plus /><span className="hidden sm:inline">Add</span></button>
            </div>
          </div>
        </div>
        {filters.review_filter ? (
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-edge bg-raised/25 px-3 py-2 text-sm">
            <div className="min-w-0">
              <span className="font-medium text-ink">{activeReviewFilterLabel}</span>
              <span className="text-ghost"> across all library types</span>
            </div>
            <button type="button" className="btn-secondary btn-sm" onClick={clearReviewFilter}>
              Clear
            </button>
          </div>
        ) : null}
        {(hasResultsTabs || showSelectionControls) && (
          <div className="mt-2.5 flex flex-col gap-2 border-t border-edge/60 pt-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              {supportsCollections && (
                <SectionTabs
                  tabs={[
                    { id: 'all', label: forcedMediaType === 'game' ? 'All Games' : 'All Movies' },
                    { id: 'collections', label: forcedMediaType === 'game' ? 'Game Collections' : 'Movie Collections' }
                  ]}
                  activeId={collectionMode}
                  onChange={(nextMode) => { setCollectionMode(nextMode); setPage(1); }}
                  semantics="buttons"
                  ariaLabel="Collection views"
                  className="w-fit"
                />
              )}
              {isComicsLibrary && (
                <>
                  <SectionTabs
                    tabs={[
                      { id: 'issues', label: 'All Issues' },
                      { id: 'series', label: 'Series' },
                      { id: 'series_issues', label: 'Series Issues' }
                    ]}
                    activeId={comicView}
                    onChange={(nextView) => { setComicView(nextView); setPage(1); }}
                    semantics="buttons"
                    ariaLabel="Comic views"
                    className="w-fit"
                  />
                  {comicView === 'series_issues' && (
                    <select className="select min-w-[220px]" value={comicSeries} onChange={(e) => { setComicSeries(e.target.value); setPage(1); }}>
                      <option value="all">All series</option>
                      {comicSeriesOptions.map((series) => (
                        <option key={series.name} value={series.name}>{series.name} ({series.count})</option>
                      ))}
                    </select>
                  )}
                </>
              )}
            </div>
            {showSelectionControls && (
              <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:flex lg:justify-end">
                {selectedIds.length > 0 ? <span className="font-medium text-ink">{selectedIds.length} selected</span> : null}
                {selectedIds.length > 0 && canSelectVisiblePage ? (
                  <button
                    type="button"
                    onClick={handleSelectAllVisible}
                    disabled={selectionControlsPending}
                    className="inline-flex items-center text-xs text-dim underline-offset-4 hover:text-ink hover:underline disabled:cursor-default disabled:no-underline disabled:opacity-50"
                  >
                    {`Select page (${visibleSelectableIds.length})`}
                  </button>
                ) : null}
                {showSelectAllMatchingPrompt && (
                  <button
                    type="button"
                    onClick={handleSelectAllMatching}
                    disabled={selectionControlsPending || selectingAllMatching}
                    className="inline-flex items-center text-xs text-dim underline-offset-4 hover:text-ink hover:underline disabled:cursor-default disabled:no-underline disabled:opacity-50"
                  >
                    {selectingAllMatching ? `Selecting ${selectionScopeLabel}…` : `Select all ${selectableResultTotal} ${selectionScopeLabel}`}
                  </button>
                )}
                {allMatchingSelected && selectableResultTotal > visibleSelectableIds.length ? (
                  <span className="text-dim">{`All ${selectableResultTotal} ${selectionScopeLabel} selected`}</span>
                ) : null}
                {selectedIds.length === 0 ? (
                  <button
                    type="button"
                    onClick={handleSelectAllVisible}
                    disabled={selectionControlsPending || visibleSelectableIds.length === 0}
                    className="inline-flex items-center text-xs text-dim underline-offset-4 hover:text-ink hover:underline disabled:cursor-default disabled:no-underline disabled:opacity-50 lg:ml-2"
                  >
                    {`Select page (${visibleSelectableIds.length})`}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={handleClearSelection}
                      className="inline-flex items-center text-xs text-dim underline-offset-4 hover:text-ink hover:underline"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={handleBulkDelete}
                      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-err/90 transition-colors hover:bg-err/10 hover:text-err"
                      aria-label={`Delete ${selectedIds.length} selected`}
                    >
                      <Icons.Trash />
                      {selectedIds.length}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scroll-area p-4 sm:p-6">
        {isCollectionMode ? (
          <>
            {collectionError && <p className="text-sm text-err mb-4">{collectionError}</p>}
            {collectionLoading && <div className="flex items-center justify-center py-20"><Spinner size={32} /></div>}
            {!collectionLoading && collectionRows.length === 0 && (
              <EmptyState
                icon={<Icons.List />}
                title="No collections found"
                subtitle={searchInput.trim() ? 'Try adjusting your search' : 'No collection entries are available for this library type'}
              />
            )}
            {!collectionLoading && collectionRows.length > 0 && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                {collectionRows.map((item) => (
                  <CollectionCard
                    key={item.id}
                    item={item}
                    supportsHover={supportsHover}
                    onOpen={(row) => setViewingCollectionId(row.id)}
                    onEdit={(id) => setEditingCollectionId(id)}
                    onConvert={convertCollectionToTitles}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            {activeMediaError && <p className="text-sm text-err mb-4">{activeMediaError}</p>}
            {activeMediaLoading && <div className="flex items-center justify-center py-20"><Spinner size={32} /></div>}
            {!activeMediaLoading && activeMediaResultCount === 0 && (
          <EmptyState
            icon={<Icons.Film />}
            title={comicSeriesViewActive ? 'No series found' : 'No items found'}
            subtitle={filters.search || filters.resolution !== 'all' || filters.platform !== 'all' || filters.publisher !== 'all'
              ? 'Try adjusting your filters'
              : (comicSeriesViewActive ? 'No comic series are available for this library yet' : 'Add your first title to get started')}
            action={!filters.search && filters.resolution === 'all' && filters.platform === 'all' && filters.publisher === 'all' && <button onClick={() => setAdding(true)} className="btn-primary"><Icons.Plus />Add Media</button>}
          />
        )}

        {!activeMediaLoading && isComicsLibrary && comicView === 'series' && displayedComicSeriesSummaries.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-5">
            {displayedComicSeriesSummaries.map((series) => (
              <button
                key={series.name}
                onClick={() => { setComicSeries(series.name); setComicView('series_issues'); setPage(1); }}
                className="text-left card p-4 hover:border-muted transition-colors"
              >
                <div className="space-y-3">
                  <div className="w-full" style={{ aspectRatio: '2/3' }}>
                    <div className="poster rounded-md w-full h-full">
                      {posterUrl(series.poster_path)
                        ? <img src={posterUrl(series.poster_path)} alt={series.name} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
                        : <div className="absolute inset-0 flex items-center justify-center text-ghost"><Icons.Library /></div>}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-ink line-clamp-2">{series.name}</p>
                    <p className="text-xs text-ghost mt-1">{series.count} issue{series.count === 1 ? '' : 's'}</p>
                    <p className="text-xs text-ghost">
                      {(series.yearMin || series.yearMax)
                        ? (series.yearMin === series.yearMax ? series.yearMin : `${series.yearMin || '—'} - ${series.yearMax || '—'}`)
                        : 'Year unknown'}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {!loading && viewMode === 'cards' && !isCollectionMode && !(isComicsLibrary && comicView === 'series') && displayedCardEntries.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {displayedCardEntries.map((entry) => (
              entry.kind === 'collection'
                ? (
                  <CollectionCard
                    key={entry.id}
                    item={entry.item}
                    supportsHover={supportsHover}
                    onOpen={(row) => setViewingCollectionId(row.id)}
                    onEdit={(id) => setEditingCollectionId(id)}
                    onConvert={convertCollectionToTitles}
                  />
                )
                : (
                  <MediaCard
                    key={entry.id}
                    item={entry.item}
                    onOpen={() => setDetail(entry.item)}
                    onEdit={() => setEditing(entry.item)}
                    onDelete={(id) => { if (window.confirm('Delete this item?')) onDelete(id); }}
                    onRating={rate}
                    supportsHover={supportsHover}
                    selectionEnabled={true}
                    selected={selectedIdSet.has(Number(entry.item.id))}
                    onSelectionGesture={noteSelectionGesture}
                    onToggleSelect={toggleSelectedId}
                  />
                )
            ))}
          </div>
        )}

        {!loading && viewMode === 'list' && displayedVisibleItems.length > 0 && !(isComicsLibrary && comicView === 'series') && (
          <div className="space-y-2.5">
            {displayedVisibleItems.map((item) => (
              <MediaListRow
                key={item.id}
                item={item}
                onOpen={() => setDetail(item)}
                onEdit={() => setEditing(item)}
                onDelete={(id) => { if (window.confirm('Delete this item?')) onDelete(id); }}
                onRating={rate}
                supportsHover={supportsHover}
                selectionEnabled={true}
                selected={selectedIdSet.has(Number(item.id))}
                onSelectionGesture={noteSelectionGesture}
                onToggleSelect={toggleSelectedId}
              />
            ))}
          </div>
        )}
          </>
        )}
      </div>

      <CollectionPaginationFooter
        page={page}
        totalPages={footerTotalPages}
        hasMore={footerHasMore}
        loading={loading || collectionLoading}
        pageSize={pageSize}
        pageSizeOptions={[25, 50, 100, 200]}
        className="px-4 sm:px-6"
        onPrevious={() => setPage((p) => Math.max(1, p - 1))}
        onNext={() => setPage((p) => p + 1)}
        onPageSizeChange={(value) => { setPageSize(value); setPage(1); }}
      />

      {detail && (
        <MediaDetail
          item={detail}
          onClose={() => setDetail(null)}
          onEdit={(item) => { setDetail(null); setEditing(item); }}
          onDelete={(id) => { onDelete(id); setDetail(null); }}
          onRating={rate}
          apiCall={apiCall}
          onValuationUpdated={refreshDetailItem}
          onToast={onToast}
          onFindPossibleDuplicates={onFindPossibleDuplicates}
          canWritePlex={canWritePlex}
        />
      )}
      {viewingCollectionId && (
        <CollectionDetail
          collectionId={viewingCollectionId}
          apiCall={apiCall}
          onClose={() => setViewingCollectionId(null)}
          onEdit={() => {
            const id = viewingCollectionId;
            setViewingCollectionId(null);
            setEditingCollectionId(id);
          }}
          onConvert={async () => {
            await convertCollectionToTitles({ id: viewingCollectionId });
            setViewingCollectionId(null);
          }}
        />
      )}
      {editingCollectionId && (
        <CollectionEditor
          collectionId={editingCollectionId}
          apiCall={apiCall}
          onClose={() => setEditingCollectionId(null)}
          onSaved={async () => {
            setPage(1);
            await refreshCollections(1);
            onRefresh({ page: requestPage, limit: requestLimit, ...filters });
          }}
        />
      )}
      {(adding || editing) && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-void/72" onClick={() => { setAdding(false); setEditing(null); }} />
          <div className="ml-auto h-full w-full max-w-[40rem] bg-abyss border-l border-edge shadow-card relative">
            {renderMediaForm()}
          </div>
        </div>
      )}
    </div>
  );
}
