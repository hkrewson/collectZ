const DEFAULT_LIMIT = 50;

function toNonNegativeInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : fallback;
}

export function normalizePaginationAfterRemoval(pagination = {}, removedCount = 1) {
  const total = toNonNegativeInteger(pagination.total);
  const removed = toNonNegativeInteger(removedCount);
  const limit = Math.max(1, toNonNegativeInteger(pagination.limit, DEFAULT_LIMIT));
  const nextTotal = Math.max(0, total - removed);
  const nextTotalPages = Math.max(1, Math.ceil(nextTotal / limit));
  const currentPage = Math.max(1, toNonNegativeInteger(pagination.page, 1));
  const nextPage = Math.min(currentPage, nextTotalPages);

  return {
    ...pagination,
    page: nextPage,
    limit,
    total: nextTotal,
    totalPages: nextTotalPages,
    hasMore: nextPage < nextTotalPages
  };
}

export function getLibraryDisplayedTotal({
  collectionMode = false,
  supportsCollections = false,
  mediaTotal = 0,
  collectionTotal = 0,
  mediaSettled = true,
  collectionsSettled = true
} = {}) {
  if (collectionMode) {
    return collectionsSettled ? toNonNegativeInteger(collectionTotal) : undefined;
  }
  if (!mediaSettled || (supportsCollections && !collectionsSettled)) return undefined;
  return toNonNegativeInteger(mediaTotal) + (supportsCollections ? toNonNegativeInteger(collectionTotal) : 0);
}
