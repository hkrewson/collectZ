const axios = require('axios');
const { recordProviderRequestEvent } = require('./metrics');

const PLEX_PRESETS = {
  plex: {
    preset: 'plex',
    provider: 'plex',
    apiUrl: '',
    apiKeyQueryParam: 'X-Plex-Token'
  }
};

const PLEX_PMS_MODERNIZATION_CONTRACT = Object.freeze({
  currentMode: 'documented-library-provider-paths',
  nextMode: 'provider-advertised-library-paths',
  providerDiscoveryPath: '/media/providers',
  nowPlayingPath: '/status/sessions',
  libraryProviderIdentifier: 'com.plexapp.plugins.library',
  providerAdvertisedSectionRootPath: '/library/sections/all',
  documentedImportPaths: Object.freeze([
    '/library/sections/all',
    '/library/sections/:sectionId/all',
    '/library/metadata/:ids',
    '/library/metadata/:ids/children',
    '/library/metadata/:ids/allLeaves'
  ]),
  legacyImportPaths: Object.freeze([
    '/library/sections',
    '/library/sections/:sectionId/all',
    '/library/metadata/:ratingKey/children',
    '/library/metadata/:ratingKey/allLeaves'
  ]),
  migrationRules: Object.freeze([
    'Treat /media/providers as capability discovery, not as an item-listing replacement by itself.',
    'Resolve PMS import roots from the official library provider when it advertises documented /library paths.',
    'Keep existing Plex import and duplicate-avoidance behavior on documented library provider paths until provider-advertised roots prove the same repeat-sync behavior in runtime.',
    'Use /library/sections/all when the library provider advertises it, while retaining /library/sections as the compatibility fallback for current Plex installs.',
    'Prefer JSON responses for new PMS API calls while preserving XML parsing for existing import compatibility.',
    'Do not expose Plex tokens, provider URLs, file paths, or raw download locations in browser-visible payloads.'
  ]),
  candidateProofSlices: Object.freeze([
    'Now Playing Viewer provider proof',
    'Plex import provider discovery probe',
    'Plex watch-state sync cadence',
    'Plex webhook and ratings sync contract'
  ])
});

const PLEX_WEBHOOK_AND_RATINGS_CONTRACT = Object.freeze({
  inboundEvents: Object.freeze([
    'library.new',
    'media.scrobble',
    'media.rate'
  ]),
  observedPlaybackEvents: Object.freeze([
    'media.play',
    'media.pause',
    'media.resume',
    'media.stop',
    'playback.started'
  ]),
  metadataReadbackPath: '/library/metadata/:ratingKey',
  ratingWriteback: Object.freeze({
    method: 'PUT',
    path: '/:/rate',
    identifier: 'com.plexapp.plugins.library',
    ratingRange: Object.freeze({ min: 0, max: 10 })
  }),
  watchedStateWriteback: Object.freeze({
    scrobblePath: '/:/scrobble',
    unscrobblePath: '/:/unscrobble',
    status: 'future_explicit_opt_in'
  }),
  rules: Object.freeze([
    'Treat Plex webhooks as event hints; query PMS metadata by ratingKey before mutating collectZ rows.',
    'Use library.new to enqueue or prompt title sync rather than silently changing import behavior.',
    'Use media.scrobble for watched-state readback; keep collectZ-to-Plex watched-state writes as a later explicit opt-in milestone.',
    'Use media.rate to refresh rating readback and prove collectZ-to-Plex rating writeback with PUT /:/rate before adding an apply UI.',
    'Do not expose Plex tokens, provider URLs, file paths, raw payloads, IP addresses, or machine identifiers in browser-visible webhook readback.'
  ])
});

const PLEX_WATCH_STATE_SYNC_CONTRACT = Object.freeze({
  status: 'read_only_contract',
  cadence: Object.freeze({
    defaultIntervalMinutes: 60,
    minimumIntervalMinutes: 15,
    mode: 'future_configurable_scheduler'
  }),
  readPaths: Object.freeze([
    '/library/metadata/:ratingKey',
    '/library/metadata/:ratingKey/allLeaves',
    '/library/sections/:sectionId/all'
  ]),
  supportedStateFields: Object.freeze([
    'ratingKey',
    'type',
    'viewCount',
    'viewedAt',
    'lastViewedAt',
    'viewOffset',
    'duration'
  ]),
  applyBehavior: Object.freeze({
    collectzMutation: 'future_explicit_opt_in',
    plexWriteback: 'future_explicit_opt_in'
  }),
  rules: Object.freeze([
    'Read Plex watched-state fields on a cadence before mutating collectZ rows.',
    'Treat media.scrobble webhooks as hints that a watched-state refresh is useful.',
    'Keep collectZ watched-state mutation and collectZ-to-Plex scrobble writes as later opt-in milestones.',
    'Do not expose Plex tokens, provider URLs, raw file paths, raw payloads, IP addresses, or machine identifiers in watched-state readback.'
  ])
});

const PLEX_WATCHED_STATE_WRITEBACK_CONTRACT = Object.freeze({
  status: 'contract_proof_only',
  identifier: 'com.plexapp.plugins.library',
  method: 'PUT',
  actions: Object.freeze({
    scrobble: Object.freeze({ path: '/:/scrobble', watched: true }),
    unscrobble: Object.freeze({ path: '/:/unscrobble', watched: false })
  }),
  acceptedInput: Object.freeze({
    key: 'Plex ratingKey for the media item',
    uri: 'Future alternative when collectZ stores provider URIs'
  }),
  rules: Object.freeze([
    'Use PUT even though PMS still responds to GET for compatibility.',
    'Require an explicit scrobble or unscrobble action before any Plex mutation.',
    'Send only identifier plus key or uri; never surface Plex token-bearing URLs in evidence.',
    'Keep UI-driven and scheduled watched-state writeback behind a later opt-in implementation milestone.'
  ])
});

const resolvePlexPreset = (presetName = 'plex') =>
  PLEX_PRESETS[presetName] || PLEX_PRESETS.plex;

const parseAttributes = (raw) => {
  const out = {};
  const re = /([A-Za-z0-9_:-]+)=("([^"]*)"|'([^']*)')/g;
  let match = re.exec(raw);
  while (match) {
    out[match[1]] = match[3] ?? match[4] ?? '';
    match = re.exec(raw);
  }
  return out;
};

const parsePlexDirectories = (xml) => {
  if (!xml) return [];
  if (typeof xml === 'object') {
    const dirs = xml?.MediaContainer?.Directory;
    if (Array.isArray(dirs)) return dirs;
    if (dirs && typeof dirs === 'object') return [dirs];
    return [];
  }
  const source = Buffer.isBuffer(xml) ? xml.toString('utf8') : String(xml);
  const dirs = [];
  const re = /<Directory\b([^>]*?)\/?>/gi;
  let match = re.exec(source);
  while (match) {
    dirs.push(parseAttributes(match[1]));
    match = re.exec(source);
  }
  return dirs;
};

const parsePlexVideos = (xml) => {
  if (!xml) return [];
  if (typeof xml === 'object') {
    const metadata = xml?.MediaContainer?.Metadata;
    if (Array.isArray(metadata)) return metadata;
    if (metadata && typeof metadata === 'object') return [metadata];
    const videos = xml?.MediaContainer?.Video;
    if (Array.isArray(videos)) return videos;
    if (videos && typeof videos === 'object') return [videos];
    return [];
  }
  const source = Buffer.isBuffer(xml) ? xml.toString('utf8') : String(xml);
  const videos = [];
  // Plex XML payloads can use either <Video ...> or <Metadata ...>.
  const re = /<(?:Video|Metadata)\b([^>]*?)>/gi;
  let match = re.exec(source);
  while (match) {
    videos.push(parseAttributes(match[1]));
    match = re.exec(source);
  }
  return videos;
};

