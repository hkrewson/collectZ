import { useCallback, useState } from 'react';

const DEFAULT_SUPPORT_SUMMARY = {
  open: 0,
  answered: 0,
  closed: 0,
  bugs: 0,
  features: 0,
  metrics: {
    time_to_open_seconds: 0,
    time_to_close_seconds: 0,
    closed_this_month: 0
  }
};

function normalizeSupportSummary(payload) {
  const nextQueue = payload?.queue || {};
  const nextMetrics = payload?.metrics || {};
  return {
    open: Number(nextQueue.open || 0),
    answered: Number(nextQueue.answered || 0),
    closed: Number(nextQueue.closed || 0),
    bugs: Number(nextQueue.bugs || 0),
    features: Number(nextQueue.features || 0),
    metrics: {
      time_to_open_seconds: Number(nextMetrics.time_to_open_seconds || 0),
      time_to_close_seconds: Number(nextMetrics.time_to_close_seconds || 0),
      closed_this_month: Number(nextMetrics.closed_this_month || 0)
    }
  };
}

export default function useSupportSummary({ apiCall, showToast, supportStaffInEdition }) {
  const [supportSummary, setSupportSummary] = useState(DEFAULT_SUPPORT_SUMMARY);

  const loadSupportSummary = useCallback(async ({ silent = false } = {}) => {
    if (!supportStaffInEdition) {
      setSupportSummary(DEFAULT_SUPPORT_SUMMARY);
      return null;
    }
    try {
      const payload = await apiCall('get', '/support/staff/summary');
      const normalized = normalizeSupportSummary(payload);
      setSupportSummary(normalized);
      return normalized;
    } catch (error) {
      if (!silent) {
        showToast(error.response?.data?.error || 'Failed to load support summary', 'error');
      }
      return null;
    }
  }, [apiCall, showToast, supportStaffInEdition]);

  return { supportSummary, loadSupportSummary };
}
