import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const IMPORT_JOBS_KEY = 'collectz_import_jobs';
const IMPORT_POLL_LEADER_KEY = 'collectz_import_poll_leader';
const IMPORT_POLL_LAST_TS_KEY = 'collectz_import_poll_last_ts';
const IMPORT_POLL_HEARTBEAT_MS = 8000;
const IMPORT_POLL_STALE_MS = 25000;
const IMPORT_POLL_INTERVAL_MS = 10000;

function readStoredJobs() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(IMPORT_JOBS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function useImportJobPolling({ user, apiCall }) {
  const [importJobs, setImportJobs] = useState(readStoredJobs);
  const [isImportPollLeader, setIsImportPollLeader] = useState(false);
  const tabIdRef = useRef(`tab-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`);

  const hasActiveImportJobs = useMemo(
    () => importJobs.some((job) => job.status === 'queued' || job.status === 'running'),
    [importJobs]
  );

  const isForegroundTab = useCallback(
    () => typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus(),
    []
  );

  const releaseImportPollLeader = useCallback(() => {
    try {
      const raw = localStorage.getItem(IMPORT_POLL_LEADER_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.tabId === tabIdRef.current) localStorage.removeItem(IMPORT_POLL_LEADER_KEY);
    } catch (_) {}
    setIsImportPollLeader(false);
  }, []);

  const claimImportPollLeader = useCallback(() => {
    if (!isForegroundTab()) {
      setIsImportPollLeader(false);
      return false;
    }
    try {
      const now = Date.now();
      const raw = localStorage.getItem(IMPORT_POLL_LEADER_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      const stale = !parsed?.tabId || !parsed?.ts || (now - Number(parsed.ts)) > IMPORT_POLL_STALE_MS;
      if (stale || parsed.tabId === tabIdRef.current) {
        localStorage.setItem(IMPORT_POLL_LEADER_KEY, JSON.stringify({ tabId: tabIdRef.current, ts: now }));
        setIsImportPollLeader(true);
        return true;
      }
    } catch (_) {}
    setIsImportPollLeader(false);
    return false;
  }, [isForegroundTab]);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return undefined;
    const onVisibilityChange = () => {
      if (isForegroundTab()) claimImportPollLeader();
      else releaseImportPollLeader();
    };
    const onFocus = () => claimImportPollLeader();
    const onBlur = () => releaseImportPollLeader();
    const onBeforeUnload = () => releaseImportPollLeader();
    const onStorage = (event) => {
      if (event.key !== IMPORT_POLL_LEADER_KEY) return;
      if (isForegroundTab()) claimImportPollLeader();
      else setIsImportPollLeader(false);
    };

    claimImportPollLeader();
    const heartbeat = setInterval(() => {
      if (isForegroundTab()) claimImportPollLeader();
    }, IMPORT_POLL_HEARTBEAT_MS);

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('storage', onStorage);

    return () => {
      clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('storage', onStorage);
      releaseImportPollLeader();
    };
  }, [claimImportPollLeader, isForegroundTab, releaseImportPollLeader]);

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(IMPORT_JOBS_KEY, JSON.stringify(importJobs));
  }, [importJobs]);

  useEffect(() => {
    if (!user || !hasActiveImportJobs || !isImportPollLeader) return undefined;

    let cancelled = false;
    const poll = async () => {
      if (!claimImportPollLeader()) return;
      const now = Date.now();
      try {
        const lastPollTs = Number(localStorage.getItem(IMPORT_POLL_LAST_TS_KEY) || 0);
        if (Number.isFinite(lastPollTs) && lastPollTs > 0 && now - lastPollTs < 6000) return;
        localStorage.setItem(IMPORT_POLL_LAST_TS_KEY, String(now));
      } catch (_) {}

      try {
        const rows = await apiCall('get', '/media/sync-jobs?limit=50');
        if (cancelled || !Array.isArray(rows)) return;
        const byId = new Map(rows.map((r) => [Number(r.id), r]));
        setImportJobs((prev) => prev.map((job) => {
          const fresh = byId.get(Number(job.id));
          return fresh ? { ...job, ...fresh } : job;
        }));
      } catch (err) {
        if (err?.response?.status === 401 || err?.response?.status === 429) return;
      }
    };

    poll();
    const timer = setInterval(poll, IMPORT_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [apiCall, claimImportPollLeader, user, hasActiveImportJobs, isImportPollLeader]);

  const upsertImportJob = useCallback((job) => {
    if (!job?.id) return;
    setImportJobs((prev) => {
      const next = [...prev];
      const idx = next.findIndex((j) => Number(j.id) === Number(job.id));
      if (idx >= 0) next[idx] = { ...next[idx], ...job };
      else next.unshift(job);
      return next.slice(0, 30);
    });
  }, []);

  const dismissImportJob = useCallback((jobId) => {
    setImportJobs((prev) => prev.filter((job) => Number(job.id) !== Number(jobId)));
  }, []);

  const clearImportJobs = useCallback(() => {
    setImportJobs([]);
    if (typeof localStorage !== 'undefined') localStorage.removeItem(IMPORT_JOBS_KEY);
  }, []);

  return {
    importJobs,
    upsertImportJob,
    dismissImportJob,
    clearImportJobs
  };
}
