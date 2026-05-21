import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CollectionPaginationFooter, SectionTabs, cx } from './app/AppPrimitives';
import { getOwnedFormatOptions } from './app/mediaFormats';

const STATUS_TABS = [
  { id: 'active', label: 'Active' },
  { id: 'wanted', label: 'Wanted' },
  { id: 'watching', label: 'Watching' },
  { id: 'preordered', label: 'Preordered' },
  { id: 'ordered', label: 'Ordered' },
  { id: 'acquired', label: 'Acquired' },
  { id: 'dismissed', label: 'Dismissed' },
  { id: 'all', label: 'All' }
];

const OBJECT_TYPES = [
  { value: 'movie', label: 'Movie' },
  { value: 'tv_series', label: 'TV' },
  { value: 'book', label: 'Book' },
  { value: 'comic_book', label: 'Comic' },
  { value: 'audio', label: 'Audio' },
  { value: 'game', label: 'Game' },
  { value: 'art', label: 'Art' },
  { value: 'collectible', label: 'Collectible' },
  { value: 'event_item', label: 'Event item' },
  { value: 'other', label: 'Other' }
];

const APPLE_MEDIA_OPTIONS = [
  { value: 'movie', label: 'Movies' },
  { value: 'tvShow', label: 'TV' },
  { value: 'ebook', label: 'Books' },
  { value: 'audiobook', label: 'Audiobooks' },
  { value: 'music', label: 'Music' },
  { value: 'musicVideo', label: 'Music videos' },
  { value: 'podcast', label: 'Podcasts' },
  { value: 'shortFilm', label: 'Short films' },
  { value: 'software', label: 'Apps' },
  { value: 'all', label: 'All' }
];

const MEDIA_TYPES = new Set(['movie', 'tv_series', 'book', 'comic_book', 'audio', 'game']);

const WISHLIST_FORMAT_OPTIONS = {
  art: ['Original', 'Print', 'Poster', 'Commission', 'Sketch', 'Digital'],
  collectible: ['Figure', 'Statue', 'Card', 'Prop', 'Pin', 'Apparel', 'Merch'],
  event_item: ['Badge', 'Program', 'Exclusive', 'Print', 'Merch', 'Ticket'],
  other: ['Physical', 'Digital', 'Service', 'Part', 'Upgrade']
};

const PROVIDER_LABELS = {
  apple_itunes: 'Apple/iTunes',
  googlebooks: 'Google Books',
  google_books: 'Google Books',
  kavita: 'Kavita',
  plex: 'Plex',
  upcitemdb: 'UPCItemDB',
  comicvine: 'Comic Vine',
  metron: 'Metron',
  ios_scanner_app: 'iOS scanner'
};

const APPLE_KIND_LABELS = {
  'feature-movie': 'Movie',
  'tv-episode': 'TV episode',
  book: 'Book',
  audiobook: 'Audiobook',
  song: 'Song',
  album: 'Album',
  'music-video': 'Music video',
  podcast: 'Podcast',
  'podcast-episode': 'Podcast episode',
  'short-film': 'Short film',
  'software-package': 'App'
};

const IDENTIFIER_LABELS = {
  isbn: 'ISBN',
  isbn10: 'ISBN-10',
  isbn_10: 'ISBN-10',
  isbn13: 'ISBN-13',
  isbn_13: 'ISBN-13',
  upc: 'UPC',
  ean: 'EAN',
  barcode: 'Barcode',
  asin: 'ASIN'
};

const TECHNICAL_IDENTIFIER_KEYS = new Set([
  'provider_name',
  'provider_item_id',
  'apple_itunes_provider_key',
  'apple_itunes_track_id',
  'apple_itunes_collection_id',
  'apple_itunes_media',
  'apple_itunes_kind'
]);

const EMPTY_FORM = {
  title: '',
  object_type: 'book',
  status: 'wanted',
  priority: 'normal',
  year: '',
  desired_format: '',
  desired_edition: '',
  provider: '',
  provider_key: '',
  vendor: '',
  target_price: '',
  notes: '',
  identifiers_text: ''
};

function statusLabel(status) {
  return STATUS_TABS.find((tab) => tab.id === status)?.label || status || 'Wanted';
}

function typeLabel(type) {
  return OBJECT_TYPES.find((item) => item.value === type)?.label || type || 'Item';
}

