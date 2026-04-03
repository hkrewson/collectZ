import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import appMeta from '../app-meta.json';

const HELP_ARTICLES = [
  {
    id: 'barcode',
    title: 'Barcode lookup tips',
    summary: 'Use UPC or ISBN lookup when a physical release has packaging metadata you want to pull in quickly.',
    bullets: [
      'Books work best when you scan or enter the ISBN barcode from the back cover.',
      'Movies, TV, games, audio, and comics can all use the shared barcode field now.',
      'If a barcode match looks odd, save the code and release type so support can investigate provider quality.'
    ]
  },
  {
    id: 'images',
    title: 'Cover and image attachment',
    summary: 'Attach poster, cover, event, or collectible images directly without relying on image recognition.',
    bullets: [
      'Manual cover attachment is still supported in the add/edit workflow.',
      'Events and collectibles now support first-class image capture and upload.',
      'On iOS local dev, photo upload may be more reliable than live camera APIs over plain HTTP.'
    ]
  },
  {
    id: 'spaces',
    title: 'Spaces and support boundaries',
    summary: 'Support requests do not automatically grant tenant access. They create a documented thread first.',
    bullets: [
      'Use the help form when self-serve guidance is not enough.',
      'Support staff can reply through the support surface without opening a tenant session.',
      'Support access approval is explicit and stays tied to the support request rather than becoming ambient tenant access.'
    ]
  }
];

const SUPPORT_ADMIN_ARTICLE = {
  id: 'support-admin',
  title: 'Support role guidance',
  summary: 'Support admins work in the help surface first, then later through approved support sessions when consent features arrive.',
  bullets: [
    'Start by classifying requests clearly: support, bug, or feature request.',
    'Use internal notes for staff-only context that should not appear in the member conversation.',
    'Mark tracked requests as shipped with a version so the requester sees a clear product update in-thread.'
  ]
};

const CLASSIFICATION_OPTIONS = [
  { value: 'support', label: 'Support' },
  { value: 'bug', label: 'Bug' },
  { value: 'feature_request', label: 'Feature Request' }
];