const parsePlexDirectoriesInSection = (xml) => {
  if (!xml) return [];
  if (typeof xml === 'object') {
    const dirs = xml?.MediaContainer?.Directory;
    if (Array.isArray(dirs)) return dirs;
    if (dirs && typeof dirs === 'object') return [dirs];
    return [];
  }
  const source = Buffer.isBuffer(xml) ? xml.toString('utf8') : String(xml);
  const entries = [];
  const re = /<Directory\b([^>]*?)\/?>/gi;
  let match = re.exec(source);
  while (match) {
    entries.push(parseAttributes(match[1]));
    match = re.exec(source);
  }
  return entries;
};

const asArray = (value) => {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

const parsePlexMediaProviders = (payload) => {
  if (!payload) return [];
  if (typeof payload === 'object' && !Buffer.isBuffer(payload)) {
    const candidates = [
      ...asArray(payload?.MediaContainer?.MediaProvider),
      ...asArray(payload?.MediaContainer?.Provider),
      ...asArray(payload?.MediaProvider),
      ...asArray(payload?.Provider)
    ];
    return candidates.map((provider) => ({ ...provider }));
  }

  const source = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload);
  const providers = [];
  const re = /<(?:MediaProvider|Provider)\b([^>]*?)\/?>/gi;
  let match = re.exec(source);
  while (match) {
    providers.push(parseAttributes(match[1]));
    match = re.exec(source);
  }
  return providers;
};

const normalizePlexMediaProvider = (provider) => {
  if (!provider || typeof provider !== 'object') return null;
  const rawKey = provider.key || provider.identifier || provider.id || provider.uuid || null;
  const key = rawKey ? String(rawKey) : null;
  const title = provider.title || provider.name || provider.displayName || provider.type || null;
  const rawFeatures = [
    ...asArray(provider.Feature),
    ...asArray(provider.features)
  ];
  const features = rawFeatures
    .map((feature) => {
      if (typeof feature === 'string') return feature;
      return feature?.key || feature?.id || feature?.type || feature?.name || null;
    })
    .filter(Boolean)
    .map(String);
  const featureDirectories = rawFeatures.flatMap((feature) => {
    if (!feature || typeof feature !== 'object' || typeof feature === 'string') return [];
    const featureKey = feature.key || feature.id || feature.type || feature.name || null;
    return [
      ...asArray(feature.Directory),
      ...asArray(feature.directories)
    ].map((directory) => normalizePlexProviderFeatureDirectory(directory, featureKey, key)).filter(Boolean);
  });

  return {
    key,
    title: title ? String(title) : (key ? `Provider ${key}` : 'Plex provider'),
    type: provider.type ? String(provider.type) : null,
    protocol: provider.protocol ? String(provider.protocol) : null,
    identifier: provider.identifier ? String(provider.identifier) : null,
    featureKeys: [...new Set(features)].sort(),
    featureDirectories
  };
};

const normalizeProviderBoolean = (value) => {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') return ['1', 'true', 'yes'].includes(value.trim().toLowerCase());
  return false;
};

