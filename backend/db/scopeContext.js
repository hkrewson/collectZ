function toNullableInt(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function resolveScopeContext(req) {
  const query = req?.query || {};
  const body = req?.body || {};
  const headers = req?.headers || {};

  const spaceId =
    toNullableInt(body.space_id) ??
    toNullableInt(query.space_id) ??
    toNullableInt(headers['x-space-id']) ??
    null;

  const libraryIdRaw =
    body.library_id ??
    query.library_id ??
    headers['x-library-id'] ??
    null;
  const libraryId = String(libraryIdRaw).toLowerCase() === 'all'
    ? null
    : toNullableInt(libraryIdRaw);

  return { spaceId, libraryId };
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
  resolveScopeContext,
  appendScopeSql
};
