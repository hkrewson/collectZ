import React, { useEffect, useMemo, useState } from 'react';
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
const DEFAULT_MEDIA_FORM = {
  media_type: 'movie',
  title: '', original_title: '', release_date: '', year: '', format: 'Blu-ray', genre: '',
  director: '', rating: '', user_rating: 0, runtime: '', upc: '', location: '', notes: '',
  overview: '', tmdb_id: '', tmdb_media_type: 'movie', tmdb_url: '', trailer_url: '', poster_path: '', backdrop_path: '',
  season_number: '', episode_number: '', episode_title: '', network: ''
};

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
        <p className="text-xs text-ghost">{item.year || '—'}{item.director ? ` · ${item.director}` : ''}</p>
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
            <p className="text-sm text-dim mt-1">{[item.year, item.director].filter(Boolean).join(' · ')}</p>
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
              ['Location', item.location]
            ].filter(([, v]) => v).map(([k, v]) => (
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

function MediaForm({ initial = DEFAULT_MEDIA_FORM, onSave, onCancel, onDelete, title = 'Add Media', apiCall }) {
  const [form, setForm] = useState(initial);
  const [tvSeasonsText, setTvSeasonsText] = useState(Array.isArray(initial?.tv_seasons) ? initial.tv_seasons.join(', ') : '');
  const [addMode, setAddMode] = useState('title');
  const [tmdbResults, setTmdbResults] = useState([]);
  const [tmdbLoading, setTmdbLoading] = useState(false);
  const [barcodeResults, setBarcodeResults] = useState([]);
  const [barcodeLoading, setBarcodeLoading] = useState(false);
  const [visionResults, setVisionResults] = useState([]);
  const [visionLoading, setVisionLoading] = useState(false);
  const [coverFile, setCoverFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState('ok');

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
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
    } catch {
      notify('TMDB search failed', 'error');
    } finally {
      setTmdbLoading(false);
    }
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

  const submit = async (e) => {
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
            <div className="tab-strip">
              {['title', 'upc', 'cover'].map((m) => (
                <button key={m} className={cx('tab flex-1 capitalize', addMode === m && 'active')} onClick={() => setAddMode(m)}>
                  {m === 'title' ? 'Title Search' : m === 'upc' ? 'Barcode' : 'Cover OCR'}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <LabeledField label="Type" className="col-span-1">
                <select className="select" value={form.media_type} onChange={(e) => set({ media_type: e.target.value })}>
                  {MEDIA_TYPES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </LabeledField>
              <LabeledField label="Format" className="col-span-1">
                <select className="select" value={form.format} onChange={(e) => set({ format: e.target.value })}>
                  {MEDIA_FORMATS.map((f) => <option key={f}>{f}</option>)}
                </select>
              </LabeledField>
              <LabeledField label="Year" className="col-span-1">
                <input className="input" placeholder="2024" value={form.year} onChange={(e) => set({ year: e.target.value })} inputMode="numeric" />
              </LabeledField>
            </div>
          </div>
        </div>

        <div className="px-6 space-y-5 pb-32">
          <LabeledField label="Title *">
            <div className="flex gap-2">
              <input className="input flex-1" placeholder={form.media_type === 'movie' ? 'Movie title' : 'Title'} value={form.title} onChange={(e) => set({ title: e.target.value })} required />
              {addMode === 'title' && (
                <button type="button" onClick={searchTmdb} disabled={tmdbLoading} className="btn-secondary btn-sm shrink-0 min-w-[100px]">
                  {tmdbLoading ? <Spinner size={14} /> : <><Icons.Search />Search</>}
                </button>
              )}
            </div>
          </LabeledField>

          {addMode === 'upc' && (
            <LabeledField label="UPC / Barcode">
              <div className="flex gap-2">
                <input className="input flex-1 font-mono" placeholder="012345678901" value={form.upc} onChange={(e) => set({ upc: e.target.value })} />
                <button type="button" onClick={lookupBarcode} disabled={barcodeLoading} className="btn-secondary btn-sm shrink-0 min-w-[100px]">
                  {barcodeLoading ? <Spinner size={14} /> : <><Icons.Barcode />Lookup</>}
                </button>
              </div>
            </LabeledField>
          )}

          {addMode === 'cover' && (
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

          {allTmdbMatches.length > 0 && (
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

          {barcodeResults.length > 0 && (
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

          <div className="grid grid-cols-2 gap-3">
            <LabeledField label="Original Title" className="col-span-2"><input className="input" value={form.original_title} onChange={(e) => set({ original_title: e.target.value })} /></LabeledField>
            <LabeledField label="Director"><input className="input" value={form.director} onChange={(e) => set({ director: e.target.value })} /></LabeledField>
            <LabeledField label="Genre"><input className="input" placeholder="Action, Drama…" value={form.genre} onChange={(e) => set({ genre: e.target.value })} /></LabeledField>
            <LabeledField label="Release Date"><input className="input" type="date" value={form.release_date} onChange={(e) => set({ release_date: e.target.value })} /></LabeledField>
            <LabeledField label="Runtime (min)"><input className="input" inputMode="numeric" value={form.runtime} onChange={(e) => set({ runtime: e.target.value })} /></LabeledField>
            <LabeledField label="TMDB Rating"><input className="input" inputMode="decimal" placeholder="0.0 – 10.0" value={form.rating} onChange={(e) => set({ rating: e.target.value })} /></LabeledField>
            {addMode !== 'upc' && <LabeledField label="UPC"><input className="input font-mono" value={form.upc} onChange={(e) => set({ upc: e.target.value })} /></LabeledField>}
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
          <LabeledField label="Storage Location"><input className="input" placeholder="Shelf A3, Box 2…" value={form.location} onChange={(e) => set({ location: e.target.value })} /></LabeledField>
          <LabeledField label="Overview"><textarea className="textarea" rows={3} value={form.overview} onChange={(e) => set({ overview: e.target.value })} /></LabeledField>
          <LabeledField label="Notes"><textarea className="textarea" rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} /></LabeledField>

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

export default function LibraryView({ mediaItems, loading, error, pagination, onRefresh, onOpen, onEdit, onDelete, onRating, apiCall, forcedMediaType }) {
  const [searchInput, setSearchInput] = useState('');
  const [resolutionInput, setResolutionInput] = useState('all');
  const [filters, setFilters] = useState({ media_type: forcedMediaType || 'movie', search: '', resolution: 'all', sortBy: 'title', sortDir: 'asc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [viewMode, setViewMode] = useState('cards');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [detail, setDetail] = useState(null);

  const supportsHover = useMemo(() => window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches, []);

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
    setDetail((d) => (d && d.id === id ? { ...d, user_rating: rating } : d));
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
          initial={isEdit ? { ...DEFAULT_MEDIA_FORM, ...editing, release_date: editing.release_date ? String(editing.release_date).slice(0, 10) : '' } : DEFAULT_MEDIA_FORM}
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
          <span className="badge badge-dim ml-1">{pagination?.total ?? mediaItems.length}</span>
          <div className="flex-1" />
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ghost pointer-events-none"><Icons.Search /></span>
            <input className="input pl-9 w-56" placeholder="Search title, director…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') applySearch(); }} />
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
      </div>

      <div className="flex-1 overflow-y-auto scroll-area p-6">
        {error && <p className="text-sm text-err mb-4">{error}</p>}
        {loading && <div className="flex items-center justify-center py-20"><Spinner size={32} /></div>}
        {!loading && mediaItems.length === 0 && (
          <EmptyState
            icon={<Icons.Film />}
            title="No items found"
            subtitle={filters.media_type !== 'movie' || filters.search || filters.resolution !== 'all' ? 'Try adjusting your filters' : 'Add your first title to get started'}
            action={filters.media_type === 'movie' && !filters.search && filters.resolution === 'all' && <button onClick={() => setAdding(true)} className="btn-primary"><Icons.Plus />Add Media</button>}
          />
        )}

        {!loading && viewMode === 'cards' && mediaItems.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {mediaItems.map((item) => (
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

        {!loading && viewMode === 'list' && mediaItems.length > 0 && (
          <div className="space-y-2">
            {mediaItems.map((item) => (
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
      </div>

      <div className="shrink-0 border-t border-edge px-6 py-3 flex items-center gap-3 flex-wrap">
        <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={loading || page <= 1} className="btn-secondary btn-sm">Previous</button>
        <span className="text-xs text-ghost font-mono">Page {page} / {pagination?.totalPages || 1}</span>
        <button onClick={() => setPage((p) => p + 1)} disabled={loading || !(pagination?.hasMore)} className="btn-secondary btn-sm">Next</button>
        <div className="ml-auto flex items-center gap-2">
          <label className="text-xs text-ghost">Page size</label>
          <select className="select w-24" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
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
    </div>
  );
}