const sanitizeProviderDirectoryKey = (value) => {
  const key = value ? String(value).trim() : '';
  if (!key) return null;
  if (/^https?:\/\//i.test(key)) return null;
  if (/X-Plex-Token=/i.test(key)) return null;
  return key;
};

const normalizePlexProviderFeatureDirectory = (directory, featureKey, providerKey) => {
  if (!directory || typeof directory !== 'object') return null;
  const key = sanitizeProviderDirectoryKey(directory.key || directory.path || directory.uri);
  if (!key) return null;
  return {
    providerKey: providerKey ? String(providerKey) : null,
    featureKey: featureKey ? String(featureKey) : null,
    key,
    title: directory.title ? String(directory.title) : null,
    type: directory.type ? String(directory.type) : null,
    content: normalizeProviderBoolean(directory.content),
    hubKey: sanitizeProviderDirectoryKey(directory.hubKey),
    identifier: directory.identifier ? String(directory.identifier) : null,
    filter: directory.filter ? String(directory.filter) : null
  };
};

const extractPlexProviderItemListingCandidates = (providers = []) => {
  const candidates = [];
  const seen = new Set();
  for (const provider of asArray(providers)) {
    for (const directory of asArray(provider?.featureDirectories)) {
      const key = sanitizeProviderDirectoryKey(directory?.key);
      if (!key || !key.startsWith('/')) continue;
      const looksLikeItemListing = directory.content === true || /\/library\/sections\/[^/]+\/all(?:$|[?#])/.test(key);
      if (!looksLikeItemListing) continue;
      const uniqueKey = `${provider?.key || ''}:${key}`;
      if (seen.has(uniqueKey)) continue;
      seen.add(uniqueKey);
      candidates.push({
        providerKey: provider?.key || directory.providerKey || null,
        featureKey: directory.featureKey || null,
        key,
        title: directory.title || null,
        type: directory.type || null,
        content: directory.content === true
      });
    }
  }
  return candidates;
};

const choosePlexLibraryProvider = (providers = []) => {
  const normalized = asArray(providers).filter(Boolean);
  return normalized.find((provider) => provider.identifier === PLEX_PMS_MODERNIZATION_CONTRACT.libraryProviderIdentifier)
    || normalized.find((provider) => provider.key === PLEX_PMS_MODERNIZATION_CONTRACT.libraryProviderIdentifier)
    || normalized.find((provider) => String(provider.type || '').toLowerCase() === 'library')
    || null;
};

const providerHasDirectoryKey = (provider, key) => asArray(provider?.featureDirectories)
  .some((directory) => sanitizeProviderDirectoryKey(directory?.key) === key);

const buildPlexProviderAdvertisedImportPathContract = (providers = []) => {
  const libraryProvider = choosePlexLibraryProvider(providers);
  const sectionsRootAdvertised = providerHasDirectoryKey(
    libraryProvider,
    PLEX_PMS_MODERNIZATION_CONTRACT.providerAdvertisedSectionRootPath
  );
  const sectionsRootPath = sectionsRootAdvertised
    ? PLEX_PMS_MODERNIZATION_CONTRACT.providerAdvertisedSectionRootPath
    : '/library/sections';
  return {
    providerDiscoveryPath: PLEX_PMS_MODERNIZATION_CONTRACT.providerDiscoveryPath,
    libraryProviderIdentifier: PLEX_PMS_MODERNIZATION_CONTRACT.libraryProviderIdentifier,
    providerFound: Boolean(libraryProvider),
    providerAdvertisedSectionsRoot: sectionsRootAdvertised,
    importMigrationReady: false,
    sectionsRootPath,
    sectionItemsPathTemplate: '/library/sections/:sectionId/all',
    sectionLeavesPathTemplate: '/library/sections/:sectionId/allLeaves',
    metadataPathTemplate: '/library/metadata/:ids',
    metadataChildrenPathTemplate: '/library/metadata/:ids/children',
    metadataLeavesPathTemplate: '/library/metadata/:ids/allLeaves',
    ratingWritebackPath: PLEX_WEBHOOK_AND_RATINGS_CONTRACT.ratingWriteback.path,
    watchedStateWritebackPaths: {
      scrobble: PLEX_WATCHED_STATE_WRITEBACK_CONTRACT.actions.scrobble.path,
      unscrobble: PLEX_WATCHED_STATE_WRITEBACK_CONTRACT.actions.unscrobble.path
    },
    documentedImportPaths: [...PLEX_PMS_MODERNIZATION_CONTRACT.documentedImportPaths],
    compatibilityFallbacks: ['/library/sections'],
    rules: [
      'Use provider discovery to choose advertised documented PMS library roots.',
      'Do not treat /media/providers as the library item listing endpoint by itself.',
      'Do not change import mutation behavior until runtime parity proves repeat-sync safety.'
    ]
  };
};

const parsePlexSectionsResponse = (payload) => parsePlexDirectories(payload)
  .map((d) => ({
    id: d.key,
    title: d.title || `Section ${d.key}`,
    type: String(d.type || '').trim().toLowerCase() || 'unknown'
  }));

const requestPlexSectionsAtPath = async (config, path) => {
  const response = await plexRequest(config, path);
  if (response.status >= 400) {
    const message = typeof response.data === 'string'
      ? response.data.slice(0, 200)
      : response.data?.error || response.statusText;
    const error = new Error(`Plex sections request failed (${response.status}): ${message}`);
    error.status = response.status;
    error.path = path;
    throw error;
  }
  return parsePlexSectionsResponse(response.data);
};

const resolvePlexSectionsRootPath = async (config) => {
  try {
    const providers = await fetchPlexMediaProviders(config);
    const contract = buildPlexProviderAdvertisedImportPathContract(providers);
    return {
      path: contract.sectionsRootPath,
      source: contract.providerAdvertisedSectionsRoot ? 'provider_advertised' : 'compatibility_fallback',
      providerAdvertised: contract.providerAdvertisedSectionsRoot,
      providerFound: contract.providerFound
    };
  } catch (error) {
    return {
      path: '/library/sections',
      source: 'provider_discovery_failed_fallback',
      providerAdvertised: false,
      providerFound: false,
      discoveryErrorStatus: error?.status || null
    };
  }
};

const fetchPlexSectionsWithResolution = async (config) => {
  const resolution = await resolvePlexSectionsRootPath(config);
  const attemptedPaths = [];
  try {
    attemptedPaths.push(resolution.path);
    return {
      sections: await requestPlexSectionsAtPath(config, resolution.path),
      resolution: {
        ...resolution,
        attemptedPaths,
        fallbackUsed: resolution.path === '/library/sections'
      }
    };
  } catch (error) {
    if (resolution.path === '/library/sections') throw error;
    attemptedPaths.push('/library/sections');
    return {
      sections: await requestPlexSectionsAtPath(config, '/library/sections'),
      resolution: {
        ...resolution,
        path: '/library/sections',
        source: 'provider_advertised_root_failed_fallback',
        attemptedPaths,
        fallbackUsed: true,
        providerRootErrorStatus: error?.status || null
      }
    };
  }
};

const fetchPlexProviderItemRows = async (config, candidates = [], options = {}) => {
  const maxCandidates = Number.isFinite(Number(options.maxCandidates)) ? Math.max(1, Number(options.maxCandidates)) : 3;
  const containerSize = Number.isFinite(Number(options.containerSize)) ? Math.max(1, Number(options.containerSize)) : 5;
  const readbacks = [];
  const items = [];

  for (const candidate of asArray(candidates).slice(0, maxCandidates)) {
    const key = sanitizeProviderDirectoryKey(candidate?.key);
    if (!key || !key.startsWith('/')) continue;
    const response = await plexRequest(config, key, {
      'X-Plex-Container-Start': 0,
      'X-Plex-Container-Size': containerSize
    });
    if (response.status >= 400) {
      const message = typeof response.data === 'string'
        ? response.data.slice(0, 200)
        : response.data?.error || response.statusText;
      readbacks.push({
        key,
        providerKey: candidate?.providerKey || null,
        featureKey: candidate?.featureKey || null,
        type: candidate?.type || null,
        status: response.status,
        ok: false,
        detail: String(message || '').slice(0, 120)
      });
      continue;
    }

    const parsed = [
      ...parsePlexVideos(response.data),
      ...parsePlexDirectoriesInSection(response.data)
    ].filter((entry) => entry.title || entry.originalTitle || entry.grandparentTitle || entry.parentTitle);
    const sectionId = String(key.match(/\/library\/sections\/([^/]+)\/all/)?.[1] || '').trim();
    const normalizedItems = parsed.map((entry) => ({
      candidateKey: key,
      providerKey: candidate?.providerKey || null,
      featureKey: candidate?.featureKey || null,
      candidateType: candidate?.type || null,
      sectionId,
      raw: entry,
      normalized: normalizePlexItem(entry),
      variant: normalizePlexVariant(entry, sectionId)
    }));
    items.push(...normalizedItems);
    readbacks.push({
      key,
      providerKey: candidate?.providerKey || null,
      featureKey: candidate?.featureKey || null,
      type: candidate?.type || null,
      status: response.status,
      ok: true,
      rowCount: normalizedItems.length
    });
  }

  return { readbacks, items };
};

const parsePlexNowPlayingSessions = (payload) => {
  if (!payload) return [];
  if (typeof payload === 'object' && !Buffer.isBuffer(payload)) {
    const metadata = [
      ...asArray(payload?.MediaContainer?.Metadata),
      ...asArray(payload?.MediaContainer?.Video),
      ...asArray(payload?.MediaContainer?.Track),
      ...asArray(payload?.Metadata),
      ...asArray(payload?.Video),
      ...asArray(payload?.Track)
    ];
    return metadata.map((entry) => ({ ...entry }));
  }

  const source = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload);
  const sessions = [];
  const blockRe = /<(Video|Track|Metadata)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/gi;
  let match = blockRe.exec(source);
  while (match) {
    const session = parseAttributes(match[2]);
    const body = match[3] || '';
    const userMatch = body.match(/<User\b([^>]*?)\/?>/i);
    const playerMatch = body.match(/<Player\b([^>]*?)\/?>/i);
    if (userMatch) session.User = parseAttributes(userMatch[1]);
    if (playerMatch) session.Player = parseAttributes(playerMatch[1]);
    sessions.push(session);
    match = blockRe.exec(source);
  }
  return sessions;
};

const firstObject = (value) => {
  const arr = asArray(value);
  const found = arr.find((entry) => entry && typeof entry === 'object');
  return found || null;
};

const toFiniteNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const sanitizePlexRelativeKey = (value) => {
  const raw = String(value || '').trim();
  if (!raw || !raw.startsWith('/') || raw.includes('X-Plex-Token=')) return null;
  return raw;
};

const normalizePlexNowPlayingSession = (session) => {
  if (!session || typeof session !== 'object') return null;
  const user = firstObject(session.User);
  const player = firstObject(session.Player);
  const durationMs = toFiniteNumber(session.duration);
  const viewOffsetMs = toFiniteNumber(session.viewOffset);
  const progressPercent = durationMs && durationMs > 0 && Number.isFinite(viewOffsetMs)
    ? Math.max(0, Math.min(100, Math.round((viewOffsetMs / durationMs) * 100)))
    : null;
  const type = session.type ? String(session.type) : null;
  const grandparentTitle = session.grandparentTitle ? String(session.grandparentTitle) : null;
  const parentTitle = session.parentTitle ? String(session.parentTitle) : null;
  const title = session.title || session.originalTitle || grandparentTitle || parentTitle || null;

  return {
    sessionKey: session.sessionKey ? String(session.sessionKey) : null,
    ratingKey: session.ratingKey ? String(session.ratingKey) : null,
    title: title ? String(title) : 'Unknown title',
    type,
    grandparentTitle,
    parentTitle,
    year: toFiniteNumber(session.year),
    metadataKey: sanitizePlexRelativeKey(session.key),
    thumbKey: sanitizePlexRelativeKey(session.thumb),
    artKey: sanitizePlexRelativeKey(session.art),
    hasQueueItem: Boolean(session.playQueueItemID || session.playQueueID),
    durationMs,
    viewOffsetMs,
    progressPercent,
    user: user?.title || user?.username || user?.id ? {
      title: user.title ? String(user.title) : null,
      username: user.username ? String(user.username) : null,
      id: user.id ? String(user.id) : null
    } : null,
    player: player?.title || player?.product || player?.state || player?.platform ? {
      title: player.title ? String(player.title) : null,
      product: player.product ? String(player.product) : null,
      state: player.state ? String(player.state) : null,
      platform: player.platform ? String(player.platform) : null
    } : null
  };
};

const buildPlexWebhookAndRatingsContract = () => ({
  inboundEvents: [...PLEX_WEBHOOK_AND_RATINGS_CONTRACT.inboundEvents],
  observedPlaybackEvents: [...PLEX_WEBHOOK_AND_RATINGS_CONTRACT.observedPlaybackEvents],
  metadataReadbackPath: PLEX_WEBHOOK_AND_RATINGS_CONTRACT.metadataReadbackPath,
  ratingWriteback: {
    method: PLEX_WEBHOOK_AND_RATINGS_CONTRACT.ratingWriteback.method,
    path: PLEX_WEBHOOK_AND_RATINGS_CONTRACT.ratingWriteback.path,
    identifier: PLEX_WEBHOOK_AND_RATINGS_CONTRACT.ratingWriteback.identifier,
    ratingRange: { ...PLEX_WEBHOOK_AND_RATINGS_CONTRACT.ratingWriteback.ratingRange }
  },
  watchedStateWriteback: { ...PLEX_WEBHOOK_AND_RATINGS_CONTRACT.watchedStateWriteback },
  rules: [...PLEX_WEBHOOK_AND_RATINGS_CONTRACT.rules]
});

const buildPlexWatchStateSyncContract = () => ({
  status: PLEX_WATCH_STATE_SYNC_CONTRACT.status,
  cadence: { ...PLEX_WATCH_STATE_SYNC_CONTRACT.cadence },
  readPaths: [...PLEX_WATCH_STATE_SYNC_CONTRACT.readPaths],
  supportedStateFields: [...PLEX_WATCH_STATE_SYNC_CONTRACT.supportedStateFields],
  applyBehavior: { ...PLEX_WATCH_STATE_SYNC_CONTRACT.applyBehavior },
  rules: [...PLEX_WATCH_STATE_SYNC_CONTRACT.rules]
});

const buildPlexWatchedStateWritebackContract = () => ({
  status: PLEX_WATCHED_STATE_WRITEBACK_CONTRACT.status,
  identifier: PLEX_WATCHED_STATE_WRITEBACK_CONTRACT.identifier,
  method: PLEX_WATCHED_STATE_WRITEBACK_CONTRACT.method,
  actions: Object.fromEntries(
    Object.entries(PLEX_WATCHED_STATE_WRITEBACK_CONTRACT.actions)
      .map(([key, value]) => [key, { ...value }])
  ),
  acceptedInput: { ...PLEX_WATCHED_STATE_WRITEBACK_CONTRACT.acceptedInput },
  rules: [...PLEX_WATCHED_STATE_WRITEBACK_CONTRACT.rules]
});

const normalizePlexWatchedStateEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  const ratingKey = safeString(entry.ratingKey || entry.key);
  if (!ratingKey) return null;
  const durationMs = toFiniteNumber(entry.duration);
  const viewOffsetMs = toFiniteNumber(entry.viewOffset);
  const viewCount = Math.max(0, Math.floor(toFiniteNumber(entry.viewCount) || 0));
  const viewedAtSeconds = toFiniteNumber(entry.lastViewedAt || entry.viewedAt);
  const lastViewedAt = viewedAtSeconds
    ? new Date(viewedAtSeconds * 1000).toISOString()
    : null;
  const progressPercent = durationMs && durationMs > 0 && Number.isFinite(viewOffsetMs)
    ? Math.max(0, Math.min(100, Math.round((viewOffsetMs / durationMs) * 100)))
    : null;
  const watchState = viewCount > 0
    ? 'completed'
    : (progressPercent && progressPercent > 0 ? 'in_progress' : 'unwatched');

  return {
    ratingKey,
    type: safeString(entry.type),
    title: safeString(entry.title || entry.originalTitle || entry.grandparentTitle),
    grandparentTitle: safeString(entry.grandparentTitle),
    parentTitle: safeString(entry.parentTitle),
    parentRatingKey: safeString(entry.parentRatingKey),
    grandparentRatingKey: safeString(entry.grandparentRatingKey),
    librarySectionId: safeString(entry.librarySectionID || entry.librarySectionId),
    seasonNumber: toFiniteNumber(entry.parentIndex),
    episodeNumber: toFiniteNumber(entry.index),
    viewCount,
    lastViewedAt,
    durationMs,
    viewOffsetMs,
    progressPercent,
    watchState,
    source: 'plex'
  };
};

const normalizePlexRatingEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  const ratingKey = safeString(entry.ratingKey || entry.key);
  if (!ratingKey) return null;
  const normalizedRating = toFiniteNumber(entry.userRating);
  const userRating = normalizedRating !== null
    ? Math.max(0, Math.min(10, normalizedRating))
    : null;
  return {
    ratingKey,
    type: safeString(entry.type),
    title: safeString(entry.title || entry.originalTitle || entry.grandparentTitle),
    grandparentTitle: safeString(entry.grandparentTitle),
    parentTitle: safeString(entry.parentTitle),
    parentRatingKey: safeString(entry.parentRatingKey),
    grandparentRatingKey: safeString(entry.grandparentRatingKey),
    librarySectionId: safeString(entry.librarySectionID || entry.librarySectionId),
    userRating,
    source: 'plex'
  };
};

