import React, { useCallback, useEffect, useState } from 'react';
import { CollectionPaginationFooter, SectionTabs, posterUrl } from './app/AppPrimitives';

function formatDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '—';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleDateString();
}

function normalizeDateValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.slice(0, 10);
}

function daysUntilDate(value) {
  const normalized = normalizeDateValue(value);
  if (!normalized) return null;
  const target = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target.getTime() - base.getTime()) / 86400000);
}

function isDueSoon(loan) {
  if (!loan || loan.returned_at || loan.status === 'overdue') return false;
  const days = daysUntilDate(loan.due_at);
  return Number.isInteger(days) && days >= 0 && days <= 3;
}

function relativeDueLabel(loan) {
  if (!loan || loan.returned_at) return null;
  if (loan.status === 'overdue') {
    const days = daysUntilDate(loan.due_at);
    const overdueDays = Number.isInteger(days) ? Math.abs(days) : null;
    if (overdueDays === 0) return 'Due today';
    if (overdueDays === 1) return '1 day overdue';
    if (Number.isInteger(overdueDays)) return `${overdueDays} days overdue`;
    return 'Overdue';
  }
  const days = daysUntilDate(loan.due_at);
  if (!Number.isInteger(days)) return null;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days > 1 && days <= 3) return `Due in ${days} days`;
  return null;
}

function reminderPhaseLabel(loan) {
  if (!loan || loan.returned_at) return null;
  if (loan.reminder_phase === 'overdue') return 'Overdue reminder';
  if (loan.reminder_phase === 'due_soon') return 'Due soon reminder';
  return null;
}

function formatReminderTimestamp(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleString();
}

function formatReminderEventLabel(event) {
  if (!event) return 'Reminder event';
  const trigger = event.trigger_source === 'automatic' ? 'Automatic' : 'Manual';
  const phase = event.phase === 'overdue' ? 'overdue' : 'due soon';
  if (event.status === 'failed') return `${phase} reminder failed (${trigger.toLowerCase()})`;
  if (event.status === 'skipped') return `${phase} reminder skipped (${trigger.toLowerCase()})`;
  return `${phase} reminder sent (${trigger.toLowerCase()})`;
}

function formatLoanHistoryRange(loan) {
  if (!loan) return 'Loan record';
  const start = formatDate(loan.loaned_at);
  if (loan.returned_at) return `Loaned ${start} · Returned ${formatDate(loan.returned_at)}`;
  return `Loaned ${start} · Due ${formatDate(loan.due_at)}`;
}

function sortLoanHistoryEntries(left, right) {
  const leftValue = String(left?.returned_at || left?.due_at || left?.loaned_at || '');
  const rightValue = String(right?.returned_at || right?.due_at || right?.loaned_at || '');
  return rightValue.localeCompare(leftValue);
}

function ReminderHistorySummary({ events = [] }) {
  if (!Array.isArray(events) || events.length === 0) return null;
  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs text-ghost">Reminder history</p>
      {events.slice(0, 3).map((event) => (
        <div
          key={event.id || `${event.sent_at || 'event'}-${event.delivery_window_key || ''}`}
          className="flex items-start justify-between gap-4 text-sm"
        >
          <div className="min-w-0">
            <p className="text-dim">{formatReminderEventLabel(event)}</p>
            {event.failure_summary ? <p className="mt-1 text-xs text-ghost">{event.failure_summary}</p> : null}
          </div>
          <span className="shrink-0 text-xs text-ghost">{formatReminderTimestamp(event.sent_at)}</span>
        </div>
      ))}
    </div>
  );
}

