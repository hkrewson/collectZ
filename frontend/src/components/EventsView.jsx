import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckboxControl, CollectionPaginationFooter, CoverImagePicker, DetailDrawerShell, DrawerBackdrop, Icons, ImageSourceControl, Spinner, SectionTabPanel, SectionTabs, cx, posterUrl, ObjectPosterCard } from './app/AppPrimitives';

const DEFAULT_EVENT_FORM = {
  title: '',
  url: '',
  location: '',
  date_start: '',
  date_end: '',
  host: '',
  time_label: '',
  room: '',
  notes: ''
};

const DEFAULT_ARTIFACT_FORM = {
  artifact_type: 'note',
  title: '',
  description: '',
  vendor: '',
  price: '',
  image_path: '',
  signer_name: '',
  signer_role: '',
  signed_on: '',
  signed_at: '',
  signature_proof_path: '',
  signature_notes: ''
};

const EMPTY_SOCIAL_FORM = {
  attendeeName: '',
  attendeeRelationship: '',
  attendeeLinkCurrentUser: false,
  groupName: '',
  meetupTitle: '',
  meetupLocation: '',
  meetupVendor: '',
  meetupBooth: '',
  meetupLocationNotes: '',
  meetupStart: '',
  meetupGroupId: '',
  planTitle: '',
  planLocation: '',
  planVendor: '',
  planBooth: '',
  planLocationNotes: '',
  planStart: '',
  catalogTitle: '',
  catalogLocation: '',
  catalogRoom: '',
  catalogTrack: '',
  catalogCategories: '',
  catalogStart: '',
  catalogEnd: '',
  catalogSourceUrl: '',
  catalogDescription: '',
  catalogImportUrl: '',
  icsUrl: ''
};

const MEETUP_STATUS_OPTIONS = [
  { value: 'planned', label: 'Planned' },
  { value: 'tentative', label: 'Tentative' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'done', label: 'Done' }
];

const SCHEDULE_PLAN_STATUS_OPTIONS = [
  { value: 'planned', label: 'Planned' },
  { value: 'maybe', label: 'Maybe' },
  { value: 'backup', label: 'Backup' },
  { value: 'skipped', label: 'Skipped' },
  { value: 'attended', label: 'Attended' }
];

const QUICK_SCHEDULE_PLAN_STATUS_OPTIONS = SCHEDULE_PLAN_STATUS_OPTIONS
  .filter((option) => ['planned', 'maybe', 'backup', 'skipped'].includes(option.value));

const CONFLICTING_SCHEDULE_PLAN_STATUSES = new Set(['planned', 'maybe', 'backup']);
const ATTENDANCE_READBACK_STATUSES = ['planned', 'maybe', 'backup'];
const SHARED_ATTENDANCE_VISIBILITIES = ['selected_people', 'group', 'event_workspace'];

const SCHEDULE_PLAN_VISIBILITY_OPTIONS = [
  { value: 'private', label: 'Private' },
  { value: 'event_workspace', label: 'Shared with event' }
];

const SCHEDULE_CATALOG_STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'hidden', label: 'Hidden' }
];

const CATALOG_TIME_FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'now', label: 'Now' },
  { value: 'next', label: 'Next' },
  { value: 'later_today', label: 'Later today' }
];

const CATALOG_PLAN_FILTER_OPTIONS = [
  { value: 'all', label: 'Any plan state' },
  { value: 'none', label: 'Not in schedule' },
  ...SCHEDULE_PLAN_STATUS_OPTIONS.map((option) => option)
];

const CATALOG_METADATA_ALL_VALUE = 'all';

const toInputDate = (value) => {
  if (!value) return '';
  const text = String(value).trim();
  if (!text) return '';
  const isoDateMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDateMatch) return isoDateMatch[1];
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
};

const toDisplayDate = (value) => {
  const normalized = toInputDate(value);
  if (!normalized) return '';
  const [year, month, day] = normalized.split('-');
  return `${month}/${day}/${year}`;
};

const formatUploadError = (message) => {
  const raw = String(message || '');
  if (raw.includes('status code 413')) {
    return 'Image upload failed: file too large (max 10MB)';
  }
  return raw || 'Image upload failed';
};

const pluralizeArtifacts = (count) => `${count || 0} artifact${Number(count || 0) === 1 ? '' : 's'}`;
const pluralizePeople = (count) => `${count || 0} ${Number(count || 0) === 1 ? 'person' : 'people'}`;

const fromDateTimeInput = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const toDateTimeInput = (value) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const offsetMs = parsed.getTimezoneOffset() * 60 * 1000;
  return new Date(parsed.getTime() - offsetMs).toISOString().slice(0, 16);
};

const formatDateTime = (value) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

const formatTimeOnly = (value) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const stripMeridiem = (value) => String(value || '').replace(/\s?[AP]M$/i, '').trim();

const getMeridiem = (value) => {
  const match = String(value || '').match(/([AP]M)$/i);
  return match ? match[1].toUpperCase() : '';
};

const formatAgendaTime = (startValue, endValue) => {
  const start = formatTimeOnly(startValue);
  const end = formatTimeOnly(endValue);
  if (!start) return { start: 'No time', end: '' };
  if (!end) return { start, end: '' };
  const sameMeridiem = getMeridiem(start) && getMeridiem(start) === getMeridiem(end);
  return {
    start: sameMeridiem ? stripMeridiem(start) : start,
    end
  };
};

const formatPlanDayLabel = (value) => {
  if (!value) return 'Unscheduled';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Unscheduled';
  return parsed.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
};

const getPlanDayKey = (value) => {
  if (!value) return 'unscheduled';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'unscheduled';
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const sortPlansForAgenda = (plans) => [...plans].sort((a, b) => {
  const aTime = a?.start_at ? new Date(a.start_at).getTime() : Number.POSITIVE_INFINITY;
  const bTime = b?.start_at ? new Date(b.start_at).getTime() : Number.POSITIVE_INFINITY;
  if (Number.isNaN(aTime) && Number.isNaN(bTime)) return String(a?.title || '').localeCompare(String(b?.title || ''));
  if (Number.isNaN(aTime)) return 1;
  if (Number.isNaN(bTime)) return -1;
  if (aTime !== bTime) return aTime - bTime;
  return String(a?.title || '').localeCompare(String(b?.title || ''));
});

const findCurrentOrNextPlan = (plans, now = new Date()) => {
  const nowTime = now.getTime();
  const timedPlans = sortPlansForAgenda(Array.isArray(plans) ? plans : [])
    .map((plan) => ({ plan, startTime: plan?.start_at ? new Date(plan.start_at).getTime() : NaN, endTime: plan?.end_at ? new Date(plan.end_at).getTime() : NaN }))
    .filter((entry) => Number.isFinite(entry.startTime));
  const current = timedPlans.find((entry) => {
    const fallbackEnd = entry.startTime + (60 * 60 * 1000);
    const endTime = Number.isFinite(entry.endTime) ? entry.endTime : fallbackEnd;
    return entry.startTime <= nowTime && nowTime <= endTime;
  });
  if (current) return { plan: current.plan, label: 'Now' };
  const next = timedPlans.find((entry) => entry.startTime > nowTime);
  return next ? { plan: next.plan, label: 'Next' } : null;
};

const upcomingPlans = (plans, now = new Date()) => {
  const nowTime = now.getTime();
  return sortPlansForAgenda(Array.isArray(plans) ? plans : []).filter((plan) => {
    const startTime = plan?.start_at ? new Date(plan.start_at).getTime() : NaN;
    return Number.isFinite(startTime) && startTime >= nowTime;
  });
};

const catalogSessionTimeWindow = (session, now = new Date()) => {
  const startTime = session?.start_at ? new Date(session.start_at).getTime() : NaN;
  if (!Number.isFinite(startTime)) return null;
  const explicitEndTime = session?.end_at ? new Date(session.end_at).getTime() : NaN;
  const endTime = Number.isFinite(explicitEndTime) ? explicitEndTime : startTime + (60 * 60 * 1000);
  return {
    startTime,
    endTime,
    isNow: startTime <= now.getTime() && now.getTime() <= endTime,
    isUpcoming: startTime > now.getTime()
  };
};

const getCatalogNowNext = (sessions, plans = [], now = new Date()) => {
  const activeSessions = sortPlansForAgenda(Array.isArray(sessions) ? sessions : [])
    .filter((session) => session?.status !== 'hidden' && session?.status !== 'cancelled')
    .map((session) => ({ session, window: catalogSessionTimeWindow(session, now) }))
    .filter((entry) => entry.window);
  const catalogPlanByRef = buildCatalogPlanByRef(plans);
  const current = activeSessions
    .filter((entry) => entry.window.isNow)
    .sort((a, b) => a.window.endTime - b.window.endTime)[0]?.session || null;
  const upcoming = activeSessions
    .filter((entry) => entry.window.isUpcoming)
    .sort((a, b) => a.window.startTime - b.window.startTime)
    .map((entry) => entry.session);
  const next = upcoming[0] || null;
  const todayKey = getPlanDayKey(now);
  const excludedIds = new Set([current?.id, next?.id].filter(Boolean).map(String));
  const laterToday = upcoming
    .filter((session) => getPlanDayKey(session?.start_at) === todayKey && !excludedIds.has(String(session?.id || '')))
    .slice(0, 3);
  return { current, next, laterToday, catalogPlanByRef };
};

const chooseCatalogPlanForControl = (existing, candidate) => {
  if (!existing) return candidate;
  if ((candidate?.visibility || 'private') === 'private' && (existing?.visibility || 'private') !== 'private') return candidate;
  if ((existing?.visibility || 'private') === 'private' && (candidate?.visibility || 'private') !== 'private') return existing;
  return existing;
};

const getPlanCatalogSessionId = (plan) => {
  if (plan?.source_catalog_session_id) return String(plan.source_catalog_session_id);
  if (plan?.source_type === 'schedule_catalog' && plan?.source_ref) return String(plan.source_ref);
  return '';
};

const planLinksCatalogSession = (plan, session) => {
  const sessionId = String(session?.id || '');
  return Boolean(sessionId && getPlanCatalogSessionId(plan) === sessionId);
};

const buildCatalogPlanByRef = (plans = []) => {
  const map = new Map();
  (Array.isArray(plans) ? plans : [])
    .filter((plan) => getPlanCatalogSessionId(plan))
    .forEach((plan) => {
      const key = getPlanCatalogSessionId(plan);
      map.set(key, chooseCatalogPlanForControl(map.get(key), plan));
    });
  return map;
};

const catalogLinkedPlans = (session, plans = []) => {
  const sessionId = String(session?.id || '');
  if (!sessionId) return [];
  return (Array.isArray(plans) ? plans : [])
    .filter((plan) => planLinksCatalogSession(plan, session));
};

const formatPlanStatusCounts = (plans = []) => ATTENDANCE_READBACK_STATUSES
  .map((status) => {
    const count = plans.filter((plan) => (plan?.status || 'planned') === status).length;
    return count ? `${count} ${humanizeEventValue(status).toLowerCase()}` : '';
  })
  .filter(Boolean)
  .join(', ');

const buildScheduleAttendanceSummary = (session, plans = []) => {
  const linkedPlans = catalogLinkedPlans(session, plans);
  const activePlans = linkedPlans.filter((plan) => ATTENDANCE_READBACK_STATUSES.includes(plan?.status || 'planned'));
  const ownPlans = activePlans.filter((plan) => !SHARED_ATTENDANCE_VISIBILITIES.includes(plan?.visibility || 'private'));
  const sharedPlans = activePlans.filter((plan) => SHARED_ATTENDANCE_VISIBILITIES.includes(plan?.visibility || 'private'));
  const sharedLine = formatPlanStatusCounts(sharedPlans);
  const visibilityLines = SHARED_ATTENDANCE_VISIBILITIES
    .map((visibility) => {
      const line = formatPlanStatusCounts(sharedPlans.filter((plan) => (plan?.visibility || 'private') === visibility));
      return line ? `${eventVisibilityLabel(visibility)}: ${line}` : '';
    })
    .filter(Boolean);
  return {
    own: ownPlans.length ? `Your plan: ${formatPlanStatusCounts(ownPlans)}` : '',
    shared: sharedLine ? `Shared: ${sharedLine}` : '',
    visibilityLines,
    hasShared: sharedPlans.length > 0
  };
};

const getScheduleWindow = (item) => {
  const startTime = item?.start_at ? new Date(item.start_at).getTime() : NaN;
  if (!Number.isFinite(startTime)) return null;
  const explicitEndTime = item?.end_at ? new Date(item.end_at).getTime() : NaN;
  const endTime = Number.isFinite(explicitEndTime) ? explicitEndTime : startTime + (60 * 60 * 1000);
  if (endTime <= startTime) return null;
  return { startTime, endTime };
};

const scheduleWindowsOverlap = (a, b) => Boolean(a && b && a.startTime < b.endTime && b.startTime < a.endTime);

const isConflictEligiblePlan = (plan) => CONFLICTING_SCHEDULE_PLAN_STATUSES.has(plan?.status || 'planned');

const sameCatalogSourceRef = (a, b) => {
  const aCatalogId = getPlanCatalogSessionId(a);
  const bCatalogId = getPlanCatalogSessionId(b);
  return Boolean(aCatalogId && bCatalogId && aCatalogId === bCatalogId);
};

const buildScheduleConflictMap = (plans = []) => {
  const activePlans = (Array.isArray(plans) ? plans : [])
    .filter(isConflictEligiblePlan)
    .map((plan) => ({ plan, window: getScheduleWindow(plan) }))
    .filter((entry) => entry.window);
  const conflictMap = new Map();
  activePlans.forEach((entry, index) => {
    const conflicts = activePlans
      .filter((other, otherIndex) => (
        otherIndex !== index &&
        !sameCatalogSourceRef(entry.plan, other.plan) &&
        scheduleWindowsOverlap(entry.window, other.window)
      ))
      .map((other) => other.plan);
    if (conflicts.length) {
      conflictMap.set(String(entry.plan.id), conflicts);
    }
  });
  return conflictMap;
};

const findCatalogSessionConflicts = (session, plan, plans = []) => {
  if (!session || session.status === 'hidden' || session.status === 'cancelled') return [];
  if (plan && !isConflictEligiblePlan(plan)) return [];
  const candidateWindow = getScheduleWindow(plan || session);
  if (!candidateWindow) return [];
  return (Array.isArray(plans) ? plans : [])
    .filter(isConflictEligiblePlan)
    .filter((otherPlan) => !plan?.id || Number(otherPlan.id) !== Number(plan.id))
    .filter((otherPlan) => !planLinksCatalogSession(otherPlan, session))
    .filter((otherPlan) => !sameCatalogSourceRef(plan || session, otherPlan))
    .map((otherPlan) => ({ plan: otherPlan, window: getScheduleWindow(otherPlan) }))
    .filter((entry) => scheduleWindowsOverlap(candidateWindow, entry.window))
    .map((entry) => entry.plan);
};

const formatConflictSummary = (conflicts = []) => {
  const titles = (Array.isArray(conflicts) ? conflicts : [])
    .map((plan) => String(plan?.title || '').trim())
    .filter(Boolean);
  if (!titles.length) return '';
  if (titles.length === 1) return `Conflicts with ${titles[0]}`;
  return `Conflicts with ${titles[0]} +${titles.length - 1}`;
};

const isPendingCatalogResolution = (pendingResolution, session, source = '') => (
  Boolean(
    pendingResolution?.session?.id &&
    session?.id &&
    Number(pendingResolution.session.id) === Number(session.id) &&
    (!source || pendingResolution.source === source)
  )
);

const nextTimedItem = (items, dateKey = 'start_at', now = new Date()) => {
  const nowTime = now.getTime();
  return [...(Array.isArray(items) ? items : [])]
    .map((item) => ({ item, time: item?.[dateKey] ? new Date(item[dateKey]).getTime() : NaN }))
    .filter((entry) => Number.isFinite(entry.time) && entry.time >= nowTime)
    .sort((a, b) => a.time - b.time)[0]?.item || null;
};

const plainTextPreview = (value, maxLength = 220) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
};

const compactLocation = (value, maxLength = 52) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const roomFirst = text.split(',')[0]?.trim() || text;
  const normalized = roomFirst.length >= 4 ? roomFirst : text;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).trim()}...` : normalized;
};

const vendorBoothLabel = (item = {}) => {
  const vendor = String(item.vendor || '').trim();
  const booth = String(item.booth || '').trim();
  if (vendor && booth) return `${vendor} · Booth ${booth}`;
  return vendor || (booth ? `Booth ${booth}` : '');
};

const socialPlaceSummary = (item = {}) => [
  compactLocation(item.location),
  vendorBoothLabel(item),
  plainTextPreview(item.location_notes, 64)
].filter(Boolean).join(' · ');

const scheduleSourceLabel = (plan) => {
  if (plan?.source_type === 'schedule_catalog') return 'Catalog';
  if (plan?.source_type === 'sched_ics') return 'Sched';
  if (plan?.source_type) return String(plan.source_type).replace(/_/g, ' ');
  return 'Manual';
};

const parseCategoryList = (value) => String(value || '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean)
  .slice(0, 20);

const formatCategoryInput = (categories) => (Array.isArray(categories) ? categories.filter(Boolean).join(', ') : '');

const humanizeEventValue = (value) => {
  const text = String(value || '').replace(/_/g, ' ').trim();
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const eventVisibilityLabel = (value) => {
  const key = String(value || '').trim();
  if (key === 'event_workspace') return 'Shared';
  if (key === 'selected_people') return 'Selected';
  if (key === 'group') return 'Group';
  if (key === 'private') return 'Private';
  return humanizeEventValue(key);
};

const eventVisibilityTextClass = (value) => {
  const key = String(value || '').trim();
  if (key === 'event_workspace') return 'text-ok';
  if (key === 'selected_people' || key === 'group') return 'text-ink';
  return 'text-ghost';
};

const eventVisibilityRowClass = (value) => {
  const key = String(value || '').trim();
  if (key === 'event_workspace') return 'border-l-2 border-l-ok/60';
  if (key === 'selected_people' || key === 'group') return 'border-l-2 border-l-muted';
  return 'border-l-2 border-l-transparent';
};

function EventVisibilityText({ value, className = '' }) {
  const label = eventVisibilityLabel(value);
  if (!label) return null;
  return (
    <span className={cx('shrink-0 text-xs font-medium', eventVisibilityTextClass(value), className)}>
      {label}
    </span>
  );
}

const previewNames = (items, key, limit = 3) => {
  const names = (Array.isArray(items) ? items : [])
    .map((item) => String(item?.[key] || '').trim())
    .filter(Boolean);
  if (!names.length) return '';
  const visible = names.slice(0, limit).join(', ');
  const remaining = names.length - limit;
  return remaining > 0 ? `${visible}, +${remaining}` : visible;
};

const getIcsFeedHealth = (source) => {
  if (!source?.has_url) {
    return {
      summary: 'not connected',
      title: 'No feed connected',
      tone: 'muted',
      detail: 'Connect a personal Sched iCal link to sync selected sessions.'
    };
  }

  const status = String(source.sync_status || 'idle').toLowerCase();
  const lastSuccessAt = source.last_success_at ? new Date(source.last_success_at) : null;
  const hasLastSuccess = lastSuccessAt && !Number.isNaN(lastSuccessAt.getTime());
  const staleAfterMs = 7 * 24 * 60 * 60 * 1000;
  const isStale = hasLastSuccess && (Date.now() - lastSuccessAt.getTime()) > staleAfterMs;

  if (status === 'failed') {
    return {
      summary: 'needs attention',
      title: 'Last refresh failed',
      tone: 'error',
      detail: hasLastSuccess
        ? 'Your saved schedule is still shown from the last successful sync.'
        : 'The feed is connected, but no successful sync has completed yet.'
    };
  }

  if (status === 'running') {
    return {
      summary: 'syncing',
      title: 'Sync in progress',
      tone: 'muted',
      detail: 'Selected sessions will update when this refresh completes.'
    };
  }

  if (!hasLastSuccess) {
    return {
      summary: 'not synced',
      title: 'Feed connected, not synced yet',
      tone: 'muted',
      detail: 'Run a sync when you are ready to pull selected sessions into this event.'
    };
  }

  if (isStale) {
    return {
      summary: 'stale',
      title: 'Last sync may be stale',
      tone: 'warning',
      detail: 'Your selected schedule is still usable, but it has not refreshed recently.'
    };
  }

  return {
    summary: 'synced',
    title: 'Feed synced',
    tone: 'ok',
    detail: 'Your selected Sched sessions are reflected in this event.'
  };
};

function MetaPill({ children, tone = 'default' }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium tracking-wide',
        tone === 'brand'
          ? 'border-brand/30 bg-brand/10 text-brand'
          : 'border-edge bg-surface text-dim'
      )}
    >
      {children}
    </span>
  );
}

function DetailField({ label, children, className = '' }) {
  if (!children) return null;
  return (
    <div className={className}>
      <p className="label">{label}</p>
      <div className="mt-1 text-sm text-ink">{children}</div>
    </div>
  );
}

function EventCard({ item, supportsHover, onOpen, onEdit, onDelete }) {
  return (
    <ObjectPosterCard
      title={item.title}
      imagePath={item.image_path}
      fallbackIcon={<Icons.Activity />}
      supportsHover={supportsHover}
      onOpen={() => onOpen(item)}
      leftBadges={[`#${item.id}`, toDisplayDate(item.date_start) || 'Date pending']}
      rightBadge={item.host ? <span className="badge badge-brand text-[10px] backdrop-blur-sm bg-brand/20 border-brand/30">{item.host}</span> : null}
      subtitle={item.location || 'Location not set'}
      meta={
        <>
          <MetaPill>{pluralizeArtifacts(item.artifact_count)}</MetaPill>
          {item.room ? <MetaPill>{`Room ${item.room}`}</MetaPill> : null}
        </>
      }
      onEdit={() => onEdit(item)}
      onDelete={() => onDelete(item.id)}
    />
  );
}

