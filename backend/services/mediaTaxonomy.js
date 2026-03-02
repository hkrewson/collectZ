const pool = require('../db/pool');

function splitCsvTokens(raw = '') {
  return String(raw || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeToken(raw = '') {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

async function upsertGenre(client, name) {
  const normalized = normalizeToken(name);
  if (!normalized) return null;
  const result = await client.query(
    `INSERT INTO genres (name, normalized_name)
     VALUES ($1, $2)
     ON CONFLICT (normalized_name)
     DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [String(name).trim(), normalized]
  );
  return result.rows[0]?.id || null;
}

async function upsertDirector(client, name) {
  const normalized = normalizeToken(name);
  if (!normalized) return null;
  const result = await client.query(
    `INSERT INTO directors (name, normalized_name)
     VALUES ($1, $2)
     ON CONFLICT (normalized_name)
     DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [String(name).trim(), normalized]
  );
  return result.rows[0]?.id || null;
}

async function upsertActor(client, name) {
  const normalized = normalizeToken(name);
  if (!normalized) return null;
  const result = await client.query(
    `INSERT INTO actors (name, normalized_name)
     VALUES ($1, $2)
     ON CONFLICT (normalized_name)
     DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [String(name).trim(), normalized]
  );
  return result.rows[0]?.id || null;
}

async function syncNormalizedMetadataForMedia({ mediaId, genre, director, cast, client = pool }) {
  const id = Number(mediaId);
  if (!Number.isFinite(id) || id <= 0) return;

  const genreTokens = [...new Set(splitCsvTokens(genre))];
  const directorTokens = [...new Set(splitCsvTokens(director))];
  const castTokens = [...new Set(splitCsvTokens(cast))];

  await client.query('DELETE FROM media_genres WHERE media_id = $1', [id]);
  await client.query('DELETE FROM media_directors WHERE media_id = $1', [id]);
  await client.query('DELETE FROM media_actors WHERE media_id = $1', [id]);

  for (const token of genreTokens) {
    const genreId = await upsertGenre(client, token);
    if (!genreId) continue;
    await client.query(
      `INSERT INTO media_genres (media_id, genre_id)
       VALUES ($1, $2)
       ON CONFLICT (media_id, genre_id) DO NOTHING`,
      [id, genreId]
    );
  }

  for (const token of directorTokens) {
    const directorId = await upsertDirector(client, token);
    if (!directorId) continue;
    await client.query(
      `INSERT INTO media_directors (media_id, director_id)
       VALUES ($1, $2)
       ON CONFLICT (media_id, director_id) DO NOTHING`,
      [id, directorId]
    );
  }

  for (const token of castTokens) {
    const actorId = await upsertActor(client, token);
    if (!actorId) continue;
    await client.query(
      `INSERT INTO media_actors (media_id, actor_id)
       VALUES ($1, $2)
       ON CONFLICT (media_id, actor_id) DO NOTHING`,
      [id, actorId]
    );
  }
}

module.exports = {
  syncNormalizedMetadataForMedia
};
