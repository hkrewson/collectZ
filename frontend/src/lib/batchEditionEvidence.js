function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function text(value) {
  const normalized = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || null;
}

function safeHttpUrl(value) {
  const candidate = text(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function batchEditionEvidence(item = {}) {
  const context = record(item.source_context);
  const identifiers = record(context.identifiers);
  const metadata = record(context.page_metadata);
  const releaseDetails = record(metadata.release_details);
  const specs = record(metadata.specs);
  const ratings = record(metadata.ratings);
  return {
    title: text(item.title),
    releaseTitle: text(metadata.release_title) || text(item.title),
    mediaFormat: text(metadata.media_format),
    edition: text(metadata.edition),
    country: text(metadata.country),
    year: text(releaseDetails.year),
    studio: text(releaseDetails.studio),
    runtime: text(releaseDetails.runtime),
    contentRating: text(releaseDetails.rating),
    releaseDate: text(releaseDetails.release_date),
    blurayProductId: text(identifiers.bluray_product_id),
    blurayContentId: text(identifiers.bluray_content_id),
    blurayCategoryId: text(identifiers.bluray_category_id),
    blurayGlobalParentId: text(identifiers.bluray_global_parent_id),
    blurayGlobalProductId: text(identifiers.bluray_global_product_id),
    upc: text(identifiers.upc),
    ean: text(identifiers.ean),
    asin: text(identifiers.asin),
    imdbId: text(identifiers.imdb_id),
    specs: Object.entries(specs)
      .map(([label, value]) => ({ label, value: text(value) }))
      .filter((entry) => entry.value),
    ratings: Object.entries(ratings)
      .map(([label, value]) => ({ label, value: text(value) }))
      .filter((entry) => entry.value),
    coverUrl: safeHttpUrl(metadata.cover_image_url),
    sourceUrl: safeHttpUrl(context.url),
    enrichmentStatus: text(context.enrichment_status) || 'list_only',
    enrichmentError: text(context.enrichment_error),
    ownershipBasis: text(context.ownership_basis),
    extensionVersion: text(context.extension_version),
    capturedAt: text(context.captured_at)
  };
}

export function canIncludeBatchEdition(item = {}) {
  const evidence = batchEditionEvidence(item);
  const sourceStatus = text(item.source_status)?.toLowerCase();
  return evidence.enrichmentStatus === 'enriched' && ['owned', 'in collection'].includes(sourceStatus);
}