function LoanHistorySection({ title, loans = [], activeLoanId = null }) {
  if (!Array.isArray(loans) || loans.length === 0) return null;
  return (
    <div>
      <p className="text-xs text-ghost">{title}</p>
      <div className="mt-3 space-y-4">
        {loans.map((historyLoan) => (
          <div key={historyLoan.id} className="border-l border-edge/70 pl-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-ink">{historyLoan.borrower_name || 'Borrower'}</p>
                  {historyLoan.id === activeLoanId ? (
                    <span className="badge border border-edge/70 bg-abyss text-dim">This loan</span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-ghost">{formatLoanHistoryRange(historyLoan)}</p>
                {historyLoan.borrower_email ? <p className="mt-1 text-xs text-ghost">{historyLoan.borrower_email}</p> : null}
              </div>
              <span className={statusBadgeClass(historyLoan.status)}>{statusLabel(historyLoan.status)}</span>
            </div>
            {historyLoan.notes ? <p className="mt-2 text-sm text-dim">{historyLoan.notes}</p> : null}
            <ReminderHistorySummary events={historyLoan.reminder_events} />
          </div>
        ))}
      </div>
    </div>
  );
}

function statusLabel(status) {
  if (status === 'overdue') return 'Overdue';
  if (status === 'returned') return 'Returned';
  return 'Active';
}

function statusBadgeClass(status) {
  if (status === 'overdue') return 'badge border border-err/25 bg-err/10 text-err';
  if (status === 'returned') return 'badge border border-edge/70 bg-panel text-dim';
  return 'badge border border-gold/25 bg-gold/10 text-gold';
}

function LoanEditor({ loan, onSave, onClose, saving = false }) {
  const [form, setForm] = useState({
    borrower_name: loan?.borrower_name || '',
    borrower_email: loan?.borrower_email || '',
    loaned_at: String(loan?.loaned_at || '').slice(0, 10),
    due_at: String(loan?.due_at || '').slice(0, 10),
    loan_format: loan?.loan_format || '',
    notes: loan?.notes || ''
  });

  useEffect(() => {
    setForm({
      borrower_name: loan?.borrower_name || '',
      borrower_email: loan?.borrower_email || '',
      loaned_at: String(loan?.loaned_at || '').slice(0, 10),
      due_at: String(loan?.due_at || '').slice(0, 10),
      loan_format: loan?.loan_format || '',
      notes: loan?.notes || ''
    });
  }, [loan]);

  if (!loan) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-void/72" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-lg border border-edge bg-abyss">
        <div className="border-b border-edge px-5 py-4">
          <h2 className="text-lg font-semibold text-ink">Edit Loan</h2>
          <p className="mt-1 text-sm text-ghost">{loan?.media?.title || 'Loan record'}</p>
        </div>
        <form
          className="space-y-4 px-5 py-5"
          onSubmit={(event) => {
            event.preventDefault();
            onSave?.({
              borrower_name: form.borrower_name,
              borrower_email: form.borrower_email,
              loaned_at: form.loaned_at,
              due_at: form.due_at,
              loan_format: form.loan_format,
              notes: form.notes
            });
          }}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-ghost">Borrower</span>
              <input
                className="input w-full"
                value={form.borrower_name}
                onChange={(event) => setForm((current) => ({ ...current, borrower_name: event.target.value }))}
                required
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-ghost">Borrower Email</span>
              <input
                className="input w-full"
                type="email"
                value={form.borrower_email}
                onChange={(event) => setForm((current) => ({ ...current, borrower_email: event.target.value }))}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-ghost">Loaned On</span>
              <input
                className="input w-full"
                type="date"
                value={form.loaned_at}
                onChange={(event) => setForm((current) => ({ ...current, loaned_at: event.target.value }))}
                required
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-ghost">Due Back</span>
              <input
                className="input w-full"
                type="date"
                value={form.due_at}
                onChange={(event) => setForm((current) => ({ ...current, due_at: event.target.value }))}
                required
              />
            </label>
          </div>
          <label className="space-y-1">
            <span className="text-xs font-medium text-ghost">Loan Format</span>
            <input
              className="input w-full"
              value={form.loan_format}
              onChange={(event) => setForm((current) => ({ ...current, loan_format: event.target.value }))}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-ghost">Notes</span>
            <textarea
              className="input min-h-[96px] w-full resize-y"
              value={form.notes}
              onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
            />
          </label>
          <div className="flex items-center justify-end gap-2 border-t border-edge pt-4">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save Loan'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function LibraryLoansView({
  apiCall,
  onToast,
  activeLibrary = null,
  Icons,
  Spinner
}) {
  const [status, setStatus] = useState('active');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pagination, setPagination] = useState({ page: 1, limit: 25, total: 0, totalPages: 1, hasMore: false });
  const [totals, setTotals] = useState({ active: 0, overdue: 0, returned: 0, all: 0, dueSoon: 0 });
  const [page, setPage] = useState(1);
  const [editingLoan, setEditingLoan] = useState(null);
  const [savingLoan, setSavingLoan] = useState(false);
  const [returningLoanId, setReturningLoanId] = useState(null);
  const [remindingLoanId, setRemindingLoanId] = useState(null);
  const [expandedLoanId, setExpandedLoanId] = useState(null);
  const [historyByMediaId, setHistoryByMediaId] = useState({});
  const [historyLoadingMediaId, setHistoryLoadingMediaId] = useState(null);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedSearch(searchInput.trim()), 250);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [status, debouncedSearch]);

  const loadLoans = useCallback(async (targetPage = page) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('status', status);
      params.set('page', String(targetPage));
      params.set('limit', '25');
      if (debouncedSearch) params.set('search', debouncedSearch);
      const countStatuses = ['active', 'overdue', 'returned', 'all'];
      const [payload, ...countPayloads] = await Promise.all([
        apiCall('get', `/media/loans?${params.toString()}`),
        ...countStatuses.map((entryStatus) => {
          const countParams = new URLSearchParams();
          countParams.set('status', entryStatus);
          countParams.set('page', '1');
          countParams.set('limit', '1');
          if (debouncedSearch) countParams.set('search', debouncedSearch);
          return apiCall('get', `/media/loans?${countParams.toString()}`);
        })
      ]);
      setLoans(Array.isArray(payload?.items) ? payload.items : []);
      setPagination(payload?.pagination || { page: 1, limit: 25, total: 0, totalPages: 1, hasMore: false });
      setTotals({
        active: Number(countPayloads[0]?.pagination?.total || 0),
        overdue: Number(countPayloads[1]?.pagination?.total || 0),
        returned: Number(countPayloads[2]?.pagination?.total || 0),
        all: Number(countPayloads[3]?.pagination?.total || 0),
        dueSoon: Number(payload?.summary?.dueSoon || 0)
      });
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load loans');
      setLoans([]);
      setTotals({ active: 0, overdue: 0, returned: 0, all: 0, dueSoon: 0 });
    } finally {
      setLoading(false);
    }
  }, [apiCall, debouncedSearch, page, status]);

  useEffect(() => {
    loadLoans(page);
  }, [loadLoans, page]);

  useEffect(() => {
    setExpandedLoanId(null);
  }, [status, debouncedSearch, page]);

  const handleReturn = async (loanId) => {
    if (!loanId) return;
    setReturningLoanId(loanId);
    try {
      await apiCall('patch', `/media/loans/${loanId}/return`, { returned_at: new Date().toISOString().slice(0, 10) });
      onToast?.('Loan marked returned');
      await loadLoans(page);
      if (editingLoan && Number(editingLoan.id) === Number(loanId)) setEditingLoan(null);
    } catch (err) {
      onToast?.(err?.response?.data?.error || 'Failed to mark loan returned', 'error');
    } finally {
      setReturningLoanId(null);
    }
  };

  const handleSave = async (payload) => {
    if (!editingLoan?.id) return;
    setSavingLoan(true);
    try {
      await apiCall('patch', `/media/loans/${editingLoan.id}`, payload);
      onToast?.('Loan updated');
      setEditingLoan(null);
      await loadLoans(page);
    } catch (err) {
      onToast?.(err?.response?.data?.error || 'Failed to update loan', 'error');
    } finally {
      setSavingLoan(false);
    }
  };

  const handleSendReminder = async (loan) => {
    if (!loan?.id || remindingLoanId === loan.id) return;
    setRemindingLoanId(loan.id);
    try {
      await apiCall('post', `/media/loans/${loan.id}/reminder`, {});
      onToast?.('Reminder sent');
      await loadLoans(page);
      if (editingLoan && Number(editingLoan.id) === Number(loan.id)) {
        setEditingLoan(null);
      }
    } catch (err) {
      onToast?.(err?.response?.data?.error || 'Failed to send reminder', 'error');
    } finally {
      setRemindingLoanId(null);
    }
  };

  const loadMediaLoanHistory = useCallback(async (mediaId) => {
    if (!mediaId) return null;
    if (historyByMediaId[mediaId]) return historyByMediaId[mediaId];
    setHistoryLoadingMediaId(mediaId);
    try {
      const payload = await apiCall('get', `/media/${mediaId}/loans`);
      setHistoryByMediaId((current) => ({ ...current, [mediaId]: payload }));
      return payload;
    } catch (err) {
      onToast?.(err?.response?.data?.error || 'Failed to load loan history', 'error');
      return null;
    } finally {
      setHistoryLoadingMediaId((current) => (current === mediaId ? null : current));
    }
  }, [apiCall, historyByMediaId, onToast]);

  const toggleHistory = useCallback(async (loan) => {
    const loanId = Number(loan?.id || 0);
    const mediaId = Number(loan?.media?.id || 0);
    if (!loanId || !mediaId) return;
    if (expandedLoanId === loanId) {
      setExpandedLoanId(null);
      return;
    }
    setExpandedLoanId(loanId);
    await loadMediaLoanHistory(mediaId);
  }, [expandedLoanId, loadMediaLoanHistory]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-edge px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h1 className="section-title">Loans</h1>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-80">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ghost"><Icons.Search /></span>
              <input
                className="input w-full pl-9"
                placeholder="Search title or borrower"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <SectionTabs
            tabs={[
              { id: 'active', label: 'Active' },
              { id: 'overdue', label: 'Overdue' },
              { id: 'returned', label: 'Returned' },
              { id: 'all', label: 'All' }
            ]}
            activeId={status}
            onChange={setStatus}
            semantics="buttons"
            showDivider={false}
            ariaLabel="Loan status filters"
            className="w-fit"
          />
        </div>
        <div className="mt-4 overflow-hidden rounded-lg border border-edge bg-panel">
          <div className="grid grid-cols-2 sm:grid-cols-4">
            {[
              ['Currently out', totals.active, 'text-ink'],
              ['Overdue', totals.overdue, 'text-err'],
              ['Due soon', totals.dueSoon, 'text-ink'],
              ['Returned', totals.returned, 'text-ink']
            ].map(([label, value, valueClass], index) => (
              <div
                key={label}
                className={[
                  'px-4 py-3',
                  index > 0 ? 'border-t border-edge sm:border-t-0 sm:border-l' : ''
                ].join(' ')}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm text-dim">{label}</p>
                  <p className={`text-lg font-semibold ${valueClass}`}>{value}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {error ? <p className="mb-4 text-sm text-err">{error}</p> : null}
        {loading ? (
          <div className="flex items-center justify-center py-20"><Spinner size={32} /></div>
        ) : loans.length === 0 ? (
          <div className="rounded-lg border border-edge bg-panel px-6 py-10 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md border border-edge bg-abyss text-ghost">
              <Icons.Users />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-ink">No loans found</h2>
            <p className="mt-2 text-sm text-ghost">
              {status === 'returned'
                ? 'Returned loans will appear here once titles start coming back.'
                : 'Create a loan from a title detail drawer to start tracking borrowed items.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {loans.map((loan) => {
              const historyEntries = Array.isArray(historyByMediaId[loan?.media?.id]?.history)
                ? [...historyByMediaId[loan.media.id].history].sort(sortLoanHistoryEntries)
                : null;
              const currentHistoryCount = Array.isArray(historyEntries)
                ? historyEntries.filter((entry) => !entry.returned_at).length
                : 0;
              const returnedHistoryCount = Array.isArray(historyEntries)
                ? historyEntries.filter((entry) => Boolean(entry.returned_at)).length
                : 0;
              return (
              <div
                key={loan.id}
                className={[
                  'rounded-lg border bg-panel px-4 py-4',
                  loan.status === 'overdue'
                    ? 'border-err/35'
                    : 'border-edge'
                ].join(' ')}
              >
                <div className="flex gap-4">
                  <div className="h-20 w-14 shrink-0 overflow-hidden rounded-[4px] border border-edge bg-abyss">
                    {posterUrl(loan?.media?.poster_path)
                      ? <img src={posterUrl(loan.media.poster_path)} alt={loan?.media?.title || 'Loaned media'} className="h-full w-full object-cover" loading="lazy" />
                      : <div className="flex h-full w-full items-center justify-center text-ghost"><Icons.Library /></div>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="truncate text-base font-semibold text-ink">{loan?.media?.title || 'Loaned title'}</h2>
                          <span className={statusBadgeClass(loan.status)}>{statusLabel(loan.status)}</span>
                          {isDueSoon(loan) ? <span className="badge border border-edge bg-abyss text-dim">Due soon</span> : null}
                        </div>
                        <p className="mt-1 text-sm text-ghost">
                          {[loan?.borrower_name, loan?.loan_format, loan?.media?.year].filter(Boolean).join(' · ')}
                        </p>
                        {loan.borrower_email ? <p className="mt-1 text-sm text-dim">{loan.borrower_email}</p> : null}
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <button
                          className="btn-ghost"
                          onClick={() => toggleHistory(loan)}
                        >
                          {expandedLoanId === loan.id ? 'Hide History' : 'Show History'}
                        </button>
                        {!loan.returned_at ? (
                          <>
                            <button
                              className="btn-secondary"
                              onClick={() => handleSendReminder(loan)}
                              disabled={!loan.reminder_eligible || remindingLoanId === loan.id}
                            >
                              {remindingLoanId === loan.id
                                ? 'Sending…'
                                : loan.reminder_sent_today
                                  ? 'Sent Today'
                                  : 'Send Reminder'}
                            </button>
                            <button className="btn-secondary" onClick={() => setEditingLoan(loan)}>Edit</button>
                            <button
                              className="btn-primary"
                              onClick={() => handleReturn(loan.id)}
                              disabled={returningLoanId === loan.id}
                            >
                              {returningLoanId === loan.id ? 'Returning…' : 'Mark Returned'}
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>
                    <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                      <div>
                        <dt className="text-xs font-medium text-ghost">Loaned</dt>
                        <dd className="mt-1 text-ink">{formatDate(loan.loaned_at)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium text-ghost">Due Back</dt>
                        <dd className="mt-1 text-ink">{formatDate(loan.due_at)}</dd>
                        {relativeDueLabel(loan) ? (
                          <p className={loan.status === 'overdue' ? 'mt-1 text-xs text-err' : 'mt-1 text-xs text-dim'}>
                            {relativeDueLabel(loan)}
                          </p>
                        ) : null}
                      </div>
                      <div>
                        <dt className="text-xs font-medium text-ghost">Reminder</dt>
                        <dd className="mt-1 text-ink">
                          {loan.returned_at
                            ? 'Not needed'
                            : loan.reminder_sent_today
                              ? 'Sent today'
                              : reminderPhaseLabel(loan) || (loan.borrower_email ? 'Waiting' : 'Add email')}
                        </dd>
                        {loan.reminder_last_sent_at ? (
                          <p className="mt-1 text-xs text-dim">Last sent {formatReminderTimestamp(loan.reminder_last_sent_at)}</p>
                        ) : null}
                        {!loan.borrower_email && !loan.returned_at ? (
                          <p className="mt-1 text-xs text-dim">Add borrower email to send reminders.</p>
                        ) : null}
                      </div>
                      <div>
                        <dt className="text-xs font-medium text-ghost">Returned</dt>
                        <dd className="mt-1 text-ink">{loan.returned_at ? formatDate(loan.returned_at) : 'Still out'}</dd>
                      </div>
                    </dl>
                    {loan.notes ? <p className="mt-3 text-sm text-dim">{loan.notes}</p> : null}
                    {expandedLoanId === loan.id ? (
                      <div className="mt-4 border-t border-edge/70 pt-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm text-ink">Loan history</p>
                            <p className="mt-1 text-xs text-ghost">
                              {Array.isArray(historyEntries)
                                ? `${currentHistoryCount} current · ${returnedHistoryCount} returned`
                                : 'Tracking active and returned loan records for this title'}
                            </p>
                          </div>
                        </div>
                        {historyLoadingMediaId === Number(loan?.media?.id || 0) && !historyByMediaId[loan?.media?.id] ? (
                          <div className="mt-3 flex items-center gap-2 text-sm text-ghost"><Spinner size={16} />Loading history…</div>
                        ) : null}
                        {Array.isArray(historyEntries) ? (
                          <div className="mt-4 space-y-5">
                            <LoanHistorySection
                              title="Current"
                              loans={historyEntries.filter((entry) => !entry.returned_at)}
                              activeLoanId={loan.id}
                            />
                            <LoanHistorySection
                              title="Returned"
                              loans={historyEntries.filter((entry) => Boolean(entry.returned_at))}
                              activeLoanId={loan.id}
                            />
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
            })}
          </div>
        )}
      </div>

      <CollectionPaginationFooter
        page={pagination.page || page}
        totalPages={pagination.totalPages || 1}
        hasMore={pagination.hasMore}
        loading={loading}
        pageSize={pagination.limit || 25}
        pageSizeOptions={[25]}
        showPageSize={false}
        className="px-4 sm:px-6"
        leadingContent={`${pagination.total || 0} item${Number(pagination.total || 0) === 1 ? '' : 's'}`}
        onPrevious={() => setPage((value) => Math.max(1, value - 1))}
        onNext={() => setPage((value) => value + 1)}
      />

      {editingLoan ? (
        <LoanEditor
          loan={editingLoan}
          onClose={() => setEditingLoan(null)}
          onSave={handleSave}
          saving={savingLoan}
        />
      ) : null}
    </div>
  );
}
