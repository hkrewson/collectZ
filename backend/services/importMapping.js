function mapDeliciousItemTypeToMediaType(itemTypeRaw) {
  const raw = String(itemTypeRaw || '').trim().toLowerCase();
  if (!raw) return 'movie';
  // Check game aliases first so "VideoGame" is not misclassified as movie.
  if (
    raw.includes('videogame')
    || raw.includes('video game')
    || raw.includes('game')
    || raw.includes('console')
  ) return 'game';
  if (raw.includes('tv') || raw.includes('show') || raw.includes('series') || raw.includes('episode')) return 'tv_series';
  if (raw.includes('comic')) return 'comic_book';
  if (raw.includes('book') || raw.includes('novel')) return 'book';
  if (raw.includes('music') || raw.includes('audio') || raw.includes('cd') || raw.includes('vinyl') || raw.includes('lp')) return 'audio';
  if (raw.includes('movie') || raw.includes('film') || /\bvideo\b/.test(raw)) return 'movie';
  return null;
}

module.exports = { mapDeliciousItemTypeToMediaType };
