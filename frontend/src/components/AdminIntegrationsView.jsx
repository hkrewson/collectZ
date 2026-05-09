import React, { useEffect, useMemo, useState } from 'react';
import { CheckboxControl, SectionTabPanel, SectionTabs } from './app/AppPrimitives';

const BARCODE_PRESETS = {
  upcitemdb: { barcodePreset: 'upcitemdb', barcodeProvider: 'upcitemdb', barcodeApiUrl: 'https://api.upcitemdb.com/prod/trial/lookup' },
  barcodelookup: { barcodePreset: 'barcodelookup', barcodeProvider: 'barcodelookup', barcodeApiUrl: 'https://api.barcodelookup.com/v3/products' }
};
const COMICS_PRESETS = {
  metron: { comicsPreset: 'metron', comicsProvider: 'metron', comicsApiUrl: 'https://metron.cloud/api/issue/', comicsUsername: '' },
  gcd: { comicsPreset: 'gcd', comicsProvider: 'gcd', comicsApiUrl: 'https://www.comics.org/api/series/name/', comicsUsername: '' },
  comicvine: { comicsPreset: 'comicvine', comicsProvider: 'comicvine', comicsApiUrl: 'https://comicvine.gamespot.com/api/search/', comicsUsername: '' }
};
const INTEGRATION_FEATURE_LABELS = {
  metrics_enabled: 'Metrics Export',
  external_log_export_enabled: 'External Log Export'
};
const LOG_EXPORT_BACKEND_OPTIONS = [
  { value: '', label: 'Use runtime env defaults' },
  { value: 'off', label: 'Off' },
  { value: 'gelf_udp', label: 'GELF UDP' },
  { value: 'gelf_tcp', label: 'GELF TCP' },
  { value: 'stdout_json', label: 'stdout JSON' },
  { value: 'syslog_udp', label: 'Syslog UDP' },
  { value: 'syslog_tcp', label: 'Syslog TCP' }
];
const DEFAULT_PLEX_DISPLAY_PREFERENCES = {
  layoutMode: 'standard',
  showPoster: true,
  showBackdrop: true,
  showContext: true,
  showPlayer: true,
  showProgress: true,
  showUpdatedAt: true,
  showPausedSessions: true,
  textScale: 'standard'
};
const INTEGRATION_VISIBLE_FLAGS = new Set(Object.keys(INTEGRATION_FEATURE_LABELS));
const SETTINGS_SECTION_FEATURES = {
  metrics: 'metrics_enabled',
  logs: 'external_log_export_enabled'
};
const SECTION_DESCRIPTIONS = {
  audio: 'Connection details, credentials, and runtime checks for this integration.',
  barcode: 'Connection details, credentials, and runtime checks for this integration.',
  books: 'Connection details, credentials, and runtime checks for this integration.',
  comics: 'Connection details, credentials, and runtime checks for this integration.',
  cwa: 'Connection details, credentials, and runtime checks for this integration.',
  kavita: 'Connection details, credentials, and runtime checks for this integration.',
  ebay: 'Configure eBay Browse as an optional market-signal fallback. Dry-run tests stay local in this milestone and do not hit the live provider.',
  games: 'Connection details, credentials, and runtime checks for this integration.',
  logs: 'Configure external log export and validate the running endpoint.',
  metrics: 'Enable admin-facing metrics export here, while scrape tokens and DEBUG-level access remain runtime infrastructure settings.',
  plex: 'Connection details, credentials, and runtime checks for this integration.',
  pricecharting: 'Configure PriceCharting as the primary queued valuation provider. Dry-run tests confirm identifier-first lookup planning and the serialized rate-limit policy without calling the live API.',
  tmdb: 'Connection details, credentials, and runtime checks for this integration.'
};

