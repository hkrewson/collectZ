import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Icons,
  Spinner,
  cx,
  posterUrl,
  mediaTypeLabel,
  inferTmdbSearchType,
  isInteractiveTarget,
  MEDIA_TYPES
} from './app/AppPrimitives';

const MEDIA_FORMATS = ['VHS', 'Blu-ray', 'Digital', 'DVD', '4K UHD'];
const BOOK_FORMATS = ['Digital', 'Paperback', 'Hardcover', 'Trade'];
const DEFAULT_MEDIA_FORM = {
  media_type: 'movie',
  title: '', original_title: '', release_date: '', year: '', format: 'Blu-ray', genre: '',
  director: '', cast: '', rating: '', user_rating: 0, runtime: '', upc: '', location: '', notes: '',
  signed_by: '', signed_role: '', signed_on: '', signed_at: '', signed_proof_path: '',
  overview: '', tmdb_id: '', tmdb_media_type: 'movie', tmdb_url: '', trailer_url: '', poster_path: '', backdrop_path: '',
  season_number: '', episode_number: '', episode_title: '', network: '',
  book_author: '', book_isbn: '', book_publisher: '', book_edition: '',
  comic_series: '', comic_issue_number: '', comic_volume: '', comic_writer: '', comic_artist: '', comic_inker: '', comic_colorist: '', comic_cover_date: '', comic_provider_issue_id: '',
  audio_artist: '', audio_album: '', audio_track_count: '',
  game_platform: '', game_developer: '', game_region: ''
};

