import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import appMeta from './app-meta.json';

const API_URL = process.env.REACT_APP_API_URL || '/api';
const APP_VERSION = process.env.REACT_APP_VERSION || appMeta.version || '1.9.3-r1';
const BUILD_SHA   = process.env.REACT_APP_GIT_SHA || appMeta?.build?.gitShaDefault || 'dev';
const USER_KEY  = 'mediavault_user';
const IMPORT_JOBS_KEY = 'collectz_import_jobs';

const MEDIA_FORMATS = ['VHS', 'Blu-ray', 'Digital', 'DVD', '4K UHD'];
const MEDIA_TYPES = [
  { value: 'movie', label: 'Movie' },
  { value: 'tv_series', label: 'TV Series' },
  { value: 'other', label: 'Other' }
];
const USER_ROLES    = ['admin', 'user', 'viewer'];

const TMDB_GENRE_MAP = {
  28:'Action',12:'Adventure',16:'Animation',35:'Comedy',80:'Crime',
  99:'Documentary',18:'Drama',10751:'Family',14:'Fantasy',36:'History',
  27:'Horror',10402:'Music',9648:'Mystery',10749:'Romance',878:'Science Fiction',
  10770:'TV Movie',53:'Thriller',10752:'War',37:'Western'
};

const BARCODE_PRESETS = {
  upcitemdb:    { barcodePreset:'upcitemdb',    barcodeProvider:'upcitemdb',    barcodeApiUrl:'https://api.upcitemdb.com/prod/trial/lookup',      barcodeApiKeyHeader:'x-api-key',   barcodeQueryParam:'upc' },
  barcodelookup:{ barcodePreset:'barcodelookup',barcodeProvider:'barcodelookup',barcodeApiUrl:'https://api.barcodelookup.com/v3/products',         barcodeApiKeyHeader:'Authorization',barcodeQueryParam:'barcode' },
  custom:       { barcodePreset:'custom',       barcodeProvider:'custom',       barcodeApiUrl:'',                                                   barcodeApiKeyHeader:'x-api-key',   barcodeQueryParam:'upc' },
};
const VISION_PRESETS = {
  ocrspace:{ visionPreset:'ocrspace',visionProvider:'ocrspace',visionApiUrl:'https://api.ocr.space/parse/image',visionApiKeyHeader:'apikey' },
  custom:  { visionPreset:'custom',  visionProvider:'custom',  visionApiUrl:'',                                 visionApiKeyHeader:'x-api-key' },
};
const TMDB_PRESETS = {
  tmdb:  { tmdbPreset:'tmdb',  tmdbProvider:'tmdb',  tmdbApiUrl:'https://api.themoviedb.org/3/search/movie',tmdbApiKeyHeader:'',tmdbApiKeyQueryParam:'api_key' },
  custom:{ tmdbPreset:'custom',tmdbProvider:'custom', tmdbApiUrl:'',                                          tmdbApiKeyHeader:'',tmdbApiKeyQueryParam:'api_key' },
};
const PLEX_PRESETS = {
  plex:  { plexPreset:'plex', plexProvider:'plex', plexApiUrl:'', plexApiKeyQueryParam:'X-Plex-Token' },
  custom:{ plexPreset:'custom', plexProvider:'custom', plexApiUrl:'', plexApiKeyQueryParam:'X-Plex-Token' }
};

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
  if (p === '/dashboard') return 'dashboard';
  return 'login';
}

function readStoredUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
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

function tmdbTitle(result) {
  return result?.title || result?.name || '';
}

function tmdbOriginalTitle(result) {
  return result?.original_title || result?.original_name || '';
}

function tmdbReleaseDate(result) {
  return result?.release_date || result?.first_air_date || '';
}

