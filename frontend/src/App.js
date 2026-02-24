import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import appMeta from './app-meta.json';
import AdminActivityView from './components/AdminActivityView';
import AuthPageView from './components/AuthPage';
import ImportViewComponent from './components/ImportView';
import AdminFeatureFlagsView from './components/AdminFeatureFlagsView';
import ProfileViewComponent from './components/ProfileView';
import AdminUsersView from './components/AdminUsersView';
import AdminSettingsView from './components/AdminSettingsView';
import AdminIntegrationsView from './components/AdminIntegrationsView';

const API_URL = process.env.REACT_APP_API_URL || '/api';
const APP_VERSION = process.env.REACT_APP_VERSION || appMeta.version || '1.9.20';
const BUILD_SHA   = process.env.REACT_APP_GIT_SHA || appMeta?.build?.gitShaDefault || 'dev';
const IMPORT_JOBS_KEY = 'collectz_import_jobs';
const IMPORT_POLL_LEADER_KEY = 'collectz_import_poll_leader';
const IMPORT_POLL_LAST_TS_KEY = 'collectz_import_poll_last_ts';
const IMPORT_POLL_HEARTBEAT_MS = 8000;
const IMPORT_POLL_STALE_MS = 25000;
const IMPORT_POLL_INTERVAL_MS = 10000;

const MEDIA_FORMATS = ['VHS', 'Blu-ray', 'Digital', 'DVD', '4K UHD'];
const MEDIA_TYPES = [
  { value: 'movie', label: 'Movie' },
  { value: 'tv_series', label: 'TV Series' },
  { value: 'other', label: 'Other' }
];

const DEFAULT_MEDIA_FORM = {
  media_type:'movie',
  title:'',original_title:'',release_date:'',year:'',format:'Blu-ray',genre:'',
  director:'',rating:'',user_rating:0,runtime:'',upc:'',location:'',notes:'',
  overview:'',tmdb_id:'',tmdb_media_type:'movie',tmdb_url:'',trailer_url:'',poster_path:'',backdrop_path:'',
  season_number:'',episode_number:'',episode_title:'',network:''
};

// ─── Utilities ───────────────────────────────────────────────────────────────

function routeFromPath(p) {
  if (p === '/register') return 'register';
  if (p === '/reset-password') return 'reset';
  if (p === '/dashboard') return 'dashboard';
  return 'login';
}

