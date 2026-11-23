'use strict';

const crypto = require('node:crypto');

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

function publicObservationReadback(row) {
  if (!row) return null;
  return Object.freeze({
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
  });
}

async function listProviderSourceObservations(client, {
  spaceId: spaceIdValue,
  mediaId: mediaIdValue,
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

  const [countResult, rowsResult] = await Promise.all([
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
    )
  ]);
  const total = Number(countResult.rows[0]?.total || 0);
  const totalPages = total > 0 ? Math.ceil(total / limit) : 1;
  return Object.freeze({
    observations: Object.freeze(rowsResult.rows.map(publicObservationReadback)),
    pagination: Object.freeze({
      page,
      limit,
      total,
      totalPages,
      hasMore: page < totalPages
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
      seriesMemberships: memberships,
      cover: {
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
  appendProviderSourceObservation,
  buildBookOrbitSourceObservation,
  buildKavitaSourceObservation,
  listProviderSourceObservations,
  normalizeFacts,
  publicObservation,
  publicObservationReadback
};
