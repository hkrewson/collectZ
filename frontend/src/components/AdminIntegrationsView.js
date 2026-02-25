import React, { useEffect, useMemo, useState } from 'react';

const BARCODE_PRESETS = {
  upcitemdb: { barcodePreset: 'upcitemdb', barcodeProvider: 'upcitemdb', barcodeApiUrl: 'https://api.upcitemdb.com/prod/trial/lookup', barcodeApiKeyHeader: 'x-api-key', barcodeQueryParam: 'upc' },
  barcodelookup: { barcodePreset: 'barcodelookup', barcodeProvider: 'barcodelookup', barcodeApiUrl: 'https://api.barcodelookup.com/v3/products', barcodeApiKeyHeader: 'Authorization', barcodeQueryParam: 'barcode' },
  custom: { barcodePreset: 'custom', barcodeProvider: 'custom', barcodeApiUrl: '', barcodeApiKeyHeader: 'x-api-key', barcodeQueryParam: 'upc' }
};
const VISION_PRESETS = {
  ocrspace: { visionPreset: 'ocrspace', visionProvider: 'ocrspace', visionApiUrl: 'https://api.ocr.space/parse/image', visionApiKeyHeader: 'apikey' },
  custom: { visionPreset: 'custom', visionProvider: 'custom', visionApiUrl: '', visionApiKeyHeader: 'x-api-key' }
};
const TMDB_PRESETS = {
  tmdb: { tmdbPreset: 'tmdb', tmdbProvider: 'tmdb', tmdbApiUrl: 'https://api.themoviedb.org/3/search/movie', tmdbApiKeyHeader: '', tmdbApiKeyQueryParam: 'api_key' },
  custom: { tmdbPreset: 'custom', tmdbProvider: 'custom', tmdbApiUrl: '', tmdbApiKeyHeader: '', tmdbApiKeyQueryParam: 'api_key' }
};
const PLEX_PRESETS = {
  plex: { plexPreset: 'plex', plexProvider: 'plex', plexApiUrl: '', plexApiKeyQueryParam: 'X-Plex-Token' },
  custom: { plexPreset: 'custom', plexProvider: 'custom', plexApiUrl: '', plexApiKeyQueryParam: 'X-Plex-Token' }
};
const BOOKS_PRESETS = {
  googlebooks: { booksPreset: 'googlebooks', booksProvider: 'googlebooks', booksApiUrl: 'https://www.googleapis.com/books/v1/volumes', booksApiKeyHeader: '', booksApiKeyQueryParam: 'key' },
  custom: { booksPreset: 'custom', booksProvider: 'custom', booksApiUrl: '', booksApiKeyHeader: '', booksApiKeyQueryParam: 'key' }
};
const AUDIO_PRESETS = {
  discogs: { audioPreset: 'discogs', audioProvider: 'discogs', audioApiUrl: 'https://api.discogs.com/database/search', audioApiKeyHeader: 'Authorization', audioApiKeyQueryParam: 'token' },
  custom: { audioPreset: 'custom', audioProvider: 'custom', audioApiUrl: '', audioApiKeyHeader: 'x-api-key', audioApiKeyQueryParam: 'api_key' }
};
const GAMES_PRESETS = {
  igdb: { gamesPreset: 'igdb', gamesProvider: 'igdb', gamesApiUrl: 'https://api.igdb.com/v4/games', gamesApiKeyHeader: 'Authorization', gamesApiKeyQueryParam: '' },
  custom: { gamesPreset: 'custom', gamesProvider: 'custom', gamesApiUrl: '', gamesApiKeyHeader: 'Authorization', gamesApiKeyQueryParam: 'api_key' }
};

