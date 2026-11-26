'use strict';

const crypto = require('node:crypto');
const { MEDIA_FIELD_COLUMNS, normalizeFieldPath, setCanonicalFieldControl } = require('./canonicalMediaFieldControls');
const { buildBookOrbitCoverProxyPath } = require('./bookOrbit');
const { normalizeDigits, normalizeIssueToken, normalizeText } = require('./bookComicNormalization');
const { TYPE_DETAILS_ALLOWED_BY_MEDIA_TYPE, normalizeTypeDetails } = require('./typeDetails');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_KIND_PATTERN = /^[a-z][a-z0-9_.:-]{1,79}$/;
const FORBIDDEN_FACT_KEY = /(authorization|credential|password|passwd|secret|token|api[_-]?key)/i;
const MAX_FACT_BYTES = 256 * 1024;
const BOOKORBIT_PROVIDER_ID_FIELDS = Object.freeze([
  ['google', 'bookorbit_google_id'],
  ['goodreads', 'bookorbit_goodreads_id'],
  ['amazon', 'bookorbit_amazon_id'],
  ['hardcover', 'bookorbit_hardcover_id'],
  ['openLibrary', 'bookorbit_open_library_id'],
  ['itunes', 'bookorbit_itunes_id'],
  ['audible', 'bookorbit_audible_id'],
  ['librofm', 'bookorbit_librofm_id'],
  ['kobo', 'bookorbit_kobo_id'],
  ['comicvine', 'bookorbit_comicvine_id'],
  ['ranobedb', 'bookorbit_ranobedb_id'],
  ['lubimyczytac', 'bookorbit_lubimyczytac_id'],
  ['aladin', 'bookorbit_aladin_id']
]);
const OBSERVATION_COMPARISON_FIELDS = Object.freeze([
  Object.freeze({ fact: 'proxyPath', section: 'cover', fieldPath: 'media.poster_path', label: 'Cover', kind: 'text' }),
  Object.freeze({ fact: 'title', fieldPath: 'media.title', label: 'Title', kind: 'text' }),
  Object.freeze({ fact: 'mediaType', fieldPath: 'media.media_type', label: 'Media type', kind: 'text' }),
  Object.freeze({ fact: 'year', fieldPath: 'media.year', label: 'Year', kind: 'number' }),
  Object.freeze({ fact: 'releaseDate', fieldPath: 'media.release_date', label: 'Release date', kind: 'date' }),
  Object.freeze({ fact: 'format', fieldPath: 'media.format', label: 'Format', kind: 'text' }),
  Object.freeze({ fact: 'author', fieldPath: 'type_details.author', label: 'Author', kind: 'text' }),
  Object.freeze({ fact: 'publisher', fieldPath: 'type_details.publisher', label: 'Publisher', kind: 'text' }),
  Object.freeze({ fact: 'isbn', fieldPath: 'type_details.isbn', label: 'ISBN', kind: 'identifier' }),
  Object.freeze({ fact: 'edition', fieldPath: 'type_details.edition', label: 'Edition', kind: 'text' }),
  Object.freeze({ fact: 'series', fieldPath: 'type_details.series', label: 'Series', kind: 'text' }),
  Object.freeze({ fact: 'seriesIndex', fieldPath: 'type_details.series_index', label: 'Series index', kind: 'number' }),
  Object.freeze({ fact: 'volume', fieldPath: 'type_details.volume', label: 'Volume', kind: 'text' }),
  Object.freeze({ fact: 'issueNumber', fieldPath: 'type_details.issue_number', label: 'Issue number', kind: 'text' }),
  Object.freeze({ fact: 'coverDate', fieldPath: 'type_details.cover_date', label: 'Cover date', kind: 'date' })
]);
const OBSERVATION_COMPARISON_FIELD_PATHS = Object.freeze(
  OBSERVATION_COMPARISON_FIELDS.map(({ fieldPath }) => fieldPath)
);
const BOOKORBIT_PROVIDER_FIELD_BY_ID = Object.freeze(
  Object.fromEntries(BOOKORBIT_PROVIDER_ID_FIELDS)
);

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 2147483647) {
    throw new TypeError(`${label} is invalid`);
  }
  return parsed;
}

function boundedText(value, maxLength, label, { required = false } = {}) {
  const normalized = String(value ?? '').trim();
  if ((required && !normalized) || normalized.length > maxLength) throw new TypeError(`${label} is invalid`);
  return normalized || null;
}

function uuid(value, label) {
  const normalized = boundedText(value, 80, label, { required: true });
  if (!UUID_PATTERN.test(normalized)) throw new TypeError(`${label} is invalid`);
  return normalized.toLowerCase();
}

function optionalTimestamp(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new TypeError(`${label} is invalid`);
  return parsed.toISOString();
}

function normalizedJsonValue(value, path = 'facts', depth = 0) {
  if (depth > 12) throw new TypeError('Provider observation facts are too deeply nested');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`Provider observation ${path} is invalid`);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 500) throw new TypeError(`Provider observation ${path} is too large`);
    return value.map((entry, index) => normalizedJsonValue(entry, `${path}[${index}]`, depth + 1));
  }
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`Provider observation ${path} is invalid`);
  }
  const entries = Object.entries(value);
  if (entries.length > 500) throw new TypeError(`Provider observation ${path} is too large`);
  const normalized = {};
  for (const [key, entry] of entries.sort(([left], [right]) => left.localeCompare(right))) {
    if (!/^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(key) || FORBIDDEN_FACT_KEY.test(key)) {
      throw new TypeError(`Provider observation ${path} contains a forbidden key`);
    }
    normalized[key] = normalizedJsonValue(entry, `${path}.${key}`, depth + 1);
  }
  return normalized;
}

function normalizeFacts(value) {
  const facts = normalizedJsonValue(value);
  if (!facts || Array.isArray(facts) || typeof facts !== 'object') {
    throw new TypeError('Provider observation facts must be an object');
  }
  const serialized = JSON.stringify(facts);
  if (Buffer.byteLength(serialized) > MAX_FACT_BYTES) throw new TypeError('Provider observation facts are too large');
  return Object.freeze({ facts: Object.freeze(facts), serialized });
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function publicObservation(row, { created = false } = {}) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    spaceId: Number(row.space_id),
    providerConnectionId: row.provider_connection_id,
    externalIdentityId: row.external_identity_id,
    observedMediaPublicId: row.observed_media_public_id,
    sourceKind: row.source_kind,
    schemaVersion: Number(row.schema_version),
    contentHash: row.content_hash,
    facts: row.normalized_facts,
    sourceUpdatedAt: row.source_updated_at,
    observedAt: row.observed_at,
    created
  });
}

function displayComparisonValue(value) {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function normalizedComparisonValue(value, kind) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (kind === 'number') {
    const parsed = Number(text);
    return Number.isFinite(parsed) ? `number:${parsed}` : `text:${text.toLocaleLowerCase()}`;
  }
  if (kind === 'date') {
    const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return `date:${match[1]}`;
    const parsed = new Date(text);
    return Number.isFinite(parsed.getTime())
      ? `date:${parsed.toISOString().slice(0, 10)}`
      : `text:${text.toLocaleLowerCase()}`;
  }
  if (kind === 'identifier') return `identifier:${text.replace(/[\s-]/g, '').toLocaleLowerCase()}`;
  return `text:${text.replace(/\s+/g, ' ').toLocaleLowerCase()}`;
}

