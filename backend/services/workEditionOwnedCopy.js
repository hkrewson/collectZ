'use strict';

const crypto = require('crypto');

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function cleanString(value, maxLength = 255) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maxLength) : null;
}

function safeFormats(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((entry) => cleanString(entry, 40)?.toLowerCase())
    .filter(Boolean))].sort();
}

function buildEditionFacts(mapping) {
  const variant = mapping?.variant || {};
  const identifiers = mapping?.identifiers || {};
  const hints = mapping?.import_hints || {};
  return {
    edition_name: cleanString(variant.edition || hints.type_details?.edition),
    release_date: cleanString(variant.raw_json?.physical_release_date, 10),
    format_label: cleanString(variant.container || hints.format, 100),
    owned_formats: safeFormats(hints.owned_formats),
    runtime_minutes: Number.isInteger(Number(variant.runtime_minutes)) ? Number(variant.runtime_minutes) : null,
    resolution: cleanString(variant.resolution, 50),
    video_codec: cleanString(variant.video_codec, 50),
    audio_codec: cleanString(variant.audio_codec, 50),
    identifiers: {
      asin: cleanString(identifiers.asin),
      bluray_content_id: cleanString(identifiers.bluray_content_id),
      bluray_global_parent_id: cleanString(identifiers.bluray_global_parent_id),
      bluray_global_product_id: cleanString(identifiers.bluray_global_product_id),
      imdb_id: cleanString(identifiers.imdb_id)
    },
    valuation: mapping?.valuation ? {
      amount: Number(mapping.valuation.used_amount),
      currency: cleanString(mapping.valuation.currency, 10),
      condition: 'used'
    } : null
  };
}

