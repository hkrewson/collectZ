function toNullableInt(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function extractScopeHints(req) {
  const query = req?.query || {};
  const body = req?.body || {};
  const headers = req?.headers || {};

  const spaceRaw =
    body.space_id ??
    query.space_id ??
    headers['x-space-id'] ??
    null;
  const libraryRaw =
    body.library_id ??
    query.library_id ??
    headers['x-library-id'] ??
    null;

  const spaceId = toNullableInt(spaceRaw) ?? null;

  const libraryIdRaw = libraryRaw;
  const libraryProvided = libraryIdRaw !== null && libraryIdRaw !== undefined && libraryIdRaw !== '';
  const libraryCleared = libraryProvided && String(libraryIdRaw).toLowerCase() === 'all';
  const libraryId = String(libraryIdRaw).toLowerCase() === 'all'
    ? null
    : toNullableInt(libraryIdRaw);

  const spaceProvided = spaceRaw !== null && spaceRaw !== undefined && spaceRaw !== '';

  return {
    spaceId,
    libraryId,
    spaceProvided,
    libraryProvided,
    libraryCleared,
    hasHints: spaceProvided || libraryProvided
  };
}

function resolveScopeContext(req) {
  if (req?.scopeContext) return req.scopeContext;
  const userSpaceId = toNullableInt(req?.user?.activeSpaceId) ?? null;
  const userLibraryId = toNullableInt(req?.user?.activeLibraryId) ?? null;
  return {
    spaceId: userSpaceId,
    libraryId: userLibraryId
  };
}

function appendScopeSql(params, scopeContext, options = {}) {
  const {
    spaceColumn = 'space_id',
    libraryColumn = 'library_id'
  } = options;

  let clause = '';
  if (scopeContext?.spaceId !== null && scopeContext?.spaceId !== undefined) {
    params.push(scopeContext.spaceId);
    clause += ` AND ${spaceColumn} = $${params.length}`;
  }
  if (
    libraryColumn &&
    scopeContext?.libraryId !== null &&
    scopeContext?.libraryId !== undefined
  ) {
    params.push(scopeContext.libraryId);
    clause += ` AND ${libraryColumn} = $${params.length}`;
  }
  return clause;
}

module.exports = {
  extractScopeHints,
  resolveScopeContext,
  appendScopeSql
};