const TRACKING_STATUS_OPTIONS = [
  { value: 'untracked', label: 'Untracked' },
  { value: 'investigating', label: 'Investigating' },
  { value: 'planned', label: 'Planned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'declined', label: 'Declined' }
];

function formatTimestamp(value) {
  if (!value) return 'Unknown';
  try {
    return new Date(value).toLocaleString();
  } catch (_) {
    return String(value);
  }
}

function formatDurationCompact(totalSeconds) {
  const seconds = Number(totalSeconds || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Not enough data';
  const rounded = Math.round(seconds);
  const days = Math.floor(rounded / 86400);
  const hours = Math.floor((rounded % 86400) / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${rounded}s`;
}

function classificationLabel(value) {
  return CLASSIFICATION_OPTIONS.find((option) => option.value === value)?.label || 'Support';
}

function trackingStatusLabel(value) {
  return TRACKING_STATUS_OPTIONS.find((option) => option.value === value)?.label || 'Untracked';
}

function supportAccessDetailText(request) {
  if (!request?.target_space_id) return null;
  if (request.support_access_status === 'approved' && request.support_access_expires_at) {
    return `Expires ${formatTimestamp(request.support_access_expires_at)}`;
  }
  if (request.support_access_status === 'expired' && request.support_access_expires_at) {
    return `Support access expired · Expired ${formatTimestamp(request.support_access_expires_at)}`;
  }
  if (request.support_access_status === 'revoked') {
    return 'Requester must approve again before tenant support can start.';
  }
  return null;
}

function sessionEvidenceRows(session, selectedRequest) {
  if (!session?.active || !selectedRequest || Number(session.request_id) !== Number(selectedRequest.id)) return [];
  const rows = [];
  if (session.request_key) rows.push({ label: 'Request', value: session.request_key });
  if (session.request_subject) rows.push({ label: 'Case', value: session.request_subject });
  if (session.requester_name || session.requester_email) {
    rows.push({ label: 'Requester', value: session.requester_name || session.requester_email });
  }
  if (session.space_name) rows.push({ label: 'Space', value: session.space_name });
  if (session.library_name) rows.push({ label: 'Library', value: session.library_name });
  if (session.started_at) rows.push({ label: 'Started', value: formatTimestamp(session.started_at) });
  if (session.reason) rows.push({ label: 'Reason', value: session.reason });
  return rows;
}

function actorLabel(message) {
  if (message?.is_internal) return 'Internal note';
  if (message?.author_role === 'system') return 'System';
  if (message?.author_name) return message.author_name;
  if (message?.author_email) return message.author_email;
  if (message?.author_role === 'support_admin') return 'Support';
  if (message?.author_role === 'admin') return 'Admin';
  return 'You';
}

function ThreadBubble({ message, currentUserId }) {
  const isOwnMessage = Number(message?.author_user_id) === Number(currentUserId);
  const isSystemMessage = message?.author_role === 'system';
  const isInternalMessage = Boolean(message?.is_internal);
  return (
    <div className={`flex ${isSystemMessage || isInternalMessage ? 'justify-center' : isOwnMessage ? 'justify-end' : 'justify-start'}`}>
      <div
        className={[
          'max-w-[84%] rounded-2xl border px-3.5 py-2.5 space-y-1.5',
          isInternalMessage
            ? 'border-sky-500/20 bg-sky-500/6 text-ink'
            : isSystemMessage
            ? 'border-edge/70 bg-void/20 text-ghost'
            : isOwnMessage
              ? 'border-gold/25 bg-raised/28 text-ink rounded-br-lg'
              : 'border-edge/70 bg-raised/24 text-ink rounded-bl-lg'
        ].join(' ')}
      >
        <div className="flex items-center justify-between gap-3 text-[11px] text-ghost">
          <span className="flex items-center gap-2">
            <span className="uppercase tracking-[0.14em]">{actorLabel(message)}</span>
            {message?.request_key ? <span className="badge badge-dim text-[10px] normal-case tracking-normal">{message.request_key}</span> : null}
          </span>
          <span className="normal-case tracking-normal text-[12px]">{formatTimestamp(message.created_at)}</span>
        </div>
        <p className="text-sm leading-5 whitespace-pre-wrap">{message.body}</p>
      </div>
    </div>
  );
}

function TimelineItem({ event }) {
  return (
    <div className="rounded-2xl border border-edge/60 bg-void/12 px-3.5 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-[0.14em] text-ghost">
            {event?.category === 'session' ? 'Session' : event?.is_internal ? 'Internal' : 'Request'}
          </span>
          {event?.request_key ? <span className="badge badge-dim text-[10px] normal-case tracking-normal">{event.request_key}</span> : null}
          <p className="text-sm font-medium text-ink">{event?.title || 'Support event'}</p>
        </div>
        <p className="text-xs text-ghost">{formatTimestamp(event?.created_at)}</p>
      </div>
      <p className="mt-1.5 text-[11px] uppercase tracking-[0.16em] text-ghost">{event?.actor_name || 'System'}</p>
      {event?.body ? <p className="mt-1.5 text-sm text-ghost leading-5 whitespace-pre-wrap">{event.body}</p> : null}
    </div>
  );
}

export default function HelpView({
  apiCall,
  onToast,
  user,
  activeSpace,
  activeLibrary,
  supportSession,
  onStartSupportSession,
  onEndSupportSession,
  Spinner,
  Icons,
  supportSummary,
  onSupportSummaryRefresh,
  initialTab = 'guidance'
}) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequestId, setSelectedRequestId] = useState(null);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [messages, setMessages] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [threadViewTab, setThreadViewTab] = useState('conversation');
  const [detailLoading, setDetailLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [replying, setReplying] = useState(false);
  const [closing, setClosing] = useState(false);
  const [releases, setReleases] = useState([]);
  const [releaseLoading, setReleaseLoading] = useState(true);
  const [expandedReleaseVersion, setExpandedReleaseVersion] = useState(null);
  const [form, setForm] = useState({ subject: '', message: '' });
  const [replyBody, setReplyBody] = useState('');
  const [triageForm, setTriageForm] = useState({
    classification: 'support',
    tracking_status: 'untracked',
    repo_issue_number: '',
    repo_issue_url: '',
    resolved_in_version: ''
  });
  const [internalNoteDraft, setInternalNoteDraft] = useState('');
  const [triageSaving, setTriageSaving] = useState(false);
  const [accessSaving, setAccessSaving] = useState(false);
  const [staffQueueFilter, setStaffQueueFilter] = useState('active');
  const [staffClassificationFilter, setStaffClassificationFilter] = useState('all');
  const [staffSearchInput, setStaffSearchInput] = useState('');
  const [staffSearchQuery, setStaffSearchQuery] = useState('');
  const threadEndRef = useRef(null);
  const triageRequestIdRef = useRef(null);
  const isSupportStaff = ['admin', 'support_admin'].includes(String(user?.role || ''));
  const requestStatusTone = useMemo(() => ({
    open: 'badge-warn',
    answered: 'badge-ok',
    closed: 'badge-dim'
  }), []);
  const releaseMeta = useMemo(() => ({
    version: appMeta?.version || null,
    build: appMeta?.build || null
  }), []);
  const guidanceArticles = useMemo(
    () => (isSupportStaff ? [...HELP_ARTICLES, SUPPORT_ADMIN_ARTICLE] : HELP_ARTICLES),
    [isSupportStaff]
  );
  const helpTabs = useMemo(
    () => [
      { id: 'guidance', label: 'Guidance' },
      { id: 'releases', label: 'Releases' },
      ...(isSupportStaff ? [{ id: 'metrics', label: 'Metrics' }] : []),
      { id: 'support', label: 'Support' }
    ],
    [isSupportStaff]
  );

  const formatRequestContext = useCallback((request) => {
    if (!request) return null;
    const parts = [];
    if (request.target_space_name || request.target_space_id) {
      parts.push(request.target_space_name || `Space #${request.target_space_id}`);
    }
    if (request.target_library_name || request.target_library_id) {
      parts.push(request.target_library_name || `Library #${request.target_library_id}`);
    }
    return parts.length ? parts.join(' / ') : null;
  }, []);

  useEffect(() => {
    if (!isSupportStaff) return undefined;
    const timeoutId = window.setTimeout(() => {
      setStaffSearchQuery(staffSearchInput.trim());
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [isSupportStaff, staffSearchInput]);

  const loadRequests = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams();
      if (isSupportStaff) {
        if (staffQueueFilter && staffQueueFilter !== 'all') params.set('queue', staffQueueFilter);
        if (staffClassificationFilter && staffClassificationFilter !== 'all') params.set('classification', staffClassificationFilter);
        if (staffSearchQuery) params.set('q', staffSearchQuery);
      }
      const payload = await apiCall('get', `/support/requests${params.toString() ? `?${params.toString()}` : ''}`);
      const nextRequests = Array.isArray(payload?.requests) ? payload.requests : [];
      setRequests(nextRequests);
      setSelectedRequestId((prev) => {
        const selected = nextRequests.some((item) => Number(item.id) === Number(prev)) ? prev : null;
        if (selected) return selected;
        const firstOpen = nextRequests.find((item) => item.status !== 'closed');
        return firstOpen?.id || nextRequests[0]?.id || null;
      });
    } catch (error) {
      if (!silent) {
        onToast(error.response?.data?.error || 'Failed to load help requests', 'error');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [apiCall, isSupportStaff, onToast, staffClassificationFilter, staffQueueFilter, staffSearchQuery]);

  const loadRequestDetail = useCallback(async (requestId, { silent = false } = {}) => {
    if (!requestId) {
      setSelectedRequest(null);
      setMessages([]);
      setTimeline([]);
      return;
    }
    if (!silent) setDetailLoading(true);
    try {
      const payload = await apiCall('get', `/support/requests/${requestId}`);
      setSelectedRequest(payload?.request || null);
      setMessages(Array.isArray(payload?.messages) ? payload.messages : []);
      setTimeline(Array.isArray(payload?.timeline) ? payload.timeline : []);
    } catch (error) {
      if (!silent) {
        onToast(error.response?.data?.error || 'Failed to load help thread', 'error');
      }
    } finally {
      if (!silent) setDetailLoading(false);
    }
  }, [apiCall, onToast]);

  const loadReleases = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setReleaseLoading(true);
    try {
      const payload = await apiCall('get', '/support/releases');
      const nextReleases = Array.isArray(payload?.releases) ? payload.releases : [];
      setReleases(nextReleases);
      setExpandedReleaseVersion((prev) => (nextReleases.some((release) => release.version === prev) ? prev : null));
    } catch (error) {
      if (!silent) {
        onToast(error.response?.data?.error || 'Failed to load release notes', 'error');
      }
    } finally {
      if (!silent) setReleaseLoading(false);
    }
  }, [apiCall, onToast]);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (helpTabs.some((tab) => tab.id === activeTab)) return;
    setActiveTab('guidance');
  }, [activeTab, helpTabs]);

  useEffect(() => {
    loadRequests();
    loadReleases();
  }, [loadRequests, loadReleases]);

  useEffect(() => {
    if (!selectedRequestId) {
      setSelectedRequest(null);
      setMessages([]);
      setTimeline([]);
      return;
    }
    loadRequestDetail(selectedRequestId);
  }, [loadRequestDetail, selectedRequestId]);

  useEffect(() => {
    if (activeTab !== 'support') return undefined;
    const intervalId = window.setInterval(() => {
      loadRequests({ silent: true });
      if (selectedRequestId) {
        loadRequestDetail(selectedRequestId, { silent: true });
      }
      onSupportSummaryRefresh?.({ silent: true });
    }, 15000);
    return () => window.clearInterval(intervalId);
  }, [activeTab, loadRequestDetail, loadRequests, onSupportSummaryRefresh, selectedRequestId]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView?.({ block: 'end', behavior: 'smooth' });
  }, [messages.length, selectedRequestId]);

  useEffect(() => {
    const nextRequestId = Number(selectedRequest?.id || 0) || null;
    if (triageRequestIdRef.current === nextRequestId) return;
    triageRequestIdRef.current = nextRequestId;
    setThreadViewTab(isSupportStaff ? 'reply' : 'conversation');
    setTriageForm({
      classification: selectedRequest?.classification || 'support',
      tracking_status: selectedRequest?.tracking_status || 'untracked',
      repo_issue_number: selectedRequest?.repo_issue_number ? String(selectedRequest.repo_issue_number) : '',
      repo_issue_url: selectedRequest?.repo_issue_url || '',
      resolved_in_version: selectedRequest?.resolved_in_version || ''
    });
    setInternalNoteDraft('');
  }, [isSupportStaff, selectedRequest?.id, selectedRequest?.status, selectedRequest?.classification, selectedRequest?.tracking_status, selectedRequest?.repo_issue_number, selectedRequest?.repo_issue_url, selectedRequest?.resolved_in_version]);

  const submitRequest = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      const payload = await apiCall('post', '/support/requests', {
        subject: form.subject,
        message: form.message,
        target_space_id: activeSpace?.id || null,
        target_library_id: activeLibrary?.id || null
      });
      const createdRequest = payload?.request
        ? {
            ...payload.request,
            target_space_name: payload.request.target_space_name || activeSpace?.name || null,
            target_library_name: payload.request.target_library_name || activeLibrary?.name || null
          }
        : null;
      const createdMessage = payload?.message;
      setForm({ subject: '', message: '' });
      setActiveTab('support');
      if (createdRequest) {
        setRequests((prev) => [createdRequest, ...prev.filter((item) => Number(item.id) !== Number(createdRequest.id))]);
        setSelectedRequestId(createdRequest.id);
        setSelectedRequest(createdRequest);
      } else {
        await loadRequests();
      }
      if (createdMessage) {
        setMessages([createdMessage]);
      }
      setTimeline([]);
      onSupportSummaryRefresh?.({ silent: true });
      onToast('Help request submitted');
    } catch (error) {
      onToast(error.response?.data?.error || 'Failed to submit help request', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const submitReply = async (event) => {
    event.preventDefault();
    if (!selectedRequestId || !replyBody.trim()) return;
    setReplying(true);
    try {
      const payload = await apiCall('post', `/support/requests/${selectedRequestId}/messages`, { body: replyBody });
      const updatedRequest = payload?.request;
      const newMessage = payload?.message;
      setReplyBody('');
      if (updatedRequest) {
        setRequests((prev) => prev.map((item) => (Number(item.id) === Number(updatedRequest.id) ? updatedRequest : item)));
        setSelectedRequest(updatedRequest);
      }
      if (newMessage) {
        setMessages((prev) => [...prev, newMessage]);
      } else {
        await loadRequestDetail(selectedRequestId, { silent: true });
      }
      await loadRequests({ silent: true });
      onSupportSummaryRefresh?.({ silent: true });
      onToast(isSupportStaff ? 'Reply sent' : 'Reply sent to support');
    } catch (error) {
      onToast(error.response?.data?.error || 'Failed to send reply', 'error');
    } finally {
      setReplying(false);
    }
  };

  const updateRequestStatus = async (nextStatus) => {
    if (!selectedRequestId) return;
    setClosing(true);
    try {
      const payload = await apiCall('patch', `/support/requests/${selectedRequestId}/status`, { status: nextStatus });
      const updatedRequest = payload?.request;
      const systemMessage = payload?.message;
      if (updatedRequest) {
        setRequests((prev) => prev.map((item) => (Number(item.id) === Number(updatedRequest.id) ? updatedRequest : item)));
        setSelectedRequest(updatedRequest);
      }
      if (systemMessage) {
        setMessages((prev) => [...prev, systemMessage]);
      }
      await loadRequests({ silent: true });
      await loadRequestDetail(selectedRequestId, { silent: true });
      onSupportSummaryRefresh?.({ silent: true });
      onToast(nextStatus === 'closed' ? 'Help request closed' : 'Help request reopened');
    } catch (error) {
      onToast(error.response?.data?.error || `Failed to ${nextStatus === 'closed' ? 'close' : 'reopen'} help request`, 'error');
    } finally {
      setClosing(false);
    }
  };

  const saveTriage = async (event) => {
    event.preventDefault();
    if (!selectedRequestId) return;
    setTriageSaving(true);
    try {
      const payload = await apiCall('patch', `/support/requests/${selectedRequestId}/triage`, {
        classification: triageForm.classification,
        tracking_status: triageForm.tracking_status,
        internal_notes: internalNoteDraft || null,
        repo_issue_number: triageForm.repo_issue_number || null,
        repo_issue_url: triageForm.repo_issue_url || null,
        resolved_in_version: triageForm.resolved_in_version || null
      });
      const updatedRequest = payload?.request;
      const systemMessage = payload?.message;
      const internalNoteMessage = payload?.internal_note_message;
      if (updatedRequest) {
        setRequests((prev) => prev.map((item) => (Number(item.id) === Number(updatedRequest.id) ? updatedRequest : item)));
        setSelectedRequest(updatedRequest);
        setTriageForm({
          classification: updatedRequest.classification || 'support',
          tracking_status: updatedRequest.tracking_status || 'untracked',
          repo_issue_number: updatedRequest.repo_issue_number ? String(updatedRequest.repo_issue_number) : '',
          repo_issue_url: updatedRequest.repo_issue_url || '',
          resolved_in_version: updatedRequest.resolved_in_version || ''
        });
      }
      if (systemMessage || internalNoteMessage) {
        setMessages((prev) => [
          ...prev,
          ...(systemMessage ? [systemMessage] : []),
          ...(internalNoteMessage ? [internalNoteMessage] : [])
        ]);
      }
      setInternalNoteDraft('');
      await loadRequests({ silent: true });
      await loadRequestDetail(selectedRequestId, { silent: true });
      onSupportSummaryRefresh?.({ silent: true });
      onToast('Triage updated');
    } catch (error) {
      onToast(error.response?.data?.error || 'Failed to save triage details', 'error');
    } finally {
      setTriageSaving(false);
    }
  };

  const updateSupportAccess = async (nextStatus) => {
    if (!selectedRequestId) return;
    setAccessSaving(true);
    try {
      const payload = await apiCall('patch', `/support/requests/${selectedRequestId}/access`, {
        support_access_status: nextStatus
      });
      const updatedRequest = payload?.request;
      const systemMessage = payload?.message;
      if (updatedRequest) {
        setRequests((prev) => prev.map((item) => (Number(item.id) === Number(updatedRequest.id) ? updatedRequest : item)));
        setSelectedRequest(updatedRequest);
      }
      if (systemMessage) {
        setMessages((prev) => [...prev, systemMessage]);
      }
      await loadRequests({ silent: true });
      await loadRequestDetail(selectedRequestId, { silent: true });
      onSupportSummaryRefresh?.({ silent: true });
      onToast(nextStatus === 'approved' ? 'Support access approved' : 'Support access revoked');
    } catch (error) {
      onToast(error.response?.data?.error || 'Failed to update support access', 'error');
    } finally {
      setAccessSaving(false);
    }
  };

  const selectedThreadIsOpen = Boolean(selectedRequest && selectedRequest.status !== 'closed');
  const shouldShowReplyComposer = Boolean(selectedThreadIsOpen && !isSupportStaff);
  const canRequesterManageSupportAccess = Boolean(
    !isSupportStaff
    && selectedRequest
    && selectedRequest.status !== 'closed'
    && selectedRequest.target_space_id
    && Number(selectedRequest.requester_user_id || 0) === Number(user?.id || 0)
  );
  const canStartApprovedSupportSession = Boolean(
    isSupportStaff
    && selectedRequest
    && selectedRequest.support_access_status === 'approved'
    && selectedRequest.target_space_id
  );
  const activeSessionEvidence = sessionEvidenceRows(supportSession, selectedRequest);

  const startApprovedSupportSession = async () => {
    if (!selectedRequest?.target_space_id) return;
    const started = await onStartSupportSession?.(
      {
        id: selectedRequest.target_space_id,
        name: selectedRequest.target_space_name || selectedRequest.requester_name || 'Approved support target'
      },
      {
        libraryId: selectedRequest.target_library_id || undefined,
        reason: `Approved support request ${selectedRequest.request_key || ''}: ${selectedRequest.subject}`.trim(),
        requestId: selectedRequest.id
      }
    );
    if (started !== false) {
      onToast('Support session started from approved request');
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 space-y-6">
      <div className="space-y-3">
        <h1 className="section-title">{isSupportStaff ? 'Help Admin' : 'Help Center'}</h1>
        <p className="text-sm text-ghost max-w-3xl">
          A lightweight home for self-serve guidance, recent release notes, and support conversations. Support requests create a documented thread first, not ambient tenant access.
        </p>
      </div>

      <div className="panel p-2 sm:p-3">
        <div
          className="grid gap-1.5 rounded-2xl bg-raised/55 border border-edge/60 p-1"
          style={{ gridTemplateColumns: `repeat(${helpTabs.length}, minmax(0, 1fr))` }}
        >
          {helpTabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={[
                  'rounded-2xl px-3 py-1.5 text-xs font-medium transition',
                  active
                    ? 'bg-gold/14 border border-gold/35 text-ink'
                    : 'border border-transparent text-ghost hover:text-ink hover:bg-raised/55'
                ].join(' ')}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === 'guidance' ? (
        <div className={`grid gap-4 ${isSupportStaff ? '' : 'xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]'}`}>
          <section className="panel p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-2xl border border-edge bg-raised flex items-center justify-center text-gold">
                <Icons.Library />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-ink">Guidance</h2>
                <p className="text-sm text-ghost">Quick starting points for the most common questions.</p>
              </div>
            </div>
            <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
              {guidanceArticles.map((article) => (
                <article key={article.id} className="rounded-3xl border border-edge bg-raised/40 p-4 space-y-3 shadow-soft">
                  <div>
                    <h3 className="text-sm font-semibold text-ink">{article.title}</h3>
                    <p className="mt-1 text-sm text-ghost leading-6">{article.summary}</p>
                  </div>
                  <ul className="space-y-2 text-sm text-ghost">
                    {article.bullets.map((bullet) => (
                      <li key={bullet} className="flex gap-2">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold/80" />
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>

          {!isSupportStaff ? (
            <section className="panel p-5 space-y-4">
              <>
                <h2 className="text-lg font-semibold text-ink">Getting help</h2>
                <p className="text-sm text-ghost">Use the Support tab when guidance is not enough or you need a human reply tied to your current context.</p>
                <div className="rounded-3xl border border-edge bg-raised/35 p-4 space-y-3 text-sm text-ghost leading-6">
                  <p>Your current context{activeSpace?.name ? `: ${activeSpace.name}` : ''}{activeLibrary?.name ? ` / ${activeLibrary.name}` : ''}.</p>
                  <p>Support requests preserve the thread, the timestamps, and the target context. Support staff can respond there without browsing your tenant by default.</p>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => setActiveTab('support')}>
                    <Icons.Activity />Open Support
                  </button>
                </div>
              </>
            </section>
          ) : null}
        </div>
      ) : null}

      {activeTab === 'releases' ? (
        <section className="panel p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-ink">Recent Releases</h2>
              <p className="text-sm text-ghost">A lightweight in-app version of recent release notes so users can see what changed without leaving the product.</p>
            </div>
            <button type="button" className="btn-secondary btn-sm" onClick={() => loadReleases()}>
              <Icons.Refresh />Refresh
            </button>
          </div>
          {releaseLoading ? (
            <div className="flex items-center gap-3 text-dim"><Spinner />Loading release notes…</div>
          ) : releases.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-edge p-6 text-sm text-ghost text-center">
              No release notes are available yet.
            </div>
          ) : (
            <div className="space-y-3">
              {releases.map((release) => {
                const expanded = expandedReleaseVersion === release.version;
                const isCurrent = release.version === releaseMeta.version;
                return (
                  <article key={release.version} className="rounded-3xl border border-edge bg-raised/35 p-4 sm:p-5 shadow-soft space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-2 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="badge badge-ok">{release.version}</span>
                          {release.date ? <span className="badge badge-dim">{release.date}</span> : null}
                          {isCurrent ? <span className="badge badge-warn">Current build</span> : null}
                          {isCurrent && releaseMeta.build ? <span className="badge badge-dim font-mono">{releaseMeta.build}</span> : null}
                        </div>
                        <h3 className="text-base font-semibold text-ink">{release.title}</h3>
                        <p className="text-sm text-ghost leading-6">{release.summary}</p>
                      </div>
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => setExpandedReleaseVersion(expanded ? null : release.version)}
                      >
                        <Icons.ChevronDown />{expanded ? 'Hide details' : 'Details'}
                      </button>
                    </div>
                    {expanded ? (
                      <div className="space-y-4 border-t border-edge pt-4">
                        {release.details.map((detail) => (
                          <div key={`${release.version}:${detail.heading}`} className="space-y-2">
                            <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-ghost">{detail.heading}</h4>
                            <ul className="space-y-2 text-sm text-ghost">
                              {detail.bullets.map((bullet) => (
                                <li key={bullet} className="flex gap-2">
                                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold/80" />
                                  <span>{bullet}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {activeTab === 'metrics' && isSupportStaff ? (
        <section className="panel p-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-ink">Support Metrics</h2>
              <p className="text-sm text-ghost">A quick pulse on queue responsiveness and closure pace from the live support request data.</p>
            </div>
            <button type="button" className="btn-secondary btn-sm" onClick={() => onSupportSummaryRefresh?.()}>
              <Icons.Refresh />Refresh
            </button>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <article className="rounded-3xl border border-edge bg-raised/35 p-5 shadow-soft">
              <p className="text-xs uppercase tracking-[0.16em] text-ghost">Time to open</p>
              <p className="mt-3 text-3xl font-display text-ink">{formatDurationCompact(supportSummary?.metrics?.time_to_open_seconds)}</p>
              <p className="mt-2 text-sm text-ghost leading-6">Average time from request creation to the first public staff reply.</p>
            </article>
            <article className="rounded-3xl border border-edge bg-raised/35 p-5 shadow-soft">
              <p className="text-xs uppercase tracking-[0.16em] text-ghost">Time to close</p>
              <p className="mt-3 text-3xl font-display text-ink">{formatDurationCompact(supportSummary?.metrics?.time_to_close_seconds)}</p>
              <p className="mt-2 text-sm text-ghost leading-6">Average time from request creation until the case is marked closed.</p>
            </article>
            <article className="rounded-3xl border border-edge bg-raised/35 p-5 shadow-soft">
              <p className="text-xs uppercase tracking-[0.16em] text-ghost">Closed this month</p>
              <p className="mt-3 text-3xl font-display text-ink">{supportSummary?.metrics?.closed_this_month || 0}</p>
              <p className="mt-2 text-sm text-ghost leading-6">Requests closed since the start of the current calendar month.</p>
            </article>
          </div>
        </section>
      ) : null}

      {activeTab === 'support' ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.2fr)] xl:h-[calc(100vh-15.5rem)]">
          <div className="space-y-4 xl:min-h-0 xl:flex xl:flex-col">
            {!isSupportStaff && shouldShowReplyComposer ? (
              <section className="panel p-5 space-y-4">
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold text-ink">Reply to Support</h2>
                  <p className="text-sm text-ghost">Keep the conversation in one place so it stays easy to follow over time.</p>
                </div>
                <form className="space-y-4" onSubmit={submitReply}>
                  <label className="field">
                    <span className="label">Reply</span>
                    <textarea
                      className="input min-h-[160px]"
                      value={replyBody}
                      onChange={(event) => setReplyBody(event.target.value)}
                      placeholder="Add more context or reply to support here."
                    />
                  </label>
                  <button type="submit" className="btn-primary" disabled={replying || !replyBody.trim()}>
                    {replying ? <><Spinner size={14} />Sending…</> : <><Icons.Edit />Reply</>}
                  </button>
                </form>
              </section>
            ) : !isSupportStaff ? (
              <section className="panel p-5 space-y-4">
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold text-ink">Ask for help</h2>
                  <p className="text-sm text-ghost">
                    Share what happened, what you expected, and where you got stuck. We’ll keep the thread here so it stays easy to follow.
                  </p>
                </div>
                <form className="space-y-4" onSubmit={submitRequest}>
                  <label className="field">
                    <span className="label">Subject</span>
                    <input
                      className="input"
                      value={form.subject}
                      onChange={(event) => setForm((prev) => ({ ...prev, subject: event.target.value }))}
                      placeholder="What do you need help with?"
                    />
                  </label>
                  <label className="field">
                    <span className="label">Message</span>
                    <textarea
                      className="input min-h-[140px]"
                      value={form.message}
                      onChange={(event) => setForm((prev) => ({ ...prev, message: event.target.value }))}
                      placeholder="Tell us what you tried, what you expected, and what felt off."
                    />
                  </label>
                  <button type="submit" className="btn-primary" disabled={submitting}>
                    {submitting ? <><Spinner size={14} />Submitting…</> : <><Icons.Plus />Create help request</>}
                  </button>
                </form>
              </section>
            ) : null}

            <section className="panel p-3 space-y-3 min-h-[320px] xl:min-h-0 xl:flex-1 xl:flex xl:flex-col">
              {isSupportStaff ? (
                <div className="space-y-3">
                  <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl border border-edge/60 bg-raised/18 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-[0.14em] text-ghost">Open</p>
                      <p className="mt-1 text-base font-semibold text-ink">{supportSummary?.open || 0}</p>
                    </div>
                    <div className="rounded-2xl border border-edge/60 bg-raised/18 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-[0.14em] text-ghost">Answered</p>
                      <p className="mt-1 text-base font-semibold text-ink">{supportSummary?.answered || 0}</p>
                    </div>
                    <div className="rounded-2xl border border-edge/60 bg-raised/18 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-[0.14em] text-ghost">Bugs</p>
                      <p className="mt-1 text-base font-semibold text-ink">{supportSummary?.bugs || 0}</p>
                    </div>
                    <div className="rounded-2xl border border-edge/60 bg-raised/18 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-[0.14em] text-ghost">Features</p>
                      <p className="mt-1 text-base font-semibold text-ink">{supportSummary?.features || 0}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 rounded-2xl bg-raised/55 border border-edge/60 p-1">
                    {[
                      { id: 'active', label: 'Active' },
                      { id: 'completed', label: 'Completed' },
                      { id: 'all', label: 'All' }
                    ].map((option) => {
                      const active = staffQueueFilter === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setStaffQueueFilter(option.id)}
                        className={[
                          'rounded-2xl px-3 py-1.5 text-xs font-medium transition',
                          active
                              ? 'bg-gold/14 border border-gold/35 text-ink'
                              : 'border border-transparent text-ghost hover:text-ink hover:bg-raised/55'
                        ].join(' ')}
                      >
                        {option.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px]">
                    <label className="field">
                      <span className="label">Search queue</span>
                      <input
                        className="input"
                        value={staffSearchInput}
                        onChange={(event) => setStaffSearchInput(event.target.value)}
                        placeholder="Subject, requester, space, library, or SUP-#"
                      />
                    </label>
                    <label className="field">
                      <span className="label">Classification</span>
                      <select
                        className="select"
                        value={staffClassificationFilter}
                        onChange={(event) => setStaffClassificationFilter(event.target.value)}
                      >
                        <option value="all">All classes</option>
                        {CLASSIFICATION_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
              ) : null}
              {loading ? (
                <div className="flex items-center gap-3 text-dim"><Spinner />Loading support requests…</div>
              ) : requests.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-edge p-6 text-sm text-ghost text-center">
                  {isSupportStaff ? 'No requests match the current queue filters.' : 'No support requests yet.'}
                </div>
              ) : (
                <div className="space-y-1.5 xl:min-h-0 xl:flex-1 xl:overflow-y-auto pr-1">
                  {requests.map((request) => {
                    const active = Number(selectedRequestId) === Number(request.id);
                    const requestContext = formatRequestContext(request);
                    return (
                      <button
                        key={request.id}
                        type="button"
                        onClick={() => setSelectedRequestId(request.id)}
                        className={[
                          'w-full rounded-[1.35rem] border px-3 py-2.5 text-left transition',
                          active ? 'border-gold/35 bg-gold/10 shadow-soft' : 'border-edge/65 bg-transparent hover:bg-raised/18'
                        ].join(' ')}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              {request.request_key ? <span className="badge badge-dim text-[10px]">{request.request_key}</span> : null}
                              <p className="text-sm font-medium text-ink truncate">{request.subject}</p>
                            </div>
                            <p className="text-xs text-ghost truncate">
                              {[request.requester_name || request.requester_email || 'Unknown requester', requestContext].filter(Boolean).join(' · ')}
                            </p>
                            {isSupportStaff ? (
                              <div className="flex flex-wrap items-center gap-2 pt-1">
                                {request.classification && request.classification !== 'support' ? (
                                  <span className="text-[11px] uppercase tracking-[0.14em] text-ghost">{classificationLabel(request.classification)}</span>
                                ) : null}
                                {request.tracking_status && request.tracking_status !== 'untracked' ? <span className="text-[11px] uppercase tracking-[0.14em] text-ghost">{trackingStatusLabel(request.tracking_status)}</span> : null}
                              </div>
                            ) : null}
                          </div>
                          <div className="shrink-0 flex flex-col items-end gap-1">
                            <span className={`badge ${requestStatusTone[request.status] || 'badge-dim'}`}>{request.status}</span>
                            <span className="text-[11px] text-ghost whitespace-nowrap">{formatTimestamp(request.last_message_at || request.updated_at)}</span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          <section className="panel p-0 min-h-[640px] overflow-hidden flex flex-col xl:min-h-0 xl:h-full">
            {!selectedRequestId ? (
              <div className="flex-1 flex items-center justify-center p-8 text-sm text-ghost text-center">
                Select a support request to open the conversation.
              </div>
            ) : detailLoading ? (
              <div className="flex-1 flex items-center justify-center gap-3 text-dim"><Spinner />Loading support conversation…</div>
            ) : selectedRequest ? (
              <>
                <div className="border-b border-edge px-4 py-2.5 bg-raised/25 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      {selectedRequest.request_key ? <span className="badge badge-dim">{selectedRequest.request_key}</span> : null}
                      <h2 className="text-base font-semibold text-ink truncate">{selectedRequest.subject}</h2>
                    </div>
                    {selectedRequest.target_space_id && supportAccessDetailText(selectedRequest) ? (
                      <p className="text-xs text-ghost">{supportAccessDetailText(selectedRequest)}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`badge ${requestStatusTone[selectedRequest.status] || 'badge-dim'}`}>{selectedRequest.status}</span>
                    {canRequesterManageSupportAccess && selectedRequest.support_access_status !== 'approved' ? (
                      <button type="button" className="btn-secondary btn-sm" disabled={accessSaving} onClick={() => updateSupportAccess('approved')}>
                        {accessSaving ? <><Spinner size={14} />Saving…</> : <><Icons.Check />Approve Support Access</>}
                      </button>
                    ) : null}
                    {canRequesterManageSupportAccess && selectedRequest.support_access_status === 'approved' ? (
                      <button type="button" className="btn-secondary btn-sm" disabled={accessSaving} onClick={() => updateSupportAccess('revoked')}>
                        {accessSaving ? <><Spinner size={14} />Saving…</> : <><Icons.X />Revoke Support Access</>}
                      </button>
                    ) : null}
                    {canStartApprovedSupportSession ? (
                      <button type="button" className="btn-secondary btn-sm" onClick={startApprovedSupportSession}>
                        <Icons.Activity />{supportSession?.request_id === selectedRequest.id ? 'Support Session Active' : 'Start Approved Support Session'}
                      </button>
                    ) : null}
                    {isSupportStaff && supportSession?.request_id === selectedRequest?.id ? (
                      <button type="button" className="btn-secondary btn-sm" onClick={() => onEndSupportSession?.()}>
                        <Icons.X />End Session
                      </button>
                    ) : null}
                    {selectedRequest.status !== 'closed' ? (
                      <button type="button" className="btn-secondary btn-sm" disabled={closing} onClick={() => updateRequestStatus('closed')}>
                        {closing ? <><Spinner size={14} />Closing…</> : <><Icons.Check />{isSupportStaff ? 'Close Case' : 'Close'}</>}
                      </button>
                    ) : null}
                    {!isSupportStaff && selectedRequest.status === 'closed' ? (
                      <button type="button" className="btn-secondary btn-sm" disabled={closing} onClick={() => updateRequestStatus('open')}>
                        {closing ? <><Spinner size={14} />Reopening…</> : <><Icons.Refresh />Reopen</>}
                      </button>
                    ) : null}
                  </div>
                </div>
                {activeSessionEvidence.length > 0 ? (
                  <div className="border-b border-edge bg-raised/10 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] uppercase tracking-[0.14em] text-ghost">Active session evidence</span>
                      <p className="text-xs text-ghost">This thread is the approval context for the current support session.</p>
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {activeSessionEvidence.map((row) => (
                        <div key={row.label} className="rounded-2xl border border-edge/65 bg-void/14 px-3 py-2.5">
                          <p className="text-[11px] uppercase tracking-[0.16em] text-ghost">{row.label}</p>
                          <p className="mt-1 text-sm text-ink break-words">{row.value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="border-b border-edge bg-raised/10 px-4 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className={`grid ${isSupportStaff ? 'grid-cols-4' : 'grid-cols-2'} gap-1.5 rounded-2xl bg-raised/55 border border-edge/60 p-1`}>
                      {[
                        ...(isSupportStaff
                          ? [
                              { id: 'conversation', label: 'Conversation' },
                              { id: 'reply', label: 'Reply' },
                              { id: 'triage', label: 'Triage' },
                              { id: 'history', label: `History${timeline.length ? ` (${timeline.length})` : ''}` }
                            ]
                          : [
                              { id: 'conversation', label: 'Conversation' },
                              { id: 'history', label: `History${timeline.length ? ` (${timeline.length})` : ''}` }
                            ])
                      ].map((tab) => {
                        const active = threadViewTab === tab.id;
                        return (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => setThreadViewTab(tab.id)}
                            className={[
                              'rounded-2xl px-3 py-1.5 text-xs font-medium transition',
                              active
                                ? 'bg-gold/14 border border-gold/35 text-ink'
                                : 'border border-transparent text-ghost hover:text-ink hover:bg-raised/55'
                            ].join(' ')}
                          >
                            {tab.label}
                          </button>
                        );
                      })}
                    </div>
                    {threadViewTab === 'history' ? (
                      <div className="text-right">
                        <p className="text-[11px] font-medium text-ghost">History timeline</p>
                        <p className="text-[11px] text-ghost">Lifecycle, approval, and support-session events for this request.</p>
                      </div>
                    ) : threadViewTab === 'reply' ? (
                      <p className="text-[11px] text-ghost">Reply to the selected requester without leaving the active case.</p>
                    ) : threadViewTab === 'triage' ? (
                      <p className="text-[11px] text-ghost">Classify, track, and add internal notes on the selected case.</p>
                    ) : null}
                  </div>
                </div>

                {threadViewTab === 'history' ? (
                  <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-4 space-y-1.5 bg-abyss/40">
                    {timeline.length > 0 ? (
                      timeline.map((event) => (
                        <TimelineItem key={event.id} event={event} />
                      ))
                    ) : (
                      <div className="rounded-2xl border border-dashed border-edge px-4 py-4 text-sm text-ghost">
                        No timeline events have been recorded for this request yet.
                      </div>
                    )}
                  </div>
                ) : threadViewTab === 'reply' && isSupportStaff ? (
                  <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-4 bg-abyss/40">
                    {selectedRequest && selectedRequest.status !== 'closed' ? (
                      <form className="space-y-4 max-w-3xl" onSubmit={submitReply}>
                        <div className="space-y-1">
                          <h3 className="text-sm font-semibold text-ink">Reply to requester</h3>
                          <p className="text-xs text-ghost">Send guidance, next steps, or a clarifying question without leaving the selected case.</p>
                        </div>
                        <label className="field">
                          <span className="label">Reply</span>
                          <textarea
                            className="input min-h-[180px]"
                            value={replyBody}
                            onChange={(event) => setReplyBody(event.target.value)}
                            placeholder="Reply with guidance, next steps, or a clarifying question."
                          />
                        </label>
                        <button type="submit" className="btn-primary" disabled={replying || !replyBody.trim()}>
                          {replying ? <><Spinner size={14} />Sending…</> : <><Icons.Edit />Reply</>}
                        </button>
                      </form>
                    ) : (
                      <div className="rounded-3xl border border-dashed border-edge p-4 text-sm text-ghost">
                        {selectedRequest
                          ? 'This case is closed. Reopen it first if you need to send another support reply.'
                          : 'Select a request from the queue to reply.'}
                      </div>
                    )}
                  </div>
                ) : threadViewTab === 'triage' && isSupportStaff ? (
                  <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-4 bg-abyss/40">
                    {selectedRequest ? (
                      <form className="space-y-4 max-w-3xl" onSubmit={saveTriage}>
                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="field">
                            <span className="label">Classification</span>
                            <select className="select" value={triageForm.classification} onChange={(event) => setTriageForm((prev) => ({ ...prev, classification: event.target.value }))}>
                              {CLASSIFICATION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                          </label>
                          <label className="field">
                            <span className="label">Tracking Status</span>
                            <select className="select" value={triageForm.tracking_status} onChange={(event) => setTriageForm((prev) => ({ ...prev, tracking_status: event.target.value }))}>
                              {TRACKING_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                          </label>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="field">
                            <span className="label">Repo Issue #</span>
                            <input className="input font-mono" value={triageForm.repo_issue_number} onChange={(event) => setTriageForm((prev) => ({ ...prev, repo_issue_number: event.target.value }))} placeholder="123" />
                          </label>
                          <label className="field">
                            <span className="label">Resolved In Version</span>
                            <input className="input font-mono" value={triageForm.resolved_in_version} onChange={(event) => setTriageForm((prev) => ({ ...prev, resolved_in_version: event.target.value }))} placeholder="v2.9.2" />
                          </label>
                        </div>
                        <label className="field">
                          <span className="label">Repo Issue URL</span>
                          <input className="input" value={triageForm.repo_issue_url} onChange={(event) => setTriageForm((prev) => ({ ...prev, repo_issue_url: event.target.value }))} placeholder="https://github.com/.../issues/123" />
                        </label>
                        <label className="field">
                          <span className="label">New Internal Note</span>
                          <textarea className="input min-h-[110px]" value={internalNoteDraft} onChange={(event) => setInternalNoteDraft(event.target.value)} placeholder="Save a staff-only note into the support thread without sending it to the requester." />
                        </label>
                        {selectedRequest?.internal_notes ? (
                          <div className="rounded-3xl border border-edge bg-raised/30 p-4">
                            <div className="flex items-center gap-2">
                              <p className="text-xs uppercase tracking-[0.16em] text-ghost">Latest saved internal note</p>
                              {selectedRequest.request_key ? <span className="badge badge-dim text-[10px] normal-case tracking-normal">{selectedRequest.request_key}</span> : null}
                            </div>
                            <p className="mt-2 text-sm text-ink whitespace-pre-wrap leading-6">{selectedRequest.internal_notes}</p>
                          </div>
                        ) : null}
                        <button type="submit" className="btn-primary" disabled={triageSaving}>
                          {triageSaving ? <><Spinner size={14} />Saving…</> : <><Icons.Check />Save triage</>}
                        </button>
                      </form>
                    ) : (
                      <div className="rounded-3xl border border-dashed border-edge p-4 text-sm text-ghost">
                        Select a request from the queue to classify it, add repo linkage, or save an internal note.
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-4 space-y-2.5 bg-abyss/40">
                    {messages.map((message) => (
                      <ThreadBubble key={message.id} message={message} currentUserId={user?.id} />
                    ))}
                    <div ref={threadEndRef} />
                  </div>
                )}
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center p-8 text-sm text-ghost text-center">
                This support request is no longer available.
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
