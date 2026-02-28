import React, { useEffect } from 'react';

export function routeFromPath(p) {
  if (p === '/register') return 'register';
  if (p === '/reset-password') return 'reset';
  if (
    p === '/dashboard' ||
    p.startsWith('/dashboard/') ||
    p.startsWith('/admin/') ||
    p.startsWith('/library/')
  ) return 'dashboard';
  return 'login';
}

export function posterUrl(path) {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  if (path.startsWith('/uploads/') || path.startsWith('/')) {
    if (path.startsWith('/t/') || path.match(/\/p\//)) return `https://image.tmdb.org/t/p/w500${path}`;
    if (path.startsWith('/uploads/')) return path;
    return `https://image.tmdb.org/t/p/w500${path}`;
  }
  return path;
}

export function cx(...classes) {
  return classes.filter(Boolean).join(' ');
}

export function inferTmdbSearchType(mediaType) {
  return mediaType === 'tv_series' || mediaType === 'tv_episode' ? 'tv' : 'movie';
}

export const MEDIA_TYPES = [
  { value: 'movie', label: 'Movie' },
  { value: 'tv_series', label: 'TV Series' },
  { value: 'book', label: 'Book' },
  { value: 'audio', label: 'Audio' },
  { value: 'game', label: 'Game' },
  { value: 'comic_book', label: 'Comic Book' }
];

export function mediaTypeLabel(value) {
  return MEDIA_TYPES.find((m) => m.value === value)?.label || 'Comic Book';
}

export function readCookie(name) {
  const raw = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${name}=`));
  if (!raw) return '';
  try {
    return decodeURIComponent(raw.split('=').slice(1).join('='));
  } catch (_) {
    return raw.split('=').slice(1).join('=');
  }
}

export function isInteractiveTarget(target) {
  return Boolean(target?.closest?.('button,a,input,select,textarea,label,[role="button"]'));
}

const Icon = ({ d, size = 20, className = '', strokeWidth = 1.75 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round"
    strokeLinejoin="round" className={className}>
    <path d={d} />
  </svg>
);

export const Icons = {
  Library:     () => <Icon d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />,
  Plus:        () => <Icon d="M12 5v14M5 12h14" />,
  Search:      () => <Icon d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />,
  Settings:    () => <Icon d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />,
  Users:       () => <Icon d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />,
  Activity:    () => <Icon d="M3 12h4l2.5-7 4 14 2.5-7H21" />,
  List:        () => <Icon d="M4 7h16M4 12h16M4 17h16" />,
  Profile:     () => <Icon d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />,
  Integrations:() => <Icon d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 17h6M17 14v6" />,
  ChevronDown: () => <Icon d="M6 9l6 6 6-6" size={16} />,
  ChevronRight:() => <Icon d="M9 18l6-6-6-6" size={16} />,
  ChevronLeft: () => <Icon d="M15 18l-6-6 6-6" size={16} />,
  Menu:        () => <Icon d="M3 12h18M3 6h18M3 18h18" />,
  X:           () => <Icon d="M18 6L6 18M6 6l12 12" />,
  Trash:       () => <Icon d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M9 6V4h6v2" />,
  Edit:        () => <Icon d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />,
  Film:        () => <Icon d="M2 8h20M2 16h20M7 2v20M17 2v20M2 4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4z" />,
  Barcode:     () => <Icon d="M3 5v14M7 5v14M11 5v14M15 5v14M19 5v14M21 5v14" />,
  Eye:         () => <Icon d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />,
  EyeOff:      () => <Icon d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22" />,
  Upload:      () => <Icon d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />,
  Download:    () => <Icon d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />,
  Star:        () => <Icon d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />,
  LogOut:      () => <Icon d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
  Copy:        () => <Icon d="M20 9H11a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 0 2 2v1" />,
  Check:       () => <Icon d="M20 6L9 17l-5-5" />,
  Refresh:     () => <Icon d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />,
  Play:        () => <Icon d="M5 3l14 9-14 9V3z" />,
  Link:        () => <Icon d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />,
  ArrowUp:     () => <Icon d="M12 19V5M5 12l7-7 7 7" />,
  ArrowDown:   () => <Icon d="M12 5v14M19 12l-7 7-7-7" />,
};

export function Spinner({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin text-gold" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" strokeLinecap="round" />
    </svg>
  );
}

export function Toast({ message, type = 'ok', onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3500);
    return () => clearTimeout(t);
  }, [onDismiss]);
  const styles = {
    ok: 'border-ok/30 bg-ok/10 text-ok',
    error: 'border-err/30 bg-err/10 text-err',
    info: 'border-gold/30 bg-gold/10 text-gold'
  };
  return (
    <div className={cx('fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-lg border shadow-deep animate-slide-up', styles[type] || styles.ok)}>
      <span className="text-sm font-medium">{message}</span>
      <button onClick={onDismiss} className="ml-2 opacity-60 hover:opacity-100"><Icons.X /></button>
    </div>
  );
}

export function ImportStatusDock({ jobs = [], onDismiss }) {
  if (!jobs.length) return null;
  return (
    <div className="fixed bottom-6 left-6 z-50 w-96 max-w-[calc(100vw-3rem)] space-y-2">
      {jobs.map((job) => {
        const provider = String(job.provider || '').toLowerCase();
        const label = provider === 'plex'
          ? 'Plex Import'
          : provider === 'csv_delicious'
            ? 'Delicious CSV Import'
            : provider === 'csv_generic'
              ? 'CSV Import'
              : 'Import Job';
        const isDone = job.status === 'succeeded' || job.status === 'failed';
        const p = job.progress || {};
        const s = job.summary || {};
        return (
          <div key={job.id} className="card p-3 border border-edge shadow-deep">
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-dim font-medium">{label} #{job.id} · {job.status}</p>
                {isDone ? (
                  <p className="text-xs text-ghost mt-1">Created {s.created || 0} · Updated {s.updated || 0} · Errors {s.errorCount || 0}</p>
                ) : (
                  <p className="text-xs text-ghost mt-1">Processed {p.processed || 0}/{p.total || 0} · Created {p.created || 0} · Updated {p.updated || 0} · Errors {p.errorCount || 0}</p>
                )}
                {job.error && <p className="text-xs text-err mt-1">{job.error}</p>}
              </div>
              {isDone && <button onClick={() => onDismiss(job.id)} className="btn-icon btn-sm shrink-0"><Icons.X /></button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
