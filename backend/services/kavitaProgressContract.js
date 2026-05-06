'use strict';

const READER_GET_PROGRESS_ENDPOINT = '/api/Reader/get-progress';
const READER_SET_PROGRESS_ENDPOINT = '/api/Reader/progress';
const READER_CHAPTER_INFO_ENDPOINT = '/api/Reader/chapter-info';
const READER_IMAGE_ENDPOINT = '/api/Reader/image';
const READER_HAS_PROGRESS_ENDPOINT = '/api/Reader/has-progress';
const READER_CONTINUE_POINT_ENDPOINT = '/api/Reader/continue-point';
const READER_MARK_READ_ENDPOINT = '/api/Reader/mark-read';
const READER_MARK_UNREAD_ENDPOINT = '/api/Reader/mark-unread';
const READER_MARK_CHAPTER_READ_ENDPOINT = '/api/Reader/mark-chapter-read';
const READER_MARK_VOLUME_READ_ENDPOINT = '/api/Reader/mark-volume-read';
const PANELS_SAVE_PROGRESS_ENDPOINT = '/api/Panels/save-progress';
const KOREADER_PROGRESS_SYNC_ENDPOINT = '/api/Koreader/{apiKey}/syncs/progress';

const PROGRESS_WRITE_ENDPOINTS = Object.freeze([
  READER_SET_PROGRESS_ENDPOINT,
  READER_MARK_READ_ENDPOINT,
  READER_MARK_UNREAD_ENDPOINT,
  READER_MARK_CHAPTER_READ_ENDPOINT,
  READER_MARK_VOLUME_READ_ENDPOINT,
  PANELS_SAVE_PROGRESS_ENDPOINT,
  KOREADER_PROGRESS_SYNC_ENDPOINT
]);

const PROGRESS_UNSUPPORTED_WRITE_ENDPOINTS = Object.freeze([
  READER_MARK_READ_ENDPOINT,
  READER_MARK_UNREAD_ENDPOINT,
  READER_MARK_VOLUME_READ_ENDPOINT,
  PANELS_SAVE_PROGRESS_ENDPOINT,
  KOREADER_PROGRESS_SYNC_ENDPOINT
]);

const READ_STATE_DISABLED_WRITE_ENDPOINTS = Object.freeze([
  READER_MARK_READ_ENDPOINT,
  READER_MARK_UNREAD_ENDPOINT,
  READER_MARK_VOLUME_READ_ENDPOINT,
  PANELS_SAVE_PROGRESS_ENDPOINT,
  KOREADER_PROGRESS_SYNC_ENDPOINT
]);

const PROGRESS_READ_FIELDS = Object.freeze([
  'libraryId',
  'seriesId',
  'volumeId',
  'chapterId',
  'pageNum',
  'bookScrollId',
  'lastModifiedUtc'
]);

function normalizePositiveInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function buildKavitaProgressReadRequest({ chapterId } = {}) {
  const id = normalizePositiveInt(chapterId);
  if (!id) throw new Error('Kavita progress read requires a chapterId');
  return {
    provider: 'kavita',
    method: 'GET',
    endpoint: READER_GET_PROGRESS_ENDPOINT,
    query: { chapterId: id },
    readOnly: true,
    implementationEnabled: true
  };
}

function buildKavitaProgressWritePayload({
  libraryId,
  seriesId,
  volumeId,
  chapterId,
  pageNum,
  bookScrollId = null,
  lastModifiedUtc = null
} = {}) {
  const payload = {
    libraryId: normalizePositiveInt(libraryId),
    seriesId: normalizePositiveInt(seriesId),
    volumeId: normalizePositiveInt(volumeId),
    chapterId: normalizePositiveInt(chapterId),
    pageNum: Number.isInteger(Number(pageNum)) && Number(pageNum) >= 0 ? Number(pageNum) : null,
    bookScrollId: bookScrollId === undefined || bookScrollId === null || String(bookScrollId).trim() === ''
      ? null
      : String(bookScrollId).trim(),
    lastModifiedUtc: lastModifiedUtc || new Date().toISOString()
  };
  const missing = ['libraryId', 'seriesId', 'volumeId', 'chapterId', 'pageNum']
    .filter((field) => payload[field] === null || payload[field] === undefined);
  if (missing.length > 0) {
    throw new Error(`Kavita progress write requires ${missing.join(', ')}`);
  }
  return payload;
}

function buildKavitaChapterReadStatePayload({
  seriesId,
  chapterId,
  generateReadingSession = false
} = {}) {
  const payload = {
    seriesId: normalizePositiveInt(seriesId),
    chapterId: normalizePositiveInt(chapterId),
    generateReadingSession: Boolean(generateReadingSession)
  };
  const missing = ['seriesId', 'chapterId']
    .filter((field) => payload[field] === null || payload[field] === undefined);
  if (missing.length > 0) {
    throw new Error(`Kavita chapter read-state write requires ${missing.join(', ')}`);
  }
  return payload;
}

function normalizeKavitaProgressReadback(progress = {}) {
  const output = {};
  for (const field of PROGRESS_READ_FIELDS) {
    if (progress[field] === undefined || progress[field] === null) continue;
    output[field] = progress[field];
  }
  return output;
}

