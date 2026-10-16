// Deliberate public projection: never return integration payloads, URLs, or credentials to TV.
const fields = new Set(['id', 'native_art_id', 'title', 'name', 'description', 'overview', 'year',
  'media_type', 'format', 'owned_formats', 'genre', 'director', 'cast_members', 'rating', 'user_rating',
  'runtime', 'notes', 'subtype', 'category', 'category_key', 'series', 'franchise', 'artist', 'medium',
  'height', 'width', 'dimension_unit', 'framed', 'print_number', 'print_run', 'signed', 'exclusive',
  'import_source', 'source_title', 'expected_item_count', 'item_count', 'resolution_status',
  'contained_title', 'position', 'media_title', 'media_year', 'library_id', 'created_at', 'updated_at']);
function projectRow(row, kind) {
  if (!row || typeof row !== 'object') return row;
  const safe = Object.fromEntries(Object.entries(row).filter(([key, value]) => fields.has(key)
    && (value === null || typeof value !== 'object' || (key === 'owned_formats' && Array.isArray(value)))));
  const id = kind === 'art' ? row.native_art_id : row.id;
  if (id && (row.poster_path || row.image_path)) {
    safe.artwork_path = `/api/mobile/tv/artwork/${kind}/${id}`;
  }
  if (row.type_details && typeof row.type_details === 'object') {
    const allowed = new Set(['author', 'authors', 'publisher', 'platform', 'developer', 'isbn', 'series', 'issue_number', 'volume', 'artist', 'album', 'label', 'watch_state', 'status', 'language']);
    safe.type_details = Object.fromEntries(Object.entries(row.type_details).filter(([key, value]) => allowed.has(key) && (typeof value === 'string' || typeof value === 'number')));
  }
  if (row.media_title && row.media_id) {
    safe.media_id = row.media_id;
    if (row.media_poster_path) safe.artwork_path = `/api/mobile/tv/artwork/media/${row.media_id}`;
  }
  return safe;
}
function installTVPresentation(req, res) {
  const path = req.originalUrl.split('?')[0];
  if (!/^\/api\/(libraries|media|collectibles|art)(\/|$)/.test(path)) return;
  const kind = path.startsWith('/api/art') ? 'art' : path.startsWith('/api/collectibles') ? 'collectibles'
    : path.includes('/collections') ? 'collections' : 'media';
  const json = res.json.bind(res);
  res.json = (body) => {
    res.set('Cache-Control', 'no-store');
    if (res.statusCode >= 400 || path.endsWith('/feature-flags')) return json(body);
    if (body.libraries) return json({ libraries: body.libraries.map(row => projectRow(row, kind)) });
    if (body.items) return json({ items: body.items.map(row => projectRow(row, kind)),
      ...(body.pagination ? { pagination: body.pagination } : {}),
      ...(body.collection ? { collection: projectRow(body.collection, kind) } : {}) });
    return json(projectRow(body, kind));
  };
}
module.exports = { projectRow, installTVPresentation };