function LabeledField({ label, className = '', children, cx }) {
  return (
    <div className={cx('field', className)}>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

function StatusBadge({ status, cx }) {
  const map = { ok: 'badge-ok', configured: 'badge-ok', auth_failed: 'badge-err', error: 'badge-err', missing: 'badge-warn', unknown: 'badge-dim' };
  const labels = { ok: 'Connected', configured: 'Configured', auth_failed: 'Auth Failed', error: 'Error', missing: 'Missing Key', unknown: 'Unknown' };
  return <span className={cx('badge', map[status] || 'badge-dim')}>{labels[status] || 'Unknown'}</span>;
}

function IntegrationFeatureToggle({ feature, disabled, saving, onToggle }) {
  const enabled = Boolean(feature?.enabled);
  return (
    <div className="flex items-start justify-between gap-4 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">
          {INTEGRATION_FEATURE_LABELS[feature.key] || feature.key}
        </p>
        <p className="mt-1 text-sm text-ghost">
          {feature.description || 'No description'}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={`${enabled ? 'Disable' : 'Enable'} ${INTEGRATION_FEATURE_LABELS[feature.key] || feature.key}`}
        disabled={disabled || saving}
        onClick={() => onToggle(feature, !enabled)}
        className={[
          'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-all duration-150',
          'focus:outline-none focus:ring-2 focus:ring-gold/30 focus:ring-offset-2 focus:ring-offset-surface',
          enabled ? 'border-gold/30 bg-gold/15' : 'border-edge bg-raised/80',
          (disabled || saving) ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-muted'
        ].join(' ')}
      >
        <span
          className={[
            'inline-block h-5 w-5 rounded-full transition-transform duration-150 shadow-sm',
            enabled ? 'bg-gold' : 'bg-dim',
            enabled ? 'translate-x-6' : 'translate-x-1'
          ].join(' ')}
        />
      </button>
    </div>
  );
}

function InlineFeatureFlagState({ loading, error, readOnly, feature }) {
  if (loading) {
    return <p className="text-sm text-dim">Loading integration setting…</p>;
  }
  if (error) {
    return <p className="text-sm text-err">{error}</p>;
  }
  if (!feature) {
    return <p className="text-sm text-warn">This integration setting is currently unavailable.</p>;
  }
  if (readOnly) {
    return <p className="text-sm text-warn">This setting is read-only in this environment (`FEATURE_FLAGS_READ_ONLY=true`).</p>;
  }
  return null;
}

function RuntimeCheckRow({ check }) {
  const toneClass = check?.level === 'ok'
    ? 'text-ok'
    : check?.level === 'warn'
      ? 'text-warn'
      : 'text-dim';

  return (
    <li className="grid gap-1 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
      <div>
        <p className={`text-sm font-medium ${toneClass}`}>{check?.title || 'Runtime note'}</p>
      </div>
      <p className="text-sm text-dim">{check?.detail || ''}</p>
    </li>
  );
}

function RuntimeKeyValueList({ rows = [] }) {
  if (!rows.length) return null;
  return (
    <dl className="divide-y divide-edge/60 rounded-md border border-edge/60">
      {rows.map((row) => (
        <div key={row.label} className="grid gap-1 px-4 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
          <dt className="text-sm text-ghost">{row.label}</dt>
          <dd className="text-sm text-ink">
            {row.mono ? <span className="font-mono text-[13px]">{row.value}</span> : row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function DisclosureSection({ title, summary, children, defaultOpen = false }) {
  return (
    <details className="rounded-md border border-edge/60" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-sm">
        <span className="font-medium text-ink">{title}</span>
        <span className="min-w-0 text-right text-dim">{summary}</span>
      </summary>
      <div className="border-t border-edge/60 px-4 py-4 space-y-3">
        {children}
      </div>
    </details>
  );
}

const PLEX_RECONCILIATION_BUCKETS = [
  ['alreadyLinked', 'Linked'],
  ['wouldUpdate', 'Updates'],
  ['wouldCreate', 'Creates'],
  ['conflict', 'Conflicts']
];

function normalizePlexReconciliationResult(result = null) {
  if (!result) return null;
  const summary = result.summary || {};
  const buckets = summary.buckets || result.buckets || {};
  return {
    ...result,
    summary,
    buckets: {
      alreadyLinked: Array.isArray(buckets.alreadyLinked) ? buckets.alreadyLinked : [],
      wouldUpdate: Array.isArray(buckets.wouldUpdate) ? buckets.wouldUpdate : [],
      wouldCreate: Array.isArray(buckets.wouldCreate) ? buckets.wouldCreate : [],
      conflict: Array.isArray(buckets.conflict) ? buckets.conflict : []
    }
  };
}

function PlexReconciliationRow({ row }) {
  const item = row?.item || {};
  const existing = row?.existing || null;
  const title = item.title || existing?.title || 'Untitled Plex item';
  const itemBits = [
    item.media_type,
    item.year,
    item.tmdb_id ? `TMDB ${item.tmdb_id}` : null,
    item.sectionId ? `Section ${item.sectionId}` : null
  ].filter(Boolean);
  const existingBits = existing
    ? [
      existing.title,
      existing.year,
      existing.import_source ? `Source ${existing.import_source}` : null,
      existing.id ? `collectZ #${existing.id}` : null
    ].filter(Boolean)
    : [];

  return (
    <div className="rounded-md border border-edge/70 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-ink">{title}</span>
        {row?.matchedBy && <span className="text-xs text-ghost">{row.matchedBy}</span>}
      </div>
      {itemBits.length > 0 && <p className="mt-1 text-xs text-ghost">{itemBits.join(' · ')}</p>}
      {existingBits.length > 0 && <p className="mt-1 text-xs text-dim">Existing: {existingBits.join(' · ')}</p>}
      {row?.reason && <p className="mt-1 text-xs text-warn">{row.reason}</p>}
    </div>
  );
}

function PlexReconciliationPreview({ result }) {
  const normalized = normalizePlexReconciliationResult(result);
  if (!normalized) return null;
  const summary = normalized.summary || {};
  const autoApplied = summary.autoApplied || {};
  const isSyncResult = summary.processingMode === 'full_library_reconciliation_sync' || normalized.processingMode === 'full_library_reconciliation_sync';

  return (
    <div className="space-y-3">
      {isSyncResult && (
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            ['Created', autoApplied.created],
            ['Updated', autoApplied.updated],
            ['Needs review', summary.conflictReviewCount]
          ].map(([label, value]) => (
            <div key={label} className="rounded-md border border-edge/70 px-3 py-2">
              <p className="text-xs text-ghost">{label}</p>
              <p className="mt-1 text-lg font-semibold text-ink">{Number(value || 0)}</p>
            </div>
          ))}
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ['Scanned', summary.scanned],
          ['Linked', summary.alreadyLinked],
          ['Updates', summary.wouldUpdate],
          ['Creates', summary.wouldCreate],
          ['Conflicts', summary.conflict]
        ].map(([label, value]) => (
          <div key={label} className="rounded-md border border-edge/70 px-3 py-2">
            <p className="text-xs text-ghost">{label}</p>
            <p className="mt-1 text-lg font-semibold text-ink">{Number(value || 0)}</p>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        {(isSyncResult
          ? [['conflictReview', 'Sync Issues']]
          : PLEX_RECONCILIATION_BUCKETS
        ).map(([key, label]) => {
          const rows = key === 'conflictReview' ? (summary.conflictReview || []) : (normalized.buckets[key] || []);
          return (
            <details key={key} className="rounded-md border border-edge/70" open={(key === 'conflict' || key === 'conflictReview') && rows.length > 0}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-3 py-2 text-sm">
                <span className="font-medium text-ink">{label}</span>
                <span className="text-dim">{rows.length}</span>
              </summary>
              <div className="space-y-2 border-t border-edge/70 p-3">
                {rows.length === 0 ? (
                  <p className="text-sm text-dim">No rows in this bucket.</p>
                ) : rows.slice(0, 25).map((row, index) => (
                  <PlexReconciliationRow key={`${key}-${row?.item?.plex_item_key || row?.existing?.id || index}`} row={row} />
                ))}
                {rows.length > 25 && <p className="text-xs text-ghost">Showing 25 of {rows.length} rows.</p>}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

export default function AdminIntegrationsView({
  apiCall,
  onToast,
  onQueueJob,
  Spinner,
  cx,
  section: externalSection,
  onSectionChange,
  endpointBase = '/admin/settings/integrations',
  featureFlagsEndpoint = '/admin/feature-flags',
  title = 'Integrations',
  includeRuntimeSections = true,
  includeValuationSections = false,
  allowImports = true,
  visibleSections = null
}) {
  const allIntegrationSections = useMemo(
    () => ([
      { id: 'audio', label: 'Audio' },
      { id: 'barcode', label: 'Barcode' },
      { id: 'books', label: 'Books' },
      { id: 'cwa', label: 'CWA OPDS' },
      { id: 'comics', label: 'Comics' },
      ...(includeValuationSections ? [
        { id: 'pricecharting', label: 'PriceCharting' },
        { id: 'ebay', label: 'eBay Browse' }
      ] : []),
      { id: 'games', label: 'Games' },
      { id: 'kavita', label: 'Kavita' },
      ...(includeRuntimeSections ? [
        { id: 'logs', label: 'External Logs' },
        { id: 'metrics', label: 'Metrics' }
      ] : []),
      { id: 'plex', label: 'Plex' },
      { id: 'tmdb', label: 'TMDB' }
    ]),
    [includeRuntimeSections, includeValuationSections]
  );
  const integrationSections = useMemo(() => {
    if (!Array.isArray(visibleSections) || visibleSections.length === 0) return allIntegrationSections;
    const allowed = new Set(visibleSections);
    return allIntegrationSections.filter((item) => allowed.has(item.id));
  }, [allIntegrationSections, visibleSections]);
  const [section, setSection] = useState(externalSection || integrationSections[0]?.id || 'logs');
  const [form, setForm] = useState({
    barcodePreset: 'upcitemdb', barcodeProvider: 'upcitemdb', barcodeApiUrl: '', barcodeApiKey: '', clearBarcodeApiKey: false,
    tmdbPreset: 'tmdb', tmdbProvider: 'tmdb', tmdbApiUrl: 'https://api.themoviedb.org/3/search/movie',
    tmdbApiKey: '', clearTmdbApiKey: false,
    plexPreset: 'plex', plexProvider: 'plex', plexApiUrl: '',
    plexApiKey: '', plexLibrarySections: '', clearPlexApiKey: false,
    booksPreset: 'googlebooks', booksProvider: 'googlebooks', booksApiUrl: 'https://www.googleapis.com/books/v1/volumes',
    booksApiKey: '', clearBooksApiKey: false,
    audioPreset: 'discogs', audioProvider: 'discogs', audioApiUrl: 'https://api.discogs.com/database/search',
    audioApiKey: '', clearAudioApiKey: false,
    gamesPreset: 'igdb', gamesProvider: 'igdb', gamesApiUrl: 'https://api.igdb.com/v4/games',
    gamesApiKey: '', gamesClientId: '', gamesClientSecret: '', clearGamesApiKey: false, clearGamesClientSecret: false,
    comicsPreset: 'metron', comicsProvider: 'metron', comicsApiUrl: 'https://metron.cloud/api/issue/',
    comicsApiKey: '', comicsUsername: '', clearComicsApiKey: false,
    kavitaBaseUrl: '', kavitaApiKey: '', clearKavitaApiKey: false, kavitaTimeoutMs: '20000',
    priceChartingEnabled: false, priceChartingApiUrl: 'https://www.pricecharting.com/api', priceChartingApiKey: '', clearPriceChartingApiKey: false, priceChartingRateLimitMs: '1100',
    eBayBrowseEnabled: false, eBayBrowseApiUrl: 'https://api.ebay.com/buy/browse/v1/item_summary/search', eBayBrowseClientId: '', eBayBrowseClientSecret: '', clearEBayBrowseClientSecret: false, eBayBrowseMarketplaceId: 'EBAY_US',
    cwaOpdsUrl: '', cwaUsername: '', cwaPassword: '', clearCwaPassword: false,
    logExportBackend: '', logExportHost: '', logExportPort: '', logExportHostLabel: '', logExportService: '', logExportDebug: false
  });
  const [meta, setMeta] = useState({
    barcodeApiKeySet: false, barcodeApiKeyMasked: '',
    tmdbApiKeySet: false, tmdbApiKeyMasked: '',
    plexApiKeySet: false, plexApiKeyMasked: '',
    booksApiKeySet: false, booksApiKeyMasked: '',
    audioApiKeySet: false, audioApiKeyMasked: '',
    gamesApiKeySet: false, gamesApiKeyMasked: '',
    gamesClientSecretSet: false, gamesClientSecretMasked: '',
    comicsApiKeySet: false, comicsApiKeyMasked: '',
    priceChartingApiKeySet: false, priceChartingApiKeyMasked: '',
    eBayBrowseClientSecretSet: false, eBayBrowseClientSecretMasked: '',
    cwaPasswordSet: false, cwaPasswordMasked: '',
    kavitaApiKeySet: false, kavitaApiKeyMasked: '',
    decryptHealth: { hasWarnings: false, warnings: [], remediation: '' }
  });
  const [status, setStatus] = useState({ barcode: 'unknown', tmdb: 'unknown', plex: 'unknown', books: 'unknown', audio: 'unknown', games: 'unknown', comics: 'unknown', cwa: 'unknown', kavita: 'unknown', pricecharting: 'unknown', ebay: 'unknown' });
  const [testLoading, setTestLoading] = useState('');
  const [testMsg, setTestMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [importingPlex, setImportingPlex] = useState(false);
  const [importingKavita, setImportingKavita] = useState(false);
  const [kavitaChapterFanout, setKavitaChapterFanout] = useState(false);
  const [plexAvailableSections, setPlexAvailableSections] = useState([]);
  const [plexProviders, setPlexProviders] = useState([]);
  const [plexNowPlayingSessions, setPlexNowPlayingSessions] = useState([]);
  const [plexNowPlayingChecked, setPlexNowPlayingChecked] = useState(false);
  const [plexDisplayToken, setPlexDisplayToken] = useState({ enabled: false, createdAt: null, lastUsedAt: null });
  const [plexDisplayLink, setPlexDisplayLink] = useState('');
  const [plexDisplayPreferences, setPlexDisplayPreferences] = useState(DEFAULT_PLEX_DISPLAY_PREFERENCES);
  const [savingPlexDisplayPreferences, setSavingPlexDisplayPreferences] = useState(false);
  const [plexWebhookReceiver, setPlexWebhookReceiver] = useState({ enabled: false, lastReceivedAt: null, lastEvent: null, receiverPath: '/api/plex/webhooks/[token]' });
  const [plexWebhookReceiverLink, setPlexWebhookReceiverLink] = useState('');
  const [plexReconciliationLimit, setPlexReconciliationLimit] = useState('');
  const [plexReconciliationResult, setPlexReconciliationResult] = useState(null);
  const [plexReconciliationJob, setPlexReconciliationJob] = useState(null);
  const [plexReconciliationScheduler, setPlexReconciliationScheduler] = useState(null);
  const [featureFlags, setFeatureFlags] = useState([]);
  const [featureFlagsLoading, setFeatureFlagsLoading] = useState(true);
  const [featureFlagsReadOnly, setFeatureFlagsReadOnly] = useState(false);
  const [featureFlagsError, setFeatureFlagsError] = useState('');
  const [savingFeatureKey, setSavingFeatureKey] = useState('');
  const [observabilityRuntime, setObservabilityRuntime] = useState({ logs: null, metrics: null });
  const [logExportControl, setLogExportControl] = useState(null);

  useEffect(() => {
    if (!externalSection || externalSection === section) return;
    const known = integrationSections.some((item) => item.id === externalSection);
    if (known) setSection(externalSection);
  }, [externalSection, integrationSections, section]);

  useEffect(() => {
    if (integrationSections.some((item) => item.id === section)) return;
    if (integrationSections[0]?.id) setSection(integrationSections[0].id);
  }, [integrationSections, section]);

  const setSectionWithSync = (nextSection) => {
    setSection(nextSection);
    if (typeof onSectionChange === 'function') onSectionChange(nextSection);
  };

  useEffect(() => {
    apiCall('get', endpointBase).then((data) => {
      setForm((f) => ({
        ...f,
        barcodePreset: data.barcodePreset || 'upcitemdb', barcodeProvider: data.barcodeProvider || '', barcodeApiUrl: data.barcodeApiUrl || '',
        tmdbPreset: data.tmdbPreset || 'tmdb', tmdbProvider: data.tmdbProvider || '', tmdbApiUrl: data.tmdbApiUrl || '',
        plexPreset: data.plexPreset || 'plex', plexProvider: data.plexProvider || 'plex', plexApiUrl: data.plexApiUrl || '',
        plexLibrarySections: Array.isArray(data.plexLibrarySections) ? data.plexLibrarySections.join(',') : '',
        booksPreset: data.booksPreset || 'googlebooks', booksProvider: data.booksProvider || 'googlebooks', booksApiUrl: data.booksApiUrl || 'https://www.googleapis.com/books/v1/volumes',
        audioPreset: data.audioPreset || 'discogs', audioProvider: data.audioProvider || 'discogs', audioApiUrl: data.audioApiUrl || 'https://api.discogs.com/database/search',
        gamesPreset: data.gamesPreset || 'igdb', gamesProvider: data.gamesProvider || 'igdb', gamesApiUrl: data.gamesApiUrl || 'https://api.igdb.com/v4/games', gamesClientId: data.gamesClientId || '',
        comicsPreset: data.comicsPreset || 'metron', comicsProvider: data.comicsProvider || 'metron', comicsApiUrl: data.comicsApiUrl || 'https://metron.cloud/api/issue/', comicsUsername: data.comicsUsername || '',
        priceChartingEnabled: Boolean(data.valuationProviders?.pricecharting?.enabled),
        priceChartingApiUrl: data.valuationProviders?.pricecharting?.apiUrl || 'https://www.pricecharting.com/api',
        priceChartingRateLimitMs: String(data.valuationProviders?.pricecharting?.rateLimitMs || '1100'),
        eBayBrowseEnabled: Boolean(data.valuationProviders?.ebayBrowse?.enabled),
        eBayBrowseApiUrl: data.valuationProviders?.ebayBrowse?.apiUrl || 'https://api.ebay.com/buy/browse/v1/item_summary/search',
        eBayBrowseClientId: data.valuationProviders?.ebayBrowse?.clientId || '',
        eBayBrowseMarketplaceId: data.valuationProviders?.ebayBrowse?.marketplaceId || 'EBAY_US',
        cwaOpdsUrl: data.cwaOpdsUrl || '', cwaUsername: data.cwaUsername || '',
        kavitaBaseUrl: data.kavitaBaseUrl || '', kavitaTimeoutMs: String(data.kavitaTimeoutMs || '20000'),
        logExportBackend: data.logExportControl?.stored?.backend || data.logExportControl?.effective?.backend || '',
        logExportHost: data.logExportControl?.stored?.host || data.logExportControl?.effective?.host || '',
        logExportPort: String(data.logExportControl?.stored?.port || data.logExportControl?.effective?.port || ''),
        logExportHostLabel: data.logExportControl?.stored?.hostLabel || data.logExportControl?.effective?.hostLabel || '',
        logExportService: data.logExportControl?.stored?.service || data.logExportControl?.effective?.service || '',
        logExportDebug: Boolean(
          data.logExportControl?.stored?.debugEnabled ?? data.logExportControl?.effective?.debugEnabled ?? false
        )
      }));
      setMeta({
        barcodeApiKeySet: Boolean(data.barcodeApiKeySet), barcodeApiKeyMasked: data.barcodeApiKeyMasked || '',
        tmdbApiKeySet: Boolean(data.tmdbApiKeySet), tmdbApiKeyMasked: data.tmdbApiKeyMasked || '',
        plexApiKeySet: Boolean(data.plexApiKeySet), plexApiKeyMasked: data.plexApiKeyMasked || '',
        booksApiKeySet: Boolean(data.booksApiKeySet), booksApiKeyMasked: data.booksApiKeyMasked || '',
        audioApiKeySet: Boolean(data.audioApiKeySet), audioApiKeyMasked: data.audioApiKeyMasked || '',
        gamesApiKeySet: Boolean(data.gamesApiKeySet), gamesApiKeyMasked: data.gamesApiKeyMasked || '',
        gamesClientSecretSet: Boolean(data.gamesClientSecretSet), gamesClientSecretMasked: data.gamesClientSecretMasked || '',
        comicsApiKeySet: Boolean(data.comicsApiKeySet), comicsApiKeyMasked: data.comicsApiKeyMasked || '',
        priceChartingApiKeySet: Boolean(data.valuationProviders?.pricecharting?.apiKeySet), priceChartingApiKeyMasked: data.valuationProviders?.pricecharting?.apiKeyMasked || '',
        eBayBrowseClientSecretSet: Boolean(data.valuationProviders?.ebayBrowse?.clientSecretSet), eBayBrowseClientSecretMasked: data.valuationProviders?.ebayBrowse?.clientSecretMasked || '',
        cwaPasswordSet: Boolean(data.cwaPasswordSet), cwaPasswordMasked: data.cwaPasswordMasked || '',
        kavitaApiKeySet: Boolean(data.kavitaApiKeySet), kavitaApiKeyMasked: data.kavitaApiKeyMasked || '',
        decryptHealth: data.decryptHealth || { hasWarnings: false, warnings: [], remediation: '' }
      });
      setObservabilityRuntime(data.observabilityRuntime || { logs: null, metrics: null });
      setLogExportControl(data.logExportControl || null);
      setPlexDisplayToken(data.plexNowPlayingDisplayToken || { enabled: false, createdAt: null, lastUsedAt: null });
      setPlexWebhookReceiver(data.plexWebhookReceiver || { enabled: false, lastReceivedAt: null, lastEvent: null, receiverPath: '/api/plex/webhooks/[token]' });
      setPlexDisplayPreferences({
        ...DEFAULT_PLEX_DISPLAY_PREFERENCES,
        ...(data.plexNowPlayingDisplayPreferences || {})
      });
      setStatus({
        barcode: data.barcodeApiKeySet ? 'configured' : 'missing',
        tmdb: data.tmdbApiKeySet ? 'configured' : 'missing',
        plex: data.plexApiKeySet ? 'configured' : 'missing',
        books: data.booksApiKeySet ? 'configured' : 'missing',
        audio: data.audioApiKeySet ? 'configured' : 'missing',
        games: (data.gamesApiKeySet || (data.gamesClientId && data.gamesClientSecretSet)) ? 'configured' : 'missing',
        comics: data.comicsApiKeySet ? 'configured' : 'missing',
        pricecharting: (data.valuationProviders?.pricecharting?.enabled && data.valuationProviders?.pricecharting?.apiKeySet) ? 'configured' : 'missing',
        ebay: (data.valuationProviders?.ebayBrowse?.enabled && data.valuationProviders?.ebayBrowse?.clientSecretSet && data.valuationProviders?.ebayBrowse?.clientId) ? 'configured' : 'missing',
        cwa: data.cwaOpdsUrl ? 'configured' : 'missing',
        kavita: (data.kavitaBaseUrl && data.kavitaApiKeySet) ? 'configured' : 'missing'
      });
    }).catch(() => {});
  }, [apiCall, endpointBase]);

  useEffect(() => {
    if (!includeRuntimeSections) {
      setFeatureFlags([]);
      setFeatureFlagsReadOnly(false);
      setFeatureFlagsError('');
      setFeatureFlagsLoading(false);
      return () => {};
    }
    let active = true;
    setFeatureFlagsLoading(true);
    setFeatureFlagsError('');
    apiCall('get', featureFlagsEndpoint).then((payload) => {
      if (!active) return;
      setFeatureFlags(
        Array.isArray(payload?.flags)
          ? payload.flags.filter((flag) => INTEGRATION_VISIBLE_FLAGS.has(flag?.key))
          : []
      );
      setFeatureFlagsReadOnly(Boolean(payload?.readOnly));
    }).catch((error) => {
      if (!active) return;
      setFeatureFlagsError(error?.response?.data?.error || 'Failed to load integration feature settings');
    }).finally(() => {
      if (active) setFeatureFlagsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [apiCall, featureFlagsEndpoint, includeRuntimeSections]);

  useEffect(() => {
    if (section !== 'plex') return;
    refreshPlexReconciliationScheduler();
  }, [section]);

  const applyBarcodePreset = (p) => setForm((f) => ({ ...f, ...(BARCODE_PRESETS[p] || {}) }));
  const applyComicsPreset = (p) => setForm((f) => ({ ...f, ...(COMICS_PRESETS[p] || {}) }));
  const plexSectionIds = useMemo(
    () => form.plexLibrarySections.split(',').map((v) => v.trim()).filter(Boolean),
    [form.plexLibrarySections]
  );
  const featureFlagMap = useMemo(
    () => new Map(featureFlags.map((feature) => [feature.key, feature])),
    [featureFlags]
  );
  const getSectionStatus = (sectionId) => {
    const featureKey = SETTINGS_SECTION_FEATURES[sectionId];
    if (featureKey) {
      return featureFlagMap.get(featureKey)?.enabled ? 'configured' : 'missing';
    }
    return status[sectionId];
  };

  const togglePlexSection = (id) => {
    const next = new Set(plexSectionIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setForm((f) => ({ ...f, plexLibrarySections: [...next].join(',') }));
  };

  const toggleIntegrationFeature = async (feature, enabled) => {
    if (!feature?.key) return;
    setSavingFeatureKey(feature.key);
    try {
      const updated = await apiCall('patch', `${featureFlagsEndpoint}/${encodeURIComponent(feature.key)}`, { enabled });
      setFeatureFlags((prev) => prev.map((row) => (row.key === updated.key ? updated : row)));
      onToast(`${INTEGRATION_FEATURE_LABELS[feature.key] || feature.key} ${enabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
      onToast(error?.response?.data?.error || 'Failed to update integration feature', 'error');
    } finally {
      setSavingFeatureKey('');
    }
  };

  const saveSection = async (sec) => {
    setSaving(true);
    const payload = {};
    if (sec === 'barcode') Object.assign(payload, { barcodePreset: form.barcodePreset, barcodeProvider: form.barcodeProvider, barcodeApiUrl: form.barcodeApiUrl, clearBarcodeApiKey: form.clearBarcodeApiKey, ...(form.barcodeApiKey && { barcodeApiKey: form.barcodeApiKey }) });
    else if (sec === 'tmdb') Object.assign(payload, { tmdbPreset: form.tmdbPreset, tmdbProvider: form.tmdbProvider, tmdbApiUrl: form.tmdbApiUrl, clearTmdbApiKey: form.clearTmdbApiKey, ...(form.tmdbApiKey && { tmdbApiKey: form.tmdbApiKey }) });
    else if (sec === 'plex') Object.assign(payload, {
      plexPreset: form.plexPreset, plexProvider: form.plexProvider, plexApiUrl: form.plexApiUrl,
      clearPlexApiKey: form.clearPlexApiKey,
      plexLibrarySections: form.plexLibrarySections.split(',').map((v) => v.trim()).filter(Boolean),
      ...(form.plexApiKey && { plexApiKey: form.plexApiKey })
    });
    else if (sec === 'books') Object.assign(payload, {
      booksPreset: form.booksPreset, booksProvider: form.booksProvider, booksApiUrl: form.booksApiUrl,
      clearBooksApiKey: form.clearBooksApiKey, ...(form.booksApiKey && { booksApiKey: form.booksApiKey })
    });
    else if (sec === 'audio') Object.assign(payload, {
      audioPreset: form.audioPreset, audioProvider: form.audioProvider, audioApiUrl: form.audioApiUrl,
      clearAudioApiKey: form.clearAudioApiKey, ...(form.audioApiKey && { audioApiKey: form.audioApiKey })
    });
    else if (sec === 'games') Object.assign(payload, {
      gamesPreset: form.gamesPreset, gamesProvider: form.gamesProvider, gamesApiUrl: form.gamesApiUrl,
      gamesClientId: form.gamesClientId, clearGamesApiKey: form.clearGamesApiKey, clearGamesClientSecret: form.clearGamesClientSecret,
      ...(form.gamesApiKey && { gamesApiKey: form.gamesApiKey }),
      ...(form.gamesClientSecret && { gamesClientSecret: form.gamesClientSecret })
    });
    else if (sec === 'pricecharting') Object.assign(payload, {
      priceChartingEnabled: form.priceChartingEnabled,
      priceChartingApiUrl: form.priceChartingApiUrl,
      priceChartingRateLimitMs: form.priceChartingRateLimitMs,
      clearPriceChartingApiKey: form.clearPriceChartingApiKey,
      ...(form.priceChartingApiKey && { priceChartingApiKey: form.priceChartingApiKey })
    });
    else if (sec === 'ebay') Object.assign(payload, {
      eBayBrowseEnabled: form.eBayBrowseEnabled,
      eBayBrowseApiUrl: form.eBayBrowseApiUrl,
      eBayBrowseClientId: form.eBayBrowseClientId,
      eBayBrowseMarketplaceId: form.eBayBrowseMarketplaceId,
      clearEBayBrowseClientSecret: form.clearEBayBrowseClientSecret,
      ...(form.eBayBrowseClientSecret && { eBayBrowseClientSecret: form.eBayBrowseClientSecret })
    });
    else if (sec === 'comics') Object.assign(payload, {
      comicsPreset: form.comicsPreset, comicsProvider: form.comicsProvider, comicsApiUrl: form.comicsApiUrl,
      comicsUsername: form.comicsUsername, clearComicsApiKey: form.clearComicsApiKey,
      ...(form.comicsApiKey && { comicsApiKey: form.comicsApiKey })
    });
    else if (sec === 'cwa') Object.assign(payload, {
      cwaOpdsUrl: form.cwaOpdsUrl,
      cwaUsername: form.cwaUsername,
      clearCwaPassword: form.clearCwaPassword,
      ...(form.cwaPassword && { cwaPassword: form.cwaPassword })
    });
    else if (sec === 'kavita') Object.assign(payload, {
      kavitaBaseUrl: form.kavitaBaseUrl,
      kavitaTimeoutMs: form.kavitaTimeoutMs,
      clearKavitaApiKey: form.clearKavitaApiKey,
      ...(form.kavitaApiKey && { kavitaApiKey: form.kavitaApiKey })
    });
    else if (sec === 'logs') Object.assign(payload, {
      logExportBackend: form.logExportBackend,
      logExportHost: form.logExportHost,
      logExportPort: form.logExportPort,
      logExportHostLabel: form.logExportHostLabel,
      logExportService: form.logExportService,
      logExportDebug: form.logExportDebug
    });
    try {
      const updated = await apiCall('put', endpointBase, payload);
      setMeta({
        barcodeApiKeySet: Boolean(updated.barcodeApiKeySet), barcodeApiKeyMasked: updated.barcodeApiKeyMasked || '',
        tmdbApiKeySet: Boolean(updated.tmdbApiKeySet), tmdbApiKeyMasked: updated.tmdbApiKeyMasked || '',
        plexApiKeySet: Boolean(updated.plexApiKeySet), plexApiKeyMasked: updated.plexApiKeyMasked || '',
        booksApiKeySet: Boolean(updated.booksApiKeySet), booksApiKeyMasked: updated.booksApiKeyMasked || '',
        audioApiKeySet: Boolean(updated.audioApiKeySet), audioApiKeyMasked: updated.audioApiKeyMasked || '',
        gamesApiKeySet: Boolean(updated.gamesApiKeySet), gamesApiKeyMasked: updated.gamesApiKeyMasked || '',
        gamesClientSecretSet: Boolean(updated.gamesClientSecretSet), gamesClientSecretMasked: updated.gamesClientSecretMasked || '',
        comicsApiKeySet: Boolean(updated.comicsApiKeySet), comicsApiKeyMasked: updated.comicsApiKeyMasked || '',
        priceChartingApiKeySet: Boolean(updated.valuationProviders?.pricecharting?.apiKeySet), priceChartingApiKeyMasked: updated.valuationProviders?.pricecharting?.apiKeyMasked || '',
        eBayBrowseClientSecretSet: Boolean(updated.valuationProviders?.ebayBrowse?.clientSecretSet), eBayBrowseClientSecretMasked: updated.valuationProviders?.ebayBrowse?.clientSecretMasked || '',
        cwaPasswordSet: Boolean(updated.cwaPasswordSet), cwaPasswordMasked: updated.cwaPasswordMasked || '',
        kavitaApiKeySet: Boolean(updated.kavitaApiKeySet), kavitaApiKeyMasked: updated.kavitaApiKeyMasked || '',
        decryptHealth: updated.decryptHealth || { hasWarnings: false, warnings: [], remediation: '' }
      });
      setObservabilityRuntime(updated.observabilityRuntime || { logs: null, metrics: null });
      setLogExportControl(updated.logExportControl || null);
      if (updated.plexNowPlayingDisplayToken) setPlexDisplayToken(updated.plexNowPlayingDisplayToken);
      if (updated.plexWebhookReceiver) setPlexWebhookReceiver(updated.plexWebhookReceiver);
      if (updated.plexNowPlayingDisplayPreferences) {
        setPlexDisplayPreferences({
          ...DEFAULT_PLEX_DISPLAY_PREFERENCES,
          ...updated.plexNowPlayingDisplayPreferences
        });
      }
      setStatus((s) => ({
        ...s,
        [sec]: sec === 'games'
          ? ((updated.gamesApiKeySet || (updated.gamesClientId && updated.gamesClientSecretSet)) ? 'configured' : 'missing')
          : sec === 'pricecharting'
            ? ((updated.valuationProviders?.pricecharting?.enabled && updated.valuationProviders?.pricecharting?.apiKeySet) ? 'configured' : 'missing')
          : sec === 'ebay'
            ? ((updated.valuationProviders?.ebayBrowse?.enabled && updated.valuationProviders?.ebayBrowse?.clientId && updated.valuationProviders?.ebayBrowse?.clientSecretSet) ? 'configured' : 'missing')
          : sec === 'cwa'
            ? (updated.cwaOpdsUrl ? 'configured' : 'missing')
          : sec === 'kavita'
            ? ((updated.kavitaBaseUrl && updated.kavitaApiKeySet) ? 'configured' : 'missing')
          : (updated[`${sec}ApiKeySet`] ? 'configured' : 'missing')
      }));
      setForm((f) => ({
        ...f,
        barcodeApiKey: '', tmdbApiKey: '', plexApiKey: '', booksApiKey: '', audioApiKey: '', gamesApiKey: '', gamesClientSecret: '', comicsApiKey: '', cwaPassword: '', kavitaApiKey: '', priceChartingApiKey: '', eBayBrowseClientSecret: '',
        clearBarcodeApiKey: false, clearTmdbApiKey: false, clearPlexApiKey: false,
        clearBooksApiKey: false, clearAudioApiKey: false, clearGamesApiKey: false, clearGamesClientSecret: false, clearComicsApiKey: false, clearCwaPassword: false, clearKavitaApiKey: false, clearPriceChartingApiKey: false, clearEBayBrowseClientSecret: false
      }));
      if (updated.kavitaBaseUrl !== undefined) {
        setForm((f) => ({
          ...f,
          kavitaBaseUrl: updated.kavitaBaseUrl || '',
          kavitaTimeoutMs: String(updated.kavitaTimeoutMs || f.kavitaTimeoutMs || '20000')
        }));
      }
      if (updated.valuationProviders) {
        setForm((f) => ({
          ...f,
          priceChartingEnabled: Boolean(updated.valuationProviders?.pricecharting?.enabled),
          priceChartingApiUrl: updated.valuationProviders?.pricecharting?.apiUrl || f.priceChartingApiUrl,
          priceChartingRateLimitMs: String(updated.valuationProviders?.pricecharting?.rateLimitMs || f.priceChartingRateLimitMs || '1100'),
          eBayBrowseEnabled: Boolean(updated.valuationProviders?.ebayBrowse?.enabled),
          eBayBrowseApiUrl: updated.valuationProviders?.ebayBrowse?.apiUrl || f.eBayBrowseApiUrl,
          eBayBrowseClientId: updated.valuationProviders?.ebayBrowse?.clientId || '',
          eBayBrowseMarketplaceId: updated.valuationProviders?.ebayBrowse?.marketplaceId || 'EBAY_US'
        }));
      }
      if (updated.logExportControl) {
        setForm((f) => ({
          ...f,
          logExportBackend: updated.logExportControl.stored?.backend || updated.logExportControl.effective?.backend || '',
          logExportHost: updated.logExportControl.stored?.host || updated.logExportControl.effective?.host || '',
          logExportPort: String(updated.logExportControl.stored?.port || updated.logExportControl.effective?.port || ''),
          logExportHostLabel: updated.logExportControl.stored?.hostLabel || updated.logExportControl.effective?.hostLabel || '',
          logExportService: updated.logExportControl.stored?.service || updated.logExportControl.effective?.service || '',
          logExportDebug: Boolean(
            updated.logExportControl.stored?.debugEnabled ?? updated.logExportControl.effective?.debugEnabled ?? false
          )
        }));
      }
      onToast(`${sec.toUpperCase()} settings saved`);
      if (
        allowImports
        && typeof onQueueJob === 'function'
        && sec === 'comics'
        && String(updated.comicsProvider || form.comicsProvider || '').toLowerCase() === 'metron'
        && Boolean(updated.comicsApiKeySet)
      ) {
        try {
          const enqueue = await apiCall('post', '/media/import-comics?async=true', {});
          const jobId = enqueue?.job?.id;
          if (jobId) {
            onQueueJob?.({
              id: jobId,
              provider: 'metron',
              status: enqueue?.job?.status || 'queued',
              progress: enqueue?.job?.progress || null
            });
            setTestMsg(`METRON import queued (job #${jobId})`);
            onToast('Metron collection import started');
          }
        } catch (importErr) {
          onToast(importErr.response?.data?.error || 'Metron import could not be started', 'error');
        }
      }
    } catch (err) {
      onToast(err.response?.data?.error || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const test = async (sec) => {
    setTestLoading(sec);
    setTestMsg('');
    try {
      const payload = sec === 'tmdb'
        ? { title: 'The Matrix', year: '1999' }
        : sec === 'books'
          ? { title: 'Dust', author: 'Hugh Howey' }
          : sec === 'audio'
            ? { title: 'Kind of Blue', artist: 'Miles Davis' }
            : sec === 'games'
              ? { title: 'Halo' }
              : sec === 'pricecharting'
                ? { title: 'Halo', media_type: 'game', upc: '885370541981' }
                : sec === 'ebay'
                  ? { title: 'Halo', media_type: 'game', upc: '885370541981' }
              : sec === 'comics'
                ? { title: 'Batman' }
                : sec === 'logs'
                  ? {
                    logExportBackend: form.logExportBackend,
                    logExportHost: form.logExportHost,
                    logExportPort: form.logExportPort,
                    logExportHostLabel: form.logExportHostLabel,
                    logExportService: form.logExportService,
                    logExportDebug: form.logExportDebug
                  }
                : sec === 'cwa'
                  ? {}
                : sec === 'kavita'
                  ? {
                    kavitaBaseUrl: form.kavitaBaseUrl,
                    kavitaTimeoutMs: form.kavitaTimeoutMs,
                    ...(form.kavitaApiKey && { kavitaApiKey: form.kavitaApiKey })
                  }
              : {};
      const result = await apiCall('post', `${endpointBase}/test-${sec}`, payload);
      if (sec === 'logs') {
        setLogExportControl(result.logExportControl || result.config?.logExportControl || null);
        setObservabilityRuntime(result.observabilityRuntime || result.config?.observabilityRuntime || { logs: null, metrics: null });
        setStatus((s) => ({ ...s, logs: result.ok ? 'ok' : 'missing' }));
        setTestMsg(`LOGS: ${String(result.validation?.status || result.status || 'checked').toUpperCase()} — ${result.detail}`);
      } else {
        setStatus((s) => ({ ...s, [sec]: result.authenticated ? 'ok' : 'auth_failed' }));
        setTestMsg(`${sec.toUpperCase()}: ${result.authenticated ? 'Connected' : 'Auth failed'} — ${result.detail}`);
      }
      if (sec === 'plex') setPlexAvailableSections(Array.isArray(result.sections) ? result.sections : []);
    } catch (err) {
      setTestMsg(err.response?.data?.detail || `${sec} test failed`);
    } finally {
      setTestLoading('');
    }
  };

  const testPlexProviders = async () => {
    setTestLoading('plex-providers');
    setTestMsg('');
    try {
      const result = await apiCall('post', `${endpointBase}/test-plex-providers`, {});
      setStatus((s) => ({ ...s, plex: result.authenticated ? 'ok' : 'auth_failed' }));
      setPlexProviders(Array.isArray(result.providers) ? result.providers : []);
      setTestMsg(`PLEX PROVIDERS: ${result.authenticated ? 'Connected' : 'Auth failed'} — ${result.detail}`);
    } catch (err) {
      setPlexProviders([]);
      setTestMsg(err.response?.data?.detail || 'Plex provider discovery failed');
    } finally {
      setTestLoading('');
    }
  };

  const testPlexNowPlaying = async () => {
    setTestLoading('plex-now-playing');
    setTestMsg('');
    setPlexNowPlayingChecked(false);
    try {
      const result = await apiCall('post', `${endpointBase}/test-plex-now-playing`, {});
      setStatus((s) => ({ ...s, plex: result.authenticated ? 'ok' : 'auth_failed' }));
      setPlexNowPlayingSessions(Array.isArray(result.sessions) ? result.sessions : []);
      setPlexNowPlayingChecked(true);
      setTestMsg(`PLEX NOW PLAYING: ${result.authenticated ? 'Connected' : 'Auth failed'} — ${result.detail}`);
    } catch (err) {
      setPlexNowPlayingSessions([]);
      setPlexNowPlayingChecked(true);
      setTestMsg(err.response?.data?.detail || 'Plex now playing readback failed');
    } finally {
      setTestLoading('');
    }
  };

  const generatePlexDisplayToken = async () => {
    setTestLoading('plex-display-token');
    setTestMsg('');
    try {
      const result = await apiCall('post', '/admin/settings/integrations/plex-now-playing-display-token', {});
      setPlexDisplayToken(result.plexNowPlayingDisplayToken || { enabled: true, createdAt: null, lastUsedAt: null });
      const path = result.displayPath || (result.token ? `/now-playing?token=${encodeURIComponent(result.token)}` : '');
      const link = path ? `${window.location.origin}${path}` : '';
      setPlexDisplayLink(link);
      setTestMsg('PLEX DISPLAY: Display link generated. This is the only time the token is shown.');
      onToast('Plex Now Playing display link generated');
    } catch (err) {
      setTestMsg(err.response?.data?.error || 'Plex display link could not be generated');
    } finally {
      setTestLoading('');
    }
  };

  const revokePlexDisplayToken = async () => {
    setTestLoading('plex-display-token');
    setTestMsg('');
    try {
      const result = await apiCall('delete', '/admin/settings/integrations/plex-now-playing-display-token');
      setPlexDisplayToken(result.plexNowPlayingDisplayToken || { enabled: false, createdAt: null, lastUsedAt: null });
      setPlexDisplayLink('');
      setTestMsg('PLEX DISPLAY: Display link revoked.');
      onToast('Plex Now Playing display link revoked');
    } catch (err) {
      setTestMsg(err.response?.data?.error || 'Plex display link could not be revoked');
    } finally {
      setTestLoading('');
    }
  };

  const generatePlexWebhookReceiverToken = async () => {
    setTestLoading('plex-webhook-receiver-token');
    setTestMsg('');
    try {
      const result = await apiCall('post', '/admin/settings/integrations/plex-webhook-receiver-token', {});
      setPlexWebhookReceiver(result.plexWebhookReceiver || { enabled: true, lastReceivedAt: null, lastEvent: null });
      setPlexWebhookReceiverLink(result.webhookUrl || result.webhookPath || '');
      setTestMsg('PLEX WEBHOOKS: Receiver URL generated. This is the only time the token is shown.');
      onToast('Plex webhook receiver URL generated');
    } catch (err) {
      setTestMsg(err.response?.data?.error || 'Plex webhook receiver URL could not be generated');
    } finally {
      setTestLoading('');
    }
  };

  const revokePlexWebhookReceiverToken = async () => {
    setTestLoading('plex-webhook-receiver-token');
    setTestMsg('');
    try {
      const result = await apiCall('delete', '/admin/settings/integrations/plex-webhook-receiver-token');
      setPlexWebhookReceiver(result.plexWebhookReceiver || { enabled: false, lastReceivedAt: null, lastEvent: null, receiverPath: '/api/plex/webhooks/[token]' });
      setPlexWebhookReceiverLink('');
      setTestMsg('PLEX WEBHOOKS: Receiver URL revoked.');
      onToast('Plex webhook receiver URL revoked');
    } catch (err) {
      setTestMsg(err.response?.data?.error || 'Plex webhook receiver URL could not be revoked');
    } finally {
      setTestLoading('');
    }
  };

  const updatePlexDisplayPreference = (key, value) => {
    setPlexDisplayPreferences((current) => ({
      ...current,
      [key]: value
    }));
  };

  const savePlexDisplayPreferences = async () => {
    setSavingPlexDisplayPreferences(true);
    setTestMsg('');
    try {
      const result = await apiCall('put', '/admin/settings/integrations/plex-now-playing-display-preferences', {
        preferences: plexDisplayPreferences
      });
      setPlexDisplayPreferences({
        ...DEFAULT_PLEX_DISPLAY_PREFERENCES,
        ...(result.plexNowPlayingDisplayPreferences || {})
      });
      setTestMsg('PLEX DISPLAY: Display preferences saved.');
      onToast('Plex Now Playing display preferences saved');
    } catch (err) {
      setTestMsg(err.response?.data?.error || 'Plex display preferences could not be saved');
    } finally {
      setSavingPlexDisplayPreferences(false);
    }
  };

  const runPlexImport = async () => {
    setImportingPlex(true);
    try {
      const enqueue = await apiCall('post', '/media/import-plex?async=true', { sectionIds: plexSectionIds });
      const jobId = enqueue?.job?.id;
      if (!jobId) throw new Error('Missing import job id');
      onQueueJob?.({
        id: jobId,
        provider: 'plex',
        status: enqueue?.job?.status || 'queued',
        progress: enqueue?.job?.progress || null
      });
      setTestMsg(`PLEX import queued (job #${jobId})`);
      onToast('Plex import started');
    } catch (err) {
      onToast(err.response?.data?.error || 'Plex import failed', 'error');
    } finally {
      setImportingPlex(false);
    }
  };

  const buildPlexReconciliationPayload = () => {
    const limit = Number(plexReconciliationLimit);
    return {
      sectionIds: plexSectionIds,
      ...(Number.isFinite(limit) && limit > 0 ? { limit: Math.min(50000, Math.floor(limit)) } : {})
    };
  };

  const refreshPlexReconciliationScheduler = async () => {
    try {
      const result = await apiCall('get', '/media/plex-reconciliation-sync/scheduler');
      setPlexReconciliationScheduler(result);
    } catch (_) {
      setPlexReconciliationScheduler(null);
    }
  };

  const runPlexReconciliationPreview = async () => {
    setTestLoading('plex-reconciliation-preview');
    setTestMsg('');
    setPlexReconciliationJob(null);
    try {
      const result = await apiCall('post', '/media/plex-reconciliation-preview', buildPlexReconciliationPayload());
      setPlexReconciliationResult(normalizePlexReconciliationResult(result));
      setTestMsg(`PLEX RECONCILIATION: preview scanned ${Number(result?.summary?.scanned || 0)} item(s).`);
    } catch (err) {
      setTestMsg(err.response?.data?.error || 'Plex reconciliation preview failed');
    } finally {
      setTestLoading('');
    }
  };

  const runPlexReconciliationPreviewJob = async () => {
    setTestLoading('plex-reconciliation-job');
    setTestMsg('');
    try {
      const queued = await apiCall('post', '/media/plex-reconciliation-preview/run', buildPlexReconciliationPayload());
      const jobId = queued?.job?.id || queued?.id;
      if (!jobId) throw new Error('Missing reconciliation job id');
      setPlexReconciliationJob({ id: jobId, status: queued?.job?.status || 'queued' });
      onQueueJob?.({
        id: jobId,
        provider: 'plex',
        status: queued?.job?.status || 'queued',
        progress: queued?.job?.progress || null
      });

      let latest = null;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 400 : 1000));
        latest = await apiCall('get', `/media/sync-jobs/${jobId}/result`);
        setPlexReconciliationJob({ id: jobId, status: latest?.status || 'unknown' });
        if (latest?.status === 'succeeded' || latest?.status === 'failed') break;
      }

      if (latest?.status === 'succeeded') {
        setPlexReconciliationResult(normalizePlexReconciliationResult(latest));
        setTestMsg(`PLEX RECONCILIATION: preview job #${jobId} scanned ${Number(latest?.summary?.scanned || 0)} item(s).`);
      } else if (latest?.status === 'failed') {
        setTestMsg(latest?.error || `Plex reconciliation preview job #${jobId} failed`);
      } else {
        setTestMsg(`PLEX RECONCILIATION: preview job #${jobId} is still running.`);
      }
    } catch (err) {
      setTestMsg(err.response?.data?.error || err.message || 'Plex reconciliation preview job failed');
    } finally {
      setTestLoading('');
    }
  };

  const runPlexReconciliationSyncJob = async () => {
    setTestLoading('plex-reconciliation-sync');
    setTestMsg('');
    try {
      const queued = await apiCall('post', '/media/plex-reconciliation-sync/run', buildPlexReconciliationPayload());
      const jobId = queued?.job?.id || queued?.id;
      if (!jobId) throw new Error('Missing reconciliation sync job id');
      setPlexReconciliationJob({ id: jobId, status: queued?.job?.status || 'queued' });
      onQueueJob?.({
        id: jobId,
        provider: 'plex',
        status: queued?.job?.status || 'queued',
        progress: queued?.job?.progress || null
      });

      let latest = null;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 500 : 1000));
        latest = await apiCall('get', `/media/sync-jobs/${jobId}/result`);
        setPlexReconciliationJob({ id: jobId, status: latest?.status || 'unknown' });
        if (latest?.status === 'succeeded' || latest?.status === 'failed') break;
      }

      if (latest?.status === 'succeeded') {
        setPlexReconciliationResult(normalizePlexReconciliationResult(latest));
        const summary = latest?.summary || {};
        setTestMsg(`PLEX SYNC: job #${jobId} created ${Number(summary?.autoApplied?.created || 0)}, updated ${Number(summary?.autoApplied?.updated || 0)}, review ${Number(summary?.conflictReviewCount || 0)}.`);
        refreshPlexReconciliationScheduler();
      } else if (latest?.status === 'failed') {
        setTestMsg(latest?.error || `Plex reconciliation sync job #${jobId} failed`);
      } else {
        setTestMsg(`PLEX SYNC: job #${jobId} is still running.`);
      }
    } catch (err) {
      setTestMsg(err.response?.data?.error || err.message || 'Plex reconciliation sync job failed');
    } finally {
      setTestLoading('');
    }
  };

  const runKavitaImport = async () => {
    setImportingKavita(true);
    try {
      const enqueue = await apiCall('post', '/media/import-kavita?async=true', { chapterFanout: kavitaChapterFanout });
      const jobId = enqueue?.job?.id;
      if (!jobId) throw new Error('Missing import job id');
      onQueueJob?.({
        id: jobId,
        provider: 'kavita',
        status: enqueue?.job?.status || 'queued',
        progress: enqueue?.job?.progress || null
      });
      setTestMsg(`KAVITA import queued (job #${jobId})`);
      onToast('Kavita import started');
    } catch (err) {
      onToast(err.response?.data?.error || 'Kavita import failed', 'error');
    } finally {
      setImportingKavita(false);
    }
  };

  const isConfigured = (id) => {
    const currentStatus = getSectionStatus(id);
    return currentStatus === 'configured' || currentStatus === 'ok';
  };
  const activeSectionLabel = integrationSections.find((s) => s.id === section)?.label || section;
  const activeSectionDescription = SECTION_DESCRIPTIONS[section] || SECTION_DESCRIPTIONS.audio;
  const activeSectionStatus = getSectionStatus(section);
  const sectionFeature = SETTINGS_SECTION_FEATURES[section] ? featureFlagMap.get(SETTINGS_SECTION_FEATURES[section]) : null;
  const logsRuntime = observabilityRuntime.logs;
  const metricsRuntime = observabilityRuntime.metrics;
  const logLastValidation = logExportControl?.lastValidation || null;
  const logControlSourceLabel = logExportControl?.source === 'stored'
    ? 'Saved in Platform'
    : logExportControl?.source === 'env_override'
      ? 'Locked by runtime env'
      : 'Using runtime env defaults';
  const logValidationSummary = logLastValidation
    ? `${logLastValidation.status === 'passed' ? 'Passed' : logLastValidation.status === 'warning' ? 'Warning' : 'Failed'} · ${logLastValidation.backend || 'off'}`
    : 'Not yet run';
  const logsRuntimeSummary = logsRuntime
    ? `${logsRuntime.effectiveState === 'ready' ? 'Ready' : logsRuntime.effectiveState === 'attention' ? 'Needs attention' : 'Disabled'} · ${logsRuntime.configSource === 'stored' ? 'Saved in Admin' : logsRuntime.configSource === 'env_override' ? 'Locked by runtime env' : 'Using runtime env defaults'}`
    : '';

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 space-y-6">
      <h1 className="section-title">{title}</h1>

      <div className="md:hidden">
        <label className="label">Integration</label>
        <select className="select mt-1" value={section} onChange={(e) => setSectionWithSync(e.target.value)}>
          {integrationSections.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label} {isConfigured(item.id) ? '✓' : ''}
            </option>
          ))}
        </select>
      </div>

      {meta.decryptHealth?.hasWarnings && (
        <div className="rounded-xl border border-edge bg-raised/70 px-4 py-4">
          <p className="text-sm font-semibold text-ink">Integration key decryption warning</p>
          <p className="text-xs text-dim mt-1">{meta.decryptHealth.remediation || 'Re-enter and save the affected key, or clear it.'}</p>
          <ul className="mt-2 space-y-1">
            {(meta.decryptHealth.warnings || []).map((w, idx) => (
              <li key={`${w.provider || 'integration'}-${idx}`} className="text-xs text-dim font-mono">
                {String(w.provider || 'integration').toUpperCase()}: {w.field || 'secret'} ({w.code || 'warning'})
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-4">
        <div className="hidden md:block">
          <SectionTabs
            tabs={integrationSections}
            activeId={section}
            onChange={setSectionWithSync}
            ariaLabel="Integration sections"
            idBase="integration-sections"
          />
        </div>

        <SectionTabPanel activeId={section} tabKey={section} idBase="integration-sections" className="min-w-0">
        <div className="space-y-4 min-w-0">
        <div className="flex items-center justify-between gap-3 pb-1">
          <div>
            <h2 className="text-sm font-semibold tracking-wide uppercase text-dim">{activeSectionLabel}</h2>
            <p className="mt-1 text-xs text-ghost">{activeSectionDescription}</p>
          </div>
          <StatusBadge status={activeSectionStatus} cx={cx} />
        </div>
        {section === 'barcode' && <>
          <LabeledField label="Preset" cx={cx}><select className="select" value={form.barcodePreset} onChange={(e) => applyBarcodePreset(e.target.value)}>
            <option value="upcitemdb">UPCItemDB</option><option value="barcodelookup">BarcodeLookup</option>
          </select></LabeledField>
          <LabeledField label="API URL" cx={cx}><input className="input" value={form.barcodeApiUrl} onChange={(e) => setForm((f) => ({ ...f, barcodeApiUrl: e.target.value }))} /></LabeledField>
          <LabeledField label={`API Key ${meta.barcodeApiKeySet ? `(set: ${meta.barcodeApiKeyMasked})` : '(not set)'}`} cx={cx}>
            <input className="input font-mono" type="password" placeholder="Enter new key to update" value={form.barcodeApiKey} onChange={(e) => setForm((f) => ({ ...f, barcodeApiKey: e.target.value }))} />
          </LabeledField>
          <CheckboxControl id="clear-barcode-api-key" checked={form.clearBarcodeApiKey} onChange={(e) => setForm((f) => ({ ...f, clearBarcodeApiKey: e.target.checked }))}>
            Clear saved key
          </CheckboxControl>
        </>}

        {section === 'logs' && <>
          <InlineFeatureFlagState
            loading={featureFlagsLoading}
            error={featureFlagsError}
            readOnly={featureFlagsReadOnly}
            feature={sectionFeature}
          />
          {sectionFeature && (
            <IntegrationFeatureToggle
              feature={sectionFeature}
              disabled={featureFlagsReadOnly}
              saving={savingFeatureKey === sectionFeature.key}
              onToggle={toggleIntegrationFeature}
            />
          )}
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4 py-1">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">Debug Mode</p>
                <p className="mt-1 text-sm text-dim">Write extra backend logs while you diagnose export behavior.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={Boolean(form.logExportDebug)}
                aria-label={`${form.logExportDebug ? 'Disable' : 'Enable'} debug mode`}
                disabled={Boolean(logExportControl?.readOnly)}
                onClick={() => setForm((f) => ({ ...f, logExportDebug: !f.logExportDebug }))}
                className={[
                  'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors duration-150',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/30 focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
                  form.logExportDebug ? 'border-gold/30 bg-gold/15' : 'border-edge bg-raised/80',
                  Boolean(logExportControl?.readOnly) ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-muted'
                ].join(' ')}
              >
                <span
                  className={[
                    'inline-block h-5 w-5 rounded-full shadow-sm transition-transform duration-150',
                    form.logExportDebug ? 'translate-x-6 bg-gold' : 'translate-x-1 bg-dim'
                  ].join(' ')}
                />
              </button>
            </div>
            <div className="border-t border-edge pt-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-ink">Settings</p>
                <p className="text-sm text-dim">{logControlSourceLabel}</p>
              </div>
            {logExportControl?.readOnly && (
              <p className="text-sm text-warn">External log endpoint settings are read-only in this environment (`LOG_EXPORT_SETTINGS_READ_ONLY=true`).</p>
            )}
            <div className="grid gap-3 md:grid-cols-3">
              <LabeledField label="Backend / Transport" cx={cx}>
                <select
                  className="select"
                  name="log_export_backend"
                  autoComplete="off"
                  value={form.logExportBackend}
                  disabled={Boolean(logExportControl?.readOnly)}
                  onChange={(e) => setForm((f) => ({ ...f, logExportBackend: e.target.value }))}
                >
                  {LOG_EXPORT_BACKEND_OPTIONS.map((option) => (
                    <option key={option.value || 'runtime-default'} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </LabeledField>
              <LabeledField label="Collector Host" cx={cx}>
                <input
                  className="input font-mono"
                  name="log_export_host"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="graylog"
                  value={form.logExportHost}
                  disabled={Boolean(logExportControl?.readOnly) || !form.logExportBackend}
                  onChange={(e) => setForm((f) => ({ ...f, logExportHost: e.target.value }))}
                />
              </LabeledField>
              <LabeledField label="Collector Port" cx={cx}>
                <input
                  className="input font-mono"
                  name="log_export_port"
                  autoComplete="off"
                  inputMode="numeric"
                  placeholder="12201"
                  value={form.logExportPort}
                  disabled={Boolean(logExportControl?.readOnly) || !form.logExportBackend}
                  onChange={(e) => setForm((f) => ({ ...f, logExportPort: e.target.value.replace(/[^\d]/g, '') }))}
                />
              </LabeledField>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <LabeledField label="Service Label" cx={cx}>
                <input
                  className="input font-mono"
                  name="log_export_service"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="backend"
                  value={form.logExportService}
                  disabled={Boolean(logExportControl?.readOnly)}
                  onChange={(e) => setForm((f) => ({ ...f, logExportService: e.target.value }))}
                />
              </LabeledField>
              <LabeledField label="Host Label" cx={cx}>
                <input
                  className="input font-mono"
                  name="log_export_host_label"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="collectz-backend"
                  value={form.logExportHostLabel}
                  disabled={Boolean(logExportControl?.readOnly)}
                  onChange={(e) => setForm((f) => ({ ...f, logExportHostLabel: e.target.value }))}
                />
              </LabeledField>
            </div>
          </div>
          <div className="border-t border-edge pt-4">
            <DisclosureSection title="Last Validation" summary={logValidationSummary}>
              {logLastValidation ? (
                <>
                  <RuntimeKeyValueList rows={[
                    {
                      label: 'Status',
                      value: logLastValidation.status === 'passed'
                        ? 'Passed'
                        : logLastValidation.status === 'warning'
                          ? 'Warning'
                          : 'Failed'
                    },
                    {
                      label: 'Validated endpoint',
                      value: `${logLastValidation.backend || 'off'} @ ${logLastValidation.host || 'n/a'}:${logLastValidation.port || 'n/a'}`,
                      mono: true
                    },
                    {
                      label: 'Validated at',
                      value: logLastValidation.validatedAt ? new Date(logLastValidation.validatedAt).toLocaleString() : 'Unknown'
                    }
                  ]} />
                  <p className="text-sm text-dim">{logLastValidation.detail}</p>
                </>
              ) : (
                <p className="text-sm text-dim">No validation has been recorded yet for this external log endpoint.</p>
              )}
            </DisclosureSection>
          </div>
          {logsRuntime && (
            <div className="border-t border-edge pt-4">
              <DisclosureSection title="Runtime Checks" summary={logsRuntimeSummary}>
                <RuntimeKeyValueList rows={[
                  { label: 'State', value: logsRuntime.effectiveState === 'ready' ? 'Ready' : logsRuntime.effectiveState === 'attention' ? 'Needs attention' : 'Disabled' },
                  { label: 'Config source', value: logsRuntime.configSource === 'stored' ? 'Saved in Platform' : logsRuntime.configSource === 'env_override' ? 'Locked by runtime env' : 'Using runtime env defaults' },
                  { label: 'Backend', value: logsRuntime.backend, mono: true },
                  { label: 'Collector', value: `${logsRuntime.host}:${logsRuntime.port}`, mono: true },
                  { label: 'Service', value: logsRuntime.service, mono: true },
                  { label: 'Host label', value: logsRuntime.hostLabel, mono: true },
                  { label: 'Debug mode', value: logsRuntime.debugEnabled ? 'On' : 'Off' }
                ]} />
                {(logsRuntime.checks || []).length > 0 ? (
                  <ul className="divide-y divide-edge/60 rounded-md border border-edge/60 px-4">
                    {(logsRuntime.checks || []).map((check) => (
                      <RuntimeCheckRow key={`${check.level}-${check.title}`} check={check} />
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-dim">No active runtime warnings right now.</p>
                )}
              </DisclosureSection>
            </div>
          )}
          </div>
        </>}

        {section === 'metrics' && <>
          <InlineFeatureFlagState
            loading={featureFlagsLoading}
            error={featureFlagsError}
            readOnly={featureFlagsReadOnly}
            feature={sectionFeature}
          />
          {sectionFeature && (
            <IntegrationFeatureToggle
              feature={sectionFeature}
              disabled={featureFlagsReadOnly}
              saving={savingFeatureKey === sectionFeature.key}
              onToggle={toggleIntegrationFeature}
            />
          )}
          <div className="border-t border-edge pt-4 space-y-2">
            <p className="text-sm font-medium text-ink">Available settings</p>
            <ul className="space-y-2 text-sm text-dim">
              <li>Enable or disable admin-facing Prometheus-style metrics export here.</li>
              <li>Metrics still require `DEBUG&gt;=1` at runtime, and `METRICS_SCRAPE_TOKEN` remains the optional infrastructure credential for trusted scrapers.</li>
              <li>This page now owns whether metrics export is active. Environment feature-flag overrides no longer supersede this setting.</li>
            </ul>
          </div>
          {metricsRuntime && (
            <div className="border-t border-edge pt-4 space-y-3">
              <div>
                <h3 className="text-sm font-medium text-ink">Runtime checks</h3>
                <p className="mt-1 text-sm text-ghost">This reads from the running backend container, not just saved settings.</p>
              </div>
              <RuntimeKeyValueList rows={[
                { label: 'State', value: metricsRuntime.effectiveState === 'ready' ? 'Ready' : metricsRuntime.effectiveState === 'attention' ? 'Needs attention' : 'Disabled' },
                { label: 'Endpoint', value: metricsRuntime.endpointPath, mono: true },
                { label: 'DEBUG level', value: String(metricsRuntime.debugLevel), mono: true },
                { label: 'Scrape token', value: metricsRuntime.scrapeTokenConfigured ? 'Configured' : 'Not configured' },
                { label: 'Trust proxy', value: String(metricsRuntime.trustProxy ?? 'unknown'), mono: true }
              ]} />
              <ul className="divide-y divide-edge/60 rounded-md border border-edge/60 px-4">
                {(metricsRuntime.checks || []).map((check) => (
                  <RuntimeCheckRow key={`${check.level}-${check.title}`} check={check} />
                ))}
              </ul>
            </div>
          )}
        </>}

        {section === 'tmdb' && <>
          <LabeledField label="API URL" cx={cx}><input className="input" value={form.tmdbApiUrl} onChange={(e) => setForm((f) => ({ ...f, tmdbApiUrl: e.target.value }))} /></LabeledField>
          <LabeledField label={`API Key ${meta.tmdbApiKeySet ? `(set: ${meta.tmdbApiKeyMasked})` : '(not set)'}`} cx={cx}>
            <input className="input font-mono" type="password" placeholder="Enter new key to update" value={form.tmdbApiKey} onChange={(e) => setForm((f) => ({ ...f, tmdbApiKey: e.target.value }))} />
          </LabeledField>
          <CheckboxControl id="clear-tmdb-api-key" checked={form.clearTmdbApiKey} onChange={(e) => setForm((f) => ({ ...f, clearTmdbApiKey: e.target.checked }))}>
            Clear saved key
          </CheckboxControl>
        </>}

        {section === 'plex' && <>
          <div className="grid gap-3 md:grid-cols-2">
            <LabeledField label="Plex API URL" cx={cx}>
              <input className="input" placeholder="https://plex-host:32400" value={form.plexApiUrl} onChange={(e) => setForm((f) => ({ ...f, plexApiUrl: e.target.value }))} />
            </LabeledField>
            <LabeledField label="Library Section IDs" cx={cx}>
              <input className="input font-mono" placeholder="1,2,5" value={form.plexLibrarySections} onChange={(e) => setForm((f) => ({ ...f, plexLibrarySections: e.target.value }))} />
            </LabeledField>
          </div>
          <div className="text-xs text-ghost">
            Import will use section IDs: <span className="font-mono text-dim">{plexSectionIds.length ? plexSectionIds.join(',') : '(none selected)'}</span>
          </div>
          {plexAvailableSections.length > 0 && (
            <div className="rounded-xl border border-edge bg-raised/60 px-3 py-3 space-y-2">
              <p className="text-xs text-ghost">Detected Plex Libraries</p>
              <div className="space-y-1.5">
                {plexAvailableSections.map((sec) => (
                  <CheckboxControl key={sec.id} id={`plex-section-${sec.id}`} checked={plexSectionIds.includes(String(sec.id))} labelClassName="flex w-full" onChange={() => togglePlexSection(String(sec.id))}>
                    <span className="font-medium text-ink">{sec.title || `Section ${sec.id}`}</span>
                    <span className="text-ghost">({sec.type || 'unknown'})</span>
                    <span className="ml-auto font-mono text-xs text-ghost">#{sec.id}</span>
                  </CheckboxControl>
                ))}
              </div>
            </div>
          )}
          {plexProviders.length > 0 && (
            <div className="rounded-xl border border-edge bg-raised/60 px-3 py-3 space-y-2">
              <p className="text-xs text-ghost">Detected Plex Providers</p>
              <div className="space-y-2">
                {plexProviders.map((provider) => (
                  <div key={`${provider.key || provider.title}-${provider.type || 'provider'}`} className="rounded-md border border-edge/70 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium text-ink">{provider.title || provider.key || 'Plex provider'}</span>
                      {provider.type && <span className="text-xs text-ghost">{provider.type}</span>}
                      {provider.protocol && <span className="text-xs text-ghost">{provider.protocol}</span>}
                    </div>
                    <div className="mt-1 font-mono text-xs text-ghost">{provider.key || provider.identifier || 'no key'}</div>
                    {Array.isArray(provider.featureKeys) && provider.featureKeys.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {provider.featureKeys.map((feature) => (
                          <span key={feature} className="rounded border border-edge/70 px-1.5 py-0.5 text-[11px] text-dim">{feature}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {section === 'plex' && plexNowPlayingChecked && (
            <div className="rounded-xl border border-edge bg-raised/60 px-3 py-3 space-y-2">
              <p className="text-xs text-ghost">Active Plex Sessions</p>
              {plexNowPlayingSessions.length === 0 ? (
                <p className="text-sm text-dim">No active Plex sessions.</p>
              ) : (
                <div className="space-y-2">
                  {plexNowPlayingSessions.map((session) => {
                    const key = session.sessionKey || session.ratingKey || `${session.title}-${session.player?.title || 'player'}`;
                    const progress = Number.isFinite(Number(session.progressPercent)) ? Number(session.progressPercent) : null;
                    const playerBits = [
                      session.player?.state,
                      session.player?.platform,
                      session.player?.title
                    ].filter(Boolean);
                    return (
                      <div key={key} className="rounded-md border border-edge/70 px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="font-medium text-ink">{session.title || 'Unknown title'}</span>
                          {session.type && <span className="text-xs text-ghost">{session.type}</span>}
                          {progress !== null && <span className="text-xs text-ghost">{progress}%</span>}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ghost">
                          {session.grandparentTitle && <span>{session.grandparentTitle}</span>}
                          {session.user?.title && <span>{session.user.title}</span>}
                          {playerBits.length > 0 && <span>{playerBits.join(' · ')}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <div className="rounded-xl border border-edge bg-raised/60 px-3 py-3 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-ink">Now Playing display link</p>
                <p className="mt-1 text-xs text-ghost">
                  {plexDisplayToken.enabled
                    ? `Enabled${plexDisplayToken.lastUsedAt ? ` · last used ${new Date(plexDisplayToken.lastUsedAt).toLocaleString()}` : ''}`
                    : 'No active display link'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={generatePlexDisplayToken} disabled={testLoading === 'plex-display-token'} className="btn-secondary btn-sm">
                  {testLoading === 'plex-display-token' ? <Spinner size={14} /> : (plexDisplayToken.enabled ? 'Regenerate' : 'Generate')}
                </button>
                {plexDisplayToken.enabled && (
                  <button type="button" onClick={revokePlexDisplayToken} disabled={testLoading === 'plex-display-token'} className="btn-secondary btn-sm">
                    Revoke
                  </button>
                )}
              </div>
            </div>
            {plexDisplayLink && (
              <input className="input font-mono text-xs" readOnly value={plexDisplayLink} onFocus={(event) => event.target.select()} />
            )}
          </div>
          <div className="rounded-xl border border-edge bg-raised/60 px-3 py-3 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-ink">Webhook receiver</p>
                <p className="mt-1 text-xs text-ghost">
                  {plexWebhookReceiver.enabled
                    ? `Enabled${plexWebhookReceiver.lastReceivedAt ? ` · last received ${new Date(plexWebhookReceiver.lastReceivedAt).toLocaleString()}` : ''}`
                    : 'No active receiver URL'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={generatePlexWebhookReceiverToken} disabled={testLoading === 'plex-webhook-receiver-token'} className="btn-secondary btn-sm">
                  {testLoading === 'plex-webhook-receiver-token' ? <Spinner size={14} /> : (plexWebhookReceiver.enabled ? 'Regenerate' : 'Generate')}
                </button>
                {plexWebhookReceiver.enabled && (
                  <button type="button" onClick={revokePlexWebhookReceiverToken} disabled={testLoading === 'plex-webhook-receiver-token'} className="btn-secondary btn-sm">
                    Revoke
                  </button>
                )}
              </div>
            </div>
            <div className="grid gap-2 text-xs text-ghost sm:grid-cols-2">
              <span>Mode: {plexWebhookReceiver.processingMode === 'contract_only' ? 'Contract only' : (plexWebhookReceiver.processingMode || 'Read-only')}</span>
              <span>Last event: {plexWebhookReceiver.lastEvent || 'None yet'}</span>
              {plexWebhookReceiver.enabled && (
                <>
                  <span>Token fingerprint: {plexWebhookReceiver.tokenFingerprint || 'Unavailable'}</span>
                  <span>Rotated: {plexWebhookReceiver.lastRotatedAt ? new Date(plexWebhookReceiver.lastRotatedAt).toLocaleString() : 'Never'}</span>
                </>
              )}
            </div>
            {plexWebhookReceiverLink ? (
              <input className="input font-mono text-xs" readOnly value={plexWebhookReceiverLink} onFocus={(event) => event.target.select()} />
            ) : plexWebhookReceiver.enabled && (plexWebhookReceiver.receiverUrlMasked || plexWebhookReceiver.receiverPathMasked) ? (
              <input className="input font-mono text-xs" readOnly value={plexWebhookReceiver.receiverUrlMasked || plexWebhookReceiver.receiverPathMasked} onFocus={(event) => event.target.select()} />
            ) : (
              <input className="input font-mono text-xs" readOnly value={plexWebhookReceiver.receiverUrlTemplate || plexWebhookReceiver.receiverPath || '/api/plex/webhooks/[token]'} onFocus={(event) => event.target.select()} />
            )}
            <p className="text-xs text-ghost">
              {plexWebhookReceiver.enabled && !plexWebhookReceiverLink
                ? 'Existing receiver shown with a masked token. Regenerate if Plex needs the full URL again.'
                : 'Accepts Plex webhook hints for newly added media, watched state, and ratings. Import and writeback actions remain manual until a later slice.'}
            </p>
          </div>
          <div className="rounded-xl border border-edge bg-raised/60 px-3 py-3 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-ink">Plex library sync</p>
                <p className="mt-1 text-xs text-ghost">
                  Creates missing Plex titles and updates strong TMDB matches. Automatic sync uses the same policy; Plex writeback stays manual.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={runPlexReconciliationPreview} disabled={testLoading === 'plex-reconciliation-preview' || testLoading === 'plex-reconciliation-job' || testLoading === 'plex-reconciliation-sync'} className="btn-secondary btn-sm">
                  {testLoading === 'plex-reconciliation-preview' ? <Spinner size={14} /> : 'Preview now'}
                </button>
                <button type="button" onClick={runPlexReconciliationSyncJob} disabled={testLoading === 'plex-reconciliation-preview' || testLoading === 'plex-reconciliation-job' || testLoading === 'plex-reconciliation-sync'} className="btn-primary btn-sm">
                  {testLoading === 'plex-reconciliation-sync' ? <Spinner size={14} /> : 'Sync Plex Library'}
                </button>
                <button type="button" onClick={runPlexReconciliationPreviewJob} disabled={testLoading === 'plex-reconciliation-preview' || testLoading === 'plex-reconciliation-job' || testLoading === 'plex-reconciliation-sync'} className="btn-secondary btn-sm">
                  {testLoading === 'plex-reconciliation-job' ? <Spinner size={14} /> : 'Queue preview'}
                </button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
              <LabeledField label="Scan Limit" cx={cx}>
                <input
                  className="input font-mono"
                  inputMode="numeric"
                  placeholder="All"
                  value={plexReconciliationLimit}
                  onChange={(event) => setPlexReconciliationLimit(event.target.value.replace(/[^\d]/g, '').slice(0, 5))}
                />
              </LabeledField>
              <div className="flex flex-wrap items-end gap-2 pb-1 text-xs text-ghost">
                <span>Sections: <span className="font-mono text-dim">{plexSectionIds.length ? plexSectionIds.join(',') : 'saved defaults'}</span></span>
                <span>
                  Automatic: <span className="font-mono text-dim">
                    {plexReconciliationScheduler?.runtime?.enabled
                      ? `on/${plexReconciliationScheduler.runtime.intervalMinutes}m`
                      : 'off'}
                  </span>
                </span>
                {plexReconciliationScheduler?.state?.lastFinishedAt && (
                  <span>Last auto: {new Date(plexReconciliationScheduler.state.lastFinishedAt).toLocaleString()}</span>
                )}
                {plexReconciliationJob?.id && <span>Job #{plexReconciliationJob.id}: {plexReconciliationJob.status}</span>}
              </div>
            </div>
            <PlexReconciliationPreview result={plexReconciliationResult} />
          </div>
          <div className="rounded-xl border border-edge bg-raised/60 px-3 py-3 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-ink">Now Playing display preferences</p>
                <p className="mt-1 text-xs text-ghost">Controls what the admin view and display link show on the passive Plex screen.</p>
              </div>
              <button type="button" onClick={savePlexDisplayPreferences} disabled={savingPlexDisplayPreferences} className="btn-secondary btn-sm">
                {savingPlexDisplayPreferences ? <Spinner size={14} /> : 'Save display'}
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ['showPoster', 'Poster'],
                ['showBackdrop', 'Backdrop'],
                ['showContext', 'Series / context'],
                ['showPlayer', 'Player'],
                ['showProgress', 'Progress'],
                ['showUpdatedAt', 'Refresh time'],
                ['showPausedSessions', 'Paused sessions']
              ].map(([key, label]) => (
                <CheckboxControl
                  key={key}
                  id={`plex-display-${key}`}
                  checked={Boolean(plexDisplayPreferences[key])}
                  onChange={(event) => updatePlexDisplayPreference(key, event.target.checked)}
                >
                  {label}
                </CheckboxControl>
              ))}
            </div>
            <LabeledField label="Text Scale" cx={cx}>
              <select
                className="select"
                value={plexDisplayPreferences.textScale || 'standard'}
                onChange={(event) => updatePlexDisplayPreference('textScale', event.target.value)}
              >
                <option value="compact">Compact</option>
                <option value="standard">Standard</option>
                <option value="large">Large</option>
              </select>
            </LabeledField>
            <LabeledField label="Display Layout" cx={cx}>
              <select
                className="select"
                value={plexDisplayPreferences.layoutMode || 'standard'}
                onChange={(event) => updatePlexDisplayPreference('layoutMode', event.target.value)}
              >
                <option value="standard">Standard</option>
                <option value="poster_only">Vertical poster only</option>
              </select>
            </LabeledField>
          </div>
          <LabeledField label={`Plex API Key ${meta.plexApiKeySet ? `(set: ${meta.plexApiKeyMasked})` : '(not set)'}`} cx={cx}>
            <input className="input font-mono" type="password" placeholder="Enter new key to update" value={form.plexApiKey} onChange={(e) => setForm((f) => ({ ...f, plexApiKey: e.target.value }))} />
          </LabeledField>
          <CheckboxControl id="clear-plex-api-key" checked={form.clearPlexApiKey} onChange={(e) => setForm((f) => ({ ...f, clearPlexApiKey: e.target.checked }))}>
            Clear saved key
          </CheckboxControl>
        </>}

        {section === 'books' && <>
          <LabeledField label="Books API URL" cx={cx}><input className="input" value={form.booksApiUrl} onChange={(e) => setForm((f) => ({ ...f, booksApiUrl: e.target.value }))} /></LabeledField>
          <LabeledField label={`Books API Key ${meta.booksApiKeySet ? `(set: ${meta.booksApiKeyMasked})` : '(not set)'}`} cx={cx}>
            <input className="input font-mono" type="password" placeholder="Enter new key to update" value={form.booksApiKey} onChange={(e) => setForm((f) => ({ ...f, booksApiKey: e.target.value }))} />
          </LabeledField>
          <CheckboxControl id="clear-books-api-key" checked={form.clearBooksApiKey} onChange={(e) => setForm((f) => ({ ...f, clearBooksApiKey: e.target.checked }))}>
            Clear saved key
          </CheckboxControl>
        </>}

        {section === 'audio' && <>
          <LabeledField label="Audio API URL" cx={cx}><input className="input" value={form.audioApiUrl} onChange={(e) => setForm((f) => ({ ...f, audioApiUrl: e.target.value }))} /></LabeledField>
          <LabeledField label={`Discogs Token ${meta.audioApiKeySet ? `(set: ${meta.audioApiKeyMasked})` : '(not set)'}`} cx={cx}>
            <input className="input font-mono" type="password" placeholder="Enter new key to update" value={form.audioApiKey} onChange={(e) => setForm((f) => ({ ...f, audioApiKey: e.target.value }))} />
          </LabeledField>
          <CheckboxControl id="clear-audio-api-key" checked={form.clearAudioApiKey} onChange={(e) => setForm((f) => ({ ...f, clearAudioApiKey: e.target.checked }))}>
            Clear saved key
          </CheckboxControl>
        </>}

        {section === 'games' && <>
          <LabeledField label="Games API URL" cx={cx}><input className="input" value={form.gamesApiUrl} onChange={(e) => setForm((f) => ({ ...f, gamesApiUrl: e.target.value }))} /></LabeledField>
          <LabeledField label="Games Client ID (IGDB)" cx={cx}><input className="input" value={form.gamesClientId} onChange={(e) => setForm((f) => ({ ...f, gamesClientId: e.target.value }))} /></LabeledField>
          <div className="grid gap-3 md:grid-cols-2">
            <LabeledField label={`Games Client Secret (IGDB) ${meta.gamesClientSecretSet ? `(set: ${meta.gamesClientSecretMasked})` : '(not set)'}`} cx={cx}>
              <input className="input font-mono" type="password" placeholder="Enter client secret to update" value={form.gamesClientSecret} onChange={(e) => setForm((f) => ({ ...f, gamesClientSecret: e.target.value }))} />
            </LabeledField>
            <LabeledField label={`Games API Key ${meta.gamesApiKeySet ? `(set: ${meta.gamesApiKeyMasked})` : '(not set)'}`} cx={cx}>
              <input className="input font-mono" type="password" placeholder="Enter new key to update" value={form.gamesApiKey} onChange={(e) => setForm((f) => ({ ...f, gamesApiKey: e.target.value }))} />
            </LabeledField>
          </div>
        </>}

        {section === 'pricecharting' && <>
          <div className="flex items-start justify-between gap-4 py-1">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">Enable PriceCharting</p>
              <p className="mt-1 text-sm text-dim">Keep this provider optional. The runtime contract for `2.11.0` stays queued, serialized, and identifier-first.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(form.priceChartingEnabled)}
              aria-label={`${form.priceChartingEnabled ? 'Disable' : 'Enable'} PriceCharting`}
              onClick={() => setForm((f) => ({ ...f, priceChartingEnabled: !f.priceChartingEnabled }))}
              className={[
                'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors duration-150',
                form.priceChartingEnabled ? 'border-gold/30 bg-gold/15' : 'border-edge bg-raised/80'
              ].join(' ')}
            >
              <span className={[
                'inline-block h-5 w-5 rounded-full shadow-sm transition-transform duration-150',
                form.priceChartingEnabled ? 'translate-x-6 bg-gold' : 'translate-x-1 bg-dim'
              ].join(' ')} />
            </button>
          </div>
          <LabeledField label="PriceCharting API URL" cx={cx}><input className="input" value={form.priceChartingApiUrl} onChange={(e) => setForm((f) => ({ ...f, priceChartingApiUrl: e.target.value }))} /></LabeledField>
          <div className="grid gap-3 md:grid-cols-2">
            <LabeledField label={`API Key ${meta.priceChartingApiKeySet ? `(set: ${meta.priceChartingApiKeyMasked})` : '(not set)'}`} cx={cx}>
              <input className="input font-mono" type="password" placeholder="Enter new key to update" value={form.priceChartingApiKey} onChange={(e) => setForm((f) => ({ ...f, priceChartingApiKey: e.target.value }))} />
            </LabeledField>
            <LabeledField label="Rate Limit Interval (ms)" cx={cx}>
              <input className="input font-mono" inputMode="numeric" value={form.priceChartingRateLimitMs} onChange={(e) => setForm((f) => ({ ...f, priceChartingRateLimitMs: e.target.value.replace(/[^\d]/g, '') }))} />
            </LabeledField>
          </div>
          <CheckboxControl id="clear-pricecharting-api-key" checked={form.clearPriceChartingApiKey} onChange={(e) => setForm((f) => ({ ...f, clearPriceChartingApiKey: e.target.checked }))}>
            Clear saved key
          </CheckboxControl>
          <div className="rounded-xl border border-edge bg-raised/60 px-4 py-3 text-sm text-dim">
            Automated tests stay on fixtures in this milestone. The live provider should only be smoke-tested manually after the queued execution slice is in place.
          </div>
        </>}

        {section === 'ebay' && <>
          <div className="flex items-start justify-between gap-4 py-1">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">Enable eBay Browse</p>
              <p className="mt-1 text-sm text-dim">Use eBay Browse as a live-market fallback signal once valuation execution is enabled.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(form.eBayBrowseEnabled)}
              aria-label={`${form.eBayBrowseEnabled ? 'Disable' : 'Enable'} eBay Browse`}
              onClick={() => setForm((f) => ({ ...f, eBayBrowseEnabled: !f.eBayBrowseEnabled }))}
              className={[
                'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors duration-150',
                form.eBayBrowseEnabled ? 'border-gold/30 bg-gold/15' : 'border-edge bg-raised/80'
              ].join(' ')}
            >
              <span className={[
                'inline-block h-5 w-5 rounded-full shadow-sm transition-transform duration-150',
                form.eBayBrowseEnabled ? 'translate-x-6 bg-gold' : 'translate-x-1 bg-dim'
              ].join(' ')} />
            </button>
          </div>
          <LabeledField label="eBay Browse API URL" cx={cx}><input className="input" value={form.eBayBrowseApiUrl} onChange={(e) => setForm((f) => ({ ...f, eBayBrowseApiUrl: e.target.value }))} /></LabeledField>
          <div className="grid gap-3 md:grid-cols-2">
            <LabeledField label="Client ID" cx={cx}><input className="input" value={form.eBayBrowseClientId} onChange={(e) => setForm((f) => ({ ...f, eBayBrowseClientId: e.target.value }))} /></LabeledField>
            <LabeledField label="Marketplace ID" cx={cx}><input className="input font-mono" value={form.eBayBrowseMarketplaceId} onChange={(e) => setForm((f) => ({ ...f, eBayBrowseMarketplaceId: e.target.value }))} /></LabeledField>
          </div>
          <LabeledField label={`Client Secret ${meta.eBayBrowseClientSecretSet ? `(set: ${meta.eBayBrowseClientSecretMasked})` : '(not set)'}`} cx={cx}>
            <input className="input font-mono" type="password" placeholder="Enter new client secret to update" value={form.eBayBrowseClientSecret} onChange={(e) => setForm((f) => ({ ...f, eBayBrowseClientSecret: e.target.value }))} />
          </LabeledField>
          <CheckboxControl id="clear-ebay-browse-client-secret" checked={form.clearEBayBrowseClientSecret} onChange={(e) => setForm((f) => ({ ...f, clearEBayBrowseClientSecret: e.target.checked }))}>
            Clear saved client secret
          </CheckboxControl>
        </>}

        {section === 'comics' && <>
          <LabeledField label="Preset" cx={cx}><select className="select" value={form.comicsPreset} onChange={(e) => applyComicsPreset(e.target.value)}>
            <option value="metron">Metron (Basic Auth)</option><option value="gcd">GCD</option><option value="comicvine">ComicVine</option>
          </select></LabeledField>
          <LabeledField label={form.comicsPreset === 'metron' ? 'Metron API URL' : 'Comics API URL'} cx={cx}>
            <input className="input" value={form.comicsApiUrl} onChange={(e) => setForm((f) => ({ ...f, comicsApiUrl: e.target.value }))} />
          </LabeledField>
          {form.comicsPreset === 'metron' ? (
            <div className="grid grid-cols-2 gap-3">
              <LabeledField label="Metron Username" cx={cx}>
                <input className="input" value={form.comicsUsername} onChange={(e) => setForm((f) => ({ ...f, comicsUsername: e.target.value }))} />
              </LabeledField>
              <LabeledField label={`Metron Password ${meta.comicsApiKeySet ? `(set: ${meta.comicsApiKeyMasked})` : '(not set)'}`} cx={cx}>
                <input className="input font-mono" type="password" placeholder="Enter Metron password" value={form.comicsApiKey} onChange={(e) => setForm((f) => ({ ...f, comicsApiKey: e.target.value }))} />
              </LabeledField>
            </div>
          ) : (
            <>
              <LabeledField label="Username (optional)" cx={cx}>
                <input className="input" value={form.comicsUsername} onChange={(e) => setForm((f) => ({ ...f, comicsUsername: e.target.value }))} />
              </LabeledField>
              <LabeledField label={`Comics API Key ${meta.comicsApiKeySet ? `(set: ${meta.comicsApiKeyMasked})` : '(not set)'}`} cx={cx}>
                <input className="input font-mono" type="password" placeholder="Enter new key to update" value={form.comicsApiKey} onChange={(e) => setForm((f) => ({ ...f, comicsApiKey: e.target.value }))} />
              </LabeledField>
            </>
          )}
          <CheckboxControl id="clear-comics-api-key" checked={form.clearComicsApiKey} onChange={(e) => setForm((f) => ({ ...f, clearComicsApiKey: e.target.checked }))}>
            {form.comicsPreset === 'metron' ? 'Clear saved password' : 'Clear saved key'}
          </CheckboxControl>
        </>}

        {section === 'cwa' && <>
          <LabeledField label="OPDS Feed URL" cx={cx}>
            <input className="input" placeholder="https://cwa-host/opds/books" value={form.cwaOpdsUrl} onChange={(e) => setForm((f) => ({ ...f, cwaOpdsUrl: e.target.value }))} />
          </LabeledField>
          <p className="text-xs text-ghost">
            Deep links use the OPDS feed host automatically, so there is no separate base URL to maintain here.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <LabeledField label="Username" cx={cx}>
              <input className="input" value={form.cwaUsername} onChange={(e) => setForm((f) => ({ ...f, cwaUsername: e.target.value }))} />
            </LabeledField>
            <LabeledField label={`Password ${meta.cwaPasswordSet ? `(set: ${meta.cwaPasswordMasked})` : '(not set)'}`} cx={cx}>
              <input className="input font-mono" type="password" placeholder="Enter password to update" value={form.cwaPassword} onChange={(e) => setForm((f) => ({ ...f, cwaPassword: e.target.value }))} />
            </LabeledField>
          </div>
          <CheckboxControl id="clear-cwa-password" checked={form.clearCwaPassword} onChange={(e) => setForm((f) => ({ ...f, clearCwaPassword: e.target.checked }))}>
            Clear saved password
          </CheckboxControl>
        </>}

        {section === 'kavita' && <>
          <LabeledField label="Kavita URL" cx={cx}>
            <input className="input" placeholder="https://kavita.example" value={form.kavitaBaseUrl} onChange={(e) => setForm((f) => ({ ...f, kavitaBaseUrl: e.target.value }))} />
          </LabeledField>
          <div className="grid gap-3 md:grid-cols-2">
            <LabeledField label={`API Key ${meta.kavitaApiKeySet ? `(set: ${meta.kavitaApiKeyMasked})` : '(not set)'}`} cx={cx}>
              <input className="input font-mono" type="password" placeholder="Enter API key to update" value={form.kavitaApiKey} onChange={(e) => setForm((f) => ({ ...f, kavitaApiKey: e.target.value }))} />
            </LabeledField>
            <LabeledField label="Timeout (ms)" cx={cx}>
              <input className="input" inputMode="numeric" value={form.kavitaTimeoutMs} onChange={(e) => setForm((f) => ({ ...f, kavitaTimeoutMs: e.target.value }))} />
            </LabeledField>
          </div>
          <CheckboxControl id="clear-kavita-api-key" checked={form.clearKavitaApiKey} onChange={(e) => setForm((f) => ({ ...f, clearKavitaApiKey: e.target.checked }))}>
            Clear saved API key
          </CheckboxControl>
          <CheckboxControl id="kavita-chapter-fanout" checked={kavitaChapterFanout} onChange={(e) => setKavitaChapterFanout(e.target.checked)}>
            Import comic chapters as issue rows
          </CheckboxControl>
          {form.kavitaBaseUrl && (
            <a className="btn-secondary btn-sm inline-flex w-fit" href={form.kavitaBaseUrl} target="_blank" rel="noreferrer">
              Open Kavita
            </a>
          )}
        </>}

        {!['metrics'].includes(section) && (
          <div className="flex gap-3 pt-2 border-t border-edge">
            {section !== 'logs' && (
              <button onClick={() => test(section)} disabled={testLoading === section} className="btn-secondary btn-sm">
                {testLoading === section ? <Spinner size={14} /> : 'Test'}
              </button>
            )}
            {section === 'logs' && (
              <button onClick={() => test(section)} disabled={testLoading === section} className="btn-secondary btn-sm">
                {testLoading === section ? <Spinner size={14} /> : 'Validate'}
              </button>
            )}
            <button
              onClick={() => saveSection(section)}
              disabled={saving || (section === 'logs' && Boolean(logExportControl?.readOnly))}
              className="btn-primary btn-sm"
            >
              {saving ? <Spinner size={14} /> : `Save ${section.toUpperCase()}`}
            </button>
            {allowImports && section === 'plex' && (
              <button onClick={runPlexImport} disabled={importingPlex} className="btn-secondary btn-sm">
                {importingPlex ? <Spinner size={14} /> : 'Import from Plex'}
              </button>
            )}
            {section === 'plex' && (
              <button onClick={testPlexProviders} disabled={testLoading === 'plex-providers'} className="btn-secondary btn-sm">
                {testLoading === 'plex-providers' ? <Spinner size={14} /> : 'Probe Providers'}
              </button>
            )}
            {section === 'plex' && (
              <button onClick={testPlexNowPlaying} disabled={testLoading === 'plex-now-playing'} className="btn-secondary btn-sm">
                {testLoading === 'plex-now-playing' ? <Spinner size={14} /> : 'Active Sessions'}
              </button>
            )}
            {allowImports && section === 'kavita' && (
              <button onClick={runKavitaImport} disabled={importingKavita} className="btn-secondary btn-sm">
                {importingKavita ? <Spinner size={14} /> : 'Import from Kavita'}
              </button>
            )}
          </div>
        )}
        {testMsg && <p aria-live="polite" className="text-xs text-dim font-mono bg-raised/70 rounded-lg px-3 py-2">{testMsg}</p>}
      </div>
      </SectionTabPanel>
      </div>
    </div>
  );
}