function EventListRow({ item, supportsHover, onOpen, onEdit, onDelete }) {
  return (
    <article className="group flex items-center gap-4 rounded-xl border border-edge bg-surface p-3 hover:border-muted hover:bg-raised cursor-pointer transition-all duration-150 animate-fade-in" onClick={() => onOpen(item)}>
      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-edge bg-raised text-ghost"><Icons.Activity /></div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ink truncate">{item.title}</p>
        <div className="mt-1 flex flex-wrap gap-2">
          <MetaPill>{toDisplayDate(item.date_start) || 'Date pending'}</MetaPill>
          {item.location ? <MetaPill>{item.location}</MetaPill> : null}
          <MetaPill>{pluralizeArtifacts(item.artifact_count)}</MetaPill>
        </div>
      </div>
      <span className="text-xs text-ghost font-mono">#{item.id}</span>
      <div className={cx('flex gap-2 transition-opacity duration-150', supportsHover ? 'opacity-0 group-hover:opacity-100' : 'opacity-100')}>
        <button className="btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); onEdit(item); }}><Icons.Edit />Edit</button>
        <button className="btn-ghost btn-sm text-err hover:bg-err/10" onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}><Icons.Trash /></button>
      </div>
    </article>
  );
}

function formatSignatureLine(signature) {
  const parts = [];
  if (signature?.signer_name) parts.push(signature.signer_name);
  if (signature?.signer_role) parts.push(signature.signer_role);
  if (signature?.signed_on) parts.push(toDisplayDate(signature.signed_on));
  if (signature?.signed_at) parts.push(signature.signed_at);
  return parts.filter(Boolean).join(' · ');
}