function normalizeDateInput(value) {
  if (!value) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function StarRating({ value = 0, onChange, readOnly = false }) {
  const safe = Number(value) || 0;
  return (
    <div className="star-wrap">
      {[1, 2, 3, 4, 5].map((star) => {
        const fill = safe >= star ? 1 : safe >= star - 0.5 ? 0.5 : 0;
        return (
          <button
            key={star}
            type="button"
            disabled={readOnly}
            className={cx('star-btn', !readOnly && 'hover:scale-110 transition-transform')}
            onClick={(e) => {
              if (readOnly || !onChange) return;
              const half = e.clientX - e.currentTarget.getBoundingClientRect().left < e.currentTarget.offsetWidth / 2;
              onChange(half ? star - 0.5 : star);
            }}
          >
            <span className="star-base">★</span>
            <span className="star-fill" style={{ width: `${fill * 100}%` }}>★</span>
          </button>
        );
      })}
      <span className="ml-1.5 text-xs text-ghost font-mono">{safe.toFixed(1)}</span>
    </div>
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

function getComicSeriesName(item = {}) {
  const details = item?.type_details && typeof item.type_details === 'object' ? item.type_details : {};
  const explicit = String(details.series || '').trim();
  if (explicit) return explicit;
  const title = String(item?.title || '').trim();
  const match = title.match(/^(.+?)\s+#\s*[\w.-]+/);
  if (match?.[1]) return match[1].trim();
  return title || 'Unknown Series';
}

function extractComicIssueRaw(item = {}) {
  const details = item?.type_details && typeof item.type_details === 'object' ? item.type_details : {};
  const direct = String(details.issue_number || '').trim();
  if (direct) return direct.replace(/^#\s*/, '');
  const title = String(item?.title || '').trim();
  const match = title.match(/#\s*([A-Za-z0-9.-]+)/);
  if (match?.[1]) return String(match[1]).trim();
  return '';
}

function parseComicIssueOrdinal(rawIssue = '') {
  const raw = String(rawIssue || '')
    .trim()
    .replace(/^#\s*/, '')
    .replace(/^(issue|no\.?)\s*/i, '')
    .trim();
  if (!raw) return { kind: 2, num: Number.POSITIVE_INFINITY, suffix: '', pad: 0, raw: '' };

  const decimal = raw.match(/^(\d+)\.(\d+)(.*)$/);
  if (decimal) {
    return {
      kind: 0,
      num: Number(`${decimal[1]}.${decimal[2]}`),
      suffix: String(decimal[3] || '').trim().toLowerCase(),
      pad: decimal[1].length,
      raw
    };
  }

  const numeric = raw.match(/^(\d+)(.*)$/);
  if (numeric) {
    return {
      kind: 0,
      num: Number(numeric[1]),
      suffix: String(numeric[2] || '').trim().toLowerCase(),
      pad: numeric[1].length,
      raw
    };
  }

  return { kind: 1, num: Number.POSITIVE_INFINITY, suffix: raw.toLowerCase(), pad: 0, raw };
}

function compareComicIssueOrder(aItem, bItem) {
  const a = parseComicIssueOrdinal(extractComicIssueRaw(aItem));
  const b = parseComicIssueOrdinal(extractComicIssueRaw(bItem));
  if (a.kind !== b.kind) return a.kind - b.kind;
  if (a.kind === 0) {
    if (a.num !== b.num) return a.num - b.num;
    if (a.suffix !== b.suffix) {
      if (!a.suffix && b.suffix) return -1;
      if (a.suffix && !b.suffix) return 1;
      return a.suffix.localeCompare(b.suffix, undefined, { sensitivity: 'base' });
    }
    if (a.num === 0 && a.pad !== b.pad) return b.pad - a.pad;
  }
  if (a.kind === 1 && a.suffix !== b.suffix) return a.suffix.localeCompare(b.suffix, undefined, { sensitivity: 'base' });
  const aTitle = String(aItem?.title || '');
  const bTitle = String(bItem?.title || '');
  return aTitle.localeCompare(bTitle, undefined, { sensitivity: 'base' });
}

function MediaCard({ item, onOpen, onEdit, onDelete, onRating, supportsHover }) {
  const onPointerUp = (e) => {
    if (e.pointerType !== 'touch') return;
    if (isInteractiveTarget(e.target)) return;
    onOpen(item);
  };

  return (
    <article className="group relative cursor-pointer animate-fade-in" onClick={() => onOpen(item)} onPointerUp={onPointerUp}>
      <div className="poster rounded-lg overflow-hidden shadow-card">
        {posterUrl(item.poster_path)
          ? <img src={posterUrl(item.poster_path)} alt={item.title} className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" />
          : <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-ghost"><Icons.Film /><span className="text-xs text-center px-3 leading-tight">{item.title}</span></div>}
        <div className={cx('absolute inset-0 bg-card-fade transition-opacity duration-300', supportsHover ? 'opacity-0 group-hover:opacity-100' : 'opacity-10')} />
        <div className="absolute top-2 left-2"><span className="badge badge-dim text-[10px] backdrop-blur-sm bg-void/60 border-ghost/20">{item.format || '—'}</span></div>
        <div className="absolute top-2 right-2"><span className="badge badge-dim text-[10px] backdrop-blur-sm bg-void/60 border-ghost/20">{mediaTypeLabel(item.media_type)}</span></div>
        <div className={cx('absolute bottom-0 left-0 right-0 p-3 transition-all duration-300', supportsHover ? 'translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100' : 'translate-y-0 opacity-100')}>
          <div className="flex gap-2">
            <button onClick={(e) => { e.stopPropagation(); onEdit(item); }} className="btn-secondary btn-sm flex-1 backdrop-blur-sm bg-void/60 border-ghost/30"><Icons.Edit />Edit</button>
            <button onClick={(e) => { e.stopPropagation(); onDelete(item.id); }} className="btn-icon btn-sm backdrop-blur-sm bg-void/60 border-ghost/30 text-err hover:bg-err/20"><Icons.Trash /></button>
          </div>
        </div>
      </div>
      <div className="mt-2 px-0.5">
        <p className="text-sm font-medium text-ink truncate">{item.title}</p>
        <p className="text-xs text-ghost">
          {item.year || '—'}{item.director ? ` · ${item.director}` : ''}
          {item.media_type === 'tv_series' && item.tv_all_seasons_completed ? ' · Completed' : ''}
        </p>
        <div className="mt-1" onClick={(e) => e.stopPropagation()}><StarRating value={item.user_rating || 0} onChange={(r) => onRating(item.id, r)} /></div>
      </div>
    </article>
  );
}

function MediaListRow({ item, onOpen, onEdit, onDelete, onRating, supportsHover }) {
  const onPointerUp = (e) => {
    if (e.pointerType !== 'touch') return;
    if (isInteractiveTarget(e.target)) return;
    onOpen(item);
  };

  return (
    <article onClick={() => onOpen(item)} onPointerUp={onPointerUp} className="group flex items-center gap-4 p-3 rounded-lg bg-surface border border-edge hover:border-muted hover:bg-raised cursor-pointer transition-all duration-150 animate-fade-in">
      <div className="w-10 shrink-0" style={{ aspectRatio: '2/3' }}>
        <div className="poster rounded w-full h-full">
          {posterUrl(item.poster_path)
            ? <img src={posterUrl(item.poster_path)} alt={item.title} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
            : <div className="absolute inset-0 flex items-center justify-center text-ghost"><Icons.Film /></div>}
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-ink truncate">{item.title}</p>
        <p className="text-sm text-ghost">{[item.year, item.format, mediaTypeLabel(item.media_type), item.director].filter(Boolean).join(' · ')}</p>
        {item.media_type === 'tv_series' && item.tv_all_seasons_completed && (
          <p className="text-xs text-ok mt-0.5 inline-flex items-center gap-1"><Icons.Check />All seasons completed</p>
        )}
        {item.genre && <p className="text-xs text-ghost/70 mt-0.5 truncate">{item.genre}</p>}
      </div>
      <div onClick={(e) => e.stopPropagation()}><StarRating value={item.user_rating || 0} onChange={(r) => onRating(item.id, r)} /></div>
      <div className={cx('flex gap-2 transition-opacity duration-150', supportsHover ? 'opacity-0 group-hover:opacity-100' : 'opacity-100')}>
        <button onClick={(e) => { e.stopPropagation(); onEdit(item); }} className="btn-ghost btn-sm"><Icons.Edit /></button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(item.id); }} className="btn-ghost btn-sm text-err hover:bg-err/10"><Icons.Trash /></button>
      </div>
    </article>
  );
}

function MediaDetail({ item, onClose, onEdit, onDelete, onRating, apiCall }) {
  const [variants, setVariants] = useState([]);
  const [variantLoading, setVariantLoading] = useState(false);
  const [seasonDrafts, setSeasonDrafts] = useState({});
  const [seasonSaving, setSeasonSaving] = useState({});
  const [openSeason, setOpenSeason] = useState(null);
  const [seasonDetailLoading, setSeasonDetailLoading] = useState({});
  const [seasonDetails, setSeasonDetails] = useState({});

  const setSeasonDraftValue = (seasonNumber, patch) => {
    setSeasonDrafts((prev) => ({
      ...prev,
      [seasonNumber]: {
        ...prev[seasonNumber],
        ...patch
      }
    }));
  };

  const markSeasonWatched = async (seasonNumber) => {
    if (!item?.id || !Number.isInteger(Number(seasonNumber))) return;
    const key = Number(seasonNumber);
    setSeasonSaving((prev) => ({ ...prev, [key]: true }));
    try {
      const payload = {
        watch_state: 'completed',
        last_watched_at: new Date().toISOString()
      };
      const result = await apiCall('patch', `/media/${item.id}/tv-seasons/${key}`, payload);
      const updated = result?.season;
      if (updated) {
        setVariants((prev) => prev.map((row) => (
          Number(row.season_number) === key
            ? { ...row, ...updated, edition: `Season ${updated.season_number}` }
            : row
        )));
        setSeasonDrafts((prev) => ({
          ...prev,
          [key]: {
            ...(prev[key] || {}),
            watch_state: 'completed'
          }
        }));
      }
    } catch {
      // no-op toast surface here; Activity log captures errors
    } finally {
      setSeasonSaving((prev) => ({ ...prev, [key]: false }));
    }
  };

  const loadSeasonDetail = async (seasonNumber) => {
    if (!item?.id || !Number.isInteger(Number(seasonNumber))) return;
    const key = Number(seasonNumber);
    if (openSeason === key) {
      setOpenSeason(null);
      return;
    }
    setOpenSeason(key);
    if (seasonDetails[key]) return;
    setSeasonDetailLoading((prev) => ({ ...prev, [key]: true }));
    try {
      const payload = await apiCall('get', `/media/${item.id}/tv-seasons/${key}`);
      if (payload?.season) {
        setVariants((prev) => prev.map((row) => (
          Number(row.season_number) === key
            ? { ...row, ...payload.season, edition: `Season ${payload.season.season_number}` }
            : row
        )));
      }
      setSeasonDetails((prev) => ({ ...prev, [key]: payload || null }));
    } catch {
      setSeasonDetails((prev) => ({ ...prev, [key]: null }));
    } finally {
      setSeasonDetailLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  useEffect(() => {
    if (!item?.id) {
      setVariants([]);
      setVariantLoading(false);
      setSeasonDrafts({});
      setSeasonSaving({});
      setOpenSeason(null);
      setSeasonDetailLoading({});
      setSeasonDetails({});
      return;
    }
    let active = true;
    setVariantLoading(true);
    apiCall('get', `/media/${item.id}/variants`)
      .then((rows) => {
        if (!active) return;
        const nextRows = Array.isArray(rows) ? rows : [];
        setVariants(nextRows);
        if (item.media_type === 'tv_series') {
          const nextDrafts = {};
          nextRows.forEach((row) => {
            const seasonNum = Number(row.season_number);
            if (!Number.isInteger(seasonNum) || seasonNum <= 0) return;
            nextDrafts[seasonNum] = {
              watch_state: row.watch_state || 'unwatched',
              is_complete: Boolean(row.is_complete),
              watchlist: Boolean(row.watchlist)
            };
          });
          setSeasonDrafts(nextDrafts);
        }
      })
      .catch(() => { if (active) setVariants([]); })
      .finally(() => { if (active) setVariantLoading(false); });
    return () => { active = false; };
  }, [apiCall, item?.id, item?.media_type]);

  if (!item) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-void/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-xl h-full bg-abyss border-l border-edge flex flex-col animate-slide-in">
        {posterUrl(item.backdrop_path) && (
          <div className="relative h-48 shrink-0 overflow-hidden">
            <img src={posterUrl(item.backdrop_path)} alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-hero-fade" />
          </div>
        )}

        <div className="flex items-start gap-4 px-6 pt-6 pb-4 shrink-0">
          <div className="w-20 shrink-0 -mt-16 relative z-10 shadow-deep">
            <div className="poster rounded-md">
              {posterUrl(item.poster_path)
                ? <img src={posterUrl(item.poster_path)} alt={item.title} className="absolute inset-0 w-full h-full object-cover" />
                : <div className="absolute inset-0 flex items-center justify-center text-ghost"><Icons.Film /></div>}
            </div>
          </div>
          <div className="flex-1 min-w-0 mt-1">
            <h2 className="font-display text-2xl tracking-wider text-ink leading-tight">{item.title}</h2>
            <p className="text-sm text-dim mt-1">{[item.year, item.director, item.cast].filter(Boolean).join(' · ')}</p>
            <div className="flex flex-wrap gap-2 mt-2">
              {item.format && <span className="badge badge-gold">{item.format}</span>}
              {item.media_type && <span className="badge badge-dim">{mediaTypeLabel(item.media_type)}</span>}
              {item.genre?.split(',').slice(0, 2).map((g) => <span key={g} className="badge badge-dim">{g.trim()}</span>)}
            </div>
          </div>
          <button onClick={onClose} className="btn-icon btn-sm shrink-0"><Icons.X /></button>
        </div>

        <div className="divider" />

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
              ['Release', item.release_date ? String(item.release_date).slice(0, 10) : null],
              ['UPC', item.upc],
              ['Cast', item.cast],
              ['Signed by', item.signed_by],
              ['Signed as', item.signed_role],
              ['Signed on', item.signed_on ? String(item.signed_on).slice(0, 10) : null],
              ['Signed at', item.signed_at],
              ['Location', item.location]
            ].filter(([, v]) => v).map(([k, v]) => (
              <div key={k}><p className="label">{k}</p><p className="text-ink">{v}</p></div>
            ))}
          </div>

          {item.signed_proof_path && (
            <div>
              <p className="label mb-2">Signing proof</p>
              <a href={posterUrl(item.signed_proof_path)} target="_blank" rel="noreferrer" className="btn-secondary btn-sm"><Icons.Link />Open proof image</a>
            </div>
          )}

          {item.type_details && typeof item.type_details === 'object' && (
            <div>
              <p className="label mb-2">Type Details</p>
              <div className="grid grid-cols-2 gap-4 text-sm">
                {Object.entries(item.type_details)
                  .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
                  .map(([k, v]) => (
                    <div key={k}>
                      <p className="label">{k.replace(/_/g, ' ')}</p>
                      <p className="text-ink">{String(v)}</p>
                    </div>
                  ))}
              </div>
            </div>
          )}

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
                      <p className="text-sm text-ink font-medium flex items-center gap-2">
                        <span>{v.edition || 'Default edition'}</span>
                        {item.media_type === 'tv_series' && (
                          <span className={`inline-flex items-center gap-1 text-xs ${v.watch_state === 'completed' ? 'text-ok' : 'text-brand-300'}`}>
                            {v.watch_state === 'completed' ? <Icons.Check /> : null}
                            {v.watch_state === 'completed' ? 'Watched' : 'Unwatched'}
                          </span>
                        )}
                      </p>
                      {item.media_type === 'tv_series' && (
                        <div className="mt-2 space-y-2">
                          {(() => {
                            const key = Number(v.season_number);
                            const details = seasonDetails[key];
                            const tmdbEpisodeCount = Number(details?.tmdb?.episode_count);
                            const tmdbDerivedCount = Array.isArray(details?.tmdb?.episodes)
                              ? details.tmdb.episodes.length
                              : null;
                            const expectedEpisodes = Number.isFinite(Number(v.expected_episodes))
                              && Number(v.expected_episodes) > 0
                              ? Number(v.expected_episodes)
                              : ((Number.isFinite(tmdbEpisodeCount) && tmdbEpisodeCount > 0)
                                ? tmdbEpisodeCount
                                : ((Number.isInteger(tmdbDerivedCount) && tmdbDerivedCount > 0) ? tmdbDerivedCount : null));
                            const ownedEpisodes = Number.isFinite(Number(v.available_episodes)) ? Number(v.available_episodes) : null;
                            const episodesLabel = ownedEpisodes !== null
                              ? `Episodes ${ownedEpisodes}/${expectedEpisodes ?? '?'}`
                              : `Episodes ?/${expectedEpisodes ?? '?'}`;
                            return (
                              <p className="text-xs text-ghost">
                                {episodesLabel}
                                {expectedEpisodes !== null && ownedEpisodes !== null && ownedEpisodes < expectedEpisodes
                                  ? ' · Missing episodes'
                                  : ''}
                              </p>
                            );
                          })()}
                          <div className="flex gap-2">
                            <button
                              className="btn-secondary btn-sm"
                              onClick={() => markSeasonWatched(Number(v.season_number))}
                              disabled={Boolean(seasonSaving[Number(v.season_number)]) || v.watch_state === 'completed'}
                            >
                              {seasonSaving[Number(v.season_number)] ? <Spinner size={14} /> : <Icons.Check />}
                              Mark all as watched
                            </button>
                            <button
                              className="btn-ghost btn-sm"
                              onClick={() => loadSeasonDetail(Number(v.season_number))}
                              disabled={Boolean(seasonDetailLoading[Number(v.season_number)])}
                            >
                              {seasonDetailLoading[Number(v.season_number)] ? <Spinner size={14} /> : <Icons.ChevronRight />}
                              {openSeason === Number(v.season_number) ? 'Hide episodes' : 'View episodes'}
                            </button>
                          </div>
                          {openSeason === Number(v.season_number) && (
                            <div className="card p-3 bg-void/20 border border-edge/70">
                              {seasonDetailLoading[Number(v.season_number)] && (
                                <p className="text-xs text-ghost">Loading season metadata…</p>
                              )}
                              {!seasonDetailLoading[Number(v.season_number)] && (
                                <>
                                  {seasonDetails[Number(v.season_number)]?.tmdb?.name && (
                                    <p className="text-sm text-ink font-medium">{seasonDetails[Number(v.season_number)]?.tmdb?.name}</p>
                                  )}
                                  <p className="text-xs text-ghost mt-1">
                                    {[
                                      seasonDetails[Number(v.season_number)]?.tmdb?.air_date ? `Air date: ${seasonDetails[Number(v.season_number)]?.tmdb?.air_date}` : null,
                                      Number.isFinite(Number(seasonDetails[Number(v.season_number)]?.tmdb?.episode_count))
                                        && Number(seasonDetails[Number(v.season_number)]?.tmdb?.episode_count) > 0
                                        ? `Episodes: ${seasonDetails[Number(v.season_number)]?.tmdb?.episode_count}`
                                        : null
                                    ].filter(Boolean).join(' · ') || 'No TMDB season metadata available'}
                                  </p>
                                  {Array.isArray(seasonDetails[Number(v.season_number)]?.tmdb?.episodes)
                                    && seasonDetails[Number(v.season_number)]?.tmdb?.episodes.length > 0 && (
                                      <div className="mt-2 max-h-44 overflow-auto pr-1 space-y-1">
                                        {seasonDetails[Number(v.season_number)]?.tmdb?.episodes.map((episode) => (
                                          <div key={episode.id || `ep-${episode.episode_number}`} className="text-xs text-dim">
                                            <span className="text-ink">E{episode.episode_number}:</span> {episode.name || 'Untitled'}
                                            {episode.watched
                                              ? <span className="text-ok"> · watched</span>
                                              : <span className="text-[#3b82f6] font-medium"> · unwatched</span>}
                                            {episode.in_library ? <span className="text-ghost"> · in library</span> : null}
                                            {episode.air_date ? <span className="text-ghost"> · {episode.air_date}</span> : null}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      {item.media_type !== 'tv_series' && (
                        <p className="text-xs text-ghost mt-1">{[v.resolution, v.container, v.video_codec, v.audio_codec, v.audio_channels ? `${v.audio_channels}ch` : null].filter(Boolean).join(' · ')}</p>
                      )}
                      {item.media_type !== 'tv_series' && v.file_path && <p className="text-xs text-ghost/80 font-mono mt-1 break-all">{v.file_path}</p>}
                    </div>
                  ))}
              </div>
            )}
          </div>

          {item.notes && <div><p className="label mb-1">Notes</p><p className="text-sm text-dim">{item.notes}</p></div>}

          <div>
            <p className="label mb-2">Your Rating</p>
            <StarRating value={item.user_rating || 0} onChange={(r) => onRating(item.id, r)} />
          </div>
        </div>

        <div className="p-4 border-t border-edge flex gap-3 shrink-0">
          <button onClick={onClose} className="btn-ghost">Close</button>
          <button onClick={() => onEdit(item)} className="btn-secondary flex-1"><Icons.Edit />Edit</button>
          <button onClick={() => { if (window.confirm('Delete this item?')) { onDelete(item.id); onClose(); } }} className="btn-danger"><Icons.Trash /></button>
        </div>
      </div>
    </div>
  );
}

function CollectionEditor({ collectionId, apiCall, onClose, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [data, setData] = useState(null);
  const [newItemTitle, setNewItemTitle] = useState('');
  const [searchMatches, setSearchMatches] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedMatchId, setSelectedMatchId] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const payload = await apiCall('get', `/media/collections/${collectionId}`);
      setData(payload);
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load collection');
    } finally {
      setLoading(false);
    }
  }, [apiCall, collectionId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let active = true;
    const title = newItemTitle.trim();
    const mediaType = data?.collection?.media_type;
    if (!title || !mediaType) {
      setSearchMatches([]);
      setSelectedMatchId(null);
      return () => { active = false; };
    }
    const timer = setTimeout(async () => {
      try {
        setSearchLoading(true);
        const params = new URLSearchParams();
        params.set('media_type', String(mediaType));
        params.set('search', title);
        params.set('page', '1');
        params.set('limit', '8');
        const payload = await apiCall('get', `/media?${params.toString()}`);
        if (!active) return;
        const items = Array.isArray(payload?.items) ? payload.items : [];
        setSearchMatches(items);
        const normalized = title.toLowerCase();
        const exact = items.find((row) => String(row?.title || '').trim().toLowerCase() === normalized);
        setSelectedMatchId(exact?.id || null);
      } catch (_err) {
        if (active) {
          setSearchMatches([]);
          setSelectedMatchId(null);
        }
      } finally {
        if (active) setSearchLoading(false);
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [apiCall, data?.collection?.media_type, newItemTitle]);

  const addManualItem = async () => {
    if (!newItemTitle.trim()) return;
    setSaving(true);
    setError('');
    try {
      const payload = { contained_title: newItemTitle.trim() };
      if (Number.isFinite(Number(selectedMatchId)) && Number(selectedMatchId) > 0) {
        payload.media_id = Number(selectedMatchId);
      } else if (searchMatches.length > 0) {
        setError('Select an existing match before adding. New item creation is only used when no matches exist.');
        setSaving(false);
        return;
      }
      await apiCall('post', `/media/collections/${collectionId}/items`, payload);
      setNewItemTitle('');
      setSearchMatches([]);
      setSelectedMatchId(null);
      await load();
      onSaved?.('Collection item added');
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to add item');
    } finally {
      setSaving(false);
    }
  };

  const removeItem = async (itemId) => {
    if (!window.confirm('Remove this item from collection?')) return;
    setSaving(true);
    setError('');
    try {
      await apiCall('delete', `/media/collections/${collectionId}/items/${itemId}`);
      await load();
      onSaved?.('Collection item removed');
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to remove item');
    } finally {
      setSaving(false);
    }
  };

  const convertToIndividuals = async () => {
    if (!window.confirm('Convert this collection to individual titles and remove the collection?')) return;
    setDeleting(true);
    setError('');
    try {
      await apiCall('post', `/media/collections/${collectionId}/convert-to-individual`, {});
      onSaved?.('Collection converted to individual titles');
      onClose();
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to convert collection');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-void/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-edge flex items-center gap-3">
          <h2 className="section-title !text-xl">Edit Collection</h2>
          <div className="flex-1" />
          <button className="btn-icon" onClick={onClose}><Icons.X /></button>
        </div>
        <div className="p-5 overflow-y-auto space-y-4">
          {error && <p className="text-sm text-err">{error}</p>}
          {loading && <div className="flex items-center gap-2 text-dim"><Spinner size={16} />Loading...</div>}
          {!loading && data?.collection && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm text-dim">
                <div><span className="text-ghost">Collection:</span> <span className="text-ink">{data.collection.name || data.collection.source_title || `Collection #${collectionId}`}</span></div>
                <div><span className="text-ghost">Media type:</span> <span className="text-ink">{data.collection.media_type || 'movie'}</span></div>
                <div><span className="text-ghost">Import source:</span> <span className="text-ink">{data.collection.import_source || 'manual'}</span></div>
              </div>
              <div className="flex gap-2">
                <button className="btn-secondary" disabled={deleting} onClick={convertToIndividuals}>Convert to Individual Titles</button>
              </div>

              <div className="pt-2 border-t border-edge space-y-2">
                <p className="text-sm font-medium text-ink">Collection Items</p>
                <div className="flex gap-2">
                  <input
                    className="input flex-1"
                    placeholder="Type a title (existing matches are preferred)"
                    value={newItemTitle}
                    onChange={(e) => setNewItemTitle(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addManualItem(); }}
                  />
                  <button className="btn-secondary" disabled={saving || !newItemTitle.trim()} onClick={addManualItem}>Add</button>
                </div>
                {newItemTitle.trim() && (
                  <div className="rounded-lg border border-edge bg-surface p-2 text-xs">
                    {searchLoading && <p className="text-ghost">Searching existing titles…</p>}
                    {!searchLoading && searchMatches.length > 0 && (
                      <>
                        <p className="text-ghost mb-1">Select existing title (same media type):</p>
                        <div className="space-y-1 max-h-36 overflow-y-auto">
                          {searchMatches.map((row) => (
                            <button
                              key={row.id}
                              type="button"
                              className={cx('w-full text-left px-2 py-1 rounded border border-edge', Number(selectedMatchId) === Number(row.id) ? 'bg-veil text-ink' : 'text-dim')}
                              onClick={() => setSelectedMatchId(row.id)}
                            >
                              {row.title} {row.year ? `(${row.year})` : ''} · #{row.id}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                    {!searchLoading && searchMatches.length === 0 && (
                      <p className="text-ghost">No existing matches found. Add will create/link from provider enrichment.</p>
                    )}
                  </div>
                )}
                <div className="space-y-2">
                  {(data.items || []).map((item) => (
                    <div key={item.id} className="p-2 rounded bg-surface border border-edge flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-ink truncate">{item.media_title || item.contained_title || `Item #${item.id}`}</p>
                        <p className="text-xs text-ghost">#{item.id} · {item.media_id ? `Media ${item.media_id}` : 'Unlinked'}</p>
                      </div>
                      <button className="btn-ghost btn-sm text-err" disabled={saving} onClick={() => removeItem(item.id)}><Icons.Trash /></button>
                    </div>
                  ))}
                  {!data.items?.length && <p className="text-xs text-ghost">No collection items yet.</p>}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MediaForm({ initial = DEFAULT_MEDIA_FORM, onSave, onCancel, onDelete, title = 'Add Media', apiCall }) {
  const mergeTypeDetails = (rawInitial) => {
    const details = rawInitial?.type_details || {};
    return {
      ...rawInitial,
      release_date: normalizeDateInput(rawInitial?.release_date),
      signed_on: normalizeDateInput(rawInitial?.signed_on),
      signed_proof_path: rawInitial?.signed_proof_path || '',
      cast: rawInitial?.cast || rawInitial?.cast_members || '',
      book_author: details?.author || '',
      book_isbn: details?.isbn || '',
      book_publisher: details?.publisher || '',
      book_edition: details?.edition || '',
      comic_series: details?.series || '',
      comic_issue_number: details?.issue_number || '',
      comic_volume: details?.volume || '',
      comic_writer: details?.writer || '',
      comic_artist: details?.artist || '',
      comic_inker: details?.inker || '',
      comic_colorist: details?.colorist || '',
      comic_cover_date: details?.cover_date || '',
      comic_provider_issue_id: details?.provider_issue_id || '',
      audio_artist: details?.artist || '',
      audio_album: details?.album || '',
      audio_track_count: details?.track_count ? String(details.track_count) : '',
      game_platform: details?.platform || '',
      game_developer: details?.developer || '',
      game_region: details?.region || ''
    };
  };
  const [form, setForm] = useState(mergeTypeDetails(initial));
  const [tvSeasonsText, setTvSeasonsText] = useState(Array.isArray(initial?.tv_seasons) ? initial.tv_seasons.join(', ') : '');
  const [addMode, setAddMode] = useState('title');
  const [tmdbResults, setTmdbResults] = useState([]);
  const [tmdbLoading, setTmdbLoading] = useState(false);
  const [barcodeResults, setBarcodeResults] = useState([]);
  const [barcodeLoading, setBarcodeLoading] = useState(false);
  const [visionResults, setVisionResults] = useState([]);
  const [visionLoading, setVisionLoading] = useState(false);
  const [typeEnrichResults, setTypeEnrichResults] = useState([]);
  const [typeEnrichLoading, setTypeEnrichLoading] = useState(false);
  const [coverFile, setCoverFile] = useState(null);
  const [proofFile, setProofFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState('ok');

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const notify = (text, type = 'ok') => { setMsg(text); setMsgType(type); };
  const isMovieOrTv = ['movie', 'tv_series', 'tv_episode'].includes(form.media_type);
  const isBook = form.media_type === 'book';
  const isComic = form.media_type === 'comic_book';
  const isAudio = form.media_type === 'audio';
  const isGame = form.media_type === 'game';
  const isTypedEnrichment = isBook || isComic || isAudio || isGame;

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
    } catch {
      notify('TMDB search failed', 'error');
    } finally {
      setTmdbLoading(false);
    }
  };

  const searchTypeEnrichment = async () => {
    const title = form.title.trim();
    if (!title) return;
    const path = isBook
      ? '/media/enrich/book/search'
      : isComic
        ? '/media/enrich/comic/search'
        : isAudio
        ? '/media/enrich/audio/search'
        : '/media/enrich/game/search';
    setTypeEnrichLoading(true);
    setTypeEnrichResults([]);
    try {
      const payload = isAudio
        ? { title, artist: form.audio_artist || '' }
        : (isBook || isComic)
          ? { title, author: form.book_author || '' }
          : { title };
      const data = await apiCall('post', path, payload);
      const matches = Array.isArray(data?.matches) ? data.matches : [];
      setTypeEnrichResults(matches);
      if (!matches.length) notify('No matches found', 'error');
    } catch (e) {
      notify(e.response?.data?.error || 'Lookup failed', 'error');
    } finally {
      setTypeEnrichLoading(false);
    }
  };

  const applyTypeEnrichment = (match) => {
    if (!match) return;
    if (isBook || isComic) {
      set({
        title: match.title || form.title,
        year: match.year ? String(match.year) : form.year,
        release_date: match.release_date || form.release_date,
        genre: match.genre || form.genre,
        overview: match.overview || form.overview,
        tmdb_url: match.external_url || form.tmdb_url,
        poster_path: match.poster_path || form.poster_path,
        book_author: match.type_details?.author || form.book_author,
        book_publisher: match.type_details?.publisher || form.book_publisher,
        book_isbn: match.type_details?.isbn || form.book_isbn,
        book_edition: match.type_details?.edition || form.book_edition,
        comic_series: match.type_details?.series || form.comic_series,
        comic_issue_number: match.type_details?.issue_number || form.comic_issue_number,
        comic_volume: match.type_details?.volume || form.comic_volume,
        comic_writer: match.type_details?.writer || form.comic_writer,
        comic_artist: match.type_details?.artist || form.comic_artist,
        comic_inker: match.type_details?.inker || form.comic_inker,
        comic_colorist: match.type_details?.colorist || form.comic_colorist,
        comic_cover_date: match.type_details?.cover_date || form.comic_cover_date,
        comic_provider_issue_id: match.type_details?.provider_issue_id || match.id || form.comic_provider_issue_id
      });
    } else if (isAudio) {
      set({
        title: match.title || form.title,
        year: match.year ? String(match.year) : form.year,
        release_date: match.release_date || form.release_date,
        genre: match.genre || form.genre,
        overview: match.overview || form.overview,
        tmdb_url: match.external_url || form.tmdb_url,
        poster_path: match.poster_path || form.poster_path,
        audio_artist: match.type_details?.artist || form.audio_artist,
        audio_album: match.type_details?.album || form.audio_album || match.title || form.title,
        audio_track_count: match.type_details?.track_count ? String(match.type_details.track_count) : form.audio_track_count
      });
    } else if (isGame) {
      set({
        title: match.title || form.title,
        year: match.year ? String(match.year) : form.year,
        release_date: match.release_date || form.release_date,
        genre: match.genre || form.genre,
        overview: match.overview || form.overview,
        tmdb_url: match.external_url || form.tmdb_url,
        poster_path: match.poster_path || form.poster_path,
        game_platform: match.type_details?.platform || form.game_platform,
        game_developer: match.type_details?.developer || form.game_developer,
        game_region: match.type_details?.region || form.game_region
      });
    }
    setTypeEnrichResults([]);
    notify('Lookup data applied');
  };

  const applyTmdb = async (result) => {
    let details = null;
    try {
      setTmdbLoading(true);
      const tmdbType = result?.tmdb_media_type || inferTmdbSearchType(form.media_type);
      details = await apiCall('get', `/media/tmdb/${result.id}/details?mediaType=${tmdbType}`);
    } catch (_) {
      details = null;
    } finally {
      setTmdbLoading(false);
    }
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
      cast: details?.cast || form.cast,
      overview: result?.overview || form.overview,
      tmdb_id: result.id || form.tmdb_id,
      tmdb_media_type: tmdbType,
      tmdb_url: details?.tmdb_url || `https://www.themoviedb.org/${tmdbType}/${result.id}`,
      trailer_url: details?.trailer_url || form.trailer_url,
      poster_path: result?.poster_path || form.poster_path,
      backdrop_path: result?.backdrop_path || form.backdrop_path,
      runtime: details?.runtime || form.runtime
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
    } catch (e) {
      notify(e.response?.data?.detail || 'UPC lookup failed', 'error');
    } finally {
      setBarcodeLoading(false);
    }
  };

  const applyBarcode = async (match) => {
    const tmdb = match.tmdb;
    let details = null;
    if (tmdb?.id) {
      try {
        const tmdbType = tmdb?.tmdb_media_type || inferTmdbSearchType(form.media_type);
        details = await apiCall('get', `/media/tmdb/${tmdb.id}/details?mediaType=${tmdbType}`);
      } catch (_) {
        details = null;
      }
    }
    const genres = Array.isArray(tmdb?.genre_names) ? tmdb.genre_names.join(', ') : '';
    const releaseDate = tmdb?.release_date || '';
    const tmdbType = tmdb?.tmdb_media_type || inferTmdbSearchType(form.media_type);
    set({
      title: tmdb?.title || match.title || form.title,
      original_title: tmdb?.original_title || form.original_title,
      release_date: releaseDate || form.release_date,
      year: tmdb?.release_year ? String(tmdb.release_year) : (releaseDate ? String(releaseDate).slice(0, 4) : form.year),
      genre: genres || form.genre,
      director: details?.director || form.director,
      cast: details?.cast || form.cast,
      overview: tmdb?.overview || match.description || form.overview,
      tmdb_id: tmdb?.id || form.tmdb_id,
      tmdb_media_type: tmdbType,
      tmdb_url: details?.tmdb_url || (tmdb?.id ? `https://www.themoviedb.org/${tmdbType}/${tmdb.id}` : form.tmdb_url),
      trailer_url: details?.trailer_url || form.trailer_url,
      poster_path: tmdb?.poster_path || match.image || form.poster_path,
      backdrop_path: tmdb?.backdrop_path || form.backdrop_path,
      runtime: details?.runtime || form.runtime
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
    } catch (e) {
      notify(e.response?.data?.detail || 'Recognition failed', 'error');
    } finally {
      setVisionLoading(false);
    }
  };

  const uploadCover = async () => {
    if (!coverFile) return;
    const body = new FormData();
    body.append('cover', coverFile);
    try {
      const data = await apiCall('post', '/media/upload-cover', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      set({ poster_path: data.path });
      notify('Cover uploaded');
    } catch (_) {
      notify('Upload failed', 'error');
    }
  };

  const uploadSigningProof = async () => {
    if (!proofFile) return;
    if (!form.id) {
      notify('Save item first, then upload signing proof', 'error');
      return;
    }
    const body = new FormData();
    body.append('proof', proofFile);
    try {
      const data = await apiCall('post', `/media/${form.id}/upload-signing-proof`, body, { headers: { 'Content-Type': 'multipart/form-data' } });
      set({ signed_proof_path: data.signed_proof_path || '' });
      notify('Signing proof uploaded');
    } catch (e) {
      notify(e.response?.data?.error || 'Signing proof upload failed', 'error');
    }
  };

  const removeSigningProof = async () => {
    if (!form.id || !form.signed_proof_path) return;
    try {
      await apiCall('delete', `/media/${form.id}/signing-proof`);
      set({ signed_proof_path: '' });
      notify('Signing proof removed');
    } catch (e) {
      notify(e.response?.data?.error || 'Failed to remove signing proof', 'error');
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const parsedTvSeasons = tvSeasonsText
        .split(',')
        .map((v) => Number(String(v).trim()))
        .filter((n) => Number.isInteger(n) && n > 0 && n <= 999);
      const typeDetails = form.media_type === 'book'
        ? {
            author: form.book_author || null,
            isbn: form.book_isbn || null,
            publisher: form.book_publisher || null,
            edition: form.book_edition || null
          }
        : form.media_type === 'comic_book'
          ? {
              author: form.book_author || null,
              isbn: form.book_isbn || null,
              publisher: form.book_publisher || null,
              edition: form.book_edition || null,
              series: form.comic_series || null,
              issue_number: form.comic_issue_number || null,
              volume: form.comic_volume || null,
              writer: form.comic_writer || null,
              artist: form.comic_artist || null,
              inker: form.comic_inker || null,
              colorist: form.comic_colorist || null,
              cover_date: form.comic_cover_date || null,
              provider_issue_id: form.comic_provider_issue_id || null
            }
        : form.media_type === 'audio'
          ? {
              artist: form.audio_artist || null,
              album: form.audio_album || null,
              track_count: form.audio_track_count ? Number(form.audio_track_count) : null
            }
          : form.media_type === 'game'
            ? {
                platform: form.game_platform || null,
                developer: form.game_developer || null,
                region: form.game_region || null
              }
            : null;
      const payload = {
        media_type: form.media_type,
        title: String(form.title || '').trim(),
        original_title: isMovieOrTv ? (String(form.original_title || '').trim() || null) : null,
        release_date: normalizeDateInput(form.release_date) || null,
        year: form.year ? Number(form.year) : null,
        format: (isBook || isComic)
          ? (BOOK_FORMATS.includes(form.format) ? form.format : 'Digital')
          : (isMovieOrTv ? (form.format || null) : null),
        genre: String(form.genre || '').trim() || null,
        director: isMovieOrTv ? (String(form.director || '').trim() || null) : null,
        cast: isMovieOrTv ? (String(form.cast || '').trim() || null) : null,
        rating: isMovieOrTv ? (form.rating ? Number(form.rating) : null) : null,
        user_rating: form.user_rating ? Number(form.user_rating) : null,
        runtime: isMovieOrTv ? (form.runtime ? Number(form.runtime) : null) : null,
        upc: String(form.upc || '').trim() || null,
        location: String(form.location || '').trim() || null,
        notes: String(form.notes || '').trim() || null,
        overview: String(form.overview || '').trim() || null,
        tmdb_id: isMovieOrTv ? (form.tmdb_id ? Number(form.tmdb_id) : null) : null,
        tmdb_media_type: isMovieOrTv ? (form.tmdb_media_type || null) : null,
        tmdb_url: form.tmdb_url ? String(form.tmdb_url).trim() || null : null,
        trailer_url: isMovieOrTv ? (form.trailer_url ? String(form.trailer_url).trim() || null : null) : null,
        poster_path: form.poster_path ? String(form.poster_path).trim() || null : null,
        backdrop_path: isMovieOrTv ? (form.backdrop_path ? String(form.backdrop_path).trim() || null : null) : null,
        signed_by: form.signed_by ? String(form.signed_by).trim() || null : null,
        signed_role: form.signed_role || null,
        signed_on: normalizeDateInput(form.signed_on) || null,
        signed_at: form.signed_at ? String(form.signed_at).trim() || null : null,
        signed_proof_path: form.signed_proof_path ? String(form.signed_proof_path).trim() || null : null,
        type_details: typeDetails
      };

      if (['tv_series', 'tv_episode'].includes(form.media_type)) {
        payload.season_number = form.season_number ? Number(form.season_number) : null;
        payload.episode_number = form.episode_number ? Number(form.episode_number) : null;
        payload.episode_title = String(form.episode_title || '').trim() || null;
        payload.network = String(form.network || '').trim() || null;
      }

      const saved = await onSave(payload);
      if (form.media_type === 'tv_series' && saved?.id && parsedTvSeasons.length > 0) {
        await apiCall('put', `/media/${saved.id}/tv-seasons`, { seasons: parsedTvSeasons });
      }
    } catch (e2) {
      notify(e2.response?.data?.error || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const allTmdbMatches = [...tmdbResults, ...visionResults].filter((v, i, a) => a.findIndex((x) => x.id === v.id) === i);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-edge shrink-0">
        <button onClick={onCancel} className="btn-icon btn-sm"><Icons.ChevronLeft /></button>
        <h2 className="font-display text-xl tracking-wider text-ink flex-1">{title.toUpperCase()}</h2>
        {onDelete && (
          <button onClick={() => { if (window.confirm('Delete this item?')) onDelete(); }} className="btn-danger btn-sm"><Icons.Trash />Delete</button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scroll-area">
        <div className="p-6 flex gap-6">
          <div className="w-28 shrink-0">
            <div className="poster rounded-md shadow-card">
              {posterUrl(form.poster_path)
                ? <img src={posterUrl(form.poster_path)} alt="poster" className="absolute inset-0 w-full h-full object-cover" />
                : <div className="absolute inset-0 flex items-center justify-center text-ghost"><Icons.Film /></div>}
            </div>
          </div>

          <div className="flex-1 space-y-4">
            {isMovieOrTv && (
              <div className="tab-strip">
                {['title', 'upc', 'cover'].map((m) => (
                  <button key={m} className={cx('tab flex-1 capitalize', addMode === m && 'active')} onClick={() => setAddMode(m)}>
                    {m === 'title' ? 'Title Search' : m === 'upc' ? 'Barcode' : 'Cover OCR'}
                  </button>
                ))}
              </div>
            )}

            <div className={cx('grid gap-3', (isBook || isComic) ? 'grid-cols-3' : 'grid-cols-2')}>
              <LabeledField label="Type" className="col-span-1">
                <select
                  className="select"
                  value={form.media_type}
                  onChange={(e) => {
                    const nextType = e.target.value;
                    const patch = { media_type: nextType };
                    if ((nextType === 'book' || nextType === 'comic_book') && !BOOK_FORMATS.includes(form.format)) patch.format = 'Digital';
                    if (nextType === 'audio' || nextType === 'game') patch.format = '';
                    if (!['movie', 'tv_series', 'tv_episode'].includes(nextType)) {
                      patch.original_title = '';
                      patch.director = '';
                      patch.runtime = '';
                      patch.rating = '';
                      patch.tmdb_id = '';
                      patch.tmdb_media_type = 'movie';
                      patch.trailer_url = '';
                      patch.backdrop_path = '';
                    }
                    set(patch);
                    setTypeEnrichResults([]);
                  }}
                >
                  {MEDIA_TYPES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </LabeledField>
              {(isMovieOrTv || isBook || isComic) && (
                <LabeledField label="Format" className="col-span-1">
                  <select className="select" value={form.format} onChange={(e) => set({ format: e.target.value })}>
                    {((isBook || isComic) ? BOOK_FORMATS : MEDIA_FORMATS).map((f) => <option key={f}>{f}</option>)}
                  </select>
                </LabeledField>
              )}
              {!isGame && (
                <LabeledField label="Year" className="col-span-1">
                  <input className="input" placeholder="2024" value={form.year} onChange={(e) => set({ year: e.target.value })} inputMode="numeric" />
                </LabeledField>
              )}
            </div>
          </div>
        </div>

        <div className="px-6 space-y-5 pb-32">
          <LabeledField label={isAudio ? 'Album *' : 'Title *'}>
            <div className="flex gap-2">
              <input className="input flex-1" placeholder={isAudio ? 'Album title' : (form.media_type === 'movie' ? 'Movie title' : 'Title')} value={form.title} onChange={(e) => set({ title: e.target.value })} required />
              {isMovieOrTv && addMode === 'title' && (
                <button type="button" onClick={searchTmdb} disabled={tmdbLoading} className="btn-secondary btn-sm shrink-0 min-w-[100px]">
                  {tmdbLoading ? <Spinner size={14} /> : <><Icons.Search />Search</>}
                </button>
              )}
              {isTypedEnrichment && (
                <button type="button" onClick={searchTypeEnrichment} disabled={typeEnrichLoading} className="btn-secondary btn-sm shrink-0 min-w-[100px]">
                  {typeEnrichLoading ? <Spinner size={14} /> : <><Icons.Search />Lookup</>}
                </button>
              )}
            </div>
          </LabeledField>

          {isMovieOrTv && addMode === 'upc' && (
            <LabeledField label="UPC / Barcode">
              <div className="flex gap-2">
                <input className="input flex-1 font-mono" placeholder="012345678901" value={form.upc} onChange={(e) => set({ upc: e.target.value })} />
                <button type="button" onClick={lookupBarcode} disabled={barcodeLoading} className="btn-secondary btn-sm shrink-0 min-w-[100px]">
                  {barcodeLoading ? <Spinner size={14} /> : <><Icons.Barcode />Lookup</>}
                </button>
              </div>
            </LabeledField>
          )}

          {isMovieOrTv && addMode === 'cover' && (
            <div className="space-y-2">
              <label className="label">Cover Image</label>
              <input type="file" accept="image/*" onChange={(e) => setCoverFile(e.target.files?.[0] || null)} className="block w-full text-sm text-ghost file:btn-secondary file:btn-sm file:border-0 file:mr-3" />
              <div className="flex gap-2">
                <button type="button" onClick={uploadCover} disabled={!coverFile} className="btn-secondary btn-sm"><Icons.Upload />Upload cover</button>
                <button type="button" onClick={recognizeCover} disabled={!coverFile || visionLoading} className="btn-secondary btn-sm">
                  {visionLoading ? <Spinner size={14} /> : <><Icons.Eye />Recognize cover</>}
                </button>
              </div>
            </div>
          )}

          {isMovieOrTv && allTmdbMatches.length > 0 && (
            <div className="space-y-2">
              <p className="label">TMDB Matches — click to apply</p>
              <div className="space-y-1.5 max-h-52 overflow-y-auto scroll-area pr-1">
                {allTmdbMatches.slice(0, 8).map((r) => (
                  <button key={r.id} type="button" onClick={() => applyTmdb(r)} className="w-full flex items-center gap-3 p-2.5 rounded-lg bg-raised border border-edge hover:border-gold/40 hover:bg-gold/5 transition-all text-left group">
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

          {isMovieOrTv && barcodeResults.length > 0 && (
            <div className="space-y-2">
              <p className="label">Barcode Matches — click to apply</p>
              <div className="space-y-1.5 max-h-40 overflow-y-auto scroll-area pr-1">
                {barcodeResults.map((m, i) => (
                  <button key={i} type="button" onClick={() => applyBarcode(m)} className="w-full flex items-center gap-3 p-2.5 rounded-lg bg-raised border border-edge hover:border-gold/40 hover:bg-gold/5 transition-all text-left group">
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

          {isTypedEnrichment && typeEnrichResults.length > 0 && (
            <div className="space-y-2">
              <p className="label">Lookup Matches — click to apply</p>
              <div className="space-y-1.5 max-h-52 overflow-y-auto scroll-area pr-1">
                {typeEnrichResults.slice(0, 10).map((m) => (
                  <button key={`${m.id || m.title}-${m.year || ''}`} type="button" onClick={() => applyTypeEnrichment(m)} className="w-full flex items-center gap-3 p-2.5 rounded-lg bg-raised border border-edge hover:border-gold/40 hover:bg-gold/5 transition-all text-left group">
                    {m.poster_path && <img src={posterUrl(m.poster_path)} alt="" className="w-8 h-12 object-cover rounded shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink truncate">{m.title || 'Unknown'}</p>
                      <p className="text-xs text-ghost">{[m.year, m.genre].filter(Boolean).join(' · ')}</p>
                    </div>
                    <span className="text-xs text-gold opacity-0 group-hover:opacity-100 shrink-0">Apply →</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {isMovieOrTv && (
              <>
                <LabeledField label="Original Title" className="col-span-2"><input className="input" value={form.original_title} onChange={(e) => set({ original_title: e.target.value })} /></LabeledField>
                <LabeledField label="Director"><input className="input" value={form.director} onChange={(e) => set({ director: e.target.value })} /></LabeledField>
                <LabeledField label="Genre"><input className="input" placeholder="Action, Drama…" value={form.genre} onChange={(e) => set({ genre: e.target.value })} /></LabeledField>
                <LabeledField label="Cast" className="col-span-2"><input className="input" placeholder="Actor 1, Actor 2…" value={form.cast} onChange={(e) => set({ cast: e.target.value })} /></LabeledField>
                <LabeledField label="Release Date"><input className="input" type="date" value={form.release_date} onChange={(e) => set({ release_date: e.target.value })} /></LabeledField>
                <LabeledField label="Runtime (min)"><input className="input" inputMode="numeric" value={form.runtime} onChange={(e) => set({ runtime: e.target.value })} /></LabeledField>
                <LabeledField label="TMDB Rating"><input className="input" inputMode="decimal" placeholder="0.0 – 10.0" value={form.rating} onChange={(e) => set({ rating: e.target.value })} /></LabeledField>
                {addMode !== 'upc' && <LabeledField label="UPC"><input className="input font-mono" value={form.upc} onChange={(e) => set({ upc: e.target.value })} /></LabeledField>}
              </>
            )}

            {isBook && (
              <>
                <LabeledField label="Author"><input className="input" value={form.book_author} onChange={(e) => set({ book_author: e.target.value })} /></LabeledField>
                <LabeledField label="Publisher"><input className="input" value={form.book_publisher} onChange={(e) => set({ book_publisher: e.target.value })} /></LabeledField>
                <LabeledField label="Edition"><input className="input" value={form.book_edition} onChange={(e) => set({ book_edition: e.target.value })} /></LabeledField>
                <LabeledField label="Genre"><input className="input" value={form.genre} onChange={(e) => set({ genre: e.target.value })} /></LabeledField>
                <LabeledField label="ISBN"><input className="input font-mono" value={form.book_isbn} onChange={(e) => set({ book_isbn: e.target.value })} /></LabeledField>
              </>
            )}

            {isComic && (
              <>
                <LabeledField label="Author"><input className="input" value={form.book_author} onChange={(e) => set({ book_author: e.target.value })} /></LabeledField>
                <LabeledField label="Publisher"><input className="input" value={form.book_publisher} onChange={(e) => set({ book_publisher: e.target.value })} /></LabeledField>
                <LabeledField label="Series"><input className="input" value={form.comic_series} onChange={(e) => set({ comic_series: e.target.value })} /></LabeledField>
                <LabeledField label="Issue #"><input className="input" value={form.comic_issue_number} onChange={(e) => set({ comic_issue_number: e.target.value })} /></LabeledField>
                <LabeledField label="Volume"><input className="input" value={form.comic_volume} onChange={(e) => set({ comic_volume: e.target.value })} /></LabeledField>
                <LabeledField label="Writer"><input className="input" value={form.comic_writer} onChange={(e) => set({ comic_writer: e.target.value })} /></LabeledField>
                <LabeledField label="Artist"><input className="input" value={form.comic_artist} onChange={(e) => set({ comic_artist: e.target.value })} /></LabeledField>
                <LabeledField label="Inker"><input className="input" value={form.comic_inker} onChange={(e) => set({ comic_inker: e.target.value })} /></LabeledField>
                <LabeledField label="Colorist"><input className="input" value={form.comic_colorist} onChange={(e) => set({ comic_colorist: e.target.value })} /></LabeledField>
                <LabeledField label="Cover Date"><input className="input" type="date" value={form.comic_cover_date} onChange={(e) => set({ comic_cover_date: e.target.value })} /></LabeledField>
                <LabeledField label="ISBN"><input className="input font-mono" value={form.book_isbn} onChange={(e) => set({ book_isbn: e.target.value })} /></LabeledField>
              </>
            )}

            {isGame && (
              <>
                <LabeledField label="Platform"><input className="input" value={form.game_platform} onChange={(e) => set({ game_platform: e.target.value })} /></LabeledField>
                <LabeledField label="Developer"><input className="input" value={form.game_developer} onChange={(e) => set({ game_developer: e.target.value })} /></LabeledField>
                <LabeledField label="UPC"><input className="input font-mono" value={form.upc} onChange={(e) => set({ upc: e.target.value })} /></LabeledField>
                <LabeledField label="Genre"><input className="input" value={form.genre} onChange={(e) => set({ genre: e.target.value })} /></LabeledField>
                <LabeledField label="Release Date"><input className="input" type="date" value={form.release_date} onChange={(e) => set({ release_date: e.target.value })} /></LabeledField>
              </>
            )}

            {isAudio && (
              <>
                <LabeledField label="Artist"><input className="input" value={form.audio_artist} onChange={(e) => set({ audio_artist: e.target.value })} /></LabeledField>
                <LabeledField label="Track Count"><input className="input" inputMode="numeric" value={form.audio_track_count} onChange={(e) => set({ audio_track_count: e.target.value })} /></LabeledField>
                <LabeledField label="UPC"><input className="input font-mono" value={form.upc} onChange={(e) => set({ upc: e.target.value })} /></LabeledField>
                <LabeledField label="Release Date"><input className="input" type="date" value={form.release_date} onChange={(e) => set({ release_date: e.target.value })} /></LabeledField>
              </>
            )}

            {form.media_type === 'tv_series' && (
              <>
                <LabeledField label="Network" className="col-span-2"><input className="input" value={form.network} onChange={(e) => set({ network: e.target.value })} /></LabeledField>
                <LabeledField label="Owned Seasons" className="col-span-2"><input className="input" placeholder="1, 2, 3" value={tvSeasonsText} onChange={(e) => setTvSeasonsText(e.target.value)} /></LabeledField>
              </>
            )}
            {form.media_type === 'tv_episode' && (
              <>
                <LabeledField label="Season"><input className="input" inputMode="numeric" value={form.season_number} onChange={(e) => set({ season_number: e.target.value })} /></LabeledField>
                <LabeledField label="Episode"><input className="input" inputMode="numeric" value={form.episode_number} onChange={(e) => set({ episode_number: e.target.value })} /></LabeledField>
                <LabeledField label="Episode Title" className="col-span-2"><input className="input" value={form.episode_title} onChange={(e) => set({ episode_title: e.target.value })} /></LabeledField>
              </>
            )}
          </div>

          <LabeledField label="Your Rating"><StarRating value={form.user_rating || 0} onChange={(v) => set({ user_rating: v })} /></LabeledField>
          <div className="grid grid-cols-2 gap-3">
            <LabeledField label="Signed by"><input className="input" value={form.signed_by} onChange={(e) => set({ signed_by: e.target.value })} /></LabeledField>
            <LabeledField label="Signed as">
              <select className="select" value={form.signed_role} onChange={(e) => set({ signed_role: e.target.value })}>
                <option value="">Not signed</option>
                <option value="author">Author</option>
                <option value="producer">Producer</option>
                <option value="cast">Cast</option>
              </select>
            </LabeledField>
            <LabeledField label="Signed on"><input className="input" type="date" value={form.signed_on} onChange={(e) => set({ signed_on: e.target.value })} /></LabeledField>
            <LabeledField label="Signed at"><input className="input" value={form.signed_at} onChange={(e) => set({ signed_at: e.target.value })} /></LabeledField>
            <LabeledField label="Signing proof image" className="col-span-2">
              <div className="flex flex-col gap-2">
                {form.signed_proof_path && (
                  <a href={posterUrl(form.signed_proof_path)} target="_blank" rel="noreferrer" className="btn-secondary btn-sm w-fit"><Icons.Link />View current proof</a>
                )}
                <div className="flex items-center gap-2">
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={(e) => setProofFile(e.target.files?.[0] || null)}
                    className="block w-full text-sm text-ghost file:btn-secondary file:btn-sm file:border-0 file:mr-3"
                  />
                  <button type="button" onClick={uploadSigningProof} disabled={!proofFile || !form.id} className="btn-secondary btn-sm"><Icons.Upload />Upload</button>
                  <button type="button" onClick={removeSigningProof} disabled={!form.id || !form.signed_proof_path} className="btn-secondary btn-sm text-err"><Icons.Trash />Remove</button>
                </div>
                {!form.id && <p className="text-xs text-ghost">Save first to attach a signing proof image.</p>}
              </div>
            </LabeledField>
          </div>
          <LabeledField label="Storage Location"><input className="input" placeholder="Shelf A3, Box 2…" value={form.location} onChange={(e) => set({ location: e.target.value })} /></LabeledField>
          <LabeledField label="Overview"><textarea className="textarea" rows={3} value={form.overview} onChange={(e) => set({ overview: e.target.value })} /></LabeledField>
          <LabeledField label="Notes"><textarea className="textarea" rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} /></LabeledField>

          {isMovieOrTv && (
            <details className="group">
              <summary className="cursor-pointer text-xs text-ghost hover:text-dim list-none flex items-center gap-2 select-none">
                <span className="transition-transform group-open:rotate-90"><Icons.ChevronRight /></span>
                Advanced (TMDB links, poster path)
              </summary>
              <div className="mt-3 grid grid-cols-1 gap-3">
                <LabeledField label="TMDB ID"><input className="input font-mono" value={form.tmdb_id} onChange={(e) => set({ tmdb_id: e.target.value })} /></LabeledField>
                <LabeledField label="TMDB Media Type"><input className="input font-mono" value={form.tmdb_media_type} onChange={(e) => set({ tmdb_media_type: e.target.value })} /></LabeledField>
                <LabeledField label="TMDB URL"><input className="input" value={form.tmdb_url} onChange={(e) => set({ tmdb_url: e.target.value })} /></LabeledField>
                <LabeledField label="Trailer URL"><input className="input" value={form.trailer_url} onChange={(e) => set({ trailer_url: e.target.value })} /></LabeledField>
                <LabeledField label="Poster Path"><input className="input" value={form.poster_path} onChange={(e) => set({ poster_path: e.target.value })} /></LabeledField>
              </div>
            </details>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-edge bg-abyss px-6 py-4 flex items-center gap-3">
        {msg && <span className={cx('text-sm flex-1', msgType === 'error' ? 'text-err' : 'text-ok')}>{msg}</span>}
        <div className="flex gap-3 ml-auto">
          <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
          <button type="button" onClick={submit} disabled={saving} className="btn-primary min-w-[100px]">{saving ? <Spinner size={16} /> : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

export default function LibraryView({
  mediaItems,
  loading,
  error,
  pagination,
  onRefresh,
  onOpen,
  onEdit,
  onDelete,
  onRating,
  apiCall,
  forcedMediaType
}) {
  const PAGE_SIZE_STORAGE_KEY = 'collectz_library_page_size';
  const VIEW_MODE_STORAGE_KEY = 'collectz_library_view_mode';
  const [searchInput, setSearchInput] = useState('');
  const [resolutionInput, setResolutionInput] = useState('all');
  const [filters, setFilters] = useState({ media_type: forcedMediaType || 'movie', search: '', resolution: 'all', sortBy: 'title', sortDir: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => {
    const saved = Number(window.localStorage.getItem(PAGE_SIZE_STORAGE_KEY));
    return [25, 50, 100, 200].includes(saved) ? saved : 50;
  });
  const [viewMode, setViewMode] = useState(() => {
    const saved = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    return saved === 'list' ? 'list' : 'cards';
  });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [detail, setDetail] = useState(null);
  const [collectionMode, setCollectionMode] = useState('all');
  const [collectionRows, setCollectionRows] = useState([]);
  const [collectionLoading, setCollectionLoading] = useState(false);
  const [collectionError, setCollectionError] = useState('');
  const [collectionPagination, setCollectionPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
  const [editingCollectionId, setEditingCollectionId] = useState(null);
  const [comicView, setComicView] = useState('issues');
  const [comicSeries, setComicSeries] = useState('all');
  const [debouncedSearchInput, setDebouncedSearchInput] = useState('');
  const supportsHover = useMemo(() => window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches, []);
  const addFormMediaType = useMemo(() => {
    if (forcedMediaType === 'tv') return 'tv_series';
    if (['movie', 'book', 'audio', 'game', 'comic_book'].includes(forcedMediaType)) return forcedMediaType;
    return 'movie';
  }, [forcedMediaType]);
  const addFormInitial = useMemo(
    () => ({
      ...DEFAULT_MEDIA_FORM,
      media_type: addFormMediaType,
      tmdb_media_type: addFormMediaType === 'tv_series' ? 'tv' : 'movie'
    }),
    [addFormMediaType]
  );

  const isComicsLibrary = forcedMediaType === 'comic_book';
  const supportsCollections = forcedMediaType === 'movie' || forcedMediaType === 'game';
  const isCollectionMode = supportsCollections && collectionMode === 'collections';
  const useComicFullFetch = isComicsLibrary;
  const requestPage = useComicFullFetch ? 1 : page;
  const requestLimit = useComicFullFetch ? 5000 : pageSize;

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedSearchInput(searchInput.trim());
    }, 250);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    setFilters((f) => {
      if ((f.search || '') === debouncedSearchInput) return f;
      return { ...f, search: debouncedSearchInput };
    });
    setPage(1);
  }, [debouncedSearchInput]);

  useEffect(() => {
    if (isCollectionMode) return;
    onRefresh({ page: requestPage, limit: requestLimit, ...filters });
  }, [filters, page, pageSize, onRefresh, requestPage, requestLimit, isCollectionMode]);

  useEffect(() => {
    if (!forcedMediaType) return;
    setFilters((f) => ({ ...f, media_type: forcedMediaType }));
    setPage(1);
    setCollectionMode('all');
    setCollectionRows([]);
    setCollectionError('');
    if (forcedMediaType !== 'comic_book') {
      setComicView('issues');
      setComicSeries('all');
    }
  }, [forcedMediaType]);

  useEffect(() => {
    if (!isCollectionMode) return;
    let active = true;
    (async () => {
      setCollectionLoading(true);
      setCollectionError('');
      try {
        const params = new URLSearchParams();
        params.set('media_type', forcedMediaType || 'movie');
        params.set('page', String(page));
        params.set('limit', String(pageSize));
        if (debouncedSearchInput) params.set('search', debouncedSearchInput);
        const payload = await apiCall('get', `/media/collections?${params.toString()}`);
        if (!active) return;
        setCollectionRows(Array.isArray(payload?.items) ? payload.items : []);
        const nextPagination = payload?.pagination || { page: 1, limit: pageSize, total: 0, totalPages: 1 };
        setCollectionPagination({
          ...nextPagination,
          hasMore: Number(nextPagination.page || 1) < Number(nextPagination.totalPages || 1)
        });
      } catch (err) {
        if (!active) return;
        setCollectionError(err?.response?.data?.error || 'Failed to load collections');
      } finally {
        if (active) setCollectionLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [apiCall, forcedMediaType, isCollectionMode, page, pageSize, debouncedSearchInput]);

  useEffect(() => {
    window.localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(pageSize));
  }, [pageSize]);

  useEffect(() => {
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
  }, [viewMode]);

  const rate = async (id, rating) => {
    await onRating(id, rating);
    setDetail((d) => (d && d.id === id ? { ...d, user_rating: rating } : d));
  };

  const displayedTotal = isCollectionMode
    ? (collectionPagination?.total ?? collectionRows.length)
    : (pagination?.total ?? mediaItems.length);

  const comicSeriesOptions = useMemo(() => {
    const map = new Map();
    for (const item of mediaItems) {
      const key = getComicSeriesName(item);
      map.set(key, (map.get(key) || 0) + 1);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }));
  }, [mediaItems]);

  const comicSeriesSummaries = useMemo(() => {
    const bySeries = new Map();
    for (const item of mediaItems) {
      const seriesName = getComicSeriesName(item);
      const entry = bySeries.get(seriesName) || { name: seriesName, count: 0, yearMin: null, yearMax: null, poster_path: null };
      entry.count += 1;
      if (Number.isFinite(Number(item.year))) {
        const year = Number(item.year);
        entry.yearMin = entry.yearMin === null ? year : Math.min(entry.yearMin, year);
        entry.yearMax = entry.yearMax === null ? year : Math.max(entry.yearMax, year);
      }
      if (!entry.poster_path && item.poster_path) entry.poster_path = item.poster_path;
      bySeries.set(seriesName, entry);
    }
    return [...bySeries.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [mediaItems]);

  const visibleItems = useMemo(() => {
    if (!isComicsLibrary) return mediaItems;
    let items = mediaItems;
    if (comicView === 'series_issues' && comicSeries !== 'all') {
      items = items.filter((item) => getComicSeriesName(item) === comicSeries);
    }
    if (comicView === 'issues') {
      return [...items].sort((a, b) => {
        const seriesCmp = getComicSeriesName(a).localeCompare(getComicSeriesName(b), undefined, { sensitivity: 'base' });
        if (seriesCmp !== 0) return seriesCmp;
        return compareComicIssueOrder(a, b);
      });
    }
    if (comicView === 'series_issues') {
      return [...items].sort(compareComicIssueOrder);
    }
    return items;
  }, [mediaItems, isComicsLibrary, comicView, comicSeries]);

  const showPagination = !useComicFullFetch;

  if (adding || editing) {
    const isEdit = Boolean(editing);
    return (
      <div className="h-full flex flex-col">
        <MediaForm
          title={isEdit ? 'Edit Media' : 'Add to Library'}
          initial={isEdit ? {
            ...DEFAULT_MEDIA_FORM,
            ...editing,
            cast: editing.cast || editing.cast_members || '',
            release_date: normalizeDateInput(editing.release_date),
            signed_on: normalizeDateInput(editing.signed_on)
          } : addFormInitial}
          apiCall={apiCall}
          onCancel={() => { setAdding(false); setEditing(null); }}
          onDelete={isEdit ? () => { onDelete(editing.id); setEditing(null); } : undefined}
          onSave={async (payload) => {
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
      <div className="px-6 py-4 border-b border-edge shrink-0">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="section-title">Library</h1>
          <span className="badge badge-dim ml-1">{displayedTotal}</span>
          <div className="flex-1" />
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ghost pointer-events-none"><Icons.Search /></span>
            <input className="input pl-9 w-56" placeholder="Search title, director…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
          </div>
          <select className="select w-36" value={resolutionInput} onChange={(e) => {
            const value = e.target.value;
            setResolutionInput(value);
            setFilters((f) => ({ ...f, resolution: value }));
            setPage(1);
          }}>
            <option value="all">All resolutions</option>
            <option value="SD">SD</option>
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
            <option value="4K">4K</option>
          </select>
          <div className="tab-strip">
            <button className={cx('tab', viewMode === 'cards' && 'active')} onClick={() => setViewMode('cards')}><Icons.Film /></button>
            <button className={cx('tab', viewMode === 'list' && 'active')} onClick={() => setViewMode('list')}><Icons.List /></button>
          </div>
          <button onClick={() => { setFilters((f) => ({ ...f, sortDir: f.sortDir === 'asc' ? 'desc' : 'asc' })); setPage(1); }} className="btn-icon" title={filters.sortDir === 'asc' ? 'Sort ascending' : 'Sort descending'}>
            {filters.sortDir === 'asc' ? <Icons.ArrowUp /> : <Icons.ArrowDown />}
          </button>
          <button onClick={() => setAdding(true)} className="btn-primary"><Icons.Plus />Add</button>
        </div>
        {supportsCollections && (
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <div className="tab-strip">
              <button className={cx('tab', collectionMode === 'all' && 'active')} onClick={() => { setCollectionMode('all'); setPage(1); }}>
                {forcedMediaType === 'game' ? 'All Games' : 'All Movies'}
              </button>
              <button className={cx('tab', collectionMode === 'collections' && 'active')} onClick={() => { setCollectionMode('collections'); setPage(1); }}>
                {forcedMediaType === 'game' ? 'Game Collections' : 'Movie Collections'}
              </button>
            </div>
          </div>
        )}
        {isComicsLibrary && (
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <div className="tab-strip">
              <button className={cx('tab', comicView === 'issues' && 'active')} onClick={() => setComicView('issues')}>All Issues</button>
              <button className={cx('tab', comicView === 'series' && 'active')} onClick={() => setComicView('series')}>Series</button>
              <button className={cx('tab', comicView === 'series_issues' && 'active')} onClick={() => setComicView('series_issues')}>Series Issues</button>
            </div>
            {comicView === 'series_issues' && (
              <select className="select min-w-[220px]" value={comicSeries} onChange={(e) => setComicSeries(e.target.value)}>
                <option value="all">All series</option>
                {comicSeriesOptions.map((series) => (
                  <option key={series.name} value={series.name}>{series.name} ({series.count})</option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scroll-area p-6">
        {isCollectionMode ? (
          <>
            {collectionError && <p className="text-sm text-err mb-4">{collectionError}</p>}
            {collectionLoading && <div className="flex items-center justify-center py-20"><Spinner size={32} /></div>}
            {!collectionLoading && collectionRows.length === 0 && (
              <EmptyState
                icon={<Icons.List />}
                title="No collections found"
                subtitle={searchInput.trim() ? 'Try adjusting your search' : 'No collection entries are available for this library type'}
              />
            )}
            {!collectionLoading && collectionRows.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {collectionRows.map((item) => (
                  <article key={item.id} className="card p-4 border border-edge/80">
                    <div className="space-y-2">
                      <p className="font-medium text-ink line-clamp-2">{item.name || item.source_title || `Collection #${item.id}`}</p>
                      <p className="text-xs text-ghost">
                        {(item.media_type === 'game' ? 'Game' : 'Movie')} collection
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <span className="badge badge-dim text-[10px]">Expected: {item.expected_item_count ?? '—'}</span>
                        <span className="badge badge-dim text-[10px]">Items: {item.item_count ?? 0}</span>
                        <span className="badge badge-dim text-[10px]">Linked: {item.linked_item_count ?? 0}</span>
                      </div>
                      <div className="pt-2">
                        <button className="btn-secondary btn-sm" onClick={() => setEditingCollectionId(item.id)}>
                          <Icons.Edit />Edit
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            {error && <p className="text-sm text-err mb-4">{error}</p>}
            {loading && <div className="flex items-center justify-center py-20"><Spinner size={32} /></div>}
            {!loading && mediaItems.length === 0 && (
          <EmptyState
            icon={<Icons.Film />}
            title="No items found"
            subtitle={filters.search || filters.resolution !== 'all' ? 'Try adjusting your filters' : 'Add your first title to get started'}
            action={!filters.search && filters.resolution === 'all' && <button onClick={() => setAdding(true)} className="btn-primary"><Icons.Plus />Add Media</button>}
          />
        )}

        {!loading && isComicsLibrary && comicView === 'series' && comicSeriesSummaries.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {comicSeriesSummaries.map((series) => (
              <button
                key={series.name}
                onClick={() => { setComicSeries(series.name); setComicView('series_issues'); }}
                className="text-left card p-4 hover:border-muted transition-colors"
              >
                <div className="space-y-3">
                  <div className="w-full" style={{ aspectRatio: '2/3' }}>
                    <div className="poster rounded-md w-full h-full">
                      {posterUrl(series.poster_path)
                        ? <img src={posterUrl(series.poster_path)} alt={series.name} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
                        : <div className="absolute inset-0 flex items-center justify-center text-ghost"><Icons.Library /></div>}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-ink line-clamp-2">{series.name}</p>
                    <p className="text-xs text-ghost mt-1">{series.count} issue{series.count === 1 ? '' : 's'}</p>
                    <p className="text-xs text-ghost">
                      {(series.yearMin || series.yearMax)
                        ? (series.yearMin === series.yearMax ? series.yearMin : `${series.yearMin || '—'} - ${series.yearMax || '—'}`)
                        : 'Year unknown'}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {!loading && viewMode === 'cards' && visibleItems.length > 0 && !(isComicsLibrary && comicView === 'series') && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {visibleItems.map((item) => (
              <MediaCard
                key={item.id}
                item={item}
                onOpen={() => setDetail(item)}
                onEdit={() => setEditing(item)}
                onDelete={(id) => { if (window.confirm('Delete this item?')) onDelete(id); }}
                onRating={rate}
                supportsHover={supportsHover}
              />
            ))}
          </div>
        )}

        {!loading && viewMode === 'list' && visibleItems.length > 0 && !(isComicsLibrary && comicView === 'series') && (
          <div className="space-y-2">
            {visibleItems.map((item) => (
              <MediaListRow
                key={item.id}
                item={item}
                onOpen={() => setDetail(item)}
                onEdit={() => setEditing(item)}
                onDelete={(id) => { if (window.confirm('Delete this item?')) onDelete(id); }}
                onRating={rate}
                supportsHover={supportsHover}
              />
            ))}
          </div>
        )}
          </>
        )}
      </div>

      <div className="shrink-0 border-t border-edge px-6 py-3 flex items-center gap-3 flex-wrap">
        {showPagination ? (
          <>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={loading || collectionLoading || page <= 1}
              className="btn-secondary btn-sm"
            >
              Previous
            </button>
            <span className="text-xs text-ghost font-mono">Page {page} / {(isCollectionMode ? (collectionPagination?.totalPages || 1) : (pagination?.totalPages || 1))}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={loading || collectionLoading || !(isCollectionMode ? collectionPagination?.hasMore : pagination?.hasMore)}
              className="btn-secondary btn-sm"
            >
              Next
            </button>
            <div className="ml-auto flex items-center gap-2">
              <label className="text-xs text-ghost">Page size</label>
              <select className="select w-24" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>
            </div>
          </>
        ) : (
          <span className="text-xs text-ghost font-mono">Full comic ordering mode (all issues loaded for accurate numeric sort)</span>
        )}
      </div>

      {detail && (
        <MediaDetail
          item={detail}
          onClose={() => setDetail(null)}
          onEdit={(item) => { setDetail(null); setEditing(item); }}
          onDelete={(id) => { onDelete(id); setDetail(null); }}
          onRating={rate}
          apiCall={apiCall}
        />
      )}
      {editingCollectionId && (
        <CollectionEditor
          collectionId={editingCollectionId}
          apiCall={apiCall}
          onClose={() => setEditingCollectionId(null)}
          onSaved={async () => {
            setPage(1);
            if (isCollectionMode) {
              const params = new URLSearchParams();
              params.set('media_type', forcedMediaType || 'movie');
              params.set('page', String(1));
              params.set('limit', String(pageSize));
              if (debouncedSearchInput) params.set('search', debouncedSearchInput);
              const payload = await apiCall('get', `/media/collections?${params.toString()}`);
              setCollectionRows(Array.isArray(payload?.items) ? payload.items : []);
              const nextPagination = payload?.pagination || { page: 1, limit: pageSize, total: 0, totalPages: 1 };
              setCollectionPagination({
                ...nextPagination,
                hasMore: Number(nextPagination.page || 1) < Number(nextPagination.totalPages || 1)
              });
            }
            if (!isCollectionMode) {
              onRefresh({ page: requestPage, limit: requestLimit, ...filters });
            }
          }}
        />
      )}
    </div>
  );
}
