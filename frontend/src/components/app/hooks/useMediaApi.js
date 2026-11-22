import { useCallback, useRef, useState } from 'react';
import { normalizePaginationAfterRemoval } from '../../../lib/libraryPagination';

const DEFAULT_PAGINATION = { page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false };

export default function useMediaApi({ apiCall, showToast }) {
  const [mediaItems, setMediaItems] = useState([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [mediaPagination, setMediaPagination] = useState(DEFAULT_PAGINATION);
  const mediaRequestSeqRef = useRef(0);

  const loadMedia = useCallback(
    async (opts = {}) => {
      const requestSeq = ++mediaRequestSeqRef.current;
      const params = new URLSearchParams();
      const passthrough = [
        'page',
        'limit',
        'search',
        'format',
        'media_type',
        'sortBy',
        'sortDir',
        'director',
        'genre',
        'cast',
        'resolution',
        'yearMin',
        'yearMax',
        'platform',
        'publisher',
        'review_filter',
        'ratingMin',
        'ratingMax',
        'userRatingMin',
        'userRatingMax'
      ];

      passthrough.forEach((key) => {
        const value = opts[key];
        if (value === undefined || value === null || value === '') return;
        if (key === 'format' && value === 'all') return;
        if (key === 'resolution' && value === 'all') return;
        params.set(key, String(value));
      });

      const query = params.toString();
      setMediaLoading(true);
      setMediaError('');
      try {
        const payload = await apiCall('get', `/media${query ? `?${query}` : ''}`);
        if (requestSeq !== mediaRequestSeqRef.current) return false;
        if (Array.isArray(payload)) {
          setMediaItems(payload);
          setMediaPagination({ page: 1, limit: payload.length, total: payload.length, totalPages: 1, hasMore: false });
        } else {
          setMediaItems(payload?.items || []);
          setMediaPagination(payload?.pagination || DEFAULT_PAGINATION);
        }
        return true;
      } catch (err) {
        if (requestSeq !== mediaRequestSeqRef.current) return false;
        setMediaError(err.response?.data?.error || 'Failed to load media');
        return false;
      } finally {
        if (requestSeq === mediaRequestSeqRef.current) setMediaLoading(false);
      }
    },
    [apiCall]
  );

  const addMedia = useCallback(
    async (payload) => {
      const created = await apiCall('post', '/media', payload);
      setMediaItems((prev) => [created, ...prev]);
      showToast('Added to library');
      return created;
    },
    [apiCall, showToast]
  );

  const editMedia = useCallback(
    async (id, payload) => {
      const updated = await apiCall('patch', `/media/${id}`, payload);
      setMediaItems((prev) => prev.map((item) => (item.id === id ? updated : item)));
      showToast('Saved');
      return updated;
    },
    [apiCall, showToast]
  );

  const deleteMedia = useCallback(
    async (id) => {
      await apiCall('delete', `/media/${id}`);
      setMediaItems((prev) => prev.filter((item) => item.id !== id));
      setMediaPagination((prev) => normalizePaginationAfterRemoval(prev, 1));
      showToast('Deleted');
    },
    [apiCall, showToast]
  );

  const bulkDeleteMedia = useCallback(
    async (ids = []) => {
      const targetIds = [...new Set((Array.isArray(ids) ? ids : []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
      if (targetIds.length === 0) return { deletedIds: [], failedIds: [] };

      const response = await apiCall('post', '/media/bulk-delete', { ids: targetIds });
      const deletedIds = Array.isArray(response?.deleted_ids)
        ? response.deleted_ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
        : [];
      const unresolvedIds = [
        ...(Array.isArray(response?.skipped) ? response.skipped : []),
        ...(Array.isArray(response?.failed) ? response.failed : [])
      ]
        .map((entry) => Number(entry?.id))
        .filter((id) => Number.isFinite(id) && id > 0);
      const failedIds = [...new Set(unresolvedIds)];

      if (deletedIds.length > 0) {
        setMediaItems((prev) => prev.filter((item) => !deletedIds.includes(Number(item.id))));
        setMediaPagination((prev) => normalizePaginationAfterRemoval(prev, deletedIds.length));
      }

      if (failedIds.length === 0) {
        showToast(`Deleted ${deletedIds.length} item${deletedIds.length === 1 ? '' : 's'}`);
      } else if (deletedIds.length > 0) {
        showToast(`Deleted ${deletedIds.length} item${deletedIds.length === 1 ? '' : 's'}, ${failedIds.length} not deleted`, 'error');
      } else {
        showToast('Failed to delete selected items', 'error');
      }

      return { deletedIds, failedIds };
    },
    [apiCall, showToast]
  );

  const rateMedia = useCallback(
    async (id, rating) => {
      const updated = await apiCall('patch', `/media/${id}`, { user_rating: rating });
      setMediaItems((prev) => prev.map((item) => (item.id === id ? updated : item)));
    },
    [apiCall]
  );

  return {
    mediaItems,
    setMediaItems,
    mediaLoading,
    mediaError,
    mediaPagination,
    loadMedia,
    addMedia,
    editMedia,
    deleteMedia,
    bulkDeleteMedia,
    rateMedia
  };
}
