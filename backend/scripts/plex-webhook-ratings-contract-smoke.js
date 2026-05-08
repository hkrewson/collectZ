#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const {
  buildPlexWebhookAndRatingsContract,
  normalizePlexWebhookEvent,
  buildPlexRatingWritebackRequest
} = require('../services/plex');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertSecretFree(value, label = 'payload') {
  const text = JSON.stringify(value);
  assert(!/plex-webhook-contract-token/i.test(text), `${label} surfaced a raw Plex token`);
  assert(!/X-Plex-Token=/i.test(text), `${label} surfaced a Plex token query string`);
  assert(!/https?:\/\/plex\.example/i.test(text), `${label} surfaced a raw Plex URL`);
  assert(!/\/mnt\/plex-media/i.test(text), `${label} surfaced a raw media file path`);
  assert(!/server-uuid-secret/i.test(text), `${label} surfaced a raw server UUID`);
}

function main() {
  const contract = buildPlexWebhookAndRatingsContract();
  assert(contract.inboundEvents.includes('library.new'), 'Expected library.new inbound event');
  assert(contract.inboundEvents.includes('media.scrobble'), 'Expected media.scrobble inbound event');
  assert(contract.inboundEvents.includes('media.rate'), 'Expected media.rate inbound event');
  assert(contract.ratingWriteback.path === '/:/rate', 'Expected Plex rating writeback path');
  assert(contract.watchedStateWriteback.status === 'future_explicit_opt_in', 'Expected watched writeback to stay future opt-in');

  const libraryNew = normalizePlexWebhookEvent({
    event: 'library.new',
    Metadata: {
      ratingKey: '12345',
      type: 'movie',
      title: 'Webhook New Movie',
      year: 2026,
      guid: 'plex://movie/example?guid=tmdb://777',
      librarySectionID: '1',
      thumb: 'https://plex.example.invalid/library/metadata/12345/thumb?X-Plex-Token=plex-webhook-contract-token',
      Media: [{ Part: [{ file: '/mnt/plex-media/Webhook New Movie.mkv' }] }]
    },
    Server: { title: 'Home Plex', uuid: 'server-uuid-secret' }
  });
  assert(libraryNew.supported === true, 'Expected library.new to be supported');
  assert(libraryNew.action === 'sync_new_title_hint', `Unexpected library.new action: ${libraryNew.action}`);
  assert(libraryNew.ratingKey === '12345', 'Expected library.new rating key');
  assert(libraryNew.metadataReadbackPath === '/library/metadata/12345', 'Expected metadata readback path');
  assertSecretFree(libraryNew, 'library.new normalized event');

  const scrobble = normalizePlexWebhookEvent({
    payload: JSON.stringify({
      event: 'media.scrobble',
      Metadata: {
        ratingKey: '23456',
        type: 'episode',
        grandparentTitle: 'Webhook Show',
        parentTitle: 'Season 1',
        title: 'Watched Episode'
      },
      Account: { id: '42', title: 'Viewer' }
    })
  });
  assert(scrobble.supported === true, 'Expected media.scrobble to be supported');
  assert(scrobble.action === 'refresh_watched_state', `Unexpected scrobble action: ${scrobble.action}`);
  assert(scrobble.ratingKey === '23456', 'Expected scrobble rating key');
  assert(scrobble.account.title === 'Viewer', 'Expected sanitized account title');
  assertSecretFree(scrobble, 'media.scrobble normalized event');

  const rated = normalizePlexWebhookEvent({
    event: 'media.rate',
    Metadata: {
      ratingKey: '34567',
      type: 'movie',
      title: 'Rated Movie',
      userRating: 8.5
    }
  });
  assert(rated.supported === true, 'Expected media.rate to be supported');
  assert(rated.action === 'refresh_rating', `Unexpected media.rate action: ${rated.action}`);
  assert(rated.metadata.userRating === 8.5, `Expected userRating 8.5, got ${rated.metadata.userRating}`);
  assertSecretFree(rated, 'media.rate normalized event');

  const playback = normalizePlexWebhookEvent({
    event: 'media.pause',
    Metadata: { ratingKey: '45678', title: 'Paused Movie' },
    Player: { title: 'Living Room', product: 'Plex Web', platform: 'Chrome' }
  });
  assert(playback.supported === false, 'Expected playback event to be observed only');
  assert(playback.action === 'observe_playback_only', `Unexpected playback action: ${playback.action}`);
  assertSecretFree(playback, 'playback normalized event');

  const writeback = buildPlexRatingWritebackRequest({
    ratingKey: rated.ratingKey,
    rating: rated.metadata.userRating,
    ratedAt: '2026-05-08T03:30:00.000Z'
  });
  assert(writeback.method === 'PUT', 'Expected PUT writeback');
  assert(writeback.path === '/:/rate', 'Expected /:/rate writeback');
  assert(writeback.params.identifier === 'com.plexapp.plugins.library', 'Expected Plex library identifier');
  assert(writeback.params.key === '34567', 'Expected ratingKey writeback param');
  assert(writeback.params.rating === 8.5, 'Expected rating writeback param');
  assert(Number.isInteger(writeback.params.ratedAt), 'Expected ratedAt epoch seconds');
  assertSecretFree(writeback, 'rating writeback contract');

  const evidence = {
    ok: true,
    contract,
    supportedEvents: [libraryNew, scrobble, rated],
    observedOnlyEvent: playback,
    ratingWriteback: writeback
  };
  const outDir = path.join(__dirname, '..', '..', 'artifacts', 'plex-webhooks');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'plex-webhook-ratings-contract-smoke.json');
  fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ ok: true, artifact: outPath, supportedEvents: contract.inboundEvents }, null, 2));
}

main();
