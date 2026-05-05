'use strict';

const SERIES_METADATA_ENDPOINT = '/api/Series/metadata';
const CHAPTER_METADATA_ENDPOINT = '/api/Chapter/update';

const SERIES_WRITEBACK_FIELDS = Object.freeze([
  'summary',
  'genres',
  'tags',
  'writers',
  'publishers',
  'releaseYear',
  'language',
  'webLinks'
]);

const CHAPTER_WRITEBACK_FIELDS = Object.freeze([
  'summary',
  'genres',
  'tags',
  'writers',
  'publishers',
  'isbn',
  'releaseDate',
  'titleName',
  'webLinks'
]);

const LOCK_FIELD_SUFFIX = 'Locked';

function normalizeFieldSelection(selectedFields = [], allowedFields = []) {
  const allowed = new Set(allowedFields);
  const fields = Array.isArray(selectedFields) ? selectedFields : [];
  return [...new Set(fields.map((field) => String(field || '').trim()).filter((field) => allowed.has(field)))];
}

function pickSelectedMetadata(metadata = {}, selectedFields = [], allowedFields = []) {
  const selected = normalizeFieldSelection(selectedFields, allowedFields);
  const skippedFields = [];
  const picked = {};

  for (const field of selected) {
    const lockField = `${field}${LOCK_FIELD_SUFFIX}`;
    if (metadata[lockField] === true) {
      skippedFields.push({ field, reason: 'locked' });
      continue;
    }
    if (metadata[field] === undefined) {
      skippedFields.push({ field, reason: 'missing' });
      continue;
    }
    picked[field] = metadata[field];
  }

  return { picked, selectedFields: selected, skippedFields };
}

function buildKavitaSeriesMetadataWritebackPayload({ seriesId, metadata = {}, selectedFields = [] } = {}) {
  const id = Number(seriesId || metadata.seriesId || 0) || null;
  if (!id) throw new Error('Kavita series metadata writeback requires a seriesId');
  const { picked, selectedFields: selected, skippedFields } = pickSelectedMetadata(
    metadata,
    selectedFields,
    SERIES_WRITEBACK_FIELDS
  );

  return {
    provider: 'kavita',
    method: 'POST',
    endpoint: SERIES_METADATA_ENDPOINT,
    implementationEnabled: false,
    body: {
      seriesMetadata: {
        seriesId: id,
        ...picked
      }
    },
    selectedFields: selected,
    skippedFields
  };
}

function buildKavitaChapterMetadataWritebackPayload({ chapterId, metadata = {}, selectedFields = [] } = {}) {
  const id = Number(chapterId || metadata.id || 0) || null;
  if (!id) throw new Error('Kavita chapter metadata writeback requires a chapterId');
  const { picked, selectedFields: selected, skippedFields } = pickSelectedMetadata(
    metadata,
    selectedFields,
    CHAPTER_WRITEBACK_FIELDS
  );

  return {
    provider: 'kavita',
    method: 'POST',
    endpoint: CHAPTER_METADATA_ENDPOINT,
    implementationEnabled: false,
    body: {
      id,
      ...picked
    },
    selectedFields: selected,
    skippedFields
  };
}

function buildKavitaMetadataWritebackProbe() {
  return {
    provider: 'kavita',
    implementationEnabled: false,
    endpoints: {
      seriesMetadata: {
        method: 'POST',
        endpoint: SERIES_METADATA_ENDPOINT,
        bodyWrapper: 'seriesMetadata'
      },
      chapterMetadata: {
        method: 'POST',
        endpoint: CHAPTER_METADATA_ENDPOINT,
        bodyWrapper: null
      }
    },
    firstFieldSet: {
      series: [...SERIES_WRITEBACK_FIELDS],
      chapter: [...CHAPTER_WRITEBACK_FIELDS]
    },
    safetyRequirements: [
      'workspace-owned integration opt-in',
      'read-before-write metadata snapshot',
      'preview diff before mutation',
      'explicit field selection',
      'Kavita lock-field awareness',
      'audit log for every attempted writeback',
      'backend-only credential use'
    ],
    nonGoals: [
      'automatic bidirectional sync',
      'reader/progress writeback',
      'cross-provider writeback abstraction',
      'external enrichment writeback without user review'
    ]
  };
}

module.exports = {
  SERIES_METADATA_ENDPOINT,
  CHAPTER_METADATA_ENDPOINT,
  SERIES_WRITEBACK_FIELDS,
  CHAPTER_WRITEBACK_FIELDS,
  buildKavitaMetadataWritebackProbe,
  buildKavitaSeriesMetadataWritebackPayload,
  buildKavitaChapterMetadataWritebackPayload
};