function providerLabel(provider) {
  const key = String(provider || '').trim();
  if (!key) return '';
  const normalized = key.toLowerCase();
  if (PROVIDER_LABELS[normalized]) return PROVIDER_LABELS[normalized];
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function appleMediaLabel(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const kindLabel = APPLE_KIND_LABELS[raw] || APPLE_KIND_LABELS[raw.toLowerCase()];
  if (kindLabel) return kindLabel;
  const optionLabel = APPLE_MEDIA_OPTIONS.find((option) => option.value === raw)?.label;
  if (optionLabel) return optionLabel;
  return raw
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getWishlistFormatOptions(objectType, currentValue = '') {
  const baseOptions = MEDIA_TYPES.has(objectType)
    ? getOwnedFormatOptions(objectType).map((entry) => entry.label)
    : (WISHLIST_FORMAT_OPTIONS[objectType] || WISHLIST_FORMAT_OPTIONS.other);
  const seen = new Set();
  const options = baseOptions
    .filter(Boolean)
    .map((label) => String(label).trim())
    .filter((label) => {
      const key = label.toLowerCase();
      if (!label || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((label) => ({ value: label, label }));

  const customValue = String(currentValue || '').trim();
  if (customValue && !seen.has(customValue.toLowerCase())) {
    options.push({ value: customValue, label: customValue });
  }

  return options;
}

function normalizeWishlistFormatForType(objectType, value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = getWishlistFormatOptions(objectType).find((option) => (
    option.value.toLowerCase() === raw.toLowerCase() || option.label.toLowerCase() === raw.toLowerCase()
  ));
  return match?.value || '';
}

function parseIdentifiers(value) {
  const raw = String(value || '').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    const pairs = raw
      .split(/[,\n]/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [key, ...rest] = entry.split(':');
        return [String(key || '').trim(), rest.join(':').trim()];
      })
      .filter(([key, val]) => key && val);
    return Object.fromEntries(pairs);
  }
}

function stringifyIdentifiers(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length === 0) return '';
  return Object.entries(value)
    .map(([key, val]) => `${key}: ${val}`)
    .join('\n');
}

function identifierSummary(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const entries = Object.entries(value)
    .filter(([key, val]) => {
      const normalizedKey = String(key || '').trim();
      return normalizedKey
        && !TECHNICAL_IDENTIFIER_KEYS.has(normalizedKey)
        && val !== null
        && val !== undefined
        && String(val).trim();
    });

  const prioritized = Object.keys(IDENTIFIER_LABELS)
    .map((key) => entries.find(([entryKey]) => entryKey === key))
    .filter(Boolean);
  const remaining = entries.filter(([key]) => !IDENTIFIER_LABELS[key]);
  return [...prioritized, ...remaining]
    .slice(0, 3)
    .map(([key, val]) => `${IDENTIFIER_LABELS[key] || key}: ${val}`)
    .join(' · ');
}

function wishlistSourceSummary(item) {
  const provider = item?.provider || item?.identifiers?.provider_name || item?.source_context?.provider || item?.source_context?.source;
  const parts = [];
  const sourceLabel = providerLabel(provider);
  if (sourceLabel) parts.push(`Source: ${sourceLabel}`);

  if (provider === 'apple_itunes') {
    const appleType = appleMediaLabel(
      item?.source_context?.kind
      || item?.source_context?.media
      || item?.identifiers?.apple_itunes_kind
      || item?.identifiers?.apple_itunes_media
    );
    if (appleType) parts.push(appleType);
  }

  return parts;
}

function wishlistStoreUrl(item) {
  const raw = item?.source_context?.store_url || item?.source_context?.url || '';
  if (!raw) return '';
  try {
    const parsed = new URL(String(raw));
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
  } catch (_error) {
    return '';
  }
}

function formFromItem(item) {
  if (!item) return EMPTY_FORM;
  return {
    title: item.title || '',
    object_type: item.object_type || 'book',
    status: item.status || 'wanted',
    priority: item.priority || 'normal',
    year: item.year || '',
    desired_format: item.desired_format || '',
    desired_edition: item.desired_edition || '',
    provider: item.provider || '',
    provider_key: item.provider_key || '',
    vendor: item.vendor || '',
    target_price: item.target_price ?? '',
    notes: item.notes || '',
    identifiers_text: stringifyIdentifiers(item.identifiers)
  };
}

function formatMoney(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

function formatAppleMoney(value, currency) {
  if (value === null || value === undefined || value === '') return 'No price';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 'No price';
  try {
    return parsed.toLocaleString(undefined, { style: 'currency', currency: currency || 'USD' });
  } catch (_error) {
    return `${parsed.toFixed(2)} ${currency || ''}`.trim();
  }
}

function formatCompactDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function priorityClass(priority) {
  if (priority === 'grail') return 'text-gold';
  if (priority === 'high') return 'text-err';
  if (priority === 'low') return 'text-ghost';
  return 'text-dim';
}

function Field({ label, className = '', children }) {
  return (
    <label className={cx('space-y-1', className)}>
      <span className="text-xs font-medium text-ghost">{label}</span>
      {children}
    </label>
  );
}

function WishlistEditor({ form, setForm, editingItem, saving, onCancel, onSave }) {
  const hasSourceDetails = Boolean(form.provider || form.provider_key || form.identifiers_text);
  const formatOptions = getWishlistFormatOptions(form.object_type, form.desired_format);

  return (
    <form
      className="max-w-[980px]"
      onSubmit={(event) => {
        event.preventDefault();
        onSave?.();
      }}
    >
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold text-ink">{editingItem ? 'Edit wishlist item' : 'Add wishlist item'}</h2>
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-12">
        <Field label="Title" className="md:col-span-6">
          <input
            className="input w-full"
            value={form.title}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
            required
          />
        </Field>
        <Field label="Type" className="md:col-span-2">
          <select
            className="select w-full"
            value={form.object_type}
            onChange={(event) => {
              const objectType = event.target.value;
              setForm((current) => ({
                ...current,
                object_type: objectType,
                desired_format: normalizeWishlistFormatForType(objectType, current.desired_format)
              }));
            }}
          >
            {OBJECT_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <Field label="Status" className="md:col-span-2">
          <select
            className="select w-full"
            value={form.status}
            onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
          >
            {STATUS_TABS.filter((tab) => tab.id !== 'active' && tab.id !== 'all').map((tab) => (
              <option key={tab.id} value={tab.id}>{tab.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Priority" className="md:col-span-2">
          <select
            className="select w-full"
            value={form.priority}
            onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="grail">Grail</option>
          </select>
        </Field>
        <Field label="Year" className="md:col-span-2">
          <input
            className="input w-full"
            inputMode="numeric"
            value={form.year}
            onChange={(event) => setForm((current) => ({ ...current, year: event.target.value }))}
          />
        </Field>
        <Field label="Format" className="md:col-span-3">
          <select
            className="select w-full"
            value={form.desired_format}
            onChange={(event) => setForm((current) => ({ ...current, desired_format: event.target.value }))}
          >
            <option value="">No preference</option>
            {formatOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <Field label="Edition" className="md:col-span-3">
          <input
            className="input w-full"
            value={form.desired_edition}
            onChange={(event) => setForm((current) => ({ ...current, desired_edition: event.target.value }))}
          />
        </Field>
        <Field label="Vendor" className="md:col-span-2">
          <input
            className="input w-full"
            value={form.vendor}
            onChange={(event) => setForm((current) => ({ ...current, vendor: event.target.value }))}
          />
        </Field>
        <Field label="Target price" className="md:col-span-2">
          <input
            className="input w-full"
            inputMode="decimal"
            value={form.target_price}
            onChange={(event) => setForm((current) => ({ ...current, target_price: event.target.value }))}
          />
        </Field>
        <Field label="Notes" className="md:col-span-8">
          <textarea
            className="textarea min-h-[72px] w-full"
            value={form.notes}
            onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
          />
        </Field>
      </div>

      <details className="mt-4 border-t border-edge/70 pt-3" open={hasSourceDetails}>
        <summary className="cursor-pointer text-sm font-medium text-dim">Source details</summary>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-12">
          <Field label="Source" className="md:col-span-3">
            <input
              className="input w-full"
              value={form.provider}
              onChange={(event) => setForm((current) => ({ ...current, provider: event.target.value }))}
            />
          </Field>
          <Field label="Source item ID" className="md:col-span-3">
            <input
              className="input w-full"
              value={form.provider_key}
              onChange={(event) => setForm((current) => ({ ...current, provider_key: event.target.value }))}
            />
          </Field>
          <Field label="Identifiers" className="md:col-span-6">
            <textarea
              className="textarea min-h-[72px] w-full"
              value={form.identifiers_text}
              onChange={(event) => setForm((current) => ({ ...current, identifiers_text: event.target.value }))}
              placeholder="isbn: 978..."
            />
          </Field>
        </div>
      </details>

      <div className="mt-4 flex justify-start gap-2">
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Saving...' : editingItem ? 'Save changes' : 'Add item'}
        </button>
      </div>
    </form>
  );
}

function AppleItunesWishlistSearch({ apiCall, onToast, onSaved }) {
  const [term, setTerm] = useState('');
  const [media, setMedia] = useState('movie');
  const [country, setCountry] = useState('US');
  const [matches, setMatches] = useState([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState(null);
  const [refreshingPrices, setRefreshingPrices] = useState(false);
  const [scheduler, setScheduler] = useState(null);
  const [schedulerLoading, setSchedulerLoading] = useState(false);
  const [schedulerRunning, setSchedulerRunning] = useState(false);
  const [refreshSummary, setRefreshSummary] = useState(null);
  const [targetHits, setTargetHits] = useState([]);
  const [targetHitsLoading, setTargetHitsLoading] = useState(false);
  const [targetHitActionId, setTargetHitActionId] = useState(null);
  const [error, setError] = useState(null);
  const [targetPrices, setTargetPrices] = useState({});
  const [priceEditors, setPriceEditors] = useState({});

  const loadTargetHits = useCallback(async () => {
    setTargetHitsLoading(true);
    try {
      const payload = await apiCall('get', '/wishlist/apple-itunes/target-price-hits?status=active&limit=5');
      setTargetHits(Array.isArray(payload?.hits) ? payload.hits : []);
    } catch (_err) {
      setTargetHits([]);
    } finally {
      setTargetHitsLoading(false);
    }
  }, [apiCall]);

  const loadScheduler = useCallback(async () => {
    setSchedulerLoading(true);
    try {
      const payload = await apiCall('get', '/wishlist/apple-itunes/price-refresh-scheduler');
      setScheduler(payload);
    } catch (_err) {
      setScheduler(null);
    } finally {
      setSchedulerLoading(false);
    }
  }, [apiCall]);

  useEffect(() => {
    loadScheduler();
    loadTargetHits();
  }, [loadScheduler, loadTargetHits]);

  const searchApple = async (event) => {
    event?.preventDefault?.();
    const query = term.trim();
    if (!query) return;
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const params = new URLSearchParams();
      params.set('term', query);
      params.set('media', media);
      params.set('country', country.trim() || 'US');
      params.set('limit', '25');
      const payload = await apiCall('get', `/wishlist/apple-itunes/search?${params.toString()}`);
      setMatches(Array.isArray(payload?.matches) ? payload.matches : []);
      setPriceEditors({});
    } catch (err) {
      setMatches([]);
      setError(err?.message || 'Apple/iTunes search failed.');
    } finally {
      setLoading(false);
    }
  };

  const saveMatch = async (match) => {
    const key = match.provider_key || match.id;
    setSavingKey(key);
    try {
      const payload = await apiCall('post', '/wishlist/apple-itunes/save', {
        candidate: match,
        target_price: targetPrices[key] || null,
        status: 'wanted',
        priority: 'normal',
        country
      });
      setMatches((current) => current.map((candidate) => (
        (candidate.provider_key || candidate.id) === key
          ? { ...candidate, already_saved: true, wanted_item_id: payload?.item?.id || candidate.wanted_item_id || null }
          : candidate
      )));
      onToast?.(payload?.existing ? 'That Apple/iTunes item is already on the wishlist.' : 'Apple/iTunes item added to the wishlist.', 'success');
      await onSaved?.();
      await loadTargetHits();
    } catch (err) {
      onToast?.(err?.message || 'Could not save Apple/iTunes item.', 'error');
    } finally {
      setSavingKey(null);
    }
  };

  const refreshSavedPrices = async () => {
    setRefreshingPrices(true);
    setRefreshSummary(null);
    try {
      const payload = await apiCall('post', '/wishlist/apple-itunes/refresh-prices', {
        status: 'active',
        limit: 25,
        country
      });
      setRefreshSummary(payload);
      onToast?.(
        `Apple/iTunes prices refreshed for ${payload?.updated || 0} of ${payload?.checked || 0} saved item${Number(payload?.checked || 0) === 1 ? '' : 's'}.`,
        payload?.failed ? 'error' : 'success'
      );
      await onSaved?.();
      await loadTargetHits();
    } catch (err) {
      onToast?.(err?.message || 'Could not refresh Apple/iTunes prices.', 'error');
    } finally {
      setRefreshingPrices(false);
    }
  };

  const runScheduledRefresh = async () => {
    setSchedulerRunning(true);
    try {
      const payload = await apiCall('post', '/wishlist/apple-itunes/price-refresh-scheduler/run', {
        status: 'active',
        limit: scheduler?.runtime?.limit || 25,
        country
      });
      setRefreshSummary(payload?.summary || null);
      onToast?.(
        `Apple/iTunes scheduled refresh checked ${payload?.summary?.checked || 0} saved item${Number(payload?.summary?.checked || 0) === 1 ? '' : 's'}.`,
        payload?.summary?.failed ? 'error' : 'success'
      );
      await loadScheduler();
      await onSaved?.();
      await loadTargetHits();
    } catch (err) {
      onToast?.(err?.message || 'Could not run Apple/iTunes scheduled refresh.', 'error');
    } finally {
      setSchedulerRunning(false);
    }
  };

  const updateTargetHitStatus = async (hit, nextStatus) => {
    if (!hit?.id) return;
    setTargetHitActionId(`${hit.id}:${nextStatus}`);
    try {
      await apiCall('patch', `/wishlist/${hit.id}`, { status: nextStatus });
      setTargetHits((current) => current.filter((entry) => entry.id !== hit.id));
      onToast?.(`Marked ${hit.title} ${statusLabel(nextStatus).toLowerCase()}.`, 'success');
      await onSaved?.();
    } catch (err) {
      onToast?.(err?.message || 'Could not update target price hit.', 'error');
    } finally {
      setTargetHitActionId(null);
    }
  };

  const schedulerRuntime = scheduler?.runtime || null;
  const schedulerState = scheduler?.state || null;

  return (
    <section className="border-y border-edge py-3">
      <form className="grid max-w-[920px] grid-cols-1 items-end gap-2 md:grid-cols-[minmax(260px,1fr)_160px_96px_auto]" onSubmit={searchApple}>
        <Field label="Apple/iTunes search">
          <input
            className="input h-9 w-full"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search store titles"
          />
        </Field>
        <Field label="Media">
          <select className="select h-9 w-full" value={media} onChange={(event) => setMedia(event.target.value)}>
            {APPLE_MEDIA_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <Field label="Country">
          <input className="input h-9 w-full uppercase" value={country} maxLength={2} onChange={(event) => setCountry(event.target.value.toUpperCase())} />
        </Field>
        <button type="submit" className="btn-secondary h-9" disabled={loading || !term.trim()}>
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ghost">
        <button type="button" className="btn-ghost h-8 text-xs" onClick={refreshSavedPrices} disabled={refreshingPrices}>
          {refreshingPrices ? 'Refreshing prices...' : 'Refresh saved prices'}
        </button>
        {refreshSummary ? (
          <span>
            Updated {refreshSummary.updated || 0} of {refreshSummary.checked || 0}
            {refreshSummary.failed ? ` · ${refreshSummary.failed} failed` : ''}
          </span>
        ) : null}
        {schedulerRuntime ? (
          <span>
            Auto refresh {schedulerRuntime.enabled ? `on · every ${schedulerRuntime.intervalMinutes}m` : 'off'}
            {schedulerState?.lastFinishedAt ? ' · last run saved' : ''}
          </span>
        ) : schedulerLoading ? (
          <span>Checking auto refresh...</span>
        ) : null}
        {schedulerRuntime ? (
          <button type="button" className="btn-ghost h-8 text-xs" onClick={runScheduledRefresh} disabled={schedulerRunning}>
            {schedulerRunning ? 'Running...' : 'Run auto refresh now'}
          </button>
        ) : null}
      </div>

      {targetHits.length > 0 || targetHitsLoading ? (
        <div className="mt-3 border-t border-edge/70 pt-2">
          <div className="mb-1 flex items-center justify-between gap-3 text-xs text-ghost">
            <span>Target price hits</span>
            {targetHitsLoading ? <span>Checking...</span> : <span>{targetHits.length} shown</span>}
          </div>
          <div className="divide-y divide-edge/70">
            {targetHits.map((hit) => (
              <div key={hit.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 text-xs">
                <div className="min-w-0">
                  <span className="font-medium text-ink">{hit.title}</span>
                  <span className="ml-2 text-ghost">{typeLabel(hit.object_type)}</span>
                  {hit.checked_at ? <span className="ml-2 text-ghost">{formatCompactDate(hit.checked_at)}</span> : null}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-ghost">
                  <span>
                    {formatAppleMoney(hit.current_price, hit.currency)} at or below {formatAppleMoney(hit.target_price, hit.currency)}
                  </span>
                  {hit.store_url ? (
                    <a className="text-link hover:underline" href={hit.store_url} target="_blank" rel="noreferrer">Store</a>
                  ) : null}
                  {hit.status !== 'ordered' && hit.status !== 'acquired' ? (
                    <button
                      type="button"
                      className="btn-ghost h-7 text-xs"
                      disabled={targetHitActionId === `${hit.id}:ordered`}
                      onClick={() => updateTargetHitStatus(hit, 'ordered')}
                    >
                      {targetHitActionId === `${hit.id}:ordered` ? 'Saving...' : 'Mark ordered'}
                    </button>
                  ) : null}
                  {hit.status !== 'dismissed' && hit.status !== 'acquired' ? (
                    <button
                      type="button"
                      className="btn-ghost h-7 text-xs"
                      disabled={targetHitActionId === `${hit.id}:dismissed`}
                      onClick={() => updateTargetHitStatus(hit, 'dismissed')}
                    >
                      {targetHitActionId === `${hit.id}:dismissed` ? 'Saving...' : 'Dismiss'}
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {error ? <div className="mt-3 text-sm text-err">{error}</div> : null}
      {searched && !loading && matches.length === 0 && !error ? (
        <div className="mt-3 text-sm text-ghost">No Apple/iTunes results matched that search.</div>
      ) : null}
      {matches.length > 0 ? (
        <div className="mt-3 border-t border-edge/70 pt-2">
          <div className="mb-2 flex items-center justify-between gap-3 text-xs text-ghost">
            <span>{matches.length} Apple/iTunes result{matches.length === 1 ? '' : 's'}</span>
            {media === 'movie' && matches.every((match) => match.match_strength === 'weak') ? (
              <span className="text-warn">Apple returned movies, but none closely matched this title.</span>
            ) : (
              <span className="hidden sm:inline">Add a target price from a result row when needed.</span>
            )}
          </div>
          <div className="max-h-[360px] overflow-y-auto overscroll-contain pr-1">
            <div className="divide-y divide-edge/70">
              {matches.map((match) => {
                const key = match.provider_key || match.id;
                const saved = Boolean(match.already_saved);
                const priceEditorOpen = Boolean(priceEditors[key]);
                return (
                  <div key={match.id || key} className="grid grid-cols-[48px_minmax(0,1fr)] gap-3 py-3 lg:grid-cols-[56px_minmax(0,1fr)_auto]">
                    <div className="h-12 w-12 overflow-hidden rounded border border-edge bg-panel lg:h-14 lg:w-14">
                      {match.artwork_url ? <img src={match.artwork_url} alt="" className="h-full w-full object-cover" /> : null}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <h3 className="truncate text-sm font-semibold text-ink">{match.title}</h3>
                        {match.year ? <span className="text-xs text-ghost">{match.year}</span> : null}
                        <span className="text-xs text-ghost">{typeLabel(match.object_type)}</span>
                        {match.match_strength === 'exact' ? <span className="text-xs text-ok">Exact match</span> : null}
                        {match.match_strength === 'strong' ? <span className="text-xs text-ok">Close match</span> : null}
                        {match.match_strength === 'weak' ? <span className="text-xs text-warn">Weak match</span> : null}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ghost">
                        {match.subtitle ? <span>{match.subtitle}</span> : null}
                        {match.kind || match.media ? <span>{[match.media, match.kind].filter(Boolean).join(' · ')}</span> : null}
                        {match.match_strength === 'weak' && match.match_reason ? <span>{match.match_reason}</span> : null}
                        <span>{formatAppleMoney(match.price, match.currency)}</span>
                        {match.store_url ? (
                          <a className="text-link hover:underline" href={match.store_url} target="_blank" rel="noreferrer">Store</a>
                        ) : null}
                      </div>
                    </div>
                    <div className="col-span-2 flex flex-wrap items-center justify-start gap-2 lg:col-span-1 lg:justify-end">
                      {priceEditorOpen && !saved ? (
                        <label className="flex items-center gap-2 text-xs text-ghost">
                          <span>Target price</span>
                          <input
                            className="input h-8 w-28"
                            inputMode="decimal"
                            aria-label={`Target price for ${match.title}`}
                            value={targetPrices[key] || ''}
                            onChange={(event) => setTargetPrices((current) => ({ ...current, [key]: event.target.value }))}
                            placeholder="Optional"
                          />
                        </label>
                      ) : null}
                      {!saved && !priceEditorOpen ? (
                        <button
                          type="button"
                          className="btn-ghost h-8 text-xs"
                          aria-label={`Set target price for ${match.title}`}
                          onClick={() => setPriceEditors((current) => ({ ...current, [key]: true }))}
                        >
                          Target price
                        </button>
                      ) : null}
                      <button type="button" className={saved ? 'btn-ghost h-8' : 'btn-secondary h-8'} disabled={saved || savingKey === key} onClick={() => saveMatch(match)}>
                        {saved ? 'Saved' : savingKey === key ? 'Saving...' : 'Add'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function applePriceSummary(item) {
  if (item.provider !== 'apple_itunes') return null;
  const source = item.source_context || {};
  const current = formatAppleMoney(source.current_price, source.currency || 'USD');
  if (current === 'No price' && !source.price_refreshed_at) return null;
  const parts = [`Apple current: ${current}`];
  if (source.price_refreshed_at) parts.push('refreshed');
  if (source.target_price_met) parts.push('target met');
  return parts.join(' · ');
}

export default function WishlistView({ apiCall, onToast, activeLibrary, Icons, Spinner }) {
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, total_pages: 1 });
  const [status, setStatus] = useState('active');
  const [objectType, setObjectType] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [openPriceHistoryId, setOpenPriceHistoryId] = useState(null);
  const [priceHistoryByItem, setPriceHistoryByItem] = useState({});
  const [priceHistoryLoadingId, setPriceHistoryLoadingId] = useState(null);

  const loadWishlist = useCallback(async (page = 1) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('status', status);
      params.set('page', String(page));
      params.set('limit', '50');
      if (objectType !== 'all') params.set('object_type', objectType);
      if (search.trim()) params.set('search', search.trim());
      const payload = await apiCall('get', `/wishlist?${params.toString()}`);
      setItems(Array.isArray(payload?.items) ? payload.items : []);
      setPagination(payload?.pagination || { page, limit: 50, total: 0, total_pages: 1 });
    } catch (err) {
      setError(err?.message || 'Could not load wishlist.');
    } finally {
      setLoading(false);
    }
  }, [apiCall, objectType, search, status]);

  useEffect(() => {
    loadWishlist(1);
  }, [loadWishlist]);

  const activeCounts = useMemo(() => {
    const counts = { media: 0, nonmedia: 0 };
    items.forEach((item) => {
      if (MEDIA_TYPES.has(item.object_type)) counts.media += 1;
      else counts.nonmedia += 1;
    });
    return counts;
  }, [items]);

  const openNew = () => {
    setEditingItem(null);
    setForm(EMPTY_FORM);
    setEditorOpen(true);
  };

  const openEdit = (item) => {
    setEditingItem(item);
    setForm(formFromItem(item));
    setEditorOpen(true);
  };

  const payloadFromForm = () => ({
    title: form.title,
    object_type: form.object_type,
    status: form.status,
    priority: form.priority,
    year: form.year || null,
    desired_format: form.desired_format || null,
    desired_edition: form.desired_edition || null,
    provider: form.provider || null,
    provider_key: form.provider_key || null,
    vendor: form.vendor || null,
    target_price: form.target_price || null,
    notes: form.notes || null,
    identifiers: parseIdentifiers(form.identifiers_text)
  });

  const saveItem = async () => {
    setSaving(true);
    try {
      if (editingItem?.id) {
        await apiCall('patch', `/wishlist/${editingItem.id}`, payloadFromForm());
        onToast?.('Wishlist item updated.', 'success');
      } else {
        await apiCall('post', '/wishlist', payloadFromForm());
        onToast?.('Wishlist item added.', 'success');
      }
      setEditorOpen(false);
      setEditingItem(null);
      setForm(EMPTY_FORM);
      await loadWishlist(pagination.page || 1);
    } catch (err) {
      onToast?.(err?.message || 'Could not save wishlist item.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (item, nextStatus) => {
    try {
      await apiCall('patch', `/wishlist/${item.id}`, { status: nextStatus });
      onToast?.(`Marked ${statusLabel(nextStatus).toLowerCase()}.`, 'success');
      await loadWishlist(pagination.page || 1);
    } catch (err) {
      onToast?.(err?.message || 'Could not update wishlist item.', 'error');
    }
  };

  const convertItem = async (item) => {
    try {
      const payload = await apiCall('post', `/wishlist/${item.id}/convert`, {});
      onToast?.(`${payload?.media?.title || item.title} added to the library.`, 'success');
      await loadWishlist(pagination.page || 1);
    } catch (err) {
      onToast?.(err?.message || 'Could not convert wishlist item.', 'error');
    }
  };

  const deleteItem = async (item) => {
    if (!window.confirm(`Delete "${item.title}" from the wishlist?`)) return;
    try {
      await apiCall('delete', `/wishlist/${item.id}`);
      onToast?.('Wishlist item deleted.', 'success');
      await loadWishlist(pagination.page || 1);
    } catch (err) {
      onToast?.(err?.message || 'Could not delete wishlist item.', 'error');
    }
  };

  const togglePriceHistory = async (item) => {
    if (openPriceHistoryId === item.id) {
      setOpenPriceHistoryId(null);
      return;
    }
    setOpenPriceHistoryId(item.id);
    if (priceHistoryByItem[item.id]) return;

    setPriceHistoryLoadingId(item.id);
    try {
      const payload = await apiCall('get', `/wishlist/${item.id}/price-history?limit=8`);
      setPriceHistoryByItem((current) => ({
        ...current,
        [item.id]: Array.isArray(payload?.history) ? payload.history : []
      }));
    } catch (err) {
      onToast?.(err?.message || 'Could not load price history.', 'error');
      setPriceHistoryByItem((current) => ({ ...current, [item.id]: [] }));
    } finally {
      setPriceHistoryLoadingId(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-4 px-4 pb-6 sm:px-5 lg:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Wishlist</h1>
          <p className="mt-1 text-sm text-ghost">{activeLibrary?.name || 'Current library'}</p>
        </div>
        <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={openNew}>
          {Icons?.Plus ? <Icons.Plus /> : null}
          Add item
        </button>
      </div>

      <AppleItunesWishlistSearch apiCall={apiCall} onToast={onToast} onSaved={() => loadWishlist(pagination.page || 1)} />

      <div className="border-y border-edge py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTabs
            tabs={STATUS_TABS}
            activeId={status}
            onChange={(next) => setStatus(next)}
            showDivider={false}
            className="min-w-0"
            listClassName="gap-3"
            buttonClassName="py-1.5 text-xs"
            ariaLabel="Wishlist status"
          />
          <div className="flex flex-wrap items-center gap-2">
            <select className="select h-9 min-w-36" value={objectType} onChange={(event) => setObjectType(event.target.value)}>
              <option value="all">All types</option>
              {OBJECT_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <input
              className="input h-9 w-64 max-w-full"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search title, source, note"
            />
            <button type="button" className="btn-ghost h-9" onClick={() => loadWishlist(1)}>Search</button>
          </div>
        </div>
      </div>

      {editorOpen ? (
        <div className="border-b border-edge/70 py-4">
          <WishlistEditor
            form={form}
            setForm={setForm}
            editingItem={editingItem}
            saving={saving}
            onCancel={() => {
              setEditorOpen(false);
              setEditingItem(null);
            }}
            onSave={saveItem}
          />
        </div>
      ) : null}

      {editorOpen && items.length === 0 ? null : loading ? (
        <div className="flex min-h-52 items-center justify-center text-ghost">
          {Spinner ? <Spinner /> : 'Loading...'}
        </div>
      ) : error ? (
        <div className="py-4 text-sm text-err">{error}</div>
      ) : items.length === 0 ? (
        <div className="border-b border-edge/70 py-6 text-sm text-ghost">No wishlist items match this view.</div>
      ) : (
        <div className="divide-y divide-edge/70 border-b border-edge/70">
          {items.map((item) => {
            const canConvert = MEDIA_TYPES.has(item.object_type) && item.status !== 'acquired';
            const price = formatMoney(item.target_price);
            const applePrice = applePriceSummary(item);
            const isAppleItem = item.provider === 'apple_itunes';
            const priceHistoryOpen = openPriceHistoryId === item.id;
            const priceHistory = priceHistoryByItem[item.id] || [];
            const sourceParts = wishlistSourceSummary(item);
            const idText = identifierSummary(item.identifiers);
            const storeUrl = wishlistStoreUrl(item);
            return (
              <div key={item.id} className="grid gap-3 py-3 md:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h2 className="truncate text-sm font-semibold text-ink">{item.title}</h2>
                    {item.year ? <span className="text-xs text-ghost">{item.year}</span> : null}
                    <span className="text-xs text-ghost">{typeLabel(item.object_type)}</span>
                    {item.priority && item.priority !== 'normal' ? <span className={cx('text-xs capitalize', priorityClass(item.priority))}>{item.priority}</span> : null}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ghost">
                    <span>{statusLabel(item.status)}</span>
                    {item.desired_format ? <span>{item.desired_format}</span> : null}
                    {item.desired_edition ? <span>{item.desired_edition}</span> : null}
                    {price ? <span>{price}</span> : null}
                    {item.linked_media_id ? <span>Library #{item.linked_media_id}</span> : null}
                  </div>
                  {sourceParts.length || idText ? (
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-dim">
                      {sourceParts.map((part) => <span key={part}>{part}</span>)}
                      {idText ? <span>{idText}</span> : null}
                    </div>
                  ) : null}
                  {applePrice ? <div className="mt-1 text-xs text-dim">{applePrice}</div> : null}
                  {priceHistoryOpen ? (
                    <div className="mt-2 rounded border border-edge/70 bg-panel/40 px-3 py-2 text-xs text-dim">
                      {priceHistoryLoadingId === item.id ? (
                        <span>Loading price history...</span>
                      ) : priceHistory.length === 0 ? (
                        <span>No price snapshots yet.</span>
                      ) : (
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                          {priceHistory.map((entry) => (
                            <span key={entry.id}>
                              {formatCompactDate(entry.checked_at) || 'Snapshot'} · {formatAppleMoney(entry.price, entry.currency)}
                              {entry.target_met ? ' · target met' : ''}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}
                  {item.notes ? <p className="mt-2 line-clamp-2 text-sm text-dim">{item.notes}</p> : null}
                </div>
                <div className="flex flex-wrap items-start justify-end gap-2">
                  {storeUrl ? (
                    <a className="btn-ghost h-8" href={storeUrl} target="_blank" rel="noreferrer" aria-label={`Open store for ${item.title}`}>
                      Open store
                    </a>
                  ) : null}
                  {isAppleItem ? (
                    <button
                      type="button"
                      className="btn-ghost h-8"
                      aria-expanded={priceHistoryOpen}
                      onClick={() => togglePriceHistory(item)}
                    >
                      Price history
                    </button>
                  ) : null}
                  {canConvert ? <button type="button" className="btn-secondary h-8" onClick={() => convertItem(item)}>Add to library</button> : null}
                  {item.status !== 'dismissed' && item.status !== 'acquired' ? (
                    <button type="button" className="btn-ghost h-8" onClick={() => updateStatus(item, 'dismissed')}>Dismiss</button>
                  ) : null}
                  <button type="button" className="btn-ghost h-8" onClick={() => openEdit(item)}>Edit</button>
                  <button type="button" className="btn-ghost h-8 text-err" onClick={() => deleteItem(item)}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editorOpen && items.length === 0 ? null : (
        <CollectionPaginationFooter
          page={pagination.page || 1}
          totalPages={pagination.total_pages || 1}
          hasMore={(pagination.page || 1) < (pagination.total_pages || 1)}
          loading={loading}
          pageSize={pagination.limit || 50}
          className="px-0"
          onPrevious={() => loadWishlist(Math.max(1, (pagination.page || 1) - 1))}
          onNext={() => loadWishlist(Math.min(pagination.total_pages || 1, (pagination.page || 1) + 1))}
          onPageSizeChange={() => {}}
          leadingContent={`${pagination.total || 0} item${Number(pagination.total || 0) === 1 ? '' : 's'} · ${activeCounts.media} library-ready · ${activeCounts.nonmedia} other`}
          showPageSize={false}
        />
      )}
    </div>
  );
}