const parsePlexWatchStateEntries = (payload) => [
  ...parsePlexVideos(payload),
  ...parsePlexDirectoriesInSection(payload)
]
  .map(normalizePlexWatchedStateEntry)
  .filter(Boolean);

const parsePlexRatingEntries = (payload) => [
  ...parsePlexVideos(payload),
  ...parsePlexDirectoriesInSection(payload)
]
  .map(normalizePlexRatingEntry)
  .filter(Boolean);

const parsePlexWebhookPayload = (payload) => {
  if (!payload) return null;
  if (typeof payload === 'object' && !Buffer.isBuffer(payload)) {
    if (payload.payload !== undefined) return parsePlexWebhookPayload(payload.payload);
    return payload;
  }
  const source = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload);
  if (!source.trim()) return null;
  try {
    return JSON.parse(source);
  } catch (_error) {
    return null;
  }
};

const safeString = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (/x-plex-token=/i.test(raw)) return null;
  if (/^https?:\/\//i.test(raw)) return null;
  if (/^\/(?:Volumes|mnt|media|storage|data|Users)\//i.test(raw)) return null;
  return raw;
};

const normalizePlexWebhookEvent = (payload) => {
  const eventPayload = parsePlexWebhookPayload(payload);
  if (!eventPayload || typeof eventPayload !== 'object') return null;
  const metadata = eventPayload.Metadata && typeof eventPayload.Metadata === 'object' ? eventPayload.Metadata : {};
  const account = eventPayload.Account && typeof eventPayload.Account === 'object' ? eventPayload.Account : {};
  const server = eventPayload.Server && typeof eventPayload.Server === 'object' ? eventPayload.Server : {};
  const player = eventPayload.Player && typeof eventPayload.Player === 'object' ? eventPayload.Player : {};
  const event = safeString(eventPayload.event);
  if (!event) return null;
  const normalizedRating = toFiniteNumber(metadata.userRating ?? metadata.rating);
  const rating = normalizedRating !== null
    ? Math.max(0, Math.min(10, normalizedRating))
    : null;
  const ratingKey = safeString(metadata.ratingKey || metadata.key);
  const parentRatingKey = safeString(metadata.parentRatingKey);
  const grandparentRatingKey = safeString(metadata.grandparentRatingKey);
  const effectiveRatingKey = ratingKey || parentRatingKey || grandparentRatingKey;

  const action = PLEX_WEBHOOK_AND_RATINGS_CONTRACT.inboundEvents.includes(event)
    ? (event === 'library.new'
      ? 'sync_new_title_hint'
      : (event === 'media.scrobble' ? 'refresh_watched_state' : 'refresh_rating'))
    : (PLEX_WEBHOOK_AND_RATINGS_CONTRACT.observedPlaybackEvents.includes(event) ? 'observe_playback_only' : 'ignore_unknown_event');

  return {
    event,
    supported: PLEX_WEBHOOK_AND_RATINGS_CONTRACT.inboundEvents.includes(event),
    action,
    ratingKey: effectiveRatingKey,
    metadata: {
      type: safeString(metadata.type),
      title: safeString(metadata.title || metadata.originalTitle || metadata.grandparentTitle),
      grandparentTitle: safeString(metadata.grandparentTitle),
      parentTitle: safeString(metadata.parentTitle),
      year: toFiniteNumber(metadata.year),
      librarySectionId: safeString(metadata.librarySectionID || metadata.librarySectionId),
      guid: safeString(metadata.guid),
      userRating: rating
    },
    account: account.title || account.id ? {
      id: safeString(account.id),
      title: safeString(account.title)
    } : null,
    server: server.title || server.uuid ? {
      title: safeString(server.title),
      uuid: server.uuid ? '[redacted]' : null
    } : null,
    player: player.title || player.product || player.platform ? {
      title: safeString(player.title),
      product: safeString(player.product),
      platform: safeString(player.platform)
    } : null,
    metadataReadbackPath: effectiveRatingKey
      ? `/library/metadata/${encodeURIComponent(effectiveRatingKey)}`
      : null
  };
};

const buildPlexRatingWritebackRequest = ({ ratingKey, rating, ratedAt } = {}) => {
  const key = safeString(ratingKey);
  const normalizedRating = toFiniteNumber(rating);
  if (!key) {
    const error = new Error('Plex ratingKey is required for rating writeback');
    error.status = 400;
    throw error;
  }
  if (normalizedRating === null || normalizedRating < 0 || normalizedRating > 10) {
    const error = new Error('Plex rating writeback requires a rating from 0 to 10');
    error.status = 400;
    throw error;
  }
  const params = {
    identifier: PLEX_WEBHOOK_AND_RATINGS_CONTRACT.ratingWriteback.identifier,
    key,
    rating: normalizedRating
  };
  if (ratedAt) {
    const parsed = new Date(ratedAt);
    if (!Number.isNaN(parsed.getTime())) {
      params.ratedAt = Math.floor(parsed.getTime() / 1000);
    }
  }
  return {
    method: PLEX_WEBHOOK_AND_RATINGS_CONTRACT.ratingWriteback.method,
    path: PLEX_WEBHOOK_AND_RATINGS_CONTRACT.ratingWriteback.path,
    params
  };
};

const buildPlexWatchedStateWritebackRequest = ({ ratingKey, uri, action, watched } = {}) => {
  const normalizedAction = safeString(action)?.toLowerCase() || (watched === true ? 'scrobble' : (watched === false ? 'unscrobble' : null));
  const contractAction = normalizedAction ? PLEX_WATCHED_STATE_WRITEBACK_CONTRACT.actions[normalizedAction] : null;
  if (!contractAction) {
    const error = new Error('Plex watched-state writeback requires action scrobble or unscrobble');
    error.status = 400;
    throw error;
  }

  const key = safeString(ratingKey);
  const normalizedUri = safeString(uri);
  if (!key && !normalizedUri) {
    const error = new Error('Plex watched-state writeback requires ratingKey or uri');
    error.status = 400;
    throw error;
  }

  const params = {
    identifier: PLEX_WATCHED_STATE_WRITEBACK_CONTRACT.identifier
  };
  if (key) {
    params.key = key;
  } else {
    params.uri = normalizedUri;
  }

  return {
    method: PLEX_WATCHED_STATE_WRITEBACK_CONTRACT.method,
    path: contractAction.path,
    action: normalizedAction,
    watched: contractAction.watched,
    params
  };
};

const buildPlexPmsModernizationContract = () => ({
  currentMode: PLEX_PMS_MODERNIZATION_CONTRACT.currentMode,
  nextMode: PLEX_PMS_MODERNIZATION_CONTRACT.nextMode,
  providerDiscoveryPath: PLEX_PMS_MODERNIZATION_CONTRACT.providerDiscoveryPath,
  nowPlayingPath: PLEX_PMS_MODERNIZATION_CONTRACT.nowPlayingPath,
  libraryProviderIdentifier: PLEX_PMS_MODERNIZATION_CONTRACT.libraryProviderIdentifier,
  providerAdvertisedSectionRootPath: PLEX_PMS_MODERNIZATION_CONTRACT.providerAdvertisedSectionRootPath,
  documentedImportPaths: [...PLEX_PMS_MODERNIZATION_CONTRACT.documentedImportPaths],
  legacyImportPaths: [...PLEX_PMS_MODERNIZATION_CONTRACT.legacyImportPaths],
  providerAdvertisedImportPathContract: buildPlexProviderAdvertisedImportPathContract(),
  migrationRules: [...PLEX_PMS_MODERNIZATION_CONTRACT.migrationRules],
  candidateProofSlices: [...PLEX_PMS_MODERNIZATION_CONTRACT.candidateProofSlices]
});

const parseTmdbIdFromGuid = (guidRaw) => {
  if (!guidRaw) return null;
  const guid = String(guidRaw);
  const match = guid.match(/tmdb:\/\/(\d+)/i);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isFinite(id) ? id : null;
};

const shouldIncludePlexEntry = (sectionType, entryType) => {
  const normalizedSectionType = String(sectionType || '').trim().toLowerCase();
  const normalizedEntryType = String(entryType || '').trim().toLowerCase();

  // TV imports are series-level; seasons/episodes are hydrated separately.
  if (normalizedSectionType === 'show') {
    return normalizedEntryType === 'show';
  }
  if (normalizedSectionType === 'movie') {
    return !normalizedEntryType || normalizedEntryType === 'movie' || normalizedEntryType === 'video' || normalizedEntryType === 'clip';
  }
  if (normalizedSectionType === 'artist') {
    return normalizedEntryType === 'album';
  }

  if (normalizedEntryType === 'season' || normalizedEntryType === 'episode' || normalizedEntryType === 'track') {
    return false;
  }
  return !normalizedEntryType || normalizedEntryType === 'movie' || normalizedEntryType === 'video' || normalizedEntryType === 'show' || normalizedEntryType === 'album';
};

const normalizePlexItem = (item) => {
  const rawType = String(item.type || '').toLowerCase();
  const isTv = rawType === 'show' || rawType === 'episode';
  const isAudio = rawType === 'artist' || rawType === 'album' || rawType === 'track';
  const seriesTitle = item.grandparentTitle || item.parentTitle || item.title || item.originalTitle || null;
  const seriesRatingKey = item.grandparentRatingKey
    || item.grandparentKey
    || item.parentRatingKey
    || item.parentKey
    || item.ratingKey
    || item.key
    || null;
  const audioTitle = rawType === 'track'
    ? (item.parentTitle || item.grandparentTitle || item.title || item.originalTitle || null)
    : (item.title || item.originalTitle || null);
  const audioArtist = rawType === 'artist'
    ? (item.title || item.artist || null)
    : (item.grandparentTitle || item.parentTitle || item.artist || null);
  const audioAlbum = rawType === 'track'
    ? (item.parentTitle || item.title || null)
    : (rawType === 'album' ? (item.title || null) : null);
  const audioTrackCount = item.leafCount || item.childCount || item.trackCount || item.viewedLeafCount || null;
  const year = item.year ? Number(item.year) : null;
  const runtime = item.duration ? Math.round(Number(item.duration) / 60000) : null;
  const tmdbId = parseTmdbIdFromGuid(item.guid);
  const thumb = item.thumb || item.art || null;
  const posterPath = thumb && String(thumb).startsWith('http') ? thumb : null;
  return {
    title: isAudio ? audioTitle : (isTv ? seriesTitle : (item.title || item.originalTitle || null)),
    media_type: isAudio ? 'audio' : (isTv ? 'tv_series' : 'movie'),
    original_title: item.originalTitle || null,
    year: Number.isFinite(year) ? year : null,
    release_date: item.originallyAvailableAt || null,
    runtime: Number.isFinite(runtime) ? runtime : null,
    overview: item.summary || null,
    director: item.director || null,
    network: isTv ? (item.studio || null) : null,
    season_number: isTv && item.parentIndex ? Number(item.parentIndex) : null,
    rating: item.rating ? Number(item.rating) : null,
    poster_path: posterPath,
    backdrop_path: posterPath,
    tmdb_id: tmdbId,
    tmdb_url: !isAudio && tmdbId ? `https://www.themoviedb.org/${isTv ? 'tv' : 'movie'}/${tmdbId}` : null,
    tmdb_media_type: isAudio ? null : (isTv ? 'tv' : 'movie'),
    format: 'Digital',
    type_details: isAudio ? {
      artist: audioArtist,
      album: audioAlbum,
      track_count: Number.isInteger(Number(audioTrackCount)) && Number(audioTrackCount) > 0 ? Number(audioTrackCount) : null
    } : undefined,
    plex_guid: item.guid ? String(item.guid) : null,
    plex_rating_key: seriesRatingKey ? String(seriesRatingKey) : null
  };
};

const extractEditionFromPath = (filePath) => {
  if (!filePath) return null;
  const raw = String(filePath);
  const match = raw.match(/\{edition-([^}]+)\}/i);
  if (match?.[1]) return match[1];
  return null;
};

