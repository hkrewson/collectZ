'use strict';

const { appendScopeSql } = require('../db/scopeContext');
const { buildOwnedFormatsPayload, getOwnedFormatLabel, sortOwnedFormats } = require('./mediaFormats');

const BLURAY_VARIANT_SOURCE = 'blu-ray.com';
const BLURAY_VALUATION_SOURCE = 'blu-ray.com used-from';

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cleanString(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || null;
}

function boundedString(value, maxLength) {
  const text = cleanString(value);
  return text ? text.slice(0, maxLength) : null;
}

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function positiveInteger(value) {
  const match = String(value ?? '').match(/\d+/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function isoDate(value) {
  const text = cleanString(value);
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function isoTimestamp(value) {
  const text = cleanString(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function formatsFromBlurayLabel(value) {
  const label = String(value || '').toLowerCase();
  const formats = [];
  if (/4k|ultra hd|\buhd\b/.test(label)) formats.push('uhd');
  if (/blu[ -]?ray|\bbd\b/.test(label)) formats.push('bluray');
  if (/\bdvd\b/.test(label)) formats.push('dvd');
  if (/digital/.test(label)) formats.push('digital');
  return sortOwnedFormats('movie', formats);
}

function parseLegacyUsedPrice(value, country = null) {
  const text = cleanString(value);
  if (!text) return null;
  const match = text.match(/\bUsed from\s*:\s*((?:US\$|CA\$|A\$|\$|£|€)?\s*[0-9][0-9.,]*)(?:\s*\(Save\s+([0-9]+(?:\.[0-9]+)?)%\))?/i);
  if (!match) return null;
  const display = cleanString(match[1]);
  if (!display) return null;
  const token = display.replace(/[^0-9.,]/g, '');
  const lastComma = token.lastIndexOf(',');
  const lastDot = token.lastIndexOf('.');
  let normalized;
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? ',' : '.';
    normalized = token.replace(decimal === ',' ? /\./g : /,/g, '').replace(decimal, '.');
  } else if (lastComma >= 0) {
    normalized = /,\d{1,2}$/.test(token) ? token.replace(/\./g, '').replace(',', '.') : token.replace(/,/g, '');
  } else {
    normalized = token.replace(/,/g, '');
  }
  const amount = positiveNumber(normalized);
  if (amount === null) return null;
  let currency = null;
  if (display.includes('€')) currency = 'EUR';
  else if (display.includes('£')) currency = 'GBP';
  else if (/CA\$/i.test(display) || /Canada/i.test(country || '')) currency = 'CAD';
  else if (/A\$/i.test(display) || /Australia/i.test(country || '')) currency = 'AUD';
  else if (display.includes('$') || /United States/i.test(country || '')) currency = 'USD';
  return {
    amount,
    currency,
    display,
    seller: 'Amazon',
    condition: 'used',
    savings_percent: match[2] ? Number(match[2]) : null
  };
}

function parseCodec(specText, label) {
  const text = cleanString(specText);
  if (!text) return null;
  if (label === 'video') return cleanString(text.match(/\bCodec:\s*(.+?)(?=\s+Resolution:|\s+HDR:|$)/i)?.[1]);
  return cleanString(text.match(/(?:^|\s)(?:English:\s*)?(.+?)(?=\s+English:|\s+French|\s+German|\s+Spanish|$)/i)?.[1]);
}

function buildPreview(mapping) {
  if (!mapping?.available) return [];
  const preview = [];
  const hints = mapping.import_hints || {};
  if (hints.year) preview.push({ key: 'year', label: 'Year', value: String(hints.year) });
  if (hints.runtime) preview.push({ key: 'runtime', label: 'Runtime', value: `${hints.runtime} min` });
  if (Array.isArray(hints.owned_formats) && hints.owned_formats.length) {
    preview.push({
      key: 'owned_formats',
      label: 'Formats',
      value: hints.owned_formats.map((value) => getOwnedFormatLabel('movie', value) || value).join(' + ')
    });
  }
  if (mapping.variant?.edition) preview.push({ key: 'edition', label: 'Edition', value: mapping.variant.edition });
  if (mapping.identifiers?.imdb_id) preview.push({ key: 'imdb_id', label: 'IMDb', value: mapping.identifiers.imdb_id });
  if (hints.poster_path) preview.push({ key: 'cover', label: 'Cover', value: 'Edition cover' });
  if (hints.trailer_url) preview.push({ key: 'trailer', label: 'Trailer', value: 'Trailer' });
  if (mapping.valuation?.used_amount !== null && mapping.valuation?.used_amount !== undefined) {
    preview.push({
      key: 'valuation',
      label: 'Used value',
      value: mapping.valuation.display || `${mapping.valuation.currency || ''} ${mapping.valuation.used_amount}`.trim()
    });
  }
  return preview;
}

function buildBrowserCaptureMapping(sourceContext = {}) {
  const context = objectValue(sourceContext);
  const adapter = cleanString(context.adapter)?.toLowerCase();
  const source = cleanString(context.source)?.toLowerCase();
  const clientSource = cleanString(context.client_source)?.toLowerCase();
  if (adapter !== 'bluray' || (source !== 'browser_extension' && clientSource !== 'browser-extension')) {
    return { available: false, provider: null, preview: [] };
  }

  const pageMetadata = objectValue(context.page_metadata);
  const identifiers = objectValue(context.identifiers);
  const releaseDetails = objectValue(pageMetadata.release_details);
  const specs = objectValue(pageMetadata.specs);
  const pricing = objectValue(pageMetadata.pricing);
  const structuredUsed = objectValue(pricing.used);
  const legacyUsed = Object.keys(structuredUsed).length > 0 ? null : parseLegacyUsedPrice(specs.price, pageMetadata.country);
  const usedAmount = positiveNumber(structuredUsed.amount ?? legacyUsed?.amount);
  const usedCurrency = cleanString(structuredUsed.currency ?? legacyUsed?.currency)?.toUpperCase() || null;
  const usedDisplay = cleanString(structuredUsed.display ?? legacyUsed?.display);
  const mediaFormat = cleanString(pageMetadata.media_format || pageMetadata.edition || pageMetadata.release_title);
  const ownedFormats = formatsFromBlurayLabel(mediaFormat);
  const year = positiveInteger(releaseDetails.year);
  const runtime = positiveInteger(releaseDetails.runtime);
  const productId = boundedString(identifiers.bluray_product_id || pageMetadata.bluray_product_id, 255);
  const edition = cleanString(pageMetadata.edition || pageMetadata.release_title);
  const providerUrl = cleanString(context.canonical_url || context.url);
  const posterPath = cleanString(pageMetadata.cover_image_url);
  const trailerUrl = cleanString(pageMetadata.trailer_url);
  const capturedAt = isoTimestamp(context.captured_at);
  const physicalReleaseDate = isoDate(releaseDetails.release_date);

  const mapping = {
    available: true,
    provider: BLURAY_VARIANT_SOURCE,
    import_hints: {
      year,
      runtime,
      format: buildOwnedFormatsPayload('movie', ownedFormats, mediaFormat).format,
      owned_formats: ownedFormats,
      poster_path: posterPath,
      trailer_url: trailerUrl,
      upc: cleanString(identifiers.upc || identifiers.ean),
      type_details: {
        edition,
        provider_name: BLURAY_VARIANT_SOURCE,
        provider_item_id: productId,
        provider_external_url: providerUrl
      }
    },
    identifiers: {
      imdb_id: cleanString(identifiers.imdb_id),
      asin: cleanString(identifiers.asin),
      bluray_product_id: productId,
      bluray_content_id: cleanString(identifiers.bluray_content_id || pageMetadata.bluray_content_id),
      bluray_category_id: cleanString(identifiers.bluray_category_id || pageMetadata.bluray_category_id),
      bluray_global_parent_id: cleanString(identifiers.bluray_global_parent_id || pageMetadata.bluray_global_parent_id),
      bluray_global_product_id: cleanString(identifiers.bluray_global_product_id || pageMetadata.bluray_global_product_id)
    },
    valuation: usedAmount === null ? null : {
      used_amount: usedAmount,
      currency: usedCurrency,
      display: usedDisplay,
      source: BLURAY_VALUATION_SOURCE,
      observed_at: capturedAt
    },
    variant: productId ? {
      source: BLURAY_VARIANT_SOURCE,
      source_item_key: productId,
      source_media_id: boundedString(identifiers.bluray_global_product_id || pageMetadata.bluray_global_product_id, 255),
      source_part_id: boundedString(identifiers.bluray_content_id || pageMetadata.bluray_content_id, 255),
      edition: boundedString(edition, 255),
      container: boundedString(mediaFormat, 50),
      video_codec: boundedString(parseCodec(specs.video, 'video'), 50),
      audio_codec: boundedString(parseCodec(specs.audio, 'audio'), 50),
      resolution: boundedString(String(specs.video || '').match(/\bResolution:\s*(.+?)(?=\s+HDR:|\s+Aspect ratio:|$)/i)?.[1], 50),
      runtime_minutes: runtime,
      raw_json: {
        contract: cleanString(context.contract),
        extension_version: cleanString(context.extension_version),
        url: cleanString(context.url),
        canonical_url: providerUrl,
        captured_at: capturedAt,
        physical_release_date: physicalReleaseDate,
        identifiers,
        commerce: objectValue(context.commerce),
        page_metadata: pageMetadata
      }
    } : null
  };
  mapping.preview = buildPreview(mapping);
  return mapping;
}

function compactObject(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined && entry !== ''));
}

async function upsertMetadata(db, mediaId, key, value) {
  if (!value) return false;
  await db.query(
    `INSERT INTO media_metadata (media_id, "key", "value")
     VALUES ($1, $2, $3)
     ON CONFLICT (media_id, "key") DO UPDATE SET "value" = EXCLUDED."value"`,
    [mediaId, key, value]
  );
  return true;
}

async function applyBrowserCaptureMapping({ db, mediaId, scopeContext = null, mapping }) {
  if (!mapping?.available || !mediaId) return { applied: [], skipped: ['mapping_unavailable'], variant_id: null };
  const params = [mediaId];
  const scopeClause = appendScopeSql(params, scopeContext);
  const currentResult = await db.query(`SELECT * FROM media WHERE id = $1${scopeClause} LIMIT 1`, params);
  const current = currentResult.rows[0];
  if (!current) throw new Error('Mapped media item was not found in the active scope.');
  if (current.media_type !== 'movie') {
    return { applied: [], skipped: ['unsupported_media_type'], variant_id: null };
  }

  const hints = mapping.import_hints || {};
  const mergedFormats = sortOwnedFormats('movie', [
    ...(Array.isArray(current.owned_formats) ? current.owned_formats : []),
    ...(Array.isArray(hints.owned_formats) ? hints.owned_formats : [])
  ]);
  const formatState = buildOwnedFormatsPayload('movie', mergedFormats, hints.format || current.format);
  const nextTypeDetails = compactObject(hints.type_details || {});
  const applied = [];
  const skipped = [];
  const recordCanonicalOutcome = (key, currentValue, incomingValue) => {
    if (incomingValue === null || incomingValue === undefined || incomingValue === '') return;
    if (currentValue === null || currentValue === undefined || currentValue === '' || String(currentValue) === String(incomingValue)) {
      applied.push(key);
    } else {
      skipped.push(`${key}_preserved`);
    }
  };
  recordCanonicalOutcome('year', current.year, hints.year);
  recordCanonicalOutcome('runtime', current.runtime, hints.runtime);
  recordCanonicalOutcome('cover', current.poster_path, hints.poster_path);
  recordCanonicalOutcome('trailer', current.trailer_url, hints.trailer_url);
  recordCanonicalOutcome('upc', current.upc, hints.upc);
  if (Array.isArray(hints.owned_formats) && hints.owned_formats.length) applied.push('owned_formats');
  if (Object.keys(nextTypeDetails).length) applied.push('edition_details');
  await db.query(
    `UPDATE media
        SET year = COALESCE(year, $2),
            runtime = COALESCE(runtime, $3),
            format = COALESCE($4, format),
            owned_formats = $5::text[],
            poster_path = COALESCE(poster_path, $6),
            trailer_url = COALESCE(trailer_url, $7),
            upc = COALESCE(upc, $8),
            type_details = $9::jsonb || COALESCE(type_details, '{}'::jsonb),
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [
      mediaId,
      hints.year || null,
      hints.runtime || null,
      formatState.format || null,
      formatState.ownedFormats,
      hints.poster_path || null,
      hints.trailer_url || null,
      hints.upc || null,
      JSON.stringify(nextTypeDetails)
    ]
  );

  if (mapping.identifiers?.imdb_id) {
    await upsertMetadata(db, mediaId, 'imdb_id', mapping.identifiers.imdb_id);
    applied.push('imdb_id');
  }
  if (mapping.identifiers?.asin) {
    await upsertMetadata(db, mediaId, 'amazon_item_id', mapping.identifiers.asin);
    applied.push('asin');
  }

  let variantId = null;
  if (mapping.variant?.source_item_key) {
    const variant = mapping.variant;
    const variantResult = await db.query(
      `INSERT INTO media_variants (
         media_id, source, source_item_key, source_media_id, source_part_id, edition, container,
         video_codec, audio_codec, resolution, runtime_minutes, raw_json
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
       ON CONFLICT (media_id, source, source_item_key) WHERE source = 'blu-ray.com' AND source_item_key IS NOT NULL
       DO UPDATE SET
         source_media_id = EXCLUDED.source_media_id,
         source_part_id = EXCLUDED.source_part_id,
         edition = EXCLUDED.edition,
         container = EXCLUDED.container,
         video_codec = EXCLUDED.video_codec,
         audio_codec = EXCLUDED.audio_codec,
         resolution = EXCLUDED.resolution,
         runtime_minutes = EXCLUDED.runtime_minutes,
         raw_json = EXCLUDED.raw_json,
         updated_at = CURRENT_TIMESTAMP
       RETURNING id`,
      [
        mediaId, variant.source, variant.source_item_key, variant.source_media_id, variant.source_part_id,
        variant.edition, variant.container, variant.video_codec, variant.audio_codec, variant.resolution,
        variant.runtime_minutes, JSON.stringify(variant.raw_json || {})
      ]
    );
    variantId = variantResult.rows[0]?.id || null;
    applied.push('physical_variant');
  }

  if (mapping.valuation?.used_amount !== null && mapping.valuation?.used_amount !== undefined) {
    const currentSource = cleanString(current.valuation_source)?.toLowerCase();
    const sourceOwned = currentSource === BLURAY_VALUATION_SOURCE;
    const hasExistingValue = [current.estimated_value_low, current.estimated_value_mid, current.estimated_value_high]
      .some((value) => value !== null && value !== undefined && value !== '');
    const currentObserved = current.valuation_last_updated ? new Date(current.valuation_last_updated).getTime() : null;
    const nextObserved = mapping.valuation.observed_at ? new Date(mapping.valuation.observed_at).getTime() : Date.now();
    const isNewer = !currentObserved || !Number.isFinite(currentObserved) || nextObserved >= currentObserved;
    if ((!hasExistingValue || sourceOwned) && isNewer) {
      await db.query(
        `UPDATE media
            SET estimated_value_low = $2,
                valuation_currency = COALESCE($3, valuation_currency),
                valuation_source = $4,
                valuation_last_updated = $5,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [mediaId, mapping.valuation.used_amount, mapping.valuation.currency, BLURAY_VALUATION_SOURCE, new Date(nextObserved).toISOString()]
      );
      applied.push('used_value');
    } else {
      skipped.push(hasExistingValue && !sourceOwned ? 'valuation_preserved' : 'older_valuation_observation');
    }
  }

  return { applied, skipped, variant_id: variantId };
}

module.exports = {
  BLURAY_VARIANT_SOURCE,
  BLURAY_VALUATION_SOURCE,
  buildBrowserCaptureMapping,
  applyBrowserCaptureMapping,
  parseLegacyUsedPrice,
  formatsFromBlurayLabel
};
