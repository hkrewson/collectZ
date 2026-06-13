import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SUPPORT_STAFF_ROLE } from './app/productEdition';

const SUPPORT_INBOX_POLL_MS = 30000;

function formatTimestamp(value) {
  if (!value) return 'Unknown';
  try {
    return new Date(value).toLocaleString();
  } catch (_) {
    return String(value);
  }
}

function actorLabel(message) {
  if (message?.author_name) return message.author_name;
  if (message?.author_email) return message.author_email;
  if (message?.author_role === SUPPORT_STAFF_ROLE) return 'Support';
  if (message?.author_role === 'admin') return 'Admin';
  return 'Member';
}

function ThreadBubble({ message, isSupportReply }) {
  return (
    <div className={`flex ${isSupportReply ? 'justify-end' : 'justify-start'}`}>
      <div
        className={[
          'max-w-[88%] rounded-3xl border px-4 py-3 shadow-soft space-y-2',
          isSupportReply
            ? 'border-gold/40 bg-gold/10 text-ink rounded-br-xl'
            : 'border-edge bg-raised/45 text-ink rounded-bl-xl'
        ].join(' ')}
      >
        <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.16em] text-ghost">
          <span>{actorLabel(message)}</span>
          <span className="normal-case tracking-normal text-[12px]">{formatTimestamp(message.created_at)}</span>
        </div>
        <p className="text-sm leading-6 whitespace-pre-wrap">{message.body}</p>
      </div>
    </div>
  );
}

