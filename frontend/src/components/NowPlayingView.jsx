import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Spinner, cx } from './app/AppPrimitives';

const REFRESH_MS = 15000;
const DEFAULT_DISPLAY_PREFERENCES = {
  layoutMode: 'standard',
  showPoster: true,
  showBackdrop: true,
  showContext: true,
  showPlayer: true,
  showProgress: true,
  showUpdatedAt: true,
  showPausedSessions: true,
  textScale: 'standard'
};

function normalizeDisplayPreferences(raw = {}) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const layoutMode = ['standard', 'poster_only'].includes(value.layoutMode) ? value.layoutMode : 'standard';
  const textScale = ['compact', 'standard', 'large'].includes(value.textScale) ? value.textScale : 'standard';
  return {
    ...DEFAULT_DISPLAY_PREFERENCES,
    ...Object.fromEntries(
      ['showPoster', 'showBackdrop', 'showContext', 'showPlayer', 'showProgress', 'showUpdatedAt', 'showPausedSessions']
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, Boolean(value[key])])
    ),
    layoutMode,
    textScale
  };
}

function formatProgress(session) {
  const progress = Number(session?.progressPercent);
  if (!Number.isFinite(progress)) return null;
  return `${Math.max(0, Math.min(100, Math.round(progress)))}%`;
}

function buildImageUrl(path, apiUrl, displayToken = '') {
  const value = String(path || '').trim();
  if (!value) return '';
  const token = String(displayToken || '').trim();
  const withDisplayToken = (urlValue) => {
    if (!token || !urlValue.includes('/plex/now-playing-display-image')) return urlValue;
    const url = new URL(urlValue, window.location.origin);
    url.searchParams.set('token', token);
    return urlValue.startsWith('http') ? url.toString() : `${url.pathname}${url.search}`;
  };
  if (value.startsWith('http')) return withDisplayToken(value);
  if (value.startsWith('/api/')) {
    const base = String(apiUrl || '/api').replace(/\/api\/?$/, '');
    return withDisplayToken(`${base}${value}`);
  }
  return withDisplayToken(value);
}

function sessionSubtitle(session) {
  const pieces = [
    session?.grandparentTitle,
    session?.parentTitle,
    session?.type === 'movie' ? session?.year : null
  ].filter(Boolean);
  return pieces.join(' · ');
}

