import React, { useMemo, useState } from 'react';

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

export default function AdminMergeReviewView({
  apiCall,
  onToast,
  Spinner,
  activeSpace,
  activeLibrary
}) {
  const [canonicalId, setCanonicalId] = useState('');
  const [duplicateId, setDuplicateId] = useState('');
  const [preview, setPreview] = useState(null);
  const [errorState, setErrorState] = useState(null);
  const [loading, setLoading] = useState(false);

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
    setErrorState(null);
  };

  const swapDraft = () => {
    setCanonicalId(duplicateId);
    setDuplicateId(canonicalId);
    setPreview(null);
    setErrorState(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setPreview(null);
    setErrorState(null);
    try {
      const payload = await apiCall('post', '/media/merge-preview', {
        canonical_id: Number(canonicalId),
        duplicate_id: Number(duplicateId)
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

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 space-y-6">
      <div className="space-y-3">
        <h1 className="section-title">Merge Review</h1>
        <p className="max-w-3xl text-sm text-ghost">
          Preview a same-type pairwise merge inside the current workspace and library scope. Preview only. No data changes happen here.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryStat label="Workspace" value={activeSpace?.name || 'Current workspace'} />
        <SummaryStat label="Library" value={activeLibrary?.name || 'Current library'} />
        <SummaryStat label="Merge boundary" value="Same type only" />
        <SummaryStat label="Action mode" value="Preview only" />
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
    </div>
  );
}
