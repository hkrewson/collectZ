import React, { useEffect, useMemo, useState } from 'react';
import { SectionTabPanel, SectionTabs } from './app/AppPrimitives';

function formatValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

function formatSourceLabel(record) {
  return record?.source_label || record?.source_provider_label || record?.source_import_label || 'Unknown source';
}

function formatMediaType(value) {
  return String(value || '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Unknown';
}

function formatTimestamp(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString();
}

const RECOMMENDATION_REJECTION_REASONS = [
  { value: 'different_title_identity', label: 'Different title identity' },
  { value: 'different_volume_or_edition', label: 'Different volume or edition' },
  { value: 'different_season_or_part', label: 'Different season or part' },
  { value: 'collection_wrapper_only', label: 'Collection wrapper only' },
  { value: 'other', label: 'Other' }
];

const MERGE_REVIEW_SECTION_OPTIONS = [
  { value: 'all', label: 'All sections' },
  { value: 'movie', label: 'Movies' },
  { value: 'tv_series', label: 'TV' },
  { value: 'book', label: 'Books' },
  { value: 'comic_book', label: 'Comics' },
  { value: 'game', label: 'Games' },
  { value: 'audio', label: 'Audio' }
];

const SUPPRESSED_OUTCOME_OPTIONS = [
  { value: 'all', label: 'All suppressed pairs' },
  { value: 'deferred', label: 'Deferred' },
  { value: 'rejected', label: 'Rejected' }
];

const MERGE_REVIEW_TABS = [
  { id: 'discovery', label: 'Discovery' },
  { id: 'recommended', label: 'Recommended' },
  { id: 'comics', label: 'Comics' },
  { id: 'suppressed', label: 'Suppressed' },
  { id: 'collections', label: 'Collections' }
];

const COMIC_SUPPRESSION_REASON_LABELS = {
  title_issue_mismatch: 'Title issue does not match stored issue number',
  edition_issue_mismatch: 'Edition issue does not match stored issue number'
};

function formatSearchMeta(record = {}) {
  const bits = [];
  if (record?.media_type) bits.push(formatMediaType(record.media_type));
  if (record?.year) bits.push(String(record.year));
  bits.push(`Record #${record?.id || '—'}`);
  return bits.join(' · ');
}

function formatComicSuppressionReason(reason = '') {
  return COMIC_SUPPRESSION_REASON_LABELS[reason] || reason || 'Suppressed cluster';
}

function formatComicCandidateMeta(record = {}) {
  const bits = [];
  if (record?.source_label) bits.push(record.source_label);
  if (record?.year) bits.push(String(record.year));
  bits.push(`Record #${record?.id || '—'}`);
  return bits.join(' · ');
}

function buildImpactRows(summary = {}) {
  const rows = [
    { label: 'Collection items', value: Number(summary.collection_items || 0) },
    { label: 'Variants', value: Number(summary.variants || 0) },
    { label: 'Seasons', value: Number(summary.seasons || 0) },
    { label: 'Child series', value: Number(summary.child_series_references || 0) },
    { label: 'Metadata entries', value: Number(summary.metadata_entries || 0) },
    { label: 'Genre links', value: Number(summary.genre_links || 0) },
    { label: 'Director links', value: Number(summary.director_links || 0) },
    { label: 'Actor links', value: Number(summary.actor_links || 0) }
  ].filter((row) => row.value > 0);
  if (rows.length === 0) {
    return [{ label: 'Dependent records', value: 'None' }];
  }
  return rows;
}

function buildHistoryRows(historyContext = {}) {
  return [
    { label: 'This record active merges', value: Number(historyContext.canonical_active_merge_count || 0) },
    { label: 'Matched record active merges', value: Number(historyContext.duplicate_active_merge_count || 0) },
    { label: 'Matched record already absorbed', value: historyContext.duplicate_is_absorbed ? 'Yes' : 'No' }
  ];
}

function buildPairReviewKey(canonicalId, duplicateId) {
  return `${Number(canonicalId || 0)}:${Number(duplicateId || 0)}`;
}

function buildReviewItemKey(item = {}) {
  return buildPairReviewKey(item?.canonical?.id, item?.duplicate?.id);
}

function SummaryStat({ label, value }) {
  return (
    <div className="rounded-lg border border-edge/70 bg-raised/30 px-3 py-2">
      <p className="text-[11px] text-ghost">{label}</p>
      <p className="mt-1 text-sm font-medium text-ink">{value}</p>
    </div>
  );
}

function RecordSummary({ title, record }) {
  return (
    <div className="rounded-lg border border-edge/70 bg-void/10 p-4">
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="mt-2 text-base font-medium text-ink">{record?.title || 'Untitled record'}</p>
      <dl className="mt-3 space-y-2 text-sm text-ghost">
        <div className="flex items-start justify-between gap-4">
          <dt>Source</dt>
          <dd className="text-right text-ink">{formatSourceLabel(record)}</dd>
        </div>
        <div className="flex items-start justify-between gap-4">
          <dt>Record id</dt>
          <dd className="font-mono text-right text-ink">#{record?.id || '—'}</dd>
        </div>
        <div className="flex items-start justify-between gap-4">
          <dt>Media type</dt>
          <dd className="text-right text-ink">{formatMediaType(record?.media_type)}</dd>
        </div>
      </dl>
    </div>
  );
}

function RecordSearchPanel({
  title,
  value,
  onChange,
  loading,
  results,
  selectedId,
  onPick,
  placeholder
}) {
  return (
    <div className="rounded-lg border border-edge bg-void/10 p-4 space-y-3">
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-ink">{title}</h2>
        <p className="text-sm text-ghost">Search inside the active workspace and library scope.</p>
      </div>
      <label className="field">
        <span className="label">Search</span>
        <input
          className="input"
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <div className="rounded-lg border border-edge/70 bg-raised/20">
        {loading ? (
          <div className="px-4 py-6 text-sm text-ghost">Searching…</div>
        ) : results.length > 0 ? (
          <div className="divide-y divide-edge/60">
            {results.map((record) => {
              const selected = Number(selectedId || 0) === Number(record.id || 0);
              return (
                <button
                  key={`${title}-${record.id}`}
                  type="button"
                  onClick={() => onPick(record)}
                  className={`w-full px-4 py-3 text-left transition-colors ${selected ? 'bg-raised/55' : 'hover:bg-raised/35'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{record.title || 'Untitled record'}</p>
                      <p className="mt-1 text-xs text-ghost">{formatSearchMeta(record)}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      {record.source_label ? <p className="text-xs text-ghost">{record.source_label}</p> : null}
                      {selected ? <p className="mt-1 text-xs text-ink">Selected</p> : null}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : value.trim().length >= 2 ? (
          <div className="px-4 py-6 text-sm text-ghost">No matching records found.</div>
        ) : (
          <div className="px-4 py-6 text-sm text-ghost">Type at least two characters to search.</div>
        )}
      </div>
    </div>
  );
}

function MergeReviewWorkspace({
  preview,
  errorState,
  comparedRows,
  rewiringRows,
  historyRows,
  activeComicGroupId,
  activeComicGroupLabel,
  activeRemainingComicPairs,
  applyConfirmOpen,
  setApplyConfirmOpen,
  applying,
  onApply,
  onSkipComicPair,
  onClose,
  mergeDetails,
  revertingDuplicateId,
  onRevert,
  applyResult,
  revertResult,
  Spinner
}) {
  if (!preview && !errorState && !applyResult?.applied && !revertResult?.reverted && Number(mergeDetails?.summary?.active_merge_count || 0) <= 0) {
    return null;
  }
  return (
    <div className="space-y-4 rounded-lg border border-edge/70 bg-void/10 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h3 className="text-sm font-medium text-ink">Pair review</h3>
          <p className="text-sm text-ghost">Compare both records, confirm the merge effect, and keep repair history intact.</p>
        </div>
        <div className="flex items-center gap-2">
          {activeComicGroupId ? (
            <span className="text-xs text-ghost">
              {activeComicGroupLabel || 'Comic issue cluster'} · {activeRemainingComicPairs} remaining pairs
            </span>
          ) : null}
          <button type="button" className="btn-secondary btn-sm h-8" onClick={onClose}>
            Close review
          </button>
        </div>
      </div>

      {errorState ? (
        <div className="rounded-lg border border-err/30 bg-err/5 p-4 space-y-4">
          <div>
            <p className="text-sm font-medium text-ink">{errorState.message}</p>
            {errorState.details ? (
              <p className="mt-2 text-sm text-ghost">
                This record is {formatMediaType(errorState.details.canonical_media_type)} and the matched record is {formatMediaType(errorState.details.duplicate_media_type)}.
              </p>
            ) : null}
          </div>
          {(errorState.canonical || errorState.duplicate) ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <RecordSummary title="This record" record={errorState.canonical} />
              <RecordSummary title="Matched record" record={errorState.duplicate} />
            </div>
          ) : null}
        </div>
      ) : null}

      {preview?.allowed ? (
        <div className="space-y-6">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <SummaryStat label="Matched on" value={preview.preview?.evidence?.summary || 'Manual review'} />
            <SummaryStat label="Confidence" value={formatMediaType(preview.preview?.evidence?.confidence)} />
            <SummaryStat label="Media type" value={formatMediaType(preview.preview?.media_type)} />
            <SummaryStat
              label="Recommended canonical"
              value={`#${preview.preview?.canonical_selection?.recommended_canonical_id || preview.canonical?.id || '—'}`}
            />
          </div>

          {!preview.preview?.canonical_selection?.requested_matches_recommended ? (
            <div className="rounded-lg border border-gold/30 bg-gold/5 px-4 py-3 text-sm text-ghost">
              Recommended canonical is record #{preview.preview?.canonical_selection?.recommended_canonical_id || '—'} based on the current canonical selection rule.
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <RecordSummary title="This record" record={preview.canonical} />
            <RecordSummary title="Matched record" record={preview.duplicate} />
          </div>

          <div className="rounded-lg border border-edge bg-raised/15 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-1">
                <h4 className="text-sm font-medium text-ink">Apply merge</h4>
                <p className="text-sm text-ghost">
                  This will absorb the matched record into this record and preserve repair history so the merge can be reverted later through the operator workflow.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {activeComicGroupId ? (
                  <button type="button" className="btn-secondary h-10" onClick={onSkipComicPair} disabled={applying}>
                    Skip pair
                  </button>
                ) : null}
                {!applyConfirmOpen ? (
                  <button type="button" className="btn-primary h-10" onClick={() => setApplyConfirmOpen(true)} disabled={applying}>
                    Apply merge
                  </button>
                ) : (
                  <>
                    <button type="button" className="btn-primary h-10" onClick={onApply} disabled={applying}>
                      {applying ? <><Spinner size={14} />Applying…</> : 'Confirm apply'}
                    </button>
                    <button type="button" className="btn-secondary h-10" onClick={() => setApplyConfirmOpen(false)} disabled={applying}>
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-edge bg-raised/15">
            <div className="border-b border-edge/70 px-4 py-3">
              <h4 className="text-sm font-medium text-ink">Compared fields</h4>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-edge/60 text-sm">
                <thead className="bg-raised/25 text-left text-[11px] text-ghost">
                  <tr>
                    <th className="px-4 py-3 font-medium">Matched on</th>
                    <th className="px-4 py-3 font-medium">This record</th>
                    <th className="px-4 py-3 font-medium">Matched record</th>
                    <th className="px-4 py-3 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-edge/60">
                  {comparedRows.map((row) => (
                    <tr key={row.key}>
                      <td className="px-4 py-3 text-ink">{row.label}</td>
                      <td className="px-4 py-3 text-ghost">{formatValue(row.canonical_value)}</td>
                      <td className="px-4 py-3 text-ghost">{formatValue(row.duplicate_value)}</td>
                      <td className="px-4 py-3 text-ink">{formatValue(row.result_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-edge bg-raised/15 p-4">
              <h4 className="text-sm font-medium text-ink">Dependent rewiring</h4>
              <div className="mt-3 space-y-2 text-sm">
                {rewiringRows.map((row) => (
                  <div key={row.label} className="flex items-start justify-between gap-4">
                    <span className="text-ghost">{row.label}</span>
                    <span className="text-ink">{formatValue(row.value)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-edge bg-raised/15 p-4">
              <h4 className="text-sm font-medium text-ink">Merge history</h4>
              <div className="mt-3 space-y-2 text-sm">
                {historyRows.map((row) => (
                  <div key={row.label} className="flex items-start justify-between gap-4">
                    <span className="text-ghost">{row.label}</span>
                    <span className="text-ink">{formatValue(row.value)}</span>
                  </div>
                ))}
                <div className="flex items-start justify-between gap-4">
                  <span className="text-ghost">Selection reason</span>
                  <span className="text-right text-ink">{formatValue(preview.preview?.canonical_selection?.selection_reason)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {Number(mergeDetails?.summary?.active_merge_count || 0) > 0 ? (
        <div className="rounded-lg border border-edge bg-raised/15">
          <div className="border-b border-edge/70 px-4 py-3">
            <h4 className="text-sm font-medium text-ink">Active merge events</h4>
          </div>
          <div className="divide-y divide-edge/60">
            {(mergeDetails?.entries || []).map((entry) => (
              <div key={`active-merge-${entry.duplicate_id}`} className="flex flex-col gap-3 px-4 py-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-ink">
                    {entry?.merged?.title || 'Merged record'} <span className="font-mono text-xs text-ghost">#{entry?.duplicate_id || '—'}</span>
                  </p>
                  <p className="text-sm text-ghost">
                    {entry?.match_summary || 'Manual merge'} · {entry?.merged?.source_label || 'Unknown source'}
                  </p>
                  <p className="text-xs text-ghost">Merged at {formatTimestamp(entry?.applied_at)}</p>
                </div>
                <button
                  type="button"
                  className="btn-secondary btn-sm h-8"
                  onClick={() => onRevert(entry)}
                  disabled={revertingDuplicateId === String(entry?.duplicate_id || '')}
                >
                  {revertingDuplicateId === String(entry?.duplicate_id || '') ? 'Reverting…' : 'Revert merge'}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {applyResult?.applied ? (
        <div className="space-y-4 rounded-lg border border-edge bg-raised/15 p-4">
          <div className="space-y-1">
            <h4 className="text-sm font-medium text-ink">Merge applied</h4>
            <p className="text-sm text-ghost">
              Record #{applyResult?.canonical?.id || '—'} absorbed record #{applyResult?.duplicate?.id || '—'} and the merge is now part of the normal provenance history.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryStat label="Canonical record" value={`#${applyResult?.canonical?.id || '—'}`} />
            <SummaryStat label="Merged record" value={`#${applyResult?.duplicate?.id || '—'}`} />
            <SummaryStat label="Attach count" value={formatValue(applyResult?.result?.attached || 0)} />
            <SummaryStat label="Active merge count" value={formatValue(applyResult?.merge_details?.summary?.active_merge_count || 0)} />
          </div>
        </div>
      ) : null}

      {revertResult?.reverted ? (
        <div className="space-y-4 rounded-lg border border-edge bg-raised/15 p-4">
          <div className="space-y-1">
            <h4 className="text-sm font-medium text-ink">Merge reverted</h4>
            <p className="text-sm text-ghost">
              Record #{revertResult?.duplicate?.id || '—'} was restored from record #{revertResult?.canonical?.id || '—'} and the remaining active merge history was left intact.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryStat label="Canonical record" value={`#${revertResult?.canonical?.id || '—'}`} />
            <SummaryStat label="Restored record" value={`#${revertResult?.duplicate?.id || '—'}`} />
            <SummaryStat label="Reverted count" value={formatValue(revertResult?.result?.reverted || 0)} />
            <SummaryStat label="Active merge count" value={formatValue(revertResult?.merge_details?.summary?.active_merge_count || 0)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RecommendationRow({ item, onReview, onReject, loading, rejecting, confirmRejecting, rejectDraft, onRejectDraftChange, children }) {
  return (
    <div className="flex flex-col gap-3 border-t border-edge/60 px-4 py-4 first:border-t-0">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-ink">{item.summary || 'Recommended merge'}</p>
          <p className="text-sm text-ghost">
            {item.canonical?.title || 'This record'} <span className="text-dim">→</span> {item.duplicate?.title || 'Matched record'}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-ghost">
          <span>{formatMediaType(item.confidence)}</span>
          {!confirmRejecting ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-secondary btn-sm h-8"
                onClick={() => onReview(item)}
                disabled={loading}
              >
                Review pair
              </button>
              <button
                type="button"
                className="btn-secondary btn-sm h-8"
                onClick={() => onReject(item, false)}
                disabled={loading}
              >
                Reject match
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:min-w-72">
              <select
                className="select h-8 text-xs"
                value={rejectDraft?.reason_code || RECOMMENDATION_REJECTION_REASONS[0].value}
                onChange={(event) => onRejectDraftChange(item, {
                  ...(rejectDraft || {}),
                  reason_code: event.target.value
                })}
                disabled={rejecting}
              >
                {RECOMMENDATION_REJECTION_REASONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <input
                className="input h-8 text-xs"
                placeholder="Optional note"
                value={rejectDraft?.reason || ''}
                onChange={(event) => onRejectDraftChange(item, {
                  ...(rejectDraft || {}),
                  reason: event.target.value
                })}
                disabled={rejecting}
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn-primary btn-sm h-8"
                  onClick={() => onReject(item, true)}
                  disabled={loading || rejecting}
                >
                  {rejecting ? 'Rejecting…' : 'Confirm reject'}
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm h-8"
                  onClick={() => onReject(item, null)}
                  disabled={rejecting}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="space-y-1">
          <p className="text-ghost">This record</p>
          <p className="text-ink">{item.canonical?.source_label || 'Unknown source'}</p>
          <p className="font-mono text-xs text-ghost">#{item.canonical?.id || '—'}</p>
        </div>
        <div className="space-y-1">
          <p className="text-ghost">Matched record</p>
          <p className="text-ink">{item.duplicate?.source_label || 'Unknown source'}</p>
          <p className="font-mono text-xs text-ghost">#{item.duplicate?.id || '—'}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function DiscoveryCandidateRow({ item, onReview, onReject, loading, rejecting, confirmRejecting, rejectDraft, onRejectDraftChange, children }) {
  return (
    <div className="flex flex-col gap-3 border-t border-edge/60 px-4 py-4 first:border-t-0">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-ink">{item.summary || 'Possible duplicate'}</p>
          <p className="text-sm text-ghost">
            {item.canonical?.title || 'This record'} <span className="text-dim">↔</span> {item.duplicate?.title || 'Possible match'}
          </p>
        </div>
        {!confirmRejecting ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-secondary btn-sm h-8"
              onClick={() => onReview(item)}
              disabled={loading}
            >
              Review pair
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm h-8"
              onClick={() => onReject(item, false)}
              disabled={loading}
            >
              Reject match
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:min-w-72">
            <select
              className="select h-8 text-xs"
              value={rejectDraft?.reason_code || RECOMMENDATION_REJECTION_REASONS[0].value}
              onChange={(event) => onRejectDraftChange(item, {
                ...(rejectDraft || {}),
                reason_code: event.target.value
              })}
              disabled={rejecting}
            >
              {RECOMMENDATION_REJECTION_REASONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <input
              className="input h-8 text-xs"
              placeholder="Optional note"
              value={rejectDraft?.reason || ''}
              onChange={(event) => onRejectDraftChange(item, {
                ...(rejectDraft || {}),
                reason: event.target.value
              })}
              disabled={rejecting}
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-primary btn-sm h-8"
                onClick={() => onReject(item, true)}
                disabled={loading || rejecting}
              >
                {rejecting ? 'Rejecting…' : 'Confirm reject'}
              </button>
              <button
                type="button"
                className="btn-secondary btn-sm h-8"
                onClick={() => onReject(item, null)}
                disabled={rejecting}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="space-y-1">
          <p className="text-ghost">This record</p>
          <p className="text-ink">{item.canonical?.source_label || 'Unknown source'}</p>
          <p className="font-mono text-xs text-ghost">#{item.canonical?.id || '—'}</p>
        </div>
        <div className="space-y-1">
          <p className="text-ghost">Possible match</p>
          <p className="text-ink">{item.duplicate?.source_label || 'Unknown source'}</p>
          <p className="font-mono text-xs text-ghost">#{item.duplicate?.id || '—'}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function SuppressedPairRow({ item, onReview, onRestore, restoring, loading, children }) {
  return (
    <div className="flex flex-col gap-3 border-t border-edge/60 px-4 py-4 first:border-t-0">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-ink">{item.summary || 'Suppressed pair'}</p>
          <p className="text-sm text-ghost">
            {item.canonical?.title || 'This record'} <span className="text-dim">↔</span> {item.duplicate?.title || 'Suppressed match'}
          </p>
          <p className="text-xs text-ghost">
            {formatMediaType(item.media_type)} · {item.created_by_name || 'Operator'} · {formatTimestamp(item.created_at)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-ghost">
          <span>{item.outcome === 'deferred' ? 'Deferred' : 'Rejected'}</span>
          <button
            type="button"
            className="btn-secondary btn-sm h-8"
            onClick={() => onReview(item)}
            disabled={loading}
          >
            Review pair
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm h-8"
            onClick={() => onRestore(item)}
            disabled={loading || restoring}
          >
            {restoring ? 'Restoring…' : 'Restore to queue'}
          </button>
        </div>
      </div>
      {(item.reason_code || item.reason) ? (
        <p className="text-sm text-ghost">
          <span className="text-ink">Why:</span> {[item.reason_code, item.reason].filter(Boolean).join(' · ')}
        </p>
      ) : null}
      {children}
    </div>
  );
}

function formatCollectionMeta(collection = {}) {
  const bits = [];
  if (collection.library_name) bits.push(collection.library_name);
  bits.push(`Collection #${collection.id || '—'}`);
  bits.push(`${collection.item_count || 0} items`);
  return bits.join(' · ');
}

function formatCollectionPreviewDate(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString();
}

function formatCollectionPreviewItem(item = {}) {
  const label = item.media_title || item.contained_title || `Collection item #${item.id || '—'}`;
  const bits = [];
  if (item.position !== null && item.position !== undefined) bits.push(`Pos ${item.position}`);
  if (item.media_year) bits.push(String(item.media_year));
  if (item.media_id) bits.push(`Linked #${item.media_id}`);
  return {
    label,
    meta: bits.join(' · ')
  };
}

function CollectionPreviewSummary({ title, collection }) {
  return (
    <div className="rounded-lg border border-edge/70 bg-void/10 p-4">
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="mt-2 text-base font-medium text-ink">{collection?.name || 'Untitled collection'}</p>
      <dl className="mt-3 space-y-2 text-sm text-ghost">
        <div className="flex items-start justify-between gap-4">
          <dt>Source</dt>
          <dd className="text-right text-ink">{collection?.source_label || 'Unknown source'}</dd>
        </div>
        <div className="flex items-start justify-between gap-4">
          <dt>Collection id</dt>
          <dd className="font-mono text-right text-ink">#{collection?.id || '—'}</dd>
        </div>
        <div className="flex items-start justify-between gap-4">
          <dt>Expected items</dt>
          <dd className="text-right text-ink">{collection?.expected_item_count ?? '—'}</dd>
        </div>
        <div className="flex items-start justify-between gap-4">
          <dt>Created</dt>
          <dd className="text-right text-ink">{formatCollectionPreviewDate(collection?.created_at)}</dd>
        </div>
      </dl>
    </div>
  );
}

function CollectionDuplicateGroup({ group, onReview, loading }) {
  return (
    <div className="rounded-lg border border-edge/70 bg-raised/15">
      <div className="border-b border-edge/60 px-4 py-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-ink">{group.name || 'Untitled collection'}</p>
            <p className="text-xs text-ghost">
              {group.collections?.length || 0} duplicate collections · {formatMediaType(group.media_type)} · expected {group.expected_item_count || 0} items
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-xs text-ghost">
              Preview first
            </div>
            <button
              type="button"
              className="btn-secondary btn-sm h-8"
              onClick={() => onReview(group)}
              disabled={loading || Number(group.collections?.length || 0) < 2}
            >
              Review group
            </button>
          </div>
        </div>
      </div>
      <div className="divide-y divide-edge/60">
        {(group.collections || []).map((collection) => (
          <div key={`collection-dup-${collection.id}`} className="px-4 py-3">
            <p className="text-sm font-medium text-ink">{collection.name || 'Untitled collection'}</p>
            <p className="mt-1 text-xs text-ghost">{formatCollectionMeta(collection)}</p>
            {collection.source_title ? (
              <p className="mt-2 text-xs text-ghost">Source title: {collection.source_title}</p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function ComicDuplicateCandidateGroup({ group, onReview, loading, activeReviewKey, renderReviewPanel }) {
  return (
    <div className="rounded-lg border border-edge/70 bg-raised/15">
      <div className="border-b border-edge/60 px-4 py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-ink">
              {group.series || 'Unknown series'} #{group.issue_number || '—'}
            </p>
            <p className="text-xs text-ghost">
              {group.duplicate_count || 0} matching records · Volume {group.volume || '—'} · {group.summary || 'Comic duplicate'}
            </p>
          </div>
          <div className="text-xs text-ghost">
            Pick the exact pair you want to review.
          </div>
        </div>
      </div>
      <div className="px-4 py-3">
        <p className="text-xs text-ghost">This record</p>
        <p className="mt-1 text-sm font-medium text-ink">{group.canonical?.title || 'Untitled record'}</p>
        <p className="mt-1 text-xs text-ghost">{formatComicCandidateMeta(group.canonical)}</p>
      </div>
      <div className="border-t border-edge/60 px-4 py-3">
        <p className="text-xs text-ghost">Matched records</p>
        <div className="mt-3 space-y-2">
          {(group.duplicates || []).map((record) => (
            <div
              key={`comic-candidate-${group.duplicate_group_id}-${record.id}`}
              className="rounded-md border border-edge/70 bg-void/10 px-3 py-3"
            >
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{record.title || 'Untitled record'}</p>
                    <p className="mt-1 text-xs text-ghost">{formatComicCandidateMeta(record)}</p>
                  </div>
                  <button
                    type="button"
                    className="btn-secondary btn-sm h-8 shrink-0"
                    onClick={() => onReview(group, record)}
                    disabled={loading || !group?.canonical?.id || !record?.id}
                  >
                    Review pair
                  </button>
                </div>
                {activeReviewKey === buildPairReviewKey(group?.canonical?.id, record?.id) ? renderReviewPanel?.() : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CollectionMergeEventRow({ entry, onRevert, reverting }) {
  return (
    <div className="flex flex-col gap-3 border-t border-edge/60 px-4 py-4 first:border-t-0">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-ink">{entry.summary || 'Collection merge'}</p>
          <p className="text-sm text-ghost">
            {entry.canonical?.name || 'This collection'} <span className="text-dim">←</span> {entry.duplicate?.name || 'Matched collection'}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-ghost">
          <span>{formatTimestamp(entry.applied_at)}</span>
          <button
            type="button"
            className="btn-secondary btn-sm h-8"
            onClick={() => onRevert(entry)}
            disabled={reverting}
          >
            {reverting ? 'Reverting…' : 'Revert merge'}
          </button>
        </div>
      </div>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="space-y-1">
          <p className="text-ghost">Matched collection</p>
          <p className="text-ink">{entry.duplicate?.source_label || 'Unknown source'}</p>
          <p className="font-mono text-xs text-ghost">#{entry.duplicate?.id || '—'}</p>
        </div>
        <div className="space-y-1">
          <p className="text-ghost">Merge effect</p>
          <p className="text-ink">{entry.moved_item_count || 0} moved items</p>
          <p className="text-xs text-ghost">{entry.skipped_item_count || 0} skipped as duplicates</p>
        </div>
      </div>
    </div>
  );
}

export default function AdminMergeReviewView({
  apiCall,
  onToast,
  Spinner,
  activeSpace,
  activeLibrary,
  seededDiscovery = null,
  onDiscoverySeedConsumed = null
}) {
  const [canonicalId, setCanonicalId] = useState('');
  const [duplicateId, setDuplicateId] = useState('');
  const [canonicalSearch, setCanonicalSearch] = useState('');
  const [duplicateSearch, setDuplicateSearch] = useState('');
  const [canonicalResults, setCanonicalResults] = useState([]);
  const [duplicateResults, setDuplicateResults] = useState([]);
  const [canonicalSearchLoading, setCanonicalSearchLoading] = useState(false);
  const [duplicateSearchLoading, setDuplicateSearchLoading] = useState(false);
  const [recommendations, setRecommendations] = useState([]);
  const [recommendationsSummary, setRecommendationsSummary] = useState(null);
  const [recommendationsLoading, setRecommendationsLoading] = useState(true);
  const [discoverySearch, setDiscoverySearch] = useState('');
  const [discoveryCandidates, setDiscoveryCandidates] = useState([]);
  const [discoverySummary, setDiscoverySummary] = useState(null);
  const [discoveryFocus, setDiscoveryFocus] = useState(null);
  const [discoveryLoading, setDiscoveryLoading] = useState(true);
  const [comicDuplicateSearch, setComicDuplicateSearch] = useState('');
  const [comicDuplicateCandidates, setComicDuplicateCandidates] = useState([]);
  const [comicDuplicateSummary, setComicDuplicateSummary] = useState(null);
  const [suppressedComicGroups, setSuppressedComicGroups] = useState([]);
  const [comicDuplicatesLoading, setComicDuplicatesLoading] = useState(true);
  const [activeComicGroupId, setActiveComicGroupId] = useState('');
  const [activeComicGroupLabel, setActiveComicGroupLabel] = useState('');
  const [comicAdvanceMessage, setComicAdvanceMessage] = useState('');
  const [collectionDuplicateSearch, setCollectionDuplicateSearch] = useState('');
  const [collectionDuplicates, setCollectionDuplicates] = useState([]);
  const [collectionDuplicateSummary, setCollectionDuplicateSummary] = useState(null);
  const [collectionDuplicatesLoading, setCollectionDuplicatesLoading] = useState(true);
  const [sectionFilter, setSectionFilter] = useState('all');
  const [activeTab, setActiveTab] = useState('recommended');
  const [activeReviewSource, setActiveReviewSource] = useState('manual');
  const [activeReviewKey, setActiveReviewKey] = useState('');
  const [suppressedOutcomeFilter, setSuppressedOutcomeFilter] = useState('all');
  const [suppressedSearch, setSuppressedSearch] = useState('');
  const [suppressedHistory, setSuppressedHistory] = useState([]);
  const [suppressedHistorySummary, setSuppressedHistorySummary] = useState(null);
  const [suppressedHistoryLoading, setSuppressedHistoryLoading] = useState(true);
  const [collectionPreview, setCollectionPreview] = useState(null);
  const [collectionPreviewLoading, setCollectionPreviewLoading] = useState(false);
  const [collectionMergeDetails, setCollectionMergeDetails] = useState(null);
  const [collectionApplyResult, setCollectionApplyResult] = useState(null);
  const [collectionRevertResult, setCollectionRevertResult] = useState(null);
  const [collectionApplyConfirmOpen, setCollectionApplyConfirmOpen] = useState(false);
  const [collectionApplying, setCollectionApplying] = useState(false);
  const [revertingCollectionDuplicateId, setRevertingCollectionDuplicateId] = useState('');
  const [rejectingRecommendationId, setRejectingRecommendationId] = useState('');
  const [rejectingDiscoveryId, setRejectingDiscoveryId] = useState('');
  const [rejectConfirmId, setRejectConfirmId] = useState('');
  const [rejectDrafts, setRejectDrafts] = useState({});
  const [preview, setPreview] = useState(null);
  const [mergeDetails, setMergeDetails] = useState(null);
  const [applyResult, setApplyResult] = useState(null);
  const [revertResult, setRevertResult] = useState(null);
  const [applyConfirmOpen, setApplyConfirmOpen] = useState(false);
  const [errorState, setErrorState] = useState(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [revertingDuplicateId, setRevertingDuplicateId] = useState('');
  const [restoringFeedbackId, setRestoringFeedbackId] = useState('');

  const comparedRows = Array.isArray(preview?.preview?.field_comparison) ? preview.preview.field_comparison : [];
  const activeComicGroup = useMemo(
    () => comicDuplicateCandidates.find((group) => String(group?.duplicate_group_id || '') === String(activeComicGroupId || '')) || null,
    [comicDuplicateCandidates, activeComicGroupId]
  );
  const activeRemainingComicPairs = useMemo(() => {
    if (!activeComicGroup) return 0;
    return Array.isArray(activeComicGroup.duplicates) ? activeComicGroup.duplicates.length : 0;
  }, [activeComicGroup]);
  const rewiringRows = useMemo(
    () => buildImpactRows(preview?.preview?.dependent_rewiring || {}),
    [preview]
  );
  const historyRows = useMemo(
    () => buildHistoryRows(preview?.preview?.history_context || {}),
    [preview]
  );
  const selectedSectionLabel = useMemo(
    () => MERGE_REVIEW_SECTION_OPTIONS.find((option) => option.value === sectionFilter)?.label || 'All sections',
    [sectionFilter]
  );
  const tabOptions = useMemo(() => MERGE_REVIEW_TABS, []);
  const manualReviewOpen = activeReviewSource === 'manual' && (!!preview || !!errorState || !!applyResult?.applied || !!revertResult?.reverted || Number(mergeDetails?.summary?.active_merge_count || 0) > 0);

  const clearPreview = ({ closeReview = false } = {}) => {
    setPreview(null);
    setMergeDetails(null);
    setApplyResult(null);
    setRevertResult(null);
    setApplyConfirmOpen(false);
    setErrorState(null);
    if (closeReview) {
      setActiveReviewSource('manual');
      setActiveReviewKey('');
    }
  };

  const loadComicPair = async (group, duplicate, options = {}) => {
    const canonical = group?.canonical || null;
    if (!canonical?.id || !duplicate?.id) {
      onToast('Pick a comic duplicate group with at least two records', 'error');
      return false;
    }
    setActiveTab('comics');
    setActiveReviewSource('comics');
    setActiveReviewKey(buildPairReviewKey(canonical.id, duplicate.id));
    if (!options.preserveGroup) {
      setActiveComicGroupId(String(group?.duplicate_group_id || ''));
      setActiveComicGroupLabel(`${group?.series || 'Unknown series'} #${group?.issue_number || '—'}`);
    }
    if (!options.preserveMessage) {
      setComicAdvanceMessage('');
    }
    setCanonicalId(String(canonical.id));
    setDuplicateId(String(duplicate.id));
    setCanonicalSearch(canonical.title || '');
    setDuplicateSearch(duplicate.title || '');
    await requestPreview(Number(canonical.id), Number(duplicate.id));
    return true;
  };

  const findNextComicDuplicate = (group) => (group?.duplicates || [])[0] || null;

  const clearCollectionPreview = () => {
    setCollectionPreview(null);
    setCollectionMergeDetails(null);
    setCollectionApplyResult(null);
    setCollectionRevertResult(null);
    setCollectionApplyConfirmOpen(false);
  };

  const loadRecommendations = async () => {
    setRecommendationsLoading(true);
    try {
      const query = new URLSearchParams({ limit: '12' });
      if (sectionFilter !== 'all') query.set('media_type', sectionFilter);
      const payload = await apiCall('get', `/media/merge-recommendations?${query.toString()}`);
      setRecommendations(Array.isArray(payload?.items) ? payload.items : []);
      setRecommendationsSummary(payload?.summary || null);
    } catch (_) {
      setRecommendations([]);
      setRecommendationsSummary(null);
    } finally {
      setRecommendationsLoading(false);
    }
  };

  const loadDiscoveryCandidates = async ({ searchValue = discoverySearch, mediaId = null } = {}) => {
    setDiscoveryLoading(true);
    try {
      const query = new URLSearchParams({ limit: '12' });
      if (String(searchValue || '').trim()) query.set('search', String(searchValue).trim());
      if (Number(mediaId || 0) > 0) query.set('media_id', String(Number(mediaId)));
      if (sectionFilter !== 'all') query.set('media_type', sectionFilter);
      const payload = await apiCall('get', `/media/discovery-candidates?${query.toString()}`);
      setDiscoveryCandidates(Array.isArray(payload?.items) ? payload.items : []);
      setDiscoverySummary(payload?.summary || null);
      setDiscoveryFocus(payload?.focus || null);
      return payload || null;
    } catch (_) {
      setDiscoveryCandidates([]);
      setDiscoverySummary(null);
      setDiscoveryFocus(null);
      return null;
    } finally {
      setDiscoveryLoading(false);
    }
  };

  const loadComicDuplicateCandidates = async (searchValue = comicDuplicateSearch) => {
    setComicDuplicatesLoading(true);
    try {
      const query = new URLSearchParams({ limit: '12' });
      if (String(searchValue || '').trim()) query.set('search', String(searchValue).trim());
      if (sectionFilter !== 'all') query.set('media_type', sectionFilter);
      const payload = await apiCall('get', `/media/comics/duplicate-candidates?${query.toString()}`);
      const items = Array.isArray(payload?.items) ? payload.items : [];
      const suppressedItems = Array.isArray(payload?.suppressed_items) ? payload.suppressed_items : [];
      setComicDuplicateCandidates(items);
      setComicDuplicateSummary(payload?.summary || null);
      setSuppressedComicGroups(suppressedItems);
      return {
        items,
        summary: payload?.summary || null,
        suppressedItems
      };
    } catch (_) {
      setComicDuplicateCandidates([]);
      setComicDuplicateSummary(null);
      setSuppressedComicGroups([]);
      return {
        items: [],
        summary: null,
        suppressedItems: []
      };
    } finally {
      setComicDuplicatesLoading(false);
    }
  };

  const loadCollectionDuplicates = async (searchValue = collectionDuplicateSearch) => {
    setCollectionDuplicatesLoading(true);
    try {
      const query = new URLSearchParams({ limit: '12' });
      if (String(searchValue || '').trim()) query.set('search', String(searchValue).trim());
      if (sectionFilter !== 'all') query.set('media_type', sectionFilter);
      const payload = await apiCall('get', `/media/collections/duplicates?${query.toString()}`);
      setCollectionDuplicates(Array.isArray(payload?.items) ? payload.items : []);
      setCollectionDuplicateSummary(payload?.summary || null);
    } catch (_) {
      setCollectionDuplicates([]);
      setCollectionDuplicateSummary(null);
    } finally {
      setCollectionDuplicatesLoading(false);
    }
  };

  const loadSuppressedHistory = async ({ outcomeValue = suppressedOutcomeFilter, searchValue = suppressedSearch } = {}) => {
    setSuppressedHistoryLoading(true);
    try {
      const query = new URLSearchParams({ limit: '12' });
      if (sectionFilter !== 'all') query.set('media_type', sectionFilter);
      if (outcomeValue !== 'all') query.set('outcome', outcomeValue);
      if (String(searchValue || '').trim()) query.set('search', String(searchValue).trim());
      const payload = await apiCall('get', `/media/merge-recommendations/history?${query.toString()}`);
      setSuppressedHistory(Array.isArray(payload?.items) ? payload.items : []);
      setSuppressedHistorySummary(payload?.summary || null);
      return payload || null;
    } catch (_) {
      setSuppressedHistory([]);
      setSuppressedHistorySummary(null);
      return null;
    } finally {
      setSuppressedHistoryLoading(false);
    }
  };

  useEffect(() => {
    loadRecommendations();
    loadDiscoveryCandidates({ searchValue: '', mediaId: null });
    loadComicDuplicateCandidates('');
    loadCollectionDuplicates('');
    loadSuppressedHistory({ outcomeValue: 'all', searchValue: '' });
  }, [apiCall, activeLibrary?.id, activeSpace?.id, sectionFilter]);

  useEffect(() => {
    if (!seededDiscovery?.mediaId) return;
    setActiveTab('discovery');
    setDiscoverySearch('');
    loadDiscoveryCandidates({
      searchValue: '',
      mediaId: seededDiscovery.mediaId
    }).then((payload) => {
      if (payload?.focus?.title) {
        onToast(`Loaded possible duplicates for ${payload.focus.title}.`, 'success');
      }
    });
    onDiscoverySeedConsumed?.();
  }, [seededDiscovery?.mediaId]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const query = new URLSearchParams({ limit: '12' });
        if (discoverySearch.trim()) query.set('search', discoverySearch.trim());
        if (discoveryFocus?.id) query.set('media_id', String(discoveryFocus.id));
        if (sectionFilter !== 'all') query.set('media_type', sectionFilter);
        const payload = await apiCall('get', `/media/discovery-candidates?${query.toString()}`);
        if (!active) return;
        setDiscoveryCandidates(Array.isArray(payload?.items) ? payload.items : []);
        setDiscoverySummary(payload?.summary || null);
        setDiscoveryFocus(payload?.focus || null);
      } catch (_) {
        if (!active) return;
        setDiscoveryCandidates([]);
        setDiscoverySummary(null);
        setDiscoveryFocus(null);
      } finally {
        if (active) setDiscoveryLoading(false);
      }
    }, 220);
    setDiscoveryLoading(true);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [apiCall, discoverySearch, discoveryFocus?.id, sectionFilter]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const query = new URLSearchParams({ limit: '12' });
        if (comicDuplicateSearch.trim()) query.set('search', comicDuplicateSearch.trim());
        if (sectionFilter !== 'all') query.set('media_type', sectionFilter);
        const payload = await apiCall('get', `/media/comics/duplicate-candidates?${query.toString()}`);
        if (!active) return;
        setComicDuplicateCandidates(Array.isArray(payload?.items) ? payload.items : []);
        setComicDuplicateSummary(payload?.summary || null);
        setSuppressedComicGroups(Array.isArray(payload?.suppressed_items) ? payload.suppressed_items : []);
      } catch (_) {
        if (!active) return;
        setComicDuplicateCandidates([]);
        setComicDuplicateSummary(null);
        setSuppressedComicGroups([]);
      } finally {
        if (active) setComicDuplicatesLoading(false);
      }
    }, 220);
    setComicDuplicatesLoading(true);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [apiCall, comicDuplicateSearch, sectionFilter]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const query = new URLSearchParams({ limit: '12' });
        if (collectionDuplicateSearch.trim()) query.set('search', collectionDuplicateSearch.trim());
        if (sectionFilter !== 'all') query.set('media_type', sectionFilter);
        const payload = await apiCall('get', `/media/collections/duplicates?${query.toString()}`);
        if (!active) return;
        setCollectionDuplicates(Array.isArray(payload?.items) ? payload.items : []);
        setCollectionDuplicateSummary(payload?.summary || null);
      } catch (_) {
        if (!active) return;
        setCollectionDuplicates([]);
        setCollectionDuplicateSummary(null);
      } finally {
        if (active) setCollectionDuplicatesLoading(false);
      }
    }, 220);
    setCollectionDuplicatesLoading(true);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [apiCall, collectionDuplicateSearch, sectionFilter]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const query = new URLSearchParams({ limit: '12' });
        if (sectionFilter !== 'all') query.set('media_type', sectionFilter);
        if (suppressedOutcomeFilter !== 'all') query.set('outcome', suppressedOutcomeFilter);
        if (suppressedSearch.trim()) query.set('search', suppressedSearch.trim());
        const payload = await apiCall('get', `/media/merge-recommendations/history?${query.toString()}`);
        if (!active) return;
        setSuppressedHistory(Array.isArray(payload?.items) ? payload.items : []);
        setSuppressedHistorySummary(payload?.summary || null);
      } catch (_) {
        if (!active) return;
        setSuppressedHistory([]);
        setSuppressedHistorySummary(null);
      } finally {
        if (active) setSuppressedHistoryLoading(false);
      }
    }, 220);
    setSuppressedHistoryLoading(true);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [apiCall, sectionFilter, suppressedOutcomeFilter, suppressedSearch]);

  useEffect(() => {
    let active = true;
    if (canonicalSearch.trim().length < 2) {
      setCanonicalResults([]);
      setCanonicalSearchLoading(false);
      return undefined;
    }
    setCanonicalSearchLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const payload = await apiCall('get', `/media?search=${encodeURIComponent(canonicalSearch.trim())}&limit=8`);
        if (!active) return;
        setCanonicalResults(Array.isArray(payload?.items) ? payload.items : []);
      } catch (_) {
        if (!active) return;
        setCanonicalResults([]);
      } finally {
        if (active) setCanonicalSearchLoading(false);
      }
    }, 220);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [apiCall, canonicalSearch]);

  useEffect(() => {
    let active = true;
    if (duplicateSearch.trim().length < 2) {
      setDuplicateResults([]);
      setDuplicateSearchLoading(false);
      return undefined;
    }
    setDuplicateSearchLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const payload = await apiCall('get', `/media?search=${encodeURIComponent(duplicateSearch.trim())}&limit=8`);
        if (!active) return;
        setDuplicateResults(Array.isArray(payload?.items) ? payload.items : []);
      } catch (_) {
        if (!active) return;
        setDuplicateResults([]);
      } finally {
        if (active) setDuplicateSearchLoading(false);
      }
    }, 220);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [apiCall, duplicateSearch]);

  const swapDraft = () => {
    setCanonicalId(duplicateId);
    setDuplicateId(canonicalId);
    setCanonicalSearch(duplicateSearch);
    setDuplicateSearch(canonicalSearch);
    clearPreview();
  };

  const pickCanonicalRecord = (record) => {
    setCanonicalId(String(record?.id || ''));
    setCanonicalSearch(record?.title || '');
    clearPreview();
  };

  const pickDuplicateRecord = (record) => {
    setDuplicateId(String(record?.id || ''));
    setDuplicateSearch(record?.title || '');
    clearPreview();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setActiveComicGroupId('');
    setActiveComicGroupLabel('');
    setComicAdvanceMessage('');
    setActiveReviewSource('manual');
    setActiveReviewKey('manual');
    await requestPreview(Number(canonicalId), Number(duplicateId));
  };

  const requestPreview = async (nextCanonicalId, nextDuplicateId) => {
    setLoading(true);
    setPreview(null);
    setApplyResult(null);
    setRevertResult(null);
    setApplyConfirmOpen(false);
    setErrorState(null);
    try {
      const payload = await apiCall('post', '/media/merge-preview', {
        canonical_id: Number(nextCanonicalId),
        duplicate_id: Number(nextDuplicateId)
      });
      setPreview(payload);
      try {
        const details = await apiCall('get', `/media/${Number(nextCanonicalId)}/merge-details`);
        setMergeDetails(details);
      } catch (_) {
        setMergeDetails(null);
      }
    } catch (error) {
      const response = error?.response?.data || null;
      setErrorState({
        message: response?.error || 'Failed to load merge preview.',
        details: response?.details || null,
        canonical: response?.canonical || null,
        duplicate: response?.duplicate || null
      });
      onToast(response?.error || 'Failed to load merge preview', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleRecommendationReview = async (item) => {
    setActiveTab('recommended');
    setActiveReviewSource('recommended');
    setActiveReviewKey(buildReviewItemKey(item));
    setActiveComicGroupId('');
    setActiveComicGroupLabel('');
    setComicAdvanceMessage('');
    setRejectConfirmId('');
    setCanonicalId(String(item?.canonical?.id || ''));
    setDuplicateId(String(item?.duplicate?.id || ''));
    setCanonicalSearch(item?.canonical?.title || '');
    setDuplicateSearch(item?.duplicate?.title || '');
    await requestPreview(Number(item?.canonical?.id || 0), Number(item?.duplicate?.id || 0));
  };

  const handleDiscoveryReview = async (item) => {
    setActiveTab('discovery');
    setActiveReviewSource('discovery');
    setActiveReviewKey(buildReviewItemKey(item));
    setActiveComicGroupId('');
    setActiveComicGroupLabel('');
    setComicAdvanceMessage('');
    setRejectConfirmId('');
    setCanonicalId(String(item?.canonical?.id || ''));
    setDuplicateId(String(item?.duplicate?.id || ''));
    setCanonicalSearch(item?.canonical?.title || '');
    setDuplicateSearch(item?.duplicate?.title || '');
    await requestPreview(Number(item?.canonical?.id || 0), Number(item?.duplicate?.id || 0));
  };

  const handleSuppressedReview = async (item) => {
    setActiveTab('suppressed');
    setActiveReviewSource('suppressed');
    setActiveReviewKey(buildReviewItemKey(item));
    setActiveComicGroupId('');
    setActiveComicGroupLabel('');
    setComicAdvanceMessage('');
    setCanonicalId(String(item?.canonical?.id || ''));
    setDuplicateId(String(item?.duplicate?.id || ''));
    setCanonicalSearch(item?.canonical?.title || '');
    setDuplicateSearch(item?.duplicate?.title || '');
    await requestPreview(Number(item?.canonical?.id || 0), Number(item?.duplicate?.id || 0));
  };

  const handleComicDuplicateReview = async (group, duplicateRecord = null) => {
    const duplicate = duplicateRecord || (Array.isArray(group?.duplicates) ? group.duplicates[0] : null);
    await loadComicPair(group, duplicate);
  };

  const handleRecommendationReject = async (item, confirmed) => {
    const recommendationId = String(item?.recommendation_id || '');
    if (!recommendationId) return;
    if (confirmed === null) {
      setRejectConfirmId('');
      setRejectDrafts((current) => {
        const next = { ...current };
        delete next[recommendationId];
        return next;
      });
      return;
    }
    if (!confirmed) {
      setRejectDrafts((current) => ({
        ...current,
        [recommendationId]: current[recommendationId] || {
          reason_code: RECOMMENDATION_REJECTION_REASONS[0].value,
          reason: ''
        }
      }));
      setRejectConfirmId(recommendationId);
      return;
    }
    const rejectDraft = rejectDrafts[recommendationId] || {
      reason_code: RECOMMENDATION_REJECTION_REASONS[0].value,
      reason: ''
    };
    setRejectingRecommendationId(recommendationId);
    setErrorState(null);
    try {
      const payload = await apiCall('post', '/media/merge-recommendations/reject', {
        canonical_id: Number(item?.canonical?.id || 0),
        duplicate_id: Number(item?.duplicate?.id || 0),
        reason_code: rejectDraft.reason_code,
        reason: String(rejectDraft.reason || '').trim() || null
      });
      setRecommendations(Array.isArray(payload?.recommendations?.items) ? payload.recommendations.items : []);
      setRecommendationsSummary(payload?.recommendations?.summary || null);
      setRejectConfirmId('');
      setRejectDrafts((current) => {
        const next = { ...current };
        delete next[recommendationId];
        return next;
      });
      await loadSuppressedHistory({ outcomeValue: suppressedOutcomeFilter, searchValue: suppressedSearch });
      onToast('Recommendation removed from the queue', 'success');
    } catch (error) {
      const response = error?.response?.data || null;
      onToast(response?.error || 'Failed to reject recommendation', 'error');
    } finally {
      setRejectingRecommendationId('');
    }
  };

  const handleDiscoveryReject = async (item, confirmed) => {
    const discoveryId = String(item?.discovery_id || '');
    if (!discoveryId) return;
    if (confirmed === null) {
      setRejectConfirmId('');
      setRejectDrafts((current) => {
        const next = { ...current };
        delete next[discoveryId];
        return next;
      });
      return;
    }
    if (!confirmed) {
      setRejectDrafts((current) => ({
        ...current,
        [discoveryId]: current[discoveryId] || {
          reason_code: RECOMMENDATION_REJECTION_REASONS[0].value,
          reason: ''
        }
      }));
      setRejectConfirmId(discoveryId);
      return;
    }
    const rejectDraft = rejectDrafts[discoveryId] || {
      reason_code: RECOMMENDATION_REJECTION_REASONS[0].value,
      reason: ''
    };
    setRejectingDiscoveryId(discoveryId);
    setErrorState(null);
    try {
      await apiCall('post', '/media/merge-recommendations/reject', {
        canonical_id: Number(item?.canonical?.id || 0),
        duplicate_id: Number(item?.duplicate?.id || 0),
        reason_code: rejectDraft.reason_code,
        reason: String(rejectDraft.reason || '').trim() || null
      });
      await loadDiscoveryCandidates({ searchValue: discoverySearch, mediaId: discoveryFocus?.id || null });
      await loadSuppressedHistory({ outcomeValue: suppressedOutcomeFilter, searchValue: suppressedSearch });
      setRejectConfirmId('');
      setRejectDrafts((current) => {
        const next = { ...current };
        delete next[discoveryId];
        return next;
      });
      onToast('Discovery candidate removed from the queue', 'success');
    } catch (error) {
      const response = error?.response?.data || null;
      onToast(response?.error || 'Failed to reject discovery candidate', 'error');
    } finally {
      setRejectingDiscoveryId('');
    }
  };

  const handleRejectDraftChange = (item, nextDraft) => {
    const recommendationId = String(item?.recommendation_id || item?.discovery_id || '');
    if (!recommendationId) return;
    setRejectDrafts((current) => ({
      ...current,
      [recommendationId]: nextDraft
    }));
  };

  const handleApply = async () => {
    if (!preview?.allowed || applying) return;
    setApplying(true);
    setErrorState(null);
    try {
      const payload = await apiCall('post', '/media/merge-apply', {
        canonical_id: Number(preview.canonical?.id || canonicalId),
        duplicate_id: Number(preview.duplicate?.id || duplicateId)
      });
      setApplyResult(payload);
      setRevertResult(null);
      setPreview(null);
      setMergeDetails(payload?.merge_details || null);
      setApplyConfirmOpen(false);
      setDuplicateId('');
      setDuplicateSearch('');
      await loadRecommendations();
      const refreshedComicGroups = await loadComicDuplicateCandidates();
      const activeGroup = (refreshedComicGroups?.items || []).find(
        (group) => String(group?.duplicate_group_id || '') === String(activeComicGroupId || '')
      );
      const nextDuplicate = findNextComicDuplicate(activeGroup);
      if (activeGroup?.canonical?.id && nextDuplicate?.id) {
        setComicAdvanceMessage(`Next pair ready for ${activeComicGroupLabel || `${activeGroup.series || 'Unknown series'} #${activeGroup.issue_number || '—'}`}.`);
        await loadComicPair(activeGroup, nextDuplicate, { preserveGroup: true, preserveMessage: true });
        onToast('Manual merge applied. Loaded the next comic pair in this issue cluster.', 'success');
      } else if (activeComicGroupId) {
        setActiveComicGroupId('');
        setActiveComicGroupLabel('');
        setComicAdvanceMessage('');
        onToast('Manual merge applied. This comic issue cluster is clear.', 'success');
      } else {
        onToast('Manual merge applied', 'success');
      }
    } catch (error) {
      const response = error?.response?.data || null;
      setErrorState({
        message: response?.error || 'Failed to apply manual merge.',
        details: response?.details || null,
        canonical: response?.canonical || preview?.canonical || null,
        duplicate: response?.duplicate || preview?.duplicate || null
      });
      onToast(response?.error || 'Failed to apply manual merge', 'error');
    } finally {
      setApplying(false);
    }
  };

  const handleSkipComicPair = async () => {
    if (!activeComicGroupId || !activeComicGroup) return;
    const canonicalIdValue = Number(preview?.canonical?.id || activeComicGroup?.canonical?.id || canonicalId || 0);
    const currentDuplicateId = Number(preview?.duplicate?.id || duplicateId || 0);
    if (!currentDuplicateId || !canonicalIdValue) return;
    setApplying(true);
    setErrorState(null);
    try {
      await apiCall('post', '/media/merge-recommendations/defer?limit=12', {
        canonical_id: canonicalIdValue,
        duplicate_id: currentDuplicateId,
        reason_code: 'other',
        reason: 'Deferred from the comic issue workflow'
      });
      const refreshedComicGroups = await loadComicDuplicateCandidates();
      const activeGroup = (refreshedComicGroups?.items || []).find(
        (group) => String(group?.duplicate_group_id || '') === String(activeComicGroupId || '')
      );
      const nextDuplicate = findNextComicDuplicate(activeGroup);
      if (!nextDuplicate?.id) {
        setComicAdvanceMessage(`All remaining pairs in ${activeComicGroupLabel || 'this issue cluster'} are deferred for now.`);
        clearPreview();
        setActiveComicGroupId('');
        setActiveComicGroupLabel('');
        onToast('Deferred this comic pair. No more active pairs remain in this issue cluster right now.', 'success');
        return;
      }
      setComicAdvanceMessage(`Next pair ready for ${activeComicGroupLabel || 'this issue cluster'}.`);
      await loadComicPair(activeGroup, nextDuplicate, { preserveGroup: true, preserveMessage: true });
      onToast('Deferred this comic pair and loaded the next one in the issue cluster.', 'success');
    } catch (error) {
      const response = error?.response?.data || null;
      setErrorState({
        message: response?.error || 'Failed to defer comic pair.',
        details: response?.details || null,
        canonical: response?.canonical || preview?.canonical || null,
        duplicate: response?.duplicate || preview?.duplicate || null
      });
      onToast(response?.error || 'Failed to defer comic pair', 'error');
    } finally {
      setApplying(false);
    }
  };

  const handleRevert = async (entry) => {
    const canonicalIdValue = Number(mergeDetails?.canonical?.id || preview?.canonical?.id || applyResult?.canonical?.id || canonicalId || 0);
    const duplicateIdValue = Number(entry?.duplicate_id || entry?.technical_details?.duplicate_id || 0);
    if (!canonicalIdValue || !duplicateIdValue) return;
    setRevertingDuplicateId(String(duplicateIdValue));
    setErrorState(null);
    try {
      const payload = await apiCall('post', '/media/merge-revert', {
        canonical_id: canonicalIdValue,
        duplicate_id: duplicateIdValue
      });
      setMergeDetails(payload?.merge_details || null);
      setApplyResult(null);
      setRevertResult(payload);
      await loadRecommendations();
      await loadComicDuplicateCandidates();
      onToast('Merge reverted', 'success');
    } catch (error) {
      const response = error?.response?.data || null;
      onToast(response?.error || 'Failed to revert merge', 'error');
    } finally {
      setRevertingDuplicateId('');
    }
  };

  const handleRestoreSuppressedPair = async (item) => {
    const feedbackId = String(item?.feedback_id || '');
    if (!feedbackId) return;
    setRestoringFeedbackId(feedbackId);
    try {
      const query = new URLSearchParams({ limit: '12', history_limit: '12' });
      if (sectionFilter !== 'all') query.set('media_type', sectionFilter);
      if (suppressedOutcomeFilter !== 'all') query.set('outcome', suppressedOutcomeFilter);
      if (suppressedSearch.trim()) query.set('search', suppressedSearch.trim());
      const payload = await apiCall('post', `/media/merge-recommendations/restore?${query.toString()}`, {
        feedback_id: Number(feedbackId)
      });
      setRecommendations(Array.isArray(payload?.recommendations?.items) ? payload.recommendations.items : []);
      setRecommendationsSummary(payload?.recommendations?.summary || null);
      setSuppressedHistory(Array.isArray(payload?.history?.items) ? payload.history.items : []);
      setSuppressedHistorySummary(payload?.history?.summary || null);
      await loadComicDuplicateCandidates();
      await loadDiscoveryCandidates({ searchValue: discoverySearch, mediaId: discoveryFocus?.id || null });
      onToast('Suppressed pair restored to the review queues', 'success');
    } catch (error) {
      const response = error?.response?.data || null;
      onToast(response?.error || 'Failed to restore suppressed pair', 'error');
    } finally {
      setRestoringFeedbackId('');
    }
  };

  const handleCollectionReview = async (group) => {
    setActiveTab('collections');
    setActiveComicGroupId('');
    setActiveComicGroupLabel('');
    setComicAdvanceMessage('');
    const left = group?.collections?.[0];
    const right = group?.collections?.[1];
    if (!left?.id || !right?.id) {
      onToast('Pick a duplicate collection group with at least two collections', 'error');
      return;
    }
    setCollectionPreviewLoading(true);
    setCollectionPreview(null);
    setCollectionMergeDetails(null);
    setCollectionApplyResult(null);
    setCollectionRevertResult(null);
    setCollectionApplyConfirmOpen(false);
    try {
      const query = new URLSearchParams({
        left_id: String(left.id),
        right_id: String(right.id)
      });
      const payload = await apiCall('get', `/media/collections/duplicate-preview?${query.toString()}`);
      setCollectionPreview(payload);
      try {
        const details = await apiCall('get', `/media/collections/${left.id}/merge-details`);
        setCollectionMergeDetails(details);
      } catch (_) {
        setCollectionMergeDetails(null);
      }
    } catch (error) {
      const response = error?.response?.data || null;
      onToast(response?.error || 'Failed to load collection preview', 'error');
    } finally {
      setCollectionPreviewLoading(false);
    }
  };

  const handleCollectionApply = async () => {
    const canonicalCollectionId = Number(collectionPreview?.left?.id || 0);
    const duplicateCollectionId = Number(collectionPreview?.right?.id || 0);
    if (!canonicalCollectionId || !duplicateCollectionId || collectionApplying) return;
    setCollectionApplying(true);
    try {
      const payload = await apiCall('post', '/media/collections/merge-apply', {
        canonical_id: canonicalCollectionId,
        duplicate_id: duplicateCollectionId
      });
      setCollectionApplyResult(payload);
      setCollectionRevertResult(null);
      setCollectionPreview(null);
      setCollectionMergeDetails(payload?.merge_details || null);
      setCollectionApplyConfirmOpen(false);
      await loadCollectionDuplicates();
      onToast('Collection merge applied', 'success');
    } catch (error) {
      const response = error?.response?.data || null;
      onToast(response?.error || 'Failed to apply collection merge', 'error');
    } finally {
      setCollectionApplying(false);
    }
  };

  const handleCollectionRevert = async (entry) => {
    const canonicalCollectionId = Number(collectionMergeDetails?.collection?.id || collectionApplyResult?.canonical?.id || 0);
    const duplicateCollectionId = Number(entry?.duplicate_id || 0);
    if (!canonicalCollectionId || !duplicateCollectionId) return;
    setRevertingCollectionDuplicateId(String(duplicateCollectionId));
    try {
      const payload = await apiCall('post', '/media/collections/merge-revert', {
        canonical_id: canonicalCollectionId,
        duplicate_id: duplicateCollectionId
      });
      setCollectionMergeDetails(payload?.merge_details || null);
      setCollectionApplyResult(null);
      setCollectionRevertResult(payload);
      await loadCollectionDuplicates();
      onToast('Collection merge reverted', 'success');
    } catch (error) {
      const response = error?.response?.data || null;
      onToast(response?.error || 'Failed to revert collection merge', 'error');
    } finally {
      setRevertingCollectionDuplicateId('');
    }
  };

  const closeInlineReview = () => {
    clearPreview({ closeReview: true });
    setActiveComicGroupId('');
    setActiveComicGroupLabel('');
    setComicAdvanceMessage('');
  };

  const renderActiveReviewWorkspace = () => (
    <MergeReviewWorkspace
      preview={preview}
      errorState={errorState}
      comparedRows={comparedRows}
      rewiringRows={rewiringRows}
      historyRows={historyRows}
      activeComicGroupId={activeComicGroupId}
      activeComicGroupLabel={activeComicGroupLabel}
      activeRemainingComicPairs={activeRemainingComicPairs}
      applyConfirmOpen={applyConfirmOpen}
      setApplyConfirmOpen={setApplyConfirmOpen}
      applying={applying}
      onApply={handleApply}
      onSkipComicPair={handleSkipComicPair}
      onClose={closeInlineReview}
      mergeDetails={mergeDetails}
      revertingDuplicateId={revertingDuplicateId}
      onRevert={handleRevert}
      applyResult={applyResult}
      revertResult={revertResult}
      Spinner={Spinner}
    />
  );

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 space-y-6">
      <div className="space-y-3">
        <h1 className="section-title">Merge Review</h1>
        <p className="max-w-3xl text-sm text-ghost">
          Review a same-type pairwise merge inside the current workspace and library scope, then apply it deliberately when the comparison looks right.
        </p>
      </div>

      <div className="rounded-lg border border-edge bg-void/10 px-4 py-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ghost">
            <span><span className="text-ink">Workspace:</span> {activeSpace?.name || 'Current workspace'}</span>
            <span><span className="text-ink">Library:</span> {activeLibrary?.name || 'Current library'}</span>
            <span><span className="text-ink">Boundary:</span> Same type only</span>
            <span><span className="text-ink">Mode:</span> Preview first</span>
          </div>
          <label className="field min-w-0 xl:w-64">
            <span className="label">Library section</span>
            <select className="select h-9" value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value)}>
              {MERGE_REVIEW_SECTION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-ink">Exact pair review</h2>
          <p className="text-sm text-ghost">Search for an exact pair at any time, then keep the lane tabs focused on the queues that need attention.</p>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <RecordSearchPanel
            title="Find this record"
            value={canonicalSearch}
            onChange={setCanonicalSearch}
            loading={canonicalSearchLoading}
            results={canonicalResults}
            selectedId={canonicalId}
            onPick={pickCanonicalRecord}
            placeholder="Search title, isbn, creator, or year"
          />
          <RecordSearchPanel
            title="Find matched record"
            value={duplicateSearch}
            onChange={setDuplicateSearch}
            loading={duplicateSearchLoading}
            results={duplicateResults}
            selectedId={duplicateId}
            onPick={pickDuplicateRecord}
            placeholder="Search title, isbn, creator, or year"
          />
        </div>

        <form onSubmit={handleSubmit} className="rounded-lg border border-edge bg-void/10 p-4 space-y-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] lg:items-end">
            <label className="field">
              <span className="label">This record id</span>
              <input
                className="input"
                inputMode="numeric"
                placeholder="Canonical record id"
                value={canonicalId}
                onChange={(event) => setCanonicalId(event.target.value)}
              />
            </label>
            <button type="button" className="btn-secondary btn-sm h-10" onClick={swapDraft} disabled={loading}>
              Swap
            </button>
            <label className="field">
              <span className="label">Matched record id</span>
              <input
                className="input"
                inputMode="numeric"
                placeholder="Matched record id"
                value={duplicateId}
                onChange={(event) => setDuplicateId(event.target.value)}
              />
            </label>
            <div className="flex gap-2">
              <button
                type="submit"
                className="btn-primary h-10"
                disabled={loading || !canonicalId.trim() || !duplicateId.trim()}
              >
                {loading ? <><Spinner size={14} />Loading…</> : 'Preview merge'}
              </button>
              {manualReviewOpen ? (
                <button type="button" className="btn-secondary h-10" onClick={() => clearPreview({ closeReview: true })} disabled={loading}>
                  Clear
                </button>
              ) : null}
            </div>
          </div>
        </form>

        {manualReviewOpen ? renderActiveReviewWorkspace() : null}
      </section>

      <div className="md:hidden">
        <label className="field">
          <span className="label">Section</span>
          <select className="select h-9" value={activeTab} onChange={(event) => setActiveTab(event.target.value)}>
            {tabOptions.map((tab) => (
              <option key={tab.id} value={tab.id}>{tab.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="hidden md:block">
        <SectionTabs
          tabs={tabOptions}
          activeId={activeTab}
          onChange={setActiveTab}
          ariaLabel="Merge review sections"
          idBase="merge-review-sections"
        />
      </div>

      <SectionTabPanel activeId={activeTab} tabKey="discovery" idBase="merge-review-sections" className="space-y-4 border-t border-edge pt-5">
      <section className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-ink">Discovery</h2>
          <p className="text-sm text-ghost">Likely duplicates surfaced from lighter signals so visually obvious pairs do not depend on strict merge rules alone.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {discoverySummary ? (
            <div className="text-xs text-ghost">
              {selectedSectionLabel} · {discoverySummary.returned_candidates || 0} shown · {discoverySummary.shared_cover_candidates || 0} cover-path matches · {discoverySummary.exact_title_candidates || 0} exact-title matches
            </div>
          ) : null}
          <input
            className="input h-9 w-full sm:w-64"
            value={discoverySearch}
            onChange={(event) => setDiscoverySearch(event.target.value)}
            placeholder="Search discovery queue"
          />
        </div>
      </div>
      <div className="rounded-lg border border-edge bg-void/10">
        <div className="flex flex-col gap-3 border-b border-edge/70 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <h3 className="text-sm font-medium text-ink">Discovery queue</h3>
        </div>
        {discoveryFocus?.id ? (
          <div className="flex flex-col gap-2 border-b border-edge/60 px-4 py-3 text-sm text-ghost sm:flex-row sm:items-center sm:justify-between">
            <p>
              <span className="text-ink">Possible duplicates for:</span> {discoveryFocus.title || 'Selected record'}
              {discoveryFocus.year ? ` · ${discoveryFocus.year}` : ''}
              {discoveryFocus.id ? ` · Record #${discoveryFocus.id}` : ''}
            </p>
            <button
              type="button"
              className="btn-secondary btn-sm h-8"
              onClick={() => loadDiscoveryCandidates({ searchValue: discoverySearch, mediaId: null })}
            >
              Clear focus
            </button>
          </div>
        ) : null}
        {discoveryLoading ? (
          <div className="px-4 py-6 text-sm text-ghost">Loading discovery candidates…</div>
        ) : discoveryCandidates.length > 0 ? (
          <div>
            {discoveryCandidates.map((item) => (
              <DiscoveryCandidateRow
                key={item.discovery_id}
                item={item}
                onReview={handleDiscoveryReview}
                onReject={handleDiscoveryReject}
                rejectDraft={rejectDrafts[item.discovery_id]}
                onRejectDraftChange={handleRejectDraftChange}
                loading={loading || applying}
                rejecting={rejectingDiscoveryId === item.discovery_id}
                confirmRejecting={rejectConfirmId === item.discovery_id}
              >
                {activeReviewSource === 'discovery' && activeReviewKey === buildReviewItemKey(item) ? renderActiveReviewWorkspace() : null}
              </DiscoveryCandidateRow>
            ))}
          </div>
        ) : (
          <div className="px-4 py-6 text-sm text-ghost">No discovery candidates found in the current scope.</div>
        )}
      </div>
      </section>
      </SectionTabPanel>

      <SectionTabPanel activeId={activeTab} tabKey="recommended" idBase="merge-review-sections" className="space-y-4 border-t border-edge pt-5">
      <section className="space-y-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-ink">Recommended</h2>
          <p className="text-sm text-ghost">Suggested same-type pairs from the active workspace and library scope.</p>
        </div>
        {recommendationsSummary ? (
          <div className="flex gap-3 text-xs text-ghost">
            <span>{selectedSectionLabel}</span>
            <span>{recommendationsSummary.returned_candidates || 0} shown</span>
            <span>{recommendationsSummary.high_confidence || 0} high confidence</span>
            <span>{recommendationsSummary.medium_confidence || 0} medium confidence</span>
          </div>
        ) : null}
      </div>
      <div className="rounded-lg border border-edge bg-void/10">
        <div className="flex flex-col gap-2 border-b border-edge/70 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <h3 className="text-sm font-medium text-ink">Recommended pairs</h3>
        </div>
        {recommendationsLoading ? (
          <div className="px-4 py-6 text-sm text-ghost">Loading recommendations…</div>
        ) : recommendations.length > 0 ? (
          <div>
            {recommendations.map((item) => (
              <RecommendationRow
                key={item.recommendation_id}
                item={item}
                onReview={handleRecommendationReview}
                onReject={handleRecommendationReject}
                rejectDraft={rejectDrafts[item.recommendation_id]}
                onRejectDraftChange={handleRejectDraftChange}
                loading={loading || applying}
                rejecting={rejectingRecommendationId === item.recommendation_id}
                confirmRejecting={rejectConfirmId === item.recommendation_id}
              >
                {activeReviewSource === 'recommended' && activeReviewKey === buildReviewItemKey(item) ? renderActiveReviewWorkspace() : null}
              </RecommendationRow>
            ))}
          </div>
        ) : (
          <div className="px-4 py-6 text-sm text-ghost">No recommended pairs found in the current scope yet.</div>
        )}
      </div>
      </section>
      </SectionTabPanel>

      <SectionTabPanel activeId={activeTab} tabKey="comics" idBase="merge-review-sections" className="space-y-4 border-t border-edge pt-5">
      <section className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-ink">Comics</h2>
          <p className="text-sm text-ghost">Safe issue-level comic duplicates surfaced separately so broken comic metadata clusters do not crowd the main queue.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {comicDuplicateSummary ? (
            <div className="text-xs text-ghost">
              {selectedSectionLabel} · {comicDuplicateSummary.candidate_groups || 0} candidate groups · {comicDuplicateSummary.suppressed_groups || 0} suppressed
            </div>
          ) : null}
          <input
            className="input h-9 w-full sm:w-64"
            value={comicDuplicateSearch}
            onChange={(event) => setComicDuplicateSearch(event.target.value)}
            placeholder="Search comic duplicates"
          />
        </div>
      </div>
      <div className="rounded-lg border border-edge bg-void/10">
        <div className="flex flex-col gap-3 border-b border-edge/70 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <h3 className="text-sm font-medium text-ink">Comic duplicate candidates</h3>
        </div>
        {activeComicGroupId ? (
          <div className="border-b border-edge/60 px-4 py-3 text-sm text-ghost">
            <span className="text-ink">Working through:</span> {activeComicGroupLabel || 'Comic issue cluster'}
            <span>{' · '}{activeRemainingComicPairs} remaining pairs</span>
            {comicAdvanceMessage ? <span>{' · '}{comicAdvanceMessage}</span> : null}
          </div>
        ) : null}
        {comicDuplicatesLoading ? (
          <div className="px-4 py-6 text-sm text-ghost">Loading comic duplicates…</div>
        ) : comicDuplicateCandidates.length > 0 ? (
          <div className="space-y-3 px-4 py-4">
            {comicDuplicateCandidates.map((group) => (
              <ComicDuplicateCandidateGroup
                key={group.duplicate_group_id}
                group={group}
                onReview={handleComicDuplicateReview}
                loading={loading || applying}
                activeReviewKey={activeReviewSource === 'comics' ? activeReviewKey : ''}
                renderReviewPanel={renderActiveReviewWorkspace}
              />
            ))}
            {suppressedComicGroups.length > 0 ? (
              <div className="rounded-lg border border-edge/70 bg-raised/15 px-4 py-3">
                <p className="text-sm font-medium text-ink">Suppressed comic clusters</p>
                <div className="mt-2 space-y-2">
                  {suppressedComicGroups.map((group) => (
                    <div key={`suppressed-comic-${group.duplicate_group_id}`} className="text-sm text-ghost">
                      <span className="text-ink">{group.series || 'Unknown series'} #{group.issue_number || '—'}</span>
                      {' · '}
                      {group.duplicate_count || 0} records
                      {' · '}
                      {(group.suppression_reasons || []).map(formatComicSuppressionReason).join(' / ')}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="px-4 py-6 text-sm text-ghost">No comic duplicate candidates found in the current scope.</div>
        )}
      </div>
      </section>
      </SectionTabPanel>

      <SectionTabPanel activeId={activeTab} tabKey="suppressed" idBase="merge-review-sections" className="space-y-4 border-t border-edge pt-5">
      <section className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-ink">Suppressed</h2>
          <p className="text-sm text-ghost">Review rejected and deferred pairs, understand why they were suppressed, and restore them to the queue when needed.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {suppressedHistorySummary ? (
            <div className="text-xs text-ghost">
              {selectedSectionLabel} · {suppressedHistorySummary.returned_items || 0} shown · {suppressedHistorySummary.deferred_items || 0} deferred · {suppressedHistorySummary.rejected_items || 0} rejected
            </div>
          ) : null}
          <select
            className="select h-9 w-full sm:w-44"
            value={suppressedOutcomeFilter}
            onChange={(event) => setSuppressedOutcomeFilter(event.target.value)}
          >
            {SUPPRESSED_OUTCOME_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <input
            className="input h-9 w-full sm:w-64"
            value={suppressedSearch}
            onChange={(event) => setSuppressedSearch(event.target.value)}
            placeholder="Search suppressed pairs"
          />
        </div>
      </div>
      <div className="rounded-lg border border-edge bg-void/10">
        <div className="flex flex-col gap-3 border-b border-edge/70 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <h3 className="text-sm font-medium text-ink">Suppressed pairs</h3>
        </div>
        {suppressedHistoryLoading ? (
          <div className="px-4 py-6 text-sm text-ghost">Loading suppressed pairs…</div>
        ) : suppressedHistory.length > 0 ? (
          <div>
            {suppressedHistory.map((item) => (
              <SuppressedPairRow
                key={`suppressed-pair-${item.feedback_id}`}
                item={item}
                onReview={handleSuppressedReview}
                onRestore={handleRestoreSuppressedPair}
                restoring={restoringFeedbackId === String(item.feedback_id || '')}
                loading={loading || applying}
              >
                {activeReviewSource === 'suppressed' && activeReviewKey === buildReviewItemKey(item) ? renderActiveReviewWorkspace() : null}
              </SuppressedPairRow>
            ))}
          </div>
        ) : (
          <div className="px-4 py-6 text-sm text-ghost">No suppressed pairs found in the current scope.</div>
        )}
      </div>
      </section>
      </SectionTabPanel>

      <SectionTabPanel activeId={activeTab} tabKey="collections" idBase="merge-review-sections" className="space-y-4 border-t border-edge pt-5">
      <section className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-ink">Collections</h2>
          <p className="text-sm text-ghost">Collection entities are reviewed separately from title merges so duplicate sets can be compared without mixing them into media merges.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {collectionDuplicateSummary ? (
            <div className="text-xs text-ghost">
              {selectedSectionLabel} · {collectionDuplicateSummary.returned_groups || 0} groups · {collectionDuplicateSummary.duplicate_collections || 0} collections
            </div>
          ) : null}
          <input
            className="input h-9 w-full sm:w-64"
            value={collectionDuplicateSearch}
            onChange={(event) => setCollectionDuplicateSearch(event.target.value)}
            placeholder="Search duplicate collections"
          />
        </div>
      </div>
      <div className="rounded-lg border border-edge bg-void/10">
        <div className="flex flex-col gap-3 border-b border-edge/70 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <h3 className="text-sm font-medium text-ink">Duplicate collections</h3>
        </div>
        {collectionDuplicatesLoading ? (
          <div className="px-4 py-6 text-sm text-ghost">Loading duplicate collections…</div>
        ) : collectionDuplicates.length > 0 ? (
          <div className="space-y-3 px-4 py-4">
            {collectionDuplicates.map((group) => (
              <CollectionDuplicateGroup
                key={group.duplicate_group_id}
                group={group}
                onReview={handleCollectionReview}
                loading={collectionPreviewLoading}
              />
            ))}
          </div>
        ) : (
          <div className="px-4 py-6 text-sm text-ghost">No duplicate collections found in the current scope.</div>
        )}
      </div>
      </section>

      {collectionPreview?.allowed ? (
        <div className="rounded-lg border border-edge bg-void/10">
          <div className="flex flex-col gap-2 border-b border-edge/70 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <h2 className="text-sm font-medium text-ink">Collection preview</h2>
              <p className="text-sm text-ghost">Preview a duplicate collection merge in the current scope before applying it.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-ghost">
              <span>{collectionPreview.preview?.summary || 'Collection review'}</span>
              {!collectionApplyConfirmOpen ? (
                <button
                  type="button"
                  className="btn-primary btn-sm h-8"
                  onClick={() => setCollectionApplyConfirmOpen(true)}
                  disabled={collectionApplying}
                >
                  Apply merge
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn-primary btn-sm h-8"
                    onClick={handleCollectionApply}
                    disabled={collectionApplying}
                  >
                    {collectionApplying ? 'Applying…' : 'Confirm apply'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm h-8"
                    onClick={() => setCollectionApplyConfirmOpen(false)}
                    disabled={collectionApplying}
                  >
                    Cancel
                  </button>
                </>
              )}
              <button type="button" className="btn-secondary btn-sm h-8" onClick={clearCollectionPreview}>
                Clear
              </button>
            </div>
          </div>
          <div className="space-y-4 px-4 py-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryStat label="Media type" value={formatMediaType(collectionPreview.preview?.media_type)} />
              <SummaryStat label="This collection items" value={collectionPreview.preview?.item_summary?.left_item_count ?? 0} />
              <SummaryStat label="Matched collection items" value={collectionPreview.preview?.item_summary?.right_item_count ?? 0} />
              <SummaryStat label="Merged items" value={collectionPreview.preview?.item_summary?.merged_item_count ?? '—'} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryStat label="Moved items" value={collectionPreview.preview?.item_summary?.moved_item_count ?? 0} />
              <SummaryStat label="Result name" value={collectionPreview.preview?.resulting_collection?.name || '—'} />
              <SummaryStat label="Result source title" value={collectionPreview.preview?.resulting_collection?.source_title || '—'} />
              <SummaryStat label="Result expected items" value={collectionPreview.preview?.resulting_collection?.expected_item_count ?? '—'} />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <CollectionPreviewSummary title="This collection" collection={collectionPreview.left} />
              <CollectionPreviewSummary title="Matched collection" collection={collectionPreview.right} />
            </div>

            <div className="rounded-lg border border-edge/70 bg-raised/15">
              <div className="border-b border-edge/60 px-4 py-3">
                <h3 className="text-sm font-medium text-ink">Compared fields</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-edge/60 text-left text-ghost">
                      <th className="px-4 py-3 font-medium">Compared field</th>
                      <th className="px-4 py-3 font-medium">This collection</th>
                      <th className="px-4 py-3 font-medium">Matched collection</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(collectionPreview.preview?.compared_fields || []).map((row) => (
                      <tr key={`collection-preview-field-${row.key}`} className="border-b border-edge/40 last:border-b-0">
                        <td className="px-4 py-3 text-ghost">{row.label || row.key}</td>
                        <td className="px-4 py-3 text-ink">{formatValue(row.left_value)}</td>
                        <td className="px-4 py-3 text-ink">{formatValue(row.right_value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-edge/70 bg-raised/15">
                <div className="border-b border-edge/60 px-4 py-3">
                  <h3 className="text-sm font-medium text-ink">This collection items</h3>
                </div>
                <div className="divide-y divide-edge/60">
                  {(collectionPreview.left?.items || []).length > 0 ? (
                    (collectionPreview.left.items || []).map((item) => {
                      const previewItem = formatCollectionPreviewItem(item);
                      return (
                        <div key={`collection-left-item-${item.id}`} className="px-4 py-3">
                          <p className="text-sm font-medium text-ink">{previewItem.label}</p>
                          <p className="mt-1 text-xs text-ghost">{previewItem.meta || 'Unlinked collection item'}</p>
                        </div>
                      );
                    })
                  ) : (
                    <div className="px-4 py-6 text-sm text-ghost">No collection items linked yet.</div>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-edge/70 bg-raised/15">
                <div className="border-b border-edge/60 px-4 py-3">
                  <h3 className="text-sm font-medium text-ink">Matched collection items</h3>
                </div>
                <div className="divide-y divide-edge/60">
                  {(collectionPreview.right?.items || []).length > 0 ? (
                    (collectionPreview.right.items || []).map((item) => {
                      const previewItem = formatCollectionPreviewItem(item);
                      return (
                        <div key={`collection-right-item-${item.id}`} className="px-4 py-3">
                          <p className="text-sm font-medium text-ink">{previewItem.label}</p>
                          <p className="mt-1 text-xs text-ghost">{previewItem.meta || 'Unlinked collection item'}</p>
                        </div>
                      );
                    })
                  ) : (
                    <div className="px-4 py-6 text-sm text-ghost">No collection items linked yet.</div>
                  )}
                </div>
              </div>
            </div>

          </div>
        </div>
      ) : null}

      {collectionApplyResult?.applied ? (
        <div className="rounded-lg border border-edge bg-void/10 px-4 py-4">
          <h2 className="text-sm font-medium text-ink">Collection merge applied</h2>
          <p className="mt-2 text-sm text-ghost">
            Collection #{collectionApplyResult.canonical?.id || '—'} absorbed collection #{collectionApplyResult.duplicate?.id || '—'}.
          </p>
        </div>
      ) : null}

      {collectionRevertResult?.reverted ? (
        <div className="rounded-lg border border-edge bg-void/10 px-4 py-4">
          <h2 className="text-sm font-medium text-ink">Collection merge reverted</h2>
          <p className="mt-2 text-sm text-ghost">
            Collection #{collectionRevertResult.duplicate?.id || '—'} was restored from collection #{collectionRevertResult.canonical?.id || '—'}.
          </p>
        </div>
      ) : null}

      {collectionMergeDetails?.entries?.length > 0 ? (
        <div className="rounded-lg border border-edge bg-void/10">
          <div className="border-b border-edge/70 px-4 py-3">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-sm font-medium text-ink">Active collection merge events</h2>
              <p className="text-xs text-ghost">
                {collectionMergeDetails.summary?.active_merge_count || 0} active · {collectionMergeDetails.summary?.supporting_collections || 1} supporting collections
              </p>
            </div>
          </div>
          <div>
            {(collectionMergeDetails.entries || []).map((entry) => (
              <CollectionMergeEventRow
                key={`collection-merge-event-${entry.history_id || entry.duplicate_id}`}
                entry={entry}
                onRevert={handleCollectionRevert}
                reverting={revertingCollectionDuplicateId === String(entry.duplicate_id || '')}
              />
            ))}
          </div>
        </div>
      ) : null}
      </SectionTabPanel>

    </div>
  );
}