function credentialSafeObservedCoverPath({ facts, providerConnectionId, sourceKind } = {}) {
  const cover = facts?.cover && typeof facts.cover === 'object' ? facts.cover : {};
  const identity = facts?.identity && typeof facts.identity === 'object' ? facts.identity : {};
  if (sourceKind === 'bookorbit_native') {
    const bookIdMatch = String(identity.externalId || '').match(/^urn:bookorbit:book:([1-9]\d*)$/i);
    const hasCoverEvidence = ['proxyPath', 'version', 'source', 'updatedAt', 'width', 'height']
      .some((key) => cover[key] !== null && cover[key] !== undefined && cover[key] !== '');
    if (!bookIdMatch || !hasCoverEvidence || !UUID_PATTERN.test(String(providerConnectionId || ''))) return null;
    const expectedPath = buildBookOrbitCoverProxyPath(
      String(providerConnectionId).toLowerCase(),
      Number(bookIdMatch[1]),
      cover.version || null
    );
    return cover.proxyPath && cover.proxyPath !== expectedPath ? null : expectedPath;
  }
  if (sourceKind !== 'kavita_api') return null;
  const proxyPath = String(cover.proxyPath || '').trim();
  const proxyMatch = proxyPath.match(/^\/api\/media\/kavita-(chapter-)?cover\/([1-9]\d*)$/);
  const identityMatch = String(identity.externalId || '').match(/^kavita:(series|chapter):([1-9]\d*)$/i);
  if (!proxyMatch || !identityMatch) return null;
  const proxyKind = proxyMatch[1] ? 'chapter' : 'series';
  return proxyKind === identityMatch[1].toLowerCase() && proxyMatch[2] === identityMatch[2] ? proxyPath : null;
}

function buildProviderObservationComparison({
  facts,
  canonicalMedia,
  controls = [],
  providerConnectionId,
  sourceKind
} = {}) {
  const bibliographic = facts?.bibliographic && typeof facts.bibliographic === 'object'
    ? facts.bibliographic
    : {};
  const typeDetails = canonicalMedia?.type_details && typeof canonicalMedia.type_details === 'object'
    ? canonicalMedia.type_details
    : {};
  const controlMap = controls instanceof Map
    ? controls
    : new Map((Array.isArray(controls) ? controls : []).map((control) => [control.field_path, control]));
  const differences = [];
  let comparedFieldCount = 0;

  for (const field of OBSERVATION_COMPARISON_FIELDS) {
    const observedValue = field.section === 'cover'
      ? credentialSafeObservedCoverPath({ facts, providerConnectionId, sourceKind })
      : bibliographic[field.fact];
    const normalizedObserved = normalizedComparisonValue(observedValue, field.kind);
    if (normalizedObserved === null) continue;
    comparedFieldCount += 1;
    const [storage, name] = field.fieldPath.split('.');
    const currentValue = storage === 'media' ? canonicalMedia?.[name] : typeDetails[name];
    if (normalizedObserved === normalizedComparisonValue(currentValue, field.kind)) continue;
    const control = controlMap.get(field.fieldPath) || null;
    differences.push(Object.freeze({
      fieldPath: field.fieldPath,
      label: field.label,
      currentValue: displayComparisonValue(currentValue ?? null),
      observedValue: displayComparisonValue(observedValue),
      control: control ? Object.freeze({
        authority: control.authority,
        providerWriteMode: control.provider_write_mode,
        locked: Boolean(control.locked),
        sameProvider: Boolean(
          control.source_provider_connection_id
          && providerConnectionId
          && control.source_provider_connection_id === providerConnectionId
        )
      }) : null
    }));
  }

  return Object.freeze({
    status: comparedFieldCount === 0 ? 'no_comparable_facts' : differences.length > 0 ? 'differs' : 'matches',
    comparedFieldCount,
    differenceCount: differences.length,
    fields: Object.freeze(differences)
  });
}