function mediaTypeLabel(value) {
  return MEDIA_TYPES.find((m) => m.value === value)?.label || 'Movie';
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

function StatusBadge({ status }) {
  const map = { ok:'badge-ok', configured:'badge-ok', auth_failed:'badge-err', error:'badge-err', missing:'badge-warn', unknown:'badge-dim' };
  const labels = { ok:'Connected', configured:'Configured', auth_failed:'Auth Failed', error:'Error', missing:'Missing Key', unknown:'Unknown' };
  return <span className={cx('badge', map[status] || 'badge-dim')}>{labels[status] || 'Unknown'}</span>;
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
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [name, setName]         = useState('');
  const [invite, setInvite]     = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const isRegister = route === 'register';

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('invite')) setInvite(params.get('invite'));
    if (params.get('email'))  setEmail(params.get('email'));
  }, [route]);

  const submit = async e => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const endpoint = isRegister ? '/auth/register' : '/auth/login';
      const payload  = isRegister ? { name, email, password, inviteToken: invite || undefined } : { email, password };
      const data = await axios.post(`${API_URL}${endpoint}`, payload, { withCredentials: true });
      onAuth(data.data.user);
    } catch (err) {
      setError(err.response?.data?.error || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-void flex">
      {/* Left — branding panel */}
      <div className="hidden lg:flex lg:w-1/2 xl:w-3/5 relative overflow-hidden flex-col justify-between p-12">
        <div className="absolute inset-0 bg-gradient-to-br from-abyss via-deep to-void" />
        <div className="absolute inset-0 bg-gradient-to-r from-void/20 via-void/50 to-void" />
        <div className="relative z-10">
          <span className="font-display text-3xl tracking-widest text-gold">COLLECTZ</span>
        </div>
        <div className="relative z-10 space-y-4">
          <h1 className="font-display text-6xl xl:text-7xl tracking-wider text-ink leading-none">
            YOUR COLLECTION.<br />
            <span className="text-gold">PERFECTLY</span><br />
            CATALOGUED.
          </h1>
          <p className="text-dim text-lg max-w-md leading-relaxed">
            Track every disc, stream, and tape in your library. Powered by TMDB. Built for collectors.
          </p>
        </div>
        <div className="relative z-10 flex items-center gap-6">
          {['VHS', 'Blu-ray', '4K UHD', 'Digital'].map(f => (
            <span key={f} className="text-xs text-ghost tracking-widest uppercase border border-ghost/20 px-2 py-1 rounded">{f}</span>
          ))}
        </div>
      </div>

      {/* Right — auth form */}
      <div className="w-full lg:w-1/2 xl:w-2/5 flex items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-8">
          {/* Logo (mobile only) */}
          <div className="lg:hidden text-center">
            <span className="font-display text-4xl tracking-widest text-gold">COLLECTZ</span>
          </div>

          {/* Tab toggle */}
          <div className="tab-strip">
            <button className={cx('tab flex-1', !isRegister && 'active')} onClick={() => onNavigate('login')}>Sign In</button>
            <button className={cx('tab flex-1', isRegister && 'active')} onClick={() => onNavigate('register')}>Register</button>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {isRegister && (
              <div className="field">
                <label className="label">Name</label>
                <input className="input input-lg" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} required />
              </div>
            )}
            <div className="field">
              <label className="label">Email</label>
              <input className="input input-lg" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div className="field">
              <label className="label">Password</label>
              <div className="relative">
                <input className="input input-lg pr-10" type={showPw ? 'text' : 'password'} placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required />
                <button type="button" tabIndex={-1} onClick={() => setShowPw(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ghost hover:text-dim transition-colors">
                  {showPw ? <Icons.EyeOff /> : <Icons.Eye />}
                </button>
              </div>
            </div>
            {isRegister && (
              <div className="field">
                <label className="label">Invite Token <span className="text-ghost normal-case">(required after first user)</span></label>
                <input className="input input-lg font-mono" placeholder="Paste token here" value={invite} onChange={e => setInvite(e.target.value)} />
              </div>
            )}

            {error && <p className="text-sm text-err bg-err/10 border border-err/20 rounded px-3 py-2">{error}</p>}

            <button type="submit" disabled={loading}
              className="btn-primary btn-lg w-full mt-2 font-display tracking-widest text-base">
              {loading ? <Spinner size={18} /> : isRegister ? 'CREATE ACCOUNT' : 'SIGN IN'}
            </button>
          </form>

          <p className="text-center text-xs text-ghost">
            collectZ v{APP_VERSION} · {BUILD_SHA}
          </p>
        </div>
      </div>
    </div>
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
    const genres = (result.genre_ids || []).map(id => TMDB_GENRE_MAP[id]).filter(Boolean).join(', ');
    const releaseDate = tmdbReleaseDate(result);
    const tmdbType = result?.tmdb_media_type || inferTmdbSearchType(form.media_type);
    set({
      title: tmdbTitle(result) || form.title,
      original_title: tmdbOriginalTitle(result) || form.original_title,
      release_date: releaseDate || form.release_date,
      year: releaseDate ? String(releaseDate).slice(0, 4) : form.year,
      genre: genres || form.genre,
      rating: result.vote_average ? Number(result.vote_average).toFixed(1) : form.rating,
      director: details?.director || form.director,
      overview: result.overview || form.overview,
      tmdb_id: result.id || form.tmdb_id,
      tmdb_media_type: tmdbType,
      tmdb_url: details?.tmdb_url || `https://www.themoviedb.org/${tmdbType}/${result.id}`,
      trailer_url: details?.trailer_url || form.trailer_url,
      poster_path: result.poster_path || form.poster_path,
      backdrop_path: result.backdrop_path || form.backdrop_path,
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
    const genres = (tmdb?.genre_ids || []).map(id => TMDB_GENRE_MAP[id]).filter(Boolean).join(', ');
    const releaseDate = tmdbReleaseDate(tmdb);
    const tmdbType = tmdb?.tmdb_media_type || inferTmdbSearchType(form.media_type);
    set({
      title: tmdbTitle(tmdb) || match.title || form.title,
      original_title: tmdbOriginalTitle(tmdb) || form.original_title,
      release_date: releaseDate || form.release_date,
      year: releaseDate ? String(releaseDate).slice(0,4) : form.year,
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
                      <p className="text-sm font-medium text-ink truncate">{tmdbTitle(r)}</p>
                      <p className="text-xs text-ghost">{(tmdbReleaseDate(r) || '').slice(0,4) || 'n/a'}</p>
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
                      <p className="text-sm font-medium text-ink truncate">{tmdbTitle(m.tmdb) || m.title || 'Unknown'}</p>
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
  const [tab, setTab] = useState(canImportPlex ? 'plex' : 'csv');
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState('');
  const [auditRows, setAuditRows] = useState([]);
  const [auditName, setAuditName] = useState('');
  const csvInputRef = useRef(null);
  const deliciousInputRef = useRef(null);
  const completedJobIdsRef = useRef(new Set());

  const downloadAudit = () => {
    if (!auditRows.length) return;
    const esc = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [
      ['row', 'status', 'title', 'detail'].map(esc).join(','),
      ...auditRows.map((r) => [r.row, r.status, r.title, r.detail].map(esc).join(','))
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    a.download = `collectz-import-audit-${auditName || 'report'}-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const runPlexImport = async () => {
    if (!canImportPlex) return;
    setBusy('plex');
    setResult('');
    setAuditRows([]);
    setAuditName('');
    try {
      const res = await apiCall('post', '/media/import-plex?async=true', {});
      const jobId = res?.job?.id;
      if (!jobId) throw new Error('Missing import job id');
      onQueueJob?.({
        id: jobId,
        provider: 'plex',
        status: res?.job?.status || 'queued',
        progress: res?.job?.progress || null
      });
      setResult(`Plex import queued (job #${jobId})`);
      onToast('Plex import started');
    } catch (err) {
      const msg = err.response?.data?.error || 'Plex import failed';
      setResult(msg);
      onToast(msg, 'error');
    } finally { setBusy(''); }
  };

  const runCsvImport = async (file, endpoint, label) => {
    if (!file) return;
    setBusy(label);
    setResult('');
    setAuditRows([]);
    setAuditName('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await apiCall('post', `${endpoint}?async=true`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      const jobId = res?.job?.id;
      if (!jobId) throw new Error('Missing import job id');
      const provider = label === 'Delicious' ? 'csv_delicious' : 'csv_generic';
      onQueueJob?.({
        id: jobId,
        provider,
        status: res?.job?.status || 'queued',
        progress: res?.job?.progress || null
      });
      setResult(`${label} import queued (job #${jobId})`);
      onToast(`${label} import started`);
    } catch (err) {
      const msg = err.response?.data?.error || `${label} import failed`;
      setResult(msg);
      onToast(msg, 'error');
    } finally {
      setBusy('');
    }
  };

  const tabs = [
    ...(canImportPlex ? [{ id: 'plex', label: 'Plex' }] : []),
    { id: 'csv', label: 'Generic CSV' },
    { id: 'delicious', label: 'Delicious CSV' }
  ];
  const recentJobs = useMemo(
    () => importJobs.filter((job) => ['plex', 'csv_generic', 'csv_delicious'].includes(job.provider)).slice(0, 5),
    [importJobs]
  );
  useEffect(() => {
    for (const job of recentJobs) {
      if (job.status !== 'succeeded') continue;
      const id = Number(job.id);
      if (completedJobIdsRef.current.has(id)) continue;
      completedJobIdsRef.current.add(id);
      onImported?.();
    }
  }, [recentJobs, onImported]);

  return (
    <div className="h-full overflow-y-auto p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="section-title">Import Media</h1>
        <p className="text-sm text-ghost mt-1">Add titles from external sources into your library.</p>
      </div>

      <div className="tab-strip w-full max-w-xl">
        {tabs.map((t) => (
          <button key={t.id} className={cx('tab flex-1', tab === t.id && 'active')} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="card p-5 space-y-4">
        {tab === 'plex' && (
          <>
            <p className="text-sm text-dim">Import titles from your configured Plex server and selected sections.</p>
            <p className="text-xs text-ghost">Uses saved Admin Integrations Plex settings. Import runs async with progress, deduplication, and TMDB enrichment when possible.</p>
            <button onClick={runPlexImport} className="btn-primary" disabled={busy === 'plex'}>
              {busy === 'plex' ? <Spinner size={14} /> : <><Icons.Upload />Start Plex Import</>}
            </button>
            {recentJobs.length > 0 && (
              <div className="card p-3 text-xs text-dim font-mono whitespace-pre-wrap">
                {recentJobs.map((job) => (
                  <div key={job.id} className="mb-2 last:mb-0">
                    Job #{job.id} · {job.provider} · {job.status}
                    {job.progress && (
                      <>
                        {'\n'}Processed: {job.progress.processed || 0} / {job.progress.total || 0}
                        {'\n'}Created: {job.progress.created || 0} · Updated: {job.progress.updated || 0}
                        {'\n'}Skipped: {job.progress.skipped || 0} · Errors: {job.progress.errorCount || 0}
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'csv' && (
          <>
            <p className="text-sm text-dim">Import from a CSV file using collectZ columns.</p>
            <p className="text-xs text-ghost">Required: title. Optional: year, format, director, genre, rating, user_rating, runtime, upc, location, notes.</p>
            <div className="flex flex-wrap gap-3">
              <button onClick={() => csvInputRef.current?.click()} className="btn-primary" disabled={busy === 'CSV'}>
                {busy === 'CSV' ? <Spinner size={14} /> : <><Icons.Upload />Choose CSV File</>}
              </button>
              <a href={`${API_URL}/media/import/template-csv`} className="btn-secondary"><Icons.Download />Download Template</a>
            </div>
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                runCsvImport(file, '/media/import-csv', 'CSV');
              }}
            />
          </>
        )}

        {tab === 'delicious' && (
          <>
            <p className="text-sm text-dim">Import a Delicious export CSV.</p>
            <p className="text-xs text-ghost">Movie rows only are imported. Non-movie rows are skipped. Data is enriched from TMDB when available.</p>
            <button onClick={() => deliciousInputRef.current?.click()} className="btn-primary" disabled={busy === 'Delicious'}>
              {busy === 'Delicious' ? <Spinner size={14} /> : <><Icons.Upload />Choose Delicious CSV</>}
            </button>
            <input
              ref={deliciousInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                runCsvImport(file, '/media/import-csv/delicious', 'Delicious');
              }}
            />
          </>
        )}
      </div>

      <div className="card p-4 text-xs text-ghost space-y-1">
        <p>Import behavior:</p>
        <p>- Existing titles are updated by title + year match.</p>
        <p>- New titles are created when no match exists.</p>
        <p>- TMDB enrichment runs during import when configured.</p>
      </div>

      {result && <pre className="card p-4 text-xs text-dim whitespace-pre-wrap">{result}</pre>}
      {auditRows.length > 0 && (
        <div className="flex">
          <button onClick={downloadAudit} className="btn-secondary"><Icons.Download />Download Audit CSV</button>
        </div>
      )}
    </div>
  );
}

// ─── Profile ──────────────────────────────────────────────────────────────────

function ProfileView({ user, apiCall, onToast }) {
  const [form, setForm] = useState({ name: user?.name || '', email: user?.email || '', password: '' });
  const [saving, setSaving] = useState(false);

  const save = async e => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { name: form.name, email: form.email };
      if (form.password) payload.password = form.password;
      await apiCall('patch', '/profile', payload);
      onToast('Profile updated');
      setForm(f => ({ ...f, password: '' }));
    } catch (err) { onToast(err.response?.data?.error || 'Update failed', 'error'); }
    finally { setSaving(false); }
  };

  return (
    <div className="h-full overflow-y-auto p-6 max-w-lg">
      <h1 className="section-title mb-6">Profile</h1>
      <div className="card p-6 space-y-4">
        <div className="flex items-center gap-4 pb-4 border-b border-edge">
          <div className="w-14 h-14 rounded-xl bg-gold/10 border border-gold/20 flex items-center justify-center text-gold font-display text-2xl">
            {user?.name?.[0]?.toUpperCase() || '?'}
          </div>
          <div>
            <p className="font-medium text-ink">{user?.name}</p>
            <p className="text-sm text-ghost">{user?.email}</p>
            <span className="badge badge-gold mt-1">{user?.role}</span>
          </div>
        </div>
        <form onSubmit={save} className="space-y-4">
          <div className="field"><label className="label">Name</label>
            <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
          <div className="field"><label className="label">Email</label>
            <input className="input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
          <div className="field"><label className="label">New Password <span className="normal-case text-ghost font-normal">(leave blank to keep)</span></label>
            <input className="input" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} /></div>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? <Spinner size={16} /> : 'Save Changes'}</button>
        </form>
      </div>
    </div>
  );
}

// ─── Admin views ──────────────────────────────────────────────────────────────

function AdminUsers({ apiCall, onToast, currentUserId }) {
  const [activeTab, setActiveTab] = useState('members');
  const [users, setUsers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const [showInviteHistory, setShowInviteHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [pendingRoles, setPendingRoles] = useState({});
  const [selectedMemberId, setSelectedMemberId] = useState(null);
  const [memberSummary, setMemberSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const loadMembersData = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const [usersRes, invitesRes] = await Promise.allSettled([
      apiCall('get', '/admin/users'),
      apiCall('get', '/admin/invites')
    ]);

    if (usersRes.status === 'fulfilled') setUsers(usersRes.value || []);
    else setLoadError('Failed to load members.');

    if (invitesRes.status === 'fulfilled') setInvites(invitesRes.value || []);
    else setLoadError(prev => (prev ? `${prev} Failed to load invitations.` : 'Failed to load invitations.'));

    setLoading(false);
  }, [apiCall]);

  useEffect(() => { loadMembersData(); }, [loadMembersData]);

  useEffect(() => {
    if (!selectedMemberId) {
      setMemberSummary(null);
      return;
    }
    let active = true;
    setSummaryLoading(true);
    apiCall('get', `/admin/users/${selectedMemberId}/summary`)
      .then(data => {
        if (!active) return;
        setMemberSummary(data);
      })
      .catch(() => {
        if (!active) return;
        setMemberSummary(null);
      })
      .finally(() => {
        if (active) setSummaryLoading(false);
      });
    return () => { active = false; };
  }, [apiCall, selectedMemberId]);

  const createInvite = async e => {
    e.preventDefault();
    try {
      const data = await apiCall('post', '/admin/invites', { email: inviteEmail });
      const url = `${window.location.origin}/register?invite=${encodeURIComponent(data.token)}&email=${encodeURIComponent(data.email)}`;
      setInviteUrl(url);
      setInviteEmail('');
      setInvites(i => [data, ...i]);
      onToast(`Invite created for ${data.email}`);
    } catch (err) {
      onToast(err.response?.data?.error || err.response?.data?.detail || 'Failed to create invite', 'error');
    }
  };

  const saveRole = async (id) => {
    const role = pendingRoles[id];
    if (!role) return;
    try {
      await apiCall('patch', `/admin/users/${id}/role`, { role });
      setUsers(u => u.map(x => x.id === id ? { ...x, role } : x));
      setPendingRoles(r => { const next = { ...r }; delete next[id]; return next; });
      onToast('Role updated');
      if (selectedMemberId === id) {
        setMemberSummary(prev => prev ? { ...prev, user: { ...prev.user, role } } : prev);
      }
    } catch (err) { onToast(err.response?.data?.error || 'Failed', 'error'); }
  };

  const deleteUser = async id => {
    if (!window.confirm('Delete this member? This cannot be undone.')) return;
    try {
      await apiCall('delete', `/admin/users/${id}`);
      setUsers(u => u.filter(x => x.id !== id));
      if (selectedMemberId === id) setSelectedMemberId(null);
      onToast('Member deleted');
    } catch (err) { onToast(err.response?.data?.error || 'Failed', 'error'); }
  };

  const revokeInvite = async inviteId => {
    if (!window.confirm('Invalidate this invitation link?')) return;
    try {
      const data = await apiCall('patch', `/admin/invites/${inviteId}/revoke`);
      setInvites(list => list.map(inv => (inv.id === inviteId ? { ...inv, ...data } : inv)));
      onToast('Invitation invalidated');
    } catch (err) {
      onToast(err.response?.data?.error || 'Failed to invalidate invitation', 'error');
    }
  };

  const copy = async text => {
    try {
      await navigator.clipboard.writeText(text);
      onToast('Copied');
    } catch {
      onToast('Copy failed', 'error');
    }
  };

  const activeInvites = useMemo(
    () => invites.filter(inv =>
      !inv.used
      && !inv.revoked
      && new Date(inv.expires_at).getTime() > Date.now()
    ),
    [invites]
  );

  const displayInvites = showInviteHistory ? invites : activeInvites;

  if (loading) return <div className="p-6 flex items-center gap-3 text-dim"><Spinner />Loading…</div>;

  return (
    <>
      <div className="h-full overflow-y-auto p-6 space-y-6 max-w-5xl">
        <div className="space-y-3">
          <h1 className="section-title">Members</h1>
          <div className="tab-strip w-fit">
            <button
              type="button"
              className={cx('tab', activeTab === 'members' && 'active')}
              onClick={() => setActiveTab('members')}>
              Members ({users.length})
            </button>
            <button
              type="button"
              className={cx('tab', activeTab === 'invitations' && 'active')}
              onClick={() => setActiveTab('invitations')}>
              Invitations ({displayInvites.length})
            </button>
          </div>
        </div>
        {loadError && <p className="text-sm text-err">{loadError}</p>}

        {activeTab === 'members' && (
          <div className="card divide-y divide-edge">
            {users.length === 0 && <p className="px-4 py-6 text-sm text-ghost text-center">No members found</p>}
            {users.map(u => (
              <div
                key={u.id}
                onClick={() => setSelectedMemberId(u.id)}
                className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-raised/60 transition-colors">
                <div className="w-9 h-9 rounded-lg bg-raised border border-edge flex items-center justify-center text-dim font-display">
                  {u.name?.[0]?.toUpperCase() || '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink truncate">{u.name || 'Unnamed'}</p>
                  <p className="text-xs text-ghost truncate">{u.email}</p>
                </div>
                <select
                  className="select w-28"
                  value={pendingRoles[u.id] ?? u.role}
                  onClick={e => e.stopPropagation()}
                  onChange={e => setPendingRoles(r => ({ ...r, [u.id]: e.target.value }))}>
                  {USER_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                {pendingRoles[u.id] && pendingRoles[u.id] !== u.role && (
                  <button onClick={(e) => { e.stopPropagation(); saveRole(u.id); }} className="btn-primary btn-sm">Save</button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); deleteUser(u.id); }}
                  disabled={u.id === currentUserId}
                  className="btn-ghost btn-sm text-err hover:bg-err/10 disabled:opacity-30"
                  title={u.id === currentUserId ? 'You cannot delete your own account' : 'Delete member'}>
                  <Icons.Trash />
                </button>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'invitations' && (
          <div className="space-y-4">
            <form onSubmit={createInvite} className="flex gap-3 flex-wrap">
              <input className="input flex-1 min-w-[14rem]" type="email" placeholder="teammate@example.com" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} required />
              <button type="submit" className="btn-primary shrink-0">Create Invite</button>
            </form>
            <label className="inline-flex items-center gap-2 text-xs text-ghost cursor-pointer">
              <input
                type="checkbox"
                checked={showInviteHistory}
                onChange={e => setShowInviteHistory(e.target.checked)} />
              Show used/revoked/expired invitations
            </label>
            {inviteUrl && (
              <div className="card p-3 flex items-center gap-3">
                <code className="text-xs text-gold flex-1 truncate font-mono">{inviteUrl}</code>
                <button onClick={() => copy(inviteUrl)} className="btn-icon btn-sm shrink-0"><Icons.Copy /></button>
              </div>
            )}
            <div className="card divide-y divide-edge">
              {displayInvites.length === 0 && (
                <p className="px-4 py-6 text-sm text-ghost text-center">
                  {showInviteHistory ? 'No invitations yet' : 'No active invitations'}
                </p>
              )}
              {displayInvites.map(inv => {
                const expired = new Date(inv.expires_at).getTime() <= Date.now();
                let status = 'Active';
                let statusClass = 'badge-ok';
                if (inv.used) {
                  status = 'Used';
                  statusClass = 'badge-dim';
                } else if (inv.revoked) {
                  status = 'Revoked';
                  statusClass = 'badge-err';
                } else if (expired) {
                  status = 'Expired';
                  statusClass = 'badge-warn';
                }
                const inviteLink = `${window.location.origin}/register?invite=${encodeURIComponent(inv.token)}&email=${encodeURIComponent(inv.email)}`;
                return (
                  <div key={inv.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-ink truncate">{inv.email}</p>
                      <p className="text-xs text-ghost truncate">
                        Expires {new Date(inv.expires_at).toLocaleString()}
                        {inv.used_by_email ? ` · Claimed by ${inv.used_by_email}` : ''}
                      </p>
                    </div>
                    <span className={cx('badge', statusClass)}>{status}</span>
                    {!inv.used && !inv.revoked && !expired && (
                      <>
                        <button onClick={() => copy(inviteLink)} className="btn-ghost btn-sm"><Icons.Copy /></button>
                        <button onClick={() => revokeInvite(inv.id)} className="btn-danger btn-sm">Invalidate</button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {selectedMemberId && (
        <>
          <div className="fixed inset-0 bg-void/70 z-40" onClick={() => setSelectedMemberId(null)} />
          <aside className="fixed top-0 right-0 h-full w-full max-w-md bg-abyss border-l border-edge z-50 overflow-y-auto">
            <div className="p-5 border-b border-edge flex items-start gap-3">
              <div className="flex-1">
                <h2 className="font-display text-2xl tracking-wider text-ink">Member Details</h2>
                {memberSummary?.user?.email && <p className="text-xs text-ghost mt-1">{memberSummary.user.email}</p>}
              </div>
              <button onClick={() => setSelectedMemberId(null)} className="btn-icon btn-sm"><Icons.X /></button>
            </div>
            <div className="p-5 space-y-4">
              {summaryLoading && (
                <div className="flex items-center gap-3 text-dim"><Spinner />Loading member details…</div>
              )}
              {!summaryLoading && memberSummary && (
                <>
                  <div className="card p-4 space-y-2">
                    <p className="text-xs text-ghost">Name</p>
                    <p className="text-sm text-ink font-medium">{memberSummary.user?.name || 'Unnamed'}</p>
                    <p className="text-xs text-ghost mt-3">Role</p>
                    <span className="badge badge-dim">{memberSummary.user?.role || 'user'}</span>
                    <p className="text-xs text-ghost mt-3">Created</p>
                    <p className="text-sm text-ink">{memberSummary.user?.created_at ? new Date(memberSummary.user.created_at).toLocaleString() : '—'}</p>
                  </div>

                  <div className="card p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-ghost">Last login</p>
                      <p className="text-sm text-ink">{memberSummary.metrics?.lastLoginAt ? new Date(memberSummary.metrics.lastLoginAt).toLocaleString() : 'Never'}</p>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-ghost">Library additions</p>
                      <p className="text-sm text-ink">{memberSummary.metrics?.additionsCount ?? 0}</p>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-ghost">Last media edit</p>
                      <p className="text-sm text-ink">{memberSummary.metrics?.lastMediaEditAt ? new Date(memberSummary.metrics.lastMediaEditAt).toLocaleString() : '—'}</p>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-ghost">Contribution score</p>
                      <p className="text-sm text-ink font-medium">{memberSummary.metrics?.contributionScore ?? 0}</p>
                    </div>
                  </div>
                </>
              )}
              {!summaryLoading && !memberSummary && (
                <p className="text-sm text-err">Failed to load member details.</p>
              )}
            </div>
          </aside>
        </>
      )}
    </>
  );
}

function AdminActivity({ apiCall }) {
  const [items, setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ action: '', from: '', to: '', q: '' });
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [pageSizeMode, setPageSizeMode] = useState('auto');
  const [autoPageSize, setAutoPageSize] = useState(50);
  const pageSize = pageSizeMode === 'auto' ? autoPageSize : Number(pageSizeMode);

  useEffect(() => {
    const computeAutoSize = () => {
      const raw = Math.floor((window.innerHeight - 320) / 72);
      const bounded = Math.max(10, Math.min(100, raw));
      setAutoPageSize(bounded);
    };
    computeAutoSize();
    window.addEventListener('resize', computeAutoSize);
    return () => window.removeEventListener('resize', computeAutoSize);
  }, []);

  const load = async (targetPage = page) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String((targetPage - 1) * pageSize)
      });
      if (filters.action) params.set('action', filters.action);
      if (filters.from)   params.set('from', filters.from);
      if (filters.to)     params.set('to', filters.to);
      if (filters.q)      params.set('q', filters.q);
      const data = await apiCall('get', `/admin/activity?${params}`);
      const rows = Array.isArray(data) ? data : [];
      setItems(rows);
      setHasMore(rows.length === pageSize);
      setPage(targetPage);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(1); }, [pageSizeMode, autoPageSize]);

  return (
    <div className="h-full overflow-y-auto p-6 max-w-4xl space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="section-title flex-1">Activity Log</h1>
        <button onClick={load} className="btn-icon"><Icons.Refresh /></button>
      </div>
      <div className="flex gap-3 flex-wrap">
        <input className="input w-44" placeholder="Filter by action…" value={filters.action} onChange={e => setFilters(f => ({ ...f, action: e.target.value }))} />
        <input className="input w-36" type="date" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} />
        <input className="input w-36" type="date" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} />
        <input className="input flex-1 min-w-36" placeholder="Search details…" value={filters.q} onChange={e => setFilters(f => ({ ...f, q: e.target.value }))} />
        <button onClick={() => load(1)} className="btn-primary">Apply</button>
        <select className="select w-36" value={pageSizeMode} onChange={e => setPageSizeMode(e.target.value)}>
          <option value="auto">Page size: Auto ({autoPageSize})</option>
          <option value="25">Page size: 25</option>
          <option value="50">Page size: 50</option>
          <option value="100">Page size: 100</option>
        </select>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => load(Math.max(1, page - 1))} disabled={loading || page <= 1} className="btn-secondary btn-sm">Previous</button>
        <span className="text-xs text-ghost font-mono">Page {page}</span>
        <button onClick={() => load(page + 1)} disabled={loading || !hasMore} className="btn-secondary btn-sm">Next</button>
      </div>
      {loading ? <div className="flex justify-center py-12"><Spinner size={28} /></div> : (
        <div className="card divide-y divide-edge">
          {items.length === 0 && <p className="px-4 py-6 text-sm text-ghost text-center">No activity entries</p>}
          {items.map(entry => (
            <div key={entry.id} className="px-4 py-3 space-y-1">
              <div className="flex items-center gap-3">
                <span className="badge badge-dim font-mono text-[10px]">{entry.action}</span>
                <span className="text-xs text-ghost ml-auto">{new Date(entry.created_at).toLocaleString()}</span>
              </div>
              <p className="text-xs text-ghost">
                {entry.entity_type && <span>entity: {entry.entity_type} #{entry.entity_id} · </span>}
                user: {entry.user_id ?? '–'} · {entry.ip_address || '–'}
              </p>
              {entry.details && <p className="text-xs text-ghost/60 font-mono whitespace-pre-wrap break-words">{JSON.stringify(entry.details, null, 2)}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AdminSettings({ apiCall, onToast, onSettingsChange }) {
  const [settings, setSettings] = useState({ theme: 'system', density: 'comfortable' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiCall('get', '/settings/general').then(data => {
      setSettings(data);
      onSettingsChange?.(data);
    }).catch(() => {});
  }, []);

  const save = async e => {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await apiCall('put', '/admin/settings/general', settings);
      setSettings(updated);
      onSettingsChange?.(updated);
      onToast('Settings saved');
    }
    catch { onToast('Save failed', 'error'); }
    finally { setSaving(false); }
  };

  return (
    <div className="h-full overflow-y-auto p-6 max-w-sm">
      <h1 className="section-title mb-6">General Settings</h1>
      <div className="card p-6">
        <form onSubmit={save} className="space-y-4">
          <div className="field">
            <label className="label">Theme</label>
            <select className="select" value={settings.theme} onChange={e => setSettings(s => ({ ...s, theme: e.target.value }))}>
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
          <div className="field">
            <label className="label">Density</label>
            <select className="select" value={settings.density} onChange={e => setSettings(s => ({ ...s, density: e.target.value }))}>
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </div>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? <Spinner size={16} /> : 'Save'}</button>
        </form>
      </div>
    </div>
  );
}

function AdminIntegrations({ apiCall, onToast, onQueueJob }) {
  const [section, setSection] = useState('barcode');
  const [form, setForm] = useState({
    barcodePreset:'upcitemdb',barcodeProvider:'upcitemdb',barcodeApiUrl:'',barcodeApiKey:'',
    barcodeApiKeyHeader:'x-api-key',barcodeQueryParam:'upc',clearBarcodeApiKey:false,
    visionPreset:'ocrspace',visionProvider:'ocrspace',visionApiUrl:'',visionApiKey:'',
    visionApiKeyHeader:'apikey',clearVisionApiKey:false,
    tmdbPreset:'tmdb',tmdbProvider:'tmdb',tmdbApiUrl:'https://api.themoviedb.org/3/search/movie',
    tmdbApiKey:'',tmdbApiKeyHeader:'',tmdbApiKeyQueryParam:'api_key',clearTmdbApiKey:false,
    plexPreset:'plex',plexProvider:'plex',plexApiUrl:'',plexServerName:'',
    plexApiKey:'',plexApiKeyQueryParam:'X-Plex-Token',plexLibrarySections:'',clearPlexApiKey:false
  });
  const [meta, setMeta] = useState({
    barcodeApiKeySet:false,barcodeApiKeyMasked:'',
    visionApiKeySet:false,visionApiKeyMasked:'',
    tmdbApiKeySet:false,tmdbApiKeyMasked:'',
    plexApiKeySet:false,plexApiKeyMasked:''
  });
  const [status, setStatus] = useState({ barcode:'unknown',vision:'unknown',tmdb:'unknown',plex:'unknown' });
  const [testLoading, setTestLoading] = useState('');
  const [testMsg, setTestMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [importingPlex, setImportingPlex] = useState(false);
  const [plexAvailableSections, setPlexAvailableSections] = useState([]);

  useEffect(() => {
    apiCall('get', '/admin/settings/integrations').then(data => {
      setForm(f => ({
        ...f,
        barcodePreset:data.barcodePreset||'upcitemdb',barcodeProvider:data.barcodeProvider||'',barcodeApiUrl:data.barcodeApiUrl||'',barcodeApiKeyHeader:data.barcodeApiKeyHeader||'x-api-key',barcodeQueryParam:data.barcodeQueryParam||'upc',
        visionPreset:data.visionPreset||'ocrspace',visionProvider:data.visionProvider||'',visionApiUrl:data.visionApiUrl||'',visionApiKeyHeader:data.visionApiKeyHeader||'apikey',
        tmdbPreset:data.tmdbPreset||'tmdb',tmdbProvider:data.tmdbProvider||'',tmdbApiUrl:data.tmdbApiUrl||'',tmdbApiKeyHeader:data.tmdbApiKeyHeader||'',tmdbApiKeyQueryParam:data.tmdbApiKeyQueryParam||'api_key',
        plexPreset:data.plexPreset||'plex',plexProvider:data.plexProvider||'plex',plexApiUrl:data.plexApiUrl||'',plexServerName:data.plexServerName||'',plexApiKeyQueryParam:data.plexApiKeyQueryParam||'X-Plex-Token',
        plexLibrarySections:Array.isArray(data.plexLibrarySections) ? data.plexLibrarySections.join(',') : ''
      }));
      setMeta({
        barcodeApiKeySet:Boolean(data.barcodeApiKeySet),barcodeApiKeyMasked:data.barcodeApiKeyMasked||'',
        visionApiKeySet:Boolean(data.visionApiKeySet),visionApiKeyMasked:data.visionApiKeyMasked||'',
        tmdbApiKeySet:Boolean(data.tmdbApiKeySet),tmdbApiKeyMasked:data.tmdbApiKeyMasked||'',
        plexApiKeySet:Boolean(data.plexApiKeySet),plexApiKeyMasked:data.plexApiKeyMasked||''
      });
      setStatus({
        barcode:data.barcodeApiKeySet?'configured':'missing',
        vision:data.visionApiKeySet?'configured':'missing',
        tmdb:data.tmdbApiKeySet?'configured':'missing',
        plex:data.plexApiKeySet?'configured':'missing'
      });
    }).catch(() => {});
  }, []);

  const applyBarcodePreset = p => setForm(f => ({ ...f, ...(BARCODE_PRESETS[p] || {}) }));
  const applyVisionPreset  = p => setForm(f => ({ ...f, ...(VISION_PRESETS[p]  || {}) }));
  const applyTmdbPreset    = p => setForm(f => ({ ...f, ...(TMDB_PRESETS[p]    || {}) }));
  const applyPlexPreset    = p => setForm(f => ({ ...f, ...(PLEX_PRESETS[p]    || {}) }));
  const plexSectionIds = useMemo(
    () => form.plexLibrarySections.split(',').map(v => v.trim()).filter(Boolean),
    [form.plexLibrarySections]
  );

  const togglePlexSection = (id) => {
    const next = new Set(plexSectionIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setForm(f => ({ ...f, plexLibrarySections: [...next].join(',') }));
  };

  const saveSection = async sec => {
    setSaving(true);
    const payload = {};
    if (sec === 'barcode') Object.assign(payload, { barcodePreset:form.barcodePreset,barcodeProvider:form.barcodeProvider,barcodeApiUrl:form.barcodeApiUrl,barcodeApiKeyHeader:form.barcodeApiKeyHeader,barcodeQueryParam:form.barcodeQueryParam,clearBarcodeApiKey:form.clearBarcodeApiKey,...(form.barcodeApiKey && { barcodeApiKey:form.barcodeApiKey }) });
    else if (sec === 'vision') Object.assign(payload, { visionPreset:form.visionPreset,visionProvider:form.visionProvider,visionApiUrl:form.visionApiUrl,visionApiKeyHeader:form.visionApiKeyHeader,clearVisionApiKey:form.clearVisionApiKey,...(form.visionApiKey && { visionApiKey:form.visionApiKey }) });
    else if (sec === 'tmdb') Object.assign(payload, { tmdbPreset:form.tmdbPreset,tmdbProvider:form.tmdbProvider,tmdbApiUrl:form.tmdbApiUrl,tmdbApiKeyHeader:form.tmdbApiKeyHeader,tmdbApiKeyQueryParam:form.tmdbApiKeyQueryParam,clearTmdbApiKey:form.clearTmdbApiKey,...(form.tmdbApiKey && { tmdbApiKey:form.tmdbApiKey }) });
    else Object.assign(payload, {
      plexPreset:form.plexPreset,plexProvider:form.plexProvider,plexApiUrl:form.plexApiUrl,plexServerName:form.plexServerName,
      plexApiKeyQueryParam:form.plexApiKeyQueryParam,clearPlexApiKey:form.clearPlexApiKey,
      plexLibrarySections:form.plexLibrarySections.split(',').map(v => v.trim()).filter(Boolean),
      ...(form.plexApiKey && { plexApiKey:form.plexApiKey })
    });
    try {
      const updated = await apiCall('put', '/admin/settings/integrations', payload);
      setMeta({
        barcodeApiKeySet:Boolean(updated.barcodeApiKeySet),barcodeApiKeyMasked:updated.barcodeApiKeyMasked||'',
        visionApiKeySet:Boolean(updated.visionApiKeySet),visionApiKeyMasked:updated.visionApiKeyMasked||'',
        tmdbApiKeySet:Boolean(updated.tmdbApiKeySet),tmdbApiKeyMasked:updated.tmdbApiKeyMasked||'',
        plexApiKeySet:Boolean(updated.plexApiKeySet),plexApiKeyMasked:updated.plexApiKeyMasked||''
      });
      setStatus(s => ({ ...s, [sec]: updated[`${sec}ApiKeySet`] ? 'configured' : 'missing' }));
      setForm(f => ({ ...f, barcodeApiKey:'',visionApiKey:'',tmdbApiKey:'',plexApiKey:'',clearBarcodeApiKey:false,clearVisionApiKey:false,clearTmdbApiKey:false,clearPlexApiKey:false }));
      onToast(`${sec.toUpperCase()} settings saved`);
    } catch (err) { onToast(err.response?.data?.error || 'Save failed', 'error'); }
    finally { setSaving(false); }
  };

  const test = async sec => {
    setTestLoading(sec); setTestMsg('');
    try {
      const result = await apiCall('post', `/admin/settings/integrations/test-${sec}`, sec === 'tmdb' ? { title:'The Matrix',year:'1999' } : {});
      setStatus(s => ({ ...s, [sec]: result.authenticated ? 'ok' : 'auth_failed' }));
      setTestMsg(`${sec.toUpperCase()}: ${result.authenticated ? 'Connected' : 'Auth failed'} — ${result.detail}`);
      if (sec === 'plex') {
        setPlexAvailableSections(Array.isArray(result.sections) ? result.sections : []);
      }
    } catch (err) { setTestMsg(err.response?.data?.detail || `${sec} test failed`); }
    finally { setTestLoading(''); }
  };

  const runPlexImport = async () => {
    setImportingPlex(true);
    try {
      const enqueue = await apiCall('post', '/media/import-plex?async=true', {
        sectionIds: plexSectionIds
      });
      const jobId = enqueue?.job?.id;
      if (!jobId) throw new Error('Missing import job id');
      onQueueJob?.({
        id: jobId,
        provider: 'plex',
        status: enqueue?.job?.status || 'queued',
        progress: enqueue?.job?.progress || null
      });
      setTestMsg(`PLEX import queued (job #${jobId})`);
      onToast('Plex import started');
    } catch (err) {
      onToast(err.response?.data?.error || 'Plex import failed', 'error');
    } finally { setImportingPlex(false); }
  };

  const sections = ['barcode','vision','tmdb','plex'];

  return (
    <div className="h-full overflow-y-auto p-6 max-w-2xl space-y-6">
      <h1 className="section-title">Integrations</h1>

      <div className="flex gap-3">
        {sections.map(s => (
          <button key={s} onClick={() => setSection(s)}
            className={cx('btn flex-1 uppercase tracking-wider text-xs font-display', section === s ? 'btn-primary' : 'btn-secondary')}>
            {s} <StatusBadge status={status[s]} />
          </button>
        ))}
      </div>

      <div className="card p-5 space-y-4">
        {section === 'barcode' && <>
          <LabeledField label="Preset"><select className="select" value={form.barcodePreset} onChange={e => applyBarcodePreset(e.target.value)}>
            <option value="upcitemdb">UPCItemDB</option><option value="barcodelookup">BarcodeLookup</option><option value="custom">Custom</option>
          </select></LabeledField>
          <LabeledField label="API URL"><input className="input" value={form.barcodeApiUrl} onChange={e => setForm(f => ({ ...f, barcodeApiUrl: e.target.value }))} /></LabeledField>
          <div className="grid grid-cols-2 gap-3">
            <LabeledField label="Key Header"><input className="input" value={form.barcodeApiKeyHeader} onChange={e => setForm(f => ({ ...f, barcodeApiKeyHeader: e.target.value }))} /></LabeledField>
            <LabeledField label="Query Param"><input className="input" value={form.barcodeQueryParam} onChange={e => setForm(f => ({ ...f, barcodeQueryParam: e.target.value }))} /></LabeledField>
          </div>
          <LabeledField label={`API Key ${meta.barcodeApiKeySet ? `(set: ${meta.barcodeApiKeyMasked})` : '(not set)'}`}>
            <input className="input font-mono" type="password" placeholder="Enter new key to update" value={form.barcodeApiKey} onChange={e => setForm(f => ({ ...f, barcodeApiKey: e.target.value }))} />
          </LabeledField>
          <label className="flex items-center gap-2 text-sm text-dim cursor-pointer">
            <input type="checkbox" checked={form.clearBarcodeApiKey} onChange={e => setForm(f => ({ ...f, clearBarcodeApiKey: e.target.checked }))} className="rounded" />
            Clear saved key
          </label>
        </>}

        {section === 'vision' && <>
          <LabeledField label="Preset"><select className="select" value={form.visionPreset} onChange={e => applyVisionPreset(e.target.value)}>
            <option value="ocrspace">OCR.Space</option><option value="custom">Custom</option>
          </select></LabeledField>
          <LabeledField label="API URL"><input className="input" value={form.visionApiUrl} onChange={e => setForm(f => ({ ...f, visionApiUrl: e.target.value }))} /></LabeledField>
          <LabeledField label="Key Header"><input className="input" value={form.visionApiKeyHeader} onChange={e => setForm(f => ({ ...f, visionApiKeyHeader: e.target.value }))} /></LabeledField>
          <LabeledField label={`API Key ${meta.visionApiKeySet ? `(set: ${meta.visionApiKeyMasked})` : '(not set)'}`}>
            <input className="input font-mono" type="password" placeholder="Enter new key to update" value={form.visionApiKey} onChange={e => setForm(f => ({ ...f, visionApiKey: e.target.value }))} />
          </LabeledField>
          <label className="flex items-center gap-2 text-sm text-dim cursor-pointer">
            <input type="checkbox" checked={form.clearVisionApiKey} onChange={e => setForm(f => ({ ...f, clearVisionApiKey: e.target.checked }))} className="rounded" />
            Clear saved key
          </label>
        </>}

        {section === 'tmdb' && <>
          <LabeledField label="Preset"><select className="select" value={form.tmdbPreset} onChange={e => applyTmdbPreset(e.target.value)}>
            <option value="tmdb">TMDB</option><option value="custom">Custom</option>
          </select></LabeledField>
          <LabeledField label="API URL"><input className="input" value={form.tmdbApiUrl} onChange={e => setForm(f => ({ ...f, tmdbApiUrl: e.target.value }))} /></LabeledField>
          <div className="grid grid-cols-2 gap-3">
            <LabeledField label="Key Header (opt)"><input className="input" value={form.tmdbApiKeyHeader} onChange={e => setForm(f => ({ ...f, tmdbApiKeyHeader: e.target.value }))} /></LabeledField>
            <LabeledField label="Key Query Param"><input className="input" value={form.tmdbApiKeyQueryParam} onChange={e => setForm(f => ({ ...f, tmdbApiKeyQueryParam: e.target.value }))} /></LabeledField>
          </div>
          <LabeledField label={`API Key ${meta.tmdbApiKeySet ? `(set: ${meta.tmdbApiKeyMasked})` : '(not set)'}`}>
            <input className="input font-mono" type="password" placeholder="Enter new key to update" value={form.tmdbApiKey} onChange={e => setForm(f => ({ ...f, tmdbApiKey: e.target.value }))} />
          </LabeledField>
          <label className="flex items-center gap-2 text-sm text-dim cursor-pointer">
            <input type="checkbox" checked={form.clearTmdbApiKey} onChange={e => setForm(f => ({ ...f, clearTmdbApiKey: e.target.checked }))} className="rounded" />
            Clear saved key
          </label>
        </>}

        {section === 'plex' && <>
          <LabeledField label="Preset"><select className="select" value={form.plexPreset} onChange={e => applyPlexPreset(e.target.value)}>
            <option value="plex">Plex</option><option value="custom">Custom</option>
          </select></LabeledField>
          <LabeledField label="Plex API URL"><input className="input" placeholder="https://plex-host:32400" value={form.plexApiUrl} onChange={e => setForm(f => ({ ...f, plexApiUrl: e.target.value }))} /></LabeledField>
          <LabeledField label="Server Name (optional)"><input className="input" value={form.plexServerName} onChange={e => setForm(f => ({ ...f, plexServerName: e.target.value }))} /></LabeledField>
          <div className="grid grid-cols-2 gap-3">
            <LabeledField label="Token Query Param"><input className="input" value={form.plexApiKeyQueryParam} onChange={e => setForm(f => ({ ...f, plexApiKeyQueryParam: e.target.value }))} /></LabeledField>
            <LabeledField label="Library Section IDs">
              <input className="input font-mono" placeholder="1,2,5" value={form.plexLibrarySections} onChange={e => setForm(f => ({ ...f, plexLibrarySections: e.target.value }))} />
            </LabeledField>
          </div>
          <div className="text-xs text-ghost">
            Import will use section IDs: <span className="font-mono text-dim">{plexSectionIds.length ? plexSectionIds.join(',') : '(none selected)'}</span>
          </div>
          {plexAvailableSections.length > 0 && (
            <div className="card p-3 space-y-2">
              <p className="text-xs text-ghost">Detected Plex Libraries</p>
              <div className="space-y-1.5">
                {plexAvailableSections.map((sec) => (
                  <label key={sec.id} className="flex items-center gap-2 text-sm text-dim cursor-pointer">
                    <input
                      type="checkbox"
                      checked={plexSectionIds.includes(String(sec.id))}
                      onChange={() => togglePlexSection(String(sec.id))}
                      className="rounded" />
                    <span className="font-medium text-ink">{sec.title || `Section ${sec.id}`}</span>
                    <span className="text-ghost">({sec.type || 'unknown'})</span>
                    <span className="ml-auto font-mono text-xs text-ghost">#{sec.id}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <LabeledField label={`Plex API Key ${meta.plexApiKeySet ? `(set: ${meta.plexApiKeyMasked})` : '(not set)'}`}>
            <input className="input font-mono" type="password" placeholder="Enter new key to update" value={form.plexApiKey} onChange={e => setForm(f => ({ ...f, plexApiKey: e.target.value }))} />
          </LabeledField>
          <label className="flex items-center gap-2 text-sm text-dim cursor-pointer">
            <input type="checkbox" checked={form.clearPlexApiKey} onChange={e => setForm(f => ({ ...f, clearPlexApiKey: e.target.checked }))} className="rounded" />
            Clear saved key
          </label>
        </>}

        <div className="flex gap-3 pt-2 border-t border-edge">
          <button onClick={() => test(section)} disabled={testLoading === section} className="btn-secondary btn-sm">
            {testLoading === section ? <Spinner size={14} /> : 'Test'}
          </button>
          <button onClick={() => saveSection(section)} disabled={saving} className="btn-primary btn-sm">
            {saving ? <Spinner size={14} /> : `Save ${section.toUpperCase()}`}
          </button>
          {section === 'plex' && (
            <button onClick={runPlexImport} disabled={importingPlex} className="btn-secondary btn-sm">
              {importingPlex ? <Spinner size={14} /> : 'Import from Plex'}
            </button>
          )}
        </div>
        {testMsg && <p className="text-xs text-dim font-mono bg-raised rounded px-3 py-2">{testMsg}</p>}
      </div>
    </div>
  );
}

// ─── App root ─────────────────────────────────────────────────────────────────

export default function App() {
  const [route, setRoute]       = useState(routeFromPath(window.location.pathname));
  const [user, setUser]         = useState(readStoredUser());
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

  // Navigation
  const navigate = nextRoute => {
    window.history.pushState({}, '', nextRoute === 'register' ? '/register' : nextRoute === 'dashboard' ? '/dashboard' : '/login');
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

  // API helper
  const apiCall = useCallback(async (method, path, data, config = {}) => {
    const response = await axios({
      method,
      url: `${API_URL}${path}`,
      data,
      ...config,
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

  // Auth
  const handleAuth = (usr) => {
    localStorage.setItem(USER_KEY, JSON.stringify(usr || null));
    setUser(usr || null);
    setAuthChecked(true);
    window.history.replaceState({}, '', '/dashboard');
    setRoute('dashboard');
  };

  const logout = async () => {
    try { await apiCall('post', '/auth/logout'); } catch (_) {}
    localStorage.removeItem(USER_KEY);
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
        localStorage.setItem(USER_KEY, JSON.stringify(me));
      } catch (_) {
        if (!active) return;
        setUser(null);
        localStorage.removeItem(USER_KEY);
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
    if (!user || importJobs.length === 0) return undefined;
    let cancelled = false;
    const poll = async () => {
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
    const t = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [apiCall, user, importJobs.length]);

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
