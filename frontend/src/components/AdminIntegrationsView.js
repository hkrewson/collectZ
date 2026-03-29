import React, { useEffect, useMemo, useState } from 'react';

const BARCODE_PRESETS = {
  upcitemdb: { barcodePreset: 'upcitemdb', barcodeProvider: 'upcitemdb', barcodeApiUrl: 'https://api.upcitemdb.com/prod/trial/lookup' },
  barcodelookup: { barcodePreset: 'barcodelookup', barcodeProvider: 'barcodelookup', barcodeApiUrl: 'https://api.barcodelookup.com/v3/products' }
};
const COMICS_PRESETS = {
  metron: { comicsPreset: 'metron', comicsProvider: 'metron', comicsApiUrl: 'https://metron.cloud/api/issue/', comicsUsername: '' },
  gcd: { comicsPreset: 'gcd', comicsProvider: 'gcd', comicsApiUrl: 'https://www.comics.org/api/series/name/', comicsUsername: '' },
  comicvine: { comicsPreset: 'comicvine', comicsProvider: 'comicvine', comicsApiUrl: 'https://comicvine.gamespot.com/api/search/', comicsUsername: '' }
};
const INTEGRATION_FEATURE_LABELS = {
  metrics_enabled: 'Metrics Export',
  external_log_export_enabled: 'External Log Export'
};
const INTEGRATION_VISIBLE_FLAGS = new Set(Object.keys(INTEGRATION_FEATURE_LABELS));
const SETTINGS_SECTION_FEATURES = {
  metrics: 'metrics_enabled',
  logs: 'external_log_export_enabled'
};
const SECTION_DESCRIPTIONS = {
  audio: 'Connection details, credentials, and runtime checks for this integration.',
  barcode: 'Connection details, credentials, and runtime checks for this integration.',
  books: 'Connection details, credentials, and runtime checks for this integration.',
  comics: 'Connection details, credentials, and runtime checks for this integration.',
  cwa: 'Connection details, credentials, and runtime checks for this integration.',
  games: 'Connection details, credentials, and runtime checks for this integration.',
  logs: 'Enable external activity and audit export here, while backend transport details remain runtime infrastructure settings.',
  metrics: 'Enable admin-facing metrics export here, while scrape tokens and DEBUG-level access remain runtime infrastructure settings.',
  plex: 'Connection details, credentials, and runtime checks for this integration.',
  tmdb: 'Connection details, credentials, and runtime checks for this integration.',
  vision: 'Connection details, credentials, and runtime checks for this integration.'
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

function IntegrationFeatureToggle({ feature, disabled, saving, onToggle }) {
  const enabled = Boolean(feature?.enabled);
  return (
    <div className="flex items-start justify-between gap-4 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">
          {INTEGRATION_FEATURE_LABELS[feature.key] || feature.key}
        </p>
        <p className="mt-1 text-sm text-ghost">
          {feature.description || 'No description'}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={`${enabled ? 'Disable' : 'Enable'} ${INTEGRATION_FEATURE_LABELS[feature.key] || feature.key}`}
        disabled={disabled || saving}
        onClick={() => onToggle(feature, !enabled)}
        className={[
          'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-all duration-150',
          'focus:outline-none focus:ring-2 focus:ring-gold/30 focus:ring-offset-2 focus:ring-offset-surface',
          enabled ? 'border-gold/30 bg-gold/15' : 'border-edge bg-raised/80',
          (disabled || saving) ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-muted'
        ].join(' ')}
      >
        <span
          className={[
            'inline-block h-5 w-5 rounded-full transition-transform duration-150 shadow-sm',
            enabled ? 'bg-gold' : 'bg-dim',
            enabled ? 'translate-x-6' : 'translate-x-1'
          ].join(' ')}
        />
      </button>
    </div>
  );
}

function InlineFeatureFlagState({ loading, error, readOnly, feature }) {
  if (loading) {
    return <p className="text-sm text-dim">Loading integration setting…</p>;
  }
  if (error) {
    return <p className="text-sm text-err">{error}</p>;
  }
  if (!feature) {
    return <p className="text-sm text-warn">This integration setting is currently unavailable.</p>;
  }
  if (readOnly) {
    return <p className="text-sm text-warn">This setting is read-only in this environment (`FEATURE_FLAGS_READ_ONLY=true`).</p>;
  }
  return null;
}

export default function AdminIntegrationsView({ apiCall, onToast, onQueueJob, Spinner, cx, section: externalSection, onSectionChange }) {
  const integrationSections = useMemo(
    () => ([
      { id: 'audio', label: 'Audio' },
      { id: 'barcode', label: 'Barcode' },
      { id: 'books', label: 'Books' },
      { id: 'cwa', label: 'CWA OPDS' },
      { id: 'comics', label: 'Comics' },
      { id: 'games', label: 'Games' },
      { id: 'logs', label: 'External Logs' },
      { id: 'metrics', label: 'Metrics' },
      { id: 'plex', label: 'Plex' },
      { id: 'tmdb', label: 'TMDB' },
      { id: 'vision', label: 'Vision' }
    ]),
    []
  );
  const [section, setSection] = useState(externalSection || integrationSections[0].id);
  const [form, setForm] = useState({
    barcodePreset: 'upcitemdb', barcodeProvider: 'upcitemdb', barcodeApiUrl: '', barcodeApiKey: '', clearBarcodeApiKey: false,
    visionPreset: 'ocrspace', visionProvider: 'ocrspace', visionApiUrl: '', visionApiKey: '', clearVisionApiKey: false,
    tmdbPreset: 'tmdb', tmdbProvider: 'tmdb', tmdbApiUrl: 'https://api.themoviedb.org/3/search/movie',
    tmdbApiKey: '', clearTmdbApiKey: false,
    plexPreset: 'plex', plexProvider: 'plex', plexApiUrl: '',
    plexApiKey: '', plexLibrarySections: '', clearPlexApiKey: false,
    booksPreset: 'googlebooks', booksProvider: 'googlebooks', booksApiUrl: 'https://www.googleapis.com/books/v1/volumes',
    booksApiKey: '', clearBooksApiKey: false,
    audioPreset: 'discogs', audioProvider: 'discogs', audioApiUrl: 'https://api.discogs.com/database/search',
    audioApiKey: '', clearAudioApiKey: false,
    gamesPreset: 'igdb', gamesProvider: 'igdb', gamesApiUrl: 'https://api.igdb.com/v4/games',
    gamesApiKey: '', gamesClientId: '', gamesClientSecret: '', clearGamesApiKey: false, clearGamesClientSecret: false,
    comicsPreset: 'metron', comicsProvider: 'metron', comicsApiUrl: 'https://metron.cloud/api/issue/',
    comicsApiKey: '', comicsUsername: '', clearComicsApiKey: false,
    cwaOpdsUrl: '', cwaUsername: '', cwaPassword: '', clearCwaPassword: false
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
    comicsApiKeySet: false, comicsApiKeyMasked: '',
    cwaPasswordSet: false, cwaPasswordMasked: '',
    decryptHealth: { hasWarnings: false, warnings: [], remediation: '' }
  });
  const [status, setStatus] = useState({ barcode: 'unknown', vision: 'unknown', tmdb: 'unknown', plex: 'unknown', books: 'unknown', audio: 'unknown', games: 'unknown', comics: 'unknown', cwa: 'unknown' });
  const [testLoading, setTestLoading] = useState('');
  const [testMsg, setTestMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [importingPlex, setImportingPlex] = useState(false);
  const [plexAvailableSections, setPlexAvailableSections] = useState([]);
  const [featureFlags, setFeatureFlags] = useState([]);
  const [featureFlagsLoading, setFeatureFlagsLoading] = useState(true);
  const [featureFlagsReadOnly, setFeatureFlagsReadOnly] = useState(false);
  const [featureFlagsError, setFeatureFlagsError] = useState('');
  const [savingFeatureKey, setSavingFeatureKey] = useState('');

  useEffect(() => {
    if (!externalSection || externalSection === section) return;
    const known = integrationSections.some((item) => item.id === externalSection);
    if (known) setSection(externalSection);
  }, [externalSection, integrationSections, section]);

  const setSectionWithSync = (nextSection) => {
    setSection(nextSection);
    if (typeof onSectionChange === 'function') onSectionChange(nextSection);
  };

  useEffect(() => {
    apiCall('get', '/admin/settings/integrations').then((data) => {
      setForm((f) => ({
        ...f,
        barcodePreset: data.barcodePreset || 'upcitemdb', barcodeProvider: data.barcodeProvider || '', barcodeApiUrl: data.barcodeApiUrl || '',
        visionPreset: data.visionPreset || 'ocrspace', visionProvider: data.visionProvider || '', visionApiUrl: data.visionApiUrl || '',
        tmdbPreset: data.tmdbPreset || 'tmdb', tmdbProvider: data.tmdbProvider || '', tmdbApiUrl: data.tmdbApiUrl || '',
        plexPreset: data.plexPreset || 'plex', plexProvider: data.plexProvider || 'plex', plexApiUrl: data.plexApiUrl || '',
        plexLibrarySections: Array.isArray(data.plexLibrarySections) ? data.plexLibrarySections.join(',') : '',
        booksPreset: data.booksPreset || 'googlebooks', booksProvider: data.booksProvider || 'googlebooks', booksApiUrl: data.booksApiUrl || 'https://www.googleapis.com/books/v1/volumes',
        audioPreset: data.audioPreset || 'discogs', audioProvider: data.audioProvider || 'discogs', audioApiUrl: data.audioApiUrl || 'https://api.discogs.com/database/search',
        gamesPreset: data.gamesPreset || 'igdb', gamesProvider: data.gamesProvider || 'igdb', gamesApiUrl: data.gamesApiUrl || 'https://api.igdb.com/v4/games', gamesClientId: data.gamesClientId || '',
        comicsPreset: data.comicsPreset || 'metron', comicsProvider: data.comicsProvider || 'metron', comicsApiUrl: data.comicsApiUrl || 'https://metron.cloud/api/issue/', comicsUsername: data.comicsUsername || '',
        cwaOpdsUrl: data.cwaOpdsUrl || '', cwaUsername: data.cwaUsername || ''
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
        comicsApiKeySet: Boolean(data.comicsApiKeySet), comicsApiKeyMasked: data.comicsApiKeyMasked || '',
        cwaPasswordSet: Boolean(data.cwaPasswordSet), cwaPasswordMasked: data.cwaPasswordMasked || '',
        decryptHealth: data.decryptHealth || { hasWarnings: false, warnings: [], remediation: '' }
      });
      setStatus({
        barcode: data.barcodeApiKeySet ? 'configured' : 'missing',
        vision: data.visionApiKeySet ? 'configured' : 'missing',
        tmdb: data.tmdbApiKeySet ? 'configured' : 'missing',
        plex: data.plexApiKeySet ? 'configured' : 'missing',
        books: data.booksApiKeySet ? 'configured' : 'missing',
        audio: data.audioApiKeySet ? 'configured' : 'missing',
        games: (data.gamesApiKeySet || (data.gamesClientId && data.gamesClientSecretSet)) ? 'configured' : 'missing',
        comics: data.comicsApiKeySet ? 'configured' : 'missing',
        cwa: data.cwaOpdsUrl ? 'configured' : 'missing'
      });
    }).catch(() => {});
  }, [apiCall]);

  useEffect(() => {
    let active = true;
    setFeatureFlagsLoading(true);
    setFeatureFlagsError('');
    apiCall('get', '/admin/feature-flags').then((payload) => {
      if (!active) return;
      setFeatureFlags(
        Array.isArray(payload?.flags)
          ? payload.flags.filter((flag) => INTEGRATION_VISIBLE_FLAGS.has(flag?.key))
          : []
      );
      setFeatureFlagsReadOnly(Boolean(payload?.readOnly));
    }).catch((error) => {
      if (!active) return;
      setFeatureFlagsError(error?.response?.data?.error || 'Failed to load integration feature settings');
    }).finally(() => {
      if (active) setFeatureFlagsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [apiCall]);

  const applyBarcodePreset = (p) => setForm((f) => ({ ...f, ...(BARCODE_PRESETS[p] || {}) }));
  const applyComicsPreset = (p) => setForm((f) => ({ ...f, ...(COMICS_PRESETS[p] || {}) }));
  const plexSectionIds = useMemo(
    () => form.plexLibrarySections.split(',').map((v) => v.trim()).filter(Boolean),
    [form.plexLibrarySections]
  );
  const featureFlagMap = useMemo(
    () => new Map(featureFlags.map((feature) => [feature.key, feature])),
    [featureFlags]
  );
  const getSectionStatus = (sectionId) => {
    const featureKey = SETTINGS_SECTION_FEATURES[sectionId];
    if (featureKey) {
      return featureFlagMap.get(featureKey)?.enabled ? 'configured' : 'missing';
    }
    return status[sectionId];
  };

  const togglePlexSection = (id) => {
    const next = new Set(plexSectionIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setForm((f) => ({ ...f, plexLibrarySections: [...next].join(',') }));
  };

  const toggleIntegrationFeature = async (feature, enabled) => {
    if (!feature?.key) return;
    setSavingFeatureKey(feature.key);
    try {
      const updated = await apiCall('patch', `/admin/feature-flags/${encodeURIComponent(feature.key)}`, { enabled });
      setFeatureFlags((prev) => prev.map((row) => (row.key === updated.key ? updated : row)));
      onToast(`${INTEGRATION_FEATURE_LABELS[feature.key] || feature.key} ${enabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
      onToast(error?.response?.data?.error || 'Failed to update integration feature', 'error');
    } finally {
      setSavingFeatureKey('');
    }
  };

  const saveSection = async (sec) => {
    setSaving(true);
    const payload = {};
    if (sec === 'barcode') Object.assign(payload, { barcodePreset: form.barcodePreset, barcodeProvider: form.barcodeProvider, barcodeApiUrl: form.barcodeApiUrl, clearBarcodeApiKey: form.clearBarcodeApiKey, ...(form.barcodeApiKey && { barcodeApiKey: form.barcodeApiKey }) });
    else if (sec === 'vision') Object.assign(payload, { visionPreset: form.visionPreset, visionProvider: form.visionProvider, visionApiUrl: form.visionApiUrl, clearVisionApiKey: form.clearVisionApiKey, ...(form.visionApiKey && { visionApiKey: form.visionApiKey }) });
    else if (sec === 'tmdb') Object.assign(payload, { tmdbPreset: form.tmdbPreset, tmdbProvider: form.tmdbProvider, tmdbApiUrl: form.tmdbApiUrl, clearTmdbApiKey: form.clearTmdbApiKey, ...(form.tmdbApiKey && { tmdbApiKey: form.tmdbApiKey }) });
    else if (sec === 'plex') Object.assign(payload, {
      plexPreset: form.plexPreset, plexProvider: form.plexProvider, plexApiUrl: form.plexApiUrl,
      clearPlexApiKey: form.clearPlexApiKey,
      plexLibrarySections: form.plexLibrarySections.split(',').map((v) => v.trim()).filter(Boolean),
      ...(form.plexApiKey && { plexApiKey: form.plexApiKey })
    });
    else if (sec === 'books') Object.assign(payload, {
      booksPreset: form.booksPreset, booksProvider: form.booksProvider, booksApiUrl: form.booksApiUrl,
      clearBooksApiKey: form.clearBooksApiKey, ...(form.booksApiKey && { booksApiKey: form.booksApiKey })
    });
    else if (sec === 'audio') Object.assign(payload, {
      audioPreset: form.audioPreset, audioProvider: form.audioProvider, audioApiUrl: form.audioApiUrl,
      clearAudioApiKey: form.clearAudioApiKey, ...(form.audioApiKey && { audioApiKey: form.audioApiKey })
    });
    else if (sec === 'games') Object.assign(payload, {
      gamesPreset: form.gamesPreset, gamesProvider: form.gamesProvider, gamesApiUrl: form.gamesApiUrl,
      gamesClientId: form.gamesClientId, clearGamesApiKey: form.clearGamesApiKey, clearGamesClientSecret: form.clearGamesClientSecret,
      ...(form.gamesApiKey && { gamesApiKey: form.gamesApiKey }),
      ...(form.gamesClientSecret && { gamesClientSecret: form.gamesClientSecret })
    });
    else if (sec === 'comics') Object.assign(payload, {
      comicsPreset: form.comicsPreset, comicsProvider: form.comicsProvider, comicsApiUrl: form.comicsApiUrl,
      comicsUsername: form.comicsUsername, clearComicsApiKey: form.clearComicsApiKey,
      ...(form.comicsApiKey && { comicsApiKey: form.comicsApiKey })
    });
    else if (sec === 'cwa') Object.assign(payload, {
      cwaOpdsUrl: form.cwaOpdsUrl,
      cwaUsername: form.cwaUsername,
      clearCwaPassword: form.clearCwaPassword,
      ...(form.cwaPassword && { cwaPassword: form.cwaPassword })
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
        comicsApiKeySet: Boolean(updated.comicsApiKeySet), comicsApiKeyMasked: updated.comicsApiKeyMasked || '',
        cwaPasswordSet: Boolean(updated.cwaPasswordSet), cwaPasswordMasked: updated.cwaPasswordMasked || '',
        decryptHealth: updated.decryptHealth || { hasWarnings: false, warnings: [], remediation: '' }
      });
      setStatus((s) => ({
        ...s,
        [sec]: sec === 'games'
          ? ((updated.gamesApiKeySet || (updated.gamesClientId && updated.gamesClientSecretSet)) ? 'configured' : 'missing')
          : sec === 'cwa'
            ? (updated.cwaOpdsUrl ? 'configured' : 'missing')
          : (updated[`${sec}ApiKeySet`] ? 'configured' : 'missing')
      }));
      setForm((f) => ({
        ...f,
        barcodeApiKey: '', visionApiKey: '', tmdbApiKey: '', plexApiKey: '', booksApiKey: '', audioApiKey: '', gamesApiKey: '', gamesClientSecret: '', comicsApiKey: '', cwaPassword: '',
        clearBarcodeApiKey: false, clearVisionApiKey: false, clearTmdbApiKey: false, clearPlexApiKey: false,
        clearBooksApiKey: false, clearAudioApiKey: false, clearGamesApiKey: false, clearGamesClientSecret: false, clearComicsApiKey: false, clearCwaPassword: false
      }));
      onToast(`${sec.toUpperCase()} settings saved`);
      if (
        sec === 'comics'
        && String(updated.comicsProvider || form.comicsProvider || '').toLowerCase() === 'metron'
        && Boolean(updated.comicsApiKeySet)
      ) {
        try {
          const enqueue = await apiCall('post', '/media/import-comics?async=true', {});
          const jobId = enqueue?.job?.id;
          if (jobId) {
            onQueueJob?.({
              id: jobId,
              provider: 'metron',
              status: enqueue?.job?.status || 'queued',
              progress: enqueue?.job?.progress || null
            });
            setTestMsg(`METRON import queued (job #${jobId})`);
            onToast('Metron collection import started');
          }
        } catch (importErr) {
          onToast(importErr.response?.data?.error || 'Metron import could not be started', 'error');
        }
      }
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
              : sec === 'comics'
                ? { title: 'Batman' }
                : sec === 'cwa'
                  ? {}
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

  const isConfigured = (id) => {
    const currentStatus = getSectionStatus(id);
    return currentStatus === 'configured' || currentStatus === 'ok';
  };
  const activeSectionLabel = integrationSections.find((s) => s.id === section)?.label || section;
  const activeSectionDescription = SECTION_DESCRIPTIONS[section] || SECTION_DESCRIPTIONS.audio;
  const activeSectionStatus = getSectionStatus(section);
  const sectionFeature = SETTINGS_SECTION_FEATURES[section] ? featureFlagMap.get(SETTINGS_SECTION_FEATURES[section]) : null;

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 space-y-6">
      <h1 className="section-title">Integrations</h1>

      <div className="md:hidden">
        <label className="label">Integration</label>
        <select className="select mt-1" value={section} onChange={(e) => setSectionWithSync(e.target.value)}>
          {integrationSections.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label} {isConfigured(item.id) ? '✓' : ''}
            </option>
          ))}
        </select>
      </div>

      {meta.decryptHealth?.hasWarnings && (
        <div className="rounded-xl border border-edge bg-raised/70 px-4 py-4">
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

      <div className="space-y-4">
        <div className="hidden md:flex flex-wrap gap-2">
          {integrationSections.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSectionWithSync(item.id)}
              className={cx(
                'btn-secondary btn-sm text-left transition-colors',
                section === item.id
                  ? 'bg-raised border-muted text-ink'
                  : 'text-dim'
              )}
            >
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        <div className="space-y-4 min-w-0">
        <div className="flex items-center justify-between gap-3 pb-1">
          <div>
            <h2 className="text-sm font-semibold tracking-wide uppercase text-dim">{activeSectionLabel}</h2>
            <p className="mt-1 text-xs text-ghost">{activeSectionDescription}</p>
          </div>
          <StatusBadge status={activeSectionStatus} cx={cx} />
        </div>
        {section === 'barcode' && <>
          <LabeledField label="Preset" cx={cx}><select className="select" value={form.barcodePreset} onChange={(e) => applyBarcodePreset(e.target.value)}>
            <option value="upcitemdb">UPCItemDB</option><option value="barcodelookup">BarcodeLookup</option>
          </select></LabeledField>
          <LabeledField label="API URL" cx={cx}><input className="input" value={form.barcodeApiUrl} onChange={(e) => setForm((f) => ({ ...f, barcodeApiUrl: e.target.value }))} /></LabeledField>
          <LabeledField label={`API Key ${meta.barcodeApiKeySet ? `(set: ${meta.barcodeApiKeyMasked})` : '(not set)'}`} cx={cx}>
            <input className="input font-mono" type="password" placeholder="Enter new key to update" value={form.barcodeApiKey} onChange={(e) => setForm((f) => ({ ...f, barcodeApiKey: e.target.value }))} />
          </LabeledField>
          <label className="flex items-center gap-2 text-sm text-dim cursor-pointer">
            <input type="checkbox" checked={form.clearBarcodeApiKey} onChange={(e) => setForm((f) => ({ ...f, clearBarcodeApiKey: e.target.checked }))} className="rounded" />
            Clear saved key
          </label>
        </>}

        {section === 'vision' && <>
          <LabeledField label="API URL" cx={cx}><input className="input" value={form.visionApiUrl} onChange={(e) => setForm((f) => ({ ...f, visionApiUrl: e.target.value }))} /></LabeledField>
          <LabeledField label={`API Key ${meta.visionApiKeySet ? `(set: ${meta.visionApiKeyMasked})` : '(not set)'}`} cx={cx}>
            <input className="input font-mono" type="password" placeholder="Enter new key to update" value={form.visionApiKey} onChange={(e) => setForm((f) => ({ ...f, visionApiKey: e.target.value }))} />
          </LabeledField>
          <label className="flex items-center gap-2 text-sm text-dim cursor-pointer">
            <input type="checkbox" checked={form.clearVisionApiKey} onChange={(e) => setForm((f) => ({ ...f, clearVisionApiKey: e.target.checked }))} className="rounded" />
            Clear saved key
          </label>
        </>}

        {section === 'logs' && <>
          <InlineFeatureFlagState
            loading={featureFlagsLoading}
            error={featureFlagsError}
            readOnly={featureFlagsReadOnly}
            feature={sectionFeature}
          />
          {sectionFeature && (
            <IntegrationFeatureToggle
              feature={sectionFeature}
              disabled={featureFlagsReadOnly}
              saving={savingFeatureKey === sectionFeature.key}
              onToggle={toggleIntegrationFeature}
            />
          )}
          <div className="border-t border-edge pt-4 space-y-2">
            <p className="text-sm font-medium text-ink">Available settings</p>
            <ul className="space-y-2 text-sm text-dim">
              <li>Enable or disable external structured log export for activity and audit events here.</li>
              <li>Transport details still come from runtime infrastructure configuration: `LOG_EXPORT_BACKEND`, `LOG_EXPORT_HOST`, `LOG_EXPORT_PORT`, and related `LOG_EXPORT_*` variables.</li>
              <li>This page now owns whether export is active. Environment feature-flag overrides no longer supersede this setting.</li>
            </ul>
          </div>
        </>}

        {section === 'metrics' && <>
          <InlineFeatureFlagState
            loading={featureFlagsLoading}
            error={featureFlagsError}
            readOnly={featureFlagsReadOnly}
            feature={sectionFeature}
          />
          {sectionFeature && (
            <IntegrationFeatureToggle
              feature={sectionFeature}
              disabled={featureFlagsReadOnly}
              saving={savingFeatureKey === sectionFeature.key}
              onToggle={toggleIntegrationFeature}
            />
          )}
          <div className="border-t border-edge pt-4 space-y-2">
            <p className="text-sm font-medium text-ink">Available settings</p>
            <ul className="space-y-2 text-sm text-dim">
              <li>Enable or disable admin-facing Prometheus-style metrics export here.</li>
              <li>Metrics still require `DEBUG&gt;=1` at runtime, and `METRICS_SCRAPE_TOKEN` remains the optional infrastructure credential for trusted scrapers.</li>
              <li>This page now owns whether metrics export is active. Environment feature-flag overrides no longer supersede this setting.</li>
            </ul>
          </div>
        </>}

        {section === 'tmdb' && <>
          <LabeledField label="API URL" cx={cx}><input className="input" value={form.tmdbApiUrl} onChange={(e) => setForm((f) => ({ ...f, tmdbApiUrl: e.target.value }))} /></LabeledField>
          <LabeledField label={`API Key ${meta.tmdbApiKeySet ? `(set: ${meta.tmdbApiKeyMasked})` : '(not set)'}`} cx={cx}>
            <input className="input font-mono" type="password" placeholder="Enter new key to update" value={form.tmdbApiKey} onChange={(e) => setForm((f) => ({ ...f, tmdbApiKey: e.target.value }))} />
          </LabeledField>
          <label className="flex items-center gap-2 text-sm text-dim cursor-pointer">
            <input type="checkbox" checked={form.clearTmdbApiKey} onChange={(e) => setForm((f) => ({ ...f, clearTmdbApiKey: e.target.checked }))} className="rounded" />
            Clear saved key
          </label>
        </>}

        {section === 'plex' && <>
          <div className="grid gap-3 md:grid-cols-2">
            <LabeledField label="Plex API URL" cx={cx}>
              <input className="input" placeholder="https://plex-host:32400" value={form.plexApiUrl} onChange={(e) => setForm((f) => ({ ...f, plexApiUrl: e.target.value }))} />
            </LabeledField>
            <LabeledField label="Library Section IDs" cx={cx}>
              <input className="input font-mono" placeholder="1,2,5" value={form.plexLibrarySections} onChange={(e) => setForm((f) => ({ ...f, plexLibrarySections: e.target.value }))} />
            </LabeledField>
          </div>
          <div className="text-xs text-ghost">
            Import will use section IDs: <span className="font-mono text-dim">{plexSectionIds.length ? plexSectionIds.join(',') : '(none selected)'}</span>
          </div>
          {plexAvailableSections.length > 0 && (
            <div className="rounded-xl border border-edge bg-raised/60 px-3 py-3 space-y-2">
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
          <LabeledField label="Books API URL" cx={cx}><input className="input" value={form.booksApiUrl} onChange={(e) => setForm((f) => ({ ...f, booksApiUrl: e.target.value }))} /></LabeledField>
          <LabeledField label={`Books API Key ${meta.booksApiKeySet ? `(set: ${meta.booksApiKeyMasked})` : '(not set)'}`} cx={cx}>
            <input className="input font-mono" type="password" placeholder="Enter new key to update" value={form.booksApiKey} onChange={(e) => setForm((f) => ({ ...f, booksApiKey: e.target.value }))} />
          </LabeledField>
          <label className="flex items-center gap-2 text-sm text-dim cursor-pointer">
            <input type="checkbox" checked={form.clearBooksApiKey} onChange={(e) => setForm((f) => ({ ...f, clearBooksApiKey: e.target.checked }))} className="rounded" />
            Clear saved key
          </label>
        </>}

        {section === 'audio' && <>
          <LabeledField label="Audio API URL" cx={cx}><input className="input" value={form.audioApiUrl} onChange={(e) => setForm((f) => ({ ...f, audioApiUrl: e.target.value }))} /></LabeledField>
          <LabeledField label={`Discogs Token ${meta.audioApiKeySet ? `(set: ${meta.audioApiKeyMasked})` : '(not set)'}`} cx={cx}>
            <input className="input font-mono" type="password" placeholder="Enter new key to update" value={form.audioApiKey} onChange={(e) => setForm((f) => ({ ...f, audioApiKey: e.target.value }))} />
          </LabeledField>
          <label className="flex items-center gap-2 text-sm text-dim cursor-pointer">
            <input type="checkbox" checked={form.clearAudioApiKey} onChange={(e) => setForm((f) => ({ ...f, clearAudioApiKey: e.target.checked }))} className="rounded" />
            Clear saved key
          </label>
        </>}

        {section === 'games' && <>
          <LabeledField label="Games API URL" cx={cx}><input className="input" value={form.gamesApiUrl} onChange={(e) => setForm((f) => ({ ...f, gamesApiUrl: e.target.value }))} /></LabeledField>
          <LabeledField label="Games Client ID (IGDB)" cx={cx}><input className="input" value={form.gamesClientId} onChange={(e) => setForm((f) => ({ ...f, gamesClientId: e.target.value }))} /></LabeledField>
          <div className="grid gap-3 md:grid-cols-2">
            <LabeledField label={`Games Client Secret (IGDB) ${meta.gamesClientSecretSet ? `(set: ${meta.gamesClientSecretMasked})` : '(not set)'}`} cx={cx}>
              <input className="input font-mono" type="password" placeholder="Enter client secret to update" value={form.gamesClientSecret} onChange={(e) => setForm((f) => ({ ...f, gamesClientSecret: e.target.value }))} />
            </LabeledField>
            <LabeledField label={`Games API Key ${meta.gamesApiKeySet ? `(set: ${meta.gamesApiKeyMasked})` : '(not set)'}`} cx={cx}>
              <input className="input font-mono" type="password" placeholder="Enter new key to update" value={form.gamesApiKey} onChange={(e) => setForm((f) => ({ ...f, gamesApiKey: e.target.value }))} />
            </LabeledField>
          </div>
        </>}

        {section === 'comics' && <>
          <LabeledField label="Preset" cx={cx}><select className="select" value={form.comicsPreset} onChange={(e) => applyComicsPreset(e.target.value)}>
            <option value="metron">Metron (Basic Auth)</option><option value="gcd">GCD</option><option value="comicvine">ComicVine</option>
          </select></LabeledField>
          <LabeledField label={form.comicsPreset === 'metron' ? 'Metron API URL' : 'Comics API URL'} cx={cx}>
            <input className="input" value={form.comicsApiUrl} onChange={(e) => setForm((f) => ({ ...f, comicsApiUrl: e.target.value }))} />
          </LabeledField>
          {form.comicsPreset === 'metron' ? (
            <div className="grid grid-cols-2 gap-3">
              <LabeledField label="Metron Username" cx={cx}>
                <input className="input" value={form.comicsUsername} onChange={(e) => setForm((f) => ({ ...f, comicsUsername: e.target.value }))} />
              </LabeledField>
              <LabeledField label={`Metron Password ${meta.comicsApiKeySet ? `(set: ${meta.comicsApiKeyMasked})` : '(not set)'}`} cx={cx}>
                <input className="input font-mono" type="password" placeholder="Enter Metron password" value={form.comicsApiKey} onChange={(e) => setForm((f) => ({ ...f, comicsApiKey: e.target.value }))} />
              </LabeledField>
            </div>
          ) : (
            <>
              <LabeledField label="Username (optional)" cx={cx}>
                <input className="input" value={form.comicsUsername} onChange={(e) => setForm((f) => ({ ...f, comicsUsername: e.target.value }))} />
              </LabeledField>
              <LabeledField label={`Comics API Key ${meta.comicsApiKeySet ? `(set: ${meta.comicsApiKeyMasked})` : '(not set)'}`} cx={cx}>
                <input className="input font-mono" type="password" placeholder="Enter new key to update" value={form.comicsApiKey} onChange={(e) => setForm((f) => ({ ...f, comicsApiKey: e.target.value }))} />
              </LabeledField>
            </>
          )}
          <label className="flex items-center gap-2 text-sm text-dim cursor-pointer">
            <input type="checkbox" checked={form.clearComicsApiKey} onChange={(e) => setForm((f) => ({ ...f, clearComicsApiKey: e.target.checked }))} className="rounded" />
            {form.comicsPreset === 'metron' ? 'Clear saved password' : 'Clear saved key'}
          </label>
        </>}

        {section === 'cwa' && <>
          <LabeledField label="OPDS Feed URL" cx={cx}>
            <input className="input" placeholder="https://cwa-host/opds/books" value={form.cwaOpdsUrl} onChange={(e) => setForm((f) => ({ ...f, cwaOpdsUrl: e.target.value }))} />
          </LabeledField>
          <p className="text-xs text-ghost">
            Deep links use the OPDS feed host automatically, so there is no separate base URL to maintain here.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <LabeledField label="Username" cx={cx}>
              <input className="input" value={form.cwaUsername} onChange={(e) => setForm((f) => ({ ...f, cwaUsername: e.target.value }))} />
            </LabeledField>
            <LabeledField label={`Password ${meta.cwaPasswordSet ? `(set: ${meta.cwaPasswordMasked})` : '(not set)'}`} cx={cx}>
              <input className="input font-mono" type="password" placeholder="Enter password to update" value={form.cwaPassword} onChange={(e) => setForm((f) => ({ ...f, cwaPassword: e.target.value }))} />
            </LabeledField>
          </div>
          <label className="flex items-center gap-2 text-sm text-dim cursor-pointer">
            <input type="checkbox" checked={form.clearCwaPassword} onChange={(e) => setForm((f) => ({ ...f, clearCwaPassword: e.target.checked }))} className="rounded" />
            Clear saved password
          </label>
        </>}

        {!['logs', 'metrics'].includes(section) && (
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
        )}
        {testMsg && <p className="text-xs text-dim font-mono bg-raised/70 rounded-lg px-3 py-2">{testMsg}</p>}
      </div>
      </div>
    </div>
  );
}