function posterUrl(path) {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  if (path.startsWith('/uploads/') || path.startsWith('/')) {
    if (path.startsWith('/t/') || path.match(/\/p\//)) return `https://image.tmdb.org/t/p/w500${path}`;
    if (path.startsWith('/uploads/')) return path;
    return `https://image.tmdb.org/t/p/w500${path}`;
  }
  return path;
}

function cx(...classes) { return classes.filter(Boolean).join(' '); }

function inferTmdbSearchType(mediaType) {
  return mediaType === 'tv_series' || mediaType === 'tv_episode' ? 'tv' : 'movie';
}

function mediaTypeLabel(value) {
  return MEDIA_TYPES.find((m) => m.value === value)?.label || 'Movie';
}

function readCookie(name) {
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

function isInteractiveTarget(target) {
  return Boolean(target?.closest?.('button,a,input,select,textarea,label,[role="button"]'));
}

// ─── Icons ───────────────────────────────────────────────────────────────────

const Icon = ({ d, size = 20, className = '', strokeWidth = 1.75 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round"
    strokeLinejoin="round" className={className}>
    <path d={d} />
  </svg>
);

const Icons = {
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

// ─── Shared components ────────────────────────────────────────────────────────

function StarRating({ value = 0, onChange, readOnly = false }) {
  const safe = Number(value) || 0;
  return (
    <div className="star-wrap">
      {[1,2,3,4,5].map(star => {
        const fill = safe >= star ? 1 : safe >= star - 0.5 ? 0.5 : 0;
        return (
          <button key={star} type="button" disabled={readOnly}
            className={cx('star-btn', !readOnly && 'hover:scale-110 transition-transform')}
            onClick={e => {
              if (readOnly || !onChange) return;
              const half = e.clientX - e.currentTarget.getBoundingClientRect().left < e.currentTarget.offsetWidth / 2;
              onChange(half ? star - 0.5 : star);
            }}>
            <span className="star-base">★</span>
            <span className="star-fill" style={{ width: `${fill * 100}%` }}>★</span>
          </button>
        );
      })}
      <span className="ml-1.5 text-xs text-ghost font-mono">{safe.toFixed(1)}</span>
    </div>
  );
}

function Spinner({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin text-gold" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" strokeLinecap="round" />
    </svg>
  );
}

function EmptyState({ icon, title, subtitle, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
      <div className="w-16 h-16 rounded-2xl bg-raised border border-edge flex items-center justify-center text-ghost">
        {icon}
      </div>
      <div>
        <p className="font-display text-2xl tracking-wider text-dim">{title}</p>
        {subtitle && <p className="text-sm text-ghost mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function LabeledField({ label, className = '', children }) {
  return (
    <div className={cx('field', className)}>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

function Toast({ message, type = 'ok', onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3500);
    return () => clearTimeout(t);
  }, [onDismiss]);
  const styles = { ok: 'border-ok/30 bg-ok/10 text-ok', error: 'border-err/30 bg-err/10 text-err', info: 'border-gold/30 bg-gold/10 text-gold' };
  return (
    <div className={cx('fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-lg border shadow-deep animate-slide-up', styles[type] || styles.ok)}>
      <span className="text-sm font-medium">{message}</span>
      <button onClick={onDismiss} className="ml-2 opacity-60 hover:opacity-100"><Icons.X /></button>
    </div>
  );
}

function ImportStatusDock({ jobs = [], onDismiss }) {
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
                  <p className="text-xs text-ghost mt-1">
                    Created {s.created || 0} · Updated {s.updated || 0} · Errors {s.errorCount || 0}
                  </p>
                ) : (
                  <p className="text-xs text-ghost mt-1">
                    Processed {p.processed || 0}/{p.total || 0} · Created {p.created || 0} · Updated {p.updated || 0} · Errors {p.errorCount || 0}
                  </p>
                )}
                {job.error && <p className="text-xs text-err mt-1">{job.error}</p>}
              </div>
              {isDone && (
                <button onClick={() => onDismiss(job.id)} className="btn-icon btn-sm shrink-0"><Icons.X /></button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Auth pages ───────────────────────────────────────────────────────────────

function AuthPage({ route, onNavigate, onAuth }) {
  return (
    <AuthPageView
      route={route}
      onNavigate={onNavigate}
      onAuth={onAuth}
      apiUrl={API_URL}
      appVersion={APP_VERSION}
      buildSha={BUILD_SHA}
      Icons={Icons}
      Spinner={Spinner}
      cx={cx}
    />
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({ user, activeTab, onSelect, onLogout, collapsed, onToggle, mobileOpen, onMobileClose }) {
  const isAdmin = user?.role === 'admin';
  const [adminOpen, setAdminOpen] = useState(true);
  const [libraryOpen, setLibraryOpen] = useState(true);
  const isLibraryActive = ['library', 'library-movies', 'library-tv', 'library-other'].includes(activeTab);

  const NavLink = ({ id, icon, label, sub = false }) => {
    const active = activeTab === id;
    return (
      <button onClick={() => { onSelect(id); onMobileClose(); }}
        className={cx(
          'w-full flex items-center gap-3 rounded transition-all duration-150 text-left',
          sub ? 'pl-8 pr-3 py-2 text-xs' : 'px-3 py-2.5 text-sm font-medium',
          active ? 'bg-raised border border-edge text-ink' : 'text-dim hover:text-ink hover:bg-raised/50',
          collapsed && !sub && 'justify-center px-0'
        )}>
        {!sub && <span className={cx('shrink-0', active && 'text-gold')}>{icon}</span>}
        {sub && <span className="w-1 h-1 rounded-full bg-current mr-1 opacity-50" />}
        {(!collapsed || sub) && <span className="truncate">{label}</span>}
        {!collapsed && !sub && active && <span className="ml-auto w-1 h-4 rounded-full bg-gold" />}
      </button>
    );
  };

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && <div className="fixed inset-0 bg-void/80 z-30 lg:hidden" onClick={onMobileClose} />}

      <aside className={cx(
        'fixed top-0 left-0 h-full bg-abyss border-r border-edge flex flex-col z-40',
        'transition-all duration-300',
        collapsed ? 'w-16' : 'w-56',
        mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      )}>
        {/* Logo */}
        <div className={cx('flex items-center gap-3 px-4 py-5 border-b border-edge shrink-0', collapsed && 'justify-center px-0')}>
          <div className="w-8 h-8 rounded bg-gold flex items-center justify-center text-void font-display text-sm shrink-0">C</div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="font-display text-base tracking-wider text-ink leading-none">COLLECTZ</div>
              <div className="text-ghost text-[10px] font-mono mt-0.5">v{APP_VERSION}</div>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto no-scrollbar">
          <div>
            <button onClick={() => { if (collapsed) onSelect('library-movies'); else setLibraryOpen(o => !o); }}
              className={cx(
                'w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded transition-all',
                isLibraryActive ? 'bg-raised border border-edge text-ink' : 'text-dim hover:text-ink hover:bg-raised/50',
                collapsed && 'justify-center px-0'
              )}>
              <span className={cx('shrink-0', isLibraryActive && 'text-gold')}><Icons.Library /></span>
              {!collapsed && <>
                <span className="flex-1 text-left">Library</span>
                <span className={cx('transition-transform duration-200', libraryOpen && 'rotate-180')}><Icons.ChevronDown /></span>
              </>}
            </button>
            {libraryOpen && !collapsed && (
              <div className="mt-1 space-y-0.5">
                <NavLink id="library-movies" icon={null} label="Movies" sub />
                <NavLink id="library-tv" icon={null} label="TV" sub />
                <NavLink id="library-other" icon={null} label="Other" sub />
              </div>
            )}
          </div>
          <NavLink id="library-import" icon={<Icons.Upload />} label="Import" />

          {isAdmin && (
            <div>
              <button onClick={() => setAdminOpen(o => !o)}
                className={cx('w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded text-dim hover:text-ink hover:bg-raised/50 transition-all',
                  collapsed && 'justify-center px-0')}>
                <span className="shrink-0"><Icons.Settings /></span>
                {!collapsed && <>
                  <span className="flex-1 text-left">Admin</span>
                  <span className={cx('transition-transform duration-200', adminOpen && 'rotate-180')}><Icons.ChevronDown /></span>
                </>}
              </button>
              {adminOpen && !collapsed && (
                <div className="mt-1 space-y-0.5">
                  <NavLink id="admin-integrations" icon={null} label="Integrations" sub />
                  <NavLink id="admin-settings"     icon={null} label="Settings"     sub />
                  <NavLink id="admin-flags"        icon={null} label="Feature Flags" sub />
                  <NavLink id="admin-users"         icon={null} label="Members"      sub />
                  <NavLink id="admin-activity"      icon={null} label="Activity"     sub />
                </div>
              )}
            </div>
          )}

          <NavLink id="profile" icon={<Icons.Profile />} label="Profile" />
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-edge shrink-0 space-y-1">
          <button onClick={onLogout}
            className={cx('w-full flex items-center gap-3 px-3 py-2.5 text-sm text-dim hover:text-err rounded hover:bg-err/10 transition-all', collapsed && 'justify-center px-0')}>
            <Icons.LogOut />
            {!collapsed && <span>Sign out</span>}
          </button>
          <button onClick={onToggle}
            className={cx('w-full flex items-center gap-3 px-3 py-2 text-xs text-ghost hover:text-dim rounded hover:bg-raised/50 transition-all', collapsed && 'justify-center px-0')}>
            {collapsed ? <Icons.ChevronRight /> : <><Icons.ChevronLeft /><span>Collapse</span></>}
          </button>
        </div>
      </aside>
    </>
  );
}

// ─── Media card ───────────────────────────────────────────────────────────────

function MediaCard({ item, onOpen, onEdit, onDelete, onRating, supportsHover }) {
  const onPointerUp = (e) => {
    if (e.pointerType !== 'touch') return;
    if (isInteractiveTarget(e.target)) return;
    onOpen(item);
  };
  return (
    <article
      className="group relative cursor-pointer animate-fade-in"
      onClick={() => onOpen(item)}
      onPointerUp={onPointerUp}>
      {/* Poster */}
      <div className="poster rounded-lg overflow-hidden shadow-card">
        {posterUrl(item.poster_path)
          ? <img src={posterUrl(item.poster_path)} alt={item.title} className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" />
          : <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-ghost">
              <Icons.Film />
              <span className="text-xs text-center px-3 leading-tight">{item.title}</span>
            </div>
        }
        {/* Overlay on hover */}
        <div className={cx(
          'absolute inset-0 bg-card-fade transition-opacity duration-300',
          supportsHover ? 'opacity-0 group-hover:opacity-100' : 'opacity-10'
        )} />
        {/* Format badge */}
        <div className="absolute top-2 left-2">
          <span className="badge badge-dim text-[10px] backdrop-blur-sm bg-void/60 border-ghost/20">{item.format || '—'}</span>
        </div>
        <div className="absolute top-2 right-2">
          <span className="badge badge-dim text-[10px] backdrop-blur-sm bg-void/60 border-ghost/20">{mediaTypeLabel(item.media_type)}</span>
        </div>
        {/* Actions on hover */}
        <div className={cx(
          'absolute bottom-0 left-0 right-0 p-3 transition-all duration-300',
          supportsHover ? 'translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100' : 'translate-y-0 opacity-100'
        )}>
          <div className="flex gap-2">
            <button onClick={e => { e.stopPropagation(); onEdit(item); }}
              className="btn-secondary btn-sm flex-1 backdrop-blur-sm bg-void/60 border-ghost/30">
              <Icons.Edit />Edit
            </button>
            <button onClick={e => { e.stopPropagation(); onDelete(item.id); }}
              className="btn-icon btn-sm backdrop-blur-sm bg-void/60 border-ghost/30 text-err hover:bg-err/20">
              <Icons.Trash />
            </button>
          </div>
        </div>
      </div>
      {/* Title below */}
      <div className="mt-2 px-0.5">
        <p className="text-sm font-medium text-ink truncate">{item.title}</p>
        <p className="text-xs text-ghost">{item.year || '—'}{item.director ? ` · ${item.director}` : ''}</p>
        <div className="mt-1" onClick={e => e.stopPropagation()}>
          <StarRating value={item.user_rating || 0} onChange={r => onRating(item.id, r)} />
        </div>
      </div>
    </article>
  );
}

// ─── Media list row ───────────────────────────────────────────────────────────

function MediaListRow({ item, onOpen, onEdit, onDelete, onRating, supportsHover }) {
  const onPointerUp = (e) => {
    if (e.pointerType !== 'touch') return;
    if (isInteractiveTarget(e.target)) return;
    onOpen(item);
  };
  return (
    <article onClick={() => onOpen(item)}
      onPointerUp={onPointerUp}
      className="group flex items-center gap-4 p-3 rounded-lg bg-surface border border-edge hover:border-muted hover:bg-raised cursor-pointer transition-all duration-150 animate-fade-in">
      <div className="w-10 shrink-0" style={{ aspectRatio: '2/3' }}>
        <div className="poster rounded w-full h-full">
          {posterUrl(item.poster_path)
            ? <img src={posterUrl(item.poster_path)} alt={item.title} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
            : <div className="absolute inset-0 flex items-center justify-center text-ghost"><Icons.Film /></div>
          }
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-ink truncate">{item.title}</p>
        <p className="text-sm text-ghost">{[item.year, item.format, mediaTypeLabel(item.media_type), item.director].filter(Boolean).join(' · ')}</p>
        {item.genre && <p className="text-xs text-ghost/70 mt-0.5 truncate">{item.genre}</p>}
      </div>
      <div onClick={e => e.stopPropagation()}>
        <StarRating value={item.user_rating || 0} onChange={r => onRating(item.id, r)} />
      </div>
      <div className={cx('flex gap-2 transition-opacity duration-150', supportsHover ? 'opacity-0 group-hover:opacity-100' : 'opacity-100')}>
        <button onClick={e => { e.stopPropagation(); onEdit(item); }} className="btn-ghost btn-sm"><Icons.Edit /></button>
        <button onClick={e => { e.stopPropagation(); onDelete(item.id); }} className="btn-ghost btn-sm text-err hover:bg-err/10"><Icons.Trash /></button>
      </div>
    </article>
  );
}

// ─── Media detail drawer ──────────────────────────────────────────────────────

function MediaDetail({ item, onClose, onEdit, onDelete, onRating, apiCall }) {
  const [variants, setVariants] = useState([]);
  const [variantLoading, setVariantLoading] = useState(false);
  useEffect(() => {
    if (!item?.id) {
      setVariants([]);
      setVariantLoading(false);
      return;
    }
    let active = true;
    setVariantLoading(true);
    apiCall('get', `/media/${item.id}/variants`)
      .then((rows) => { if (active) setVariants(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (active) setVariants([]); })
      .finally(() => { if (active) setVariantLoading(false); });
    return () => { active = false; };
  }, [apiCall, item?.id]);
  if (!item) return null;
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-void/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-xl h-full bg-abyss border-l border-edge flex flex-col animate-slide-in">
        {/* Backdrop hero */}
        {posterUrl(item.backdrop_path) && (
          <div className="relative h-48 shrink-0 overflow-hidden">
            <img src={posterUrl(item.backdrop_path)} alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-hero-fade" />
          </div>
        )}
        {/* Header */}
        <div className="flex items-start gap-4 px-6 pt-6 pb-4 shrink-0">
          <div className="w-20 shrink-0 -mt-16 relative z-10 shadow-deep">
            <div className="poster rounded-md">
              {posterUrl(item.poster_path)
                ? <img src={posterUrl(item.poster_path)} alt={item.title} className="absolute inset-0 w-full h-full object-cover" />
                : <div className="absolute inset-0 flex items-center justify-center text-ghost"><Icons.Film /></div>
              }
            </div>
          </div>
          <div className="flex-1 min-w-0 mt-1">
            <h2 className="font-display text-2xl tracking-wider text-ink leading-tight">{item.title}</h2>
            <p className="text-sm text-dim mt-1">{[item.year, item.director].filter(Boolean).join(' · ')}</p>
            <div className="flex flex-wrap gap-2 mt-2">
              {item.format && <span className="badge badge-gold">{item.format}</span>}
              {item.media_type && <span className="badge badge-dim">{mediaTypeLabel(item.media_type)}</span>}
              {item.genre?.split(',').slice(0,2).map(g => <span key={g} className="badge badge-dim">{g.trim()}</span>)}
            </div>
          </div>
          <button onClick={onClose} className="btn-icon btn-sm shrink-0"><Icons.X /></button>
        </div>

        <div className="divider" />

        {/* Body */}
        <div className="flex-1 overflow-y-auto scroll-area p-6 space-y-6">
          {item.overview && (
            <div>
              <p className="label mb-2">Overview</p>
              <p className="text-sm text-dim leading-relaxed">{item.overview}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 text-sm">
            {[
              ['Runtime', item.runtime ? `${item.runtime} min` : null],
              ['Rating', item.rating ? `${item.rating} / 10` : null],
              ['Release', item.release_date ? String(item.release_date).slice(0,10) : null],
              ['UPC', item.upc],
              ['Location', item.location],
            ].filter(([,v]) => v).map(([k,v]) => (
              <div key={k}><p className="label">{k}</p><p className="text-ink">{v}</p></div>
            ))}
          </div>

          {(item.tmdb_url || item.trailer_url) && (
            <div className="flex gap-3">
              {item.tmdb_url && <a href={item.tmdb_url} target="_blank" rel="noreferrer" className="btn-secondary btn-sm"><Icons.Link />TMDB</a>}
              {item.trailer_url && <a href={item.trailer_url} target="_blank" rel="noreferrer" className="btn-primary btn-sm"><Icons.Play />Trailer</a>}
            </div>
          )}

          <div>
            <p className="label mb-2">{item.media_type === 'tv_series' ? 'Seasons' : 'Editions'}</p>
            {variantLoading && <p className="text-sm text-ghost">Loading variants…</p>}
            {!variantLoading && variants.length === 0 && (
              <p className="text-sm text-ghost">{item.media_type === 'tv_series' ? 'No season data yet' : 'No edition data yet'}</p>
            )}
            {!variantLoading && variants.length > 0 && (
              <div className="space-y-2">
                {variants
                  .filter((v) => item.media_type !== 'tv_series' || Boolean(v.edition))
                  .map((v) => (
                  <div key={v.id} className="card p-3">
                    <p className="text-sm text-ink font-medium">{v.edition || 'Default edition'}</p>
                    {item.media_type !== 'tv_series' && (
                      <p className="text-xs text-ghost mt-1">{[v.resolution, v.container, v.video_codec, v.audio_codec, v.audio_channels ? `${v.audio_channels}ch` : null].filter(Boolean).join(' · ')}</p>
                    )}
                    {item.media_type !== 'tv_series' && v.file_path && <p className="text-xs text-ghost/80 font-mono mt-1 break-all">{v.file_path}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {item.notes && (
            <div><p className="label mb-1">Notes</p><p className="text-sm text-dim">{item.notes}</p></div>
          )}

          <div>
            <p className="label mb-2">Your Rating</p>
            <StarRating value={item.user_rating || 0} onChange={r => onRating(item.id, r)} />
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-edge flex gap-3 shrink-0">
          <button onClick={onClose} className="btn-ghost">Close</button>
          <button onClick={() => onEdit(item)} className="btn-secondary flex-1"><Icons.Edit />Edit</button>
          <button onClick={() => { if (window.confirm('Delete this item?')) { onDelete(item.id); onClose(); } }} className="btn-danger"><Icons.Trash /></button>
        </div>
      </div>
    </div>
  );
}

// ─── Add / Edit media form ────────────────────────────────────────────────────

function MediaForm({ initial = DEFAULT_MEDIA_FORM, onSave, onCancel, onDelete, title = 'Add Media', apiCall }) {
  const [form, setForm] = useState(initial);
  const [tvSeasonsText, setTvSeasonsText] = useState(
    Array.isArray(initial?.tv_seasons) ? initial.tv_seasons.join(', ') : ''
  );
  const [addMode, setAddMode]             = useState('title');
  const [tmdbResults, setTmdbResults]     = useState([]);
  const [tmdbLoading, setTmdbLoading]     = useState(false);
  const [barcodeResults, setBarcodeResults] = useState([]);
  const [barcodeLoading, setBarcodeLoading] = useState(false);
  const [visionResults, setVisionResults] = useState([]);
  const [visionLoading, setVisionLoading] = useState(false);
  const [coverFile, setCoverFile]         = useState(null);
  const [saving, setSaving]               = useState(false);
  const [msg, setMsg]                     = useState('');
  const [msgType, setMsgType]             = useState('ok');

  const set = patch => setForm(f => ({ ...f, ...patch }));
  const notify = (text, type = 'ok') => { setMsg(text); setMsgType(type); };

  const searchTmdb = async () => {
    if (!form.title.trim()) return;
    setTmdbLoading(true);
    try {
      const data = await apiCall('post', '/media/search-tmdb', {
        title: form.title.trim(),
        year: form.year || undefined,
        mediaType: inferTmdbSearchType(form.media_type)
      });
      setTmdbResults(data || []);
    } catch { notify('TMDB search failed', 'error'); }
    finally { setTmdbLoading(false); }
  };

  const applyTmdb = async result => {
    let details = null;
    try {
      setTmdbLoading(true);
      const tmdbType = result?.tmdb_media_type || inferTmdbSearchType(form.media_type);
      details = await apiCall('get', `/media/tmdb/${result.id}/details?mediaType=${tmdbType}`);
    } catch {} finally { setTmdbLoading(false); }
    const genres = Array.isArray(result.genre_names) ? result.genre_names.join(', ') : '';
    const releaseDate = result?.release_date || '';
    const tmdbType = result?.tmdb_media_type || inferTmdbSearchType(form.media_type);
    set({
      title: result?.title || form.title,
      original_title: result?.original_title || form.original_title,
      release_date: releaseDate || form.release_date,
      year: result?.release_year ? String(result.release_year) : (releaseDate ? String(releaseDate).slice(0, 4) : form.year),
      genre: genres || form.genre,
      rating: result?.rating ? Number(result.rating).toFixed(1) : form.rating,
      director: details?.director || form.director,
      overview: result?.overview || form.overview,
      tmdb_id: result.id || form.tmdb_id,
      tmdb_media_type: tmdbType,
      tmdb_url: details?.tmdb_url || `https://www.themoviedb.org/${tmdbType}/${result.id}`,
      trailer_url: details?.trailer_url || form.trailer_url,
      poster_path: result?.poster_path || form.poster_path,
      backdrop_path: result?.backdrop_path || form.backdrop_path,
      runtime: details?.runtime || form.runtime,
    });
    setTmdbResults([]);
    notify('TMDB data applied');
  };

  const lookupBarcode = async () => {
    if (!form.upc.trim()) { notify('Enter a UPC first', 'error'); return; }
    setBarcodeLoading(true);
    setBarcodeResults([]);
    try {
      const data = await apiCall('post', '/media/lookup-upc', { upc: form.upc.trim() });
      setBarcodeResults(data.matches || []);
      if (!data.matches?.length) notify('No UPC matches found', 'error');
    } catch (e) { notify(e.response?.data?.detail || 'UPC lookup failed', 'error'); }
    finally { setBarcodeLoading(false); }
  };

  const applyBarcode = async match => {
    const tmdb = match.tmdb;
    let details = null;
    if (tmdb?.id) {
      try {
        const tmdbType = tmdb?.tmdb_media_type || inferTmdbSearchType(form.media_type);
        details = await apiCall('get', `/media/tmdb/${tmdb.id}/details?mediaType=${tmdbType}`);
      } catch {}
    }
    const genres = Array.isArray(tmdb?.genre_names) ? tmdb.genre_names.join(', ') : '';
    const releaseDate = tmdb?.release_date || '';
    const tmdbType = tmdb?.tmdb_media_type || inferTmdbSearchType(form.media_type);
    set({
      title: tmdb?.title || match.title || form.title,
      original_title: tmdb?.original_title || form.original_title,
      release_date: releaseDate || form.release_date,
      year: tmdb?.release_year ? String(tmdb.release_year) : (releaseDate ? String(releaseDate).slice(0,4) : form.year),
      genre: genres || form.genre,
      director: details?.director || form.director,
      overview: tmdb?.overview || match.description || form.overview,
      tmdb_id: tmdb?.id || form.tmdb_id,
      tmdb_media_type: tmdbType,
      tmdb_url: details?.tmdb_url || (tmdb?.id ? `https://www.themoviedb.org/${tmdbType}/${tmdb.id}` : form.tmdb_url),
      trailer_url: details?.trailer_url || form.trailer_url,
      poster_path: tmdb?.poster_path || match.image || form.poster_path,
      backdrop_path: tmdb?.backdrop_path || form.backdrop_path,
      runtime: details?.runtime || form.runtime,
    });
    setBarcodeResults([]);
    notify('Barcode data applied');
  };

  const recognizeCover = async () => {
    if (!coverFile) { notify('Choose an image first', 'error'); return; }
    setVisionLoading(true);
    try {
      const body = new FormData();
      body.append('cover', coverFile);
      const data = await apiCall('post', '/media/recognize-cover', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      setVisionResults(data.tmdbMatches || []);
      if (!data.tmdbMatches?.length) notify('No matches found', 'error');
    } catch (e) { notify(e.response?.data?.detail || 'Recognition failed', 'error'); }
    finally { setVisionLoading(false); }
  };

  const uploadCover = async () => {
    if (!coverFile) return;
    const body = new FormData();
    body.append('cover', coverFile);
    try {
      const data = await apiCall('post', '/media/upload-cover', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      set({ poster_path: data.path });
      notify('Cover uploaded');
    } catch { notify('Upload failed', 'error'); }
  };

  const submit = async e => {
    e.preventDefault();
    setSaving(true);
    try {
      const parsedTvSeasons = tvSeasonsText
        .split(',')
        .map((v) => Number(String(v).trim()))
        .filter((n) => Number.isInteger(n) && n > 0 && n <= 999);
      const saved = await onSave({
        ...form,
        release_date: form.release_date || null,
        year: form.year ? Number(form.year) : null,
        rating: form.rating ? Number(form.rating) : null,
        user_rating: form.user_rating ? Number(form.user_rating) : null,
        runtime: form.runtime ? Number(form.runtime) : null,
        tmdb_id: form.tmdb_id ? Number(form.tmdb_id) : null,
        tmdb_media_type: form.tmdb_media_type || null,
        tmdb_url: form.tmdb_url ? String(form.tmdb_url).trim() || null : null,
        trailer_url: form.trailer_url ? String(form.trailer_url).trim() || null : null,
        poster_path: form.poster_path ? String(form.poster_path).trim() || null : null,
        backdrop_path: form.backdrop_path ? String(form.backdrop_path).trim() || null : null,
        season_number: form.season_number ? Number(form.season_number) : null,
        episode_number: form.episode_number ? Number(form.episode_number) : null,
        episode_title: form.episode_title || null,
        network: form.network || null
      });
      if (form.media_type === 'tv_series' && saved?.id && parsedTvSeasons.length > 0) {
        await apiCall('put', `/media/${saved.id}/tv-seasons`, { seasons: parsedTvSeasons });
      }
    } catch (e) {
      notify(e.response?.data?.error || 'Save failed', 'error');
    } finally { setSaving(false); }
  };

  const allTmdbMatches = [...tmdbResults, ...visionResults].filter((v,i,a) => a.findIndex(x => x.id === v.id) === i);

  return (
    <div className="flex flex-col h-full">
      {/* Sticky header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-edge shrink-0">
        <button onClick={onCancel} className="btn-icon btn-sm"><Icons.ChevronLeft /></button>
        <h2 className="font-display text-xl tracking-wider text-ink flex-1">{title.toUpperCase()}</h2>
        {onDelete && (
          <button onClick={() => { if (window.confirm('Delete this item?')) onDelete(); }} className="btn-danger btn-sm">
            <Icons.Trash />Delete
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scroll-area">
        {/* Preview poster + mode selector */}
        <div className="p-6 flex gap-6">
          {/* Poster preview */}
          <div className="w-28 shrink-0">
            <div className="poster rounded-md shadow-card">
              {posterUrl(form.poster_path)
                ? <img src={posterUrl(form.poster_path)} alt="poster" className="absolute inset-0 w-full h-full object-cover" />
                : <div className="absolute inset-0 flex items-center justify-center text-ghost"><Icons.Film /></div>
              }
            </div>
          </div>

          {/* Mode tabs + core title/format row */}
          <div className="flex-1 space-y-4">
            <div className="tab-strip">
              {['title','upc','cover'].map(m => (
                <button key={m} className={cx('tab flex-1 capitalize', addMode === m && 'active')} onClick={() => setAddMode(m)}>
                  {m === 'title' ? 'Title Search' : m === 'upc' ? 'Barcode' : 'Cover OCR'}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <LabeledField label="Type" className="col-span-1">
                <select className="select" value={form.media_type} onChange={e => set({ media_type: e.target.value })}>
                  {MEDIA_TYPES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </LabeledField>
              <LabeledField label="Format" className="col-span-1">
                <select className="select" value={form.format} onChange={e => set({ format: e.target.value })}>
                  {MEDIA_FORMATS.map(f => <option key={f}>{f}</option>)}
                </select>
              </LabeledField>
              <LabeledField label="Year" className="col-span-1">
                <input className="input" placeholder="2024" value={form.year} onChange={e => set({ year: e.target.value })} inputMode="numeric" />
              </LabeledField>
            </div>
          </div>
        </div>

        <div className="px-6 space-y-5 pb-32">
          {/* Title + search */}
          <LabeledField label="Title *">
            <div className="flex gap-2">
              <input className="input flex-1" placeholder={form.media_type === 'movie' ? 'Movie title' : 'Title'} value={form.title} onChange={e => set({ title: e.target.value })} required />
              {addMode === 'title' && (
                <button type="button" onClick={searchTmdb} disabled={tmdbLoading} className="btn-secondary btn-sm shrink-0 min-w-[100px]">
                  {tmdbLoading ? <Spinner size={14} /> : <><Icons.Search />Search</>}
                </button>
              )}
            </div>
          </LabeledField>

          {/* Mode-specific controls */}
          {addMode === 'upc' && (
            <LabeledField label="UPC / Barcode">
              <div className="flex gap-2">
                <input className="input flex-1 font-mono" placeholder="012345678901" value={form.upc} onChange={e => set({ upc: e.target.value })} />
                <button type="button" onClick={lookupBarcode} disabled={barcodeLoading} className="btn-secondary btn-sm shrink-0 min-w-[100px]">
                  {barcodeLoading ? <Spinner size={14} /> : <><Icons.Barcode />Lookup</>}
                </button>
              </div>
            </LabeledField>
          )}

          {addMode === 'cover' && (
            <div className="space-y-2">
              <label className="label">Cover Image</label>
              <input type="file" accept="image/*" onChange={e => setCoverFile(e.target.files?.[0] || null)}
                className="block w-full text-sm text-ghost file:btn-secondary file:btn-sm file:border-0 file:mr-3" />
              <div className="flex gap-2">
                <button type="button" onClick={uploadCover} disabled={!coverFile} className="btn-secondary btn-sm"><Icons.Upload />Upload cover</button>
                <button type="button" onClick={recognizeCover} disabled={!coverFile || visionLoading} className="btn-secondary btn-sm">
                  {visionLoading ? <Spinner size={14} /> : <><Icons.Eye />Recognize cover</>}
                </button>
              </div>
            </div>
          )}

          {/* TMDB / barcode results */}
          {allTmdbMatches.length > 0 && (
            <div className="space-y-2">
              <p className="label">TMDB Matches — click to apply</p>
              <div className="space-y-1.5 max-h-52 overflow-y-auto scroll-area pr-1">
                {allTmdbMatches.slice(0,8).map(r => (
                  <button key={r.id} type="button" onClick={() => applyTmdb(r)}
                    className="w-full flex items-center gap-3 p-2.5 rounded-lg bg-raised border border-edge hover:border-gold/40 hover:bg-gold/5 transition-all text-left group">
                    {r.poster_path && <img src={`https://image.tmdb.org/t/p/w92${r.poster_path}`} alt="" className="w-8 h-12 object-cover rounded shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink truncate">{r.title || 'Unknown'}</p>
                      <p className="text-xs text-ghost">{r.release_year || 'n/a'}</p>
                    </div>
                    <span className="text-xs text-gold opacity-0 group-hover:opacity-100 shrink-0">Apply →</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {barcodeResults.length > 0 && (
            <div className="space-y-2">
              <p className="label">Barcode Matches — click to apply</p>
              <div className="space-y-1.5 max-h-40 overflow-y-auto scroll-area pr-1">
                {barcodeResults.map((m,i) => (
                  <button key={i} type="button" onClick={() => applyBarcode(m)}
                    className="w-full flex items-center gap-3 p-2.5 rounded-lg bg-raised border border-edge hover:border-gold/40 hover:bg-gold/5 transition-all text-left group">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink truncate">{m.tmdb?.title || m.title || 'Unknown'}</p>
                      <p className="text-xs text-ghost">{m.description || ''}</p>
                    </div>
                    <span className="text-xs text-gold opacity-0 group-hover:opacity-100 shrink-0">Apply →</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Core metadata */}
          <div className="grid grid-cols-2 gap-3">
            <LabeledField label="Original Title" className="col-span-2">
              <input className="input" value={form.original_title} onChange={e => set({ original_title: e.target.value })} />
            </LabeledField>
            <LabeledField label="Director">
              <input className="input" value={form.director} onChange={e => set({ director: e.target.value })} />
            </LabeledField>
            <LabeledField label="Genre">
              <input className="input" placeholder="Action, Drama…" value={form.genre} onChange={e => set({ genre: e.target.value })} />
            </LabeledField>
            <LabeledField label="Release Date">
              <input className="input" type="date" value={form.release_date} onChange={e => set({ release_date: e.target.value })} />
            </LabeledField>
            <LabeledField label="Runtime (min)">
              <input className="input" inputMode="numeric" value={form.runtime} onChange={e => set({ runtime: e.target.value })} />
            </LabeledField>
            <LabeledField label="TMDB Rating">
              <input className="input" inputMode="decimal" placeholder="0.0 – 10.0" value={form.rating} onChange={e => set({ rating: e.target.value })} />
            </LabeledField>
            {addMode !== 'upc' && (
              <LabeledField label="UPC">
                <input className="input font-mono" value={form.upc} onChange={e => set({ upc: e.target.value })} />
              </LabeledField>
            )}
            {form.media_type === 'tv_series' && (
              <>
                <LabeledField label="Network" className="col-span-2">
                  <input className="input" value={form.network} onChange={e => set({ network: e.target.value })} />
                </LabeledField>
                <LabeledField label="Owned Seasons" className="col-span-2">
                  <input
                    className="input"
                    placeholder="1, 2, 3"
                    value={tvSeasonsText}
                    onChange={(e) => setTvSeasonsText(e.target.value)}
                  />
                </LabeledField>
              </>
            )}
            {form.media_type === 'tv_episode' && (
              <>
                <LabeledField label="Season">
                  <input className="input" inputMode="numeric" value={form.season_number} onChange={e => set({ season_number: e.target.value })} />
                </LabeledField>
                <LabeledField label="Episode">
                  <input className="input" inputMode="numeric" value={form.episode_number} onChange={e => set({ episode_number: e.target.value })} />
                </LabeledField>
                <LabeledField label="Episode Title" className="col-span-2">
                  <input className="input" value={form.episode_title} onChange={e => set({ episode_title: e.target.value })} />
                </LabeledField>
              </>
            )}
          </div>

          <LabeledField label="Your Rating">
            <StarRating value={form.user_rating || 0} onChange={v => set({ user_rating: v })} />
          </LabeledField>

          <LabeledField label="Storage Location">
            <input className="input" placeholder="Shelf A3, Box 2…" value={form.location} onChange={e => set({ location: e.target.value })} />
          </LabeledField>

          <LabeledField label="Overview">
            <textarea className="textarea" rows={3} value={form.overview} onChange={e => set({ overview: e.target.value })} />
          </LabeledField>

          <LabeledField label="Notes">
            <textarea className="textarea" rows={2} value={form.notes} onChange={e => set({ notes: e.target.value })} />
          </LabeledField>

          {/* Collapsed advanced fields */}
          <details className="group">
            <summary className="cursor-pointer text-xs text-ghost hover:text-dim list-none flex items-center gap-2 select-none">
              <span className="transition-transform group-open:rotate-90"><Icons.ChevronRight /></span>
              Advanced (TMDB links, poster path)
            </summary>
            <div className="mt-3 grid grid-cols-1 gap-3">
              <LabeledField label="TMDB ID"><input className="input font-mono" value={form.tmdb_id} onChange={e => set({ tmdb_id: e.target.value })} /></LabeledField>
              <LabeledField label="TMDB Media Type"><input className="input font-mono" value={form.tmdb_media_type} onChange={e => set({ tmdb_media_type: e.target.value })} /></LabeledField>
              <LabeledField label="TMDB URL"><input className="input" value={form.tmdb_url} onChange={e => set({ tmdb_url: e.target.value })} /></LabeledField>
              <LabeledField label="Trailer URL"><input className="input" value={form.trailer_url} onChange={e => set({ trailer_url: e.target.value })} /></LabeledField>
              <LabeledField label="Poster Path"><input className="input" value={form.poster_path} onChange={e => set({ poster_path: e.target.value })} /></LabeledField>
            </div>
          </details>
        </div>
      </div>

      {/* Sticky action bar */}
      <div className="shrink-0 border-t border-edge bg-abyss px-6 py-4 flex items-center gap-3">
        {msg && (
          <span className={cx('text-sm flex-1', msgType === 'error' ? 'text-err' : 'text-ok')}>{msg}</span>
        )}
        <div className="flex gap-3 ml-auto">
          <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
          <button type="button" onClick={submit} disabled={saving} className="btn-primary min-w-[100px]">
            {saving ? <Spinner size={16} /> : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Library view ─────────────────────────────────────────────────────────────

function LibraryView({ mediaItems, loading, error, pagination, onRefresh, onOpen, onEdit, onDelete, onRating, apiCall, forcedMediaType }) {
  const [searchInput, setSearchInput] = useState('');
  const [resolutionInput, setResolutionInput] = useState('all');
  const [filters, setFilters]   = useState({
    media_type: forcedMediaType || 'movie',
    search: '',
    resolution: 'all',
    sortBy: 'title',
    sortDir: 'asc'
  });
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [viewMode, setViewMode] = useState('cards');
  const [adding, setAdding]     = useState(false);
  const [editing, setEditing]   = useState(null);
  const [detail, setDetail]     = useState(null);
  const supportsHover = useMemo(
    () => window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches,
    []
  );

  useEffect(() => {
    onRefresh({ page, limit: pageSize, ...filters });
  }, [filters, page, pageSize, onRefresh]);

  useEffect(() => {
    if (!forcedMediaType) return;
    setFilters((f) => ({ ...f, media_type: forcedMediaType }));
    setPage(1);
  }, [forcedMediaType]);

  const rate = async (id, rating) => {
    await onRating(id, rating);
    setDetail(d => (d && d.id === id ? { ...d, user_rating: rating } : d));
  };

  const applySearch = () => {
    setFilters({
      media_type: forcedMediaType || 'movie',
      search: searchInput.trim(),
      resolution: resolutionInput,
      sortBy: 'title',
      sortDir: filters.sortDir
    });
    setPage(1);
  };

  if (adding || editing) {
    const isEdit = Boolean(editing);
    return (
      <div className="h-full flex flex-col">
        <MediaForm
          title={isEdit ? 'Edit Media' : 'Add to Library'}
          initial={isEdit ? {
            ...DEFAULT_MEDIA_FORM, ...editing,
            release_date: editing.release_date ? String(editing.release_date).slice(0,10) : '',
          } : DEFAULT_MEDIA_FORM}
          apiCall={apiCall}
          onCancel={() => { setAdding(false); setEditing(null); }}
          onDelete={isEdit ? () => { onDelete(editing.id); setEditing(null); } : undefined}
          onSave={async payload => {
            if (isEdit) {
              const updated = await onEdit(editing.id, payload);
              setEditing(null);
              return updated;
            }
            const created = await onOpen(payload);
            setAdding(false);
            return created;
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="px-6 py-4 border-b border-edge shrink-0">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="section-title">Library</h1>
          <span className="badge badge-dim ml-1">{pagination?.total ?? mediaItems.length}</span>
          <div className="flex-1" />
          {/* Search */}
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ghost pointer-events-none"><Icons.Search /></span>
            <input className="input pl-9 w-56" placeholder="Search title, director…"
              value={searchInput} onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') applySearch(); }} />
          </div>
          <select
            className="select w-36"
            value={resolutionInput}
            onChange={e => {
              const value = e.target.value;
              setResolutionInput(value);
              setFilters(f => ({ ...f, resolution: value }));
              setPage(1);
            }}>
            <option value="all">All resolutions</option>
            <option value="SD">SD</option>
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
            <option value="4K">4K</option>
          </select>
          {/* View toggle */}
          <div className="tab-strip">
            <button className={cx('tab', viewMode === 'cards' && 'active')} onClick={() => setViewMode('cards')}>
              <Icons.Film />
            </button>
            <button className={cx('tab', viewMode === 'list' && 'active')} onClick={() => setViewMode('list')}>
              <Icons.List />
            </button>
          </div>
          <button
            onClick={() => {
              setFilters(f => ({ ...f, sortDir: f.sortDir === 'asc' ? 'desc' : 'asc' }));
              setPage(1);
            }}
            className="btn-icon"
            title={filters.sortDir === 'asc' ? 'Sort ascending' : 'Sort descending'}>
            {filters.sortDir === 'asc' ? <Icons.ArrowUp /> : <Icons.ArrowDown />}
          </button>
          <button onClick={() => setAdding(true)} className="btn-primary">
            <Icons.Plus />Add
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scroll-area p-6">
        {error && <p className="text-sm text-err mb-4">{error}</p>}
        {loading && (
          <div className="flex items-center justify-center py-20"><Spinner size={32} /></div>
        )}
        {!loading && mediaItems.length === 0 && (
          <EmptyState
            icon={<Icons.Film />}
            title="No items found"
            subtitle={
              filters.media_type !== 'movie' ||
              filters.search ||
              filters.resolution !== 'all'
                ? 'Try adjusting your filters'
                : 'Add your first title to get started'
            }
            action={
              filters.media_type === 'movie' &&
              !filters.search &&
              filters.resolution === 'all' &&
              <button onClick={() => setAdding(true)} className="btn-primary"><Icons.Plus />Add Media</button>
            }
          />
        )}
        {!loading && viewMode === 'cards' && mediaItems.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {mediaItems.map(item => (
              <MediaCard key={item.id} item={item}
                onOpen={() => setDetail(item)}
                onEdit={() => setEditing(item)}
                onDelete={id => { if (window.confirm('Delete this item?')) onDelete(id); }}
                onRating={rate}
                supportsHover={supportsHover}
              />
            ))}
          </div>
        )}
        {!loading && viewMode === 'list' && mediaItems.length > 0 && (
          <div className="space-y-2">
            {mediaItems.map(item => (
              <MediaListRow key={item.id} item={item}
                onOpen={() => setDetail(item)}
                onEdit={() => setEditing(item)}
                onDelete={id => { if (window.confirm('Delete this item?')) onDelete(id); }}
                onRating={rate}
                supportsHover={supportsHover}
              />
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-edge px-6 py-3 flex items-center gap-3 flex-wrap">
        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={loading || page <= 1} className="btn-secondary btn-sm">Previous</button>
        <span className="text-xs text-ghost font-mono">Page {page} / {pagination?.totalPages || 1}</span>
        <button onClick={() => setPage(p => p + 1)} disabled={loading || !(pagination?.hasMore)} className="btn-secondary btn-sm">Next</button>
        <div className="ml-auto flex items-center gap-2">
          <label className="text-xs text-ghost">Page size</label>
          <select className="select w-24" value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
      </div>

      {/* Detail drawer */}
      {detail && (
        <MediaDetail item={detail} onClose={() => setDetail(null)}
          onEdit={item => { setDetail(null); setEditing(item); }}
          onDelete={id => { onDelete(id); setDetail(null); }}
          onRating={rate}
          apiCall={apiCall}
        />
      )}
    </div>
  );
}

function ImportView({ apiCall, onToast, onImported, canImportPlex, onQueueJob, importJobs = [] }) {
  return (
    <ImportViewComponent
      apiCall={apiCall}
      onToast={onToast}
      onImported={onImported}
      canImportPlex={canImportPlex}
      onQueueJob={onQueueJob}
      importJobs={importJobs}
      apiUrl={API_URL}
      Icons={Icons}
      Spinner={Spinner}
      cx={cx}
    />
  );
}

// ─── Profile ──────────────────────────────────────────────────────────────────

function ProfileView({ user, apiCall, onToast }) {
  return <ProfileViewComponent user={user} apiCall={apiCall} onToast={onToast} Spinner={Spinner} />;
}

// ─── Admin views ──────────────────────────────────────────────────────────────

function AdminUsers({ apiCall, onToast, currentUserId }) {
  return <AdminUsersView apiCall={apiCall} onToast={onToast} currentUserId={currentUserId} Icons={Icons} Spinner={Spinner} cx={cx} />;
}

function AdminActivity({ apiCall }) {
  return <AdminActivityView apiCall={apiCall} Spinner={Spinner} />;
}

function AdminFeatureFlags({ apiCall, onToast }) {
  return <AdminFeatureFlagsView apiCall={apiCall} onToast={onToast} Spinner={Spinner} cx={cx} />;
}

function ForbiddenView({ title = 'Access Restricted', detail = 'You do not have permission to view this section.' }) {
  return (
    <div className="h-full overflow-y-auto p-6 max-w-xl">
      <div className="card p-6 space-y-3">
        <h1 className="section-title">{title}</h1>
        <p className="text-sm text-dim">{detail}</p>
      </div>
    </div>
  );
}

function AdminSettings({ apiCall, onToast, onSettingsChange }) {
  return <AdminSettingsView apiCall={apiCall} onToast={onToast} onSettingsChange={onSettingsChange} Spinner={Spinner} />;
}

function AdminIntegrations({ apiCall, onToast, onQueueJob }) {
  return <AdminIntegrationsView apiCall={apiCall} onToast={onToast} onQueueJob={onQueueJob} Spinner={Spinner} cx={cx} />;
}

// ─── App root ─────────────────────────────────────────────────────────────────

export default function App() {
  const [route, setRoute]       = useState(routeFromPath(window.location.pathname));
  const [user, setUser]         = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [activeTab, setActiveTab] = useState('library-movies');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen]       = useState(false);
  const [mediaItems, setMediaItems]   = useState([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaError, setMediaError]   = useState('');
  const [mediaPagination, setMediaPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
  const [uiSettings, setUiSettings] = useState({ theme: 'system', density: 'comfortable' });
  const [toast, setToast] = useState(null);
  const [importJobs, setImportJobs] = useState(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(IMPORT_JOBS_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const tabIdRef = useRef(`tab-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`);
  const [isImportPollLeader, setIsImportPollLeader] = useState(false);

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
        localStorage.setItem(
          IMPORT_POLL_LEADER_KEY,
          JSON.stringify({ tabId: tabIdRef.current, ts: now })
        );
        setIsImportPollLeader(true);
        return true;
      }
    } catch (_) {}
    setIsImportPollLeader(false);
    return false;
  }, [isForegroundTab]);

  // Navigation
  const navigate = nextRoute => {
    window.history.pushState(
      {},
      '',
      nextRoute === 'register' ? '/register'
        : nextRoute === 'dashboard' ? '/dashboard'
          : nextRoute === 'reset' ? '/reset-password'
            : '/login'
    );
    setRoute(nextRoute);
  };

  useEffect(() => {
    const sync = () => setRoute(routeFromPath(window.location.pathname));
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  useEffect(() => {
    if (route !== 'dashboard' && user) {
      window.history.replaceState({}, '', '/dashboard');
      setRoute('dashboard');
    }
  }, [route, user]);

  useEffect(() => {
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

  // API helper
  const apiCall = useCallback(async (method, path, data, config = {}) => {
    const methodUpper = String(method || 'GET').toUpperCase();
    const needsCsrf = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(methodUpper);
    const headers = { ...(config.headers || {}) };

    if (needsCsrf && !headers['x-csrf-token']) {
      let csrfToken = readCookie('csrf_token');
      if (!csrfToken) {
        try {
          const csrfResp = await axios.get(`${API_URL}/auth/csrf-token`, { withCredentials: true });
          csrfToken = csrfResp.data?.csrfToken || readCookie('csrf_token');
        } catch (_) {
          csrfToken = readCookie('csrf_token');
        }
      }
      if (csrfToken) {
        headers['x-csrf-token'] = csrfToken;
      }
    }

    const response = await axios({
      method,
      url: `${API_URL}${path}`,
      data,
      ...config,
      headers,
      withCredentials: true
    });
    return response.data;
  }, []);

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
    setImportJobs((prev) => prev.filter((j) => Number(j.id) !== Number(jobId)));
  }, []);

  const hasActiveImportJobs = useMemo(
    () => importJobs.some((job) => job.status === 'queued' || job.status === 'running'),
    [importJobs]
  );

  // Auth
  const handleAuth = (usr) => {
    setUser(usr || null);
    setAuthChecked(true);
    window.history.replaceState({}, '', '/dashboard');
    setRoute('dashboard');
  };

  const logout = async () => {
    try { await apiCall('post', '/auth/logout'); } catch (_) {}
    localStorage.removeItem('mediavault_token'); // Cleanup for legacy builds.
    setUser(null);
    setAuthChecked(true);
    setMediaItems([]);
    setImportJobs([]);
    localStorage.removeItem(IMPORT_JOBS_KEY);
    navigate('login');
  };

  // Media
  const loadMedia = useCallback(async (opts = {}) => {
    const params = new URLSearchParams();
    const passthrough = [
      'page', 'limit', 'search', 'format', 'media_type', 'sortBy', 'sortDir',
      'director', 'genre', 'resolution',
      'yearMin', 'yearMax',
      'ratingMin', 'ratingMax',
      'userRatingMin', 'userRatingMax'
    ];
    passthrough.forEach((key) => {
      const value = opts[key];
      if (value === undefined || value === null || value === '') return;
      if (key === 'format' && value === 'all') return;
      if (key === 'resolution' && value === 'all') return;
      params.set(key, String(value));
    });
    const query = params.toString();
    setMediaLoading(true); setMediaError('');
    try {
      const payload = await apiCall('get', `/media${query ? `?${query}` : ''}`);
      if (Array.isArray(payload)) {
        setMediaItems(payload);
        setMediaPagination({ page: 1, limit: payload.length, total: payload.length, totalPages: 1, hasMore: false });
      } else {
        setMediaItems(payload?.items || []);
        setMediaPagination(payload?.pagination || { page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
      }
    }
    catch (err) { setMediaError(err.response?.data?.error || 'Failed to load media'); }
    finally { setMediaLoading(false); }
  }, [apiCall]);

  const addMedia = async payload => {
    const created = await apiCall('post', '/media', payload);
    setMediaItems(m => [created, ...m]);
    showToast('Added to library');
    return created;
  };

  const editMedia = async (id, payload) => {
    const updated = await apiCall('patch', `/media/${id}`, payload);
    setMediaItems(m => m.map(i => i.id === id ? updated : i));
    showToast('Saved');
    return updated;
  };

  const deleteMedia = async id => {
    await apiCall('delete', `/media/${id}`);
    setMediaItems(m => m.filter(i => i.id !== id));
    showToast('Deleted');
  };

  const rateMedia = async (id, rating) => {
    const updated = await apiCall('patch', `/media/${id}`, { user_rating: rating });
    setMediaItems(m => m.map(i => i.id === id ? updated : i));
  };

  useEffect(() => {
    if (!(route === 'dashboard' && authChecked && user)) return;
    apiCall('get', '/settings/general')
      .then(data => setUiSettings(data))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, authChecked, user?.id]);

  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const resolveTheme = () => (
      uiSettings.theme === 'system'
        ? (mq.matches ? 'dark' : 'light')
        : uiSettings.theme
    );

    const apply = () => {
      const theme = resolveTheme();
      root.classList.remove('theme-light', 'theme-dark', 'density-compact', 'density-comfortable');
      root.classList.add(theme === 'light' ? 'theme-light' : 'theme-dark');
      root.classList.add(uiSettings.density === 'compact' ? 'density-compact' : 'density-comfortable');
      root.style.colorScheme = theme;
    };

    apply();
    const onSystemThemeChange = () => {
      if (uiSettings.theme === 'system') apply();
    };
    if (mq.addEventListener) mq.addEventListener('change', onSystemThemeChange);
    else mq.addListener(onSystemThemeChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onSystemThemeChange);
      else mq.removeListener(onSystemThemeChange);
    };
  }, [uiSettings.theme, uiSettings.density]);

  useEffect(() => {
    if (route !== 'dashboard') {
      setAuthChecked(true);
      return;
    }
    let active = true;
    (async () => {
      try {
        const me = await apiCall('get', '/auth/me');
        if (!active) return;
        setUser(me);
      } catch (_) {
        if (!active) return;
        setUser(null);
        window.history.replaceState({}, '', '/login');
        setRoute('login');
      } finally {
        if (active) setAuthChecked(true);
      }
    })();
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  useEffect(() => {
    if (route === 'dashboard' && authChecked && user) loadMedia();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, authChecked, user?.id]);

  useEffect(() => {
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
    const t = setInterval(poll, IMPORT_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [apiCall, claimImportPollLeader, user, hasActiveImportJobs, isImportPollLeader]);

  const showToast = (message, type = 'ok') => setToast({ message, type });

  // Auth pages
  if (route !== 'dashboard') {
    return <AuthPage route={route} onNavigate={navigate} onAuth={handleAuth} />;
  }

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-void flex items-center justify-center text-dim">
        <div className="flex items-center gap-3"><Spinner size={18} />Checking session...</div>
      </div>
    );
  }

  if (!user) {
    return <AuthPage route="login" onNavigate={navigate} onAuth={handleAuth} />;
  }

  const tabContent = () => {
    const isAdminTab = String(activeTab || '').startsWith('admin-');
    if (isAdminTab && user?.role !== 'admin') {
      return <ForbiddenView detail="Admin permissions are required to access this view." />;
    }
    const forcedMediaType =
      activeTab === 'library-tv' ? 'tv'
      : activeTab === 'library-other' ? 'other'
      : 'movie';
    switch (activeTab) {
      case 'library':
      case 'library-movies':
      case 'library-tv':
      case 'library-other':
        return (
          <LibraryView
            mediaItems={mediaItems} loading={mediaLoading} error={mediaError}
            pagination={mediaPagination}
            onRefresh={loadMedia}
            onOpen={addMedia}
            onEdit={editMedia}
            onDelete={deleteMedia}
            onRating={rateMedia}
            apiCall={apiCall}
            forcedMediaType={forcedMediaType}
          />
        );
      case 'library-import':
        return (
          <ImportView
            apiCall={apiCall}
            onToast={showToast}
            canImportPlex={user?.role === 'admin'}
            onImported={() => loadMedia()}
            onQueueJob={upsertImportJob}
            importJobs={importJobs}
          />
        );
      case 'profile':          return <ProfileView user={user} apiCall={apiCall} onToast={showToast} />;
      case 'admin-users':      return <AdminUsers apiCall={apiCall} onToast={showToast} currentUserId={user?.id} />;
      case 'admin-activity':   return <AdminActivity apiCall={apiCall} />;
      case 'admin-settings':   return <AdminSettings apiCall={apiCall} onToast={showToast} onSettingsChange={setUiSettings} />;
      case 'admin-flags':      return <AdminFeatureFlags apiCall={apiCall} onToast={showToast} />;
      case 'admin-integrations': return <AdminIntegrations apiCall={apiCall} onToast={showToast} onQueueJob={upsertImportJob} />;
      default:                 return null;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-void">
      <Sidebar
        user={user}
        activeTab={activeTab}
        onSelect={setActiveTab}
        onLogout={logout}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(c => !c)}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />

      {/* Main content */}
      <div className={cx(
        'flex-1 flex flex-col min-w-0 transition-all duration-300',
        sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-56'
      )}>
        {/* Mobile topbar */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-edge lg:hidden shrink-0">
          <button onClick={() => setMobileNavOpen(true)} className="btn-icon"><Icons.Menu /></button>
          <span className="font-display text-lg tracking-wider text-gold">COLLECTZ</span>
        </div>

        {/* Page */}
        <div className="flex-1 overflow-hidden">
          {tabContent()}
        </div>
      </div>

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
      <ImportStatusDock jobs={importJobs} onDismiss={dismissImportJob} />
    </div>
  );
}