const normalizePlexVariant = (item, sectionId) => {
  const rawType = String(item.type || '').toLowerCase();
  const media = Array.isArray(item.Media) ? item.Media[0] : item.Media;
  const part = media?.Part && Array.isArray(media.Part) ? media.Part[0] : media?.Part;
  const seasonNumber = item.parentIndex ? Number(item.parentIndex) : null;
  const tvSeriesKey = item.grandparentRatingKey
    || item.grandparentKey
    || item.parentRatingKey
    || item.parentKey
    || item.ratingKey
    || item.key
    || null;
  const sourceItemKey = rawType === 'episode' && tvSeriesKey && Number.isInteger(seasonNumber)
    ? `${sectionId}:show:${tvSeriesKey}:season:${seasonNumber}`
    : ((item.ratingKey || item.key) ? `${sectionId}:${item.ratingKey || item.key}` : null);
  const sourcePartId = part?.id ? String(part.id) : null;
  const sourceMediaId = media?.id ? String(media.id) : null;
  const filePath = part?.file || null;
  const derivedEdition = Number.isInteger(seasonNumber) && seasonNumber > 0
    ? `Season ${seasonNumber}`
    : null;
  return {
    source: 'plex',
    source_item_key: sourceItemKey,
    source_media_id: sourceMediaId,
    source_part_id: rawType === 'episode' ? null : sourcePartId,
    season_number: Number.isInteger(seasonNumber) && seasonNumber > 0 ? seasonNumber : null,
    edition: derivedEdition || extractEditionFromPath(filePath),
    file_path: filePath,
    container: media?.container || part?.container || null,
    video_codec: media?.videoCodec || null,
    audio_codec: media?.audioCodec || null,
    resolution: media?.videoResolution || (media?.width && media?.height ? `${media.width}x${media.height}` : null),
    video_width: media?.width ? Number(media.width) : null,
    video_height: media?.height ? Number(media.height) : null,
    audio_channels: media?.audioChannels ? Number(media.audioChannels) : null,
    duration_ms: media?.duration ? Number(media.duration) : null,
    runtime_minutes: media?.duration ? Math.round(Number(media.duration) / 60000) : null,
    raw_json: media ? { ratingKey: item.ratingKey || null, media, part } : null
  };
};