async function upsertReviewedBluRayOwnership({
  db,
  media,
  mapping,
  captureItemId,
  actorUserId,
  reviewedAt = new Date().toISOString()
}) {
  const spaceId = Number(media?.space_id);
  const libraryId = Number(media?.library_id);
  const mediaId = Number(media?.id);
  const captureId = Number(captureItemId);
  const actorId = Number(actorUserId);
  const sourceProvider = cleanString(mapping?.provider, 80);
  const sourceItemId = cleanString(mapping?.variant?.source_item_key);
  if (![spaceId, libraryId, mediaId, captureId, actorId].every((value) => Number.isInteger(value) && value > 0)) {
    throw new Error('Reviewed Blu-ray ownership requires an exact media, capture, library, workspace, and actor.');
  }
  if (media.media_type !== 'movie' || sourceProvider !== 'blu-ray.com' || !sourceItemId) {
    return { applied: false, reason: 'unsupported_edition_mapping' };
  }

  const existingWork = await db.query(
    `SELECT id FROM collection_works
      WHERE space_id = $1 AND library_id = $2 AND media_id = $3
      LIMIT 1`,
    [spaceId, libraryId, mediaId]
  );
  const workResult = existingWork.rows[0]
    ? existingWork
    : await db.query(
      `INSERT INTO collection_works (space_id, library_id, media_id, work_kind, created_by)
       VALUES ($1, $2, $3, 'movie', $4)
       ON CONFLICT (space_id, library_id, media_id) DO UPDATE
         SET work_kind = EXCLUDED.work_kind
       RETURNING id`,
      [spaceId, libraryId, mediaId, actorId]
    );
  const workId = workResult.rows[0]?.id;

  const facts = buildEditionFacts(mapping);
  const existingEdition = await db.query(
    `SELECT id, work_id FROM collection_editions
      WHERE space_id = $1 AND library_id = $2
        AND source_provider = $3 AND source_item_id = $4
      LIMIT 1`,
    [spaceId, libraryId, sourceProvider, sourceItemId]
  );
  if (existingEdition.rows[0] && existingEdition.rows[0].work_id !== workId) {
    const error = new Error('This Blu-ray edition is already attached to a different Work and needs review.');
    error.status = 409;
    throw error;
  }
  const editionResult = await db.query(
    `INSERT INTO collection_editions (
       space_id, library_id, work_id, source_provider, source_item_id,
       edition_name, release_date, format_label, owned_formats, technical_facts,
       reviewed_at, reviewed_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::text[],$10::jsonb,$11,$12)
     ON CONFLICT (space_id, library_id, source_provider, source_item_id) DO UPDATE SET
       edition_name = EXCLUDED.edition_name,
       release_date = EXCLUDED.release_date,
       format_label = EXCLUDED.format_label,
       owned_formats = EXCLUDED.owned_formats,
       technical_facts = EXCLUDED.technical_facts,
       reviewed_at = EXCLUDED.reviewed_at,
       reviewed_by = EXCLUDED.reviewed_by,
       updated_at = CURRENT_TIMESTAMP
     WHERE collection_editions.work_id = EXCLUDED.work_id
     RETURNING id`,
    [
      spaceId, libraryId, workId, sourceProvider, sourceItemId,
      facts.edition_name, facts.release_date, facts.format_label, facts.owned_formats,
      JSON.stringify({
        runtime_minutes: facts.runtime_minutes,
        resolution: facts.resolution,
        video_codec: facts.video_codec,
        audio_codec: facts.audio_codec
      }),
      reviewedAt, actorId
    ]
  );
  const editionId = editionResult.rows[0]?.id;
  if (!editionId) throw new Error('The reviewed Blu-ray edition could not be attached to this Work.');

  const copyKey = `capture:${captureId}`;
  const existingCopy = await db.query(
    `SELECT id, edition_id FROM owned_copies
      WHERE space_id = $1 AND library_id = $2
        AND source_kind = 'capture_item' AND source_item_key = $3
      LIMIT 1`,
    [spaceId, libraryId, copyKey]
  );
  if (existingCopy.rows[0] && existingCopy.rows[0].edition_id !== editionId) {
    const error = new Error('This capture already created an Owned Copy for a different Edition.');
    error.status = 409;
    throw error;
  }
  const copyResult = await db.query(
    `INSERT INTO owned_copies (
       space_id, library_id, edition_id, ownership_status,
       source_kind, source_item_key, created_by
     ) VALUES ($1,$2,$3,'owned','capture_item',$4,$5)
     ON CONFLICT (space_id, library_id, source_kind, source_item_key) DO UPDATE SET
       ownership_status = 'owned',
       updated_at = CURRENT_TIMESTAMP
     WHERE owned_copies.edition_id = EXCLUDED.edition_id
     RETURNING id`,
    [spaceId, libraryId, editionId, copyKey, actorId]
  );
  const copyId = copyResult.rows[0]?.id;
  if (!copyId) throw new Error('The reviewed capture could not create its Owned Copy.');

  const contentHash = fingerprint(facts);
  const idempotencyKey = fingerprint({ capture_id: captureId, content_hash: contentHash, source_item_id: sourceItemId });
  const observationResult = await db.query(
    `INSERT INTO edition_source_observations (
       space_id, library_id, edition_id, capture_item_id,
       source_provider, source_item_id, idempotency_key, content_hash,
       normalized_facts, source_observed_at, actor_user_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
     ON CONFLICT (space_id, library_id, edition_id, idempotency_key) DO NOTHING
     RETURNING id`,
    [
      spaceId, libraryId, editionId, captureId, sourceProvider, sourceItemId,
      idempotencyKey, contentHash, JSON.stringify(facts),
      mapping?.variant?.raw_json?.captured_at || null, actorId
    ]
  );
  let observationId = observationResult.rows[0]?.id;
  if (!observationId) {
    const existingObservation = await db.query(
      `SELECT id FROM edition_source_observations
        WHERE space_id = $1 AND library_id = $2
          AND edition_id = $3 AND idempotency_key = $4
        LIMIT 1`,
      [spaceId, libraryId, editionId, idempotencyKey]
    );
    observationId = existingObservation.rows[0]?.id;
  }

  return {
    applied: true,
    work: { id: workId, created: existingWork.rowCount === 0 },
    edition: { id: editionId, created: existingEdition.rowCount === 0, provider: sourceProvider, provider_item_id: sourceItemId },
    owned_copy: { id: copyId, created: existingCopy.rowCount === 0, status: 'owned' },
    observation: { id: observationId, created: observationResult.rowCount === 1 }
  };
}

module.exports = {
  buildEditionFacts,
  fingerprint,
  upsertReviewedBluRayOwnership
};
