import React, { useEffect, useMemo, useState } from 'react';

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

function formatSearchMeta(record = {}) {
  const bits = [];
  if (record?.media_type) bits.push(formatMediaType(record.media_type));
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

function RecommendationRow({ item, onReview, onReject, loading, rejecting, confirmRejecting }) {
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
              Collection review only for now
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

export default function AdminMergeReviewView({
  apiCall,
  onToast,
  Spinner,
  activeSpace,
  activeLibrary
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
  const [collectionDuplicateSearch, setCollectionDuplicateSearch] = useState('');
  const [collectionDuplicates, setCollectionDuplicates] = useState([]);
  const [collectionDuplicateSummary, setCollectionDuplicateSummary] = useState(null);
  const [collectionDuplicatesLoading, setCollectionDuplicatesLoading] = useState(true);
  const [collectionPreview, setCollectionPreview] = useState(null);
  const [collectionPreviewLoading, setCollectionPreviewLoading] = useState(false);
  const [rejectingRecommendationId, setRejectingRecommendationId] = useState('');
  const [rejectConfirmId, setRejectConfirmId] = useState('');
  const [preview, setPreview] = useState(null);
  const [applyResult, setApplyResult] = useState(null);
  const [applyConfirmOpen, setApplyConfirmOpen] = useState(false);
  const [errorState, setErrorState] = useState(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  const comparedRows = Array.isArray(preview?.preview?.field_comparison) ? preview.preview.field_comparison : [];
  const rewiringRows = useMemo(
    () => buildImpactRows(preview?.preview?.dependent_rewiring || {}),
    [preview]
  );
  const historyRows = useMemo(
    () => buildHistoryRows(preview?.preview?.history_context || {}),
    [preview]
  );

  const clearPreview = () => {
    setPreview(null);
    setApplyResult(null);
    setApplyConfirmOpen(false);
    setErrorState(null);
  };

  const clearCollectionPreview = () => {
    setCollectionPreview(null);
  };

  const loadRecommendations = async () => {
    setRecommendationsLoading(true);
    try {
      const payload = await apiCall('get', '/media/merge-recommendations?limit=12');
      setRecommendations(Array.isArray(payload?.items) ? payload.items : []);
      setRecommendationsSummary(payload?.summary || null);
    } catch (_) {
      setRecommendations([]);
      setRecommendationsSummary(null);
    } finally {
      setRecommendationsLoading(false);
    }
  };

  const loadCollectionDuplicates = async (searchValue = collectionDuplicateSearch) => {
    setCollectionDuplicatesLoading(true);
    try {
      const query = new URLSearchParams({ limit: '12' });
      if (String(searchValue || '').trim()) query.set('search', String(searchValue).trim());
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

  useEffect(() => {
    loadRecommendations();
    loadCollectionDuplicates('');
  }, [apiCall, activeLibrary?.id, activeSpace?.id]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const query = new URLSearchParams({ limit: '12' });
        if (collectionDuplicateSearch.trim()) query.set('search', collectionDuplicateSearch.trim());
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
  }, [apiCall, collectionDuplicateSearch]);

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
    setPreview(null);
    setErrorState(null);
  };

  const pickCanonicalRecord = (record) => {
    setCanonicalId(String(record?.id || ''));
    setCanonicalSearch(record?.title || '');
    setPreview(null);
    setErrorState(null);
  };

  const pickDuplicateRecord = (record) => {
    setDuplicateId(String(record?.id || ''));
    setDuplicateSearch(record?.title || '');
    setPreview(null);
    setErrorState(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    await requestPreview(Number(canonicalId), Number(duplicateId));
  };

  const requestPreview = async (nextCanonicalId, nextDuplicateId) => {
    setLoading(true);
    setPreview(null);
    setApplyResult(null);
    setApplyConfirmOpen(false);
    setErrorState(null);
    try {
      const payload = await apiCall('post', '/media/merge-preview', {
        canonical_id: Number(nextCanonicalId),
        duplicate_id: Number(nextDuplicateId)
      });
      setPreview(payload);
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
    setRejectConfirmId('');
    setCanonicalId(String(item?.canonical?.id || ''));
    setDuplicateId(String(item?.duplicate?.id || ''));
    setCanonicalSearch(item?.canonical?.title || '');
    setDuplicateSearch(item?.duplicate?.title || '');
    await requestPreview(Number(item?.canonical?.id || 0), Number(item?.duplicate?.id || 0));
  };

  const handleRecommendationReject = async (item, confirmed) => {
    const recommendationId = String(item?.recommendation_id || '');
    if (!recommendationId) return;
    if (confirmed === null) {
      setRejectConfirmId('');
      return;
    }
    if (!confirmed) {
      setRejectConfirmId(recommendationId);
      return;
    }
    setRejectingRecommendationId(recommendationId);
    setErrorState(null);
    try {
      const payload = await apiCall('post', '/media/merge-recommendations/reject', {
        canonical_id: Number(item?.canonical?.id || 0),
        duplicate_id: Number(item?.duplicate?.id || 0)
      });
      setRecommendations(Array.isArray(payload?.recommendations?.items) ? payload.recommendations.items : []);
      setRecommendationsSummary(payload?.recommendations?.summary || null);
      setRejectConfirmId('');
      onToast('Recommendation removed from the queue', 'success');
    } catch (error) {
      const response = error?.response?.data || null;
      onToast(response?.error || 'Failed to reject recommendation', 'error');
    } finally {
      setRejectingRecommendationId('');
    }
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
      setPreview(null);
      setApplyConfirmOpen(false);
      setDuplicateId('');
      setDuplicateSearch('');
      await loadRecommendations();
      onToast('Manual merge applied', 'success');
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

  const handleCollectionReview = async (group) => {
    const left = group?.collections?.[0];
    const right = group?.collections?.[1];
    if (!left?.id || !right?.id) {
      onToast('Pick a duplicate collection group with at least two collections', 'error');
      return;
    }
    setCollectionPreviewLoading(true);
    setCollectionPreview(null);
    try {
      const query = new URLSearchParams({
        left_id: String(left.id),
        right_id: String(right.id)
      });
      const payload = await apiCall('get', `/media/collections/duplicate-preview?${query.toString()}`);
      setCollectionPreview(payload);
    } catch (error) {
      const response = error?.response?.data || null;
      onToast(response?.error || 'Failed to load collection preview', 'error');
    } finally {
      setCollectionPreviewLoading(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 space-y-6">
      <div className="space-y-3">
        <h1 className="section-title">Merge Review</h1>
        <p className="max-w-3xl text-sm text-ghost">
          Review a same-type pairwise merge inside the current workspace and library scope, then apply it deliberately when the comparison looks right.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryStat label="Workspace" value={activeSpace?.name || 'Current workspace'} />
        <SummaryStat label="Library" value={activeLibrary?.name || 'Current library'} />
        <SummaryStat label="Merge boundary" value="Same type only" />
        <SummaryStat label="Action mode" value="Preview first" />
      </div>

      <div className="rounded-lg border border-edge bg-void/10">
        <div className="flex flex-col gap-2 border-b border-edge/70 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <h2 className="text-sm font-medium text-ink">Recommended pairs</h2>
            <p className="text-sm text-ghost">Suggested same-type pairs from the active workspace and library scope.</p>
          </div>
          {recommendationsSummary ? (
            <div className="flex gap-3 text-xs text-ghost">
              <span>{recommendationsSummary.returned_candidates || 0} shown</span>
              <span>{recommendationsSummary.high_confidence || 0} high confidence</span>
              <span>{recommendationsSummary.medium_confidence || 0} medium confidence</span>
            </div>
          ) : null}
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
                loading={loading || applying}
                rejecting={rejectingRecommendationId === item.recommendation_id}
                confirmRejecting={rejectConfirmId === item.recommendation_id}
              />
            ))}
          </div>
        ) : (
          <div className="px-4 py-6 text-sm text-ghost">No recommended pairs found in the current scope yet.</div>
        )}
      </div>

      <div className="rounded-lg border border-edge bg-void/10">
        <div className="flex flex-col gap-3 border-b border-edge/70 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <h2 className="text-sm font-medium text-ink">Duplicate collections</h2>
            <p className="text-sm text-ghost">Collection entities are reviewed separately from title merges. This helps surface duplicate sets like multi-movie collections.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {collectionDuplicateSummary ? (
              <div className="text-xs text-ghost">
                {collectionDuplicateSummary.returned_groups || 0} groups · {collectionDuplicateSummary.duplicate_collections || 0} collections
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

      {collectionPreview?.allowed ? (
        <div className="rounded-lg border border-edge bg-void/10">
          <div className="flex flex-col gap-2 border-b border-edge/70 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <h2 className="text-sm font-medium text-ink">Collection preview</h2>
              <p className="text-sm text-ghost">Read-only compare for duplicate collections in the current scope.</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-ghost">
              <span>{collectionPreview.preview?.summary || 'Collection review'}</span>
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
              <SummaryStat label="Expected items" value={collectionPreview.left?.expected_item_count ?? collectionPreview.right?.expected_item_count ?? '—'} />
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
            {(preview || errorState) ? (
              <button type="button" className="btn-secondary h-10" onClick={clearPreview} disabled={loading}>
                Clear
              </button>
            ) : null}
          </div>
        </div>
      </form>

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

          <div className="rounded-lg border border-edge bg-void/10 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-1">
                <h2 className="text-sm font-medium text-ink">Apply merge</h2>
                <p className="text-sm text-ghost">
                  This will absorb the matched record into this record and preserve repair history so the merge can be reverted later through the operator workflow.
                </p>
              </div>
              {!applyConfirmOpen ? (
                <button type="button" className="btn-primary h-10" onClick={() => setApplyConfirmOpen(true)} disabled={applying}>
                  Apply merge
                </button>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-primary h-10" onClick={handleApply} disabled={applying}>
                    {applying ? <><Spinner size={14} />Applying…</> : 'Confirm apply'}
                  </button>
                  <button type="button" className="btn-secondary h-10" onClick={() => setApplyConfirmOpen(false)} disabled={applying}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-edge bg-void/10">
            <div className="border-b border-edge/70 px-4 py-3">
              <h2 className="text-sm font-medium text-ink">Compared fields</h2>
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
            <div className="rounded-lg border border-edge bg-void/10 p-4">
              <h2 className="text-sm font-medium text-ink">Dependent rewiring</h2>
              <div className="mt-3 space-y-2 text-sm">
                {rewiringRows.map((row) => (
                  <div key={row.label} className="flex items-start justify-between gap-4">
                    <span className="text-ghost">{row.label}</span>
                    <span className="text-ink">{formatValue(row.value)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-edge bg-void/10 p-4">
              <h2 className="text-sm font-medium text-ink">Merge history</h2>
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

      {applyResult?.applied ? (
        <div className="space-y-4 rounded-lg border border-edge bg-void/10 p-4">
          <div className="space-y-1">
            <h2 className="text-sm font-medium text-ink">Merge applied</h2>
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
    </div>
  );
}