const plexRequest = async (config, path, params = {}, options = {}) => {
  const urlBase = String(config.plexApiUrl || '').replace(/\/+$/, '');
  const queryParam = config.plexApiKeyQueryParam || 'X-Plex-Token';
  const reqParams = { ...params, [queryParam]: config.plexApiKey };
  try {
    const response = await axios.request({
      method: options.method || 'GET',
      url: `${urlBase}${path}`,
      params: reqParams,
      headers: {
        Accept: 'application/json'
      },
      timeout: 25000,
      responseType: options.responseType || 'json',
      validateStatus: () => true
    });
    const status = Number(response?.status || 0);
    const outcome = status >= 400 ? `http_${status}` : 'success';
    recordProviderRequestEvent('plex', path, outcome);
    return response;
  } catch (error) {
    const outcome = error?.response?.status ? `http_${error.response.status}` : 'error';
    recordProviderRequestEvent('plex', path, outcome);
    throw error;
  }
};

const sendPlexWatchedStateWriteback = async (config, options = {}) => {
  const request = buildPlexWatchedStateWritebackRequest(options);
  const response = await plexRequest(config, request.path, request.params, { method: request.method });
  if (response.status >= 400) {
    const message = typeof response.data === 'string'
      ? response.data.slice(0, 200)
      : response.data?.error || response.statusText;
    throw new Error(`Plex watched-state writeback ${request.action} failed (${response.status}): ${message}`);
  }
  return {
    ok: true,
    provider: 'plex',
    processingMode: 'watched_state_writeback_contract',
    request: {
      method: request.method,
      path: request.path,
      action: request.action,
      watched: request.watched,
      hasKey: Boolean(request.params.key),
      hasUri: Boolean(request.params.uri),
      identifier: request.params.identifier
    },
    status: response.status
  };
};

const sendPlexRatingWriteback = async (config, options = {}) => {
  const request = buildPlexRatingWritebackRequest(options);
  const response = await plexRequest(config, request.path, request.params, { method: request.method });
  if (response.status >= 400) {
    const message = typeof response.data === 'string'
      ? response.data.slice(0, 200)
      : response.data?.error || response.statusText;
    throw new Error(`Plex rating writeback failed (${response.status}): ${message}`);
  }
  return {
    ok: true,
    provider: 'plex',
    processingMode: 'rating_writeback',
    request: {
      method: request.method,
      path: request.path,
      rating: request.params.rating,
      hasKey: Boolean(request.params.key),
      hasRatedAt: Boolean(request.params.ratedAt),
      identifier: request.params.identifier
    },
    status: response.status
  };
};

const fetchPlexMediaProviders = async (config) => {
  const response = await plexRequest(config, PLEX_PMS_MODERNIZATION_CONTRACT.providerDiscoveryPath);
  if (response.status >= 400) {
    const message = typeof response.data === 'string'
      ? response.data.slice(0, 200)
      : response.data?.error || response.statusText;
    throw new Error(`Plex media providers request failed (${response.status}): ${message}`);
  }
  return parsePlexMediaProviders(response.data)
    .map(normalizePlexMediaProvider)
    .filter(Boolean);
};

const fetchPlexSections = async (config) => {
  const { sections } = await fetchPlexSectionsWithResolution(config);
  return sections;
};

