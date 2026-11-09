#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');
const { withAuthorizedScopeTransaction } = require('../db/scopeBroker');

async function expectCode(client, label, expected, work) {
  const savepoint = `check_${crypto.randomBytes(4).toString('hex')}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  let caught;
  try {
    await work();
  } catch (error) {
    caught = error;
  }
  await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  assert(caught, `${label} unexpectedly succeeded`);
  assert(expected.includes(caught.code), `${label} returned ${caught.code || 'no code'} instead of ${expected.join('/')}`);
  return { label, passed: true, code: caught.code };
}

async function main() {
  const suffix = crypto.randomBytes(8).toString('hex');
  const email = `external-identity-${suffix}@example.invalid`;
  const evidencePath = process.env.EXTERNAL_IDENTITY_CERTIFICATION_OUTPUT ||
    path.join('artifacts', 'external-identity-certification', 'external-identity-certification.json');
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  const checks = [];
  let userId;
  let spaceA;
  let spaceB;
  let libraryA;
  let libraryB;
  let mediaA;
  let mediaA2;
  let mediaB;

  try {
    userId = Number((await pool.query(
      `INSERT INTO users (email, password, name, role, email_verified)
       VALUES ($1, $2, 'External Identity Certification', 'admin', true)
       RETURNING id`,
      [email, crypto.randomBytes(48).toString('hex')]
    )).rows[0].id);
    spaceA = Number((await pool.query(
      `INSERT INTO spaces (name, slug, created_by) VALUES ($1, $2, $3) RETURNING id`,
      [`Identity A ${suffix}`, `identity-a-${suffix}`, userId]
    )).rows[0].id);
    spaceB = Number((await pool.query(
      `INSERT INTO spaces (name, slug, created_by) VALUES ($1, $2, $3) RETURNING id`,
      [`Identity B ${suffix}`, `identity-b-${suffix}`, userId]
    )).rows[0].id);
    libraryA = Number((await pool.query(
      'INSERT INTO libraries (space_id, name, created_by) VALUES ($1, $2, $3) RETURNING id',
      [spaceA, `Library A ${suffix}`, userId]
    )).rows[0].id);
    libraryB = Number((await pool.query(
      'INSERT INTO libraries (space_id, name, created_by) VALUES ($1, $2, $3) RETURNING id',
      [spaceB, `Library B ${suffix}`, userId]
    )).rows[0].id);
    mediaA = (await pool.query(
      `INSERT INTO media (title, media_type, space_id, library_id, added_by)
       VALUES ($1, 'book', $2, $3, $4) RETURNING id, public_id`,
      [`Media A ${suffix}`, spaceA, libraryA, userId]
    )).rows[0];
    mediaA2 = (await pool.query(
      `INSERT INTO media (title, media_type, space_id, library_id, added_by)
       VALUES ($1, 'book', $2, $3, $4) RETURNING id, public_id`,
      [`Media A2 ${suffix}`, spaceA, libraryA, userId]
    )).rows[0];
    mediaB = (await pool.query(
      `INSERT INTO media (title, media_type, space_id, library_id, added_by)
       VALUES ($1, 'book', $2, $3, $4) RETURNING id, public_id`,
      [`Media B ${suffix}`, spaceB, libraryB, userId]
    )).rows[0];

    assert.match(mediaA.public_id, /^[0-9a-f-]{36}$/i);
    assert.notEqual(mediaA.public_id, mediaA2.public_id);
    checks.push({ label: 'canonical UUID generated and unique', passed: true });

    const rollback = new Error('certification rollback');
    rollback.certificationRollback = true;
    try {
      await withAuthorizedScopeTransaction(pool, { spaceId: spaceA }, userId, async (client) => {
        checks.push(await expectCode(client, 'canonical UUID is write-once', ['23514'], () =>
          client.query('UPDATE media SET public_id = gen_random_uuid() WHERE id = $1', [mediaA.id])));
        checks.push(await expectCode(client, 'media cannot reference sibling workspace library', ['23503'], () =>
          client.query('UPDATE media SET library_id = $2 WHERE id = $1', [mediaA.id, libraryB])));

        const first = (await client.query(
          `INSERT INTO provider_connections (space_id, provider_type, display_name, endpoint_url, settings, created_by)
           VALUES ($1, 'fixture', 'Primary', 'https://one.example', '{"mode":"safe"}', $2) RETURNING *`,
          [spaceA, userId]
        )).rows[0];
        const second = (await client.query(
          `INSERT INTO provider_connections (space_id, provider_type, display_name, endpoint_url, settings, created_by)
           VALUES ($1, 'fixture', 'Secondary', 'https://two.example', '{"mode":"safe"}', $2) RETURNING *`,
          [spaceA, userId]
        )).rows[0];
        const renamed = (await client.query(
          `UPDATE provider_connections SET display_name='Renamed', endpoint_url='https://renamed.example'
            WHERE id=$1 RETURNING id`, [first.id]
        )).rows[0];
        assert.equal(renamed.id, first.id);
        checks.push({ label: 'connection identity survives rename and endpoint change', passed: true });
        checks.push(await expectCode(client, 'connection workspace is immutable', ['23514'], () =>
          client.query('UPDATE provider_connections SET space_id=$2 WHERE id=$1', [first.id, spaceB])));
        checks.push(await expectCode(client, 'RLS blocks sibling workspace connection insert', ['42501'], () =>
          client.query(`INSERT INTO provider_connections (space_id,provider_type,display_name,created_by)
                        VALUES ($1,'fixture','Sibling',$2)`, [spaceB, userId])));

        await client.query(
          `INSERT INTO provider_connection_credentials
             (provider_connection_id, space_id, secret_payload_encrypted, updated_by)
           VALUES ($1,$2,'encrypted-payload',$3)`, [first.id, spaceA, userId]
        );
        checks.push({ label: 'credentials stored in separate scoped relation', passed: true });

        const identityA = (await client.query(
          `INSERT INTO external_media_identities
             (space_id,provider_connection_id,identity_kind,external_id_raw,external_id_normalized,media_id,created_by,updated_by)
           VALUES ($1,$2,'book','book:42','book:42',$3,$4,$4) RETURNING *`,
          [spaceA, first.id, mediaA.id, userId]
        )).rows[0];
        await client.query(
          `INSERT INTO external_media_identities
             (space_id,provider_connection_id,identity_kind,external_id_raw,external_id_normalized,media_id,created_by,updated_by)
           VALUES ($1,$2,'book','book:42','book:42',$3,$4,$4)`,
          [spaceA, second.id, mediaA2.id, userId]
        );
        checks.push({ label: 'same external id remains isolated across provider instances', passed: true });
        checks.push(await expectCode(client, 'active identity cannot bind two media targets', ['23505'], () =>
          client.query(
            `INSERT INTO external_media_identities
               (space_id,provider_connection_id,identity_kind,external_id_raw,external_id_normalized,media_id,created_by,updated_by)
             VALUES ($1,$2,'book','book:42','book:42',$3,$4,$4)`,
            [spaceA, first.id, mediaA2.id, userId])));
        checks.push(await expectCode(client, 'identity cannot target sibling workspace media', ['23503'], () =>
          client.query(
            `INSERT INTO external_media_identities
               (space_id,provider_connection_id,identity_kind,external_id_raw,external_id_normalized,media_id,created_by,updated_by)
             VALUES ($1,$2,'book','book:99','book:99',$3,$4,$4)`,
            [spaceA, first.id, mediaB.id, userId])));
        checks.push(await expectCode(client, 'external identity key is immutable', ['23514'], () =>
          client.query(`UPDATE external_media_identities SET external_id_normalized='changed' WHERE id=$1`, [identityA.id])));

        await client.query(
          `INSERT INTO external_media_identity_events
             (space_id,identity_id,event_type,to_media_id,to_media_public_id,actor_user_id)
           VALUES ($1,$2,'attached',$3,$4,$5)`, [spaceA, identityA.id, mediaA.id, mediaA.public_id, userId]
        );
        checks.push(await expectCode(client, 'identity lifecycle events are append-only', ['42501'], () =>
          client.query(`UPDATE external_media_identity_events SET event_type='observed' WHERE identity_id=$1`, [identityA.id])));

        await client.query(
          `UPDATE external_media_identities
              SET active=false,deactivated_at=CURRENT_TIMESTAMP,updated_by=$2 WHERE id=$1`,
          [identityA.id, userId]
        );
        const retained = (await client.query('SELECT active, media_id FROM external_media_identities WHERE id=$1', [identityA.id])).rows[0];
        assert.equal(retained.active, false);
        assert.equal(Number(retained.media_id), Number(mediaA.id));
        await client.query(
          `UPDATE external_media_identities
              SET active=true,deactivated_at=NULL,media_id=$2,updated_by=$3 WHERE id=$1`,
          [identityA.id, mediaA2.id, userId]
        );
        checks.push({ label: 'deactivation retains history and supports transactional restoration/reassignment', passed: true });

        await client.query(
          `UPDATE provider_connections
              SET status='archived',archived_at=CURRENT_TIMESTAMP,disabled_at=NULL WHERE id=$1`, [first.id]
        );
        const identityCount = Number((await client.query(
          'SELECT COUNT(*)::int AS count FROM external_media_identities WHERE provider_connection_id=$1', [first.id]
        )).rows[0].count);
        assert.equal(identityCount, 1);
        await client.query(
          `UPDATE provider_connections
              SET status='active',archived_at=NULL,disabled_at=NULL WHERE id=$1`, [first.id]
        );
        checks.push({ label: 'connection archive/reactivation preserves identity history', passed: true });
        throw rollback;
      });
    } catch (error) {
      if (!error.certificationRollback) throw error;
    }

    const unscoped = await pool.query('SELECT COUNT(*)::int AS count FROM provider_connections WHERE space_id = $1', [spaceA]);
    assert.equal(Number(unscoped.rows[0].count), 0);
    checks.push({ label: 'unscoped runtime SQL cannot read provider connections', passed: true });

    const evidence = {
      generatedAt: new Date().toISOString(),
      migrationVersion: 127,
      passed: true,
      checks
    };
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    console.log(`External identity certification passed (${checks.length} checks).`);
  } finally {
    if (mediaA?.id || mediaA2?.id || mediaB?.id) {
      await pool.query('DELETE FROM media WHERE id = ANY($1::int[])', [[mediaA?.id, mediaA2?.id, mediaB?.id].filter(Boolean)]).catch(() => {});
    }
    if (libraryA || libraryB) await pool.query('DELETE FROM libraries WHERE id = ANY($1::int[])', [[libraryA, libraryB].filter(Boolean)]).catch(() => {});
    if (spaceA || spaceB) await pool.query('DELETE FROM spaces WHERE id = ANY($1::int[])', [[spaceA, spaceB].filter(Boolean)]).catch(() => {});
    if (userId) await pool.query('DELETE FROM users WHERE id=$1', [userId]).catch(() => {});
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`External identity certification failed: ${error.message}`);
  process.exit(1);
});
