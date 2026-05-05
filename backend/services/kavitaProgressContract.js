'use strict';

const READER_GET_PROGRESS_ENDPOINT = '/api/Reader/get-progress';
const READER_HAS_PROGRESS_ENDPOINT = '/api/Reader/has-progress';
const READER_CONTINUE_POINT_ENDPOINT = '/api/Reader/continue-point';

const PROGRESS_WRITE_ENDPOINTS = Object.freeze([
  '/api/Reader/progress',
  '/api/Reader/mark-read',
  '/api/Reader/mark-unread',
  '/api/Reader/mark-chapter-read',
  '/api/Reader/mark-volume-read',
  '/api/Panels/save-progress',
  '/api/Koreader/{apiKey}/syncs/progress'
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
    implementationEnabled: false
  };
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
    progressSyncImplementationEnabled: false,
    recommendation: 'read-only progress visibility before any writeback',
    endpoints: {
      getProgress: {
        method: 'GET',
        endpoint: READER_GET_PROGRESS_ENDPOINT,
        query: ['chapterId']
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
      }
    },
    prohibitedWriteEndpoints: [...PROGRESS_WRITE_ENDPOINTS],
    readbackFields: [...PROGRESS_READ_FIELDS],
    safetyRequirements: [
      'workspace-owned Kavita connection',
      'signed-in collectZ user ownership decision before persistence',
      'read-only progress preview before writeback',
      'no progress write endpoints in the first implementation',
      'backend-only credential use',
      'secret-free browser readback',
      'audit log before any later writeback'
    ],
    nonGoals: [
      'embedded Kavita reader',
      'reader page proxying',
      'automatic progress writeback',
      'KOReader sync shortcut',
      'shared digital-library progress abstraction'
    ]
  };
}

module.exports = {
  READER_GET_PROGRESS_ENDPOINT,
  READER_HAS_PROGRESS_ENDPOINT,
  READER_CONTINUE_POINT_ENDPOINT,
  PROGRESS_WRITE_ENDPOINTS,
  PROGRESS_READ_FIELDS,
  buildKavitaProgressReadRequest,
  normalizeKavitaProgressReadback,
  buildKavitaProgressContractProbe
};
