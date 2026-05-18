import React, { useEffect, useState } from 'react';
import { DetailDrawerShell, Icons } from './app/AppPrimitives';
import SyncJobDetailDrawer from './SyncJobDetailDrawer';

const FILTERS = [
  { id: 'all', label: 'All activity' },
  { id: 'imports', label: 'Imports' },
  { id: 'providers', label: 'Providers' },
  { id: 'library', label: 'Library' },
  { id: 'events', label: 'Events' },
  { id: 'people', label: 'People' },
  { id: 'security', label: 'Security' },
  { id: 'errors', label: 'Failures' }
];

const MEDIA_TYPE_TAB = {
  movie: 'library-movies',
  tv: 'library-tv',
  book: 'library-books',
  audio: 'library-audio',
  game: 'library-games',
  comic_book: 'library-comics'
};

function titleCase(value) {
  return String(value || '')
    .split('.')
    .filter(Boolean)
    .map((part) => part.replace(/_/g, ' '))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' / ');
}

function sentenceCase(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function formatActionLabel(action) {
  return titleCase(action || 'activity');
}

function formatEntityLabel(entry) {
  if (!entry?.entity_type) return 'No entity target';
  return `${entry.entity_type}${entry.entity_id ? ` #${entry.entity_id}` : ''}`;
}

function formatRelativeDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value || '');
  const diffMs = Date.now() - parsed.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs >= 0 && diffMs < minute) return 'Just now';
  if (diffMs >= 0 && diffMs < hour) return `${Math.floor(diffMs / minute)}m ago`;
  if (diffMs >= 0 && diffMs < day) return `${Math.floor(diffMs / hour)}h ago`;
  return parsed.toLocaleString();
}

function compactValue(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return value;
  return '';
}

function detailValue(details, keys = []) {
  if (!details || typeof details !== 'object') return '';
  for (const key of keys) {
    const value = compactValue(details[key]);
    if (value) return value;
  }
  return '';
}