function buildKavitaProgressContractProbe() {
  return {
    provider: 'kavita',
    progressSyncImplementationEnabled: true,
    recommendation: 'explicit user-confirmed progress writeback, chapter mark-read, and server-side page proxying',
    endpoints: {
      getProgress: {
        method: 'GET',
        endpoint: READER_GET_PROGRESS_ENDPOINT,
        query: ['chapterId']
      },
      setProgress: {
        method: 'POST',
        endpoint: READER_SET_PROGRESS_ENDPOINT,
        body: ['libraryId', 'seriesId', 'volumeId', 'chapterId', 'pageNum', 'bookScrollId', 'lastModifiedUtc']
      },
      chapterInfo: {
        method: 'GET',
        endpoint: READER_CHAPTER_INFO_ENDPOINT,
        query: ['chapterId', 'extractPdf', 'includeDimensions']
      },
      readerImage: {
        method: 'GET',
        endpoint: READER_IMAGE_ENDPOINT,
        query: ['chapterId', 'page', 'apiKey', 'extractPdf']
      },
      hasProgress: {
        method: 'GET',
        endpoint: READER_HAS_PROGRESS_ENDPOINT,
        query: ['seriesId']
      },
      continuePoint: {
        method: 'GET',
        endpoint: READER_CONTINUE_POINT_ENDPOINT,
        query: ['seriesId']
      },
      markSeriesRead: {
        method: 'POST',
        endpoint: READER_MARK_READ_ENDPOINT,
        body: ['seriesId', 'generateReadingSession']
      },
      markSeriesUnread: {
        method: 'POST',
        endpoint: READER_MARK_UNREAD_ENDPOINT,
        body: ['seriesId', 'generateReadingSession']
      },
      markChapterRead: {
        method: 'POST',
        endpoint: READER_MARK_CHAPTER_READ_ENDPOINT,
        body: ['seriesId', 'chapterId', 'generateReadingSession']
      },
      markVolumeRead: {
        method: 'POST',
        endpoint: READER_MARK_VOLUME_READ_ENDPOINT,
        body: ['seriesId', 'volumeId', 'generateReadingSession']
      }
    },
    readStateImplementationEnabled: true,
    enabledWriteEndpoints: [READER_SET_PROGRESS_ENDPOINT, READER_MARK_CHAPTER_READ_ENDPOINT],
    prohibitedWriteEndpoints: [...PROGRESS_UNSUPPORTED_WRITE_ENDPOINTS],
    readStateContract: {
      enabledEndpoint: READER_MARK_CHAPTER_READ_ENDPOINT,
      enabledBody: ['seriesId', 'chapterId', 'generateReadingSession'],
      disabledWriteEndpoints: [...READ_STATE_DISABLED_WRITE_ENDPOINTS],
      disabledReasons: [
        'series-level mark read/unread mutates every volume and chapter',
        'volume-level mark read mutates all chapters in a volume',
        'Kavita exposes no matching chapter-level mark-unread endpoint in the checked OpenAPI snapshot',
        'collectZ has not defined per-user Kavita identity beyond the workspace-owned service account'
      ]
    },
    readbackFields: [...PROGRESS_READ_FIELDS],
    safetyRequirements: [
      'workspace-owned Kavita connection',
      'signed-in collectZ user ownership decision before persistence',
      'explicit user action before progress writeback',
      'explicit user action before chapter mark-read',
      'backend-only credential use',
      'secret-free browser readback',
      'audit log for progress writeback and chapter mark-read'
    ],
    nonGoals: [
      'iframe Kavita reader with browser-visible Kavita credentials',
      'automatic progress writeback',
      'series or volume mark-read shortcuts',
      'mark-unread shortcuts',
      'KOReader sync shortcut',
      'shared digital-library progress abstraction'
    ]
  };
}

module.exports = {
  READER_GET_PROGRESS_ENDPOINT,
  READER_SET_PROGRESS_ENDPOINT,
  READER_CHAPTER_INFO_ENDPOINT,
  READER_IMAGE_ENDPOINT,
  READER_HAS_PROGRESS_ENDPOINT,
  READER_CONTINUE_POINT_ENDPOINT,
  READER_MARK_READ_ENDPOINT,
  READER_MARK_UNREAD_ENDPOINT,
  READER_MARK_CHAPTER_READ_ENDPOINT,
  READER_MARK_VOLUME_READ_ENDPOINT,
  PANELS_SAVE_PROGRESS_ENDPOINT,
  KOREADER_PROGRESS_SYNC_ENDPOINT,
  PROGRESS_WRITE_ENDPOINTS,
  PROGRESS_UNSUPPORTED_WRITE_ENDPOINTS,
  READ_STATE_DISABLED_WRITE_ENDPOINTS,
  PROGRESS_READ_FIELDS,
  buildKavitaProgressReadRequest,
  buildKavitaProgressWritePayload,
  buildKavitaChapterReadStatePayload,
  normalizeKavitaProgressReadback,
  buildKavitaProgressContractProbe
};
