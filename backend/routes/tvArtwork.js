const express = require('express');
const https = require('https');
const dns = require('dns').promises;
const net = require('net');
const pool = require('../db/pool');
const { asyncHandler } = require('../middleware/errors');
const { authenticateToken } = require('../middleware/auth');
const { enforceScopeAccess } = require('../middleware/scopeAccess');
const { readLocalUploadBuffer } = require('../services/storage');
const { loadWorkspaceKavitaIntegrationConfig } = require('../services/integrations');
const { authenticateKavita, fetchKavitaCoverImage, fetchKavitaReaderImage } = require('../services/kavita');
const { isFeatureEnabledForSpace } = require('../services/featureFlags');
const router = express.Router();
const blocked = new net.BlockList();
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],
  ['169.254.0.0',16],['172.16.0.0',12],['192.168.0.0',16],['192.0.0.0',24],['192.0.2.0',24],
  ['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) blocked.addSubnet(address,prefix);
const allowedHosts = new Set(['image.tmdb.org','static.metron.cloud','i.discogs.com','covers.openlibrary.org','books.google.com','books.googleusercontent.com']);
function publicAddress(address) {
  // IPv4 only deliberately: DNS is pinned below, including on dual-stack hosts.
  return net.isIPv4(address) && !blocked.check(address);
}
async function fetchArtwork(value) {
  const url = new URL(value);
  let configuredStorage = false;
  try { const base = new URL(process.env.S3_PUBLIC_BASE_URL); configuredStorage = url.origin === base.origin && url.pathname.startsWith(base.pathname.replace(/\/$/, '') + '/'); } catch (_) { /* no public storage */ }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || (!allowedHosts.has(url.hostname) && !configuredStorage)) throw new Error('unsupported_artwork');
  const answers = await dns.lookup(url.hostname, { all: true, family: 4 });
  if (!answers.length || answers.some(item => !publicAddress(item.address))) throw new Error('unsupported_artwork');
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: 10000, lookup: (_host, options, cb) => {
      if (options.all) cb(null, [answers[0]]); else cb(null, answers[0].address, 4);
    } }, response => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error('artwork_unavailable')); return; }
      let length = 0; const chunks = [];
      response.on('data', chunk => { length += chunk.length; if (length > 8 * 1024 * 1024) response.destroy(new Error('artwork_too_large')); else chunks.push(chunk); });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('artwork_timeout')));
    request.on('error', reject);
  });
}
function mime(buffer) {
  if (buffer?.subarray(0,3).equals(Buffer.from([255,216,255]))) return 'image/jpeg';
  if (buffer?.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (buffer?.subarray(0,4).toString() === 'RIFF' && buffer.subarray(8,12).toString() === 'WEBP') return 'image/webp';
  if (buffer?.subarray(0,3).toString() === 'GIF') return 'image/gif';
  return null;
}
router.get('/tv/artwork/:kind/:id', authenticateToken, enforceScopeAccess(), asyncHandler(async (req,res) => {
  const tables = { media: ['media','poster_path'], art: ['art_items','image_path'], collectibles: ['collectibles','image_path'], collections: ['collections','poster_path'] };
  const config = tables[req.params.kind];
  if (!config || !/^[1-9][0-9]*$/.test(req.params.id)) return res.sendStatus(404);
  if (['art', 'collectibles'].includes(req.params.kind) && !await isFeatureEnabledForSpace(req.scopeContext.spaceId,'collectibles_enabled',false)) return res.sendStatus(404);
  const result = req.params.kind === 'collections' ? await pool.query(`SELECT m.poster_path AS path, m.type_details, m.space_id FROM collections c JOIN collection_items ci ON ci.collection_id=c.id JOIN media m ON m.id=ci.media_id AND m.library_id=c.library_id AND m.space_id=c.space_id WHERE c.id=$1 AND c.library_id=$2 AND c.space_id=$3 AND m.poster_path IS NOT NULL ORDER BY ci.position NULLS LAST, ci.id LIMIT 1`, [req.params.id, req.scopeContext.libraryId, req.scopeContext.spaceId]) : await pool.query(`SELECT ${config[1]} AS path, space_id ${req.params.kind === 'media' ? ',type_details' : ''} FROM ${config[0]} WHERE id=$1 AND library_id=$2 AND space_id=$3 ${req.params.kind === 'media' ? '' : 'AND archived_at IS NULL'}`,
    [req.params.id, req.scopeContext.libraryId, req.scopeContext.spaceId]);
  let path = result.rows[0]?.path;
  if (!path) return res.sendStatus(404);
  try {
    let buffer;
    if (/^\/api\/media\/kavita-(chapter-)?cover\/[1-9][0-9]*$/.test(path)) {
      const row = result.rows[0];
      const integration = await loadWorkspaceKavitaIntegrationConfig(row.space_id);
      if (!integration.kavitaBaseUrl || !integration.kavitaApiKey) return res.sendStatus(404);
      const auth = await authenticateKavita(integration);
      const id = Number(path.split('/').pop());
      const cover = path.includes('chapter-cover')
        ? await fetchKavitaReaderImage(integration, auth.token, id, 0)
        : await fetchKavitaCoverImage(integration, auth.token, row.type_details?.kavita_cover_image, { seriesId: id });
      buffer = cover.body;
    } else if (path.startsWith('/uploads/')) buffer = await readLocalUploadBuffer(path);
    else {
      if (/^\/[A-Za-z0-9_.-]+$/.test(path)) path = `https://image.tmdb.org/t/p/w780${path}`;
      buffer = await fetchArtwork(path);
    }
    if (!buffer || buffer.length > 8 * 1024 * 1024) return res.sendStatus(404);
    const contentType = mime(buffer);
    if (!contentType) return res.sendStatus(404);
    res.set({ 'Content-Type': contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).send(buffer);
  } catch (_) { res.status(404).json({ error: 'Artwork unavailable' }); }
}));
module.exports = router;
module.exports.publicAddress = publicAddress;
module.exports.mime = mime;