export default function NowPlayingView({ apiCall, apiUrl, displayToken = '', onBack }) {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadNowPlaying = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const data = displayToken
        ? await apiCall('get', '/plex/now-playing-display', null, { params: { token: displayToken } })
        : await apiCall('get', '/plex/now-playing-viewer');
      setPayload(data);
      setError('');
    } catch (err) {
      setError(err.response?.data?.detail || err.response?.data?.error || 'Now Playing is unavailable');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [apiCall, displayToken]);

  useEffect(() => {
    loadNowPlaying();
  }, [loadNowPlaying]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      loadNowPlaying({ silent: true });
    }, REFRESH_MS);
    return () => window.clearInterval(intervalId);
  }, [loadNowPlaying]);

  const session = payload?.sessions?.[0] || null;
  const displayPreferences = useMemo(() => normalizeDisplayPreferences(payload?.displayPreferences), [payload?.displayPreferences]);
  const posterOnlyMode = displayPreferences.layoutMode === 'poster_only';
  const posterUrl = useMemo(
    () => (displayPreferences.showPoster || posterOnlyMode) ? buildImageUrl(session?.posterImagePath || session?.backdropImagePath, apiUrl, displayToken) : '',
    [apiUrl, displayPreferences.showPoster, displayToken, posterOnlyMode, session]
  );
  const backdropUrl = useMemo(
    () => displayPreferences.showBackdrop ? buildImageUrl(session?.backdropImagePath || session?.posterImagePath, apiUrl, displayToken) : '',
    [apiUrl, displayPreferences.showBackdrop, displayToken, session]
  );
  const progress = displayPreferences.showProgress ? formatProgress(session) : null;
  const subtitle = displayPreferences.showContext ? sessionSubtitle(session) : '';
  const player = displayPreferences.showPlayer ? [session?.player?.state, session?.player?.platform].filter(Boolean).join(' · ') : '';
  const updatedTime = displayPreferences.showUpdatedAt && payload?.generatedAt
    ? new Date(payload.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '';
  const titleClass = displayPreferences.textScale === 'large'
    ? 'text-[clamp(3rem,8vw,7rem)]'
    : displayPreferences.textScale === 'compact'
      ? 'text-[clamp(2rem,5.5vw,4.5rem)]'
      : 'text-[clamp(2.4rem,7vw,6rem)]';

  if (loading && !payload) {
    return (
      <div className="min-h-screen bg-void text-dim flex items-center justify-center">
        <div className="flex items-center gap-3"><Spinner size={18} />Loading Now Playing...</div>
      </div>
    );
  }

  if (!error && session && posterOnlyMode) {
    return (
      <main className="min-h-screen overflow-hidden bg-black text-ink">
        <section className="flex min-h-screen items-center justify-center p-3 sm:p-5">
          {posterUrl ? (
            <img
              src={posterUrl}
              alt=""
              className="h-[calc(100vh-1.5rem)] max-h-[calc(100vh-1.5rem)] w-auto max-w-full rounded-md object-contain sm:h-[calc(100vh-2.5rem)] sm:max-h-[calc(100vh-2.5rem)]"
            />
          ) : (
            <div className="flex aspect-[2/3] h-[calc(100vh-1.5rem)] max-h-[calc(100vh-1.5rem)] max-w-full items-center justify-center rounded-md border border-edge bg-surface px-6 text-center text-ghost sm:h-[calc(100vh-2.5rem)] sm:max-h-[calc(100vh-2.5rem)]">
              {session.title || 'No poster'}
            </div>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-void text-ink">
      {backdropUrl ? (
        <img
          src={backdropUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-30"
        />
      ) : null}
      <div className="absolute inset-0 bg-void/75" aria-hidden="true" />

      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-edge/70 bg-void/70 px-5 py-3">
          {onBack ? <button type="button" className="btn-ghost btn-sm" onClick={onBack}>Dashboard</button> : <span />}
          <div className="text-sm text-ghost">Plex Now Playing</div>
        </header>

        {error ? (
          <section className="flex flex-1 items-center justify-center px-6">
            <div className="max-w-md text-center">
              <h1 className="text-2xl font-semibold text-ink">Now Playing is unavailable</h1>
              <p className="mt-3 text-sm text-ghost">{error}</p>
              <button type="button" className="btn-secondary mt-5" onClick={() => loadNowPlaying()}>
                Retry
              </button>
            </div>
          </section>
        ) : session ? (
          <section className={cx('grid flex-1 grid-cols-1 gap-0', displayPreferences.showPoster ? 'lg:grid-cols-[minmax(320px,44vw)_1fr]' : '')}>
            {displayPreferences.showPoster ? (
              <div className="flex items-center justify-center border-b border-edge/70 bg-abyss/70 p-5 lg:border-b-0 lg:border-r">
                {posterUrl ? (
                  <img
                    src={posterUrl}
                    alt=""
                    className="max-h-[74vh] w-auto max-w-full rounded-md border border-edge object-contain"
                  />
                ) : (
                  <div className="flex aspect-[2/3] w-full max-w-sm items-center justify-center rounded-md border border-edge bg-surface text-ghost">
                    No image
                  </div>
                )}
              </div>
            ) : null}
            <div className="flex min-h-[50vh] items-center px-6 py-10 sm:px-10 lg:px-14">
              <div className="w-full max-w-3xl">
                <h1 className={cx(titleClass, 'font-display leading-none text-ink')}>
                  {session.title}
                </h1>
                {subtitle ? <p className="mt-4 text-xl text-dim sm:text-2xl">{subtitle}</p> : null}
                <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-base text-ghost sm:text-lg">
                  {player ? <span>{player}</span> : null}
                  {progress ? <span>{progress}</span> : null}
                  {updatedTime ? <span>{updatedTime}</span> : null}
                </div>
                {progress ? (
                  <div className="mt-8 h-2 w-full overflow-hidden rounded-sm bg-surface">
                    <div
                      className="h-full bg-gold"
                      style={{ width: progress }}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        ) : (
          <section className="flex flex-1 items-center justify-center px-6">
            <div className="max-w-md text-center">
              <h1 className="text-2xl font-semibold text-ink">Nothing is playing</h1>
              <p className="mt-3 text-sm text-ghost">This view will update automatically when Plex reports an active session.</p>
            </div>
          </section>
        )}

        <footer className={cx('border-t border-edge/70 bg-void/70 px-5 py-3 text-xs text-ghost', loading && payload ? 'opacity-70' : '')}>
          {loading && payload ? 'Refreshing...' : 'Updates every 15 seconds'}
        </footer>
      </div>
    </main>
  );
}