function detailNumber(details, keys = []) {
  for (const key of keys) {
    const value = Number(details?.[key] || 0);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function formatDateTime(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value || '');
  return parsed.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatCountLabel(count, singular, plural = `${singular}s`) {
  const n = Number(count || 0);
  return `${n} ${n === 1 ? singular : plural}`;
}

function formatSummaryParts(values = []) {
  return values
    .filter((value) => value !== null && value !== undefined && value !== '')
    .map((value) => String(value))
    .join(' · ');
}

function buildSnapshotRows(entry, details) {
  const rows = [
    ['Action', entry?.action],
    ['Target', formatEntityLabel(entry)],
    ['Recorded', formatDateTime(entry?.created_at)],
    ['User', entry?.user_email || (entry?.user_id ? `User #${entry.user_id}` : 'System')],
    ['Title', detailValue(details, ['title', 'mediaTitle', 'eventTitle', 'name'])],
    ['Type', detailValue(details, ['mediaType', 'media_type', 'object_type', 'itemType'])],
    ['Status', detailValue(details, ['status', 'details_status'])],
    ['Reason', detailValue(details, ['reason', 'error', 'message'])],
    ['Provider', detailValue(details, ['provider', 'provider_name', 'source', 'integration'])],
    ['Space', detailValue(details, ['spaceName', 'spaceId', 'space_id'])],
    ['Library', detailValue(details, ['libraryName', 'libraryId', 'library_id'])]
  ];
  return rows
    .map(([label, value]) => [label, compactValue(value)])
    .filter(([, value]) => value);
}

function buildImportSummary(entry, details) {
  const action = String(entry?.action || '');
  const provider = detailValue(details, ['provider', 'source', 'import_source']) || action.split('.').filter(Boolean).pop() || 'provider';
  const rows = details?.rows ?? details?.rowCount ?? details?.totalRows ?? details?.summary?.rows;
  const created = details?.created ?? details?.createdCount ?? details?.summary?.created ?? details?.summary?.createdCount;
  const updated = details?.updated ?? details?.updatedCount ?? details?.summary?.updated ?? details?.summary?.updatedCount;
  const skipped = details?.skipped ?? details?.skippedCount ?? details?.summary?.skipped ?? details?.summary?.skippedCount;
  const parts = [
    rows !== undefined ? formatCountLabel(rows, 'row') : null,
    created !== undefined ? formatCountLabel(created, 'created', 'created') : null,
    updated !== undefined ? formatCountLabel(updated, 'updated', 'updated') : null,
    skipped !== undefined ? formatCountLabel(skipped, 'skipped', 'skipped') : null
  ].filter(Boolean);
  return {
    title: action.endsWith('.failed') ? `${sentenceCase(provider)} import failed` : `${sentenceCase(provider)} import finished`,
    summary: parts.length ? parts.join(' · ') : 'Import activity was recorded.',
    category: 'Imports'
  };
}

function countPart(details, keys, singular, plural = `${singular}s`) {
  const value = detailNumber(details, keys);
  return value === null ? null : formatCountLabel(value, singular, plural);
}

function buildPlexTimelineEntry(entry, details) {
  const action = String(entry?.action || '');
  const targetName = detailValue(details, ['title', 'mediaTitle', 'name']) || formatEntityLabel(entry);
  const failed = action.includes('failed') || action.includes('failure');

  if (action.includes('.reconciliation.preview_job')) {
    return {
      title: failed ? 'Plex reconciliation preview failed' : 'Plex reconciliation preview finished',
      summary: formatSummaryParts([
        countPart(details, ['scanned'], 'scanned', 'scanned'),
        countPart(details, ['alreadyLinked'], 'linked', 'linked'),
        countPart(details, ['conflicts'], 'conflict'),
        countPart(details, ['created'], 'created', 'created'),
        detailValue(details, ['detail', 'error', 'reason'])
      ]) || 'Plex library reconciliation preview activity was recorded.',
      category: failed ? 'Failures' : 'Providers'
    };
  }

  if (action.includes('.reconciliation.sync_job') || action.includes('.reconciliation.sync_scheduler')) {
    return {
      title: failed ? 'Plex reconciliation sync failed' : 'Plex reconciliation sync ran',
      summary: formatSummaryParts([
        countPart(details, ['targetCount'], 'target'),
        countPart(details, ['jobsQueued'], 'job queued', 'jobs queued'),
        countPart(details, ['scanned'], 'scanned', 'scanned'),
        countPart(details, ['created'], 'created', 'created'),
        countPart(details, ['updated'], 'updated', 'updated'),
        countPart(details, ['conflicts'], 'conflict'),
        detailValue(details, ['detail', 'error', 'reason'])
      ]) || 'Plex reconciliation sync activity was recorded.',
      category: failed ? 'Failures' : 'Providers'
    };
  }

  if (action.includes('.reconciliation.conflict_resolved')) {
    return {
      title: 'Plex conflict resolved',
      summary: formatSummaryParts([
        detailValue(details, ['action']),
        detailValue(details, ['resolvedMediaId', 'existingMediaId']),
        detailValue(details, ['notes'])
      ]) || targetName,
      category: 'Providers'
    };
  }

  if (action.includes('.rating.writeback')) {
    return {
      title: failed ? 'Plex rating writeback failed' : 'Plex rating written to Plex',
      summary: formatSummaryParts([
        targetName,
        detailValue(details, ['rating']),
        detailValue(details, ['detail', 'error', 'reason'])
      ]),
      category: failed ? 'Failures' : 'Providers'
    };
  }

  if (action.includes('.rating.apply')) {
    return {
      title: failed ? 'Plex rating readback failed' : 'Plex ratings read from Plex',
      summary: formatSummaryParts([
        countPart(details, ['readEntries'], 'rating read', 'ratings read'),
        countPart(details, ['ratingsUpdated'], 'rating updated', 'ratings updated'),
        countPart(details, ['sectionIdCount'], 'section'),
        detailValue(details, ['detail', 'error', 'reason'])
      ]) || 'Plex rating readback activity was recorded.',
      category: failed ? 'Failures' : 'Providers'
    };
  }

  if (action.includes('.watch_state.writeback')) {
    return {
      title: failed ? 'Plex watched-state writeback failed' : 'Plex watched state written to Plex',
      summary: formatSummaryParts([
        targetName,
        detailValue(details, ['action']),
        detailValue(details, ['watched']),
        detailValue(details, ['detail', 'error', 'reason'])
      ]),
      category: failed ? 'Failures' : 'Providers'
    };
  }

  if (action.includes('.watch_state.apply') || action.includes('.watch_state.refresh')) {
    return {
      title: failed ? 'Plex watched-state readback failed' : 'Plex watched state read from Plex',
      summary: formatSummaryParts([
        countPart(details, ['entriesRead', 'readEntries'], 'state read', 'states read'),
        countPart(details, ['itemsUpdated', 'updated'], 'item updated', 'items updated'),
        countPart(details, ['scopeCount', 'scopesProcessed'], 'scope'),
        detailValue(details, ['reason', 'detail', 'error'])
      ]) || 'Plex watched-state readback activity was recorded.',
      category: failed ? 'Failures' : 'Providers'
    };
  }

  return {
    title: failed ? 'Plex provider activity failed' : 'Plex provider activity recorded',
    summary: formatSummaryParts([targetName, detailValue(details, ['detail', 'error', 'reason'])]),
    category: failed ? 'Failures' : 'Providers'
  };
}

function buildEventTimelineEntry(entry, details) {
  const action = String(entry?.action || '');
  const targetName = detailValue(details, ['eventTitle', 'title', 'name']) || formatEntityLabel(entry);
  const failed = action.includes('failed') || action.includes('failure');
  const removed = action.includes('.delete') || action.includes('.discard');
  const updated = action.includes('.update') || action.includes('.replace') || action.includes('.save');
  const verb = removed ? 'removed' : updated ? 'updated' : 'added';

  if (action === 'events.create') {
    return {
      title: 'Event created',
      summary: formatSummaryParts([targetName, detailValue(details, ['date_start']), detailValue(details, ['location'])]),
      category: 'Events'
    };
  }

  if (action === 'events.update') {
    return {
      title: 'Event details updated',
      summary: formatSummaryParts([targetName, detailValue(details, ['fields'])]) || targetName,
      category: 'Events'
    };
  }

  if (action === 'events.delete') {
    return {
      title: 'Event deleted',
      summary: targetName,
      category: 'Events'
    };
  }

  if (action.startsWith('events.attendee.')) {
    return {
      title: `Event attendee ${verb}`,
      summary: formatSummaryParts([targetName, detailValue(details, ['attendeeName']), detailValue(details, ['attendeeId']) ? `Attendee #${detailValue(details, ['attendeeId'])}` : null]),
      category: 'Events'
    };
  }

  if (action.startsWith('events.group.')) {
    return {
      title: `Event group ${verb}`,
      summary: formatSummaryParts([targetName, detailValue(details, ['groupName']), detailValue(details, ['groupId']) ? `Group #${detailValue(details, ['groupId'])}` : null]),
      category: 'Events'
    };
  }

  if (action.startsWith('events.meetup.')) {
    return {
      title: `Meetup ${verb}`,
      summary: formatSummaryParts([targetName, detailValue(details, ['meetupTitle', 'title']), detailValue(details, ['meetupId']) ? `Meetup #${detailValue(details, ['meetupId'])}` : null]),
      category: 'Events'
    };
  }

  if (action.startsWith('events.schedule_plan.')) {
    return {
      title: `Schedule plan ${verb}`,
      summary: formatSummaryParts([targetName, detailValue(details, ['scheduleTitle', 'title']), detailValue(details, ['requestedStatus', 'status']), detailValue(details, ['schedulePlanId']) ? `Plan #${detailValue(details, ['schedulePlanId'])}` : null]),
      category: 'Events'
    };
  }

  if (action.startsWith('events.schedule_change.preview')) {
    return {
      title: 'Schedule change previewed',
      summary: formatSummaryParts([targetName, detailValue(details, ['requestedStatus']), detailValue(details, ['messageIntent'])]),
      category: 'Events'
    };
  }

  if (action.startsWith('events.schedule_notification.')) {
    const title = action.includes('.send') ? 'Schedule notification sent'
      : action.includes('.draft') ? 'Schedule notification drafted'
        : action.includes('.discard') ? 'Schedule notification discarded'
          : 'Schedule notification updated';
    return {
      title,
      summary: formatSummaryParts([targetName, detailValue(details, ['channel']), detailValue(details, ['status']), detailValue(details, ['notificationId']) ? `Notification #${detailValue(details, ['notificationId'])}` : null]),
      category: 'Events'
    };
  }

  if (action.startsWith('events.schedule_session.import_ics.')) {
    const summary = details?.summary && typeof details.summary === 'object' ? details.summary : {};
    return {
      title: failed ? 'Event schedule import failed' : 'Event schedule import finished',
      summary: formatSummaryParts([
        targetName,
        countPart(summary, ['created'], 'created', 'created'),
        countPart(summary, ['updated'], 'updated', 'updated'),
        countPart(summary, ['skipped'], 'skipped', 'skipped'),
        detailValue(details, ['error', 'detail'])
      ]),
      category: failed ? 'Failures' : 'Events'
    };
  }

  if (action.startsWith('events.schedule_session.')) {
    return {
      title: `Catalog session ${verb}`,
      summary: formatSummaryParts([targetName, detailValue(details, ['sessionTitle', 'title']), detailValue(details, ['scheduleSessionId']) ? `Session #${detailValue(details, ['scheduleSessionId'])}` : null]),
      category: 'Events'
    };
  }

  if (action.startsWith('events.personal_ics_source.')) {
    return {
      title: failed ? 'Personal calendar sync failed' : action.includes('.sync.') ? 'Personal calendar synced' : action.includes('.delete') ? 'Personal calendar removed' : 'Personal calendar saved',
      summary: formatSummaryParts([targetName, detailValue(details, ['sourceId']) ? `Source #${detailValue(details, ['sourceId'])}` : null, detailValue(details, ['error', 'detail'])]),
      category: failed ? 'Failures' : 'Events'
    };
  }

  if (action.startsWith('events.artifact.')) {
    return {
      title: action.includes('.signature.link') ? 'Event signature linked' : `Event artifact ${verb}`,
      summary: formatSummaryParts([targetName, detailValue(details, ['title']), detailValue(details, ['artifactType']), detailValue(details, ['artifactId']) ? `Artifact #${detailValue(details, ['artifactId'])}` : null]),
      category: 'Events'
    };
  }

  if (action.startsWith('events.purchased_item.')) {
    return {
      title: `Event purchase link ${verb}`,
      summary: formatSummaryParts([targetName, detailValue(details, ['itemType']), detailValue(details, ['purchasedItemId']) ? `Link #${detailValue(details, ['purchasedItemId'])}` : null]),
      category: 'Events'
    };
  }

  if (action.startsWith('events.image.') || action.startsWith('events.attachment.')) {
    return {
      title: action.includes('.delete') ? 'Event image removed' : action.includes('.replace') ? 'Event image replaced' : 'Event image uploaded',
      summary: targetName,
      category: 'Events'
    };
  }

  return {
    title: failed ? 'Event activity failed' : 'Event activity recorded',
    summary: targetName,
    category: failed ? 'Failures' : 'Events'
  };
}

function buildTimelineEntry(entry) {
  const action = String(entry?.action || '');
  const details = entry?.details && typeof entry.details === 'object' ? entry.details : {};
  const targetName = detailValue(details, ['title', 'name', 'mediaTitle', 'eventTitle', 'spaceName', 'libraryName']);
  const provider = detailValue(details, ['provider', 'provider_name', 'integration', 'source']);
  const reason = detailValue(details, ['reason', 'error', 'message']);

  let title = formatActionLabel(action);
  let summary = targetName || formatEntityLabel(entry);
  let category = 'Activity';

  if (action.includes('.import.')) {
    return buildImportSummary(entry, details);
  } else if (action === 'media.import_barcode' || action === 'media.import_barcode.existing') {
    title = action.endsWith('.existing') ? 'Scanner found an existing library item' : 'Scanner added a library item';
    summary = [targetName || formatEntityLabel(entry), detailValue(details, ['barcode', 'upc', 'isbn'])].filter(Boolean).join(' · ');
    category = 'Scanner';
  } else if (action.startsWith('media.plex.')) {
    return buildPlexTimelineEntry(entry, details);
  } else if (action.includes('.kavita.')) {
    title = action.endsWith('.failed') ? 'Kavita activity failed' : 'Kavita activity recorded';
    summary = [targetName || formatEntityLabel(entry), provider].filter(Boolean).join(' · ');
    category = 'Providers';
  } else if (action.startsWith('media.valuation.')) {
    title = action.endsWith('.failed') ? 'Valuation refresh failed' : 'Valuation was refreshed';
    summary = [targetName || formatEntityLabel(entry), provider].filter(Boolean).join(' · ');
    category = 'Providers';
  } else if (action === 'media.create') {
    title = 'Library item added';
    summary = targetName || formatEntityLabel(entry);
    category = 'Library';
  } else if (action === 'media.update') {
    title = 'Library item updated';
    summary = targetName || formatEntityLabel(entry);
    category = 'Library';
  } else if (action === 'media.delete') {
    title = 'Library item deleted';
    summary = targetName || formatEntityLabel(entry);
    category = 'Library';
  } else if (action.startsWith('wishlist.')) {
    title = action === 'wishlist.convert' ? 'Wishlist item added to library' : `Wishlist item ${action.split('.').pop()}`;
    summary = [targetName || formatEntityLabel(entry), detailValue(details, ['object_type', 'status'])].filter(Boolean).join(' · ');
    category = 'Library';
  } else if (action.startsWith('capture.')) {
    title = action === 'capture.convert_wishlist'
      ? 'Capture added to Wishlist'
      : action.includes('.delete')
        ? 'Capture deleted'
        : action.includes('.update')
          ? 'Capture updated'
          : 'Capture saved';
    summary = [targetName || formatEntityLabel(entry), detailValue(details, ['captureType']), detailValue(details, ['barcode', 'status'])].filter(Boolean).join(' · ');
    category = 'Scanner';
  } else if (action.startsWith('art.') || action.startsWith('collectibles.')) {
    title = action.includes('.delete') ? 'Collection item deleted' : action.includes('.update') ? 'Collection item updated' : 'Collection item added';
    summary = targetName || formatEntityLabel(entry);
    category = 'Library';
  } else if (action.startsWith('event.') || action.startsWith('events.')) {
    return buildEventTimelineEntry(entry, details);
  } else if (action.startsWith('space.') || action.startsWith('admin.space.')) {
    title = action.includes('member') ? 'Workspace member changed' : action.includes('invite') ? 'Workspace invite changed' : 'Workspace settings changed';
    summary = targetName || formatEntityLabel(entry);
    category = 'People';
  } else if (action.startsWith('admin.settings.integrations') || action.startsWith('space.settings.integrations')) {
    title = provider ? `${sentenceCase(provider)} integration changed` : 'Integration settings changed';
    summary = reason || targetName || formatEntityLabel(entry);
    category = 'Providers';
  } else if (action.startsWith('auth.') || action.startsWith('security.')) {
    title = action.includes('denied') || action.includes('failed') ? 'Access attempt blocked' : 'Account access activity';
    summary = reason || entry.user_email || formatEntityLabel(entry);
    category = 'Security';
  } else if (action.includes('failed') || action.includes('fail')) {
    title = `${formatActionLabel(action.replace(/\.failed$/, ''))} failed`;
    summary = reason || targetName || formatEntityLabel(entry);
    category = 'Failures';
  }

  if (reason && !summary.includes(reason)) {
    summary = summary ? `${summary} · ${reason}` : reason;
  }

  return {
    title,
    summary,
    category
  };
}

function filterMatches(entry, filter) {
  if (filter === 'all') return true;
  const action = String(entry?.action || '');
  const readable = buildTimelineEntry(entry);
  if (filter === 'imports') return action.includes('.import.') || action.includes('import_barcode');
  if (filter === 'providers') return readable.category === 'Providers' || action.includes('plex') || action.includes('kavita') || action.includes('valuation') || action.includes('integrations');
  if (filter === 'library') return readable.category === 'Library' || action.startsWith('media.') || action.startsWith('wishlist.') || action.startsWith('art.') || action.startsWith('collectibles.');
  if (filter === 'events') return readable.category === 'Events' || action.startsWith('event.') || action.startsWith('events.');
  if (filter === 'people') return readable.category === 'People' || action.includes('member') || action.includes('invite') || action.startsWith('space.');
  if (filter === 'security') return readable.category === 'Security' || action.startsWith('auth.') || action.startsWith('security.');
  if (filter === 'errors') return action.includes('failed') || action.includes('fail') || entry?.details_status || entry?.details_reason;
  return true;
}

function inferIntegrationSection(entry, details) {
  const action = String(entry?.action || '').toLowerCase();
  const provider = String(detailValue(details, ['provider', 'provider_name', 'integration', 'source']) || '').toLowerCase();
  const joined = `${action} ${provider}`;
  if (joined.includes('plex')) return 'plex';
  if (joined.includes('kavita')) return 'kavita';
  if (joined.includes('barcode') || joined.includes('upc')) return 'barcode';
  if (joined.includes('googlebooks') || joined.includes('google books') || joined.includes('books')) return 'books';
  if (joined.includes('metron') || joined.includes('comic')) return 'comics';
  if (joined.includes('tmdb')) return 'tmdb';
  if (joined.includes('pricecharting')) return 'pricecharting';
  if (joined.includes('ebay')) return 'ebay';
  if (joined.includes('log')) return 'logs';
  if (joined.includes('metric')) return 'metrics';
  return null;
}

function buildTimelineLinks(entry, context) {
  const action = String(entry?.action || '');
  const details = entry?.details && typeof entry.details === 'object' ? entry.details : {};
  const entityType = String(entry?.entity_type || '');
  const entityId = Number(entry?.entity_id || 0) || null;
  const isDeleted = action.includes('.delete') || action.includes('.deleted') || action.includes('.archive');
  const mediaType = String(detailValue(details, ['mediaType', 'media_type']) || '').toLowerCase();
  const mediaTab = MEDIA_TYPE_TAB[mediaType] || 'library';

  const links = [];
  const push = (label, target) => {
    if (!target) return;
    const key = `${label}:${JSON.stringify(target)}`;
    if (links.some((link) => link.key === key)) return;
    links.push({ key, label, target });
  };

  if (entityType === 'media' && entityId && !isDeleted) {
    push('Open item', {
      tab: mediaTab,
      focus: { entityType: 'media', entityId, title: detailValue(details, ['title', 'mediaTitle']) }
    });
  } else if (entityType === 'media' || action.startsWith('media.')) {
    push('Open library', { tab: mediaTab });
  }

  if (entityType === 'art' && entityId && !isDeleted) {
    push('Open art', {
      tab: 'library-art',
      focus: { entityType: 'art', entityId, title: detailValue(details, ['title', 'name']) }
    });
  }

  if (entityType === 'collectible' && entityId && !isDeleted) {
    push('Open collectible', {
      tab: 'library-collectibles',
      focus: { entityType: 'collectible', entityId, title: detailValue(details, ['title', 'name']) }
    });
  }

  if (entityType === 'event' && entityId && !isDeleted) {
    push('Open event', {
      tab: 'library-events',
      focus: { entityType: 'event', entityId, title: detailValue(details, ['eventTitle', 'title', 'name']) }
    });
  } else if (entityType === 'event' || action.startsWith('event.') || action.startsWith('events.')) {
    push('Open events', { tab: 'library-events' });
  }

  const syncJobId = entityType === 'sync_jobs'
    ? entityId
    : detailNumber(details, ['sync_job_id', 'syncJobId', 'job_id', 'jobId']);
  if (syncJobId) {
    const failed = action.includes('failed') || String(details.status || details.details_status || '').toLowerCase() === 'failed';
    push(failed ? 'Open failure' : 'Open sync', {
      syncJobId,
      syncJob: {
        id: syncJobId,
        provider: detailValue(details, ['provider', 'source', 'import_source']),
        job_type: detailValue(details, ['job_type', 'jobType', 'type']),
        status: failed ? 'failed' : detailValue(details, ['status']),
        error: detailValue(details, ['error', 'reason', 'message'])
      }
    });
  }

  if (entityType === 'sync_jobs' || entityType === 'media_import' || action.includes('.import.')) {
    push('Open imports', { tab: 'library-import' });
  }

  if (entityType === 'media_loan' || action.startsWith('media.loan.')) {
    push('Open loans', { tab: 'library-loans' });
  }

  if (entityType === 'app_integrations' || action.includes('integrations')) {
    const section = inferIntegrationSection(entry, details);
    if (context === 'workspace') {
      push('Open integrations', { managerTab: 'integrations', integrationSection: section });
    } else {
      push('Open integrations', { tab: 'admin-integrations', integrationSection: section });
    }
  }

  if (entityType === 'space_membership' || entityType === 'invite' || action.includes('.member.') || action.includes('.invite.')) {
    if (context === 'workspace') {
      push('Open people', { managerTab: 'people' });
    } else {
      push('Open workspaces', { tab: 'admin-spaces' });
    }
  }

  if (entityType === 'space' || action.startsWith('admin.space.') || action.startsWith('space.')) {
    push(context === 'workspace' ? 'Open workspace' : 'Open workspaces', context === 'workspace' ? { managerTab: 'settings' } : { tab: 'admin-spaces' });
  }

  if (entityType === 'user' && context !== 'workspace') {
    push('Open users', { tab: 'admin-users' });
  }

  return links;
}

function shouldOfferSnapshot(entry, links) {
  const action = String(entry?.action || '');
  const details = entry?.details && typeof entry.details === 'object' ? entry.details : {};
  const deletedOrArchived = action.includes('.delete') || action.includes('.deleted') || action.includes('.archive');
  return deletedOrArchived && Object.keys(details).length > 0 && !links.some((link) => link.target?.snapshotEntry);
}

function ActivitySnapshotDrawer({ entry, onClose }) {
  const details = entry?.details && typeof entry.details === 'object' ? entry.details : {};
  const readable = buildTimelineEntry(entry);
  const rows = buildSnapshotRows(entry, details);

  return (
    <DetailDrawerShell onClose={onClose} panelClassName="max-w-lg" testId="activity-snapshot-drawer">
      <div className="flex items-start justify-between gap-4 border-b border-edge px-5 py-4">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-ink">Activity snapshot</h2>
          <p className="mt-1 text-sm text-ghost">{readable.title}</p>
        </div>
        <button type="button" onClick={onClose} className="btn-icon btn-sm shrink-0" aria-label="Close activity snapshot">
          <Icons.X />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="space-y-5">
          <div className="rounded-lg border border-edge bg-raised/20 p-3">
            <p className="text-sm text-ink">{readable.summary || 'Activity was recorded.'}</p>
            <p className="mt-2 text-xs text-ghost">The original target may have been deleted or archived, so this view uses the activity snapshot saved at the time of the change.</p>
          </div>

          {rows.length > 0 ? (
            <dl className="rounded-lg border border-edge bg-panel px-3">
              {rows.map(([label, value]) => (
                <div key={label} className="flex items-start justify-between gap-4 border-t border-edge/70 py-2 first:border-t-0">
                  <dt className="text-xs text-ghost">{label}</dt>
                  <dd className="max-w-[65%] text-right text-sm text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          <details className="rounded-lg border border-edge bg-panel p-3 text-xs text-ghost">
            <summary className="cursor-pointer select-none text-dim">Technical payload</summary>
            <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-abyss px-3 py-2 font-mono text-[11px] text-ghost/85">
              {JSON.stringify({ ...entry, details }, null, 2)}
            </pre>
          </details>
        </div>
      </div>
    </DetailDrawerShell>
  );
}

export default function ActivityFeedView({
  apiCall,
  Spinner,
  endpoint,
  title = 'Activity',
  description = '',
  emptyMessage = 'No activity entries',
  embedded = false,
  context = 'workspace',
  onNavigate = null
}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [pageSize, setPageSize] = useState(50);
  const [selectedSyncJob, setSelectedSyncJob] = useState(null);
  const [selectedSnapshotEntry, setSelectedSnapshotEntry] = useState(null);

  const handleTimelineTarget = (target) => {
    if (target?.snapshotEntry) {
      setSelectedSnapshotEntry(target.snapshotEntry);
      return;
    }
    if (target?.syncJobId) {
      setSelectedSyncJob({ id: target.syncJobId, initialJob: target.syncJob || null });
      return;
    }
    onNavigate?.(target);
  };

  const load = async (targetPage = page, searchOverride = null) => {
    setLoading(true);
    try {
      const effectiveSearch = searchOverride !== null ? searchOverride : search;
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String((targetPage - 1) * pageSize)
      });
      if (effectiveSearch) params.set('search', effectiveSearch);
      if (filter === 'errors') params.set('search', 'failed');
      const data = await apiCall('get', `${endpoint}?${params}`);
      const rows = Array.isArray(data) ? data : [];
      setItems(rows);
      setHasMore(rows.length === pageSize);
      setPage(targetPage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, pageSize, filter]);

  const headingClassName = embedded ? 'text-xl font-medium text-ink' : 'section-title';
  const wrapperClassName = embedded ? 'space-y-6' : 'h-full overflow-y-auto p-4 sm:p-6 space-y-6';
  const visibleItems = items.filter((entry) => filterMatches(entry, filter));

  return (
    <div className={wrapperClassName}>
      <div className="space-y-2">
        <h1 className={headingClassName}>{title}</h1>
        {description ? (
          <p className="text-sm text-ghost max-w-3xl">
            {description}
          </p>
        ) : null}
      </div>
      <form
        className="flex gap-3 flex-wrap items-end border-y border-edge py-3"
        onSubmit={(e) => {
          e.preventDefault();
          load(1, search);
        }}
      >
        <label className="field flex-1 min-w-56">
          <span className="label">Search</span>
          <input
            className="input"
            placeholder="Action, user, target, or details"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="field w-40">
          <span className="label">Show</span>
          <select className="select" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }}>
            {FILTERS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label className="field w-24">
          <span className="label">Rows</span>
          <select className="select" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </label>
      </form>
      <div className="flex items-center gap-2">
        <button onClick={() => load(Math.max(1, page - 1))} disabled={loading || page <= 1} className="btn-secondary btn-sm">Previous</button>
        <span className="text-xs text-ghost font-mono">Page {page}</span>
        <button onClick={() => load(page + 1)} disabled={loading || !hasMore} className="btn-secondary btn-sm">Next</button>
      </div>
      {loading ? <div className="flex justify-center py-12"><Spinner size={28} /></div> : (
        <div className="divide-y divide-edge/70 border-b border-edge/70">
          {visibleItems.length === 0 && (
            <p className="px-4 py-6 text-sm text-ghost text-center">{items.length === 0 ? emptyMessage : 'No activity entries match this view.'}</p>
          )}
          {visibleItems.map((entry) => {
            const readable = buildTimelineEntry(entry);
            const details = entry.details && typeof entry.details === 'object' ? entry.details : {};
            const links = buildTimelineLinks(entry, context).filter((link) => link.target?.syncJobId || onNavigate);
            if (shouldOfferSnapshot(entry, links)) {
              links.push({
                key: `snapshot:${entry.id}`,
                label: 'View snapshot',
                target: { snapshotEntry: entry }
              });
            }
            return (
            <div key={entry.id} className="py-4 space-y-2">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{readable.title}</p>
                  <p className="mt-1 text-sm text-dim">
                    {readable.summary || 'Activity was recorded.'}
                  </p>
                  <p className="mt-1 text-xs text-ghost">
                    {[readable.category, entry.user_email || (entry.user_id ? `User #${entry.user_id}` : 'System'), formatEntityLabel(entry)].filter(Boolean).join(' · ')}
                  </p>
                  {links.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {links.map((link) => (
                        <button
                          key={link.key}
                          type="button"
                          className="btn-secondary btn-sm"
                          onClick={() => handleTimelineTarget(link.target)}
                        >
                          {link.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <span className="text-xs text-ghost shrink-0">{formatRelativeDate(entry.created_at)}</span>
              </div>
              <details className="text-xs text-ghost">
                <summary className="cursor-pointer select-none text-dim">Technical details</summary>
                <div className="mt-2 space-y-2">
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ghost">
                    <span>{entry.action}</span>
                    {entry.ip_address ? <span>{entry.ip_address}</span> : null}
                    {entry.created_at ? <span>{new Date(entry.created_at).toLocaleString()}</span> : null}
                    {entry.details_status ? <span>Status {entry.details_status}</span> : null}
                    {entry.details_reason ? <span>{entry.details_reason}</span> : null}
                  </div>
                  {Object.keys(details).length > 0 ? (
                    <pre className="whitespace-pre-wrap break-words rounded-md bg-raised px-3 py-2 font-mono text-[11px] text-ghost/80">
                      {JSON.stringify(details, null, 2)}
                    </pre>
                  ) : null}
                </div>
              </details>
            </div>
          );
          })}
        </div>
      )}
      {selectedSyncJob ? (
        <SyncJobDetailDrawer
          apiCall={apiCall}
          jobId={selectedSyncJob.id}
          initialJob={selectedSyncJob.initialJob}
          onClose={() => setSelectedSyncJob(null)}
          Spinner={Spinner}
        />
      ) : null}
      {selectedSnapshotEntry ? (
        <ActivitySnapshotDrawer
          entry={selectedSnapshotEntry}
          onClose={() => setSelectedSnapshotEntry(null)}
        />
      ) : null}
    </div>
  );
}