function normalizedLookupToken(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function buildBookOrbitRematchEvidence(facts = {}, candidate = {}) {
  const bibliographic = facts?.bibliographic && typeof facts.bibliographic === 'object'
    ? facts.bibliographic
    : {};
  const providerIdentifiers = facts?.providerIdentifiers && typeof facts.providerIdentifiers === 'object'
    ? facts.providerIdentifiers
    : {};
  const metadataSource = facts?.metadataSource && typeof facts.metadataSource === 'object'
    ? facts.metadataSource
    : {};
  const details = candidate?.type_details && typeof candidate.type_details === 'object'
    ? candidate.type_details
    : {};
  const evidence = [];
  const blockers = [];
  let score = 0;
  let strong = false;

  const selectedProvider = String(metadataSource.provider || '').trim();
  const selectedProviderItemId = String(metadataSource.providerItemId || '').trim();
  const selectedField = BOOKORBIT_PROVIDER_FIELD_BY_ID[selectedProvider];
  if (selectedField && selectedProviderItemId && String(details[selectedField] || '').trim() === selectedProviderItemId) {
    evidence.push({ code: 'selected_provider_id', label: `Selected ${selectedProvider} record matches` });
    score += 100;
    strong = true;
  }

  let providerConflictCount = 0;
  for (const [provider, field] of BOOKORBIT_PROVIDER_ID_FIELDS) {
    const observed = String(providerIdentifiers[provider] || '').trim();
    const current = String(details[field] || '').trim();
    if (!observed || !current) continue;
    if (observed === current) {
      if (!(provider === selectedProvider && observed === selectedProviderItemId)) {
        evidence.push({ code: 'provider_id', label: `${provider} identifier matches` });
        score += 80;
      }
      strong = true;
    } else {
      providerConflictCount += 1;
    }
  }
  if (providerConflictCount > 0) {
    blockers.push({ code: 'provider_identifier_conflict', label: 'Provider identifier conflicts with the candidate' });
  }

  const observedIsbn = normalizeDigits(bibliographic.isbn || '');
  const candidateIsbn = normalizeDigits(details.isbn || '');
  if (observedIsbn && candidateIsbn) {
    if (observedIsbn === candidateIsbn) {
      evidence.push({ code: 'isbn', label: 'ISBN matches' });
      score += 70;
      strong = true;
    } else {
      blockers.push({ code: 'isbn_conflict', label: 'ISBN conflicts with the candidate' });
    }
  }

  const observedType = String(bibliographic.mediaType || '').trim();
  const candidateType = String(candidate.media_type || '').trim();
  if (observedType && candidateType && observedType !== candidateType) {
    blockers.push({ code: 'media_type_conflict', label: 'Media type conflicts with the candidate' });
  }

  const observedTitle = normalizeText(bibliographic.title || '');
  const candidateTitle = normalizeText(candidate.title || '');
  const observedAuthor = normalizeText(bibliographic.author || '');
  const candidateAuthor = normalizeText(details.author || '');
  if (observedTitle && candidateTitle && observedTitle === candidateTitle
    && observedAuthor && candidateAuthor && observedAuthor === candidateAuthor) {
    evidence.push({ code: 'title_author', label: 'Title and author match' });
    score += 40;
  }

  const observedSeries = normalizeText(bibliographic.series || '');
  const candidateSeries = normalizeText(details.series || '');
  const observedIssue = normalizeIssueToken(bibliographic.issueNumber || '');
  const candidateIssue = normalizeIssueToken(details.issue_number || '');
  const observedVolume = normalizeText(bibliographic.volume || '');
  const candidateVolume = normalizeText(details.volume || '');
  if (observedSeries && candidateSeries && observedIssue && candidateIssue) {
    if (observedSeries === candidateSeries && observedIssue === candidateIssue) {
      if (observedVolume && candidateVolume && observedVolume === candidateVolume) {
        evidence.push({ code: 'series_issue_volume', label: 'Series, issue, and volume match' });
        score += 60;
        strong = true;
      } else {
        evidence.push({ code: 'series_issue', label: 'Series and issue match' });
        score += 40;
      }
    } else if (observedSeries !== candidateSeries || observedIssue !== candidateIssue) {
      blockers.push({ code: 'comic_position_conflict', label: 'Series or issue conflicts with the candidate' });
    }
  }

  if (candidate.has_connection_identity) {
    blockers.push({ code: 'target_identity_conflict', label: 'Candidate already has a different identity from this BookOrbit connection' });
  }

  return Object.freeze({
    evidence: Object.freeze(evidence.map(Object.freeze)),
    blockers: Object.freeze(blockers.map(Object.freeze)),
    score,
    confidence: strong ? 'high' : 'medium',
    eligible: evidence.length > 0 && blockers.length === 0
  });
}

function bookOrbitRematchSearch(facts = {}) {
  const bibliographic = facts?.bibliographic && typeof facts.bibliographic === 'object'
    ? facts.bibliographic
    : {};
  const providerIdentifiers = facts?.providerIdentifiers && typeof facts.providerIdentifiers === 'object'
    ? facts.providerIdentifiers
    : {};
  const metadataSource = facts?.metadataSource && typeof facts.metadataSource === 'object'
    ? facts.metadataSource
    : {};
  const predicates = [];
  const values = [];
  const add = (sql, ...entries) => {
    const offset = values.length;
    values.push(...entries);
    predicates.push(sql.replace(/\$(\d+)/g, (_, index) => `$${offset + Number(index) + 3}`));
  };

  for (const [provider, field] of BOOKORBIT_PROVIDER_ID_FIELDS) {
    const observed = String(providerIdentifiers[provider] || '').trim();
    if (observed) add(`COALESCE(m.type_details->>'${field}', '') = $1`, observed);
  }
  const selectedProvider = String(metadataSource.provider || '').trim();
  const selectedItemId = String(metadataSource.providerItemId || '').trim();
  const selectedField = BOOKORBIT_PROVIDER_FIELD_BY_ID[selectedProvider];
  if (selectedField && selectedItemId && !String(providerIdentifiers[selectedProvider] || '').trim()) {
    add(`COALESCE(m.type_details->>'${selectedField}', '') = $1`, selectedItemId);
  }
  const isbn = normalizeDigits(bibliographic.isbn || '');
  if (isbn) add("regexp_replace(COALESCE(m.type_details->>'isbn', ''), '\\D+', '', 'g') = $1", isbn);

  const title = normalizedLookupToken(bibliographic.title);
  const author = normalizedLookupToken(bibliographic.author);
  if (title && author) {
    add("regexp_replace(lower(COALESCE(m.title, '')), '[^a-z0-9]+', '', 'g') = $1 AND regexp_replace(lower(COALESCE(m.type_details->>'author', '')), '[^a-z0-9]+', '', 'g') = $2", title, author);
  }
  const series = normalizedLookupToken(bibliographic.series);
  const issue = normalizedLookupToken(normalizeIssueToken(bibliographic.issueNumber || ''));
  if (series && issue) {
    add("regexp_replace(lower(COALESCE(m.type_details->>'series', '')), '[^a-z0-9]+', '', 'g') = $1 AND regexp_replace(lower(COALESCE(m.type_details->>'issue_number', '')), '[^a-z0-9]+', '', 'g') = $2", series, issue);
  }
  return Object.freeze({ predicates: Object.freeze(predicates), values: Object.freeze(values) });
}

async function loadBookOrbitIdentityRematchPreview(client, {
  spaceId: spaceIdValue,
  libraryId: libraryIdValue,
  mediaId: mediaIdValue,
  observationId: observationIdValue,
  limit: limitValue = 5
} = {}) {
  if (!client || typeof client.query !== 'function') {
    throw new TypeError('BookOrbit identity rematch preview requires a transaction client');
  }
  const spaceId = positiveInteger(spaceIdValue, 'Workspace');
  const libraryId = positiveInteger(libraryIdValue, 'Library');
  const mediaId = positiveInteger(mediaIdValue, 'Canonical object');
  const observationId = uuid(observationIdValue, 'Provider observation');
  const limit = Math.min(10, positiveInteger(limitValue, 'Rematch preview limit'));
  const observationResult = await client.query(
    `SELECT pso.id, pso.content_hash, pso.normalized_facts, pso.source_kind,
            pso.provider_connection_id, pc.provider_type, pc.display_name
       FROM provider_source_observations pso
       JOIN external_media_identities emi
         ON emi.space_id = pso.space_id
        AND emi.provider_connection_id = pso.provider_connection_id
        AND emi.id = pso.external_identity_id
       JOIN media attached
         ON attached.id = emi.media_id
        AND attached.space_id = emi.space_id
        AND attached.library_id = $2
       JOIN provider_connections pc
         ON pc.space_id = pso.space_id
        AND pc.id = pso.provider_connection_id
      WHERE pso.space_id = $1 AND pso.id = $3 AND emi.media_id = $4`,
    [spaceId, libraryId, observationId, mediaId]
  );
  const observation = observationResult.rows[0];
  if (!observation) return null;

  const supported = observation.provider_type === 'bookorbit'
    && ['bookorbit_native', 'bookorbit_opds'].includes(observation.source_kind);
  const base = {
    observationId,
    observationFingerprint: observation.content_hash,
    providerConnection: Object.freeze({
      id: observation.provider_connection_id,
      providerType: observation.provider_type,
      displayName: observation.display_name
    }),
    mutationEnabled: false
  };
  if (!supported) {
    return Object.freeze({
      ...base,
      status: 'unsupported_source',
      candidateCount: 0,
      eligibleCount: 0,
      blockedCount: 0,
      candidates: Object.freeze([]),
      previewFingerprint: sha256(JSON.stringify({ observationId, sourceKind: observation.source_kind, candidates: [] }))
    });
  }

  const search = bookOrbitRematchSearch(observation.normalized_facts);
  if (search.predicates.length === 0) {
    return Object.freeze({
      ...base,
      status: 'insufficient_evidence',
      candidateCount: 0,
      eligibleCount: 0,
      blockedCount: 0,
      candidates: Object.freeze([]),
      previewFingerprint: sha256(JSON.stringify({ observationId, evidence: 'insufficient', candidates: [] }))
    });
  }

  const candidateResult = await client.query(
    `SELECT m.id, m.public_id, m.title, m.media_type, m.year, m.type_details,
            EXISTS (
              SELECT 1 FROM external_media_identities target_identity
               WHERE target_identity.space_id = m.space_id
                 AND target_identity.media_id = m.id
                 AND target_identity.provider_connection_id = $${search.values.length + 4}
                 AND target_identity.active
            ) AS has_connection_identity
       FROM media m
      WHERE m.space_id = $1 AND m.library_id = $2 AND m.id <> $3
        AND m.media_type IN ('book', 'comic_book')
        AND (${search.predicates.join(' OR ')})
      ORDER BY m.id
      LIMIT 100`,
    [spaceId, libraryId, mediaId, ...search.values, observation.provider_connection_id]
  );
  const candidates = candidateResult.rows
    .map((row) => ({ row, assessment: buildBookOrbitRematchEvidence(observation.normalized_facts, row) }))
    .filter(({ assessment }) => assessment.evidence.length > 0)
    .sort((left, right) => right.assessment.score - left.assessment.score
      || Number(left.row.id) - Number(right.row.id))
    .slice(0, limit)
    .map(({ row, assessment }) => Object.freeze({
      media: Object.freeze({
        id: Number(row.id),
        publicId: row.public_id,
        title: row.title,
        mediaType: row.media_type,
        year: row.year === null || row.year === undefined ? null : Number(row.year)
      }),
      confidence: assessment.confidence,
      eligible: assessment.eligible,
      evidence: assessment.evidence,
      blockers: assessment.blockers,
      candidateFingerprint: sha256(JSON.stringify({
        publicId: row.public_id,
        title: row.title,
        mediaType: row.media_type,
        year: row.year ?? null,
        typeDetails: row.type_details || {},
        hasConnectionIdentity: Boolean(row.has_connection_identity)
      }))
    }));
  const eligibleCount = candidates.filter((candidate) => candidate.eligible).length;
  const blockedCount = candidates.length - eligibleCount;
  return Object.freeze({
    ...base,
    status: candidates.length > 0 ? 'candidates' : 'no_candidates',
    candidateCount: candidates.length,
    eligibleCount,
    blockedCount,
    candidates: Object.freeze(candidates),
    previewFingerprint: sha256(JSON.stringify({
      observationId,
      observationFingerprint: observation.content_hash,
      candidates
    }))
  });
}

function canonicalValueFingerprint(fieldPath, value) {
  const field = OBSERVATION_COMPARISON_FIELDS.find((candidate) => candidate.fieldPath === fieldPath);
  if (!field) throw new TypeError('Provider observation field path is invalid');
  return sha256(normalizedComparisonValue(value, field.kind) || 'null');
}

function publicFieldReview(row, { observationFingerprint, canonicalFingerprint } = {}) {
  if (!row) return null;
  return Object.freeze({
    decision: row.decision,
    note: row.note || null,
    deferredUntil: row.deferred_until || null,
    createdAt: row.created_at,
    current: row.observation_fingerprint === observationFingerprint
      && row.canonical_value_fingerprint === canonicalFingerprint
  });
}

function publicObservationReadback(row, { canonicalMedia = null, controls = [], reviews = new Map() } = {}) {
  if (!row) return null;
  const readback = {
    id: row.id,
    providerConnection: Object.freeze({
      id: row.provider_connection_id,
      providerType: row.provider_type,
      displayName: row.connection_display_name
    }),
    identity: Object.freeze({
      kind: row.identity_kind,
      active: Boolean(row.identity_active)
    }),
    observedMediaPublicId: row.observed_media_public_id,
    sourceKind: row.source_kind,
    schemaVersion: Number(row.schema_version),
    fingerprint: row.content_hash,
    facts: row.normalized_facts,
    sourceUpdatedAt: row.source_updated_at,
    observedAt: row.observed_at
  };
  if (canonicalMedia) {
    const comparison = buildProviderObservationComparison({
      facts: row.normalized_facts,
      canonicalMedia,
      controls,
      providerConnectionId: row.provider_connection_id,
      sourceKind: row.source_kind
    });
    readback.comparison = Object.freeze({
      ...comparison,
      fields: Object.freeze(comparison.fields.map((field) => Object.freeze({
        ...field,
        review: publicFieldReview(reviews.get(`${row.id}:${field.fieldPath}`), {
          observationFingerprint: row.content_hash,
          canonicalFingerprint: canonicalValueFingerprint(field.fieldPath, field.currentValue)
        })
      })))
    });
  }
  return Object.freeze(readback);
}

function providerApplyBlocker(field) {
  if (!field.review) return 'not_reviewed';
  if (!field.review.current) return 'review_outdated';
  if (field.review.decision === 'rejected') return 'review_rejected';
  if (field.review.decision === 'deferred') return 'review_deferred';
  if (field.review.decision !== 'approved') return 'not_approved';
  if (field.control?.locked) return 'field_locked';
  return null;
}

function publicProviderObservationApplyEvent(row) {
  const changes = Array.isArray(row?.field_changes) ? row.field_changes : [];
  return Object.freeze({
    id: row.id,
    observationId: row.provider_observation_id,
    observationFingerprint: row.observation_fingerprint,
    planFingerprint: row.plan_fingerprint,
    appliedAt: row.applied_at,
    fieldCount: changes.length,
    fields: Object.freeze(changes.map((change) => Object.freeze({
      fieldPath: change.fieldPath,
      label: change.label,
      previousValue: change.previousValue ?? null,
      appliedValue: change.appliedValue ?? null
    })))
  });
}

function buildProviderObservationApplyPreview(observation, { canonicalMedia = null } = {}) {
  if (!observation?.comparison) {
    throw new TypeError('Provider observation apply preview requires a current comparison');
  }
  const mediaTypeField = observation.comparison.fields.find((field) => field.fieldPath === 'media.media_type');
  const mediaTypeBaseBlocker = mediaTypeField ? providerApplyBlocker(mediaTypeField) : null;
  const proposedMediaType = mediaTypeField && !mediaTypeBaseBlocker
    ? String(mediaTypeField.observedValue || '').trim()
    : String(canonicalMedia?.media_type || mediaTypeField?.currentValue || '').trim();
  const currentTypeDetails = canonicalMedia?.type_details && typeof canonicalMedia.type_details === 'object'
    ? canonicalMedia.type_details
    : {};
  const typeTransition = mediaTypeField && !mediaTypeBaseBlocker
    ? normalizeTypeDetails(proposedMediaType, currentTypeDetails, { strict: true })
    : null;
  const transitionUnsafe = Boolean(
    mediaTypeField
    && !mediaTypeBaseBlocker
    && (
      !['book', 'comic_book'].includes(String(mediaTypeField.currentValue || '').trim())
      || !['book', 'comic_book'].includes(proposedMediaType)
      || typeTransition.invalidKeys.length > 0
      || typeTransition.errors.length > 0
    )
  );
  const targetMediaType = transitionUnsafe
    ? String(canonicalMedia?.media_type || mediaTypeField?.currentValue || '').trim()
    : proposedMediaType;
  const allowedTypeDetails = new Set(TYPE_DETAILS_ALLOWED_BY_MEDIA_TYPE[targetMediaType] || []);
  const fields = observation.comparison.fields.map((field) => {
    let blocker = providerApplyBlocker(field);
    if (!blocker && field.fieldPath === 'media.media_type' && transitionUnsafe) {
      blocker = 'unsafe_type_transition';
    }
    if (!blocker && field.fieldPath.startsWith('type_details.')) {
      const fieldName = field.fieldPath.slice('type_details.'.length);
      if (!allowedTypeDetails.has(fieldName)) blocker = 'field_invalid_for_media_type';
    }
    return Object.freeze({
      fieldPath: field.fieldPath,
      label: field.label,
      currentValue: field.currentValue,
      proposedValue: field.observedValue,
      eligible: blocker === null,
      blocker,
      control: field.control,
      review: field.review
    });
  });
  const eligibleCount = fields.filter((field) => field.eligible).length;
  const blockedCount = fields.length - eligibleCount;
  const planFingerprint = sha256(JSON.stringify({
    observationId: observation.id,
    observationFingerprint: observation.fingerprint,
    fields: fields.map((field) => ({
      fieldPath: field.fieldPath,
      currentValue: field.currentValue,
      proposedValue: field.proposedValue,
      eligible: field.eligible,
      blocker: field.blocker,
      control: field.control,
      review: field.review
    }))
  }));
  return Object.freeze({
    observationId: observation.id,
    observationFingerprint: observation.fingerprint,
    planFingerprint,
    providerConnection: observation.providerConnection,
    status: fields.length === 0 ? 'no_changes' : eligibleCount > 0 ? 'ready' : 'blocked',
    eligibleCount,
    blockedCount,
    mutationEnabled: eligibleCount > 0,
    fields: Object.freeze(fields)
  });
}

async function loadProviderObservationApplyPreview(client, {
  spaceId: spaceIdValue,
  mediaId: mediaIdValue,
  observationId: observationIdValue,
  canonicalMedia
} = {}) {
  if (!client || typeof client.query !== 'function') {
    throw new TypeError('Provider observation apply preview requires a transaction client');
  }
  const spaceId = positiveInteger(spaceIdValue, 'Workspace');
  const mediaId = positiveInteger(mediaIdValue, 'Canonical object');
  const observationId = uuid(observationIdValue, 'Provider observation');
  const [observationResult, controlsResult, reviewsResult] = await Promise.all([
    client.query(
      `SELECT pso.id, pso.provider_connection_id, pso.observed_media_public_id,
              pso.source_kind, pso.schema_version, pso.content_hash,
              pso.normalized_facts, pso.source_updated_at, pso.observed_at,
              pc.provider_type, pc.display_name AS connection_display_name,
              emi.identity_kind, emi.active AS identity_active
         FROM provider_source_observations pso
         JOIN external_media_identities emi
           ON emi.space_id = pso.space_id
          AND emi.provider_connection_id = pso.provider_connection_id
          AND emi.id = pso.external_identity_id
         JOIN provider_connections pc
           ON pc.space_id = pso.space_id AND pc.id = pso.provider_connection_id
        WHERE pso.space_id = $1 AND pso.id = $2 AND emi.media_id = $3`,
      [spaceId, observationId, mediaId]
    ),
    client.query(
      `SELECT field_path, authority, provider_write_mode, locked, source_provider_connection_id
         FROM canonical_media_field_controls
        WHERE space_id = $1 AND media_id = $2 AND field_path = ANY($3::varchar[])`,
      [spaceId, mediaId, OBSERVATION_COMPARISON_FIELD_PATHS]
    ),
    client.query(
      `SELECT DISTINCT ON (field_path)
              id, provider_observation_id, field_path, observation_fingerprint,
              canonical_value_fingerprint, decision, note, deferred_until, created_at
         FROM provider_observation_field_reviews
        WHERE space_id = $1 AND media_id = $2 AND provider_observation_id = $3
        ORDER BY field_path, created_at DESC, id DESC`,
      [spaceId, mediaId, observationId]
    )
  ]);
  const observationRow = observationResult.rows[0];
  if (!observationRow) return null;
  const reviews = new Map(reviewsResult.rows.map((row) => [`${observationId}:${row.field_path}`, row]));
  const observation = publicObservationReadback(observationRow, {
    canonicalMedia,
    controls: controlsResult.rows,
    reviews
  });
  return buildProviderObservationApplyPreview(observation, { canonicalMedia });
}

async function applyProviderObservationPreview(client, {
  spaceId: spaceIdValue,
  libraryId: libraryIdValue,
  mediaId: mediaIdValue,
  observationId: observationIdValue,
  actorId: actorIdValue,
  planFingerprint: planFingerprintValue
} = {}) {
  if (!client || typeof client.query !== 'function') {
    throw new TypeError('Provider observation apply requires a transaction client');
  }
  const spaceId = positiveInteger(spaceIdValue, 'Workspace');
  const libraryId = positiveInteger(libraryIdValue, 'Library');
  const mediaId = positiveInteger(mediaIdValue, 'Canonical object');
  const actorId = positiveInteger(actorIdValue, 'Actor');
  const observationId = uuid(observationIdValue, 'Provider observation');
  const requestedPlanFingerprint = boundedText(
    planFingerprintValue,
    64,
    'Provider observation apply plan fingerprint',
    { required: true }
  );
  if (!/^[0-9a-f]{64}$/.test(requestedPlanFingerprint)) {
    throw new TypeError('Provider observation apply plan fingerprint is invalid');
  }

  const mediaResult = await client.query(
    `SELECT * FROM media
      WHERE id = $1 AND space_id = $2 AND library_id = $3
      FOR UPDATE`,
    [mediaId, spaceId, libraryId]
  );
  const canonicalMedia = mediaResult.rows[0];
  if (!canonicalMedia) return null;

  const preview = await loadProviderObservationApplyPreview(client, {
    spaceId,
    mediaId,
    observationId,
    canonicalMedia
  });
  if (!preview) return null;
  if (preview.planFingerprint !== requestedPlanFingerprint) {
    const error = new Error('Provider observation apply preview is stale; build a new preview before applying');
    error.code = 'PROVIDER_OBSERVATION_APPLY_PREVIEW_STALE';
    error.status = 409;
    throw error;
  }
  const eligibleFields = preview.fields.filter((field) => field.eligible);
  if (eligibleFields.length === 0) {
    const error = new Error('Provider observation apply has no eligible approved fields');
    error.code = 'PROVIDER_OBSERVATION_APPLY_EMPTY';
    error.status = 409;
    throw error;
  }

  const reviewResult = await client.query(
    `SELECT DISTINCT ON (field_path)
            id, field_path, observation_fingerprint, canonical_value_fingerprint,
            decision, created_at
       FROM provider_observation_field_reviews
      WHERE space_id = $1 AND library_id = $2 AND media_id = $3
        AND provider_observation_id = $4
        AND field_path = ANY($5::varchar[])
      ORDER BY field_path, created_at DESC, id DESC`,
    [spaceId, libraryId, mediaId, observationId, eligibleFields.map((field) => field.fieldPath)]
  );
  const reviews = new Map(reviewResult.rows.map((row) => [row.field_path, row]));
  const changes = [];
  let targetMediaType = canonicalMedia.media_type;
  const mediaTypeField = eligibleFields.find((field) => field.fieldPath === 'media.media_type');
  if (mediaTypeField) targetMediaType = String(mediaTypeField.proposedValue || '').trim();

  for (const field of eligibleFields) {
    const review = reviews.get(field.fieldPath);
    if (!review || review.decision !== 'approved'
      || review.observation_fingerprint !== preview.observationFingerprint
      || review.canonical_value_fingerprint !== canonicalValueFingerprint(field.fieldPath, field.currentValue)) {
      const error = new Error('Provider observation approval changed; build a new preview before applying');
      error.code = 'PROVIDER_OBSERVATION_APPLY_REVIEW_STALE';
      error.status = 409;
      throw error;
    }
    let appliedValue = field.proposedValue;
    if (field.fieldPath === 'media.media_type') {
      const normalized = normalizeTypeDetails(targetMediaType, canonicalMedia.type_details || {}, { strict: true });
      if (!['book', 'comic_book'].includes(targetMediaType)
        || normalized.invalidKeys.length > 0 || normalized.errors.length > 0) {
        const error = new Error('Provider observation media type transition is no longer safe');
        error.code = 'PROVIDER_OBSERVATION_APPLY_TYPE_UNSAFE';
        error.status = 409;
        throw error;
      }
      await client.query(
        `UPDATE media SET media_type = $4, type_details = $5::jsonb
          WHERE id = $1 AND space_id = $2 AND library_id = $3`,
        [mediaId, spaceId, libraryId, targetMediaType, JSON.stringify(normalized.value || {})]
      );
      canonicalMedia.media_type = targetMediaType;
      canonicalMedia.type_details = normalized.value || {};
      appliedValue = targetMediaType;
    } else {
      const normalizedPath = normalizeFieldPath(field.fieldPath, targetMediaType);
      if (normalizedPath.storage === 'media') {
        await client.query(
          `UPDATE media SET ${MEDIA_FIELD_COLUMNS[normalizedPath.field]} = $4
            WHERE id = $1 AND space_id = $2 AND library_id = $3`,
          [mediaId, spaceId, libraryId, appliedValue]
        );
        canonicalMedia[normalizedPath.field] = appliedValue;
      } else {
        const normalized = normalizeTypeDetails(targetMediaType, { [normalizedPath.field]: appliedValue }, { strict: true });
        if (normalized.invalidKeys.length > 0 || normalized.errors.length > 0 || !normalized.value) {
          const error = new Error(`Provider observation field ${field.label} is no longer valid for this media type`);
          error.code = 'PROVIDER_OBSERVATION_APPLY_FIELD_INVALID';
          error.status = 409;
          throw error;
        }
        appliedValue = normalized.value[normalizedPath.field];
        await client.query(
          `UPDATE media
              SET type_details = jsonb_set(COALESCE(type_details, '{}'::jsonb), ARRAY[$4]::text[], $5::jsonb, true)
            WHERE id = $1 AND space_id = $2 AND library_id = $3`,
          [mediaId, spaceId, libraryId, normalizedPath.field, JSON.stringify(appliedValue)]
        );
        canonicalMedia.type_details = { ...(canonicalMedia.type_details || {}), [normalizedPath.field]: appliedValue };
      }
    }
    await setCanonicalFieldControl(client, {
      spaceId,
      mediaId,
      fieldPath: field.fieldPath,
      authority: 'reviewed',
      providerWriteMode: 'preserve',
      locked: false,
      providerConnectionId: preview.providerConnection.id,
      actorId
    });
    changes.push({
      fieldPath: field.fieldPath,
      label: field.label,
      previousValue: field.currentValue,
      appliedValue,
      reviewId: review.id
    });
  }

  const inserted = await client.query(
    `INSERT INTO provider_observation_apply_events
       (space_id, library_id, media_id, provider_observation_id,
        observation_fingerprint, plan_fingerprint, field_changes, applied_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
     RETURNING *`,
    [spaceId, libraryId, mediaId, observationId, preview.observationFingerprint,
      preview.planFingerprint, JSON.stringify(changes), actorId]
  );
  return Object.freeze({
    applyEvent: publicProviderObservationApplyEvent(inserted.rows[0]),
    media: Object.freeze({
      id: mediaId,
      mediaType: canonicalMedia.media_type,
      title: canonicalMedia.title,
      year: canonicalMedia.year,
      releaseDate: canonicalMedia.release_date,
      format: canonicalMedia.format,
      typeDetails: canonicalMedia.type_details || {}
    })
  });
}

async function listProviderSourceObservations(client, {
  spaceId: spaceIdValue,
  mediaId: mediaIdValue,
  canonicalMedia = null,
  page: pageValue = 1,
  limit: limitValue = 25
} = {}) {
  if (!client || typeof client.query !== 'function') {
    throw new TypeError('Provider source observation readback requires a transaction client');
  }
  const spaceId = positiveInteger(spaceIdValue, 'Workspace');
  const mediaId = positiveInteger(mediaIdValue, 'Canonical object');
  const page = positiveInteger(pageValue, 'Provider observation page');
  const limit = positiveInteger(limitValue, 'Provider observation limit');
  if (limit > 100) throw new TypeError('Provider observation limit is invalid');
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset)) throw new TypeError('Provider observation page is invalid');

  const [countResult, rowsResult, controlsResult] = await Promise.all([
    client.query(
      `SELECT COUNT(*)::int AS total
         FROM provider_source_observations pso
         JOIN external_media_identities emi
           ON emi.space_id = pso.space_id
          AND emi.provider_connection_id = pso.provider_connection_id
          AND emi.id = pso.external_identity_id
        WHERE pso.space_id = $1
          AND emi.media_id = $2`,
      [spaceId, mediaId]
    ),
    client.query(
      `SELECT pso.id,
              pso.provider_connection_id,
              pso.observed_media_public_id,
              pso.source_kind,
              pso.schema_version,
              pso.content_hash,
              pso.normalized_facts,
              pso.source_updated_at,
              pso.observed_at,
              pc.provider_type,
              pc.display_name AS connection_display_name,
              emi.identity_kind,
              emi.active AS identity_active
         FROM provider_source_observations pso
         JOIN external_media_identities emi
           ON emi.space_id = pso.space_id
          AND emi.provider_connection_id = pso.provider_connection_id
          AND emi.id = pso.external_identity_id
         JOIN provider_connections pc
           ON pc.space_id = pso.space_id
          AND pc.id = pso.provider_connection_id
        WHERE pso.space_id = $1
          AND emi.media_id = $2
        ORDER BY pso.observed_at DESC, pso.id DESC
        LIMIT $3 OFFSET $4`,
      [spaceId, mediaId, limit, offset]
    ),
    canonicalMedia
      ? client.query(
          `SELECT field_path, authority, provider_write_mode, locked, source_provider_connection_id
             FROM canonical_media_field_controls
            WHERE space_id = $1
              AND media_id = $2
              AND field_path = ANY($3::varchar[])`,
          [spaceId, mediaId, OBSERVATION_COMPARISON_FIELD_PATHS]
        )
      : Promise.resolve({ rows: [] })
  ]);
  const observationIds = rowsResult.rows.map((row) => row.id);
  const reviewsResult = observationIds.length > 0
    ? await client.query(
        `SELECT DISTINCT ON (provider_observation_id, field_path)
                id, provider_observation_id, field_path, observation_fingerprint,
                canonical_value_fingerprint, decision, note, deferred_until, created_at
           FROM provider_observation_field_reviews
          WHERE space_id = $1
            AND media_id = $2
            AND provider_observation_id = ANY($3::uuid[])
          ORDER BY provider_observation_id, field_path, created_at DESC, id DESC`,
        [spaceId, mediaId, observationIds]
      )
    : { rows: [] };
  const reviews = new Map(reviewsResult.rows.map((row) => [`${row.provider_observation_id}:${row.field_path}`, row]));
  const applyResult = observationIds.length > 0
    ? await client.query(
        `SELECT id, provider_observation_id, observation_fingerprint,
                plan_fingerprint, field_changes, applied_at
           FROM provider_observation_apply_events
          WHERE space_id = $1 AND media_id = $2
            AND provider_observation_id = ANY($3::uuid[])
          ORDER BY applied_at DESC, id DESC`,
        [spaceId, mediaId, observationIds]
      )
    : { rows: [] };
  const applies = new Map();
  for (const row of applyResult.rows) {
    const current = applies.get(row.provider_observation_id) || [];
    current.push(publicProviderObservationApplyEvent(row));
    applies.set(row.provider_observation_id, current);
  }
  const total = Number(countResult.rows[0]?.total || 0);
  const totalPages = total > 0 ? Math.ceil(total / limit) : 1;
  return Object.freeze({
    observations: Object.freeze(rowsResult.rows.map((row) => Object.freeze({
      ...publicObservationReadback(row, {
        canonicalMedia,
        controls: controlsResult.rows,
        reviews
      }),
      applies: Object.freeze(applies.get(row.id) || [])
    }))),
    pagination: Object.freeze({
      page,
      limit,
      total,
      totalPages,
      hasMore: page < totalPages
    })
  });
}