const fetchPlexNowPlayingSessions = async (config) => {
  const response = await plexRequest(config, PLEX_PMS_MODERNIZATION_CONTRACT.nowPlayingPath);
  if (response.status >= 400) {
    const message = typeof response.data === 'string'
      ? response.data.slice(0, 200)
      : response.data?.error || response.statusText;
    throw new Error(`Plex now playing request failed (${response.status}): ${message}`);
  }
  return parsePlexNowPlayingSessions(response.data)
    .map(normalizePlexNowPlayingSession)
    .filter(Boolean);
};

const fetchPlexWatchStateSnapshot = async (config, options = {}) => {
  const ratingKeys = [...new Set(asArray(options.ratingKeys).map((key) => String(key || '').trim()).filter(Boolean))];
  const sectionIds = [...new Set(asArray(options.sectionIds).map((key) => String(key || '').trim()).filter(Boolean))];
  const entries = [];
  const readbacks = [];

  for (const ratingKey of ratingKeys) {
    const path = `/library/metadata/${encodeURIComponent(ratingKey)}`;
    const response = await plexRequest(config, path);
    if (response.status >= 400) {
      const message = typeof response.data === 'string'
        ? response.data.slice(0, 200)
        : response.data?.error || response.statusText;
      throw new Error(`Plex watched-state metadata ${ratingKey} failed (${response.status}): ${message}`);
    }
    const parsed = parsePlexWatchStateEntries(response.data);
    entries.push(...parsed);
    readbacks.push({ pathTemplate: '/library/metadata/:ratingKey', ratingKey, entryCount: parsed.length });
  }

  for (const ratingKey of asArray(options.leafRatingKeys).map((key) => String(key || '').trim()).filter(Boolean)) {
    const path = `/library/metadata/${encodeURIComponent(ratingKey)}/allLeaves`;
    const response = await plexRequest(config, path);
    if (response.status >= 400) {
      const message = typeof response.data === 'string'
        ? response.data.slice(0, 200)
        : response.data?.error || response.statusText;
      throw new Error(`Plex watched-state leaves ${ratingKey} failed (${response.status}): ${message}`);
    }
    const parsed = parsePlexWatchStateEntries(response.data);
    entries.push(...parsed);
    readbacks.push({ pathTemplate: '/library/metadata/:ratingKey/allLeaves', ratingKey, entryCount: parsed.length });
  }

  for (const sectionId of sectionIds) {
    const path = `/library/sections/${encodeURIComponent(sectionId)}/all`;
    const response = await plexRequest(config, path);
    if (response.status >= 400) {
      const message = typeof response.data === 'string'
        ? response.data.slice(0, 200)
        : response.data?.error || response.statusText;
      throw new Error(`Plex watched-state section ${sectionId} failed (${response.status}): ${message}`);
    }
    const parsed = parsePlexWatchStateEntries(response.data);
    entries.push(...parsed);
    readbacks.push({ pathTemplate: '/library/sections/:sectionId/all', sectionId, entryCount: parsed.length });
  }

  return {
    contract: buildPlexWatchStateSyncContract(),
    readbacks,
    entries
  };
};

const fetchPlexRatingSnapshot = async (config, options = {}) => {
  const ratingKeys = [...new Set(asArray(options.ratingKeys).map((key) => String(key || '').trim()).filter(Boolean))];
  const sectionIds = [...new Set(asArray(options.sectionIds).map((key) => String(key || '').trim()).filter(Boolean))];
  const entries = [];
  const readbacks = [];

  for (const ratingKey of ratingKeys) {
    const path = `/library/metadata/${encodeURIComponent(ratingKey)}`;
    const response = await plexRequest(config, path);
    if (response.status >= 400) {
      const message = typeof response.data === 'string'
        ? response.data.slice(0, 200)
        : response.data?.error || response.statusText;
      throw new Error(`Plex rating metadata ${ratingKey} failed (${response.status}): ${message}`);
    }
    const parsed = parsePlexRatingEntries(response.data);
    entries.push(...parsed);
    readbacks.push({ pathTemplate: '/library/metadata/:ratingKey', ratingKey, entryCount: parsed.length });
  }

  for (const sectionId of sectionIds) {
    const path = `/library/sections/${encodeURIComponent(sectionId)}/all`;
    const response = await plexRequest(config, path);
    if (response.status >= 400) {
      const message = typeof response.data === 'string'
        ? response.data.slice(0, 200)
        : response.data?.error || response.statusText;
      throw new Error(`Plex rating section ${sectionId} failed (${response.status}): ${message}`);
    }
    const parsed = parsePlexRatingEntries(response.data);
    entries.push(...parsed);
    readbacks.push({ pathTemplate: '/library/sections/:sectionId/all', sectionId, entryCount: parsed.length });
  }

  return {
    contract: buildPlexWebhookAndRatingsContract(),
    readbacks,
    entries
  };
};

