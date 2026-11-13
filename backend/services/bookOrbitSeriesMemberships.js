'use strict';

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 2147483647) {
    throw new TypeError(`${label} is invalid`);
  }
  return parsed;
}

function boundedText(value, maxLength, label, { required = false } = {}) {
  const normalized = String(value ?? '').trim();
  if ((required && !normalized) || normalized.length > maxLength) {
    throw new TypeError(`${label} is invalid`);
  }
  return normalized || null;
}

function optionalNonNegativeInteger(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 2147483647) {
    throw new TypeError(`${label} is invalid`);
  }
  return parsed;
}

function optionalTimestamp(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new TypeError(`${label} is invalid`);
  return parsed.toISOString();
}

function normalizeMembership(value = {}) {
  return Object.freeze({
    providerSeriesId: boundedText(value.providerSeriesId, 512, 'BookOrbit series id', { required: true }),
    name: boundedText(value.name, 500, 'BookOrbit series name', { required: true }),
    seriesIndex: boundedText(value.seriesIndex, 80, 'BookOrbit series index'),
    volume: boundedText(value.volume, 255, 'BookOrbit volume'),
    issueNumber: boundedText(value.issueNumber, 80, 'BookOrbit issue number'),
    displayOrder: optionalNonNegativeInteger(value.displayOrder, 'BookOrbit series display order') ?? 0,
    expectedItemCount: optionalNonNegativeInteger(value.expectedItemCount, 'BookOrbit expected series count'),
    sourceUpdatedAt: optionalTimestamp(value.sourceUpdatedAt, 'BookOrbit series source timestamp')
  });
}

function normalizeMemberships(values = []) {
  if (!Array.isArray(values) || values.length > 100) {
    throw new TypeError('BookOrbit series memberships are invalid');
  }
  const byProviderId = new Map();
  for (const value of values) {
    const membership = normalizeMembership(value);
    if (!byProviderId.has(membership.providerSeriesId)) {
      byProviderId.set(membership.providerSeriesId, membership);
    }
  }
  return Array.from(byProviderId.values()).sort((left, right) =>
    left.displayOrder - right.displayOrder || left.providerSeriesId.localeCompare(right.providerSeriesId));
}

async function syncBookOrbitSeriesMemberships(client, {
  spaceId: spaceIdValue,
  mediaId: mediaIdValue,
  providerConnectionId,
  actorId: actorIdValue,
  memberships: membershipValues
} = {}) {
  if (!client || typeof client.query !== 'function') {
    throw new TypeError('BookOrbit series membership sync requires a transaction client');
  }
  const spaceId = positiveInteger(spaceIdValue, 'Workspace');
  const mediaId = positiveInteger(mediaIdValue, 'Canonical media');
  const actorId = positiveInteger(actorIdValue, 'Actor');
  const connectionId = boundedText(providerConnectionId, 80, 'BookOrbit provider connection', { required: true });
  const memberships = normalizeMemberships(membershipValues);
  const activeSeriesRecordIds = [];
  let created = 0;
  let updated = 0;

  for (const membership of memberships) {
    const series = await client.query(
      `INSERT INTO provider_series_records
         (space_id, provider_connection_id, provider_series_id, name, source_kind,
          source_updated_at, created_by, updated_by)
       VALUES ($1, $2, $3, $4, 'bookorbit_native', $5, $6, $6)
       ON CONFLICT (space_id, provider_connection_id, provider_series_id)
       DO UPDATE SET name = EXCLUDED.name,
                     source_kind = EXCLUDED.source_kind,
                     source_updated_at = COALESCE(EXCLUDED.source_updated_at, provider_series_records.source_updated_at),
                     last_seen_at = CURRENT_TIMESTAMP,
                     active = true,
                     deactivated_at = NULL,
                     updated_by = EXCLUDED.updated_by
       RETURNING id`,
      [spaceId, connectionId, membership.providerSeriesId, membership.name, membership.sourceUpdatedAt, actorId]
    );
    const seriesRecordId = series.rows[0]?.id;
    if (!seriesRecordId) throw new Error('BookOrbit provider series could not be synchronized');
    activeSeriesRecordIds.push(seriesRecordId);

    const persisted = await client.query(
      `INSERT INTO media_series_memberships
         (space_id, media_id, provider_connection_id, provider_series_record_id,
          series_index, volume, issue_number, display_order, expected_item_count,
          source_kind, source_updated_at, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'bookorbit_native', $10, $11, $11)
       ON CONFLICT (space_id, media_id, provider_series_record_id)
       DO UPDATE SET series_index = EXCLUDED.series_index,
                     volume = EXCLUDED.volume,
                     issue_number = EXCLUDED.issue_number,
                     display_order = EXCLUDED.display_order,
                     expected_item_count = EXCLUDED.expected_item_count,
                     source_kind = EXCLUDED.source_kind,
                     source_updated_at = COALESCE(EXCLUDED.source_updated_at, media_series_memberships.source_updated_at),
                     last_seen_at = CURRENT_TIMESTAMP,
                     active = true,
                     deactivated_at = NULL,
                     updated_by = EXCLUDED.updated_by
       RETURNING (xmax = 0) AS inserted`,
      [
        spaceId,
        mediaId,
        connectionId,
        seriesRecordId,
        membership.seriesIndex,
        membership.volume,
        membership.issueNumber,
        membership.displayOrder,
        membership.expectedItemCount,
        membership.sourceUpdatedAt,
        actorId
      ]
    );
    if (persisted.rows[0]?.inserted) created += 1;
    else updated += 1;
  }

  const retired = await client.query(
    `UPDATE media_series_memberships
        SET active = false,
            deactivated_at = CURRENT_TIMESTAMP,
            updated_by = $4
      WHERE space_id = $1
        AND media_id = $2
        AND provider_connection_id = $3
        AND active
        AND NOT (provider_series_record_id = ANY($5::uuid[]))
      RETURNING id`,
    [spaceId, mediaId, connectionId, actorId, activeSeriesRecordIds]
  );
  const retiredSeries = await client.query(
    `UPDATE provider_series_records psr
        SET active = false,
            deactivated_at = CURRENT_TIMESTAMP,
            updated_by = $3
      WHERE psr.space_id = $1
        AND psr.provider_connection_id = $2
        AND psr.active
        AND NOT EXISTS (
          SELECT 1
            FROM media_series_memberships msm
           WHERE msm.space_id = psr.space_id
             AND msm.provider_connection_id = psr.provider_connection_id
             AND msm.provider_series_record_id = psr.id
             AND msm.active
        )
      RETURNING psr.id`,
    [spaceId, connectionId, actorId]
  );

  return Object.freeze({
    observed: memberships.length,
    created,
    updated,
    retired: retired.rows.length,
    seriesRetired: retiredSeries.rows.length
  });
}

module.exports = {
  normalizeMembership,
  normalizeMemberships,
  syncBookOrbitSeriesMemberships
};
