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
      'Consent-gated support access is planned for the next milestone, not this one.'
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

const HELP_TABS = [
  { id: 'guidance', label: 'Guidance' },
  { id: 'releases', label: 'Releases' },
  { id: 'support', label: 'Support' }
];

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

function classificationLabel(value) {
  return CLASSIFICATION_OPTIONS.find((option) => option.value === value)?.label || 'Support';
}

function trackingStatusLabel(value) {
  return TRACKING_STATUS_OPTIONS.find((option) => option.value === value)?.label || 'Untracked';
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
          'max-w-[88%] rounded-3xl border px-4 py-3 shadow-soft space-y-2',
          isInternalMessage
            ? 'border-sky-500/30 bg-sky-500/10 text-ink rounded-2xl'
            : isSystemMessage
            ? 'border-edge bg-void/40 text-ghost rounded-2xl'
            : isOwnMessage
              ? 'border-gold/40 bg-gold/10 text-ink rounded-br-xl'
              : 'border-edge bg-raised/45 text-ink rounded-bl-xl'
        ].join(' ')}
      >
        <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.16em] text-ghost">
          <span className="flex items-center gap-2">
            <span>{actorLabel(message)}</span>
            {message?.request_key ? <span className="badge badge-dim text-[10px] normal-case tracking-normal">{message.request_key}</span> : null}
          </span>
          <span className="normal-case tracking-normal text-[12px]">{formatTimestamp(message.created_at)}</span>
        </div>
        <p className="text-sm leading-6 whitespace-pre-wrap">{message.body}</p>
      </div>
    </div>
  );
}

