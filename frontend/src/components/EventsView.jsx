import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CollectionPaginationFooter, CoverImagePicker, DetailDrawerShell, DrawerBackdrop, Icons, ImageSourceControl, Spinner, SectionTabPanel, SectionTabs, cx, posterUrl, ObjectPosterCard } from './app/AppPrimitives';

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
  groupName: '',
  meetupTitle: '',
  meetupLocation: '',
  meetupStart: '',
  meetupGroupId: '',
  planTitle: '',
  planLocation: '',
  planStart: '',
  icsUrl: ''
};

const MEETUP_STATUS_OPTIONS = [
  { value: 'planned', label: 'Planned' },
  { value: 'tentative', label: 'Tentative' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'done', label: 'Done' }
];

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

const scheduleSourceLabel = (plan) => {
  if (plan?.source_type === 'sched_ics') return 'Sched';
  if (plan?.source_type) return String(plan.source_type).replace(/_/g, ' ');
  return 'Manual';
};

const humanizeEventValue = (value) => {
  const text = String(value || '').replace(/_/g, ' ').trim();
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
};

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
                {[formatDateTime(focusPlan.plan.start_at), compactLocation(focusPlan.plan.location), humanizeEventValue(focusPlan.plan.visibility)].filter(Boolean).join(' · ')}
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
                {[formatDateTime(nextMeetup.start_at), nextMeetup.location, nextMeetup.group_name, humanizeEventValue(nextMeetup.visibility)].filter(Boolean).join(' · ')}
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
  const [icsSource, setIcsSource] = useState(null);
  const [meetupDrafts, setMeetupDrafts] = useState({});
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

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [attendeePayload, groupPayload, meetupPayload, planPayload, icsPayload] = await Promise.all([
        apiCall('get', `/events/${eventId}/attendees`),
        apiCall('get', `/events/${eventId}/groups`),
        apiCall('get', `/events/${eventId}/meetups`),
        apiCall('get', `/events/${eventId}/schedule-plans`),
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
            notes: prev[id]?.notes ?? meetup.notes ?? ''
          };
        });
        return next;
      });
      setPlans(Array.isArray(planPayload?.items) ? planPayload.items : []);
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
          status: 'attending',
          visibility: 'private'
        });
        set({ attendeeName: '', attendeeRelationship: '' });
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
          start_at: fromDateTimeInput(form.meetupStart),
          group_id: form.meetupGroupId ? Number(form.meetupGroupId) : null,
          status: 'planned',
          visibility: form.meetupGroupId ? 'group' : 'private'
        });
        set({ meetupTitle: '', meetupLocation: '', meetupStart: '', meetupGroupId: '' });
        setNotice('Meetup added');
      }
      if (kind === 'plan') {
        await apiCall('post', `/events/${eventId}/schedule-plans`, {
          title: form.planTitle.trim(),
          location: form.planLocation || null,
          start_at: fromDateTimeInput(form.planStart),
          source_type: 'manual',
          status: 'planned',
          visibility: 'private'
        });
        set({ planTitle: '', planLocation: '', planStart: '' });
        setNotice('Schedule plan added');
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
              {pluralizePeople(attendees.length)} · {groups.length} group{groups.length === 1 ? '' : 's'} · {meetups.length} meetup{meetups.length === 1 ? '' : 's'} · {plans.length} plan{plans.length === 1 ? '' : 's'}
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
        <details className="group" open>
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-ink">
            Schedule
            <span className="text-xs text-ghost">{plans.length}</span>
          </summary>
          <div className="space-y-3 pb-4">
            <EventScheduleAgenda
              plans={plans}
              onRemove={(plan) => archive(`/events/${eventId}/schedule-plans/${plan.id}`, 'Schedule plan')}
            />
            <details className="mx-4 rounded-md border border-edge bg-raised">
              <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium text-ink">
                Add manual plan
              </summary>
              <div className="grid grid-cols-1 gap-2 border-t border-edge px-3 py-3 sm:grid-cols-2">
                <input className="input" placeholder="Plan title" value={form.planTitle} onChange={(e) => set({ planTitle: e.target.value })} />
                <input className="input" placeholder="Location" value={form.planLocation} onChange={(e) => set({ planLocation: e.target.value })} />
                <input type="datetime-local" className="input sm:col-span-2" value={form.planStart} onChange={(e) => set({ planStart: e.target.value })} />
                <button className="btn-secondary sm:col-span-2" disabled={!form.planTitle.trim() || saving === 'plan'} onClick={() => save('plan')}>{saving === 'plan' ? <Spinner size={16} /> : 'Add plan'}</button>
              </div>
            </details>
          </div>
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
                  <div key={person.id} className="flex items-center gap-3 rounded-md border border-edge bg-raised px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink">{person.display_name}</p>
                      <p className="truncate text-xs text-dim">{[person.relationship, person.status, person.visibility].filter(Boolean).join(' · ')}</p>
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
                  <div key={group.id} className="flex items-center gap-3 rounded-md border border-edge bg-raised px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink">{group.name}</p>
                      <p className="truncate text-xs text-dim">{pluralizePeople(group.members?.length || 0)} · {group.visibility}</p>
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
                  <details key={meetup.id} className="rounded-md border border-edge bg-raised">
                    <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-ink">{meetup.title}</p>
                        <p className="truncate text-xs text-dim">{[formatDateTime(meetup.start_at), meetup.location, meetup.group_name, humanizeEventValue(meetup.status)].filter(Boolean).join(' · ')}</p>
                      </div>
                      <span className="text-xs text-ghost">Edit</span>
                    </summary>
                    <div className="space-y-2 border-t border-edge px-3 py-3">
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[10rem_1fr_auto]">
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
                          <span className="label">Notes</span>
                          <input
                            className="input"
                            placeholder="Quick note"
                            value={meetupDrafts[String(meetup.id)]?.notes ?? meetup.notes ?? ''}
                            onChange={(e) => setMeetupDraft(meetup.id, { notes: e.target.value })}
                          />
                        </label>
                        <div className="flex items-end gap-2">
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
              <input type="datetime-local" className="input" value={form.meetupStart} onChange={(e) => set({ meetupStart: e.target.value })} />
              <select className="input" value={form.meetupGroupId} onChange={(e) => set({ meetupGroupId: e.target.value })}>
                <option value="">No group</option>
                {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
              <button className="btn-secondary sm:col-span-2" disabled={!form.meetupTitle.trim() || saving === 'meetup'} onClick={() => save('meetup')}>{saving === 'meetup' ? <Spinner size={16} /> : 'Add meetup'}</button>
            </div>
          </div>
        </details>

      </div>
    </section>
  );
}

