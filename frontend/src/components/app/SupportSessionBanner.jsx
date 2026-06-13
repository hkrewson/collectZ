import React from 'react';
import { isSupportHelpEnabled, SUPPORT_STAFF_ROLE } from './productEdition';

export default function SupportSessionBanner({
  user,
  productEdition,
  supportSession,
  libraries,
  activeLibrary,
  activeLibraryId,
  handleLibrarySelect,
  endSupportSession,
  Icons
}) {
  const supportStaffInEdition = isSupportHelpEnabled(productEdition)
    && ['admin', SUPPORT_STAFF_ROLE].includes(String(user?.role || ''));

  if (!supportStaffInEdition || !supportSession?.active) {
    return null;
  }

  return (
    <div className="border-b border-amber-300/20 bg-amber-400/6">
      <div className="flex flex-col gap-3 px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded border border-amber-300/20 bg-amber-400/8 text-amber-100/90">
            <Icons.Activity />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-amber-50">Support session active</p>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="text-sm text-amber-100/90 truncate">{supportSession.space_name || 'Scoped tenant access'}</p>
              {(supportSession.library_name || activeLibrary) ? (
                <span className="text-xs text-amber-100/70">Library: {supportSession.library_name || activeLibrary?.name}</span>
              ) : null}
            </div>
            <p className="text-xs text-amber-100/70 max-w-3xl">
              You are working inside tenant support scope. End the session when you are done.
            </p>
            {supportSession.started_at ? (
              <p className="text-xs text-amber-100/80 truncate">Started: {new Date(supportSession.started_at).toLocaleString()}</p>
            ) : null}
            {supportSession.reason ? (
              <p className="text-xs text-amber-100/80 truncate">Reason: {supportSession.reason}</p>
            ) : null}
            {supportSession.request_key ? (
              <p className="text-xs text-amber-100/80 truncate">Request: {supportSession.request_key}</p>
            ) : null}
            {supportSession.request_subject ? (
              <p className="text-xs text-amber-100/80 truncate">Case: {supportSession.request_subject}</p>
            ) : null}
            {(supportSession.requester_name || supportSession.requester_email) ? (
              <p className="text-xs text-amber-100/80 truncate">
                Requester: {supportSession.requester_name || supportSession.requester_email}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-end justify-end gap-2 shrink-0">
          {libraries.length > 1 ? (
            <label className="field min-w-[220px]">
              <span className="text-[11px] font-medium text-amber-100/75">Support library</span>
              <select
                className="select border-amber-300/25 bg-amber-400/5 text-amber-50"
                value={activeLibraryId || ''}
                onChange={(e) => handleLibrarySelect(e.target.value)}
              >
                {libraries.map((library) => (
                  <option key={library.id} value={library.id}>
                    {library.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            type="button"
            className="btn-secondary btn-sm shrink-0 border-amber-300/25 bg-amber-400/5 text-amber-50 hover:bg-amber-400/10"
            onClick={endSupportSession}
          >
            End support session
          </button>
        </div>
      </div>
    </div>
  );
}
