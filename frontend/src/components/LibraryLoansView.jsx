import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { SectionTabs, posterUrl } from './app/AppPrimitives';

function formatDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '—';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleDateString();
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
  const [page, setPage] = useState(1);
  const [editingLoan, setEditingLoan] = useState(null);
  const [savingLoan, setSavingLoan] = useState(false);
  const [returningLoanId, setReturningLoanId] = useState(null);

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
      const payload = await apiCall('get', `/media/loans?${params.toString()}`);
      setLoans(Array.isArray(payload?.items) ? payload.items : []);
      setPagination(payload?.pagination || { page: 1, limit: 25, total: 0, totalPages: 1, hasMore: false });
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load loans');
      setLoans([]);
    } finally {
      setLoading(false);
    }
  }, [apiCall, debouncedSearch, page, status]);

  useEffect(() => {
    loadLoans(page);
  }, [loadLoans, page]);

  const summary = useMemo(() => {
    const counts = { active: 0, overdue: 0, returned: 0 };
    loans.forEach((loan) => {
      if (loan?.status === 'overdue') counts.overdue += 1;
      else if (loan?.status === 'returned') counts.returned += 1;
      else counts.active += 1;
    });
    return counts;
  }, [loans]);

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

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-edge px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h1 className="section-title">Loans</h1>
            <p className="mt-1 text-sm text-ghost">
              Track borrowed titles in {activeLibrary?.name ? `“${activeLibrary.name}”` : 'the active library'} without losing sight of what is due back next.
            </p>
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
          <div className="flex flex-wrap items-center gap-2 text-xs text-ghost">
            <span className="badge badge-dim">{summary.active} active</span>
            <span className="badge badge-dim">{summary.overdue} overdue</span>
            <span className="badge badge-dim">{summary.returned} returned</span>
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
            {loans.map((loan) => (
              <div key={loan.id} className="rounded-lg border border-edge bg-panel px-4 py-4">
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
                        </div>
                        <p className="mt-1 text-sm text-ghost">
                          {[loan?.borrower_name, loan?.loan_format, loan?.media?.year].filter(Boolean).join(' · ')}
                        </p>
                        {loan.borrower_email ? <p className="mt-1 text-sm text-dim">{loan.borrower_email}</p> : null}
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {!loan.returned_at ? (
                          <>
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
                      </div>
                      <div>
                        <dt className="text-xs font-medium text-ghost">Returned</dt>
                        <dd className="mt-1 text-ink">{loan.returned_at ? formatDate(loan.returned_at) : 'Still out'}</dd>
                      </div>
                    </dl>
                    {loan.notes ? <p className="mt-3 text-sm text-dim">{loan.notes}</p> : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-edge px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between text-sm text-ghost">
          <span>{pagination.total || 0} loan{Number(pagination.total || 0) === 1 ? '' : 's'}</span>
          <div className="flex items-center gap-2">
            <button className="btn-secondary" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={loading || page <= 1}>Previous</button>
            <span>Page {pagination.page || page} of {pagination.totalPages || 1}</span>
            <button className="btn-secondary" onClick={() => setPage((value) => value + 1)} disabled={loading || !pagination.hasMore}>Next</button>
          </div>
        </div>
      </div>

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