const fetchPlexImageAsset = async (config, key) => {
  const imageKey = sanitizePlexRelativeKey(key);
  if (!imageKey) {
    const error = new Error('Plex image key is not available');
    error.status = 400;
    throw error;
  }
  const response = await plexRequest(config, imageKey, {}, { responseType: 'arraybuffer' });
  if (response.status >= 400) {
    const error = new Error(`Plex image request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return {
    body: Buffer.from(response.data || []),
    contentType: String(response.headers?.['content-type'] || 'image/jpeg').split(';')[0].trim() || 'image/jpeg'
  };
};

const fetchPlexLibraryItems = async (config, sectionIds = []) => {
  const sections = sectionIds.length > 0 ? sectionIds : (config.plexLibrarySections || []);
  const uniqueSections = [...new Set(sections.map(String).filter(Boolean))];
  let sectionTypeMap;
  try {
    const discovered = await fetchPlexSections(config);
    sectionTypeMap = new Map(
      discovered.map((section) => [String(section.id), String(section.type || '').toLowerCase()])
    );
  } catch (_error) {
    sectionTypeMap = new Map();
  }
  const items = [];

  for (const sectionId of uniqueSections) {
    const sectionType = sectionTypeMap.get(String(sectionId)) || '';
    const response = await plexRequest(config, `/library/sections/${sectionId}/all`);
    if (response.status >= 400) {
      const message = typeof response.data === 'string'
        ? response.data.slice(0, 200)
        : response.data?.error || response.statusText;
      throw new Error(`Plex section ${sectionId} failed (${response.status}): ${message}`);
    }
    const videos = parsePlexVideos(response.data);
    const directories = parsePlexDirectoriesInSection(response.data);
    const candidates = [...videos, ...directories]
      .filter((entry) => entry.title || entry.originalTitle)
      .filter((entry) => shouldIncludePlexEntry(sectionType, entry.type));

    for (const video of candidates) {
      items.push({
        sectionId: String(sectionId),
        raw: video,
        normalized: normalizePlexItem(video),
        variant: normalizePlexVariant(video, String(sectionId))
      });
    }
  }
  return items;
};

const fetchPlexMetadataItem = async (config, ratingKey, options = {}) => {
  const key = String(ratingKey || '').trim();
  if (!key) {
    const error = new Error('Plex ratingKey is required for metadata readback');
    error.status = 400;
    throw error;
  }
  const response = await plexRequest(config, `/library/metadata/${encodeURIComponent(key)}`);
  if (response.status >= 400) {
    const message = typeof response.data === 'string'
      ? response.data.slice(0, 200)
      : response.data?.error || response.statusText;
    throw new Error(`Plex metadata ${key} failed (${response.status}): ${message}`);
  }
  const candidates = [
    ...parsePlexVideos(response.data),
    ...parsePlexDirectoriesInSection(response.data)
  ].filter((entry) => entry.title || entry.originalTitle || entry.grandparentTitle || entry.parentTitle);
  const item = candidates[0] || null;
  if (!item) {
    const error = new Error(`Plex metadata ${key} did not include an importable item`);
    error.status = 404;
    throw error;
  }
  const sectionId = String(
    options.sectionId
    || item.librarySectionID
    || item.librarySectionId
    || item.sectionID
    || item.sectionId
    || (Array.isArray(config.plexLibrarySections) && config.plexLibrarySections.length === 1 ? config.plexLibrarySections[0] : '')
    || ''
  ).trim();
  return {
    sectionId,
    raw: item,
    normalized: normalizePlexItem(item),
    variant: normalizePlexVariant(item, sectionId)
  };
};

const fetchPlexShowSeasons = async (config, ratingKey) => {
  if (!ratingKey) return [];
  const response = await plexRequest(config, `/library/metadata/${String(ratingKey)}/children`);
  if (response.status >= 400) {
    const message = typeof response.data === 'string'
      ? response.data.slice(0, 200)
      : response.data?.error || response.statusText;
    throw new Error(`Plex show seasons request failed (${response.status}): ${message}`);
  }
  const entries = [
    ...parsePlexVideos(response.data),
    ...parsePlexDirectoriesInSection(response.data)
  ];
  const seasonMap = new Map();
  for (const entry of entries) {
    const type = String(entry?.type || '').toLowerCase();
    if (type !== 'season') continue;
    const raw = entry?.index ?? entry?.parentIndex ?? null;
    const season = Number(raw);
    if (Number.isInteger(season) && season > 0) {
      const leafCount = Number(entry?.leafCount);
      const viewedLeafCount = Number(entry?.viewedLeafCount);
      seasonMap.set(season, {
        season_number: season,
        available_episodes: Number.isInteger(leafCount) && leafCount >= 0 ? leafCount : null,
        watched_episodes: Number.isInteger(viewedLeafCount) && viewedLeafCount >= 0 ? viewedLeafCount : 0
      });
    }
  }
  return [...seasonMap.values()].sort((a, b) => a.season_number - b.season_number);
};

const fetchPlexSeasonEpisodeStates = async (config, ratingKey, seasonNumber) => {
  if (!ratingKey || !Number.isInteger(Number(seasonNumber)) || Number(seasonNumber) <= 0) {
    return { watchedEpisodeNumbers: [], availableEpisodeNumbers: [] };
  }
  const response = await plexRequest(config, `/library/metadata/${String(ratingKey)}/allLeaves`);
  if (response.status >= 400) {
    const message = typeof response.data === 'string'
      ? response.data.slice(0, 200)
      : response.data?.error || response.statusText;
    throw new Error(`Plex season episodes request failed (${response.status}): ${message}`);
  }
  const targetSeason = Number(seasonNumber);
  const entries = parsePlexVideos(response.data);
  const watched = new Set();
  const available = new Set();
  for (const entry of entries) {
    const type = String(entry?.type || '').toLowerCase();
    if (type !== 'episode') continue;
    const parent = Number(entry?.parentIndex);
    if (!Number.isInteger(parent) || parent !== targetSeason) continue;
    const epNum = Number(entry?.index);
    if (!Number.isInteger(epNum) || epNum <= 0) continue;
    available.add(epNum);
    const viewed = Number(entry?.viewCount);
    if (Number.isInteger(viewed) && viewed > 0) {
      watched.add(epNum);
    }
  }
  return {
    watchedEpisodeNumbers: [...watched].sort((a, b) => a - b),
    availableEpisodeNumbers: [...available].sort((a, b) => a - b)
  };
};

const fetchPlexShowSeasonVariants = async (config, ratingKey, sectionId) => {
  if (!ratingKey || !sectionId) return [];
  const response = await plexRequest(config, `/library/metadata/${String(ratingKey)}/allLeaves`);
  if (response.status >= 400) {
    const message = typeof response.data === 'string'
      ? response.data.slice(0, 200)
      : response.data?.error || response.statusText;
    throw new Error(`Plex show episode variants request failed (${response.status}): ${message}`);
  }

  const entries = parsePlexVideos(response.data);
  const bySeason = new Map();
  for (const entry of entries) {
    const type = String(entry?.type || '').toLowerCase();
    if (type !== 'episode') continue;
    const season = Number(entry?.parentIndex);
    if (!Number.isInteger(season) || season <= 0) continue;

    const media = Array.isArray(entry.Media) ? entry.Media[0] : entry.Media;
    const height = Number(media?.height);
    const width = Number(media?.width);
    const resolution = String(media?.videoResolution || '').trim() || null;

    const prev = bySeason.get(season) || {
      season,
      maxHeight: null,
      maxWidth: null,
      resolution: null
    };

    if (Number.isFinite(height) && (!Number.isFinite(prev.maxHeight) || height > prev.maxHeight)) {
      prev.maxHeight = height;
    }
    if (Number.isFinite(width) && (!Number.isFinite(prev.maxWidth) || width > prev.maxWidth)) {
      prev.maxWidth = width;
    }
    if (!prev.resolution && resolution) {
      prev.resolution = resolution;
    }
    bySeason.set(season, prev);
  }

  return [...bySeason.values()]
    .sort((a, b) => a.season - b.season)
    .map((row) => ({
      source: 'plex',
      source_item_key: `${sectionId}:show:${ratingKey}:season:${row.season}`,
      source_media_id: null,
      source_part_id: null,
      season_number: row.season,
      edition: `Season ${row.season}`,
      file_path: null,
      container: null,
      video_codec: null,
      audio_codec: null,
      resolution: row.resolution || null,
      video_width: Number.isFinite(row.maxWidth) ? row.maxWidth : null,
      video_height: Number.isFinite(row.maxHeight) ? row.maxHeight : null,
      audio_channels: null,
      duration_ms: null,
      runtime_minutes: null,
      raw_json: {
        ratingKey: String(ratingKey),
        source: 'allLeaves',
        season: row.season
      }
    }));
};

module.exports = {
  PLEX_PMS_MODERNIZATION_CONTRACT,
  PLEX_WEBHOOK_AND_RATINGS_CONTRACT,
  PLEX_WATCH_STATE_SYNC_CONTRACT,
  PLEX_WATCHED_STATE_WRITEBACK_CONTRACT,
  resolvePlexPreset,
  buildPlexPmsModernizationContract,
  buildPlexWebhookAndRatingsContract,
  buildPlexWatchStateSyncContract,
  buildPlexWatchedStateWritebackContract,
  resolvePlexSectionsRootPath,
  fetchPlexSectionsWithResolution,
  fetchPlexSections,
  fetchPlexMediaProviders,
  fetchPlexNowPlayingSessions,
  fetchPlexWatchStateSnapshot,
  fetchPlexRatingSnapshot,
  fetchPlexImageAsset,
  fetchPlexLibraryItems,
  fetchPlexMetadataItem,
  fetchPlexShowSeasons,
  fetchPlexShowSeasonVariants,
  fetchPlexSeasonEpisodeStates,
  parsePlexMediaProviders,
  normalizePlexMediaProvider,
  normalizePlexProviderFeatureDirectory,
  extractPlexProviderItemListingCandidates,
  buildPlexProviderAdvertisedImportPathContract,
  fetchPlexProviderItemRows,
  parsePlexNowPlayingSessions,
  normalizePlexNowPlayingSession,
  parsePlexWatchStateEntries,
  normalizePlexWatchedStateEntry,
  parsePlexRatingEntries,
  normalizePlexRatingEntry,
  parsePlexWebhookPayload,
  normalizePlexWebhookEvent,
  buildPlexRatingWritebackRequest,
  buildPlexWatchedStateWritebackRequest,
  sendPlexRatingWriteback,
  sendPlexWatchedStateWriteback,
  shouldIncludePlexEntry,
  normalizePlexItem,
  normalizePlexVariant
};