async function appendProviderObservationFieldReview(client, {
  spaceId: spaceIdValue,
  libraryId: libraryIdValue,
  mediaId: mediaIdValue,
  observationId: observationIdValue,
  actorId: actorIdValue,
  canonicalMedia,
  fieldPath,
  decision,
  note = null
} = {}) {
  if (!client || typeof client.query !== 'function') {
    throw new TypeError('Provider observation field review requires a transaction client');
  }
  const spaceId = positiveInteger(spaceIdValue, 'Workspace');
  const libraryId = positiveInteger(libraryIdValue, 'Library');
  const mediaId = positiveInteger(mediaIdValue, 'Canonical object');
  const actorId = positiveInteger(actorIdValue, 'Actor');
  const observationId = uuid(observationIdValue, 'Provider observation');
  if (!OBSERVATION_COMPARISON_FIELD_PATHS.includes(fieldPath)) {
    throw new TypeError('Provider observation field path is invalid');
  }
  if (!['approved', 'rejected', 'deferred'].includes(decision)) {
    throw new TypeError('Provider observation field review decision is invalid');
  }
  const observationResult = await client.query(
    `SELECT pso.*, emi.media_id, pc.provider_type, pc.display_name AS connection_display_name,
            emi.identity_kind, emi.active AS identity_active
       FROM provider_source_observations pso
       JOIN external_media_identities emi
         ON emi.space_id = pso.space_id
        AND emi.provider_connection_id = pso.provider_connection_id
        AND emi.id = pso.external_identity_id
       JOIN provider_connections pc
         ON pc.space_id = pso.space_id AND pc.id = pso.provider_connection_id
      WHERE pso.space_id = $1 AND pso.id = $2 AND emi.media_id = $3`,
    [spaceId, observationId, mediaId]
  );
  const observation = observationResult.rows[0];
  if (!observation) return null;
  const controlsResult = await client.query(
    `SELECT field_path, authority, provider_write_mode, locked, source_provider_connection_id
       FROM canonical_media_field_controls
      WHERE space_id = $1 AND media_id = $2 AND field_path = ANY($3::varchar[])`,
    [spaceId, mediaId, OBSERVATION_COMPARISON_FIELD_PATHS]
  );
  const comparison = buildProviderObservationComparison({
    facts: observation.normalized_facts,
    canonicalMedia,
    controls: controlsResult.rows,
    providerConnectionId: observation.provider_connection_id,
    sourceKind: observation.source_kind
  });
  const field = comparison.fields.find((candidate) => candidate.fieldPath === fieldPath);
  if (!field) {
    const error = new Error('Provider observation field is not a current difference');
    error.code = 'PROVIDER_OBSERVATION_FIELD_NOT_DIFFERENT';
    throw error;
  }
  const deferredUntil = decision === 'deferred'
    ? new Date(Date.now() + (7 * 24 * 60 * 60 * 1000)).toISOString()
    : null;
  const inserted = await client.query(
    `INSERT INTO provider_observation_field_reviews
       (space_id, library_id, media_id, provider_observation_id, field_path,
        observation_fingerprint, canonical_value_fingerprint, decision, note,
        deferred_until, decided_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [spaceId, libraryId, mediaId, observationId, fieldPath, observation.content_hash,
      canonicalValueFingerprint(fieldPath, field.currentValue), decision,
      boundedText(note, 500, 'Provider observation field review note'), deferredUntil, actorId]
  );
  return Object.freeze({
    observationId,
    fieldPath,
    review: publicFieldReview(inserted.rows[0], {
      observationFingerprint: observation.content_hash,
      canonicalFingerprint: canonicalValueFingerprint(fieldPath, field.currentValue)
    })
  });
}

async function appendProviderSourceObservation(client, {
  spaceId: spaceIdValue,
  providerConnectionId: connectionIdValue,
  externalIdentityId: identityIdValue,
  actorId: actorIdValue,
  sourceKind: sourceKindValue,
  sourceUpdatedAt: sourceUpdatedAtValue = null,
  batchKey: batchKeyValue,
  facts: factValues,
  schemaVersion: schemaVersionValue = 1
} = {}) {
  if (!client || typeof client.query !== 'function') {
    throw new TypeError('Provider source observation append requires a transaction client');
  }
  const spaceId = positiveInteger(spaceIdValue, 'Workspace');
  const actorId = positiveInteger(actorIdValue, 'Actor');
  const providerConnectionId = uuid(connectionIdValue, 'Provider connection');
  const externalIdentityId = uuid(identityIdValue, 'External identity');
  const sourceKind = boundedText(sourceKindValue, 80, 'Provider observation source kind', { required: true });
  if (!SOURCE_KIND_PATTERN.test(sourceKind)) throw new TypeError('Provider observation source kind is invalid');
  const batchKey = boundedText(batchKeyValue, 512, 'Provider observation batch key', { required: true });
  const schemaVersion = positiveInteger(schemaVersionValue, 'Provider observation schema version');
  const sourceUpdatedAt = optionalTimestamp(sourceUpdatedAtValue, 'Provider observation source timestamp');
  const normalized = normalizeFacts(factValues);
  const contentHash = sha256(JSON.stringify({ schemaVersion, sourceKind, sourceUpdatedAt, facts: normalized.facts }));
  const idempotencyKey = sha256(`${batchKey}\u0000${externalIdentityId}\u0000${sourceKind}\u0000${contentHash}`);

  const identity = await client.query(
    `SELECT i.id, i.media_id, m.public_id AS media_public_id
       FROM external_media_identities i
       JOIN media m ON m.id = i.media_id AND m.space_id = i.space_id
      WHERE i.space_id = $1
        AND i.provider_connection_id = $2
        AND i.id = $3
        AND i.active`,
    [spaceId, providerConnectionId, externalIdentityId]
  );
  const identityRow = identity.rows[0];
  if (!identityRow) throw new Error('Provider observation requires an active same-workspace identity');

  const inserted = await client.query(
    `INSERT INTO provider_source_observations
       (space_id, provider_connection_id, external_identity_id, observed_media_public_id,
        source_kind, schema_version, idempotency_key, content_hash, normalized_facts,
        source_updated_at, actor_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
     ON CONFLICT (space_id, provider_connection_id, idempotency_key) DO NOTHING
     RETURNING *`,
    [spaceId, providerConnectionId, externalIdentityId, identityRow.media_public_id,
      sourceKind, schemaVersion, idempotencyKey, contentHash, normalized.serialized,
      sourceUpdatedAt, actorId]
  );
  if (inserted.rows[0]) return publicObservation(inserted.rows[0], { created: true });

  const existing = await client.query(
    `SELECT * FROM provider_source_observations
      WHERE space_id = $1 AND provider_connection_id = $2 AND idempotency_key = $3`,
    [spaceId, providerConnectionId, idempotencyKey]
  );
  const row = existing.rows[0];
  if (!row || row.external_identity_id !== externalIdentityId || row.content_hash !== contentHash) {
    const error = new Error('Provider observation idempotency key conflicts with different facts');
    error.code = 'PROVIDER_SOURCE_OBSERVATION_IDEMPOTENCY_CONFLICT';
    throw error;
  }
  return publicObservation(row, { created: false });
}

function optionalFact(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalBoolean(value) {
  if (value === true || value === false) return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return null;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

function buildBookOrbitSourceObservation(item = {}) {
  const details = item.type_details && typeof item.type_details === 'object' ? item.type_details : {};
  const native = details.bookorbit_native_metadata === 'available';
  const providerIds = Object.fromEntries(BOOKORBIT_PROVIDER_ID_FIELDS
    .map(([name, field]) => [name, optionalFact(details[field])])
    .filter(([, value]) => value));
  const memberships = Array.isArray(item.bookorbit_series_memberships)
    ? item.bookorbit_series_memberships.map((membership) => ({
        providerSeriesId: optionalFact(membership.providerSeriesId),
        name: optionalFact(membership.name),
        seriesIndex: optionalFact(membership.seriesIndex),
        volume: optionalFact(membership.volume),
        issueNumber: optionalFact(membership.issueNumber),
        displayOrder: Number(membership.displayOrder || 0),
        expectedItemCount: membership.expectedItemCount === null || membership.expectedItemCount === undefined
          ? null
          : Number(membership.expectedItemCount)
      }))
    : [];
  const metadataSourceProvider = optionalFact(details.bookorbit_metadata_source_provider);
  const metadataSourceItemId = optionalFact(details.bookorbit_metadata_source_item_id);
  const metadataSource = metadataSourceProvider && metadataSourceItemId
    ? { provider: metadataSourceProvider, providerItemId: metadataSourceItemId }
    : null;
  const editionRelationship = item.bookorbit_edition_relationship
    && typeof item.bookorbit_edition_relationship === 'object'
    && !Array.isArray(item.bookorbit_edition_relationship)
    ? item.bookorbit_edition_relationship
    : null;
  const edition = item.bookorbit_edition
    && typeof item.bookorbit_edition === 'object'
    && !Array.isArray(item.bookorbit_edition)
    ? item.bookorbit_edition
    : null;
  return Object.freeze({
    sourceKind: native ? 'bookorbit_native' : 'bookorbit_opds',
    sourceUpdatedAt: details.source_updated_at || null,
    facts: {
      identity: {
        kind: 'book',
        externalId: optionalFact(details.provider_item_id)
      },
      bibliographic: {
        title: optionalFact(item.title),
        mediaType: optionalFact(item.media_type),
        year: item.year === null || item.year === undefined ? null : Number(item.year),
        releaseDate: optionalFact(item.release_date),
        author: optionalFact(details.author),
        publisher: optionalFact(details.publisher),
        isbn: optionalFact(details.isbn),
        series: optionalFact(details.series),
        seriesIndex: optionalFact(details.series_index),
        volume: optionalFact(details.volume),
        issueNumber: optionalFact(details.issue_number)
      },
      providerIdentifiers: providerIds,
      metadataSource,
      seriesMemberships: memberships,
      edition: {
        name: optionalFact(edition?.name || editionRelationship?.current?.editionName),
        originalPublishedYear: optionalNumber(edition?.originalPublishedYear || editionRelationship?.current?.originalPublishedYear)
      },
      editionGroup: editionRelationship,
      cover: {
        proxyPath: native && /^\/api\/media\/bookorbit-cover\/[0-9a-f-]{36}\/[1-9]\d*(?:\?v=[^#]*)?$/i.test(String(item.poster_path || ''))
          ? String(item.poster_path)
          : null,
        version: optionalFact(details.bookorbit_cover_version),
        source: optionalFact(details.bookorbit_cover_source),
        updatedAt: optionalFact(details.bookorbit_cover_updated_at),
        width: details.bookorbit_cover_width ? Number(details.bookorbit_cover_width) : null,
        height: details.bookorbit_cover_height ? Number(details.bookorbit_cover_height) : null
      },
      nativeMetadata: native
    }
  });
}

function buildKavitaSourceObservation(item = {}, identity = {}) {
  const details = item.type_details && typeof item.type_details === 'object' ? item.type_details : {};
  const externalId = optionalFact(identity.providerItemId || details.provider_item_id);
  const derivedKind = externalId?.match(/^kavita:(series|chapter):[1-9]\d*$/i)?.[1]?.toLowerCase() || null;
  const identityKind = optionalFact(identity.identityKind || derivedKind);
  if (!externalId || !derivedKind || !['series', 'chapter'].includes(identityKind) || derivedKind !== identityKind) {
    throw new TypeError('Kavita provider observation requires a series or chapter identity');
  }
  return Object.freeze({
    sourceKind: 'kavita_api',
    sourceUpdatedAt: details.source_updated_at || null,
    facts: {
      identity: {
        kind: identityKind,
        externalId
      },
      bibliographic: {
        title: optionalFact(item.title),
        mediaType: optionalFact(item.media_type),
        year: optionalNumber(item.year),
        releaseDate: optionalFact(item.release_date),
        format: optionalFact(item.format),
        author: optionalFact(details.author),
        publisher: optionalFact(details.publisher),
        isbn: optionalFact(details.isbn),
        edition: optionalFact(details.edition),
        series: optionalFact(details.series),
        issueNumber: optionalFact(details.issue_number),
        volume: optionalFact(details.volume),
        coverDate: optionalFact(details.cover_date)
      },
      kavita: {
        library: {
          id: optionalNumber(details.kavita_library_id),
          name: optionalFact(details.kavita_library_name),
          type: optionalFact(details.kavita_library_type)
        },
        series: {
          id: optionalNumber(details.kavita_series_id),
          name: optionalFact(details.kavita_series_name),
          localizedName: optionalFact(details.kavita_localized_name),
          originalName: optionalFact(details.kavita_original_name),
          sortName: optionalFact(details.kavita_sort_name),
          externalId: optionalFact(details.kavita_series_provider_item_id)
            || (identityKind === 'series' ? externalId : optionalFact(details.kavita_parent_provider_item_id))
        },
        chapter: identityKind === 'chapter' ? {
          id: optionalNumber(details.kavita_chapter_id),
          externalId: optionalFact(details.kavita_chapter_provider_item_id) || externalId,
          volumeId: optionalNumber(details.kavita_volume_id),
          number: optionalFact(details.kavita_chapter_number),
          title: optionalFact(details.kavita_chapter_title),
          sortOrder: optionalFact(details.kavita_chapter_sort_order),
          releaseDate: optionalFact(details.kavita_chapter_release_date),
          pages: optionalNumber(details.kavita_chapter_pages),
          special: optionalBoolean(details.kavita_chapter_special)
        } : null,
        chapterFanout: optionalBoolean(details.kavita_chapter_fanout),
        titleParseStatus: optionalFact(details.kavita_title_parse_status),
        format: optionalFact(details.kavita_format),
        pages: optionalNumber(details.kavita_pages),
        volumeDetailStatus: optionalFact(details.kavita_volume_detail_status),
        volumeCount: optionalNumber(details.kavita_volume_count),
        chapterCount: optionalNumber(details.kavita_chapter_count)
      },
      cover: {
        proxyPath: optionalFact(details.kavita_cover_proxy_url),
        source: optionalFact(details.kavita_cover_source),
        status: optionalFact(details.kavita_cover_status)
      }
    }
  });
}

module.exports = {
  OBSERVATION_COMPARISON_FIELDS,
  applyProviderObservationPreview,
  appendProviderObservationFieldReview,
  appendProviderSourceObservation,
  buildProviderObservationApplyPreview,
  buildProviderObservationComparison,
  buildBookOrbitSourceObservation,
  buildKavitaSourceObservation,
  listProviderSourceObservations,
  loadBookOrbitIdentityRematchPreview,
  loadProviderObservationApplyPreview,
  normalizeFacts,
  publicObservation,
  publicObservationReadback,
  publicProviderObservationApplyEvent
};