function EventScheduleAgenda({ plans, onRemove }) {
  const [filter, setFilter] = useState({ type: 'all', key: 'all' });

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
                onRemove={() => onRemove(plan)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SchedulePlanRow({ plan, marker = '', onRemove }) {
  const categories = Array.isArray(plan?.source_categories) ? plan.source_categories.filter(Boolean) : [];
  const notesPreview = plainTextPreview(plan?.notes, 700);
  const agendaTime = formatAgendaTime(plan?.start_at, plan?.end_at);
  const fromSched = plan?.source_type === 'sched_ics';
  const categorySummary = categories.slice(0, 2).join(' · ');
  const extraCategoryCount = Math.max(categories.length - 2, 0);
  const location = compactLocation(plan?.location);
  const sourceDetails = [
    scheduleSourceLabel(plan),
    plan?.source_updated_at ? `Updated ${formatDateTime(plan.source_updated_at)}` : '',
    plan?.source_sequence !== null && plan?.source_sequence !== undefined ? `Sequence ${plan.source_sequence}` : ''
  ].filter(Boolean).join(' · ');

  return (
    <details className="group">
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
          </div>
          <p className="mt-1 truncate text-xs text-dim">
            {[location, categorySummary, extraCategoryCount ? `+${extraCategoryCount}` : '', fromSched ? 'Sched' : 'Manual'].filter(Boolean).join(' · ')}
          </p>
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
          </div>
          {notesPreview ? (
            <div>
              <p className="text-xs text-ghost">Notes</p>
              <p className="mt-1 text-sm leading-6 text-dim">{notesPreview}</p>
            </div>
          ) : null}
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
