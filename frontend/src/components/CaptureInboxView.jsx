import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CollectionPaginationFooter,
  FixedPageShell,
  SectionTabs,
  UtilityPageHeader,
  cx,
  detectBarcodeCapturePayloadFromFile,
  extractIdentifierCandidatesFromFile,
  inferBookBarcodeIdentifier,
  posterUrl,
  supportsBarcodeCapture
} from './app/AppPrimitives';

const STATUS_TABS = [
  { id: 'active', label: 'Active' },
  { id: 'new', label: 'New' },
  { id: 'reviewed', label: 'Reviewed' },
  { id: 'converted', label: 'Converted' },
  { id: 'discarded', label: 'Discarded' },
  { id: 'all', label: 'All' }
];

const REVIEW_TABS = [
  { id: 'all', label: 'All' },
  { id: 'needs_choice', label: 'Needs choice' },
  { id: 'ready', label: 'Ready to add' },
  { id: 'no_match', label: 'No match' },
  { id: 'missing_details', label: 'Missing details' },
  { id: 'problems', label: 'Problems' }
];

const CAPTURE_TYPES = [
  { value: 'manual_note', label: 'Note' },
  { value: 'barcode', label: 'Barcode' },
  { value: 'photo', label: 'Photo' },
  { value: 'ocr_text', label: 'OCR text' }
];

const SOURCE_FILTERS = [
  { value: 'all', label: 'All sources' },
  { value: 'scanner', label: 'Scanner app' },
  { value: 'web', label: 'Web capture' }
];

const OBJECT_TYPES = [
  { value: 'other', label: 'Other' },
  { value: 'book', label: 'Book' },
  { value: 'comic_book', label: 'Comic' },
  { value: 'movie', label: 'Movie' },
  { value: 'tv_series', label: 'TV' },
  { value: 'audio', label: 'Audio' },
  { value: 'game', label: 'Game' },
  { value: 'art', label: 'Art' },
  { value: 'collectible', label: 'Collectible' },
  { value: 'event_item', label: 'Event item' }
];

const EMPTY_FORM = {
  title: '',
  capture_type: 'manual_note',
  object_type: 'other',
  barcode: '',
  symbology: '',
  image_path: '',
  image_file: null,
  ocr_text: '',
  notes: ''
};

const EMPTY_FORM_LOOKUP = {
  loading: false,
  matches: [],
  lookup: null,
  error: null,
  barcode: '',
  lookedUp: false
};

function typeLabel(value, options) {
  return options.find((option) => option.value === value)?.label || value || 'Item';
}

function dateLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function titleCase(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayConflictValue(value) {
  const text = String(value ?? '').trim();
  return text || 'Empty';
}

function latestReplayConflict(item = {}) {
  const conflicts = Array.isArray(item.review_decision?.capture_replay_conflicts)
    ? item.review_decision.capture_replay_conflicts
    : [];
  for (let index = conflicts.length - 1; index >= 0; index -= 1) {
    const conflict = conflicts[index];
    if (conflict?.status === 'needs_review' && Array.isArray(conflict.fields) && conflict.fields.length) {
      return conflict;
    }
  }
  return null;
}

function isScannerCapture(item = {}) {
  const source = String(item.source_context?.source || '').toLowerCase();
  const clientSource = String(item.client_source || item.source_context?.client_source || '').toLowerCase();
  return source.includes('scanner') || clientSource.includes('scanner');
}

function emptyReviewMessage(filter) {
  if (filter === 'needs_choice') return 'No captures need a choice in this view.';
  if (filter === 'ready') return 'No captures are ready to add in this view.';
  if (filter === 'no_match') return 'No captures without matches in this view.';
  if (filter === 'missing_details') return 'No captures are missing details in this view.';
  if (filter === 'problems') return 'No capture problems in this view.';
  return 'No captures match this view.';
}

function normalizedIdentifierDigits(value) {
  return String(value || '').replace(/\D+/g, '');
}

function looksLikeIsbn(value) {
  const digits = normalizedIdentifierDigits(value);
  return digits.length === 10 || (digits.length === 13 && /^(978|979)/.test(digits));
}

function isSafeExactIsbnMatch(match, barcode) {
  const mediaType = String(match?.media_type || match?.mediaTypeGuess || '').toLowerCase();
  if (mediaType !== 'book') return false;
  if (!match?.title) return false;

  const lookupDigits = normalizedIdentifierDigits(barcode);
  const matchIdentifiers = [
    match?.barcode,
    match?.upc,
    match?.typeDetails?.isbn,
    match?.type_details?.isbn,
    match?.book?.type_details?.isbn
  ].map(normalizedIdentifierDigits).filter(Boolean);
  const hasExactIdentifier = lookupDigits && matchIdentifiers.some((identifier) => identifier === lookupDigits);
  if (!hasExactIdentifier || !looksLikeIsbn(lookupDigits)) return false;

  const source = String(match?.source || '').toLowerCase();
  const matchType = String(match?.match_type || '').toLowerCase();
  return source === 'books:isbn-direct' || source === 'catalog' || matchType === 'existing_media';
}

function findSafeExactIsbnMatch(matches = [], barcode = '') {
  const candidates = (Array.isArray(matches) ? matches : []).filter((match) => isSafeExactIsbnMatch(match, barcode));
  return candidates.length === 1 && matches.length === 1 ? candidates[0] : null;
}

function CaptureFilterMenu({
  Icons,
  open,
  onToggle,
  menuRef,
  summary,
  captureType,
  setCaptureType,
  sourceFilter,
  setSourceFilter,
  reviewTabs,
  reviewFilter,
  setReviewFilter
}) {
  const FilterIcon = Icons?.Filter || Icons?.List;

  return (
    <div className="relative shrink-0" ref={menuRef}>
      <button
        type="button"
        className="btn-icon h-9 w-9"
        aria-label={`Filter captures: ${summary || 'All filters'}`}
        aria-expanded={open}
        title="Filter"
        onClick={onToggle}
      >
        {FilterIcon ? <FilterIcon /> : null}
      </button>
      {open ? (
        <div
          className="absolute right-0 z-30 mt-2 w-[min(20rem,calc(100vw-2rem))] space-y-3 rounded-lg border border-edge bg-deep p-3 shadow-deep"
          role="group"
          aria-label="Capture filters"
        >
          <label className="block">
            <span className="mb-1 block text-xs text-ghost">Capture</span>
            <select className="select h-9 w-full" value={captureType} onChange={(event) => setCaptureType(event.target.value)} aria-label="Capture type">
              <option value="all">All captures</option>
              {CAPTURE_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ghost">Source</span>
            <select className="select h-9 w-full" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} aria-label="Capture source">
              {SOURCE_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <div>
            <div className="mb-1 text-xs text-ghost">Review</div>
            <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Capture review filter">
              {reviewTabs.map((tab) => {
                const selected = tab.id === reviewFilter;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={cx(
                      'flex min-h-8 items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors',
                      selected
                        ? 'border-gold/70 bg-raised text-ink'
                        : 'border-edge bg-surface/60 text-dim hover:border-muted hover:text-ink'
                    )}
                    onClick={() => setReviewFilter(tab.id)}
                  >
                    <span className="min-w-0 truncate">{tab.label}</span>
                    <span className={cx('h-2 w-2 shrink-0 rounded-full border', selected ? 'border-gold bg-gold' : 'border-muted')} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, className = '', children, asLabel = true }) {
  const Component = asLabel ? 'label' : 'div';
  return (
    <Component className={cx('space-y-1', className)}>
      <span className="text-xs font-medium text-ghost">{label}</span>
      {children}
    </Component>
  );
}

function CaptureEditor({
  form,
  setForm,
  saving,
  formLookup,
  formImporting,
  batchMode,
  batchStats,
  scanRequest,
  onSave,
  onCancel,
  onToast,
  onLookupBarcode,
  onClearLookup,
  onImportMatch,
  onSaveAndScanNext,
  onStopBatch,
  Icons,
  editorRef
}) {
  const barcodeCameraInputRef = useRef(null);
  const [barcodeScanning, setBarcodeScanning] = useState(false);
  const barcodeCameraSupported = supportsBarcodeCapture();
  const lookupMatches = Array.isArray(formLookup?.matches) ? formLookup.matches : [];
  const safeExactIsbnMatch = findSafeExactIsbnMatch(lookupMatches, formLookup?.barcode || form.barcode);

  useEffect(() => {
    if (!scanRequest) return;
    window.setTimeout(() => barcodeCameraInputRef.current?.click(), 0);
  }, [scanRequest]);

  const readIsbnFromBarcodeImage = async (file, detected) => {
    const directIsbn = inferBookBarcodeIdentifier(detected?.code || '');
    try {
      const extracted = await extractIdentifierCandidatesFromFile(file, {
        boundingBox: detected?.boundingBox || null
      });
      const candidates = [
        ...(extracted?.strictIsbnCandidates || []),
        ...(extracted?.labeledIsbnCandidates || []),
        ...(extracted?.isbnCandidates || [])
      ].filter(Boolean);
      return {
        isbn: candidates[0] || directIsbn || '',
        rawText: extracted?.rawText || ''
      };
    } catch (_) {
      return {
        isbn: directIsbn || '',
        rawText: ''
      };
    }
  };

  const handleBarcodeCameraFile = async (event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = '';
    if (!file) return;

    setBarcodeScanning(true);
    try {
      const detected = await detectBarcodeCapturePayloadFromFile(file);
      if (!detected?.code) {
        onToast?.('No barcode found in that image.', 'error');
        return;
      }
      const bookIdentifiers = await readIsbnFromBarcodeImage(file, detected);
      const capturedCode = bookIdentifiers.isbn || detected.code;
      const capturedSymbology = bookIdentifiers.isbn ? 'ISBN-13' : (detected.symbology || detected.format || form.symbology || '');
      const capturedObjectType = bookIdentifiers.isbn ? 'book' : form.object_type;
      setForm((current) => ({
        ...current,
        capture_type: 'barcode',
        object_type: capturedObjectType,
        barcode: capturedCode,
        symbology: capturedSymbology,
        title: current.title || file.name || '',
        ocr_text: current.ocr_text || bookIdentifiers.rawText || ''
      }));
      onToast?.(
        bookIdentifiers.isbn
          ? `ISBN captured: ${bookIdentifiers.isbn}`
          : `Barcode captured: ${detected.code}`,
        'success'
      );
      await onLookupBarcode?.({
        barcode: capturedCode,
        symbology: capturedSymbology,
        mediaType: capturedObjectType
      });
    } catch (_) {
      onToast?.('No barcode found. Try a closer photo with the code filling more of the frame.', 'error');
    } finally {
      setBarcodeScanning(false);
    }
  };

  return (
    <form
      ref={editorRef}
      className="border-b border-edge/70 pb-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSave?.();
      }}
    >
      {batchMode ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-edge/70 pb-3" aria-label="Batch scan session">
          <div className="text-sm text-ink">
            Batch scan
            <span className="ml-2 text-xs text-ghost">
              {batchStats.imported} added · {batchStats.linked} linked · {batchStats.review} for review
              {batchStats.errors ? ` · ${batchStats.errors} failed` : ''}
            </span>
          </div>
          <button type="button" className="btn-ghost btn-sm" onClick={onStopBatch}>Stop batch</button>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
        <Field label="Capture" className="md:col-span-2">
          <select
            className="select w-full"
            value={form.capture_type}
            onChange={(event) => setForm((current) => ({ ...current, capture_type: event.target.value }))}
          >
            {CAPTURE_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <Field label="Type" className="md:col-span-2">
          <select
            className="select w-full"
            value={form.object_type}
            onChange={(event) => setForm((current) => ({ ...current, object_type: event.target.value }))}
          >
            {OBJECT_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <Field label="Title" className="md:col-span-5">
          <input
            className="input w-full"
            value={form.title}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
          />
        </Field>
        <Field label="Barcode / ISBN" className="md:col-span-3" asLabel={false}>
          <div className="flex gap-2">
            <input
              className="input min-w-0 flex-1"
              value={form.barcode}
              inputMode="numeric"
              aria-label="Barcode / ISBN"
              onChange={(event) => {
                const nextBarcode = event.target.value;
                setForm((current) => ({ ...current, barcode: nextBarcode }));
                if (formLookup?.barcode && nextBarcode.trim() !== formLookup.barcode) onClearLookup?.();
              }}
            />
            <input
              ref={barcodeCameraInputRef}
              className="hidden"
              type="file"
              accept="image/*"
              capture="environment"
              aria-label="Barcode camera image"
              onChange={handleBarcodeCameraFile}
            />
            <button
              type="button"
              className="btn-ghost h-10 shrink-0 px-3"
              disabled={barcodeScanning || !barcodeCameraSupported}
              onClick={() => barcodeCameraInputRef.current?.click()}
              aria-label="Scan barcode with camera"
              title={barcodeCameraSupported ? 'Scan barcode with camera' : 'Camera barcode capture is not supported in this browser'}
            >
              {Icons?.Barcode ? <Icons.Barcode /> : null}
              <span className="hidden sm:inline">{barcodeScanning ? 'Scanning...' : 'Scan'}</span>
            </button>
          </div>
        </Field>
        <Field label="Symbology" className="md:col-span-2">
          <input
            className="input w-full"
            value={form.symbology}
            onChange={(event) => setForm((current) => ({ ...current, symbology: event.target.value }))}
            placeholder="EAN-13"
          />
        </Field>
        <Field label="Image path" className="md:col-span-4">
          <input
            className="input w-full"
            value={form.image_path}
            onChange={(event) => setForm((current) => ({ ...current, image_path: event.target.value }))}
          />
        </Field>
        <Field label="Photo upload" className="md:col-span-6">
          <input
            className="block w-full text-sm text-ghost file:mr-3 file:rounded-md file:border file:border-edge file:bg-raised file:px-3 file:py-2 file:text-sm file:font-medium file:text-ink hover:file:bg-surface"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(event) => {
              const file = event.target.files?.[0] || null;
              setForm((current) => ({
                ...current,
                image_file: file,
                capture_type: file ? 'photo' : current.capture_type,
                title: current.title || file?.name || ''
              }));
            }}
          />
          {form.image_file ? <span className="mt-1 block text-xs text-dim">{form.image_file.name}</span> : null}
        </Field>
        <Field label="OCR text" className="md:col-span-6">
          <textarea
            className="textarea min-h-[72px] w-full"
            value={form.ocr_text}
            onChange={(event) => setForm((current) => ({ ...current, ocr_text: event.target.value }))}
          />
        </Field>
        <Field label="Notes" className="md:col-span-12">
          <textarea
            className="textarea min-h-[64px] w-full"
            value={form.notes}
            onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
          />
        </Field>
      </div>
      {formLookup?.loading || formLookup?.lookedUp || formLookup?.error ? (
        <div className="mt-4 border-t border-edge/70 pt-3" aria-label="Scan lookup results">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-medium text-ink">Scan results</div>
              <div className="mt-0.5 text-xs text-ghost">
                {formLookup?.loading
                  ? 'Looking up matches...'
                  : lookupMatches.length
                    ? `${lookupMatches.length} candidate${lookupMatches.length === 1 ? '' : 's'} for ${formLookup.barcode || form.barcode}`
                    : formLookup?.error
                      ? formLookup.error
                      : `No matches found for ${formLookup.barcode || form.barcode}`}
              </div>
            </div>
            {batchMode || formLookup?.lookedUp ? (
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={saving || formImporting || !form.barcode}
                onClick={onSaveAndScanNext}
              >
                Save and scan next
              </button>
            ) : null}
          </div>
          {lookupMatches.length ? (
            <div className="mt-3 divide-y divide-edge/70 border-y border-edge/70">
              {lookupMatches.slice(0, 6).map((match) => (
                <div key={match.id || `${match.source}-${match.title}`} className="grid gap-2 py-2 text-sm md:grid-cols-[1fr_auto] md:items-center">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-ink">{match.title || 'Untitled match'}</div>
                    <div className="mt-0.5 truncate text-xs text-ghost">
                      {[
                        match.already_imported ? 'In library' : titleCase(match.source || 'provider'),
                        typeLabel(match.media_type || match.mediaTypeGuess, OBJECT_TYPES),
                        match.year
                      ].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={cx('btn-sm', safeExactIsbnMatch?.id === match.id ? 'btn-secondary' : 'btn-ghost')}
                    disabled={saving || formImporting}
                    onClick={() => onImportMatch?.(match)}
                  >
                    {safeExactIsbnMatch?.id === match.id
                      ? match.already_imported ? 'Link exact ISBN' : 'Add exact ISBN'
                      : match.already_imported ? 'Link' : 'Add to library'}
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {safeExactIsbnMatch && !batchMode ? (
            <div className="mt-2 text-xs text-ghost">
              Exact ISBN match. Add it now, or save this capture for review.
            </div>
          ) : null}
          {formLookup?.lookup?.provider_error && lookupMatches.length ? (
            <div className="mt-2 text-xs text-warn">Provider warning: {formLookup.lookup.provider_error}</div>
          ) : null}
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Saving...' : formLookup?.lookedUp ? 'Save for review' : 'Save capture'}
        </button>
        {form.barcode ? (
          <button
            type="button"
            className="btn-ghost"
            disabled={saving || formLookup?.loading}
            onClick={() => onLookupBarcode?.({
              barcode: form.barcode,
              symbology: form.symbology,
              mediaType: form.object_type
            })}
          >
            {formLookup?.loading ? 'Finding...' : 'Find matches'}
          </button>
        ) : null}
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export default function CaptureInboxView({ apiCall, onToast, Icons, Spinner }) {
  const editorRef = useRef(null);
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, total_pages: 1 });
  const [status, setStatus] = useState('active');
  const [reviewFilter, setReviewFilter] = useState('all');
  const [reviewCounts, setReviewCounts] = useState({
    all: 0,
    needs_choice: 0,
    ready: 0,
    no_match: 0,
    missing_details: 0,
    problems: 0
  });
  const [sourceCounts, setSourceCounts] = useState({ scanner: 0, web: 0 });
  const [captureType, setCaptureType] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formLookup, setFormLookup] = useState(EMPTY_FORM_LOOKUP);
  const [error, setError] = useState(null);
  const [workingCaptureId, setWorkingCaptureId] = useState(null);
  const [formImporting, setFormImporting] = useState(false);
  const [scanRequest, setScanRequest] = useState(0);
  const [batchMode, setBatchMode] = useState(false);
  const [batchStats, setBatchStats] = useState({
    saved: 0,
    imported: 0,
    linked: 0,
    review: 0,
    needs_choice: 0,
    no_match: 0,
    errors: 0
  });
  const [batchEvents, setBatchEvents] = useState([]);
  const [lastBatchSummary, setLastBatchSummary] = useState(null);

  const loadCaptures = useCallback(async (page = 1) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('status', status);
      params.set('page', String(page));
      params.set('limit', '50');
      if (reviewFilter !== 'all') params.set('review_filter', reviewFilter);
      if (captureType !== 'all') params.set('capture_type', captureType);
      if (sourceFilter !== 'all') params.set('source_filter', sourceFilter);
      if (search.trim()) params.set('search', search.trim());
      const payload = await apiCall('get', `/capture-items?${params.toString()}`);
      setItems(Array.isArray(payload?.items) ? payload.items : []);
      setReviewCounts({
        all: Number(payload?.review_counts?.all || 0),
        needs_choice: Number(payload?.review_counts?.needs_choice || 0),
        ready: Number(payload?.review_counts?.ready || 0),
        no_match: Number(payload?.review_counts?.no_match || 0),
        missing_details: Number(payload?.review_counts?.missing_details || 0),
        problems: Number(payload?.review_counts?.problems || 0)
      });
      setPagination(payload?.pagination || { page, limit: 50, total: 0, total_pages: 1 });
      setSourceCounts({
        scanner: Number(payload?.source_counts?.scanner || 0),
        web: Number(payload?.source_counts?.web || 0)
      });
    } catch (err) {
      setError(err?.message || 'Could not load capture inbox.');
    } finally {
      setLoading(false);
    }
  }, [apiCall, captureType, reviewFilter, search, sourceFilter, status]);

  useEffect(() => {
    loadCaptures(1);
  }, [loadCaptures]);

  const visibleCounts = useMemo(() => {
    const counts = { active: 0, conflicts: 0, scanner: 0, barcode: 0, photo: 0 };
    items.forEach((item) => {
      if (item.status === 'new' || item.status === 'reviewed') counts.active += 1;
      if (latestReplayConflict(item)) counts.conflicts += 1;
      if (isScannerCapture(item)) counts.scanner += 1;
      if (item.capture_type === 'barcode') counts.barcode += 1;
      if (item.capture_type === 'photo') counts.photo += 1;
    });
    return counts;
  }, [items]);

  const showScannerShortcut = sourceFilter !== 'scanner' && sourceCounts.scanner > 0;
  const showAllSourcesShortcut = sourceFilter !== 'all';

  const reviewTabs = useMemo(() => REVIEW_TABS.map((tab) => ({
    ...tab,
    label: `${tab.label} ${reviewCounts[tab.id] || 0}`
  })), [reviewCounts]);

  const reviewDecisionFromFormLookup = (lookupSnapshot = formLookup, formSnapshot = form) => {
    if (!lookupSnapshot.lookedUp && !lookupSnapshot.error && !lookupSnapshot.matches.length) return {};
    return {
      capture_lookup_matches: lookupSnapshot.matches,
      capture_lookup_status: {
        ...(lookupSnapshot.lookup || {}),
        barcode: lookupSnapshot.barcode || formSnapshot.barcode || null,
        match_count: lookupSnapshot.matches.length,
        provider_error: lookupSnapshot.error || lookupSnapshot.lookup?.provider_error || null,
        looked_up_at: lookupSnapshot.lookup?.looked_up_at || new Date().toISOString(),
        source: 'web_capture_editor'
      }
    };
  };

  const payloadFromForm = (formSnapshot = form, lookupSnapshot = formLookup) => {
    const reviewDecision = reviewDecisionFromFormLookup(lookupSnapshot, formSnapshot);
    return {
      title: formSnapshot.title || null,
      capture_type: formSnapshot.capture_type,
      object_type: formSnapshot.object_type,
      barcode: formSnapshot.barcode || null,
      symbology: formSnapshot.symbology || null,
      image_path: formSnapshot.image_path || null,
      ocr_text: formSnapshot.ocr_text || null,
      notes: formSnapshot.notes || null,
      source_context: { source: 'web_capture_inbox' },
      ...(Object.keys(reviewDecision).length ? { review_decision: reviewDecision } : {})
    };
  };

  const uploadPayloadFromForm = () => {
    const body = new FormData();
    body.append('image', form.image_file);
    if (form.title) body.append('title', form.title);
    if (form.object_type) body.append('object_type', form.object_type);
    if (form.barcode) body.append('barcode', form.barcode);
    if (form.symbology) body.append('symbology', form.symbology);
    if (form.ocr_text) body.append('ocr_text', form.ocr_text);
    if (form.notes) body.append('notes', form.notes);
    const reviewDecision = reviewDecisionFromFormLookup();
    if (Object.keys(reviewDecision).length) body.append('review_decision', JSON.stringify(reviewDecision));
    body.append('source_context', JSON.stringify({ source: 'web_capture_inbox' }));
    return body;
  };

  const persistCapture = async (formSnapshot = form, lookupSnapshot = formLookup) => {
    if (form.image_file) {
      const response = await apiCall('post', '/capture-items/upload-image', uploadPayloadFromForm(), {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      return response?.item || null;
    }
    const response = await apiCall('post', '/capture-items', payloadFromForm(formSnapshot, lookupSnapshot));
    return response?.item || null;
  };

  const resetEditorForm = () => {
    setForm(EMPTY_FORM);
    setFormLookup(EMPTY_FORM_LOOKUP);
  };

  const requestNextScan = () => {
    setEditorOpen(true);
    setScanRequest((current) => current + 1);
  };

  const emptyBatchStats = () => ({
    saved: 0,
    imported: 0,
    linked: 0,
    review: 0,
    needs_choice: 0,
    no_match: 0,
    errors: 0
  });

  const recordBatchEvent = (event = {}) => {
    if (!batchMode) return;
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title: event.title || form.title || form.barcode || 'Untitled capture',
      status: event.status || 'review',
      detail: event.detail || '',
      created_at: new Date().toISOString()
    };
    setBatchEvents((current) => [entry, ...current].slice(0, 8));
  };

  const buildBatchSummary = () => ({
    stats: { ...batchStats },
    events: batchEvents,
    stopped_at: new Date().toISOString()
  });

  const saveCapture = async ({ closeEditor = true, silent = false, formSnapshot = form, lookupSnapshot = formLookup } = {}) => {
    setSaving(true);
    try {
      const item = await persistCapture(formSnapshot, lookupSnapshot);
      if (!silent) onToast?.('Capture saved.', 'success');
      if (closeEditor) setEditorOpen(false);
      resetEditorForm();
      await loadCaptures(1);
      return item;
    } catch (err) {
      onToast?.(err?.message || 'Could not save capture.', 'error');
      if (batchMode) {
        setBatchStats((current) => ({ ...current, errors: current.errors + 1 }));
        recordBatchEvent({
          status: 'error',
          title: formSnapshot.title || formSnapshot.barcode || 'Capture',
          detail: err?.message || 'Could not save capture.'
        });
      }
      return null;
    } finally {
      setSaving(false);
    }
  };

  const lookupFormBarcode = async ({ barcode, symbology = '', mediaType = null } = {}) => {
    const code = String(barcode || '').trim();
    if (!code) return;
    setFormLookup({
      ...EMPTY_FORM_LOOKUP,
      loading: true,
      barcode: code,
      lookedUp: true
    });
    try {
      const response = await apiCall('post', '/media/lookup/barcode', {
        barcode: code,
        symbology: symbology || null,
        mediaType: mediaType && mediaType !== 'other' ? mediaType : null,
        limit: 6
      });
      const matches = Array.isArray(response?.matches) ? response.matches : [];
      const lookupSnapshot = {
        loading: false,
        matches,
        lookup: {
          provider: response?.provider || null,
          barcode: response?.barcode || code,
          symbology: response?.symbology || symbology || null,
          count: response?.count ?? matches.length,
          catalog_count: response?.catalog_count || 0,
          provider_count: response?.provider_count || 0,
          provider_error: response?.provider_error || null,
          looked_up_at: new Date().toISOString()
        },
        error: null,
        barcode: response?.barcode || code,
        lookedUp: true
      };
      setFormLookup(lookupSnapshot);
      onToast?.(
        matches.length ? `Found ${matches.length} match${matches.length === 1 ? '' : 'es'}.` : 'No matches found. You can save this capture for review.',
        matches.length ? 'success' : 'info'
      );
      const safeExactMatch = findSafeExactIsbnMatch(matches, response?.barcode || code);
      if (batchMode && safeExactMatch) {
        onToast?.('Exact ISBN match found. Adding it to the library.', 'info');
        await importFormLookupMatch(safeExactMatch, {
          formSnapshot: {
            ...form,
            capture_type: 'barcode',
            object_type: 'book',
            barcode: response?.barcode || code,
            symbology: response?.symbology || symbology || 'ISBN',
            title: form.title || safeExactMatch.title || ''
          },
          lookupSnapshot
        });
      }
    } catch (err) {
      const message = err?.message || 'Could not find matches.';
      setFormLookup({
        ...EMPTY_FORM_LOOKUP,
        loading: false,
        error: message,
        barcode: code,
        lookedUp: true
      });
      onToast?.(message, 'error');
    }
  };

  const importFormLookupMatch = async (match, options = {}) => {
    const currentForm = { ...form, ...(options.formSnapshot || {}) };
    const currentLookup = options.lookupSnapshot || formLookup;
    setFormImporting(true);
    try {
      const item = await saveCapture({
        closeEditor: false,
        silent: true,
        formSnapshot: currentForm,
        lookupSnapshot: currentLookup
      });
      if (!item?.id) return;
      const response = await apiCall('post', `/capture-items/${item.id}/import-match`, {
        match_id: match.id,
        match,
        barcode: currentForm.barcode || match.barcode || match.upc || null,
        symbology: currentForm.symbology || match.symbology || null,
        media_type: match.media_type || match.mediaTypeGuess || currentForm.object_type || null
      });
      const action = response?.import?.action === 'matched_existing' ? 'linked' : 'added';
      onToast?.(`Capture ${action} to library.`, 'success');
      if (batchMode) {
        setBatchStats((current) => ({
          ...current,
          imported: action === 'added' ? current.imported + 1 : current.imported,
          linked: action === 'linked' ? current.linked + 1 : current.linked
        }));
        recordBatchEvent({
          status: action,
          title: match.title || currentForm.title || currentForm.barcode || 'Exact ISBN match',
          detail: action === 'linked' ? 'Linked existing library item' : 'Added to library'
        });
      }
      resetEditorForm();
      if (batchMode) {
        requestNextScan();
      } else {
        setEditorOpen(false);
      }
      await loadCaptures(1);
    } catch (err) {
      onToast?.(err?.message || 'Could not add selected match.', 'error');
      if (batchMode) {
        setBatchStats((current) => ({ ...current, errors: current.errors + 1 }));
        recordBatchEvent({
          status: 'error',
          title: match?.title || currentForm.title || currentForm.barcode || 'Capture',
          detail: err?.message || 'Could not add selected match.'
        });
      }
    } finally {
      setFormImporting(false);
    }
  };

  const saveAndScanNext = async () => {
    const item = await saveCapture({ closeEditor: false, silent: true });
    if (!item?.id) return;
    const hadMatches = Array.isArray(formLookup.matches) && formLookup.matches.length > 0;
    setBatchStats((current) => ({
      ...current,
      saved: current.saved + 1,
      review: current.review + 1,
      needs_choice: hadMatches ? current.needs_choice + 1 : current.needs_choice,
      no_match: hadMatches ? current.no_match : current.no_match + 1
    }));
    recordBatchEvent({
      status: hadMatches ? 'needs_choice' : 'no_match',
      title: form.title || form.barcode || 'Saved capture',
      detail: hadMatches ? 'Needs candidate choice' : 'No lookup match'
    });
    onToast?.('Capture saved. Ready for the next scan.', 'success');
    resetEditorForm();
    requestNextScan();
  };

  const updateStatus = async (item, nextStatus) => {
    try {
      await apiCall('patch', `/capture-items/${item.id}`, { status: nextStatus });
      onToast?.(`Capture marked ${nextStatus}.`, 'success');
      await loadCaptures(pagination.page || 1);
    } catch (err) {
      onToast?.(err?.message || 'Could not update capture.', 'error');
    }
  };

  const convertToWishlist = async (item) => {
    try {
      await apiCall('post', `/capture-items/${item.id}/convert-wishlist`, {});
      onToast?.('Capture added to Wishlist.', 'success');
      await loadCaptures(pagination.page || 1);
    } catch (err) {
      onToast?.(err?.message || 'Could not convert capture.', 'error');
    }
  };

  const extractOcrCandidates = async (item) => {
    if (!item.ocr_text) {
      onToast?.('Add OCR text before extracting candidates.', 'error');
      return;
    }
    setWorkingCaptureId(item.id);
    try {
      const response = await apiCall('post', `/capture-items/${item.id}/ocr-text`, {
        ocr_text: item.ocr_text,
        source: 'web_capture_inbox'
      });
      const count = response?.candidates?.length || 0;
      onToast?.(count ? `Found ${count} OCR candidate${count === 1 ? '' : 's'}.` : 'No identifiers found in OCR text.', count ? 'success' : 'info');
      await loadCaptures(pagination.page || 1);
    } catch (err) {
      onToast?.(err?.message || 'Could not extract OCR candidates.', 'error');
    } finally {
      setWorkingCaptureId(null);
    }
  };

  const readImageText = async (item) => {
    if (!item.image_path) {
      onToast?.('Capture needs an image before backend OCR can run.', 'error');
      return;
    }
    setWorkingCaptureId(item.id);
    try {
      const response = await apiCall('post', `/capture-items/${item.id}/ocr-image`, {});
      const count = response?.candidates?.length || 0;
      onToast?.(
        count ? `Found ${count} image OCR candidate${count === 1 ? '' : 's'}.` : 'Image OCR finished with no identifiers found.',
        count ? 'success' : 'info'
      );
      await loadCaptures(pagination.page || 1);
    } catch (err) {
      onToast?.(err?.message || 'Could not read text from image.', 'error');
    } finally {
      setWorkingCaptureId(null);
    }
  };

  const applyOcrCandidate = async (item, candidate) => {
    setWorkingCaptureId(item.id);
    try {
      await apiCall('post', `/capture-items/${item.id}/apply-ocr-candidate`, {
        candidate_id: candidate.id,
        candidate
      });
      onToast?.('OCR candidate applied.', 'success');
      await loadCaptures(pagination.page || 1);
    } catch (err) {
      onToast?.(err?.message || 'Could not apply OCR candidate.', 'error');
    } finally {
      setWorkingCaptureId(null);
    }
  };

  const lookupMatches = async (item) => {
    if (!item.barcode) {
      onToast?.('Apply an OCR candidate or add a barcode before finding matches.', 'error');
      return;
    }
    setWorkingCaptureId(item.id);
    try {
      const response = await apiCall('post', `/capture-items/${item.id}/lookup-matches`, {
        limit: 6
      });
      const count = response?.matches?.length || 0;
      onToast?.(
        count ? `Found ${count} capture match${count === 1 ? '' : 'es'}.` : 'No catalog or provider matches found.',
        count ? 'success' : 'info'
      );
      await loadCaptures(pagination.page || 1);
    } catch (err) {
      onToast?.(err?.message || 'Could not find capture matches.', 'error');
    } finally {
      setWorkingCaptureId(null);
    }
  };

  const importLookupMatch = async (item, match) => {
    setWorkingCaptureId(item.id);
    try {
      const response = await apiCall('post', `/capture-items/${item.id}/import-match`, {
        match_id: match.id,
        match
      });
      const action = response?.import?.action === 'matched_existing' ? 'linked' : 'imported';
      onToast?.(`Capture ${action} to library.`, 'success');
      await loadCaptures(pagination.page || 1);
    } catch (err) {
      onToast?.(err?.message || 'Could not import capture match.', 'error');
    } finally {
      setWorkingCaptureId(null);
    }
  };

  const resolveReplayConflict = async (item, action) => {
    setWorkingCaptureId(item.id);
    try {
      await apiCall('post', `/capture-items/${item.id}/resolve-replay-conflict`, { action });
      onToast?.(action === 'apply_incoming' ? 'Replayed values applied.' : 'Replay conflict kept current values.', 'success');
      await loadCaptures(pagination.page || 1);
    } catch (err) {
      onToast?.(err?.message || 'Could not resolve replay conflict.', 'error');
    } finally {
      setWorkingCaptureId(null);
    }
  };

  const deleteCapture = async (item) => {
    if (!window.confirm('Delete this capture?')) return;
    try {
      await apiCall('delete', `/capture-items/${item.id}`);
      onToast?.('Capture deleted.', 'success');
      await loadCaptures(pagination.page || 1);
    } catch (err) {
      onToast?.(err?.message || 'Could not delete capture.', 'error');
    }
  };

  const openNewCapture = () => {
    resetEditorForm();
    setEditorOpen(true);
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        editorRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
      }, 0);
    });
  };

  const startBatchScan = () => {
    setLastBatchSummary(null);
    setBatchMode(true);
    setBatchStats(emptyBatchStats());
    setBatchEvents([]);
    resetEditorForm();
    setEditorOpen(true);
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        editorRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
        requestNextScan();
      }, 0);
    });
  };

  const stopBatchScan = () => {
    setLastBatchSummary(buildBatchSummary());
    setBatchMode(false);
    onToast?.('Batch scan stopped.', 'info');
  };

  const [headerCompact, setHeaderCompact] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterMenuRef = useRef(null);
  const handleBodyScroll = useCallback((event) => {
    setHeaderCompact(event.currentTarget.scrollTop > 24);
  }, []);
  useEffect(() => {
    if (!filterOpen) return undefined;
    const handlePointerDown = (event) => {
      if (!filterMenuRef.current) return;
      if (filterMenuRef.current.contains(event.target)) return;
      setFilterOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [filterOpen]);

  const captureTypeFilterLabel = captureType === 'all' ? 'All captures' : typeLabel(captureType, CAPTURE_TYPES);
  const sourceFilterLabel = typeLabel(sourceFilter, SOURCE_FILTERS);
  const reviewFilterLabel = REVIEW_TABS.find((tab) => tab.id === reviewFilter)?.label || 'All';
  const captureFilterSummary = [
    captureTypeFilterLabel,
    sourceFilterLabel,
    reviewFilterLabel === 'All' ? null : reviewFilterLabel
  ].filter(Boolean).join(' · ');

  const header = (
    <UtilityPageHeader
      title="Capture Inbox"
      compact={headerCompact}
      titleClassName="whitespace-nowrap"
      actions={(
        <>
          <button
            type="button"
            className="btn-icon h-9 w-9"
            onClick={openNewCapture}
            aria-label="New capture"
            title="New capture"
          >
            {Icons?.Camera ? <Icons.Camera /> : null}
          </button>
          <button
            type="button"
            className="btn-icon h-9 w-9"
            onClick={batchMode ? stopBatchScan : startBatchScan}
            aria-label={batchMode ? 'Stop batch' : 'Batch scan'}
            title={batchMode ? 'Stop batch' : 'Batch scan'}
          >
            {Icons?.Barcode ? <Icons.Barcode /> : null}
          </button>
        </>
      )}
      controls={(
        <div className="space-y-2">
          <SectionTabs
            tabs={STATUS_TABS}
            activeId={status}
            onChange={(next) => setStatus(next)}
            showDivider={false}
            className="min-w-0"
            listClassName="gap-3"
            buttonClassName="py-1.5 text-xs"
            ariaLabel="Capture status"
          />
          <div className="flex min-w-0 items-center gap-2">
            <input
              className="input h-9 min-w-0 flex-1"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search title, barcode, OCR, note"
            />
            <CaptureFilterMenu
              Icons={Icons}
              open={filterOpen}
              onToggle={() => setFilterOpen((current) => !current)}
              menuRef={filterMenuRef}
              summary={captureFilterSummary}
              captureType={captureType}
              setCaptureType={setCaptureType}
              sourceFilter={sourceFilter}
              setSourceFilter={setSourceFilter}
              reviewTabs={reviewTabs}
              reviewFilter={reviewFilter}
              setReviewFilter={setReviewFilter}
            />
          </div>
        </div>
      )}
    />
  );

  return (
    <FixedPageShell
      header={header}
      headerInnerClassName="mx-auto w-full max-w-7xl"
      bodyInnerClassName="mx-auto w-full max-w-7xl space-y-4 px-4 pb-6 pt-4 sm:px-6"
      onBodyScroll={handleBodyScroll}
      headerTestId="capture-page-header"
      bodyTestId="capture-page-body"
    >
      {lastBatchSummary ? (
        <div className="border-y border-edge py-3" aria-label="Batch scan summary">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-ink">Batch summary</div>
              <div className="mt-1 text-xs text-ghost">
                {lastBatchSummary.stats.imported} added · {lastBatchSummary.stats.linked} linked · {lastBatchSummary.stats.needs_choice} need choice · {lastBatchSummary.stats.no_match} no match
                {lastBatchSummary.stats.errors ? ` · ${lastBatchSummary.stats.errors} failed` : ''}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {lastBatchSummary.stats.needs_choice ? (
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => {
                    setStatus('active');
                    setReviewFilter('needs_choice');
                  }}
                >
                  Review choices
                </button>
              ) : null}
              {lastBatchSummary.stats.no_match ? (
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => {
                    setStatus('active');
                    setReviewFilter('no_match');
                  }}
                >
                  Review no matches
                </button>
              ) : null}
              <button type="button" className="btn-ghost btn-sm" onClick={() => setLastBatchSummary(null)}>Dismiss</button>
            </div>
          </div>
          {lastBatchSummary.events.length ? (
            <div className="mt-3 divide-y divide-edge/70 border-t border-edge/70">
              {lastBatchSummary.events.slice(0, 5).map((event) => (
                <div key={event.id} className="grid gap-1 py-2 text-xs sm:grid-cols-[7rem_1fr_auto] sm:items-center">
                  <span className={cx('font-medium', event.status === 'error' ? 'text-err' : event.status === 'needs_choice' ? 'text-warn' : 'text-ghost')}>
                    {titleCase(event.status)}
                  </span>
                  <span className="truncate text-ink">{event.title}</span>
                  <span className="truncate text-ghost">{event.detail}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {(showScannerShortcut || showAllSourcesShortcut) ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-y border-edge py-3" aria-label="Capture source shortcuts">
          <div>
            <div className="text-sm font-medium text-ink">
              {sourceFilter === 'scanner' ? 'Scanner app captures' : 'Scanner captures waiting'}
            </div>
            <div className="mt-1 text-xs text-ghost">
              {sourceFilter === 'scanner'
                ? `${pagination.total || 0} scanner capture${(pagination.total || 0) === 1 ? '' : 's'} in this view`
                : `${sourceCounts.scanner} scanner capture${sourceCounts.scanner === 1 ? '' : 's'} in the current status`}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {showScannerShortcut ? (
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => {
                  setStatus('active');
                  setSourceFilter('scanner');
                  setReviewFilter('all');
                }}
              >
                Review scanner captures
              </button>
            ) : null}
            {showAllSourcesShortcut ? (
              <button type="button" className="btn-ghost btn-sm" onClick={() => setSourceFilter('all')}>
                Show all sources
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="border-b border-edge pb-2">
          <div className="text-xs text-ghost">Active</div>
          <div className="mt-1 text-xl font-semibold text-ink">{visibleCounts.active}</div>
        </div>
        <div className="border-b border-edge pb-2">
          <div className="text-xs text-ghost">Replay conflicts</div>
          <div className="mt-1 text-xl font-semibold text-ink">{visibleCounts.conflicts}</div>
        </div>
        <div className="border-b border-edge pb-2">
          <div className="text-xs text-ghost">Scanner</div>
          <div className="mt-1 text-xl font-semibold text-ink">{visibleCounts.scanner}</div>
        </div>
        <div className="border-b border-edge pb-2">
          <div className="text-xs text-ghost">Barcode</div>
          <div className="mt-1 text-xl font-semibold text-ink">{visibleCounts.barcode}</div>
        </div>
        <div className="border-b border-edge pb-2">
          <div className="text-xs text-ghost">Photo</div>
          <div className="mt-1 text-xl font-semibold text-ink">{visibleCounts.photo}</div>
        </div>
      </div>

      {editorOpen ? (
        <CaptureEditor
          form={form}
          setForm={setForm}
          saving={saving}
          formLookup={formLookup}
          formImporting={formImporting}
          batchMode={batchMode}
          batchStats={batchStats}
          scanRequest={scanRequest}
          onSave={saveCapture}
          onToast={onToast}
          onLookupBarcode={lookupFormBarcode}
          onClearLookup={() => setFormLookup(EMPTY_FORM_LOOKUP)}
          onImportMatch={importFormLookupMatch}
          onSaveAndScanNext={saveAndScanNext}
          onStopBatch={stopBatchScan}
          Icons={Icons}
          editorRef={editorRef}
          onCancel={() => {
            setEditorOpen(false);
            resetEditorForm();
          }}
        />
      ) : null}

      {editorOpen && items.length === 0 ? null : loading ? (
        <div className="flex min-h-52 items-center justify-center text-ghost">
          {Spinner ? <Spinner /> : 'Loading...'}
        </div>
      ) : error ? (
        <div className="py-4 text-sm text-err">{error}</div>
      ) : items.length === 0 ? (
        <div className="border-b border-edge/70 py-6 text-sm text-ghost">{emptyReviewMessage(reviewFilter)}</div>
      ) : (
        <div className="divide-y divide-edge/70 border-b border-edge/70">
          {items.map((item) => {
            const primary = item.title || item.barcode || item.ocr_text || item.notes || 'Untitled capture';
            const scannerCapture = isScannerCapture(item);
            const secondary = [
              typeLabel(item.capture_type, CAPTURE_TYPES),
              typeLabel(item.object_type, OBJECT_TYPES),
              scannerCapture ? 'Scanner app' : null,
              item.barcode,
              dateLabel(item.updated_at)
            ].filter(Boolean).join(' · ');
            const ocrCandidates = Array.isArray(item.review_decision?.ocr_candidates) ? item.review_decision.ocr_candidates : [];
            const selectedCandidateId = item.review_decision?.selected_ocr_candidate?.id || '';
            const lookupMatchesList = Array.isArray(item.review_decision?.capture_lookup_matches) ? item.review_decision.capture_lookup_matches : [];
            const lookupStatus = item.review_decision?.capture_lookup_status || {};
            const reviewReasons = Array.isArray(item.review_reasons) ? item.review_reasons : [];
            const replayConflict = latestReplayConflict(item);
            const replayFields = Array.isArray(replayConflict?.fields) ? replayConflict.fields : [];
            return (
              <div key={item.id} className="grid gap-3 py-3 md:grid-cols-[auto_1fr_auto] md:items-center">
                {item.image_path ? (
                  <img
                    src={posterUrl(item.image_path)}
                    alt=""
                    className="h-16 w-12 rounded-md border border-edge object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="hidden h-16 w-12 md:block" aria-hidden="true" />
                )}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="truncate text-sm font-medium text-ink">{primary}</div>
                    <span className="text-xs text-ghost">#{item.id}</span>
                    <span className="text-xs text-dim">{item.status}</span>
                  </div>
                  <div className="mt-1 text-xs text-ghost">{secondary}</div>
                  {reviewReasons.length ? (
                    <div className="mt-1 text-xs text-ghost" aria-label="Capture review reasons">
                      Review: {reviewReasons.map((reason) => reason.label).join(' · ')}
                    </div>
                  ) : null}
                  {item.image_path ? <div className="mt-1 truncate text-xs text-dim">{item.image_path}</div> : null}
                  {item.ocr_text ? <div className="mt-1 line-clamp-2 text-xs text-dim">{item.ocr_text}</div> : null}
                  {replayFields.length ? (
                    <div className="mt-3 border-l-2 border-warn/60 pl-3" aria-label="Replay conflict review">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="text-xs font-medium text-warn">Replay conflict</span>
                        <span className="text-xs text-ghost">
                          {replayFields.map((conflict) => titleCase(conflict.field)).join(', ')}
                        </span>
                      </div>
                      <div className="mt-2 grid gap-1 text-xs md:max-w-2xl">
                        {replayFields.slice(0, 4).map((conflict) => (
                          <div key={`${item.id}-${conflict.field}`} className="grid gap-1 md:grid-cols-[7rem_1fr_1fr]">
                            <span className="text-ghost">{titleCase(conflict.field)}</span>
                            <span className="truncate text-dim">Current: {displayConflictValue(conflict.existing)}</span>
                            <span className="truncate text-dim">Replayed: {displayConflictValue(conflict.incoming)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          disabled={workingCaptureId === item.id}
                          onClick={() => resolveReplayConflict(item, 'keep_existing')}
                        >
                          Keep current
                        </button>
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          disabled={workingCaptureId === item.id}
                          onClick={() => resolveReplayConflict(item, 'apply_incoming')}
                        >
                          Use replayed values
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {ocrCandidates.length ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-ghost">OCR candidates</span>
                      {ocrCandidates.slice(0, 4).map((candidate) => (
                        <button
                          key={candidate.id || candidate.value}
                          type="button"
                          className={cx(
                            'btn-ghost btn-sm h-7 px-2 text-xs',
                            selectedCandidateId === candidate.id ? 'border-ok/50 text-ok' : ''
                          )}
                          disabled={workingCaptureId === item.id}
                          onClick={() => applyOcrCandidate(item, candidate)}
                        >
                          {selectedCandidateId === candidate.id ? 'Using ' : 'Use '}
                          {candidate.label || candidate.value}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {lookupMatchesList.length ? (
                    <div className="mt-2 border-l-2 border-edge pl-3" aria-label="Capture lookup matches">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="text-xs font-medium text-ink">Matches</span>
                        <span className="text-xs text-ghost">
                          {lookupStatus.catalog_count || 0} catalog · {lookupStatus.provider_count || 0} provider
                        </span>
                      </div>
                      <div className="mt-2 grid gap-1 md:max-w-2xl">
                        {lookupMatchesList.slice(0, 4).map((match) => (
                          <div key={match.id || `${item.id}-${match.title}`} className="grid items-center gap-2 text-xs md:grid-cols-[1fr_auto_auto]">
                            <span className="truncate text-dim">
                              {match.title || 'Untitled match'}
                              {match.media_type || match.mediaTypeGuess ? ` · ${typeLabel(match.media_type || match.mediaTypeGuess, OBJECT_TYPES)}` : ''}
                            </span>
                            <span className={cx('text-ghost', match.already_imported ? 'text-ok' : '')}>
                              {match.already_imported ? 'In library' : titleCase(match.source || 'provider')}
                            </span>
                            {item.status !== 'converted' ? (
                              <button
                                type="button"
                                className="btn-ghost btn-sm h-7 px-2 text-xs"
                                disabled={workingCaptureId === item.id}
                                onClick={() => importLookupMatch(item, match)}
                              >
                                {match.already_imported ? 'Link' : 'Import'}
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : lookupStatus.provider_error ? (
                    <div className="mt-2 text-xs text-warn" aria-label="Capture lookup warning">
                      Match lookup warning: {lookupStatus.provider_error}
                    </div>
                  ) : null}
                  {item.notes ? <div className="mt-1 line-clamp-2 text-xs text-dim">{item.notes}</div> : null}
                </div>
                <div className="flex flex-wrap gap-2 md:justify-end">
                  {item.image_path && (
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      disabled={workingCaptureId === item.id}
                      onClick={() => readImageText(item)}
                    >
                      Read image text
                    </button>
                  )}
                  {item.ocr_text && (
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      disabled={workingCaptureId === item.id}
                      onClick={() => extractOcrCandidates(item)}
                    >
                      Extract IDs
                    </button>
                  )}
                  {item.barcode && (
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      disabled={workingCaptureId === item.id}
                      onClick={() => lookupMatches(item)}
                    >
                      Find matches
                    </button>
                  )}
                  {item.status !== 'reviewed' && item.status !== 'converted' && (
                    <button type="button" className="btn-ghost btn-sm" onClick={() => updateStatus(item, 'reviewed')}>
                      {Icons?.Check ? <Icons.Check /> : null}
                      Reviewed
                    </button>
                  )}
                  {item.status !== 'converted' && (
                    <button type="button" className="btn-ghost btn-sm" onClick={() => convertToWishlist(item)}>
                      Wishlist
                    </button>
                  )}
                  {item.status !== 'discarded' && item.status !== 'converted' && (
                    <button type="button" className="btn-ghost btn-sm text-err" onClick={() => updateStatus(item, 'discarded')}>
                      Discard
                    </button>
                  )}
                  <button type="button" className="btn-ghost btn-sm text-err" onClick={() => deleteCapture(item)}>
                    {Icons?.Trash ? <Icons.Trash /> : null}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CollectionPaginationFooter
        page={pagination.page}
        totalPages={pagination.total_pages}
        hasMore={(pagination.page || 1) < (pagination.total_pages || 1)}
        loading={loading}
        pageSize={pagination.limit || 50}
        showPageSize={false}
        onPrevious={() => loadCaptures(Math.max(1, (pagination.page || 1) - 1))}
        onNext={() => loadCaptures(Math.min(pagination.total_pages || 1, (pagination.page || 1) + 1))}
        leadingContent={`${pagination.total || 0} captures`}
        className="px-0"
      />
    </FixedPageShell>
  );
}