function EventAutographSignatureLinker({ eventId, artifact, apiCall, onLinked }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [targetType, setTargetType] = useState('art');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [linkingId, setLinkingId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const eventSignature = artifact?.event_artifact_signature || artifact?.signature || null;
  const linkedSignature = artifact?.linked_signature || null;

  const getCandidateId = (candidate) => Number(targetType === 'art' ? (candidate.native_art_id || candidate.id) : candidate.id);

  const formatCandidateMeta = (candidate) => {
    const parts = [targetType === 'art' ? 'Art' : 'Media'];
    if (targetType === 'art') {
      if (candidate.franchise) parts.push(candidate.franchise);
      if (candidate.medium) parts.push(String(candidate.medium).replaceAll('_', ' '));
      if (candidate.artist) parts.push(candidate.artist);
      if (candidate.series) parts.push(candidate.series);
    } else {
      if (candidate.media_type) parts.push(String(candidate.media_type).replaceAll('_', ' '));
      if (candidate.year) parts.push(candidate.year);
      if (candidate.format) parts.push(candidate.format);
    }
    return parts.filter(Boolean).join(' · ');
  };

  const searchTargets = async () => {
    setSearching(true);
    setError('');
    setNotice('');
    try {
      const params = new URLSearchParams();
      params.set('limit', '8');
      if (targetType === 'art') {
        params.set('sort_dir', 'asc');
        if (searchTerm.trim()) params.set('q', searchTerm.trim());
      } else {
        params.set('sortDir', 'asc');
        if (searchTerm.trim()) params.set('search', searchTerm.trim());
      }
      const path = targetType === 'art' ? '/art' : '/media';
      const payload = await apiCall('get', `${path}?${params.toString()}`);
      setSearchResults(Array.isArray(payload?.items) ? payload.items : []);
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to search signature targets');
    } finally {
      setSearching(false);
    }
  };

  const linkTarget = async (candidate) => {
    const ownerId = getCandidateId(candidate);
    if (!ownerId || linkingId) return;
    setLinkingId(ownerId);
    setError('');
    setNotice('');
    try {
      await apiCall('post', `/events/${eventId}/artifacts/${artifact.id}/link-signature`, {
        owner_type: targetType,
        owner_id: ownerId
      });
      setNotice(`${candidate.title || 'Object'} linked as a signature`);
      setLinkOpen(false);
      setSearchResults([]);
      setSearchTerm('');
      await onLinked?.();
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to link object signature');
    } finally {
      setLinkingId(null);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-edge bg-raised p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-ink">Event autograph</p>
          <p className="mt-1 text-xs text-dim">{formatSignatureLine(eventSignature) || artifact.title}</p>
          {eventSignature?.proof_path ? (
            <a className="mt-2 inline-flex items-center gap-1 text-xs text-dim hover:text-ink" href={eventSignature.proof_path} target="_blank" rel="noreferrer">
              <Icons.Link />Proof image
            </a>
          ) : null}
        </div>
        {linkedSignature ? (
          <span className="badge badge-brand text-[10px]">Linked</span>
        ) : (
          <button className="btn-secondary btn-sm" onClick={() => setLinkOpen((open) => !open)}>
            <Icons.Link />Link signature
          </button>
        )}
      </div>
      {linkedSignature ? (
        <div className="mt-3 border-t border-edge/60 pt-3">
          <p className="text-xs font-medium text-ink">Object signature</p>
          <p className="mt-1 text-xs text-dim">
            {`Linked to ${linkedSignature.owner_type === 'art' ? 'Art' : 'Media'} #${linkedSignature.owner_id}`}
            {formatSignatureLine(linkedSignature) ? ` · ${formatSignatureLine(linkedSignature)}` : ''}
          </p>
          {linkedSignature.proof_path ? (
            <a className="mt-2 inline-flex items-center gap-1 text-xs text-dim hover:text-ink" href={linkedSignature.proof_path} target="_blank" rel="noreferrer">
              <Icons.Link />Object proof
            </a>
          ) : null}
        </div>
      ) : null}
      {error ? <p className="mt-3 text-xs text-err">{error}</p> : null}
      {notice ? <p className="mt-3 text-xs text-ok">{notice}</p> : null}
      {linkOpen ? (
        <div className="mt-3 border-t border-edge/60 pt-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[8rem_1fr_auto]">
            <label className="field">
              <span className="label">Target</span>
              <select
                className="select"
                value={targetType}
                onChange={(event) => {
                  setTargetType(event.target.value);
                  setSearchResults([]);
                }}
              >
                <option value="art">Art</option>
                <option value="media">Media</option>
              </select>
            </label>
            <label className="field">
              <span className="label">Search</span>
              <input
                className="input"
                placeholder={targetType === 'art' ? 'Title, artist, series, or fandom' : 'Title, person, genre, or notes'}
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    searchTargets();
                  }
                }}
              />
            </label>
            <div className="flex items-end">
              <button className="btn-secondary w-full md:w-auto" onClick={searchTargets} disabled={searching}>
                {searching ? <><Spinner size={14} />Searching…</> : <><Icons.Search />Search</>}
              </button>
            </div>
          </div>
          {searchResults.length > 0 ? (
            <div className="mt-3 divide-y divide-edge/60 border-t border-edge/60">
              {searchResults.map((candidate) => {
                const candidateId = getCandidateId(candidate);
                const imagePath = candidate.image_path || candidate.poster_path || candidate.cover_path;
                return (
                  <article key={`${targetType}-${candidateId}`} className="flex items-start gap-3 py-3">
                    {imagePath ? (
                      <div className="h-14 w-10 shrink-0 overflow-hidden rounded-md border border-edge bg-surface">
                        <img src={posterUrl(imagePath)} alt="" className="h-full w-full object-cover" />
                      </div>
                    ) : (
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-edge bg-surface text-ghost">
                        {targetType === 'art' ? <Icons.Activity /> : <Icons.Film />}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink truncate">{candidate.title}</p>
                      <p className="mt-1 text-xs text-dim">{formatCandidateMeta(candidate)}</p>
                    </div>
                    <button
                      className="btn-secondary btn-sm"
                      disabled={linkingId === candidateId}
                      onClick={() => linkTarget(candidate)}
                    >
                      {linkingId === candidateId ? <><Spinner size={14} />Linking…</> : 'Link'}
                    </button>
                  </article>
                );
              })}
            </div>
          ) : null}
          {!searching && searchResults.length === 0 ? (
            <p className="mt-3 text-sm text-ghost">Search an owned Art or media record, then attach this autograph as its signature evidence.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function EventArtifactsEditor({ eventId, apiCall, onSaved }) {
  const [artifacts, setArtifacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [artifactEditorOpen, setArtifactEditorOpen] = useState(false);
  const [artifactForm, setArtifactForm] = useState(DEFAULT_ARTIFACT_FORM);
  const [editingArtifactId, setEditingArtifactId] = useState(null);
  const [artifactFile, setArtifactFile] = useState(null);
  const [artifactSaving, setArtifactSaving] = useState(false);
  const [artifactError, setArtifactError] = useState('');
  const [artifactNotice, setArtifactNotice] = useState('');

  const loadArtifacts = useCallback(async () => {
    setLoading(true);
    try {
      const artifactRows = await apiCall('get', `/events/${eventId}/artifacts`);
      setArtifacts(Array.isArray(artifactRows) ? artifactRows : []);
    } finally {
      setLoading(false);
    }
  }, [apiCall, eventId]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await loadArtifacts();
      } catch (_) {
        if (active) {
          setArtifactError('Failed to load event artifacts');
          setLoading(false);
        }
      }
    })();
    return () => { active = false; };
  }, [loadArtifacts]);

  const clearArtifactForm = useCallback(() => {
    setEditingArtifactId(null);
    setArtifactFile(null);
    setArtifactForm(DEFAULT_ARTIFACT_FORM);
    setArtifactError('');
    setArtifactNotice('');
  }, []);

  const saveArtifact = async () => {
    if (!artifactForm.title.trim()) return;
    if (artifactSaving) return;
    setArtifactSaving(true);
    setArtifactError('');
    setArtifactNotice('');
    try {
      const payload = {
        artifact_type: artifactForm.artifact_type,
        title: artifactForm.title.trim(),
        description: artifactForm.description || null,
        vendor: artifactForm.vendor || null,
        price: artifactForm.price === '' ? null : Number(artifactForm.price),
        image_path: artifactForm.image_path || null,
        signer_name: artifactForm.artifact_type === 'autograph' ? (artifactForm.signer_name || null) : null,
        signer_role: artifactForm.artifact_type === 'autograph' ? (artifactForm.signer_role || null) : null,
        signed_on: artifactForm.artifact_type === 'autograph' ? (artifactForm.signed_on || null) : null,
        signed_at: artifactForm.artifact_type === 'autograph' ? (artifactForm.signed_at || null) : null,
        proof_path: artifactForm.artifact_type === 'autograph' ? (artifactForm.signature_proof_path || artifactForm.image_path || null) : null,
        signature_notes: artifactForm.artifact_type === 'autograph' ? (artifactForm.signature_notes || artifactForm.description || null) : null
      };
      let artifactId = editingArtifactId;
      if (editingArtifactId) {
        await apiCall('patch', `/events/${eventId}/artifacts/${editingArtifactId}`, payload);
      } else {
        const created = await apiCall('post', `/events/${eventId}/artifacts`, payload);
        artifactId = created?.id || null;
      }

      let uploadError = '';
      if (artifactFile && artifactId) {
        try {
          const formData = new FormData();
          formData.append('image', artifactFile);
          await apiCall('post', `/events/${eventId}/artifacts/${artifactId}/upload-image`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
          });
        } catch (primaryErr) {
          try {
            const fallbackForm = new FormData();
            fallbackForm.append('cover', artifactFile);
            const uploaded = await apiCall('post', '/media/upload-cover', fallbackForm, {
              headers: { 'Content-Type': 'multipart/form-data' }
            });
            if (uploaded?.path) {
              await apiCall('patch', `/events/${eventId}/artifacts/${artifactId}`, { image_path: uploaded.path });
            } else {
              throw new Error('Fallback upload returned no image path');
            }
          } catch (fallbackErr) {
            const primaryMsg = primaryErr?.response?.data?.error || primaryErr?.message || 'primary upload failed';
            const fallbackMsg = fallbackErr?.response?.data?.error || fallbackErr?.message || 'fallback upload failed';
            uploadError = `${formatUploadError(primaryMsg)}; ${formatUploadError(fallbackMsg)}`;
          }
        }
      }

      clearArtifactForm();
      await loadArtifacts();
      onSaved?.();
      if (uploadError) {
        setArtifactError(`Artifact saved, but image upload failed: ${uploadError}`);
      } else {
        setArtifactNotice('Artifact saved');
      }
    } catch (err) {
      setArtifactError(err?.response?.data?.error || 'Failed to save artifact');
    } finally {
      setArtifactSaving(false);
    }
  };

  const removeArtifact = async (artifactId) => {
    if (!window.confirm('Delete this artifact?')) return;
    await apiCall('delete', `/events/${eventId}/artifacts/${artifactId}`);
    await loadArtifacts();
    onSaved?.();
  };

  const editArtifact = (artifact) => {
    const signature = artifact.event_artifact_signature || artifact.signature || {};
    setEditingArtifactId(artifact.id);
    setArtifactFile(null);
    setArtifactForm({
      artifact_type: artifact.artifact_type || 'note',
      title: artifact.title || '',
      description: artifact.description || '',
      vendor: artifact.vendor || '',
      price: artifact.price ?? '',
      image_path: artifact.image_path || '',
      signer_name: signature.signer_name || '',
      signer_role: signature.signer_role || '',
      signed_on: toInputDate(signature.signed_on),
      signed_at: signature.signed_at || '',
      signature_proof_path: signature.proof_path || '',
      signature_notes: signature.notes || ''
    });
  };

  const removeArtifactImage = async (artifact) => {
    if (!artifact?.id) return;
    await apiCall('delete', `/events/${eventId}/artifacts/${artifact.id}/image`);
    await loadArtifacts();
    onSaved?.();
  };

  const formatArtifactMeta = (artifact) => {
    const parts = [];
    if (artifact?.artifact_type) parts.push(artifact.artifact_type);
    if (artifact?.vendor) parts.push(artifact.vendor);
    if (artifact?.price !== null && artifact?.price !== undefined && artifact?.price !== '') {
      parts.push(`$${artifact.price}`);
    }
    return parts.join(' · ');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <p className="text-sm text-dim">{pluralizeArtifacts(artifacts.length)}</p>
        <div className="flex-1" />
        <button
          className="btn-ghost btn-sm"
          onClick={() => {
            setArtifactEditorOpen((open) => {
              const next = !open;
              if (!next) clearArtifactForm();
              return next;
            });
          }}
        >
          {artifactEditorOpen ? 'Done' : 'Edit schedule'}
        </button>
      </div>
      {loading ? <div className="flex items-center gap-2 text-dim"><Spinner size={16} />Loading schedule…</div> : null}
      {artifactError ? <p className="text-xs text-err">{artifactError}</p> : null}
      {artifactNotice ? <p className="text-xs text-ok">{artifactNotice}</p> : null}
      <div className="border-t border-edge/60">
        {artifacts.map((artifact) => (
          <div key={artifact.id} className="flex items-start gap-3 border-b border-edge/60 py-3 last:border-b-0">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{artifact.title}</p>
              {formatArtifactMeta(artifact) ? (
                <p className="mt-1 text-xs text-dim">{formatArtifactMeta(artifact)}</p>
              ) : null}
              {artifact.description ? <p className="mt-2 text-sm text-ghost">{artifact.description}</p> : null}
              {artifact.artifact_type === 'autograph' ? (
                <EventAutographSignatureLinker
                  eventId={eventId}
                  artifact={artifact}
                  apiCall={apiCall}
                  onLinked={async () => {
                    await loadArtifacts();
                    onSaved?.();
                  }}
                />
              ) : null}
            </div>
            {artifact.image_path && !(editingArtifactId === artifact.id && artifactFile) ? (
              <a
                className="btn-ghost btn-sm"
                href={artifact.image_path}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                aria-label={`Open image for ${artifact.title}`}
              >
                <Icons.Link />Open image
              </a>
            ) : null}
            {artifactEditorOpen && artifact.image_path && !(editingArtifactId === artifact.id && artifactFile) ? (
              <button className="btn-ghost btn-sm" onClick={() => removeArtifactImage(artifact)} aria-label={`Remove image from ${artifact.title}`}>
                <Icons.X />Remove image
              </button>
            ) : null}
            {artifactEditorOpen ? (
              <button className="btn-ghost btn-sm" onClick={() => editArtifact(artifact)} aria-label={`Edit ${artifact.title}`}>
                <Icons.Edit />Edit
              </button>
            ) : null}
            {artifactEditorOpen ? (
              <button className="btn-ghost btn-sm text-err hover:bg-err/10" onClick={() => removeArtifact(artifact.id)} aria-label={`Delete ${artifact.title}`}>
                <Icons.Trash />Delete
              </button>
            ) : null}
          </div>
        ))}
        {!loading && artifacts.length === 0 ? (
          <div className="py-4 text-sm text-dim">
            No schedule items yet.
          </div>
        ) : null}
      </div>
      {artifactEditorOpen ? (
        <div className="space-y-3 border-t border-edge/60 pt-4">
          <p className="text-sm font-medium text-ink">{editingArtifactId ? `Edit entry #${editingArtifactId}` : 'Add schedule item'}</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="field">
              <span className="label">Type</span>
              <select className="select" value={artifactForm.artifact_type} onChange={(e) => setArtifactForm((prev) => ({ ...prev, artifact_type: e.target.value }))}>
                <option value="note">Note</option>
                <option value="session">Session</option>
                <option value="person">Person</option>
                <option value="autograph">Autograph</option>
                <option value="purchase">Purchase</option>
                <option value="freebie">Freebie</option>
              </select>
            </label>
            <label className="field">
              <span className="label">Title</span>
              <input className="input" value={artifactForm.title} onChange={(e) => setArtifactForm((prev) => ({ ...prev, title: e.target.value }))} />
            </label>
            {artifactForm.artifact_type === 'autograph' ? (
              <>
                <label className="field">
                  <span className="label">Signer</span>
                  <input className="input" value={artifactForm.signer_name} onChange={(e) => setArtifactForm((prev) => ({ ...prev, signer_name: e.target.value }))} />
                </label>
                <label className="field">
                  <span className="label">Role</span>
                  <input className="input" placeholder="Artist, actor, writer…" value={artifactForm.signer_role} onChange={(e) => setArtifactForm((prev) => ({ ...prev, signer_role: e.target.value }))} />
                </label>
                <label className="field">
                  <span className="label">Signed date</span>
                  <input type="date" className="input" value={artifactForm.signed_on} onChange={(e) => setArtifactForm((prev) => ({ ...prev, signed_on: e.target.value }))} />
                </label>
                <label className="field">
                  <span className="label">Signed at</span>
                  <input className="input" placeholder="Booth, table, room, or event spot" value={artifactForm.signed_at} onChange={(e) => setArtifactForm((prev) => ({ ...prev, signed_at: e.target.value }))} />
                </label>
              </>
            ) : null}
            <label className="field">
              <span className="label">Vendor</span>
              <input className="input" value={artifactForm.vendor} onChange={(e) => setArtifactForm((prev) => ({ ...prev, vendor: e.target.value }))} />
            </label>
            <label className="field">
              <span className="label">Price</span>
              <input className="input" inputMode="decimal" value={artifactForm.price} onChange={(e) => setArtifactForm((prev) => ({ ...prev, price: e.target.value }))} />
            </label>
            <label className="field md:col-span-2">
              <span className="label">Image URL</span>
              <input className="input" placeholder="Optional" value={artifactForm.image_path} onChange={(e) => setArtifactForm((prev) => ({ ...prev, image_path: e.target.value }))} />
            </label>
            {artifactForm.artifact_type === 'autograph' ? (
              <label className="field md:col-span-2">
                <span className="label">Proof image URL</span>
                <input className="input" placeholder="Optional proof image for this signature" value={artifactForm.signature_proof_path} onChange={(e) => setArtifactForm((prev) => ({ ...prev, signature_proof_path: e.target.value }))} />
              </label>
            ) : null}
            <ImageSourceControl
              className="md:col-span-2"
              label="Artifact image"
              selectedFile={artifactFile}
              selectedLabel="Selected image"
              chooseLabel="Choose from Library"
              cameraLabel="Take Photo"
              onChooseFile={setArtifactFile}
              onCameraFile={setArtifactFile}
            />
            <label className="field md:col-span-2">
              <span className="label">Notes</span>
              <textarea className="textarea min-h-[88px]" value={artifactForm.description} onChange={(e) => setArtifactForm((prev) => ({ ...prev, description: e.target.value }))} />
            </label>
            {artifactForm.artifact_type === 'autograph' ? (
              <label className="field md:col-span-2">
                <span className="label">Signature notes</span>
                <textarea className="textarea min-h-[72px]" value={artifactForm.signature_notes} onChange={(e) => setArtifactForm((prev) => ({ ...prev, signature_notes: e.target.value }))} />
              </label>
            ) : null}
            <div className="md:col-span-2 flex gap-2">
              <button className="btn-secondary flex-1" onClick={saveArtifact} disabled={artifactSaving}>
                {artifactSaving
                  ? <><Spinner size={14} />Saving…</>
                  : (editingArtifactId ? <><Icons.Check />Save Entry</> : <><Icons.Plus />Add Entry</>)}
              </button>
              {editingArtifactId ? <button className="btn-ghost" onClick={clearArtifactForm}>Cancel</button> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function EventPurchasedItemsReadback({ eventId, apiCall }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const [searchType, setSearchType] = useState('art');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [linkingId, setLinkingId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({
    title_snapshot: '',
    vendor_snapshot: '',
    booth_snapshot: '',
    price_snapshot: ''
  });

  const loadPurchasedItems = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const payload = await apiCall('get', `/events/${eventId}/purchased-items`);
      setItems(Array.isArray(payload?.items) ? payload.items : []);
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load purchased items');
    } finally {
      setLoading(false);
    }
  }, [apiCall, eventId]);

  useEffect(() => { loadPurchasedItems(); }, [loadPurchasedItems]);

  const linkedKeys = useMemo(() => new Set(items.map((item) => `${item.item_type}:${item.item_id}`)), [items]);

  const getCandidateId = (candidate, type = searchType) => Number(type === 'art' ? (candidate.native_art_id || candidate.id) : candidate.id);
  const getCandidateKey = (candidate, type = searchType) => `${type}:${getCandidateId(candidate, type)}`;

  const formatMoney = (value) => {
    if (value === null || value === undefined || value === '') return '';
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return `$${value}`;
    return `$${numeric.toFixed(Number.isInteger(numeric) ? 0 : 2)}`;
  };

  const formatPurchaseMeta = (item) => {
    const resolved = item?.resolved_item || {};
    const parts = [item.item_type === 'art' ? 'Art' : 'Collectible'];
    const maker = resolved.artist || resolved.series;
    if (maker) parts.push(maker);
    const vendor = item.vendor_snapshot || resolved.vendor;
    const booth = item.booth_snapshot || resolved.booth;
    if (vendor && booth) parts.push(`${vendor} / ${booth}`);
    else if (vendor || booth) parts.push(vendor || booth);
    const price = item.price_snapshot ?? resolved.price;
    if (price !== null && price !== undefined && price !== '') parts.push(formatMoney(price));
    return parts.filter(Boolean).join(' · ');
  };

  const formatCandidateMeta = (candidate, type = searchType) => {
    const parts = [];
    if (type === 'art') {
      parts.push('Art');
      if (candidate.franchise) parts.push(candidate.franchise);
      if (candidate.medium) parts.push(String(candidate.medium).replaceAll('_', ' '));
      if (candidate.artist) parts.push(candidate.artist);
      if (candidate.series) parts.push(candidate.series);
    } else {
      parts.push('Collectible');
      if (candidate.franchise) parts.push(candidate.franchise);
      if (candidate.category || candidate.category_key) parts.push(candidate.category || candidate.category_key);
      if (candidate.series) parts.push(candidate.series);
    }
    if (candidate.vendor && candidate.booth) parts.push(`${candidate.vendor} / ${candidate.booth}`);
    else if (candidate.vendor || candidate.booth) parts.push(candidate.vendor || candidate.booth);
    if (candidate.price !== null && candidate.price !== undefined && candidate.price !== '') parts.push(formatMoney(candidate.price));
    return parts.filter(Boolean).join(' · ');
  };

  const searchPurchaseSources = async () => {
    setSearching(true);
    setError('');
    setNotice('');
    try {
      const params = new URLSearchParams();
      params.set('limit', '8');
      params.set('sort_dir', 'asc');
      if (searchTerm.trim()) params.set('q', searchTerm.trim());
      const payload = await apiCall('get', `${searchType === 'art' ? '/art' : '/collectibles'}?${params.toString()}`);
      const rows = Array.isArray(payload?.items) ? payload.items : [];
      setSearchResults(rows);
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to search purchase sources');
    } finally {
      setSearching(false);
    }
  };

  const linkCandidate = async (candidate) => {
    const itemId = getCandidateId(candidate);
    if (!itemId) return;
    setLinkingId(itemId);
    setError('');
    setNotice('');
    try {
      await apiCall('post', `/events/${eventId}/purchased-items`, {
        item_type: searchType,
        item_id: itemId
      });
      await loadPurchasedItems();
      setLinkOpen(false);
      setSearchResults([]);
      setSearchTerm('');
      setNotice(`${candidate.title || 'Item'} linked to this event`);
    } catch (err) {
      if (err?.response?.status === 409) {
        setNotice('That item is already linked to this event.');
      } else {
        setError(err?.response?.data?.error || 'Failed to link purchased item');
      }
    } finally {
      setLinkingId(null);
    }
  };

  const beginEdit = (item) => {
    const resolved = item.resolved_item || {};
    setEditingId(item.id);
    setEditForm({
      title_snapshot: item.title_snapshot || resolved.title || '',
      vendor_snapshot: item.vendor_snapshot || resolved.vendor || '',
      booth_snapshot: item.booth_snapshot || resolved.booth || '',
      price_snapshot: item.price_snapshot ?? resolved.price ?? ''
    });
    setError('');
    setNotice('');
  };

  const savePurchaseSnapshot = async (item) => {
    setError('');
    setNotice('');
    try {
      await apiCall('patch', `/events/${eventId}/purchased-items/${item.id}`, {
        title_snapshot: editForm.title_snapshot || null,
        vendor_snapshot: editForm.vendor_snapshot || null,
        booth_snapshot: editForm.booth_snapshot || null,
        price_snapshot: editForm.price_snapshot === '' ? null : Number(editForm.price_snapshot)
      });
      setEditingId(null);
      await loadPurchasedItems();
      setNotice('Purchase details saved');
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to save purchase details');
    }
  };

  const unlinkPurchasedItem = async (item) => {
    if (!window.confirm('Remove this purchase link from the event?')) return;
    setError('');
    setNotice('');
    try {
      await apiCall('delete', `/events/${eventId}/purchased-items/${item.id}`);
      await loadPurchasedItems();
      setNotice('Purchase link removed');
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to remove purchase link');
    }
  };

  return (
    <section className="rounded-xl border border-edge bg-surface p-4">
      <div className="flex items-start gap-3">
        <div>
          <p className="label">Tracked purchases</p>
          <p className="text-sm text-dim">{items.length} linked item{items.length === 1 ? '' : 's'}</p>
        </div>
        <div className="flex-1" />
        <button
          className="btn-secondary btn-sm"
          onClick={() => {
            setLinkOpen((open) => !open);
            setError('');
            setNotice('');
          }}
        >
          <Icons.Plus />Link item
        </button>
        <button className="btn-ghost btn-sm" onClick={loadPurchasedItems} disabled={loading}>
          {loading ? <><Spinner size={14} />Loading…</> : 'Refresh'}
        </button>
      </div>
      {error ? <p className="mt-3 text-xs text-err">{error}</p> : null}
      {notice ? <p className="mt-3 text-xs text-ok">{notice}</p> : null}
      {linkOpen ? (
        <div className="mt-4 rounded-lg border border-edge bg-raised p-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[10rem_1fr_auto]">
            <label className="field">
              <span className="label">Library</span>
              <select
                className="select"
                value={searchType}
                onChange={(event) => {
                  setSearchType(event.target.value);
                  setSearchResults([]);
                }}
              >
                <option value="art">Art</option>
                <option value="collectible">Collectibles</option>
              </select>
            </label>
            <label className="field">
              <span className="label">Search</span>
              <input
                className="input"
                placeholder={searchType === 'art' ? 'Title, fandom, artist, or series' : 'Title, fandom, category, or vendor'}
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    searchPurchaseSources();
                  }
                }}
              />
            </label>
            <div className="flex items-end">
              <button className="btn-secondary w-full md:w-auto" onClick={searchPurchaseSources} disabled={searching}>
                {searching ? <><Spinner size={14} />Searching…</> : <><Icons.Search />Search</>}
              </button>
            </div>
          </div>
          {searchResults.length > 0 ? (
            <div className="mt-3 divide-y divide-edge/60 border-t border-edge/60">
              {searchResults.map((candidate) => {
                const candidateId = getCandidateId(candidate);
                const alreadyLinked = linkedKeys.has(getCandidateKey(candidate));
                return (
                  <article key={`${searchType}-${candidateId}`} className="flex items-start gap-3 py-3">
                    {candidate.image_path ? (
                      <div className="h-14 w-10 shrink-0 overflow-hidden rounded-md border border-edge bg-surface">
                        <img src={posterUrl(candidate.image_path)} alt="" className="h-full w-full object-cover" />
                      </div>
                    ) : (
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-edge bg-surface text-ghost">
                        {searchType === 'art' ? <Icons.Activity /> : <Icons.Library />}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink truncate">{candidate.title}</p>
                      <p className="mt-1 text-xs text-dim">{formatCandidateMeta(candidate)}</p>
                    </div>
                    <button
                      className={alreadyLinked ? 'btn-ghost btn-sm' : 'btn-secondary btn-sm'}
                      disabled={alreadyLinked || linkingId === candidateId}
                      onClick={() => linkCandidate(candidate)}
                    >
                      {alreadyLinked ? 'Linked' : (linkingId === candidateId ? <><Spinner size={14} />Linking…</> : 'Link')}
                    </button>
                  </article>
                );
              })}
            </div>
          ) : null}
          {!searching && searchResults.length === 0 ? (
            <p className="mt-3 text-sm text-ghost">Search existing Art or Collectibles, then link the tracked item here.</p>
          ) : null}
        </div>
      ) : null}
      {!loading && items.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-edge bg-raised px-3 py-3 text-sm text-ghost">
          No tracked Art or Collectibles purchases are linked through the shared purchase relationship yet.
        </p>
      ) : null}
      {items.length > 0 ? (
        <div className="mt-3 divide-y divide-edge/60">
          {items.map((item) => {
            const resolved = item.resolved_item || {};
            const title = item.title_snapshot || resolved.title || `${item.item_type} #${item.item_id}`;
            const isEditing = editingId === item.id;
            return (
              <article key={item.id} className="py-3">
                <div className="flex items-start gap-3">
                {resolved.image_path ? (
                  <div className="h-14 w-10 shrink-0 overflow-hidden rounded-md border border-edge bg-raised">
                    <img src={posterUrl(resolved.image_path)} alt="" className="h-full w-full object-cover" />
                  </div>
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-edge bg-raised text-ghost">
                    <Icons.Activity />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink truncate">{title}</p>
                  {formatPurchaseMeta(item) ? <p className="mt-1 text-xs text-dim">{formatPurchaseMeta(item)}</p> : null}
                </div>
                <span className="badge badge-dim text-[10px]">{item.item_type}</span>
                <button className="btn-ghost btn-sm" onClick={() => beginEdit(item)} aria-label={`Edit purchase details for ${title}`}>
                  <Icons.Edit />
                </button>
                <button className="btn-ghost btn-sm text-err hover:bg-err/10" onClick={() => unlinkPurchasedItem(item)} aria-label={`Remove purchase link for ${title}`}>
                  <Icons.Trash />
                </button>
                </div>
                {isEditing ? (
                  <div className="mt-3 grid grid-cols-1 gap-3 rounded-lg border border-edge bg-raised p-3 md:grid-cols-2">
                    <label className="field md:col-span-2">
                      <span className="label">Display title</span>
                      <input className="input" value={editForm.title_snapshot} onChange={(event) => setEditForm((prev) => ({ ...prev, title_snapshot: event.target.value }))} />
                    </label>
                    <label className="field">
                      <span className="label">Vendor</span>
                      <input className="input" value={editForm.vendor_snapshot} onChange={(event) => setEditForm((prev) => ({ ...prev, vendor_snapshot: event.target.value }))} />
                    </label>
                    <label className="field">
                      <span className="label">Booth</span>
                      <input className="input" value={editForm.booth_snapshot} onChange={(event) => setEditForm((prev) => ({ ...prev, booth_snapshot: event.target.value }))} />
                    </label>
                    <label className="field">
                      <span className="label">Price</span>
                      <input className="input" inputMode="decimal" value={editForm.price_snapshot} onChange={(event) => setEditForm((prev) => ({ ...prev, price_snapshot: event.target.value }))} />
                    </label>
                    <div className="flex items-end gap-2">
                      <button className="btn-secondary flex-1" onClick={() => savePurchaseSnapshot(item)}><Icons.Check />Save</button>
                      <button className="btn-ghost" onClick={() => setEditingId(null)}>Cancel</button>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function EventFormDrawer({ initial, apiCall, onClose, onSave, onDelete, onClearImage }) {
  const [form, setForm] = useState(() => ({
    ...DEFAULT_EVENT_FORM,
    ...(initial || {}),
    date_start: toInputDate(initial?.date_start),
    date_end: toInputDate(initial?.date_end)
  }));
  const [imageFile, setImageFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const eventTabs = useMemo(() => ([
    { id: 'core', label: 'Core Details' },
    { id: 'subevents', label: 'Schedule' },
    { id: 'storage', label: 'Storage & Notes' }
  ]), []);
  const [activeTab, setActiveTab] = useState('core');

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    setForm({
      ...DEFAULT_EVENT_FORM,
      ...(initial || {}),
      date_start: toInputDate(initial?.date_start),
      date_end: toInputDate(initial?.date_end)
    });
    setImageFile(null);
    setActiveTab('core');
  }, [initial]);

  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      await onSave({
        ...form,
        date_end: form.date_end || null,
        host: form.host || null,
        time_label: form.time_label || null,
        room: form.room || null,
        image_path: form.image_path || null,
        notes: form.notes || null
      }, imageFile);
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to save event');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-void/72" onClick={onClose} />
      <div className="ml-auto h-full w-full max-w-[40rem] bg-abyss border-l border-edge shadow-card relative flex flex-col">
        <div className="px-6 py-4 border-b border-edge flex items-center gap-3">
          <h2 className="section-title !text-xl">{initial?.id ? 'Edit Event' : 'Add Event'}</h2>
          <div className="flex-1" />
          <button className="btn-icon" onClick={onClose}><Icons.X /></button>
        </div>
        <div className="p-6 overflow-y-auto space-y-4">
          {error && <p className="text-sm text-err">{error}</p>}
          <SectionTabs
            tabs={eventTabs}
            activeId={activeTab}
            onChange={setActiveTab}
            showIndex
            stretch
            ariaLabel="Event editor steps"
            idBase="event-editor-steps"
          />
          <div className="space-y-4 border-t border-edge/60 pt-3">

            <SectionTabPanel activeId={activeTab} tabKey="core" idBase="event-editor-steps">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <CoverImagePicker
                  className="md:col-span-2 max-w-[8.5rem]"
                  label="Event image"
                  imagePath={form.image_path || ''}
                  selectedFile={imageFile}
                  emptyLabel="Add image"
                  replaceLabel="Replace image"
                  onSelectFile={setImageFile}
                  onRemove={initial?.id ? onClearImage : undefined}
                />
                <label className="field md:col-span-2"><span className="label">Title *</span><input className="input" value={form.title || ''} onChange={(e) => set({ title: e.target.value })} /></label>
                <label className="field md:col-span-2"><span className="label">URL *</span><input className="input" value={form.url || ''} onChange={(e) => set({ url: e.target.value })} /></label>
                <label className="field"><span className="label">Location *</span><input className="input" value={form.location || ''} onChange={(e) => set({ location: e.target.value })} /></label>
                <label className="field"><span className="label">Host</span><input className="input" value={form.host || ''} onChange={(e) => set({ host: e.target.value })} /></label>
                <label className="field"><span className="label">Start Date *</span><input type="date" className="input" value={form.date_start || ''} onChange={(e) => set({ date_start: e.target.value })} /></label>
                <label className="field"><span className="label">End Date</span><input type="date" className="input" value={form.date_end || ''} onChange={(e) => set({ date_end: e.target.value })} /></label>
                <label className="field"><span className="label">Time</span><input className="input" value={form.time_label || ''} onChange={(e) => set({ time_label: e.target.value })} /></label>
                <label className="field"><span className="label">Room</span><input className="input" value={form.room || ''} onChange={(e) => set({ room: e.target.value })} /></label>
              </div>
            </SectionTabPanel>

            <SectionTabPanel activeId={activeTab} tabKey="subevents" idBase="event-editor-steps">
              {activeTab === 'subevents' ? (
              initial?.id ? (
                <EventArtifactsEditor eventId={initial.id} apiCall={apiCall} onSaved={() => {}} />
              ) : (
                <div className="rounded-md border border-dashed border-edge px-4 py-6 text-sm text-ghost">
                  Save the event first, then come back here to add panels, parties, signings, purchases, and other sub-event history.
                </div>
              )
              ) : null}
            </SectionTabPanel>

            <SectionTabPanel activeId={activeTab} tabKey="storage" idBase="event-editor-steps">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="field md:col-span-2"><span className="label">Image URL (optional)</span><input className="input" value={form.image_path || ''} onChange={(e) => set({ image_path: e.target.value })} /></label>
                <label className="field md:col-span-2"><span className="label">Notes</span><textarea className="textarea min-h-[96px]" value={form.notes || ''} onChange={(e) => set({ notes: e.target.value })} /></label>
              </div>
            </SectionTabPanel>
          </div>
        </div>
        <div className="shrink-0 border-t border-edge bg-abyss px-6 py-4 flex items-center gap-3">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          {initial?.id && <button type="button" onClick={onDelete} className="btn-danger"><Icons.Trash />Delete</button>}
          <div className="flex-1" />
          <button type="button" onClick={submit} disabled={saving} className="btn-primary min-w-[100px]">{saving ? <Spinner size={16} /> : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

function EventSocialMobileOverview({ attendees, groups, meetups, plans }) {
  const focusPlan = findCurrentOrNextPlan(plans);
  const nextMeetup = nextTimedItem(meetups);
  const peoplePreview = previewNames(attendees, 'display_name');
  const groupPreview = previewNames(groups, 'name', 2);

  return (
    <div className="border-b border-edge bg-raised/40 px-4 py-3 lg:hidden" aria-label="Mobile event social overview">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md border border-edge bg-surface px-2 py-2">
          <p className="text-base font-semibold text-ink">{attendees.length}</p>
          <p className="text-xs text-ghost">People</p>
        </div>
        <div className="rounded-md border border-edge bg-surface px-2 py-2">
          <p className="text-base font-semibold text-ink">{groups.length}</p>
          <p className="text-xs text-ghost">Groups</p>
        </div>
        <div className="rounded-md border border-edge bg-surface px-2 py-2">
          <p className="text-base font-semibold text-ink">{meetups.length}</p>
          <p className="text-xs text-ghost">Meetups</p>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <div className="rounded-md border border-edge bg-surface px-3 py-2">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-medium text-dim">Schedule</p>
            {focusPlan?.label ? <span className="text-xs text-ghost">{focusPlan.label}</span> : null}
          </div>
          {focusPlan?.plan ? (
	            <>
	              <p className="mt-1 truncate text-sm font-medium text-ink">{focusPlan.plan.title}</p>
	              <p className="mt-1 truncate text-xs text-dim">
                {[formatDateTime(focusPlan.plan.start_at), socialPlaceSummary(focusPlan.plan), eventVisibilityLabel(focusPlan.plan.visibility)].filter(Boolean).join(' · ')}
	              </p>
	            </>
          ) : (
            <p className="mt-1 text-sm text-ghost">No current or upcoming schedule plan.</p>
          )}
        </div>

        <div className="rounded-md border border-edge bg-surface px-3 py-2">
          <p className="text-xs font-medium text-dim">Next meetup</p>
          {nextMeetup ? (
	            <>
	              <p className="mt-1 truncate text-sm font-medium text-ink">{nextMeetup.title}</p>
	              <p className="mt-1 truncate text-xs text-dim">
                {[formatDateTime(nextMeetup.start_at), socialPlaceSummary(nextMeetup), nextMeetup.group_name, eventVisibilityLabel(nextMeetup.visibility)].filter(Boolean).join(' · ')}
	              </p>
	            </>
          ) : (
            <p className="mt-1 text-sm text-ghost">No upcoming meetup.</p>
          )}
        </div>

        <div className="rounded-md border border-edge bg-surface px-3 py-2">
          <p className="text-xs font-medium text-dim">With</p>
          <p className="mt-1 truncate text-sm text-ink">{peoplePreview || 'No people added yet.'}</p>
          <p className="mt-1 truncate text-xs text-dim">{groupPreview ? `Groups: ${groupPreview}` : 'No groups added yet.'}</p>
        </div>
      </div>
    </div>
  );
}

function scheduleNotificationKey(notification = {}) {
  if (notification.schedule_plan_id) return `plan-${notification.schedule_plan_id}`;
  if (notification.catalog_session_id) return `catalog-${notification.catalog_session_id}`;
  return '';
}

function groupScheduleNotifications(items = []) {
  return (Array.isArray(items) ? items : []).reduce((acc, notification) => {
    const key = scheduleNotificationKey(notification);
    if (!key) return acc;
    acc[key] = [...(acc[key] || []), notification].sort((a, b) => (
      new Date(b.created_at || b.sent_at || 0).getTime() - new Date(a.created_at || a.sent_at || 0).getTime()
    ));
    return acc;
  }, {});
}

function EventSocialPlanningPanel({ eventId, apiCall, onChanged }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState(EMPTY_SOCIAL_FORM);
  const [attendees, setAttendees] = useState([]);
  const [groups, setGroups] = useState([]);
  const [meetups, setMeetups] = useState([]);
  const [plans, setPlans] = useState([]);
  const [catalogSessions, setCatalogSessions] = useState([]);
  const [icsSource, setIcsSource] = useState(null);
  const [meetupDrafts, setMeetupDrafts] = useState({});
  const [planDrafts, setPlanDrafts] = useState({});
  const [catalogDrafts, setCatalogDrafts] = useState({});
  const [pendingCatalogResolution, setPendingCatalogResolution] = useState(null);
  const [changePreviews, setChangePreviews] = useState({});
  const [scheduleNotifications, setScheduleNotifications] = useState({});
  const [scheduleNotificationHistory, setScheduleNotificationHistory] = useState({});
  const [scheduleNotificationInbox, setScheduleNotificationInbox] = useState({ counts: { total: 0, unread: 0, read: 0, acknowledged: 0 }, items: [] });
  const icsHealth = getIcsFeedHealth(icsSource);

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));
  const setMeetupDraft = (meetupId, patch) => {
    setMeetupDrafts((prev) => {
      const existing = prev[meetupId] || {};
      return {
        ...prev,
        [meetupId]: { ...existing, ...patch }
      };
    });
  };
  const setPlanDraft = (planId, patch) => {
    setPlanDrafts((prev) => {
      const existing = prev[planId] || {};
      return {
        ...prev,
        [planId]: { ...existing, ...patch }
      };
    });
  };
  const setCatalogDraft = (sessionId, patch) => {
    setCatalogDrafts((prev) => {
      const existing = prev[sessionId] || {};
      return {
        ...prev,
        [sessionId]: { ...existing, ...patch }
      };
    });
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [attendeePayload, groupPayload, meetupPayload, planPayload, catalogPayload, notificationPayload, inboxPayload, icsPayload] = await Promise.all([
        apiCall('get', `/events/${eventId}/attendees`),
        apiCall('get', `/events/${eventId}/groups`),
        apiCall('get', `/events/${eventId}/meetups`),
        apiCall('get', `/events/${eventId}/schedule-plans`),
        apiCall('get', `/events/${eventId}/schedule-sessions`),
        apiCall('get', `/events/${eventId}/schedule-notifications`),
        apiCall('get', `/events/${eventId}/schedule-notification-inbox`),
        apiCall('get', `/events/${eventId}/personal-ics-source`)
      ]);
      setAttendees(Array.isArray(attendeePayload?.items) ? attendeePayload.items : []);
      setGroups(Array.isArray(groupPayload?.items) ? groupPayload.items : []);
      const nextMeetups = Array.isArray(meetupPayload?.items) ? meetupPayload.items : [];
      setMeetups(nextMeetups);
      setMeetupDrafts((prev) => {
        const next = {};
        nextMeetups.forEach((meetup) => {
          const id = String(meetup?.id || '');
          if (!id) return;
          next[id] = {
            status: prev[id]?.status || meetup.status || 'planned',
            vendor: prev[id]?.vendor ?? meetup.vendor ?? '',
            booth: prev[id]?.booth ?? meetup.booth ?? '',
            location_notes: prev[id]?.location_notes ?? meetup.location_notes ?? '',
            notes: prev[id]?.notes ?? meetup.notes ?? ''
          };
        });
        return next;
      });
      const nextPlans = Array.isArray(planPayload?.items) ? planPayload.items : [];
      setPlans(nextPlans);
      setPlanDrafts((prev) => {
        const next = {};
        nextPlans.forEach((plan) => {
          const id = String(plan?.id || '');
          if (!id) return;
          next[id] = {
            status: prev[id]?.status || plan.status || 'planned',
            visibility: prev[id]?.visibility || plan.visibility || 'private',
            vendor: prev[id]?.vendor ?? plan.vendor ?? '',
            booth: prev[id]?.booth ?? plan.booth ?? '',
            location_notes: prev[id]?.location_notes ?? plan.location_notes ?? '',
            notes: prev[id]?.notes ?? plan.notes ?? ''
          };
        });
        return next;
      });
      const nextCatalogSessions = Array.isArray(catalogPayload?.items) ? catalogPayload.items : [];
      setCatalogSessions(nextCatalogSessions);
      const notificationItems = Array.isArray(notificationPayload?.items) ? notificationPayload.items : [];
      const groupedNotifications = groupScheduleNotifications(notificationItems);
      setScheduleNotificationHistory(groupedNotifications);
      const latestNotifications = {};
      Object.entries(groupedNotifications).forEach(([key, items]) => {
        latestNotifications[key] = items[0] || null;
      });
      setScheduleNotifications(latestNotifications);
      setScheduleNotificationInbox({
        counts: inboxPayload?.counts || { total: 0, unread: 0, read: 0, acknowledged: 0 },
        items: Array.isArray(inboxPayload?.items) ? inboxPayload.items : []
      });
      setCatalogDrafts((prev) => {
        const next = {};
        nextCatalogSessions.forEach((session) => {
          const id = String(session?.id || '');
          if (!id) return;
          next[id] = {
            title: prev[id]?.title ?? session.title ?? '',
            start_at: prev[id]?.start_at ?? toDateTimeInput(session.start_at),
            end_at: prev[id]?.end_at ?? toDateTimeInput(session.end_at),
            location: prev[id]?.location ?? session.location ?? '',
            room: prev[id]?.room ?? session.room ?? '',
            track: prev[id]?.track ?? session.track ?? '',
            categories: prev[id]?.categories ?? formatCategoryInput(session.categories),
            source_url: prev[id]?.source_url ?? session.source_url ?? '',
            description: prev[id]?.description ?? session.description ?? '',
            status: prev[id]?.status || session.status || 'active'
          };
        });
        return next;
      });
      setIcsSource(icsPayload?.source || null);
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load social planning');
    } finally {
      setLoading(false);
    }
  }, [apiCall, eventId]);

  useEffect(() => { load(); }, [load]);

  const save = async (kind) => {
    setSaving(kind);
    setError('');
    setNotice('');
    try {
      if (kind === 'attendee') {
        await apiCall('post', `/events/${eventId}/attendees`, {
          display_name: form.attendeeName.trim(),
          relationship: form.attendeeRelationship || null,
          link_current_user: Boolean(form.attendeeLinkCurrentUser),
          status: 'attending',
          visibility: 'private'
        });
        set({ attendeeName: '', attendeeRelationship: '', attendeeLinkCurrentUser: false });
        setNotice('Attendee added');
      }
      if (kind === 'group') {
        await apiCall('post', `/events/${eventId}/groups`, {
          name: form.groupName.trim(),
          visibility: 'private'
        });
        set({ groupName: '' });
        setNotice('Group added');
      }
      if (kind === 'meetup') {
        await apiCall('post', `/events/${eventId}/meetups`, {
          title: form.meetupTitle.trim(),
          location: form.meetupLocation || null,
          vendor: form.meetupVendor || null,
          booth: form.meetupBooth || null,
          location_notes: form.meetupLocationNotes || null,
          start_at: fromDateTimeInput(form.meetupStart),
          group_id: form.meetupGroupId ? Number(form.meetupGroupId) : null,
          status: 'planned',
          visibility: form.meetupGroupId ? 'group' : 'private'
        });
        set({ meetupTitle: '', meetupLocation: '', meetupVendor: '', meetupBooth: '', meetupLocationNotes: '', meetupStart: '', meetupGroupId: '' });
        setNotice('Meetup added');
      }
      if (kind === 'plan') {
        await apiCall('post', `/events/${eventId}/schedule-plans`, {
          title: form.planTitle.trim(),
          location: form.planLocation || null,
          vendor: form.planVendor || null,
          booth: form.planBooth || null,
          location_notes: form.planLocationNotes || null,
          start_at: fromDateTimeInput(form.planStart),
          source_type: 'manual',
          status: 'planned',
          visibility: 'private'
        });
        set({ planTitle: '', planLocation: '', planVendor: '', planBooth: '', planLocationNotes: '', planStart: '' });
        setNotice('Schedule plan added');
      }
      if (kind === 'catalog') {
        await apiCall('post', `/events/${eventId}/schedule-sessions`, {
          title: form.catalogTitle.trim(),
          location: form.catalogLocation || null,
          room: form.catalogRoom || null,
          track: form.catalogTrack || null,
          categories: parseCategoryList(form.catalogCategories),
          start_at: fromDateTimeInput(form.catalogStart),
          end_at: fromDateTimeInput(form.catalogEnd),
          source_type: 'manual',
          source_url: form.catalogSourceUrl || null,
          description: form.catalogDescription || null,
          status: 'active'
        });
        set({
          catalogTitle: '',
          catalogLocation: '',
          catalogRoom: '',
          catalogTrack: '',
          catalogCategories: '',
          catalogStart: '',
          catalogEnd: '',
          catalogSourceUrl: '',
          catalogDescription: ''
        });
        setNotice('Catalog session added');
      }
      if (kind === 'catalog-import') {
        const payload = await apiCall('post', `/events/${eventId}/schedule-sessions/import-ics`, {
          feed_url: form.catalogImportUrl.trim()
        });
        const summary = payload?.summary || {};
        set({ catalogImportUrl: '' });
        setNotice(`Catalog imported: ${summary.total || 0} session${Number(summary.total || 0) === 1 ? '' : 's'}`);
      }
      if (kind === 'ics') {
        await apiCall('put', `/events/${eventId}/personal-ics-source`, {
          feed_url: form.icsUrl.trim()
        });
        set({ icsUrl: '' });
        setNotice('Personal Sched ICS source saved');
      }
      await load();
      await onChanged?.();
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to save social planning');
    } finally {
      setSaving('');
    }
  };

  const syncIcs = async () => {
    setSaving('ics-sync');
    setError('');
    setNotice('');
    try {
      const payload = await apiCall('post', `/events/${eventId}/personal-ics-source/sync`, {});
      const summary = payload?.summary || {};
      setNotice(`ICS synced: ${summary.total || 0} item${Number(summary.total || 0) === 1 ? '' : 's'}`);
      await load();
      await onChanged?.();
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to sync personal ICS source');
      await load();
    } finally {
      setSaving('');
    }
  };

  const removeIcs = async () => {
    setSaving('ics-remove');
    setError('');
    setNotice('');
    try {
      await apiCall('delete', `/events/${eventId}/personal-ics-source`);
      setNotice('Personal ICS source removed');
      await load();
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to remove personal ICS source');
    } finally {
      setSaving('');
    }
  };

  const updateMeetup = async (meetup) => {
    const meetupId = Number(meetup?.id || 0);
    if (!meetupId) return;
    const draft = meetupDrafts[String(meetupId)] || {};
    setSaving(`meetup-${meetupId}`);
    setError('');
    setNotice('');
    try {
      await apiCall('patch', `/events/${eventId}/meetups/${meetupId}`, {
        status: draft.status || meetup.status || 'planned',
        vendor: draft.vendor || null,
        booth: draft.booth || null,
        location_notes: draft.location_notes || null,
        notes: draft.notes || null
      });
      setNotice('Meetup updated');
      await load();
      await onChanged?.();
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to update meetup');
    } finally {
      setSaving('');
    }
  };

  const updatePlan = async (plan) => {
    const planId = Number(plan?.id || 0);
    if (!planId) return;
    const draft = planDrafts[String(planId)] || {};
    setSaving(`plan-${planId}`);
    setError('');
    setNotice('');
    try {
      await apiCall('patch', `/events/${eventId}/schedule-plans/${planId}`, {
        status: draft.status || plan.status || 'planned',
        visibility: draft.visibility || plan.visibility || 'private',
        vendor: draft.vendor || null,
        booth: draft.booth || null,
        location_notes: draft.location_notes || null,
        notes: draft.notes || null
      });
      setNotice('Schedule plan updated');
      await load();
      await onChanged?.();
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to update schedule plan');
    } finally {
      setSaving('');
    }
  };

  const previewScheduleChange = async (plan) => {
    const planId = Number(plan?.id || 0);
    if (!planId) return;
    const draft = planDrafts[String(planId)] || {};
    setSaving(`preview-plan-${planId}`);
    setError('');
    try {
      const preview = await apiCall('post', `/events/${eventId}/schedule-change-preview`, {
        schedule_plan_id: planId,
        requested_status: draft.status || plan.status || 'planned',
        requested_visibility: draft.visibility || plan.visibility || 'private'
      });
      setChangePreviews((prev) => ({ ...prev, [`plan-${planId}`]: preview }));
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to preview schedule change');
    } finally {
      setSaving('');
    }
  };

  const sendScheduleNotification = async (plan, status = 'sent') => {
    const planId = Number(plan?.id || 0);
    if (!planId) return;
    const draft = planDrafts[String(planId)] || {};
    const preview = changePreviews[`plan-${planId}`];
    const recipientAttendeeIds = (preview?.recipients?.attendees || []).map((attendee) => Number(attendee.id)).filter(Boolean);
    const recipientGroupIds = (preview?.recipients?.groups || []).map((group) => Number(group.id)).filter(Boolean);
    setSaving(`${status === 'draft' ? 'draft' : 'send'}-plan-${planId}`);
    setError('');
    setNotice('');
    try {
      const notification = await apiCall('post', `/events/${eventId}/schedule-notifications`, {
        schedule_plan_id: planId,
        requested_status: draft.status || plan.status || 'planned',
        requested_visibility: draft.visibility || plan.visibility || 'private',
        status,
        recipient_attendee_ids: recipientAttendeeIds,
        recipient_group_ids: recipientGroupIds
      });
      setScheduleNotifications((prev) => ({ ...prev, [`plan-${planId}`]: notification }));
      setScheduleNotificationHistory((prev) => ({
        ...prev,
        [`plan-${planId}`]: [notification, ...(prev[`plan-${planId}`] || []).filter((item) => item.id !== notification.id)]
      }));
      await load();
      setNotice(status === 'sent' ? 'Schedule notification recorded' : 'Schedule notification draft saved');
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to record schedule notification');
    } finally {
      setSaving('');
    }
  };

  const updateScheduleNotificationRecipient = async (recipient, readStatus = 'read') => {
    setSaving(`notification-recipient-${recipient.id}`);
    setError('');
    setNotice('');
    try {
      await apiCall('patch', `/events/${eventId}/schedule-notification-inbox/${recipient.id}`, {
        read_status: readStatus
      });
      await load();
      setNotice(readStatus === 'acknowledged' ? 'Notification acknowledged' : 'Notification marked read');
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to update notification');
    } finally {
      setSaving('');
    }
  };

  const updateCatalogSession = async (session) => {
    const sessionId = Number(session?.id || 0);
    if (!sessionId) return;
    const draft = catalogDrafts[String(sessionId)] || {};
    setSaving(`catalog-${sessionId}`);
    setError('');
    setNotice('');
    try {
      await apiCall('patch', `/events/${eventId}/schedule-sessions/${sessionId}`, {
        title: String(draft.title || session.title || '').trim(),
        start_at: fromDateTimeInput(draft.start_at),
        end_at: fromDateTimeInput(draft.end_at),
        location: draft.location || null,
        room: draft.room || null,
        track: draft.track || null,
        categories: parseCategoryList(draft.categories),
        source_url: draft.source_url || null,
        description: draft.description || null,
        status: draft.status || session.status || 'active'
      });
      setNotice('Catalog session updated');
      await load();
      await onChanged?.();
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to update catalog session');
    } finally {
      setSaving('');
    }
  };

  const upsertCatalogSessionPlanStatus = async (session, status = 'planned', options = {}) => {
    const sessionId = Number(session?.id || 0);
    if (!sessionId) return;
    const normalizedStatus = QUICK_SCHEDULE_PLAN_STATUS_OPTIONS.some((option) => option.value === status) ? status : 'planned';
    const existingPlan = plans.find((plan) => planLinksCatalogSession(plan, session));
    const conflictPlanUpdates = Array.isArray(options.conflictPlanUpdates) ? options.conflictPlanUpdates : [];
    setSaving(`catalog-plan-${sessionId}`);
    setError('');
    setNotice('');
    try {
      for (const update of conflictPlanUpdates) {
        const conflictPlanId = Number(update?.id || 0);
        if (!conflictPlanId) continue;
        await apiCall('patch', `/events/${eventId}/schedule-plans/${conflictPlanId}`, {
          status: update.status
        });
      }
      if (existingPlan?.id) {
        await apiCall('patch', `/events/${eventId}/schedule-plans/${existingPlan.id}`, {
          status: normalizedStatus
        });
        setNotice(options.notice || `Catalog session marked ${humanizeEventValue(normalizedStatus).toLowerCase()}`);
      } else {
        await apiCall('post', `/events/${eventId}/schedule-plans`, {
          title: session.title,
          start_at: session.start_at || null,
          end_at: session.end_at || null,
          location: session.location || session.room || null,
          source_type: 'schedule_catalog',
          source_ref: String(sessionId),
          source_url: session.source_url || null,
          source_categories: Array.isArray(session.categories) ? session.categories : [],
          source_updated_at: session.source_updated_at || null,
          status: normalizedStatus,
          visibility: 'private'
        });
        setNotice(options.notice || `Catalog session added as ${humanizeEventValue(normalizedStatus).toLowerCase()}`);
      }
      setPendingCatalogResolution(null);
      await load();
      await onChanged?.();
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to update catalog session plan state');
    } finally {
      setSaving('');
    }
  };

  const requestCatalogPlanStatusChange = async (session, status = 'planned', meta = {}) => {
    const normalizedStatus = QUICK_SCHEDULE_PLAN_STATUS_OPTIONS.some((option) => option.value === status) ? status : 'planned';
    const conflicts = Array.isArray(meta.conflicts) ? meta.conflicts.filter((plan) => plan?.id) : [];
    if (CONFLICTING_SCHEDULE_PLAN_STATUSES.has(normalizedStatus) && conflicts.length > 0) {
      setPendingCatalogResolution({ session, status: normalizedStatus, conflicts, source: meta.source || 'catalog' });
      setNotice('');
      setError('');
      return;
    }
    await upsertCatalogSessionPlanStatus(session, normalizedStatus);
  };

  const resolveCatalogConflict = async (action) => {
    const pending = pendingCatalogResolution;
    if (!pending?.session?.id) return;
    if (action === 'keep-both') {
      await upsertCatalogSessionPlanStatus(pending.session, pending.status, {
        notice: `Catalog session kept as ${humanizeEventValue(pending.status).toLowerCase()}`
      });
      return;
    }
    if (action === 'make-primary') {
      await upsertCatalogSessionPlanStatus(pending.session, 'planned', {
        conflictPlanUpdates: pending.conflicts.map((plan) => ({ id: plan.id, status: 'backup' })),
        notice: 'Catalog session planned; conflicts moved to backup'
      });
      return;
    }
    if (action === 'mark-backup') {
      await upsertCatalogSessionPlanStatus(pending.session, 'backup', {
        notice: 'Catalog session kept as backup'
      });
      return;
    }
    if (action === 'skip') {
      await upsertCatalogSessionPlanStatus(pending.session, 'skipped', {
        notice: 'Catalog session skipped'
      });
    }
  };

  const archive = async (path, label) => {
    setSaving(path);
    setError('');
    setNotice('');
    try {
      await apiCall('delete', path);
      setNotice(`${label} removed`);
      await load();
      await onChanged?.();
    } catch (err) {
      setError(err?.response?.data?.error || `Failed to remove ${label.toLowerCase()}`);
    } finally {
      setSaving('');
    }
  };

  return (
    <section className="rounded-lg border border-edge bg-surface">
      <div className="border-b border-edge px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">Event plans</h3>
            <p className="mt-1 text-xs text-dim">
              {pluralizePeople(attendees.length)} · {groups.length} group{groups.length === 1 ? '' : 's'} · {meetups.length} meetup{meetups.length === 1 ? '' : 's'} · {plans.length} plan{plans.length === 1 ? '' : 's'} · {catalogSessions.length} catalog
            </p>
          </div>
          {loading ? <Spinner size={16} /> : <button className="btn-ghost btn-sm" onClick={load}>Refresh</button>}
        </div>
        {error ? <p className="mt-2 text-xs text-err">{error}</p> : null}
        {notice ? <p className="mt-2 text-xs text-ok">{notice}</p> : null}
      </div>

      <EventSocialMobileOverview
        attendees={attendees}
        groups={groups}
        meetups={meetups}
        plans={plans}
      />

      <div className="divide-y divide-edge">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-ink">
            Catalog
            <span className="text-xs text-ghost">{catalogSessions.length}</span>
          </summary>
          <div className="space-y-3 pb-4">
            <EventScheduleNowNext
              sessions={catalogSessions}
              plans={plans}
              saving={saving}
              pendingResolution={pendingCatalogResolution}
              onPlanStatusChange={requestCatalogPlanStatusChange}
              onResolveConflict={resolveCatalogConflict}
              onCancelConflict={() => setPendingCatalogResolution(null)}
            />
            <EventScheduleCatalog
              sessions={catalogSessions}
              plans={plans}
              drafts={catalogDrafts}
              saving={saving}
              pendingResolution={pendingCatalogResolution}
              onDraftChange={setCatalogDraft}
              onUpdate={updateCatalogSession}
              onPlanStatusChange={requestCatalogPlanStatusChange}
              onResolveConflict={resolveCatalogConflict}
              onCancelConflict={() => setPendingCatalogResolution(null)}
              onRemove={(session) => archive(`/events/${eventId}/schedule-sessions/${session.id}`, 'Catalog session')}
            />
            <details className="mx-4 rounded-md border border-edge bg-raised">
              <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium text-ink">
                Import catalog ICS
              </summary>
              <div className="space-y-3 border-t border-edge px-3 py-3">
                <p className="text-xs leading-5 text-dim">
                  Import a full event calendar into the catalog. This is a one-time import and does not replace your personal Sched feed.
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
                  <input className="input" placeholder="Sched or calendar ICS URL" value={form.catalogImportUrl} onChange={(e) => set({ catalogImportUrl: e.target.value })} />
                  <button className="btn-secondary" disabled={!form.catalogImportUrl.trim() || saving === 'catalog-import'} onClick={() => save('catalog-import')}>
                    {saving === 'catalog-import' ? <Spinner size={16} /> : 'Import catalog'}
                  </button>
                </div>
              </div>
            </details>
            <details className="mx-4 rounded-md border border-edge bg-raised">
              <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium text-ink">
                Add catalog session
              </summary>
              <div className="grid grid-cols-1 gap-2 border-t border-edge px-3 py-3 sm:grid-cols-2">
                <input className="input" placeholder="Session title" value={form.catalogTitle} onChange={(e) => set({ catalogTitle: e.target.value })} />
                <input className="input" placeholder="Track" value={form.catalogTrack} onChange={(e) => set({ catalogTrack: e.target.value })} />
                <input className="input" placeholder="Location" value={form.catalogLocation} onChange={(e) => set({ catalogLocation: e.target.value })} />
                <input className="input" placeholder="Room" value={form.catalogRoom} onChange={(e) => set({ catalogRoom: e.target.value })} />
                <input type="datetime-local" className="input" value={form.catalogStart} onChange={(e) => set({ catalogStart: e.target.value })} />
                <input type="datetime-local" className="input" value={form.catalogEnd} onChange={(e) => set({ catalogEnd: e.target.value })} />
                <input className="input" placeholder="Categories, comma separated" value={form.catalogCategories} onChange={(e) => set({ catalogCategories: e.target.value })} />
                <input className="input" placeholder="Session URL" value={form.catalogSourceUrl} onChange={(e) => set({ catalogSourceUrl: e.target.value })} />
                <textarea className="input min-h-[72px] sm:col-span-2" placeholder="Description" value={form.catalogDescription} onChange={(e) => set({ catalogDescription: e.target.value })} />
                <button className="btn-secondary sm:col-span-2" disabled={!form.catalogTitle.trim() || saving === 'catalog'} onClick={() => save('catalog')}>{saving === 'catalog' ? <Spinner size={16} /> : 'Add catalog session'}</button>
              </div>
            </details>
          </div>
        </details>

        <details className="group" open>
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-ink">
            Schedule
            <span className="text-xs text-ghost">{plans.length}</span>
          </summary>
          <div className="space-y-3 pb-4">
            <EventScheduleAgenda
              plans={plans}
              planDrafts={planDrafts}
              changePreviews={changePreviews}
              scheduleNotifications={scheduleNotifications}
              scheduleNotificationHistory={scheduleNotificationHistory}
              saving={saving}
              onDraftChange={setPlanDraft}
              onUpdate={updatePlan}
              onPreviewChange={previewScheduleChange}
              onNotifyChange={sendScheduleNotification}
              onRemove={(plan) => archive(`/events/${eventId}/schedule-plans/${plan.id}`, 'Schedule plan')}
            />
            <details className="mx-4 rounded-md border border-edge bg-raised">
              <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium text-ink">
                Add manual plan
              </summary>
              <div className="grid grid-cols-1 gap-2 border-t border-edge px-3 py-3 sm:grid-cols-2">
                <input className="input" placeholder="Plan title" value={form.planTitle} onChange={(e) => set({ planTitle: e.target.value })} />
                <input className="input" placeholder="Location" value={form.planLocation} onChange={(e) => set({ planLocation: e.target.value })} />
                <input className="input" placeholder="Vendor" value={form.planVendor} onChange={(e) => set({ planVendor: e.target.value })} />
                <input className="input" placeholder="Booth" value={form.planBooth} onChange={(e) => set({ planBooth: e.target.value })} />
                <input type="datetime-local" className="input" value={form.planStart} onChange={(e) => set({ planStart: e.target.value })} />
                <input className="input" placeholder="Location note" value={form.planLocationNotes} onChange={(e) => set({ planLocationNotes: e.target.value })} />
                <button className="btn-secondary sm:col-span-2" disabled={!form.planTitle.trim() || saving === 'plan'} onClick={() => save('plan')}>{saving === 'plan' ? <Spinner size={16} /> : 'Add plan'}</button>
              </div>
            </details>
          </div>
        </details>

        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-ink">
            Notification inbox
            <span className="text-xs text-ghost">{scheduleNotificationInbox.counts?.unread || 0} unread</span>
          </summary>
          <EventScheduleNotificationInbox
            inbox={scheduleNotificationInbox}
            saving={saving}
            onUpdate={updateScheduleNotificationRecipient}
          />
        </details>

        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-ink">
            Manage Sched feed
            <span className={cx('text-xs', icsHealth.tone === 'error' ? 'text-err' : 'text-ghost')}>{icsHealth.summary}</span>
          </summary>
          <div className="space-y-3 px-4 pb-4">
            <p className="text-sm text-dim">
              Connect your personal Sched iCal link to sync selected sessions into private schedule plans. The URL is encrypted and never shown back here.
            </p>
            {icsSource?.has_url ? (
              <div className="rounded-md border border-edge bg-raised px-3 py-2">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="text-sm text-ink">Personal feed connected</p>
                      <span className={cx('text-xs', icsHealth.tone === 'error' ? 'text-err' : 'text-ghost')}>
                        {icsHealth.title}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-dim">{icsHealth.detail}</p>
                    <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-dim sm:grid-cols-2">
                      <div>
                        <dt className="text-ghost">Last successful sync</dt>
                        <dd>{icsSource.last_success_at ? formatDateTime(icsSource.last_success_at) : 'None yet'}</dd>
                      </div>
                      <div>
                        <dt className="text-ghost">Last refresh attempt</dt>
                        <dd>{icsSource.last_synced_at ? formatDateTime(icsSource.last_synced_at) : 'None yet'}</dd>
                      </div>
                      <div>
                        <dt className="text-ghost">Saved from feed</dt>
                        <dd>{icsSource.last_item_count || 0} item{Number(icsSource.last_item_count || 0) === 1 ? '' : 's'}</dd>
                      </div>
                      <div>
                        <dt className="text-ghost">State</dt>
                        <dd>{icsSource.sync_status || 'idle'}</dd>
                      </div>
                    </dl>
                    {icsSource.last_error ? (
                      <p className="mt-2 text-xs leading-5 text-err">{icsSource.last_error}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button className="btn-secondary btn-sm" disabled={saving === 'ics-sync'} onClick={syncIcs}>{saving === 'ics-sync' ? <Spinner size={16} /> : 'Sync now'}</button>
                    <button className="btn-ghost btn-sm text-err hover:bg-err/10" disabled={saving === 'ics-remove'} onClick={removeIcs}>Remove</button>
                  </div>
                </div>
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
              <input className="input" placeholder="https://.../my-schedule.ics" value={form.icsUrl} onChange={(e) => set({ icsUrl: e.target.value })} />
              <button className="btn-secondary" disabled={!form.icsUrl.trim() || saving === 'ics'} onClick={() => save('ics')}>{saving === 'ics' ? <Spinner size={16} /> : (icsSource?.has_url ? 'Replace feed' : 'Connect feed')}</button>
            </div>
          </div>
        </details>

        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-ink">
            People
            <span className="text-xs text-ghost">{attendees.length}</span>
          </summary>
          <div className="space-y-3 px-4 pb-4">
	            {attendees.length > 0 ? (
	              <div className="space-y-2">
	                {attendees.map((person) => (
	                  <div key={person.id} className={cx('flex items-center gap-3 rounded-md border border-edge bg-raised px-3 py-2', eventVisibilityRowClass(person.visibility))}>
	                    <div className="min-w-0 flex-1">
	                      <p className="truncate text-sm text-ink">{person.display_name}</p>
	                      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
	                        {[person.relationship, humanizeEventValue(person.status)].filter(Boolean).map((value) => (
	                          <span key={value} className="text-xs text-dim">{value}</span>
	                        ))}
	                        <EventVisibilityText value={person.visibility} />
	                        {person.current_user_attendee ? <span className="text-xs text-ok">Linked to you</span> : null}
	                        {!person.current_user_attendee && person.linked_user?.name ? <span className="text-xs text-dim">Linked to {person.linked_user.name}</span> : null}
	                      </div>
	                    </div>
	                    <button className="btn-ghost btn-sm text-err hover:bg-err/10" onClick={() => archive(`/events/${eventId}/attendees/${person.id}`, 'Attendee')}>Remove</button>
	                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-ghost">No attendees yet.</p>}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_10rem_auto]">
              <input className="input" placeholder="Name" value={form.attendeeName} onChange={(e) => set({ attendeeName: e.target.value })} />
              <input className="input" placeholder="Relationship" value={form.attendeeRelationship} onChange={(e) => set({ attendeeRelationship: e.target.value })} />
              <button className="btn-secondary" disabled={!form.attendeeName.trim() || saving === 'attendee'} onClick={() => save('attendee')}>{saving === 'attendee' ? <Spinner size={16} /> : 'Add'}</button>
              <CheckboxControl
                checked={Boolean(form.attendeeLinkCurrentUser)}
                labelClassName="sm:col-span-2"
                onChange={(event) => set({ attendeeLinkCurrentUser: event.target.checked })}
              >
                Link this attendee to my app user
              </CheckboxControl>
            </div>
          </div>
        </details>

        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-ink">
            Groups
            <span className="text-xs text-ghost">{groups.length}</span>
          </summary>
          <div className="space-y-3 px-4 pb-4">
	            {groups.length > 0 ? (
	              <div className="space-y-2">
	                {groups.map((group) => (
	                  <div key={group.id} className={cx('flex items-center gap-3 rounded-md border border-edge bg-raised px-3 py-2', eventVisibilityRowClass(group.visibility))}>
	                    <div className="min-w-0 flex-1">
	                      <p className="truncate text-sm text-ink">{group.name}</p>
	                      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
	                        <span className="text-xs text-dim">{pluralizePeople(group.members?.length || 0)}</span>
	                        <EventVisibilityText value={group.visibility} />
	                      </div>
	                    </div>
	                    <button className="btn-ghost btn-sm text-err hover:bg-err/10" onClick={() => archive(`/events/${eventId}/groups/${group.id}`, 'Group')}>Remove</button>
	                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-ghost">No groups yet.</p>}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
              <input className="input" placeholder="Group name" value={form.groupName} onChange={(e) => set({ groupName: e.target.value })} />
              <button className="btn-secondary" disabled={!form.groupName.trim() || saving === 'group'} onClick={() => save('group')}>{saving === 'group' ? <Spinner size={16} /> : 'Add'}</button>
            </div>
          </div>
        </details>

        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-ink">
            Meetups
            <span className="text-xs text-ghost">{meetups.length}</span>
          </summary>
          <div className="space-y-3 px-4 pb-4">
	            {meetups.length > 0 ? (
	              <div className="space-y-2">
	                {meetups.map((meetup) => (
	                  <details key={meetup.id} className={cx('rounded-md border border-edge bg-raised', eventVisibilityRowClass(meetup.visibility))}>
	                    <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2">
	                      <div className="min-w-0 flex-1">
	                        <p className="truncate text-sm text-ink">{meetup.title}</p>
                        <p className="truncate text-xs text-dim">{[formatDateTime(meetup.start_at), socialPlaceSummary(meetup), meetup.group_name, humanizeEventValue(meetup.status)].filter(Boolean).join(' · ')}</p>
	                      </div>
	                      <div className="flex shrink-0 items-center gap-2">
	                        <EventVisibilityText value={meetup.visibility} />
	                        <span className="text-xs text-ghost">Edit</span>
	                      </div>
	                    </summary>
                    <div className="space-y-3 border-t border-edge px-3 py-3">
                      <div className="grid grid-cols-1 gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
                        {meetup.location ? (
                          <div className="min-w-0">
                            <p className="text-xs text-ghost">Location</p>
                            <p className="mt-1 leading-6 text-dim">{meetup.location}</p>
                          </div>
                        ) : null}
                        {vendorBoothLabel(meetup) ? (
                          <div className="min-w-0">
                            <p className="text-xs text-ghost">Vendor / booth</p>
                            <p className="mt-1 leading-6 text-dim">{vendorBoothLabel(meetup)}</p>
                          </div>
                        ) : null}
                        {meetup.location_notes ? (
                          <div className="min-w-0 sm:col-span-2">
                            <p className="text-xs text-ghost">Location note</p>
                            <p className="mt-1 leading-6 text-dim">{meetup.location_notes}</p>
                          </div>
                        ) : null}
                      </div>
                      <div className="grid grid-cols-1 gap-2 border-t border-edge pt-3 sm:grid-cols-[9rem_1fr_7rem]">
                        <label className="field">
                          <span className="label">Status</span>
                          <select
                            className="input"
                            value={meetupDrafts[String(meetup.id)]?.status || meetup.status || 'planned'}
                            onChange={(e) => setMeetupDraft(meetup.id, { status: e.target.value })}
                          >
                            {MEETUP_STATUS_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          <span className="label">Vendor</span>
                          <input
                            className="input"
                            placeholder="Vendor"
                            value={meetupDrafts[String(meetup.id)]?.vendor ?? meetup.vendor ?? ''}
                            onChange={(e) => setMeetupDraft(meetup.id, { vendor: e.target.value })}
                          />
                        </label>
                        <label className="field">
                          <span className="label">Booth</span>
                          <input
                            className="input"
                            placeholder="Booth"
                            value={meetupDrafts[String(meetup.id)]?.booth ?? meetup.booth ?? ''}
                            onChange={(e) => setMeetupDraft(meetup.id, { booth: e.target.value })}
                          />
                        </label>
                        <label className="field sm:col-span-2">
                          <span className="label">Location note</span>
                          <input
                            className="input"
                            placeholder="Location note"
                            value={meetupDrafts[String(meetup.id)]?.location_notes ?? meetup.location_notes ?? ''}
                            onChange={(e) => setMeetupDraft(meetup.id, { location_notes: e.target.value })}
                          />
                        </label>
                        <label className="field">
                          <span className="label">Notes</span>
                          <input
                            className="input"
                            placeholder="Quick note"
                            value={meetupDrafts[String(meetup.id)]?.notes ?? meetup.notes ?? ''}
                            onChange={(e) => setMeetupDraft(meetup.id, { notes: e.target.value })}
                          />
                        </label>
                        <div className="flex items-end gap-2 sm:col-span-3">
                          <button className="btn-secondary btn-sm" disabled={saving === `meetup-${meetup.id}`} onClick={() => updateMeetup(meetup)}>
                            {saving === `meetup-${meetup.id}` ? <Spinner size={16} /> : 'Save'}
                          </button>
                          <button className="btn-ghost btn-sm text-err hover:bg-err/10" onClick={() => archive(`/events/${eventId}/meetups/${meetup.id}`, 'Meetup')}>Remove</button>
                        </div>
                      </div>
                    </div>
                  </details>
                ))}
              </div>
            ) : <p className="text-sm text-ghost">No meetups yet.</p>}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input className="input" placeholder="Meetup title" value={form.meetupTitle} onChange={(e) => set({ meetupTitle: e.target.value })} />
              <input className="input" placeholder="Location" value={form.meetupLocation} onChange={(e) => set({ meetupLocation: e.target.value })} />
              <input className="input" placeholder="Vendor" value={form.meetupVendor} onChange={(e) => set({ meetupVendor: e.target.value })} />
              <input className="input" placeholder="Booth" value={form.meetupBooth} onChange={(e) => set({ meetupBooth: e.target.value })} />
              <input type="datetime-local" className="input" value={form.meetupStart} onChange={(e) => set({ meetupStart: e.target.value })} />
              <select className="input" value={form.meetupGroupId} onChange={(e) => set({ meetupGroupId: e.target.value })}>
                <option value="">No group</option>
                {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
              <input className="input sm:col-span-2" placeholder="Location note" value={form.meetupLocationNotes} onChange={(e) => set({ meetupLocationNotes: e.target.value })} />
              <button className="btn-secondary sm:col-span-2" disabled={!form.meetupTitle.trim() || saving === 'meetup'} onClick={() => save('meetup')}>{saving === 'meetup' ? <Spinner size={16} /> : 'Add meetup'}</button>
            </div>
          </div>
        </details>

      </div>
    </section>
  );
}

function EventScheduleNowNext({ sessions = [], plans = [], saving = '', pendingResolution = null, onPlanStatusChange, onResolveConflict, onCancelConflict }) {
  const snapshot = useMemo(() => getCatalogNowNext(sessions, plans), [sessions, plans]);
  const getConflicts = useCallback((session) => {
    if (!session) return [];
    const plan = snapshot.catalogPlanByRef.get(String(session.id));
    return findCatalogSessionConflicts(session, plan, plans);
  }, [plans, snapshot.catalogPlanByRef]);
  const getAttendance = useCallback((session) => buildScheduleAttendanceSummary(session, plans), [plans]);
  const hasSessions = Boolean(snapshot.current || snapshot.next || snapshot.laterToday.length);

  if (!hasSessions) {
    return (
      <div className="mx-4 rounded-md border border-edge bg-raised px-3 py-3" aria-label="Catalog now and next">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-ink">Now / Next</p>
          <span className="text-xs text-ghost">Catalog</span>
        </div>
        <p className="mt-2 text-sm text-ghost">No active catalog sessions are happening now or later today.</p>
      </div>
    );
  }

  return (
    <div className="mx-4 rounded-md border border-edge bg-raised" aria-label="Catalog now and next">
      <div className="flex items-center justify-between gap-3 border-b border-edge px-3 py-2">
        <p className="text-sm font-medium text-ink">Now / Next</p>
        <span className="text-xs text-ghost">Catalog</span>
      </div>
      <div className="divide-y divide-edge">
        <CatalogNowNextSlot
          label="Now"
          session={snapshot.current}
          plan={snapshot.current ? snapshot.catalogPlanByRef.get(String(snapshot.current.id)) : null}
          conflicts={snapshot.current ? getConflicts(snapshot.current) : []}
          attendance={snapshot.current ? getAttendance(snapshot.current) : null}
          saving={snapshot.current ? saving === `catalog-plan-${snapshot.current.id}` : false}
          pendingResolution={pendingResolution}
          onPlanStatusChange={onPlanStatusChange}
          onResolveConflict={onResolveConflict}
          onCancelConflict={onCancelConflict}
          empty="Nothing currently in progress."
        />
        <CatalogNowNextSlot
          label="Next"
          session={snapshot.next}
          plan={snapshot.next ? snapshot.catalogPlanByRef.get(String(snapshot.next.id)) : null}
          conflicts={snapshot.next ? getConflicts(snapshot.next) : []}
          attendance={snapshot.next ? getAttendance(snapshot.next) : null}
          saving={snapshot.next ? saving === `catalog-plan-${snapshot.next.id}` : false}
          pendingResolution={pendingResolution}
          onPlanStatusChange={onPlanStatusChange}
          onResolveConflict={onResolveConflict}
          onCancelConflict={onCancelConflict}
          empty="No upcoming catalog session."
        />
        {snapshot.laterToday.length ? (
          <div className="grid grid-cols-[4.75rem_1fr] gap-3 px-3 py-3 sm:grid-cols-[5.75rem_1fr]">
            <p className="text-xs font-medium text-dim">Later</p>
            <div className="space-y-2">
              {snapshot.laterToday.map((session) => (
                <CatalogNowNextMiniRow
                  key={session.id}
                  session={session}
                  plan={snapshot.catalogPlanByRef.get(String(session.id))}
                  conflicts={getConflicts(session)}
                  attendance={getAttendance(session)}
                  saving={saving === `catalog-plan-${session.id}`}
                  pendingResolution={pendingResolution}
                  onPlanStatusChange={onPlanStatusChange}
                  onResolveConflict={onResolveConflict}
                  onCancelConflict={onCancelConflict}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CatalogNowNextSlot({ label, session, plan = null, conflicts = [], attendance = null, saving = false, pendingResolution = null, onPlanStatusChange, onResolveConflict, onCancelConflict, empty }) {
  return (
    <div className="grid grid-cols-[4.75rem_1fr] gap-3 px-3 py-3 sm:grid-cols-[5.75rem_1fr]">
      <p className="text-xs font-medium text-dim">{label}</p>
      {session ? (
        <CatalogNowNextMiniRow
          session={session}
          plan={plan}
          conflicts={conflicts}
          attendance={attendance}
          saving={saving}
          pendingResolution={pendingResolution}
          onPlanStatusChange={onPlanStatusChange}
          onResolveConflict={onResolveConflict}
          onCancelConflict={onCancelConflict}
        />
      ) : (
        <p className="text-sm text-ghost">{empty}</p>
      )}
    </div>
  );
}

function CatalogNowNextMiniRow({ session, plan = null, conflicts = [], attendance = null, saving = false, pendingResolution = null, onPlanStatusChange, onResolveConflict, onCancelConflict }) {
  const agendaTime = formatAgendaTime(session?.start_at, session?.end_at);
  const categories = Array.isArray(session?.categories) ? session.categories.filter(Boolean) : [];
  const planStatus = plan?.status || '';
  const conflictSummary = formatConflictSummary(conflicts);
  const showResolution = isPendingCatalogResolution(pendingResolution, session, 'now-next');
  const detailLine = [
    agendaTime.start && agendaTime.end ? `${agendaTime.start} - ${agendaTime.end}` : agendaTime.start,
    compactLocation(session?.room || session?.location),
    session?.track,
    categories[0]
  ].filter(Boolean).join(' · ');

  return (
    <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_8.5rem] sm:items-start">
      <div className="min-w-0">
        <div className="flex min-w-0 items-baseline gap-2">
          <p className="truncate text-sm font-medium text-ink">{session.title}</p>
          {planStatus ? <span className="shrink-0 text-xs text-ok">{humanizeEventValue(planStatus)}</span> : null}
        </div>
        <p className="mt-1 truncate text-xs text-dim">{detailLine || 'Details pending'}</p>
        {attendance?.shared ? <p className="mt-1 truncate text-xs text-dim">{attendance.shared}</p> : null}
        {conflictSummary ? <p className="mt-1 truncate text-xs text-warn">{conflictSummary}</p> : null}
      </div>
      <CatalogPlanStateSelect
        session={session}
        plan={plan}
        conflicts={conflicts}
        source="now-next"
        saving={saving}
        onPlanStatusChange={onPlanStatusChange}
      />
      {showResolution ? (
        <div className="sm:col-span-2">
          <CatalogConflictResolutionPanel
            pendingResolution={pendingResolution}
            saving={saving}
            onResolve={onResolveConflict}
            onCancel={onCancelConflict}
          />
        </div>
      ) : null}
    </div>
  );
}

function CatalogPlanStateSelect({ session, plan = null, conflicts = [], source = 'catalog', saving = false, onPlanStatusChange }) {
  const value = plan?.status || '';
  return (
    <label className="field">
      <span className="sr-only">Plan state</span>
      <select
        className="input h-9 text-xs"
        value={value}
        disabled={saving || session?.status === 'hidden' || !onPlanStatusChange}
        onChange={(event) => {
          if (event.target.value) onPlanStatusChange?.(session, event.target.value, { conflicts, source });
        }}
        aria-label={`Plan state for ${session?.title || 'catalog session'}`}
      >
        <option value="">Not in schedule</option>
        {QUICK_SCHEDULE_PLAN_STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function CatalogConflictResolutionPanel({ pendingResolution = null, saving = false, onResolve, onCancel }) {
  const conflicts = Array.isArray(pendingResolution?.conflicts) ? pendingResolution.conflicts : [];
  const conflictSummary = formatConflictSummary(conflicts);
  const selectedLabel = humanizeEventValue(pendingResolution?.status || 'planned').toLowerCase();
  return (
    <div className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2" aria-label="Schedule conflict resolution">
      <p className="text-sm font-medium text-ink">Resolve schedule conflict</p>
      <p className="mt-1 text-xs leading-5 text-dim">
        {conflictSummary || 'This session overlaps another active schedule plan.'} Choose how to save this as {selectedLabel}.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button className="btn-secondary btn-sm" disabled={saving} onClick={() => onResolve?.('keep-both')}>
          Keep both
        </button>
        <button className="btn-ghost btn-sm" disabled={saving} onClick={() => onResolve?.('make-primary')}>
          Make planned, move conflicts to backup
        </button>
        <button className="btn-ghost btn-sm" disabled={saving} onClick={() => onResolve?.('mark-backup')}>
          Mark as backup
        </button>
        <button className="btn-ghost btn-sm" disabled={saving} onClick={() => onResolve?.('skip')}>
          Skip this
        </button>
        <button className="btn-ghost btn-sm text-ghost" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function EventScheduleCatalog({ sessions, plans = [], drafts = {}, saving = '', pendingResolution = null, onDraftChange, onUpdate, onPlanStatusChange, onResolveConflict, onCancelConflict, onRemove }) {
  const [filters, setFilters] = useState({
    time: 'all',
    plan: 'all',
    track: CATALOG_METADATA_ALL_VALUE,
    category: CATALOG_METADATA_ALL_VALUE,
    place: CATALOG_METADATA_ALL_VALUE,
    conflictsOnly: false,
    sharedOnly: false
  });
  const resetFilters = useCallback(() => setFilters({
    time: 'all',
    plan: 'all',
    track: CATALOG_METADATA_ALL_VALUE,
    category: CATALOG_METADATA_ALL_VALUE,
    place: CATALOG_METADATA_ALL_VALUE,
    conflictsOnly: false,
    sharedOnly: false
  }), []);
  const catalogPlanByRef = useMemo(() => buildCatalogPlanByRef(plans), [plans]);
  const metadataOptions = useMemo(() => {
    const sourceSessions = Array.isArray(sessions) ? sessions : [];
    const collect = (getValues) => {
      const values = new Set();
      sourceSessions.forEach((session) => {
        const rawValues = getValues(session);
        (Array.isArray(rawValues) ? rawValues : [rawValues])
          .map((value) => String(value || '').trim())
          .filter(Boolean)
          .forEach((value) => values.add(value));
      });
      return Array.from(values).sort((a, b) => a.localeCompare(b));
    };

    return {
      tracks: collect((session) => session?.track),
      categories: collect((session) => session?.categories),
      places: collect((session) => [session?.room, compactLocation(session?.location)])
    };
  }, [sessions]);
  const getConflicts = useCallback((session) => {
    const plan = session?.id ? catalogPlanByRef.get(String(session.id)) : null;
    return findCatalogSessionConflicts(session, plan, plans);
  }, [catalogPlanByRef, plans]);
  const getAttendance = useCallback((session) => buildScheduleAttendanceSummary(session, plans), [plans]);
  const filterNow = useMemo(() => new Date(), [sessions, plans]);
  const todayKey = useMemo(() => getPlanDayKey(filterNow), [filterNow]);
  const nextSessionId = useMemo(() => {
    const nextEntry = sortPlansForAgenda(Array.isArray(sessions) ? sessions : [])
      .filter((session) => session?.status !== 'hidden' && session?.status !== 'cancelled')
      .map((session) => ({ session, window: catalogSessionTimeWindow(session, filterNow) }))
      .filter((entry) => entry.window?.isUpcoming)
      .sort((a, b) => a.window.startTime - b.window.startTime)[0];
    return nextEntry?.session?.id ? String(nextEntry.session.id) : '';
  }, [filterNow, sessions]);
  const filteredSessions = useMemo(() => {
    return sortPlansForAgenda(Array.isArray(sessions) ? sessions : [])
      .filter((session) => {
        const plan = session?.id ? catalogPlanByRef.get(String(session.id)) : null;
        const planStatus = plan?.status || 'none';
        if (filters.plan !== 'all' && planStatus !== filters.plan) return false;
        if (filters.track !== CATALOG_METADATA_ALL_VALUE && String(session?.track || '').trim() !== filters.track) return false;
        if (filters.category !== CATALOG_METADATA_ALL_VALUE) {
          const categories = Array.isArray(session?.categories) ? session.categories.map((category) => String(category || '').trim()) : [];
          if (!categories.includes(filters.category)) return false;
        }
        if (filters.place !== CATALOG_METADATA_ALL_VALUE) {
          const places = [session?.room, compactLocation(session?.location)]
            .map((value) => String(value || '').trim())
            .filter(Boolean);
          if (!places.includes(filters.place)) return false;
        }

        if (filters.conflictsOnly && !getConflicts(session).length) return false;
        if (filters.sharedOnly && !getAttendance(session).hasShared) return false;

        if (filters.time === 'all') return true;
        const window = catalogSessionTimeWindow(session, filterNow);
        if (filters.time === 'now') return Boolean(window?.isNow);
        if (filters.time === 'next') return String(session?.id || '') === nextSessionId;
        if (filters.time === 'later_today') {
          return Boolean(window?.isUpcoming) &&
            getPlanDayKey(session?.start_at) === todayKey &&
            String(session?.id || '') !== nextSessionId;
        }
        return true;
      });
  }, [catalogPlanByRef, filterNow, filters, getAttendance, getConflicts, nextSessionId, plans, sessions, todayKey]);
  const groups = useMemo(() => {
    return filteredSessions.reduce((acc, session) => {
      const key = getPlanDayKey(session?.start_at);
      const existing = acc.find((group) => group.key === key);
      if (existing) {
        existing.items.push(session);
      } else {
        acc.push({ key, label: formatPlanDayLabel(session?.start_at), items: [session] });
      }
      return acc;
    }, []);
  }, [filteredSessions]);

  if (!Array.isArray(sessions) || !sessions.length) {
    return <p className="px-4 text-sm text-ghost">No catalog sessions yet.</p>;
  }

  const activeFilterCount = [
    filters.time !== 'all',
    filters.plan !== 'all',
    filters.track !== CATALOG_METADATA_ALL_VALUE,
    filters.category !== CATALOG_METADATA_ALL_VALUE,
    filters.place !== CATALOG_METADATA_ALL_VALUE,
    filters.conflictsOnly,
    filters.sharedOnly
  ].filter(Boolean).length;

  const filterButtonClass = (active) => cx(
    'btn-ghost btn-sm shrink-0',
    active && 'border-edge bg-raised text-ink'
  );

  return (
    <div className="border-y border-edge bg-surface" aria-label="Schedule catalog sessions">
      <div className="space-y-2 border-b border-edge px-4 py-2" aria-label="Catalog filters">
        <div className="flex gap-2 overflow-x-auto scroll-area">
          {CATALOG_TIME_FILTER_OPTIONS.map((option) => (
            <button
              key={option.value}
              className={filterButtonClass(filters.time === option.value)}
              onClick={() => setFilters((previous) => ({ ...previous, time: option.value }))}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="field">
            <span className="sr-only">Catalog plan state filter</span>
            <select
              className="input h-9 text-xs"
              value={filters.plan}
              onChange={(event) => setFilters((previous) => ({ ...previous, plan: event.target.value }))}
              aria-label="Catalog plan state filter"
            >
              {CATALOG_PLAN_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="sr-only">Catalog track filter</span>
            <select
              className="input h-9 text-xs"
              value={filters.track}
              onChange={(event) => setFilters((previous) => ({ ...previous, track: event.target.value }))}
              aria-label="Catalog track filter"
            >
              <option value={CATALOG_METADATA_ALL_VALUE}>Any track</option>
              {metadataOptions.tracks.map((track) => (
                <option key={track} value={track}>{track}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="sr-only">Catalog category filter</span>
            <select
              className="input h-9 text-xs"
              value={filters.category}
              onChange={(event) => setFilters((previous) => ({ ...previous, category: event.target.value }))}
              aria-label="Catalog category filter"
            >
              <option value={CATALOG_METADATA_ALL_VALUE}>Any category</option>
              {metadataOptions.categories.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="sr-only">Catalog room or location filter</span>
            <select
              className="input h-9 text-xs"
              value={filters.place}
              onChange={(event) => setFilters((previous) => ({ ...previous, place: event.target.value }))}
              aria-label="Catalog room or location filter"
            >
              <option value={CATALOG_METADATA_ALL_VALUE}>Any room/location</option>
              {metadataOptions.places.map((place) => (
                <option key={place} value={place}>{place}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex gap-2 overflow-x-auto scroll-area">
          <button
            className={filterButtonClass(filters.conflictsOnly)}
            onClick={() => setFilters((previous) => ({ ...previous, conflictsOnly: !previous.conflictsOnly }))}
            aria-pressed={filters.conflictsOnly}
          >
            Conflicts only
          </button>
          <button
            className={filterButtonClass(filters.sharedOnly)}
            onClick={() => setFilters((previous) => ({ ...previous, sharedOnly: !previous.sharedOnly }))}
            aria-pressed={filters.sharedOnly}
          >
            Has shared attendance
          </button>
          {activeFilterCount ? (
            <button
              className="btn-ghost btn-sm shrink-0 text-ghost"
              onClick={resetFilters}
            >
              Clear
            </button>
          ) : null}
          <span className="shrink-0 self-center text-xs text-ghost">
            {filteredSessions.length} of {sessions.length}
          </span>
        </div>
      </div>
      {!groups.length ? (
        <p className="px-4 py-3 text-sm text-ghost">No catalog sessions match these filters.</p>
      ) : null}
      {groups.map((group) => (
        <div key={group.key} className="border-b border-edge last:border-b-0">
          <div className="border-b border-edge px-4 py-2 text-xs font-medium text-dim">
            {group.label}
          </div>
          <div className="divide-y divide-edge">
            {group.items.map((session) => (
              <ScheduleCatalogRow
                key={session.id}
                session={session}
                draft={drafts[String(session.id)] || {}}
                saving={saving === `catalog-${session.id}`}
                adding={saving === `catalog-plan-${session.id}`}
                plan={catalogPlanByRef.get(String(session.id))}
                conflicts={getConflicts(session)}
                attendance={getAttendance(session)}
                pendingResolution={pendingResolution}
                onDraftChange={(patch) => onDraftChange?.(session.id, patch)}
                onUpdate={() => onUpdate?.(session)}
                onPlanStatusChange={onPlanStatusChange}
                onResolveConflict={onResolveConflict}
                onCancelConflict={onCancelConflict}
                onRemove={() => onRemove?.(session)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ScheduleCatalogRow({ session, draft = {}, saving = false, adding = false, plan = null, conflicts = [], attendance = null, pendingResolution = null, onDraftChange, onUpdate, onPlanStatusChange, onResolveConflict, onCancelConflict, onRemove }) {
  const categories = Array.isArray(session?.categories) ? session.categories.filter(Boolean) : [];
  const descriptionPreview = plainTextPreview(session?.description, 700);
  const agendaTime = formatAgendaTime(session?.start_at, session?.end_at);
  const locationLine = [compactLocation(session?.location || session?.room), session?.track, categories.slice(0, 2).join(' · ')].filter(Boolean).join(' · ');
  const sourceDetails = [
    scheduleSourceLabel(session),
    session?.source_updated_at ? `Updated ${formatDateTime(session.source_updated_at)}` : ''
  ].filter(Boolean).join(' · ');
  const draftStatus = draft.status || session?.status || 'active';
  const planStatus = plan?.status || '';
  const conflictSummary = formatConflictSummary(conflicts);
  const showResolution = isPendingCatalogResolution(pendingResolution, session, 'catalog');

  return (
    <details className={cx('group border-l-2', session?.status === 'cancelled' ? 'border-l-err/50' : 'border-l-transparent')}>
      <summary className="grid cursor-pointer list-none grid-cols-[4.75rem_1fr] gap-3 px-4 py-3 sm:grid-cols-[5.75rem_1fr]">
        <div className="text-xs font-medium leading-5 text-dim">
          <div className="whitespace-nowrap">{agendaTime.start}</div>
          {agendaTime.end ? <div className="whitespace-nowrap text-ghost">{agendaTime.end}</div> : null}
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-baseline gap-2">
            <p className="truncate text-sm font-medium text-ink">{session.title}</p>
            {session.status && session.status !== 'active' ? <span className="shrink-0 text-xs text-ghost">{session.status}</span> : null}
            {planStatus ? <span className="shrink-0 text-xs text-ok">{humanizeEventValue(planStatus)}</span> : null}
            {conflictSummary ? <span className="shrink-0 text-xs text-warn">Conflict</span> : null}
          </div>
          <p className="mt-1 truncate text-xs text-dim">
            {locationLine || 'Location pending'}
          </p>
          {attendance?.shared ? <p className="mt-1 truncate text-xs text-dim">{attendance.shared}</p> : null}
          {conflictSummary ? <p className="mt-1 truncate text-xs text-warn">{conflictSummary}</p> : null}
        </div>
      </summary>
      <div className="grid grid-cols-[4.75rem_1fr] gap-3 px-4 pb-3 sm:grid-cols-[5.75rem_1fr]">
        <div />
        <div className="space-y-3 border-t border-edge pt-3">
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
            {session.location ? (
              <div className="min-w-0">
                <p className="text-xs text-ghost">Location</p>
                <p className="mt-1 leading-6 text-dim">{session.location}</p>
              </div>
            ) : null}
            {session.room ? (
              <div className="min-w-0">
                <p className="text-xs text-ghost">Room</p>
                <p className="mt-1 leading-6 text-dim">{session.room}</p>
              </div>
            ) : null}
            {session.track ? (
              <div className="min-w-0">
                <p className="text-xs text-ghost">Track</p>
                <p className="mt-1 leading-6 text-dim">{session.track}</p>
              </div>
            ) : null}
            {categories.length > 0 ? (
              <div className="min-w-0">
                <p className="text-xs text-ghost">Categories</p>
                <p className="mt-1 leading-6 text-dim">{categories.join(' · ')}</p>
              </div>
            ) : null}
            {sourceDetails ? (
              <div className="min-w-0">
                <p className="text-xs text-ghost">Source</p>
                <p className="mt-1 leading-6 text-dim">{sourceDetails}</p>
              </div>
            ) : null}
            {session.status ? (
              <div className="min-w-0">
                <p className="text-xs text-ghost">Status</p>
                <p className="mt-1 capitalize leading-6 text-dim">{session.status}</p>
              </div>
            ) : null}
          </div>
          {descriptionPreview ? (
            <div>
              <p className="text-xs text-ghost">Description</p>
              <p className="mt-1 text-sm leading-6 text-dim">{descriptionPreview}</p>
            </div>
          ) : null}
          {conflictSummary ? (
            <div className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn">
              {conflictSummary}
            </div>
          ) : null}
          {attendance?.hasShared ? (
            <div className="rounded-md border border-edge bg-raised px-3 py-2 text-sm" aria-label="Shared attendance">
              <p className="font-medium text-ink">Shared attendance</p>
              <div className="mt-1 space-y-1 text-xs text-dim">
                {attendance.own ? <p>{attendance.own}</p> : null}
                {attendance.visibilityLines.map((line) => <p key={line}>{line}</p>)}
              </div>
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-2 border-t border-edge pt-3 sm:grid-cols-2">
            <label className="field">
              <span className="label">Title</span>
              <input className="input" value={draft.title ?? session.title ?? ''} onChange={(event) => onDraftChange?.({ title: event.target.value })} />
            </label>
            <label className="field">
              <span className="label">Status</span>
              <select className="input" value={draftStatus} onChange={(event) => onDraftChange?.({ status: event.target.value })}>
                {SCHEDULE_CATALOG_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="label">Start</span>
              <input type="datetime-local" className="input" value={draft.start_at ?? ''} onChange={(event) => onDraftChange?.({ start_at: event.target.value })} />
            </label>
            <label className="field">
              <span className="label">End</span>
              <input type="datetime-local" className="input" value={draft.end_at ?? ''} onChange={(event) => onDraftChange?.({ end_at: event.target.value })} />
            </label>
            <label className="field">
              <span className="label">Location</span>
              <input className="input" value={draft.location ?? session.location ?? ''} onChange={(event) => onDraftChange?.({ location: event.target.value })} />
            </label>
            <label className="field">
              <span className="label">Room</span>
              <input className="input" value={draft.room ?? session.room ?? ''} onChange={(event) => onDraftChange?.({ room: event.target.value })} />
            </label>
            <label className="field">
              <span className="label">Track</span>
              <input className="input" value={draft.track ?? session.track ?? ''} onChange={(event) => onDraftChange?.({ track: event.target.value })} />
            </label>
            <label className="field">
              <span className="label">Categories</span>
              <input className="input" value={draft.categories ?? formatCategoryInput(session.categories)} onChange={(event) => onDraftChange?.({ categories: event.target.value })} />
            </label>
            <label className="field sm:col-span-2">
              <span className="label">Session URL</span>
              <input className="input" value={draft.source_url ?? session.source_url ?? ''} onChange={(event) => onDraftChange?.({ source_url: event.target.value })} />
            </label>
            <label className="field sm:col-span-2">
              <span className="label">Description</span>
              <textarea className="input min-h-[72px]" value={draft.description ?? session.description ?? ''} onChange={(event) => onDraftChange?.({ description: event.target.value })} />
            </label>
            <div className="flex items-end sm:col-span-2">
              <button className="btn-secondary btn-sm w-full sm:w-auto" disabled={saving || !String(draft.title ?? session.title ?? '').trim()} onClick={onUpdate}>
                {saving ? <Spinner size={16} /> : 'Save catalog session'}
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-edge pt-3">
            <div className="flex flex-wrap items-center gap-2">
              {session.source_url ? (
                <a className="btn-ghost btn-sm" href={session.source_url} target="_blank" rel="noreferrer">
                  <Icons.Link />
                  Open session
                </a>
              ) : null}
              <div className="w-36">
                {adding ? (
                  <div className="flex h-9 items-center justify-center rounded-md border border-edge bg-surface">
                    <Spinner size={16} />
                  </div>
                ) : (
                  <CatalogPlanStateSelect
                    session={session}
                    plan={plan}
                    conflicts={conflicts}
                    saving={adding}
                    onPlanStatusChange={onPlanStatusChange}
                  />
                )}
              </div>
            </div>
            <button
              className="btn-ghost btn-sm text-ghost hover:bg-err/10 hover:text-err"
              onClick={onRemove}
              aria-label={`Archive ${session.title || 'catalog session'}`}
            >
              Archive catalog session
            </button>
          </div>
          {showResolution ? (
            <CatalogConflictResolutionPanel
              pendingResolution={pendingResolution}
              saving={adding}
              onResolve={onResolveConflict}
              onCancel={onCancelConflict}
            />
          ) : null}
        </div>
      </div>
    </details>
  );
}

function EventScheduleAgenda({ plans, planDrafts = {}, changePreviews = {}, scheduleNotifications = {}, scheduleNotificationHistory = {}, saving = '', onDraftChange, onUpdate, onPreviewChange, onNotifyChange, onRemove }) {
  const [filter, setFilter] = useState({ type: 'all', key: 'all' });
  const conflictMap = useMemo(() => buildScheduleConflictMap(plans), [plans]);

  const groups = useMemo(() => {
    const ordered = sortPlansForAgenda(Array.isArray(plans) ? plans : []);
    return ordered.reduce((acc, plan) => {
      const key = getPlanDayKey(plan?.start_at);
      const existing = acc.find((group) => group.key === key);
      if (existing) {
        existing.items.push(plan);
      } else {
        acc.push({ key, label: formatPlanDayLabel(plan?.start_at), items: [plan] });
      }
      return acc;
    }, []);
  }, [plans]);

  const currentOrNext = useMemo(() => findCurrentOrNextPlan(plans), [plans]);
  const upcoming = useMemo(() => upcomingPlans(plans), [plans]);
  const todayKey = useMemo(() => getPlanDayKey(new Date()), []);
  const hasToday = groups.some((group) => group.key === todayKey);

  const visibleGroups = useMemo(() => {
    if (filter.type === 'day') return groups.filter((group) => group.key === filter.key);
    if (filter.type === 'upcoming') {
      return upcoming.reduce((acc, plan) => {
        const key = getPlanDayKey(plan?.start_at);
        const existing = acc.find((group) => group.key === key);
        if (existing) {
          existing.items.push(plan);
        } else {
          acc.push({ key, label: formatPlanDayLabel(plan?.start_at), items: [plan] });
        }
        return acc;
      }, []);
    }
    if (filter.type === 'focus' && currentOrNext?.plan?.id) {
      const key = getPlanDayKey(currentOrNext.plan.start_at);
      return [{ key, label: formatPlanDayLabel(currentOrNext.plan.start_at), items: [currentOrNext.plan] }];
    }
    return groups;
  }, [currentOrNext, filter, groups, upcoming]);

  useEffect(() => {
    if (filter.type === 'day' && !groups.some((group) => group.key === filter.key)) {
      setFilter({ type: 'all', key: 'all' });
    }
    if (filter.type === 'focus' && !currentOrNext?.plan?.id) {
      setFilter({ type: 'all', key: 'all' });
    }
    if (filter.type === 'upcoming' && upcoming.length === 0) {
      setFilter({ type: 'all', key: 'all' });
    }
  }, [currentOrNext, filter, groups, upcoming]);

  if (!groups.length) {
    return <p className="text-sm text-ghost">No schedule plans yet.</p>;
  }

  const filterButtonClass = (active) => cx(
    'btn-ghost btn-sm shrink-0',
    active && 'border-edge bg-raised text-ink'
  );

  return (
    <div className="border-y border-edge bg-surface">
      <div className="flex gap-2 overflow-x-auto border-b border-edge px-4 py-2 scroll-area">
        <button className={filterButtonClass(filter.type === 'all')} onClick={() => setFilter({ type: 'all', key: 'all' })}>All</button>
        {currentOrNext?.plan ? (
          <button className={filterButtonClass(filter.type === 'focus')} onClick={() => setFilter({ type: 'focus', key: String(currentOrNext.plan.id) })}>
            {currentOrNext.label}
          </button>
        ) : null}
        {hasToday ? (
          <button className={filterButtonClass(filter.type === 'day' && filter.key === todayKey)} onClick={() => setFilter({ type: 'day', key: todayKey })}>Today</button>
        ) : null}
        {upcoming.length > 0 ? (
          <button className={filterButtonClass(filter.type === 'upcoming')} onClick={() => setFilter({ type: 'upcoming', key: 'upcoming' })}>Upcoming</button>
        ) : null}
        {groups.map((group) => (
          <button key={group.key} className={filterButtonClass(filter.type === 'day' && filter.key === group.key)} onClick={() => setFilter({ type: 'day', key: group.key })}>
            {group.label}
          </button>
        ))}
      </div>
      {visibleGroups.map((group) => (
        <div key={group.key} className="border-b border-edge last:border-b-0">
          <div className="border-b border-edge px-4 py-2 text-xs font-medium text-dim">
            {group.label}
          </div>
          <div className="divide-y divide-edge">
            {group.items.map((plan) => (
              <SchedulePlanRow
                key={plan.id}
                plan={plan}
                marker={currentOrNext?.plan?.id === plan.id ? currentOrNext.label : ''}
                draft={planDrafts[String(plan.id)] || {}}
                preview={changePreviews[`plan-${plan.id}`]}
                notification={scheduleNotifications[`plan-${plan.id}`]}
                notificationHistory={scheduleNotificationHistory[`plan-${plan.id}`] || []}
                conflicts={conflictMap.get(String(plan.id)) || []}
                saving={saving === `plan-${plan.id}`}
                previewSaving={saving === `preview-plan-${plan.id}`}
                draftSaving={saving === `draft-plan-${plan.id}`}
                sendSaving={saving === `send-plan-${plan.id}`}
                onDraftChange={(patch) => onDraftChange?.(plan.id, patch)}
                onUpdate={() => onUpdate?.(plan)}
                onPreviewChange={() => onPreviewChange?.(plan)}
                onDraftNotification={() => onNotifyChange?.(plan, 'draft')}
                onSendNotification={() => onNotifyChange?.(plan, 'sent')}
                onRemove={() => onRemove(plan)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ScheduleChangePreviewPanel({ preview }) {
  const summary = preview?.recipients?.summary || {};
  const attendees = Array.isArray(preview?.recipients?.attendees) ? preview.recipients.attendees : [];
  const groups = Array.isArray(preview?.recipients?.groups) ? preview.recipients.groups : [];
  const conflicts = Array.isArray(preview?.conflicts) ? preview.conflicts : [];
  const attendeeNames = attendees.map((attendee) => attendee.display_name).filter(Boolean).slice(0, 4).join(', ');
  const groupNames = groups.map((group) => group.name).filter(Boolean).slice(0, 3).join(', ');
  return (
    <div className="rounded-md border border-edge bg-raised px-3 py-2 text-sm" aria-label="Schedule change preview">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-ink">Share preview</p>
        <span className="text-xs text-ghost">Preview only</span>
      </div>
      <div className="mt-2 space-y-1 text-xs text-dim">
        <p>{summary.label || 'Private change; no recipients.'}</p>
        {attendeeNames ? <p>People: {attendeeNames}{attendees.length > 4 ? ` +${attendees.length - 4}` : ''}</p> : null}
        {groupNames ? <p>Groups: {groupNames}{groups.length > 3 ? ` +${groups.length - 3}` : ''}</p> : null}
        {conflicts.length ? <p className="text-warn">Conflicts: {conflicts.map((conflict) => conflict.title).filter(Boolean).slice(0, 2).join(', ')}{conflicts.length > 2 ? ` +${conflicts.length - 2}` : ''}</p> : null}
        <p className="text-ghost">No notification will be sent from this preview.</p>
      </div>
    </div>
  );
}

function ScheduleNotificationPanel({ notification }) {
  if (!notification) return null;
  const summary = notification?.recipients?.summary || {};
  const sent = notification.status === 'sent';
  return (
    <div className="rounded-md border border-edge bg-surface px-3 py-2 text-sm" aria-label="Schedule notification record">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-ink">{sent ? 'Local notification sent' : 'Draft saved'}</p>
        <span className="text-xs text-ghost">Event-local</span>
      </div>
      <p className="mt-2 text-xs text-dim">{summary.label || 'No recipients selected.'}</p>
      <p className="mt-1 text-xs text-ghost">Recorded in this event only. No push, device, or email delivery was used.</p>
    </div>
  );
}

function ScheduleNotificationHistory({ notifications = [] }) {
  const items = Array.isArray(notifications) ? notifications.slice(0, 3) : [];
  if (!items.length) return null;
  return (
    <div className="rounded-md border border-edge bg-surface px-3 py-2 text-sm" aria-label="Schedule notification history">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-ink">Notification history</p>
        <span className="text-xs text-ghost">Event-local</span>
      </div>
      <div className="mt-2 divide-y divide-edge">
        {items.map((item) => {
          const summary = item?.recipients?.summary || {};
          const when = item.status === 'sent' ? item.sent_at : item.created_at;
          return (
            <div key={item.id} className="py-2 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="capitalize text-dim">{item.status || 'draft'}</span>
                <span className="text-ghost">{when ? formatDateTime(when) : 'No timestamp'}</span>
              </div>
              <p className="mt-1 text-xs text-dim">{summary.label || 'No recipients selected.'}</p>
              {item.message_body ? <p className="mt-1 text-xs leading-5 text-ghost">{plainTextPreview(item.message_body, 180)}</p> : null}
            </div>
          );
        })}
      </div>
      <p className="mt-2 border-t border-edge pt-2 text-xs text-ghost">Local record only. No push, device, or email delivery.</p>
    </div>
  );
}

function EventScheduleNotificationInbox({ inbox = {}, saving = '', onUpdate }) {
  const items = Array.isArray(inbox.items) ? inbox.items : [];
  const counts = inbox.counts || { total: items.length, unread: 0, read: 0, acknowledged: 0 };
  if (!items.length) {
    return (
      <div className="px-4 pb-4">
        <div className="rounded-md border border-edge bg-raised px-3 py-3 text-sm text-dim">
          No local schedule notifications have recipients yet.
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3 px-4 pb-4" aria-label="Schedule notification inbox">
      <div className="flex flex-wrap items-center gap-3 text-xs text-ghost">
        <span>{counts.total || items.length} local recipient record{(counts.total || items.length) === 1 ? '' : 's'}</span>
        <span>{counts.unread || 0} unread</span>
        <span>{counts.acknowledged || 0} acknowledged</span>
        <span>{counts.mine || 0} linked to you</span>
      </div>
      <div className="divide-y divide-edge rounded-md border border-edge bg-raised">
        {items.slice(0, 8).map((item) => {
          const notification = item.notification || {};
          const recipient = item.recipient || {};
          const title = notification.message_title || notification.subject?.title || 'Schedule update';
          const savingKey = `notification-recipient-${item.id}`;
          const acknowledged = item.read_status === 'acknowledged';
          const read = item.read_status === 'read' || acknowledged;
          return (
            <div key={item.id} className="space-y-2 px-3 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-ink">{title}</p>
                  <p className="mt-1 text-xs text-dim">
                    {recipient.display_name || recipient.name || 'Recipient'} · {item.recipient_type}
                    {item.current_user_recipient ? ' · Linked to you' : ''}
                  </p>
                </div>
                <span className={cx('text-xs', acknowledged ? 'text-ok' : read ? 'text-dim' : 'text-warn')}>
                  {acknowledged ? 'Acknowledged' : read ? 'Read' : 'Unread'}
                </span>
              </div>
              {notification.message_body ? <p className="text-xs leading-5 text-ghost">{plainTextPreview(notification.message_body, 180)}</p> : null}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-ghost">
                  {notification.sent_at ? formatDateTime(notification.sent_at) : 'Local record'}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {!read ? (
                    <button className="btn-ghost btn-sm" disabled={saving === savingKey} onClick={() => onUpdate?.(item, 'read')}>
                      {saving === savingKey ? <Spinner size={14} /> : 'Mark read'}
                    </button>
                  ) : null}
                  {!acknowledged ? (
                    <button className="btn-secondary btn-sm" disabled={saving === savingKey} onClick={() => onUpdate?.(item, 'acknowledged')}>
                      {saving === savingKey ? <Spinner size={14} /> : 'Acknowledge'}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-ghost">Event-local readback only. This is not push, email, or device delivery.</p>
    </div>
  );
}

function SchedulePlanRow({
  plan,
  marker = '',
  draft = {},
  preview = null,
  notification = null,
  notificationHistory = [],
  conflicts = [],
  saving = false,
  previewSaving = false,
  draftSaving = false,
  sendSaving = false,
  onDraftChange,
  onUpdate,
  onPreviewChange,
  onDraftNotification,
  onSendNotification,
  onRemove
}) {
  const categories = Array.isArray(plan?.source_categories) ? plan.source_categories.filter(Boolean) : [];
  const notesPreview = plainTextPreview(plan?.notes, 700);
  const agendaTime = formatAgendaTime(plan?.start_at, plan?.end_at);
  const fromSched = plan?.source_type === 'sched_ics';
  const categorySummary = categories.slice(0, 2).join(' · ');
  const extraCategoryCount = Math.max(categories.length - 2, 0);
  const draftStatus = draft.status || plan?.status || 'planned';
  const draftVisibility = draft.visibility || plan?.visibility || 'private';
  const draftVendor = draft.vendor ?? plan?.vendor ?? '';
  const draftBooth = draft.booth ?? plan?.booth ?? '';
  const draftLocationNotes = draft.location_notes ?? plan?.location_notes ?? '';
  const draftNotes = draft.notes ?? plan?.notes ?? '';
  const conflictSummary = formatConflictSummary(conflicts);
  const previewRecipientCount = (preview?.recipients?.summary?.attendee_count || 0) + (preview?.recipients?.summary?.group_count || 0);
  const canSendNotification = Boolean(preview && draftVisibility !== 'private' && previewRecipientCount > 0);
  const sourceDetails = [
    scheduleSourceLabel(plan),
    plan?.source_updated_at ? `Updated ${formatDateTime(plan.source_updated_at)}` : '',
    plan?.source_sequence !== null && plan?.source_sequence !== undefined ? `Sequence ${plan.source_sequence}` : ''
  ].filter(Boolean).join(' · ');

  return (
    <details className={cx('group', eventVisibilityRowClass(plan?.visibility))}>
      <summary className="grid cursor-pointer list-none grid-cols-[4.75rem_1fr] gap-3 px-4 py-3 sm:grid-cols-[5.75rem_1fr]">
        <div className="text-xs font-medium leading-5 text-dim">
          <div className="whitespace-nowrap">{agendaTime.start}</div>
          {agendaTime.end ? <div className="whitespace-nowrap text-ghost">{agendaTime.end}</div> : null}
        </div>
        <div className="min-w-0">
	          <div className="flex min-w-0 items-baseline gap-2">
	            <p className="truncate text-sm font-medium text-ink">{plan.title}</p>
	            {marker ? <span className="shrink-0 text-xs text-dim">{marker}</span> : null}
	            {plan.status && plan.status !== 'planned' ? <span className="shrink-0 text-xs text-ghost">{plan.status}</span> : null}
	            {conflictSummary ? <span className="shrink-0 text-xs text-warn">Conflict</span> : null}
	            <EventVisibilityText value={plan.visibility} />
	          </div>
          <p className="mt-1 truncate text-xs text-dim">
            {[socialPlaceSummary(plan), categorySummary, extraCategoryCount ? `+${extraCategoryCount}` : '', fromSched ? 'Sched' : 'Manual'].filter(Boolean).join(' · ')}
          </p>
          {conflictSummary ? <p className="mt-1 truncate text-xs text-warn">{conflictSummary}</p> : null}
        </div>
      </summary>
      <div className="grid grid-cols-[4.75rem_1fr] gap-3 px-4 pb-3 sm:grid-cols-[5.75rem_1fr]">
        <div />
        <div className="space-y-3 border-t border-edge pt-3">
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
            {plan.location ? (
              <div className="min-w-0">
                <p className="text-xs text-ghost">Location</p>
                <p className="mt-1 leading-6 text-dim">{plan.location}</p>
              </div>
            ) : null}
            {vendorBoothLabel(plan) ? (
              <div className="min-w-0">
                <p className="text-xs text-ghost">Vendor / booth</p>
                <p className="mt-1 leading-6 text-dim">{vendorBoothLabel(plan)}</p>
              </div>
            ) : null}
            {plan.location_notes ? (
              <div className="min-w-0 sm:col-span-2">
                <p className="text-xs text-ghost">Location note</p>
                <p className="mt-1 leading-6 text-dim">{plan.location_notes}</p>
              </div>
            ) : null}
            {categories.length > 0 ? (
              <div className="min-w-0">
                <p className="text-xs text-ghost">Categories</p>
                <p className="mt-1 leading-6 text-dim">{categories.join(' · ')}</p>
              </div>
            ) : null}
            {sourceDetails ? (
              <div className="min-w-0">
                <p className="text-xs text-ghost">Source</p>
                <p className="mt-1 leading-6 text-dim">{sourceDetails}</p>
              </div>
            ) : null}
	            {plan.status ? (
	              <div className="min-w-0">
	                <p className="text-xs text-ghost">Status</p>
	                <p className="mt-1 capitalize leading-6 text-dim">{plan.status}</p>
	              </div>
	            ) : null}
	            {plan.visibility ? (
	              <div className="min-w-0">
	                <p className="text-xs text-ghost">Visibility</p>
	                <p className={cx('mt-1 leading-6', eventVisibilityTextClass(plan.visibility))}>{eventVisibilityLabel(plan.visibility)}</p>
	              </div>
	            ) : null}
	          </div>
          {notesPreview ? (
            <div>
              <p className="text-xs text-ghost">Notes</p>
              <p className="mt-1 text-sm leading-6 text-dim">{notesPreview}</p>
            </div>
          ) : null}
          {conflictSummary ? (
            <div className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn">
              {conflictSummary}
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-2 border-t border-edge pt-3 sm:grid-cols-[9rem_11rem_1fr_7rem]">
            <label className="field">
              <span className="label">Status</span>
              <select
                className="input"
                value={draftStatus}
                onChange={(event) => onDraftChange?.({ status: event.target.value })}
              >
                {SCHEDULE_PLAN_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="label">Visibility</span>
              <select
                className="input"
                value={draftVisibility}
                onChange={(event) => onDraftChange?.({ visibility: event.target.value })}
              >
                {SCHEDULE_PLAN_VISIBILITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="label">Vendor</span>
              <input
                className="input"
                placeholder="Vendor"
                value={draftVendor}
                onChange={(event) => onDraftChange?.({ vendor: event.target.value })}
              />
            </label>
            <label className="field">
              <span className="label">Booth</span>
              <input
                className="input"
                placeholder="Booth"
                value={draftBooth}
                onChange={(event) => onDraftChange?.({ booth: event.target.value })}
              />
            </label>
            <label className="field">
              <span className="label">Location note</span>
              <input
                className="input"
                placeholder="Location note"
                value={draftLocationNotes}
                onChange={(event) => onDraftChange?.({ location_notes: event.target.value })}
              />
            </label>
            <label className="field">
              <span className="label">Notes</span>
              <input
                className="input"
                placeholder="Plan note"
                value={draftNotes}
                onChange={(event) => onDraftChange?.({ notes: event.target.value })}
              />
            </label>
            <div className="flex items-end sm:col-span-4">
              <div className="flex w-full flex-wrap gap-2">
                <button className="btn-secondary btn-sm" disabled={saving} onClick={onUpdate}>
                  {saving ? <Spinner size={16} /> : 'Save'}
                </button>
                <button className="btn-ghost btn-sm" disabled={previewSaving} onClick={onPreviewChange}>
                  {previewSaving ? <Spinner size={16} /> : 'Preview share'}
                </button>
                <button className="btn-ghost btn-sm" disabled={!preview || draftSaving} onClick={onDraftNotification}>
                  {draftSaving ? <Spinner size={16} /> : 'Save draft'}
                </button>
                <button className="btn-secondary btn-sm" disabled={!canSendNotification || sendSaving} onClick={onSendNotification}>
                  {sendSaving ? <Spinner size={16} /> : 'Send local notice'}
                </button>
              </div>
            </div>
          </div>
          {preview ? <ScheduleChangePreviewPanel preview={preview} /> : null}
          <ScheduleNotificationPanel notification={notification} />
          <ScheduleNotificationHistory notifications={notificationHistory} />
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-edge pt-3">
            <div className="flex flex-wrap items-center gap-2">
              {plan.source_url ? (
                <a className="btn-ghost btn-sm" href={plan.source_url} target="_blank" rel="noreferrer">
                  <Icons.Link />
                  Open session
                </a>
              ) : null}
            </div>
            <button
              className="btn-ghost btn-sm text-ghost hover:bg-err/10 hover:text-err"
              onClick={onRemove}
              aria-label={`Remove ${plan.title || 'schedule plan'} from schedule`}
            >
              Remove from schedule
            </button>
          </div>
        </div>
      </div>
    </details>
  );
}

function EventDetailDrawer({ eventId, apiCall, onClose, onEdit, onDeleted, onSaved }) {
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const row = await apiCall('get', `/events/${eventId}`);
      if (row) setEvent(row);
    } finally {
      setLoading(false);
    }
  }, [apiCall, eventId]);

  useEffect(() => { load(); }, [load]);

  const deleteEvent = async () => {
    if (!window.confirm('Delete this event?')) return;
    await apiCall('delete', `/events/${eventId}`);
    onDeleted?.();
    onClose();
  };

  return (
    <DetailDrawerShell onClose={onClose} testId="event-detail-drawer">
        <DrawerBackdrop imagePath={event?.image_path} className="h-48" />
        <div className="px-4 pt-4 pb-3 border-b border-edge sm:px-6 sm:pt-6 sm:pb-4">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <h2 className="text-2xl font-semibold tracking-tight text-ink leading-tight">{event?.title || `Event #${eventId}`}</h2>
                <p className="text-sm text-ghost">#{eventId}</p>
              </div>
              <p className="text-sm text-dim mt-1">{toDisplayDate(event?.date_start)}{event?.location ? ` · ${event.location}` : ''}</p>
            </div>
            <button onClick={onClose} className="btn-icon btn-sm shrink-0"><Icons.X /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto scroll-area p-4 space-y-4 sm:p-6 sm:space-y-5">
          {loading && <div className="flex items-center gap-2 text-dim"><Spinner size={16} />Loading…</div>}
          {!loading && (
            <>
              <div className="grid grid-cols-1 gap-x-8 gap-y-5 text-sm md:grid-cols-2">
                <DetailField label="Start Date">{toDisplayDate(event?.date_start) || 'Date pending'}</DetailField>
                <DetailField label="End Date">{event?.date_end ? toDisplayDate(event.date_end) : 'Single day event'}</DetailField>
                <DetailField label="Location">{event?.location}</DetailField>
                <DetailField label="Room">{event?.room}</DetailField>
                <DetailField label="Time">{event?.time_label}</DetailField>
                <DetailField label="Host">{event?.host}</DetailField>
                {event?.image_path ? (
                  <DetailField label="Image">
                    <a
                      className="inline-flex items-center gap-2 text-dim transition-colors hover:text-ink"
                      href={event.image_path}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Icons.Link />
                      Open image
                    </a>
                  </DetailField>
                ) : null}
                {event?.url ? (
                  <DetailField label="Event site">
                    <a
                      className="inline-flex items-center gap-2 text-dim transition-colors hover:text-ink"
                      href={event.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Icons.Link />
                      Open event site
                    </a>
                  </DetailField>
                ) : null}
              </div>
              {event?.notes ? (
                <DetailField label="Notes">
                  <p className="max-w-3xl text-dim leading-7">{event.notes}</p>
                </DetailField>
              ) : null}
              <EventSocialPlanningPanel eventId={eventId} apiCall={apiCall} onChanged={onSaved} />
              <EventPurchasedItemsReadback eventId={eventId} apiCall={apiCall} />
              <EventArtifactsEditor eventId={eventId} apiCall={apiCall} onSaved={onSaved} />
            </>
          )}
        </div>
        <div className="p-4 border-t border-edge flex gap-3 shrink-0">
          <button onClick={onClose} className="btn-ghost">Close</button>
          <button onClick={() => onEdit(event)} className="btn-ghost flex-1"><Icons.Edit />Edit</button>
          <button onClick={deleteEvent} className="btn-ghost text-err hover:bg-err/10"><Icons.Trash />Delete</button>
        </div>
    </DetailDrawerShell>
  );
}

export default function EventsView({ apiCall, onToast }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [sortDir, setSortDir] = useState('asc');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [viewMode, setViewMode] = useState('cards');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [detailId, setDetailId] = useState(null);

  const supportsHover = useMemo(() => window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches, []);
  const activeFilterCount = useMemo(() => [search.trim(), fromDate, toDate].filter(Boolean).length, [fromDate, search, toDate]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(pageSize));
      if (search.trim()) params.set('q', search.trim());
      params.set('sort_dir', sortDir);
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
      const payload = await apiCall('get', `/events?${params.toString()}`);
      setItems(Array.isArray(payload?.items) ? payload.items : []);
      setPagination(payload?.pagination || { page, limit: pageSize, total: 0, totalPages: 1, hasMore: false });
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load events');
    } finally {
      setLoading(false);
    }
  }, [apiCall, fromDate, page, pageSize, search, sortDir, toDate]);

  useEffect(() => { load(); }, [load]);

  const saveEvent = async (payload, imageFile) => {
    if (editing?.id) {
      await apiCall('patch', `/events/${editing.id}`, payload);
      if (imageFile) {
        const formData = new FormData();
        formData.append('image', imageFile);
        await apiCall('post', `/events/${editing.id}/upload-image`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
      }
      onToast?.('Event saved');
    } else {
      const created = await apiCall('post', '/events', payload);
      if (imageFile && created?.id) {
        const formData = new FormData();
        formData.append('image', imageFile);
        await apiCall('post', `/events/${created.id}/upload-image`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
      }
      onToast?.('Event created');
    }
    setAdding(false);
    setEditing(null);
    await load();
  };

  const clearEventImage = async () => {
    if (!editing?.id) return;
    await apiCall('delete', `/events/${editing.id}/image`);
    onToast?.('Event image removed');
    const refreshed = await apiCall('get', `/events/${editing.id}`);
    setEditing(refreshed);
    await load();
  };

  const deleteEvent = async (id) => {
    if (!window.confirm('Delete this event?')) return;
    await apiCall('delete', `/events/${id}`);
    onToast?.('Event deleted');
    await load();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-edge shrink-0">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="section-title">Events</h1>
              <span className="badge badge-dim">{pagination.total || items.length}</span>
              {activeFilterCount > 0 ? <MetaPill tone="brand">{`${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'} active`}</MetaPill> : null}
            </div>
            <p className="mt-1 text-sm text-ghost">Track conventions, screenings, meetups, and the artifacts you picked up along the way.</p>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ghost pointer-events-none"><Icons.Search /></span>
            <input className="input pl-9 w-56" placeholder="Search title or location…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <input
            type="date"
            className="input w-40"
            value={fromDate}
            onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
            title="From date"
          />
          <input
            type="date"
            className="input w-40"
            value={toDate}
            onChange={(e) => { setToDate(e.target.value); setPage(1); }}
            title="To date"
          />
          <SectionTabs
            tabs={[
              {
                id: 'cards',
                label: (
                  <>
                    <span aria-hidden="true"><Icons.Film /></span>
                    <span className="sr-only">Cards</span>
                  </>
                )
              },
              {
                id: 'list',
                label: (
                  <>
                    <span aria-hidden="true"><Icons.List /></span>
                    <span className="sr-only">List</span>
                  </>
                )
              }
            ]}
            activeId={viewMode}
            onChange={setViewMode}
            semantics="buttons"
            showDivider={false}
            ariaLabel="Event view mode"
            listClassName="gap-2"
            buttonClassName="px-2"
          />
          <button
            onClick={() => { setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); setPage(1); }}
            className="btn-icon"
            title={sortDir === 'asc' ? 'Sort ascending' : 'Sort descending'}
          >
            {sortDir === 'asc' ? <Icons.ArrowUp /> : <Icons.ArrowDown />}
          </button>
          <button onClick={() => setAdding(true)} className="btn-primary"><Icons.Plus />Add</button>
          </div>
        </div>
        {activeFilterCount > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {search.trim() ? <MetaPill>{`Search: ${search.trim()}`}</MetaPill> : null}
            {fromDate ? <MetaPill>{`From ${toDisplayDate(fromDate)}`}</MetaPill> : null}
            {toDate ? <MetaPill>{`To ${toDisplayDate(toDate)}`}</MetaPill> : null}
            <button className="btn-ghost btn-sm" onClick={() => { setSearch(''); setFromDate(''); setToDate(''); setPage(1); }}>Clear filters</button>
          </div>
        ) : null}
      </div>
      <div className="flex-1 overflow-y-auto scroll-area p-6">
        {error && <p className="text-sm text-err mb-4">{error}</p>}
        {loading && <div className="flex items-center justify-center py-20"><Spinner size={32} /></div>}
        {!loading && items.length === 0 && (
          <div className="rounded-2xl border border-dashed border-edge bg-surface px-5 py-8 text-sm text-ghost">
            No events found. Start with a convention, screening, meetup, or release event so related artifacts have a home.
          </div>
        )}
        {!loading && viewMode === 'cards' && items.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {items.map((item) => (
              <EventCard
                key={item.id}
                item={item}
                supportsHover={supportsHover}
                onOpen={() => setDetailId(item.id)}
                onEdit={() => setEditing(item)}
                onDelete={deleteEvent}
              />
            ))}
          </div>
        )}
        {!loading && viewMode === 'list' && items.length > 0 && (
          <div className="space-y-2">
            {items.map((item) => (
              <EventListRow
                key={item.id}
                item={item}
                supportsHover={supportsHover}
                onOpen={() => setDetailId(item.id)}
                onEdit={() => setEditing(item)}
                onDelete={deleteEvent}
              />
            ))}
          </div>
        )}
      </div>
      <CollectionPaginationFooter
        page={page}
        totalPages={pagination.totalPages || 1}
        hasMore={pagination.hasMore}
        loading={loading}
        pageSize={pageSize}
        pageSizeOptions={[25, 50, 100]}
        onPrevious={() => setPage((p) => Math.max(1, p - 1))}
        onNext={() => setPage((p) => p + 1)}
        onPageSizeChange={(value) => { setPageSize(value); setPage(1); }}
      />
      {(adding || editing) && (
        <EventFormDrawer
          initial={editing}
          apiCall={apiCall}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSave={saveEvent}
          onDelete={editing?.id ? async () => { await deleteEvent(editing.id); setEditing(null); } : null}
          onClearImage={clearEventImage}
        />
      )}
      {detailId && (
        <EventDetailDrawer
          eventId={detailId}
          apiCall={apiCall}
          onClose={() => setDetailId(null)}
          onEdit={(item) => { setDetailId(null); setEditing(item); }}
          onDeleted={load}
          onSaved={load}
        />
      )}
    </div>
  );
}
