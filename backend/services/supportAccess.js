'use strict';

const SUPPORT_ACCESS_APPROVAL_TTL_DAYS = 14;
const SUPPORT_ACCESS_APPROVAL_TTL_MS = SUPPORT_ACCESS_APPROVAL_TTL_DAYS * 24 * 60 * 60 * 1000;

function getSupportAccessExpiryTimestamp(approvedAt) {
  if (!approvedAt) return null;
  const approvedAtMs = new Date(approvedAt).getTime();
  if (!Number.isFinite(approvedAtMs)) return null;
  return new Date(approvedAtMs + SUPPORT_ACCESS_APPROVAL_TTL_MS).toISOString();
}

function getEffectiveSupportAccessStatus({ status, approvedAt, requestStatus, now = new Date() }) {
  const normalizedStatus = String(status || 'not_requested').trim().toLowerCase();
  if (normalizedStatus !== 'approved') {
    return ['revoked', 'not_requested'].includes(normalizedStatus) ? normalizedStatus : 'not_requested';
  }
  if (String(requestStatus || '').trim().toLowerCase() === 'closed') {
    return 'expired';
  }
  const expiresAt = getSupportAccessExpiryTimestamp(approvedAt);
  if (!expiresAt) return 'expired';
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const expiresAtMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(nowMs) || !Number.isFinite(expiresAtMs)) return 'expired';
  return expiresAtMs > nowMs ? 'approved' : 'expired';
}

function isSupportAccessApprovalActive(input) {
  return getEffectiveSupportAccessStatus(input) === 'approved';
}

module.exports = {
  SUPPORT_ACCESS_APPROVAL_TTL_DAYS,
  SUPPORT_ACCESS_APPROVAL_TTL_MS,
  getSupportAccessExpiryTimestamp,
  getEffectiveSupportAccessStatus,
  isSupportAccessApprovalActive
};