export default function SupportInboxView({ apiCall, onToast, Spinner, Icons }) {
  const [requests, setRequests] = useState([]);
  const [summary, setSummary] = useState({ open: 0, answered: 0, closed: 0 });
  const [loading, setLoading] = useState(true);
  const [selectedRequestId, setSelectedRequestId] = useState(null);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [messages, setMessages] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [replying, setReplying] = useState(false);
  const [statusSaving, setStatusSaving] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const threadEndRef = useRef(null);

  const loadInbox = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const [summaryPayload, requestsPayload] = await Promise.all([
        apiCall('get', '/support/staff/summary'),
        apiCall('get', statusFilter === 'all' ? '/support/requests' : `/support/requests?status=${encodeURIComponent(statusFilter)}`)
      ]);
      setSummary(summaryPayload?.queue || { open: 0, answered: 0, closed: 0 });
      const nextRequests = Array.isArray(requestsPayload?.requests) ? requestsPayload.requests : [];
      setRequests(nextRequests);
      setSelectedRequestId((prev) => (
        nextRequests.some((item) => Number(item.id) === Number(prev)) ? prev : (nextRequests[0]?.id || null)
      ));
    } catch (error) {
      if (!silent) {
        onToast(error.response?.data?.error || 'Failed to load support inbox', 'error');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [apiCall, onToast, statusFilter]);

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
        onToast(error.response?.data?.error || 'Failed to load support request', 'error');
      }
    } finally {
      if (!silent) setDetailLoading(false);
    }
  }, [apiCall, onToast]);

  useEffect(() => {
    loadInbox();
  }, [loadInbox]);

  useEffect(() => {
    if (!selectedRequestId) {
      setSelectedRequest(null);
      setMessages([]);
      return;
    }
    loadRequestDetail(selectedRequestId);
  }, [loadRequestDetail, selectedRequestId]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      loadInbox({ silent: true });
      if (selectedRequestId) {
        loadRequestDetail(selectedRequestId, { silent: true });
      }
    }, SUPPORT_INBOX_POLL_MS);
    return () => window.clearInterval(intervalId);
  }, [loadInbox, loadRequestDetail, selectedRequestId]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView?.({ block: 'end', behavior: 'smooth' });
  }, [messages.length, selectedRequestId]);

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
      if (newMessage) setMessages((prev) => [...prev, newMessage]);
      await loadInbox({ silent: true });
      onToast('Support reply sent');
    } catch (error) {
      onToast(error.response?.data?.error || 'Failed to send support reply', 'error');
    } finally {
      setReplying(false);
    }
  };

  const updateStatus = async (nextStatus) => {
    if (!selectedRequestId || !nextStatus) return;
    setStatusSaving(nextStatus);
    try {
      const payload = await apiCall('patch', `/support/requests/${selectedRequestId}/status`, { status: nextStatus });
      const updatedRequest = payload?.request;
      if (updatedRequest) {
        setRequests((prev) => prev.map((item) => (Number(item.id) === Number(updatedRequest.id) ? updatedRequest : item)));
        setSelectedRequest(updatedRequest);
      }
      await loadInbox({ silent: true });
      onToast(`Request marked ${nextStatus}`);
    } catch (error) {
      onToast(error.response?.data?.error || 'Failed to update request status', 'error');
    } finally {
      setStatusSaving('');
    }
  };

  const statusTone = useMemo(() => ({
    open: 'badge-warn',
    answered: 'badge-ok',
    closed: 'badge-dim'
  }), []);

  const summaryCards = [
    { key: 'open', label: 'Open', value: summary.open },
    { key: 'answered', label: 'Answered', value: summary.answered },
    { key: 'closed', label: 'Closed', value: summary.closed }
  ];

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 space-y-6">
      <div className="space-y-3">
        <h1 className="section-title">Support Inbox</h1>
        <p className="text-sm text-ghost max-w-3xl">
          Lightweight queue foundations for support work. This surface stays separate from tenant data browsing and now refreshes quietly so threads feel closer to in-app chat.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {summaryCards.map((card) => (
          <div key={card.key} className="panel p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-ghost">{card.label}</p>
            <p className="mt-2 text-3xl font-display tracking-wide text-ink">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(300px,0.85fr)_minmax(0,1.15fr)]">
        <section className="panel p-5 space-y-4 min-h-[420px]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-ink">Queue</h2>
              <p className="text-sm text-ghost">Open questions and the first reply surface for support staff.</p>
            </div>
            <div className="flex items-center gap-2">
              <select className="select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">All states</option>
                <option value="open">Open</option>
                <option value="answered">Answered</option>
                <option value="closed">Closed</option>
              </select>
              <button type="button" className="btn-secondary btn-sm" onClick={() => loadInbox()}><Icons.Refresh />Refresh</button>
            </div>
          </div>
          {loading ? (
            <div className="flex items-center gap-3 text-dim"><Spinner />Loading support inbox…</div>
          ) : requests.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-edge p-6 text-sm text-ghost text-center">
              No support requests match this filter.
            </div>
          ) : (
            <div className="space-y-2">
              {requests.map((request) => (
                <button
                  key={request.id}
                  type="button"
                  onClick={() => setSelectedRequestId(request.id)}
                  className={[
                    'w-full rounded-2xl border p-4 text-left transition shadow-soft',
                    Number(selectedRequestId) === Number(request.id)
                      ? 'border-gold/40 bg-gold/10'
                      : 'border-edge bg-raised/30 hover:bg-raised/50'
                  ].join(' ')}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink truncate">{request.subject}</p>
                      <p className="mt-1 text-xs text-ghost truncate">
                        {request.requester_name || request.requester_email || 'Unknown requester'}
                      </p>
                      <p className="mt-1 text-xs text-ghost">
                        Updated {formatTimestamp(request.last_message_at || request.updated_at)}
                      </p>
                    </div>
                    <span className={`badge ${statusTone[request.status] || 'badge-dim'}`}>{request.status}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="panel p-0 min-h-[420px] overflow-hidden flex flex-col">
          {!selectedRequestId ? (
            <div className="flex-1 flex items-center justify-center p-6 text-sm text-ghost text-center">
              Select a request to review the thread.
            </div>
          ) : detailLoading ? (
            <div className="flex-1 flex items-center justify-center gap-3 text-dim"><Spinner />Loading support conversation…</div>
          ) : selectedRequest ? (
            <>
              <div className="border-b border-edge px-5 py-4 bg-raised/25 flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold text-ink">{selectedRequest.subject}</h2>
                  <p className="text-sm text-ghost">
                    From {selectedRequest.requester_name || selectedRequest.requester_email || 'Unknown requester'}
                  </p>
                  <p className="text-sm text-ghost">
                    Status: <span className="text-ink">{selectedRequest.status}</span>
                    {selectedRequest.target_space_id ? ` · Space #${selectedRequest.target_space_id}` : ''}
                    {selectedRequest.target_library_id ? ` · Library #${selectedRequest.target_library_id}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {['open', 'answered', 'closed'].map((state) => (
                    <button
                      key={state}
                      type="button"
                      className="btn-secondary btn-sm"
                      disabled={statusSaving === state || selectedRequest.status === state}
                      onClick={() => updateStatus(state)}
                    >
                      {statusSaving === state ? <><Spinner size={14} />Saving…</> : <><Icons.Check />{state}</>}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-5 space-y-3 bg-abyss/40">
                {messages.map((message) => (
                  <ThreadBubble
                    key={message.id}
                    message={message}
                    isSupportReply={[SUPPORT_STAFF_ROLE, 'admin'].includes(String(message.author_role || ''))}
                  />
                ))}
                <div ref={threadEndRef} />
              </div>

              {selectedRequest.status !== 'closed' ? (
                <form className="border-t border-edge bg-raised/25 p-4 sm:p-5 space-y-3" onSubmit={submitReply}>
                  <label className="field">
                    <span className="label">Reply</span>
                    <textarea
                      className="input min-h-[120px]"
                      value={replyBody}
                      onChange={(event) => setReplyBody(event.target.value)}
                      placeholder="Provide guidance, ask a clarifying question, or confirm next steps."
                    />
                  </label>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-ghost">This inbox refreshes automatically while it stays open.</p>
                    <button type="submit" className="btn-primary" disabled={replying || !replyBody.trim()}>
                      {replying ? <><Spinner size={14} />Sending…</> : <><Icons.Edit />Send reply</>}
                    </button>
                  </div>
                </form>
              ) : null}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center p-6 text-sm text-ghost text-center">
              This support request is no longer available.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
