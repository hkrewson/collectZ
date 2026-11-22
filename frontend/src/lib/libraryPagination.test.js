import { describe, expect, it } from 'vitest';
import { getLibraryDisplayedTotal, normalizePaginationAfterRemoval } from './libraryPagination';

describe('library pagination helpers', () => {
  it('decrements authoritative totals and preserves the current page when it remains valid', () => {
    expect(normalizePaginationAfterRemoval({ page: 2, limit: 25, total: 80, totalPages: 4, hasMore: true }, 1)).toEqual({
      page: 2,
      limit: 25,
      total: 79,
      totalPages: 4,
      hasMore: true
    });
  });

  it('clamps the page after deleting the last item on the final page', () => {
    expect(normalizePaginationAfterRemoval({ page: 3, limit: 25, total: 51, totalPages: 3, hasMore: false }, 1)).toMatchObject({
      page: 2,
      total: 50,
      totalPages: 2,
      hasMore: false
    });
  });

  it('uses authoritative media and collection totals only after both result sources settle', () => {
    expect(getLibraryDisplayedTotal({ supportsCollections: true, mediaTotal: 8, collectionTotal: 5 })).toBe(13);
    expect(
      getLibraryDisplayedTotal({ supportsCollections: true, mediaTotal: 8, collectionTotal: 5, collectionsSettled: false })
    ).toBeUndefined();
    expect(getLibraryDisplayedTotal({ collectionMode: true, collectionTotal: 5 })).toBe(5);
  });
});