export default function HelpView({
  apiCall,
  onToast,
  user,
  activeSpace,
  activeLibrary,
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

  const loadRequests = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const payload = await apiCall('get', '/support/requests');
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
  }, [apiCall, onToast]);

  const loadRequestDetail = useCallback(async (requestId, { silent = false } = {}) => {
    if (!requestId) {
      setSelectedRequest(null);
      setMessages([]);
      return;
    }
    if (!silent) setDetailLoading(true);
    try {
      const payload = await apiCall('get', `/support/requests/${requestId}`);
      setSelectedRequest(payload?.request || null);
      setMessages(Array.isArray(payload?.messages) ? payload.messages : []);
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
    loadRequests();
    loadReleases();
  }, [loadRequests, loadReleases]);

  useEffect(() => {
    if (!selectedRequestId) {
      setSelectedRequest(null);
      setMessages([]);
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
    setTriageForm({
      classification: selectedRequest?.classification || 'support',
      tracking_status: selectedRequest?.tracking_status || 'untracked',
      repo_issue_number: selectedRequest?.repo_issue_number ? String(selectedRequest.repo_issue_number) : '',
      repo_issue_url: selectedRequest?.repo_issue_url || '',
      resolved_in_version: selectedRequest?.resolved_in_version || ''
    });
    setInternalNoteDraft('');
  }, [selectedRequest?.id, selectedRequest?.classification, selectedRequest?.tracking_status, selectedRequest?.repo_issue_number, selectedRequest?.repo_issue_url, selectedRequest?.resolved_in_version]);

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

  const closeRequest = async () => {
    if (!selectedRequestId) return;
    setClosing(true);
    try {
      const payload = await apiCall('patch', `/support/requests/${selectedRequestId}/status`, { status: 'closed' });
      const updatedRequest = payload?.request;
      if (updatedRequest) {
        setRequests((prev) => prev.map((item) => (Number(item.id) === Number(updatedRequest.id) ? updatedRequest : item)));
        setSelectedRequest(updatedRequest);
      }
      onSupportSummaryRefresh?.({ silent: true });
      onToast('Help request closed');
    } catch (error) {
      onToast(error.response?.data?.error || 'Failed to close help request', 'error');
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
      onSupportSummaryRefresh?.({ silent: true });
      onToast('Triage updated');
    } catch (error) {
      onToast(error.response?.data?.error || 'Failed to save triage details', 'error');
    } finally {
      setTriageSaving(false);
    }
  };

  const selectedThreadIsOpen = Boolean(selectedRequest && selectedRequest.status !== 'closed');
  const shouldShowReplyComposer = Boolean(selectedThreadIsOpen && !isSupportStaff);

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 space-y-6">
      <div className="space-y-3">
        <h1 className="section-title">{isSupportStaff ? 'Help Admin' : 'Help Center'}</h1>
        <p className="text-sm text-ghost max-w-3xl">
          A lightweight home for self-serve guidance, recent release notes, and support conversations. Support requests create a documented thread first, not ambient tenant access.
        </p>
      </div>

      <div className="panel p-2 sm:p-3">
        <div className="grid grid-cols-3 gap-2 rounded-2xl bg-raised/55 border border-edge/60 p-1.5 shadow-soft">
          {HELP_TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={[
                  'rounded-2xl px-3 py-3 text-sm font-medium transition',
                  active
                    ? 'bg-gold/20 border border-gold/35 text-ink shadow-soft'
                    : 'border border-transparent text-ghost hover:text-ink hover:bg-raised/80'
                ].join(' ')}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === 'guidance' ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
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

          <section className="panel p-5 space-y-4">
            {isSupportStaff ? (
              <>
                <h2 className="text-lg font-semibold text-ink">Support workload</h2>
                <p className="text-sm text-ghost">A quick snapshot of what is waiting in the queue right now.</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-3xl border border-edge bg-raised/35 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-ghost">Open</p>
                    <p className="mt-2 text-3xl font-display text-ink">{supportSummary?.open || 0}</p>
                  </div>
                  <div className="rounded-3xl border border-edge bg-raised/35 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-ghost">Bugs / Features</p>
                    <p className="mt-2 text-3xl font-display text-ink">{supportSummary?.bugs || 0} / {supportSummary?.features || 0}</p>
                  </div>
                </div>
              </>
            ) : (
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
            )}
          </section>
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

      {activeTab === 'support' ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(320px,0.85fr)_minmax(0,1.15fr)]">
          <div className="space-y-4">
            {isSupportStaff ? (
              <section className="panel p-5 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-ink">Queue summary</h2>
                    <p className="text-sm text-ghost">Support and product triage now live together here instead of in a separate inbox.</p>
                  </div>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => onSupportSummaryRefresh?.()}>
                    <Icons.Refresh />Refresh
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-3xl border border-edge bg-raised/35 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-ghost">Open</p>
                    <p className="mt-2 text-3xl font-display text-ink">{supportSummary?.open || 0}</p>
                  </div>
                  <div className="rounded-3xl border border-edge bg-raised/35 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-ghost">Answered</p>
                    <p className="mt-2 text-3xl font-display text-ink">{supportSummary?.answered || 0}</p>
                  </div>
                  <div className="rounded-3xl border border-edge bg-raised/35 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-ghost">Bugs / Features</p>
                    <p className="mt-2 text-3xl font-display text-ink">{supportSummary?.bugs || 0} / {supportSummary?.features || 0}</p>
                  </div>
                </div>
              </section>
            ) : shouldShowReplyComposer ? (
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
            ) : (
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
            )}

            {isSupportStaff && selectedRequest ? (
              <section className="panel p-5 space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-ink">Triage</h2>
                  <p className="text-sm text-ghost">Classify requests, keep internal notes, and prepare tracked bugs or feature requests for later repo linkage.</p>
                  {selectedRequest?.request_key ? <p className="mt-2 text-xs uppercase tracking-[0.16em] text-ghost">Editing {selectedRequest.request_key}</p> : null}
                </div>
                <form className="space-y-4" onSubmit={saveTriage}>
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
                    <textarea className="input min-h-[130px]" value={internalNoteDraft} onChange={(event) => setInternalNoteDraft(event.target.value)} placeholder="Save a staff-only note into the support thread without sending it to the requester." />
                  </label>
                  {selectedRequest?.internal_notes ? (
                    <div className="rounded-3xl border border-edge bg-raised/30 p-4">
                      <p className="text-xs uppercase tracking-[0.16em] text-ghost">Latest saved internal note</p>
                      <p className="mt-2 text-sm text-ink whitespace-pre-wrap leading-6">{selectedRequest.internal_notes}</p>
                    </div>
                  ) : null}
                  <button type="submit" className="btn-primary" disabled={triageSaving}>
                    {triageSaving ? <><Spinner size={14} />Saving…</> : <><Icons.Check />Save triage</>}
                  </button>
                </form>
              </section>
            ) : null}

            <section className="panel p-5 space-y-4 min-h-[320px]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-ink">Requests</h2>
                  <p className="text-sm text-ghost">Support and product-tracked conversations stay together here.</p>
                </div>
                <button type="button" className="btn-secondary btn-sm" onClick={() => loadRequests()}>
                  <Icons.Refresh />Refresh
                </button>
              </div>
              {loading ? (
                <div className="flex items-center gap-3 text-dim"><Spinner />Loading support requests…</div>
              ) : requests.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-edge p-6 text-sm text-ghost text-center">
                  No support requests yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {requests.map((request) => {
                    const active = Number(selectedRequestId) === Number(request.id);
                    const requestContext = formatRequestContext(request);
                    return (
                      <button
                        key={request.id}
                        type="button"
                        onClick={() => setSelectedRequestId(request.id)}
                        className={[
                          'w-full rounded-3xl border p-4 text-left transition shadow-soft',
                          active ? 'border-gold/35 bg-gold/10' : 'border-edge bg-raised/30 hover:bg-raised/50'
                        ].join(' ')}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              {request.request_key ? <span className="badge badge-dim text-[10px]">{request.request_key}</span> : null}
                              <p className="text-sm font-medium text-ink truncate">{request.subject}</p>
                            </div>
                            <p className="text-xs text-ghost truncate">{request.requester_name || request.requester_email || 'Unknown requester'}</p>
                            {requestContext ? <p className="text-xs text-ghost truncate">{requestContext}</p> : null}
                            <p className="text-xs text-ghost">Updated {formatTimestamp(request.last_message_at || request.updated_at)}</p>
                            {isSupportStaff ? (
                              <div className="flex flex-wrap items-center gap-2 pt-1">
                                <span className="badge badge-dim text-[10px]">{classificationLabel(request.classification)}</span>
                                {request.tracking_status && request.tracking_status !== 'untracked' ? <span className="badge badge-ok text-[10px]">{trackingStatusLabel(request.tracking_status)}</span> : null}
                              </div>
                            ) : null}
                          </div>
                          <span className={`badge ${requestStatusTone[request.status] || 'badge-dim'}`}>{request.status}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          <section className="panel p-0 min-h-[640px] overflow-hidden flex flex-col">
            {!selectedRequestId ? (
              <div className="flex-1 flex items-center justify-center p-8 text-sm text-ghost text-center">
                Select a support request to open the conversation.
              </div>
            ) : detailLoading ? (
              <div className="flex-1 flex items-center justify-center gap-3 text-dim"><Spinner />Loading support conversation…</div>
            ) : selectedRequest ? (
              <>
                <div className="border-b border-edge px-5 py-4 bg-raised/25 flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {selectedRequest.request_key ? <span className="badge badge-dim">{selectedRequest.request_key}</span> : null}
                      <h2 className="text-lg font-semibold text-ink truncate">{selectedRequest.subject}</h2>
                    </div>
                    <p className="text-sm text-ghost">
                      {selectedRequest.requester_name || selectedRequest.requester_email || 'Unknown requester'}
                      {formatRequestContext(selectedRequest) ? ` · ${formatRequestContext(selectedRequest)}` : ''}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <span className={`badge ${requestStatusTone[selectedRequest.status] || 'badge-dim'}`}>{selectedRequest.status}</span>
                      <span className="badge badge-dim">{classificationLabel(selectedRequest.classification)}</span>
                      {selectedRequest.tracking_status && selectedRequest.tracking_status !== 'untracked' ? <span className="badge badge-ok">{trackingStatusLabel(selectedRequest.tracking_status)}</span> : null}
                      {selectedRequest.resolved_in_version ? <span className="badge badge-warn">{selectedRequest.resolved_in_version}</span> : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className="btn-secondary btn-sm" onClick={() => loadRequestDetail(selectedRequestId)}>
                      <Icons.Refresh />Refresh
                    </button>
                    {!isSupportStaff && selectedRequest.status !== 'closed' ? (
                      <button type="button" className="btn-secondary btn-sm" disabled={closing} onClick={closeRequest}>
                        {closing ? <><Spinner size={14} />Closing…</> : <><Icons.Check />Close</>}
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-5 space-y-3 bg-abyss/40">
                  {messages.map((message) => (
                    <ThreadBubble key={message.id} message={message} currentUserId={user?.id} />
                  ))}
                  <div ref={threadEndRef} />
                </div>

                {isSupportStaff && selectedRequest.status !== 'closed' ? (
                  <form className="border-t border-edge bg-raised/25 p-4 sm:p-5 space-y-3" onSubmit={submitReply}>
                    <label className="field">
                      <span className="label">Reply</span>
                      <textarea
                        className="input min-h-[120px]"
                        value={replyBody}
                        onChange={(event) => setReplyBody(event.target.value)}
                        placeholder="Reply with guidance, next steps, or a clarifying question."
                      />
                    </label>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-ghost">This thread refreshes automatically while you stay on the Support tab.</p>
                      <button type="submit" className="btn-primary" disabled={replying || !replyBody.trim()}>
                        {replying ? <><Spinner size={14} />Sending…</> : <><Icons.Edit />Reply</>}
                      </button>
                    </div>
                  </form>
                ) : null}
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