function LabeledField({ label, className = '', children, cx }) {
  return (
    <div className={cx('field', className)}>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

function StatusBadge({ status, cx }) {
  const map = { ok: 'badge-ok', configured: 'badge-ok', auth_failed: 'badge-err', error: 'badge-err', missing: 'badge-warn', unknown: 'badge-dim' };
  const labels = { ok: 'Connected', configured: 'Configured', auth_failed: 'Auth Failed', error: 'Error', missing: 'Missing Key', unknown: 'Unknown' };
  return <span className={cx('badge', map[status] || 'badge-dim')}>{labels[status] || 'Unknown'}</span>;
}

export default function AdminIntegrationsView({ apiCall, onToast, onQueueJob, Spinner, cx }) {
  const [section, setSection] = useState('barcode');
  const [form, setForm] = useState({
    barcodePreset: 'upcitemdb', barcodeProvider: 'upcitemdb', barcodeApiUrl: '', barcodeApiKey: '',
    barcodeApiKeyHeader: 'x-api-key', barcodeQueryParam: 'upc', clearBarcodeApiKey: false,
    visionPreset: 'ocrspace', visionProvider: 'ocrspace', visionApiUrl: '', visionApiKey: '',
    visionApiKeyHeader: 'apikey', clearVisionApiKey: false,
    tmdbPreset: 'tmdb', tmdbProvider: 'tmdb', tmdbApiUrl: 'https://api.themoviedb.org/3/search/movie',
    tmdbApiKey: '', tmdbApiKeyHeader: '', tmdbApiKeyQueryParam: 'api_key', clearTmdbApiKey: false,
    plexPreset: 'plex', plexProvider: 'plex', plexApiUrl: '', plexServerName: '',
    plexApiKey: '', plexApiKeyQueryParam: 'X-Plex-Token', plexLibrarySections: '', clearPlexApiKey: false,
    booksPreset: 'googlebooks', booksProvider: 'googlebooks', booksApiUrl: 'https://www.googleapis.com/books/v1/volumes',
    booksApiKey: '', booksApiKeyHeader: '', booksApiKeyQueryParam: 'key', clearBooksApiKey: false,
    audioPreset: 'discogs', audioProvider: 'discogs', audioApiUrl: 'https://api.discogs.com/database/search',
    audioApiKey: '', audioApiKeyHeader: '', audioApiKeyQueryParam: '', clearAudioApiKey: false,
    gamesPreset: 'igdb', gamesProvider: 'igdb', gamesApiUrl: 'https://api.igdb.com/v4/games',
    gamesApiKey: '', gamesApiKeyHeader: 'Authorization', gamesApiKeyQueryParam: '', gamesClientId: '', gamesClientSecret: '', clearGamesApiKey: false, clearGamesClientSecret: false
  });
  const [meta, setMeta] = useState({
    barcodeApiKeySet: false, barcodeApiKeyMasked: '',
    visionApiKeySet: false, visionApiKeyMasked: '',
    tmdbApiKeySet: false, tmdbApiKeyMasked: '',
    plexApiKeySet: false, plexApiKeyMasked: '',
    booksApiKeySet: false, booksApiKeyMasked: '',
    audioApiKeySet: false, audioApiKeyMasked: '',
    gamesApiKeySet: false, gamesApiKeyMasked: '',
    gamesClientSecretSet: false, gamesClientSecretMasked: '',
    decryptHealth: { hasWarnings: false, warnings: [], remediation: '' }
  });
  const [status, setStatus] = useState({ barcode: 'unknown', vision: 'unknown', tmdb: 'unknown', plex: 'unknown', books: 'unknown', audio: 'unknown', games: 'unknown' });
  const [testLoading, setTestLoading] = useState('');
  const [testMsg, setTestMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [importingPlex, setImportingPlex] = useState(false);
  const [plexAvailableSections, setPlexAvailableSections] = useState([]);

  useEffect(() => {
    apiCall('get', '/admin/settings/integrations').then((data) => {
      setForm((f) => ({
        ...f,
        barcodePreset: data.barcodePreset || 'upcitemdb', barcodeProvider: data.barcodeProvider || '', barcodeApiUrl: data.barcodeApiUrl || '', barcodeApiKeyHeader: data.barcodeApiKeyHeader || 'x-api-key', barcodeQueryParam: data.barcodeQueryParam || 'upc',
        visionPreset: data.visionPreset || 'ocrspace', visionProvider: data.visionProvider || '', visionApiUrl: data.visionApiUrl || '', visionApiKeyHeader: data.visionApiKeyHeader || 'apikey',
        tmdbPreset: data.tmdbPreset || 'tmdb', tmdbProvider: data.tmdbProvider || '', tmdbApiUrl: data.tmdbApiUrl || '', tmdbApiKeyHeader: data.tmdbApiKeyHeader || '', tmdbApiKeyQueryParam: data.tmdbApiKeyQueryParam || 'api_key',
        plexPreset: data.plexPreset || 'plex', plexProvider: data.plexProvider || 'plex', plexApiUrl: data.plexApiUrl || '', plexServerName: data.plexServerName || '', plexApiKeyQueryParam: data.plexApiKeyQueryParam || 'X-Plex-Token',
        plexLibrarySections: Array.isArray(data.plexLibrarySections) ? data.plexLibrarySections.join(',') : '',
        booksPreset: data.booksPreset || 'googlebooks', booksProvider: data.booksProvider || 'googlebooks', booksApiUrl: data.booksApiUrl || 'https://www.googleapis.com/books/v1/volumes',
        booksApiKeyHeader: data.booksApiKeyHeader || '', booksApiKeyQueryParam: data.booksApiKeyQueryParam || 'key',
        audioPreset: data.audioPreset || 'discogs', audioProvider: data.audioProvider || 'discogs', audioApiUrl: data.audioApiUrl || 'https://api.discogs.com/database/search',
        audioApiKeyHeader: data.audioApiKeyHeader || '', audioApiKeyQueryParam: data.audioApiKeyQueryParam || '',
        gamesPreset: data.gamesPreset || 'igdb', gamesProvider: data.gamesProvider || 'igdb', gamesApiUrl: data.gamesApiUrl || 'https://api.igdb.com/v4/games',
        gamesApiKeyHeader: data.gamesApiKeyHeader || 'Authorization', gamesApiKeyQueryParam: data.gamesApiKeyQueryParam || '', gamesClientId: data.gamesClientId || ''
      }));
      setMeta({
        barcodeApiKeySet: Boolean(data.barcodeApiKeySet), barcodeApiKeyMasked: data.barcodeApiKeyMasked || '',
        visionApiKeySet: Boolean(data.visionApiKeySet), visionApiKeyMasked: data.visionApiKeyMasked || '',
        tmdbApiKeySet: Boolean(data.tmdbApiKeySet), tmdbApiKeyMasked: data.tmdbApiKeyMasked || '',
        plexApiKeySet: Boolean(data.plexApiKeySet), plexApiKeyMasked: data.plexApiKeyMasked || '',
        booksApiKeySet: Boolean(data.booksApiKeySet), booksApiKeyMasked: data.booksApiKeyMasked || '',
        audioApiKeySet: Boolean(data.audioApiKeySet), audioApiKeyMasked: data.audioApiKeyMasked || '',
        gamesApiKeySet: Boolean(data.gamesApiKeySet), gamesApiKeyMasked: data.gamesApiKeyMasked || '',
        gamesClientSecretSet: Boolean(data.gamesClientSecretSet), gamesClientSecretMasked: data.gamesClientSecretMasked || '',
        decryptHealth: data.decryptHealth || { hasWarnings: false, warnings: [], remediation: '' }
      });
      setStatus({
        barcode: data.barcodeApiKeySet ? 'configured' : 'missing',
        vision: data.visionApiKeySet ? 'configured' : 'missing',
        tmdb: data.tmdbApiKeySet ? 'configured' : 'missing',
        plex: data.plexApiKeySet ? 'configured' : 'missing',
        books: data.booksApiKeySet ? 'configured' : 'missing',
        audio: data.audioApiKeySet ? 'configured' : 'missing',
        games: (data.gamesApiKeySet || (data.gamesClientId && data.gamesClientSecretSet)) ? 'configured' : 'missing'
      });
    }).catch(() => {});
  }, [apiCall]);

  const applyBarcodePreset = (p) => setForm((f) => ({ ...f, ...(BARCODE_PRESETS[p] || {}) }));
  const applyVisionPreset = (p) => setForm((f) => ({ ...f, ...(VISION_PRESETS[p] || {}) }));
  const applyTmdbPreset = (p) => setForm((f) => ({ ...f, ...(TMDB_PRESETS[p] || {}) }));
  const applyPlexPreset = (p) => setForm((f) => ({ ...f, ...(PLEX_PRESETS[p] || {}) }));
  const applyBooksPreset = (p) => setForm((f) => ({ ...f, ...(BOOKS_PRESETS[p] || {}) }));
  const applyAudioPreset = (p) => setForm((f) => ({ ...f, ...(AUDIO_PRESETS[p] || {}) }));
  const applyGamesPreset = (p) => setForm((f) => ({ ...f, ...(GAMES_PRESETS[p] || {}) }));
  const plexSectionIds = useMemo(
    () => form.plexLibrarySections.split(',').map((v) => v.trim()).filter(Boolean),
    [form.plexLibrarySections]
  );

  const togglePlexSection = (id) => {
    const next = new Set(plexSectionIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setForm((f) => ({ ...f, plexLibrarySections: [...next].join(',') }));
  };

  const saveSection = async (sec) => {
    setSaving(true);
    const payload = {};
    if (sec === 'barcode') Object.assign(payload, { barcodePreset: form.barcodePreset, barcodeProvider: form.barcodeProvider, barcodeApiUrl: form.barcodeApiUrl, barcodeApiKeyHeader: form.barcodeApiKeyHeader, barcodeQueryParam: form.barcodeQueryParam, clearBarcodeApiKey: form.clearBarcodeApiKey, ...(form.barcodeApiKey && { barcodeApiKey: form.barcodeApiKey }) });
    else if (sec === 'vision') Object.assign(payload, { visionPreset: form.visionPreset, visionProvider: form.visionProvider, visionApiUrl: form.visionApiUrl, visionApiKeyHeader: form.visionApiKeyHeader, clearVisionApiKey: form.clearVisionApiKey, ...(form.visionApiKey && { visionApiKey: form.visionApiKey }) });
    else if (sec === 'tmdb') Object.assign(payload, { tmdbPreset: form.tmdbPreset, tmdbProvider: form.tmdbProvider, tmdbApiUrl: form.tmdbApiUrl, tmdbApiKeyHeader: form.tmdbApiKeyHeader, tmdbApiKeyQueryParam: form.tmdbApiKeyQueryParam, clearTmdbApiKey: form.clearTmdbApiKey, ...(form.tmdbApiKey && { tmdbApiKey: form.tmdbApiKey }) });
    else if (sec === 'plex') Object.assign(payload, {
      plexPreset: form.plexPreset, plexProvider: form.plexProvider, plexApiUrl: form.plexApiUrl, plexServerName: form.plexServerName,
      plexApiKeyQueryParam: form.plexApiKeyQueryParam, clearPlexApiKey: form.clearPlexApiKey,
      plexLibrarySections: form.plexLibrarySections.split(',').map((v) => v.trim()).filter(Boolean),
      ...(form.plexApiKey && { plexApiKey: form.plexApiKey })
    });
    else if (sec === 'books') Object.assign(payload, {
      booksPreset: form.booksPreset, booksProvider: form.booksProvider, booksApiUrl: form.booksApiUrl,
      booksApiKeyHeader: form.booksApiKeyHeader, booksApiKeyQueryParam: form.booksApiKeyQueryParam,
      clearBooksApiKey: form.clearBooksApiKey, ...(form.booksApiKey && { booksApiKey: form.booksApiKey })
    });
    else if (sec === 'audio') Object.assign(payload, {
      audioPreset: form.audioPreset, audioProvider: form.audioProvider, audioApiUrl: form.audioApiUrl,
      audioApiKeyHeader: form.audioApiKeyHeader, audioApiKeyQueryParam: form.audioApiKeyQueryParam,
      clearAudioApiKey: form.clearAudioApiKey, ...(form.audioApiKey && { audioApiKey: form.audioApiKey })
    });
    else if (sec === 'games') Object.assign(payload, {
      gamesPreset: form.gamesPreset, gamesProvider: form.gamesProvider, gamesApiUrl: form.gamesApiUrl,
      gamesApiKeyHeader: form.gamesApiKeyHeader, gamesApiKeyQueryParam: form.gamesApiKeyQueryParam,
      gamesClientId: form.gamesClientId, clearGamesApiKey: form.clearGamesApiKey, clearGamesClientSecret: form.clearGamesClientSecret,
      ...(form.gamesApiKey && { gamesApiKey: form.gamesApiKey }),
      ...(form.gamesClientSecret && { gamesClientSecret: form.gamesClientSecret })
    });
    try {
      const updated = await apiCall('put', '/admin/settings/integrations', payload);
      setMeta({
        barcodeApiKeySet: Boolean(updated.barcodeApiKeySet), barcodeApiKeyMasked: updated.barcodeApiKeyMasked || '',
        visionApiKeySet: Boolean(updated.visionApiKeySet), visionApiKeyMasked: updated.visionApiKeyMasked || '',
        tmdbApiKeySet: Boolean(updated.tmdbApiKeySet), tmdbApiKeyMasked: updated.tmdbApiKeyMasked || '',
        plexApiKeySet: Boolean(updated.plexApiKeySet), plexApiKeyMasked: updated.plexApiKeyMasked || '',
        booksApiKeySet: Boolean(updated.booksApiKeySet), booksApiKeyMasked: updated.booksApiKeyMasked || '',
        audioApiKeySet: Boolean(updated.audioApiKeySet), audioApiKeyMasked: updated.audioApiKeyMasked || '',
        gamesApiKeySet: Boolean(updated.gamesApiKeySet), gamesApiKeyMasked: updated.gamesApiKeyMasked || '',
        gamesClientSecretSet: Boolean(updated.gamesClientSecretSet), gamesClientSecretMasked: updated.gamesClientSecretMasked || '',
        decryptHealth: updated.decryptHealth || { hasWarnings: false, warnings: [], remediation: '' }
      });
      setStatus((s) => ({
        ...s,
        [sec]: sec === 'games'
          ? ((updated.gamesApiKeySet || (updated.gamesClientId && updated.gamesClientSecretSet)) ? 'configured' : 'missing')
          : (updated[`${sec}ApiKeySet`] ? 'configured' : 'missing')
      }));
      setForm((f) => ({
        ...f,
        barcodeApiKey: '', visionApiKey: '', tmdbApiKey: '', plexApiKey: '', booksApiKey: '', audioApiKey: '', gamesApiKey: '', gamesClientSecret: '',
        clearBarcodeApiKey: false, clearVisionApiKey: false, clearTmdbApiKey: false, clearPlexApiKey: false,
        clearBooksApiKey: false, clearAudioApiKey: false, clearGamesApiKey: false, clearGamesClientSecret: false
      }));
      onToast(`${sec.toUpperCase()} settings saved`);
    } catch (err) {
      onToast(err.response?.data?.error || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const test = async (sec) => {
    setTestLoading(sec);
    setTestMsg('');
    try {
      const payload = sec === 'tmdb'
        ? { title: 'The Matrix', year: '1999' }
        : sec === 'books'
          ? { title: 'Dust', author: 'Hugh Howey' }
          : sec === 'audio'
            ? { title: 'Kind of Blue', artist: 'Miles Davis' }
            : sec === 'games'
              ? { title: 'Halo' }
              : {};
      const result = await apiCall('post', `/admin/settings/integrations/test-${sec}`, payload);
      setStatus((s) => ({ ...s, [sec]: result.authenticated ? 'ok' : 'auth_failed' }));
      setTestMsg(`${sec.toUpperCase()}: ${result.authenticated ? 'Connected' : 'Auth failed'} — ${result.detail}`);
      if (sec === 'plex') setPlexAvailableSections(Array.isArray(result.sections) ? result.sections : []);
    } catch (err) {
      setTestMsg(err.response?.data?.detail || `${sec} test failed`);
    } finally {
      setTestLoading('');
    }
  };

  const runPlexImport = async () => {
    setImportingPlex(true);
    try {
      const enqueue = await apiCall('post', '/media/import-plex?async=true', { sectionIds: plexSectionIds });
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
    } finally {
      setImportingPlex(false);
    }
  };

  const sections = ['barcode', 'vision', 'tmdb', 'plex', 'books', 'audio', 'games'];

  return (
    <div className="h-full overflow-y-auto p-6 max-w-2xl space-y-6">
      <h1 className="section-title">Integrations</h1>

      <div className="flex gap-3">
        {sections.map((s) => (
          <button key={s} onClick={() => setSection(s)} className={cx('btn flex-1 uppercase tracking-wider text-xs font-display', section === s ? 'btn-primary' : 'btn-secondary')}>
            {s} <StatusBadge status={status[s]} cx={cx} />
          </button>
        ))}
      </div>

      {meta.decryptHealth?.hasWarnings && (
        <div className="card p-4 border border-edge bg-raised">
          <p className="text-sm font-semibold text-ink">Integration key decryption warning</p>
          <p className="text-xs text-dim mt-1">{meta.decryptHealth.remediation || 'Re-enter and save the affected key, or clear it.'}</p>
          <ul className="mt-2 space-y-1">
            {(meta.decryptHealth.warnings || []).map((w, idx) => (
              <li key={`${w.provider || 'integration'}-${idx}`} className="text-xs text-dim font-mono">
                {String(w.provider || 'integration').toUpperCase()}: {w.field || 'secret'} ({w.code || 'warning'})
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card p-5 space-y-4">
        {section === 'barcode' && <>
          <LabeledField label="Preset" cx={cx}><select className="select" value={form.barcodePreset} onChange={(e) => applyBarcodePreset(e.target.value)}>
            <option value="upcitemdb">UPCItemDB</option><option value="barcodelookup">BarcodeLookup</option><option value="custom">Custom</option>
          </select></LabeledField>
          <LabeledField label="API URL" cx={cx}><input className="input" value={form.barcodeApiUrl} onChange={(e) => setForm((f) => ({ ...f, barcodeApiUrl: e.target.value }))} /></LabeledField>
          <div className="grid grid-cols-2 gap-3">
            <LabeledField label="Key Header" cx={cx}><input className="input" value={form.barcodeApiKeyHeader} onChange={(e) => setForm((f) => ({ ...f, barcodeApiKeyHeader: e.target.value }))} /></LabeledField>
            <LabeledField label="Query Param" cx={cx}><input className="input" value={form.barcodeQueryParam} onChange={(e) => setForm((f) => ({ ...f, barcodeQueryParam: e.target.value }))} /></LabeledField>
          </div>
          <LabeledField label={`API Key ${meta.barcodeApiKeySet ? `(set: ${meta.barcodeApiKeyMasked})` : '(not set)'}`} cx={cx}>
            <input className="input font-mono" type="password" placeholder="Enter new key to update" value={form.barcodeApiKey} onChange={(e) => setForm((f) => ({ ...f, barcodeApiKey: e.target.value }))} />
          </LabeledField>
          <label className="flex items-center gap-2 text-sm text-dim cursor-pointer">
            <input type="checkbox" checked={form.clearBarcodeApiKey} onChange={(e) => setForm((f) => ({ ...f, clearBarcodeApiKey: e.target.checked }))} className="rounded" />
            Clear saved key
          </label>
        </>}

        {section === 'vision' && <>
          <LabeledField label="Preset" cx={cx}><select className="select" value={form.visionPreset} onChange={(e) => applyVisionPreset(e.target.value)}>
            <option value="ocrspace">OCR.Space</option><option value="custom">Custom</option>
          </select></LabeledField>
          <LabeledField label="API URL" cx={cx}><input className="input" value={form.visionApiUrl} onChange={(e) => setForm((f) => ({ ...f, visionApiUrl: e.target.value }))} /></LabeledField>
          <LabeledField label="Key Header" cx={cx}><input className="input" value={form.visionApiKeyHeader} onChange={(e) => setForm((f) => ({ ...f, visionApiKeyHeader: e.target.value }))} /></LabeledField>
          <LabeledField label={`API Key ${meta.visionApiKeySet ? `(set: ${meta.visionApiKeyMasked})` : '(not set)'}`} cx={cx}>
            <input className="input font-mono" type="password" placeholder="Enter new key to update" value={form.visionApiKey} onChange={(e) => setForm((f) => ({ ...f, visionApiKey: e.target.value }))} />
          </LabeledField>
          <label className="flex items-center gap-2 text-sm text-dim cursor-pointer">
            <input type="checkbox" checked={form.clearVisionApiKey} onChange={(e) => setForm((f) => ({ ...f, clearVisionApiKey: e.target.checked }))} className="rounded" />
            Clear saved key
          </label>
        </>}

        {section === 'tmdb' && <>
          <LabeledField label="Preset" cx={cx}><select className="select" value={form.tmdbPreset} onChange={(e) => applyTmdbPreset(e.target.value)}>
            <option value="tmdb">TMDB</option><option value="custom">Custom</option>
          </select></LabeledField>
          <LabeledField label="API URL" cx={cx}><input className="input" value={form.tmdbApiUrl} onChange={(e) => setForm((f) => ({ ...f, tmdbApiUrl: e.target.value }))} /></LabeledField>
          <div className="grid grid-cols-2 gap-3">
            <LabeledField label="Key Header (opt)" cx={cx}><input className="input" value={form.tmdbApiKeyHeader} onChange={(e) => setForm((f) => ({ ...f, tmdbApiKeyHeader: e.target.value }))} /></LabeledField>
            <LabeledField label="Key Query Param" cx={cx}><input className="input" value={form.tmdbApiKeyQueryParam} onChange={(e) => setForm((f) => ({ ...f, tmdbApiKeyQueryParam: e.target.value }))} /></LabeledField>
          </div>
          <LabeledField label={`API Key ${meta.tmdbApiKeySet ? `(set: ${meta.tmdbApiKeyMasked})` : '(not set)'}`} cx={cx}>
            <input className="input font-mono" type="password" placeholder="Enter new key to update" value={form.tmdbApiKey} onChange={(e) => setForm((f) => ({ ...f, tmdbApiKey: e.target.value }))} />
          </LabeledField>
          <label className="flex items-center gap-2 text-sm text-dim cursor-pointer">
            <input type="checkbox" checked={form.clearTmdbApiKey} onChange={(e) => setForm((f) => ({ ...f, clearTmdbApiKey: e.target.checked }))} className="rounded" />
            Clear saved key
          </label>
        </>}

        {section === 'plex' && <>
          <LabeledField label="Preset" cx={cx}><select className="select" value={form.plexPreset} onChange={(e) => applyPlexPreset(e.target.value)}>
            <option value="plex">Plex</option><option value="custom">Custom</option>
          </select></LabeledField>
          <LabeledField label="Plex API URL" cx={cx}><input className="input" placeholder="https://plex-host:32400" value={form.plexApiUrl} onChange={(e) => setForm((f) => ({ ...f, plexApiUrl: e.target.value }))} /></LabeledField>
          <LabeledField label="Server Name (optional)" cx={cx}><input className="input" value={form.plexServerName} onChange={(e) => setForm((f) => ({ ...f, plexServerName: e.target.value }))} /></LabeledField>
          <div className="grid grid-cols-2 gap-3">
            <LabeledField label="Token Query Param" cx={cx}><input className="input" value={form.plexApiKeyQueryParam} onChange={(e) => setForm((f) => ({ ...f, plexApiKeyQueryParam: e.target.value }))} /></LabeledField>
            <LabeledField label="Library Section IDs" cx={cx}>
              <input className="input font-mono" placeholder="1,2,5" value={form.plexLibrarySections} onChange={(e) => setForm((f) => ({ ...f, plexLibrarySections: e.target.value }))} />
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
                    <input type="checkbox" checked={plexSectionIds.includes(String(sec.id))} onChange={() => togglePlexSection(String(sec.id))} className="rounded" />
                    <span className="font-medium text-ink">{sec.title || `Section ${sec.id}`}</span>
                    <span className="text-ghost">({sec.type || 'unknown'})</span>
                    <span className="ml-auto font-mono text-xs text-ghost">#{sec.id}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <LabeledField label={`Plex API Key ${meta.plexApiKeySet ? `(set: ${meta.plexApiKeyMasked})` : '(not set)'}`} cx={cx}>
            <input className="input font-mono" type="password" placeholder="Enter new key to update" value={form.plexApiKey} onChange={(e) => setForm((f) => ({ ...f, plexApiKey: e.target.value }))} />
          </LabeledField>
          <label className="flex items-center gap-2 text-sm text-dim cursor-pointer">
            <input type="checkbox" checked={form.clearPlexApiKey} onChange={(e) => setForm((f) => ({ ...f, clearPlexApiKey: e.target.checked }))} className="rounded" />
            Clear saved key
          </label>
        </>}

        {section === 'books' && <>
          <LabeledField label="Preset" cx={cx}><select className="select" value={form.booksPreset} onChange={(e) => applyBooksPreset(e.target.value)}>
            <option value="googlebooks">Google Books</option><option value="custom">Custom</option>
          </select></LabeledField>
          <LabeledField label="Books API URL" cx={cx}><input className="input" value={form.booksApiUrl} onChange={(e) => setForm((f) => ({ ...f, booksApiUrl: e.target.value }))} /></LabeledField>
          <div className="grid grid-cols-2 gap-3">
            <LabeledField label="Key Header (opt)" cx={cx}><input className="input" value={form.booksApiKeyHeader} onChange={(e) => setForm((f) => ({ ...f, booksApiKeyHeader: e.target.value }))} /></LabeledField>
            <LabeledField label="Key Query Param" cx={cx}><input className="input" value={form.booksApiKeyQueryParam} onChange={(e) => setForm((f) => ({ ...f, booksApiKeyQueryParam: e.target.value }))} /></LabeledField>
          </div>
          <LabeledField label={`Books API Key ${meta.booksApiKeySet ? `(set: ${meta.booksApiKeyMasked})` : '(not set)'}`} cx={cx}>
            <input className="input font-mono" type="password" placeholder="Enter new key to update" value={form.booksApiKey} onChange={(e) => setForm((f) => ({ ...f, booksApiKey: e.target.value }))} />
          </LabeledField>
          <label className="flex items-center gap-2 text-sm text-dim cursor-pointer">
            <input type="checkbox" checked={form.clearBooksApiKey} onChange={(e) => setForm((f) => ({ ...f, clearBooksApiKey: e.target.checked }))} className="rounded" />
            Clear saved key
          </label>
        </>}

        {section === 'audio' && <>
          <LabeledField label="Preset" cx={cx}><select className="select" value={form.audioPreset} onChange={(e) => applyAudioPreset(e.target.value)}>
            <option value="discogs">Discogs</option><option value="custom">Custom</option>
          </select></LabeledField>
          <LabeledField label="Audio API URL" cx={cx}><input className="input" value={form.audioApiUrl} onChange={(e) => setForm((f) => ({ ...f, audioApiUrl: e.target.value }))} /></LabeledField>
          <div className="grid grid-cols-2 gap-3">
            <LabeledField label="Key Header" cx={cx}><input className="input" value={form.audioApiKeyHeader} onChange={(e) => setForm((f) => ({ ...f, audioApiKeyHeader: e.target.value }))} /></LabeledField>
            <LabeledField label="Key Query Param" cx={cx}><input className="input" value={form.audioApiKeyQueryParam} onChange={(e) => setForm((f) => ({ ...f, audioApiKeyQueryParam: e.target.value }))} /></LabeledField>
          </div>
          <LabeledField label={`Discogs Token ${meta.audioApiKeySet ? `(set: ${meta.audioApiKeyMasked})` : '(not set)'}`} cx={cx}>
            <input className="input font-mono" type="password" placeholder="Enter new key to update" value={form.audioApiKey} onChange={(e) => setForm((f) => ({ ...f, audioApiKey: e.target.value }))} />
          </LabeledField>
          <label className="flex items-center gap-2 text-sm text-dim cursor-pointer">
            <input type="checkbox" checked={form.clearAudioApiKey} onChange={(e) => setForm((f) => ({ ...f, clearAudioApiKey: e.target.checked }))} className="rounded" />
            Clear saved key
          </label>
        </>}

        {section === 'games' && <>
          <LabeledField label="Preset" cx={cx}><select className="select" value={form.gamesPreset} onChange={(e) => applyGamesPreset(e.target.value)}>
            <option value="igdb">IGDB</option><option value="custom">Custom</option>
          </select></LabeledField>
          <LabeledField label="Games API URL" cx={cx}><input className="input" value={form.gamesApiUrl} onChange={(e) => setForm((f) => ({ ...f, gamesApiUrl: e.target.value }))} /></LabeledField>
          <LabeledField label="Games Client ID (IGDB)" cx={cx}><input className="input" value={form.gamesClientId} onChange={(e) => setForm((f) => ({ ...f, gamesClientId: e.target.value }))} /></LabeledField>
          <LabeledField label={`Games Client Secret (IGDB) ${meta.gamesClientSecretSet ? `(set: ${meta.gamesClientSecretMasked})` : '(not set)'}`} cx={cx}>
            <input className="input font-mono" type="password" placeholder="Enter client secret to update" value={form.gamesClientSecret} onChange={(e) => setForm((f) => ({ ...f, gamesClientSecret: e.target.value }))} />
          </LabeledField>
          <div className="grid grid-cols-2 gap-3">
            <LabeledField label="Key Header" cx={cx}><input className="input" value={form.gamesApiKeyHeader} onChange={(e) => setForm((f) => ({ ...f, gamesApiKeyHeader: e.target.value }))} /></LabeledField>
            <LabeledField label="Key Query Param" cx={cx}><input className="input" value={form.gamesApiKeyQueryParam} onChange={(e) => setForm((f) => ({ ...f, gamesApiKeyQueryParam: e.target.value }))} /></LabeledField>
          </div>
          <LabeledField label={`Games API Key ${meta.gamesApiKeySet ? `(set: ${meta.gamesApiKeyMasked})` : '(not set)'}`} cx={cx}>
            <input className="input font-mono" type="password" placeholder="Enter new key to update" value={form.gamesApiKey} onChange={(e) => setForm((f) => ({ ...f, gamesApiKey: e.target.value }))} />
          </LabeledField>
          <label className="flex items-center gap-2 text-sm text-dim cursor-pointer">
            <input type="checkbox" checked={form.clearGamesApiKey} onChange={(e) => setForm((f) => ({ ...f, clearGamesApiKey: e.target.checked }))} className="rounded" />
            Clear saved key
          </label>
          <label className="flex items-center gap-2 text-sm text-dim cursor-pointer">
            <input type="checkbox" checked={form.clearGamesClientSecret} onChange={(e) => setForm((f) => ({ ...f, clearGamesClientSecret: e.target.checked }))} className="rounded" />
            Clear client secret
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
