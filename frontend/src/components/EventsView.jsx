import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CameraCaptureModal, CollectionPaginationFooter, Icons, Spinner, SectionTabPanel, SectionTabs, cx, posterUrl, ObjectPosterCard } from './app/AppPrimitives';

const DEFAULT_EVENT_FORM = {
  title: '',
  url: '',
  location: '',
  date_start: '',
  date_end: '',
  host: '',
  time_label: '',
  room: '',
  notes: ''
};

const DEFAULT_ARTIFACT_FORM = {
  artifact_type: 'note',
  title: '',
  description: '',
  vendor: '',
  price: '',
  image_path: '',
  signer_name: '',
  signer_role: '',
  signed_on: '',
  signed_at: '',
  signature_proof_path: '',
  signature_notes: ''
};

const toInputDate = (value) => {
  if (!value) return '';
  const text = String(value).trim();
  if (!text) return '';
  const isoDateMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDateMatch) return isoDateMatch[1];
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
};

const toDisplayDate = (value) => {
  const normalized = toInputDate(value);
  if (!normalized) return '';
  const [year, month, day] = normalized.split('-');
  return `${month}/${day}/${year}`;
};

const formatUploadError = (message) => {
  const raw = String(message || '');
  if (raw.includes('status code 413')) {
    return 'Image upload failed: file too large (max 10MB)';
  }
  return raw || 'Image upload failed';
};

const pluralizeArtifacts = (count) => `${count || 0} artifact${Number(count || 0) === 1 ? '' : 's'}`;

function MetaPill({ children, tone = 'default' }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium tracking-wide',
        tone === 'brand'
          ? 'border-brand/30 bg-brand/10 text-brand'
          : 'border-edge bg-surface text-dim'
      )}
    >
      {children}
    </span>
  );
}

function DetailField({ label, children, className = '' }) {
  if (!children) return null;
  return (
    <div className={className}>
      <p className="label">{label}</p>
      <div className="mt-1 text-sm text-ink">{children}</div>
    </div>
  );
}

function EventCard({ item, supportsHover, onOpen, onEdit, onDelete }) {
  return (
    <ObjectPosterCard
      title={item.title}
      imagePath={item.image_path}
      fallbackIcon={<Icons.Activity />}
      supportsHover={supportsHover}
      onOpen={() => onOpen(item)}
      leftBadges={[`#${item.id}`, toDisplayDate(item.date_start) || 'Date pending']}
      rightBadge={item.host ? <span className="badge badge-brand text-[10px] backdrop-blur-sm bg-brand/20 border-brand/30">{item.host}</span> : null}
      subtitle={item.location || 'Location not set'}
      meta={
        <>
          <MetaPill>{pluralizeArtifacts(item.artifact_count)}</MetaPill>
          {item.room ? <MetaPill>{`Room ${item.room}`}</MetaPill> : null}
        </>
      }
      onEdit={() => onEdit(item)}
      onDelete={() => onDelete(item.id)}
    />
  );
}

function EventListRow({ item, supportsHover, onOpen, onEdit, onDelete }) {
  return (
    <article className="group flex items-center gap-4 rounded-xl border border-edge bg-surface p-3 hover:border-muted hover:bg-raised cursor-pointer transition-all duration-150 animate-fade-in" onClick={() => onOpen(item)}>
      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-edge bg-raised text-ghost"><Icons.Activity /></div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ink truncate">{item.title}</p>
        <div className="mt-1 flex flex-wrap gap-2">
          <MetaPill>{toDisplayDate(item.date_start) || 'Date pending'}</MetaPill>
          {item.location ? <MetaPill>{item.location}</MetaPill> : null}
          <MetaPill>{pluralizeArtifacts(item.artifact_count)}</MetaPill>
        </div>
      </div>
      <span className="text-xs text-ghost font-mono">#{item.id}</span>
      <div className={cx('flex gap-2 transition-opacity duration-150', supportsHover ? 'opacity-0 group-hover:opacity-100' : 'opacity-100')}>
        <button className="btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); onEdit(item); }}><Icons.Edit />Edit</button>
        <button className="btn-ghost btn-sm text-err hover:bg-err/10" onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}><Icons.Trash /></button>
      </div>
    </article>
  );
}

function formatSignatureLine(signature) {
  const parts = [];
  if (signature?.signer_name) parts.push(signature.signer_name);
  if (signature?.signer_role) parts.push(signature.signer_role);
  if (signature?.signed_on) parts.push(toDisplayDate(signature.signed_on));
  if (signature?.signed_at) parts.push(signature.signed_at);
  return parts.filter(Boolean).join(' · ');
}

function EventAutographSignatureLinker({ eventId, artifact, apiCall, onLinked }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [targetType, setTargetType] = useState('art');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [linkingId, setLinkingId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const eventSignature = artifact?.event_artifact_signature || artifact?.signature || null;
  const linkedSignature = artifact?.linked_signature || null;

  const getCandidateId = (candidate) => Number(targetType === 'art' ? (candidate.native_art_id || candidate.id) : candidate.id);

  const formatCandidateMeta = (candidate) => {
    const parts = [targetType === 'art' ? 'Art' : 'Media'];
    if (targetType === 'art') {
      if (candidate.franchise) parts.push(candidate.franchise);
      if (candidate.medium) parts.push(String(candidate.medium).replaceAll('_', ' '));
      if (candidate.artist) parts.push(candidate.artist);
      if (candidate.series) parts.push(candidate.series);
    } else {
      if (candidate.media_type) parts.push(String(candidate.media_type).replaceAll('_', ' '));
      if (candidate.year) parts.push(candidate.year);
      if (candidate.format) parts.push(candidate.format);
    }
    return parts.filter(Boolean).join(' · ');
  };

  const searchTargets = async () => {
    setSearching(true);
    setError('');
    setNotice('');
    try {
      const params = new URLSearchParams();
      params.set('limit', '8');
      if (targetType === 'art') {
        params.set('sort_dir', 'asc');
        if (searchTerm.trim()) params.set('q', searchTerm.trim());
      } else {
        params.set('sortDir', 'asc');
        if (searchTerm.trim()) params.set('search', searchTerm.trim());
      }
      const path = targetType === 'art' ? '/art' : '/media';
      const payload = await apiCall('get', `${path}?${params.toString()}`);
      setSearchResults(Array.isArray(payload?.items) ? payload.items : []);
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to search signature targets');
    } finally {
      setSearching(false);
    }
  };

  const linkTarget = async (candidate) => {
    const ownerId = getCandidateId(candidate);
    if (!ownerId || linkingId) return;
    setLinkingId(ownerId);
    setError('');
    setNotice('');
    try {
      await apiCall('post', `/events/${eventId}/artifacts/${artifact.id}/link-signature`, {
        owner_type: targetType,
        owner_id: ownerId
      });
      setNotice(`${candidate.title || 'Object'} linked as a signature`);
      setLinkOpen(false);
      setSearchResults([]);
      setSearchTerm('');
      await onLinked?.();
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to link object signature');
    } finally {
      setLinkingId(null);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-edge bg-raised p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-ink">Event autograph</p>
          <p className="mt-1 text-xs text-dim">{formatSignatureLine(eventSignature) || artifact.title}</p>
          {eventSignature?.proof_path ? (
            <a className="mt-2 inline-flex items-center gap-1 text-xs text-dim hover:text-ink" href={eventSignature.proof_path} target="_blank" rel="noreferrer">
              <Icons.Link />Proof image
            </a>
          ) : null}
        </div>
        {linkedSignature ? (
          <span className="badge badge-brand text-[10px]">Linked</span>
        ) : (
          <button className="btn-secondary btn-sm" onClick={() => setLinkOpen((open) => !open)}>
            <Icons.Link />Link signature
          </button>
        )}
      </div>
      {linkedSignature ? (
        <div className="mt-3 border-t border-edge/60 pt-3">
          <p className="text-xs font-medium text-ink">Object signature</p>
          <p className="mt-1 text-xs text-dim">
            {`Linked to ${linkedSignature.owner_type === 'art' ? 'Art' : 'Media'} #${linkedSignature.owner_id}`}
            {formatSignatureLine(linkedSignature) ? ` · ${formatSignatureLine(linkedSignature)}` : ''}
          </p>
          {linkedSignature.proof_path ? (
            <a className="mt-2 inline-flex items-center gap-1 text-xs text-dim hover:text-ink" href={linkedSignature.proof_path} target="_blank" rel="noreferrer">
              <Icons.Link />Object proof
            </a>
          ) : null}
        </div>
      ) : null}
      {error ? <p className="mt-3 text-xs text-err">{error}</p> : null}
      {notice ? <p className="mt-3 text-xs text-ok">{notice}</p> : null}
      {linkOpen ? (
        <div className="mt-3 border-t border-edge/60 pt-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[8rem_1fr_auto]">
            <label className="field">
              <span className="label">Target</span>
              <select
                className="select"
                value={targetType}
                onChange={(event) => {
                  setTargetType(event.target.value);
                  setSearchResults([]);
                }}
              >
                <option value="art">Art</option>
                <option value="media">Media</option>
              </select>
            </label>
            <label className="field">
              <span className="label">Search</span>
              <input
                className="input"
                placeholder={targetType === 'art' ? 'Title, artist, series, or fandom' : 'Title, person, genre, or notes'}
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    searchTargets();
                  }
                }}
              />
            </label>
            <div className="flex items-end">
              <button className="btn-secondary w-full md:w-auto" onClick={searchTargets} disabled={searching}>
                {searching ? <><Spinner size={14} />Searching…</> : <><Icons.Search />Search</>}
              </button>
            </div>
          </div>
          {searchResults.length > 0 ? (
            <div className="mt-3 divide-y divide-edge/60 border-t border-edge/60">
              {searchResults.map((candidate) => {
                const candidateId = getCandidateId(candidate);
                const imagePath = candidate.image_path || candidate.poster_path || candidate.cover_path;
                return (
                  <article key={`${targetType}-${candidateId}`} className="flex items-start gap-3 py-3">
                    {imagePath ? (
                      <div className="h-14 w-10 shrink-0 overflow-hidden rounded-md border border-edge bg-surface">
                        <img src={posterUrl(imagePath)} alt="" className="h-full w-full object-cover" />
                      </div>
                    ) : (
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-edge bg-surface text-ghost">
                        {targetType === 'art' ? <Icons.Activity /> : <Icons.Film />}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink truncate">{candidate.title}</p>
                      <p className="mt-1 text-xs text-dim">{formatCandidateMeta(candidate)}</p>
                    </div>
                    <button
                      className="btn-secondary btn-sm"
                      disabled={linkingId === candidateId}
                      onClick={() => linkTarget(candidate)}
                    >
                      {linkingId === candidateId ? <><Spinner size={14} />Linking…</> : 'Link'}
                    </button>
                  </article>
                );
              })}
            </div>
          ) : null}
          {!searching && searchResults.length === 0 ? (
            <p className="mt-3 text-sm text-ghost">Search an owned Art or media record, then attach this autograph as its signature evidence.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function EventArtifactsEditor({ eventId, apiCall, onSaved }) {
  const [artifacts, setArtifacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [artifactEditorOpen, setArtifactEditorOpen] = useState(false);
  const [artifactForm, setArtifactForm] = useState(DEFAULT_ARTIFACT_FORM);
  const [editingArtifactId, setEditingArtifactId] = useState(null);
  const [artifactFile, setArtifactFile] = useState(null);
  const [artifactSaving, setArtifactSaving] = useState(false);
  const [artifactError, setArtifactError] = useState('');
  const [artifactNotice, setArtifactNotice] = useState('');

  const loadArtifacts = useCallback(async () => {
    setLoading(true);
    try {
      const artifactRows = await apiCall('get', `/events/${eventId}/artifacts`);
      setArtifacts(Array.isArray(artifactRows) ? artifactRows : []);
    } finally {
      setLoading(false);
    }
  }, [apiCall, eventId]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await loadArtifacts();
      } catch (_) {
        if (active) {
          setArtifactError('Failed to load event artifacts');
          setLoading(false);
        }
      }
    })();
    return () => { active = false; };
  }, [loadArtifacts]);

  const clearArtifactForm = useCallback(() => {
    setEditingArtifactId(null);
    setArtifactFile(null);
    setArtifactForm(DEFAULT_ARTIFACT_FORM);
    setArtifactError('');
    setArtifactNotice('');
  }, []);

  const saveArtifact = async () => {
    if (!artifactForm.title.trim()) return;
    if (artifactSaving) return;
    setArtifactSaving(true);
    setArtifactError('');
    setArtifactNotice('');
    try {
      const payload = {
        artifact_type: artifactForm.artifact_type,
        title: artifactForm.title.trim(),
        description: artifactForm.description || null,
        vendor: artifactForm.vendor || null,
        price: artifactForm.price === '' ? null : Number(artifactForm.price),
        image_path: artifactForm.image_path || null,
        signer_name: artifactForm.artifact_type === 'autograph' ? (artifactForm.signer_name || null) : null,
        signer_role: artifactForm.artifact_type === 'autograph' ? (artifactForm.signer_role || null) : null,
        signed_on: artifactForm.artifact_type === 'autograph' ? (artifactForm.signed_on || null) : null,
        signed_at: artifactForm.artifact_type === 'autograph' ? (artifactForm.signed_at || null) : null,
        proof_path: artifactForm.artifact_type === 'autograph' ? (artifactForm.signature_proof_path || artifactForm.image_path || null) : null,
        signature_notes: artifactForm.artifact_type === 'autograph' ? (artifactForm.signature_notes || artifactForm.description || null) : null
      };
      let artifactId = editingArtifactId;
      if (editingArtifactId) {
        await apiCall('patch', `/events/${eventId}/artifacts/${editingArtifactId}`, payload);
      } else {
        const created = await apiCall('post', `/events/${eventId}/artifacts`, payload);
        artifactId = created?.id || null;
      }

      let uploadError = '';
      if (artifactFile && artifactId) {
        try {
          const formData = new FormData();
          formData.append('image', artifactFile);
          await apiCall('post', `/events/${eventId}/artifacts/${artifactId}/upload-image`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
          });
        } catch (primaryErr) {
          try {
            const fallbackForm = new FormData();
            fallbackForm.append('cover', artifactFile);
            const uploaded = await apiCall('post', '/media/upload-cover', fallbackForm, {
              headers: { 'Content-Type': 'multipart/form-data' }
            });
            if (uploaded?.path) {
              await apiCall('patch', `/events/${eventId}/artifacts/${artifactId}`, { image_path: uploaded.path });
            } else {
              throw new Error('Fallback upload returned no image path');
            }
          } catch (fallbackErr) {
            const primaryMsg = primaryErr?.response?.data?.error || primaryErr?.message || 'primary upload failed';
            const fallbackMsg = fallbackErr?.response?.data?.error || fallbackErr?.message || 'fallback upload failed';
            uploadError = `${formatUploadError(primaryMsg)}; ${formatUploadError(fallbackMsg)}`;
          }
        }
      }

      clearArtifactForm();
      await loadArtifacts();
      onSaved?.();
      if (uploadError) {
        setArtifactError(`Artifact saved, but image upload failed: ${uploadError}`);
      } else {
        setArtifactNotice('Artifact saved');
      }
    } catch (err) {
      setArtifactError(err?.response?.data?.error || 'Failed to save artifact');
    } finally {
      setArtifactSaving(false);
    }
  };

  const removeArtifact = async (artifactId) => {
    if (!window.confirm('Delete this artifact?')) return;
    await apiCall('delete', `/events/${eventId}/artifacts/${artifactId}`);
    await loadArtifacts();
    onSaved?.();
  };

  const editArtifact = (artifact) => {
    const signature = artifact.event_artifact_signature || artifact.signature || {};
    setEditingArtifactId(artifact.id);
    setArtifactFile(null);
    setArtifactForm({
      artifact_type: artifact.artifact_type || 'note',
      title: artifact.title || '',
      description: artifact.description || '',
      vendor: artifact.vendor || '',
      price: artifact.price ?? '',
      image_path: artifact.image_path || '',
      signer_name: signature.signer_name || '',
      signer_role: signature.signer_role || '',
      signed_on: toInputDate(signature.signed_on),
      signed_at: signature.signed_at || '',
      signature_proof_path: signature.proof_path || '',
      signature_notes: signature.notes || ''
    });
  };

  const removeArtifactImage = async (artifact) => {
    if (!artifact?.id) return;
    await apiCall('delete', `/events/${eventId}/artifacts/${artifact.id}/image`);
    await loadArtifacts();
    onSaved?.();
  };

  const formatArtifactMeta = (artifact) => {
    const parts = [];
    if (artifact?.artifact_type) parts.push(artifact.artifact_type);
    if (artifact?.vendor) parts.push(artifact.vendor);
    if (artifact?.price !== null && artifact?.price !== undefined && artifact?.price !== '') {
      parts.push(`$${artifact.price}`);
    }
    return parts.join(' · ');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <p className="text-sm text-dim">{pluralizeArtifacts(artifacts.length)}</p>
        <div className="flex-1" />
        <button
          className="btn-ghost btn-sm"
          onClick={() => {
            setArtifactEditorOpen((open) => {
              const next = !open;
              if (!next) clearArtifactForm();
              return next;
            });
          }}
        >
          {artifactEditorOpen ? 'Done' : 'Edit schedule'}
        </button>
      </div>
      {loading ? <div className="flex items-center gap-2 text-dim"><Spinner size={16} />Loading schedule…</div> : null}
      {artifactError ? <p className="text-xs text-err">{artifactError}</p> : null}
      {artifactNotice ? <p className="text-xs text-ok">{artifactNotice}</p> : null}
      <div className="border-t border-edge/60">
        {artifacts.map((artifact) => (
          <div key={artifact.id} className="flex items-start gap-3 border-b border-edge/60 py-3 last:border-b-0">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{artifact.title}</p>
              {formatArtifactMeta(artifact) ? (
                <p className="mt-1 text-xs text-dim">{formatArtifactMeta(artifact)}</p>
              ) : null}
              {artifact.description ? <p className="mt-2 text-sm text-ghost">{artifact.description}</p> : null}
              {artifact.artifact_type === 'autograph' ? (
                <EventAutographSignatureLinker
                  eventId={eventId}
                  artifact={artifact}
                  apiCall={apiCall}
                  onLinked={async () => {
                    await loadArtifacts();
                    onSaved?.();
                  }}
                />
              ) : null}
            </div>
            {artifact.image_path ? (
              <a
                className="btn-ghost btn-sm"
                href={artifact.image_path}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                aria-label={`Open image for ${artifact.title}`}
              >
                <Icons.Link />
              </a>
            ) : null}
            {artifactEditorOpen && artifact.image_path ? (
              <button className="btn-ghost btn-sm" onClick={() => removeArtifactImage(artifact)} aria-label={`Remove image from ${artifact.title}`}>
                <Icons.X />
              </button>
            ) : null}
            {artifactEditorOpen ? (
              <button className="btn-ghost btn-sm" onClick={() => editArtifact(artifact)} aria-label={`Edit ${artifact.title}`}>
                <Icons.Edit />
              </button>
            ) : null}
            {artifactEditorOpen ? (
              <button className="btn-ghost btn-sm text-err hover:bg-err/10" onClick={() => removeArtifact(artifact.id)} aria-label={`Delete ${artifact.title}`}>
                <Icons.Trash />
              </button>
            ) : null}
          </div>
        ))}
        {!loading && artifacts.length === 0 ? (
          <div className="py-4 text-sm text-dim">
            No schedule items yet.
          </div>
        ) : null}
      </div>
      {artifactEditorOpen ? (
        <div className="space-y-3 border-t border-edge/60 pt-4">
          <p className="text-sm font-medium text-ink">{editingArtifactId ? `Edit entry #${editingArtifactId}` : 'Add schedule item'}</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="field">
              <span className="label">Type</span>
              <select className="select" value={artifactForm.artifact_type} onChange={(e) => setArtifactForm((prev) => ({ ...prev, artifact_type: e.target.value }))}>
                <option value="note">Note</option>
                <option value="session">Session</option>
                <option value="person">Person</option>
                <option value="autograph">Autograph</option>
                <option value="purchase">Purchase</option>
                <option value="freebie">Freebie</option>
              </select>
            </label>
            <label className="field">
              <span className="label">Title</span>
              <input className="input" value={artifactForm.title} onChange={(e) => setArtifactForm((prev) => ({ ...prev, title: e.target.value }))} />
            </label>
            {artifactForm.artifact_type === 'autograph' ? (
              <>
                <label className="field">
                  <span className="label">Signer</span>
                  <input className="input" value={artifactForm.signer_name} onChange={(e) => setArtifactForm((prev) => ({ ...prev, signer_name: e.target.value }))} />
                </label>
                <label className="field">
                  <span className="label">Role</span>
                  <input className="input" placeholder="Artist, actor, writer…" value={artifactForm.signer_role} onChange={(e) => setArtifactForm((prev) => ({ ...prev, signer_role: e.target.value }))} />
                </label>
                <label className="field">
                  <span className="label">Signed date</span>
                  <input type="date" className="input" value={artifactForm.signed_on} onChange={(e) => setArtifactForm((prev) => ({ ...prev, signed_on: e.target.value }))} />
                </label>
                <label className="field">
                  <span className="label">Signed at</span>
                  <input className="input" placeholder="Booth, table, room, or event spot" value={artifactForm.signed_at} onChange={(e) => setArtifactForm((prev) => ({ ...prev, signed_at: e.target.value }))} />
                </label>
              </>
            ) : null}
            <label className="field">
              <span className="label">Vendor</span>
              <input className="input" value={artifactForm.vendor} onChange={(e) => setArtifactForm((prev) => ({ ...prev, vendor: e.target.value }))} />
            </label>
            <label className="field">
              <span className="label">Price</span>
              <input className="input" inputMode="decimal" value={artifactForm.price} onChange={(e) => setArtifactForm((prev) => ({ ...prev, price: e.target.value }))} />
            </label>
            <label className="field md:col-span-2">
              <span className="label">Image URL</span>
              <input className="input" placeholder="Optional" value={artifactForm.image_path} onChange={(e) => setArtifactForm((prev) => ({ ...prev, image_path: e.target.value }))} />
            </label>
            {artifactForm.artifact_type === 'autograph' ? (
              <label className="field md:col-span-2">
                <span className="label">Proof image URL</span>
                <input className="input" placeholder="Optional proof image for this signature" value={artifactForm.signature_proof_path} onChange={(e) => setArtifactForm((prev) => ({ ...prev, signature_proof_path: e.target.value }))} />
              </label>
            ) : null}
            <label className="field md:col-span-2">
              <span className="label">Image</span>
              <input className="input" type="file" accept="image/*" capture="environment" onChange={(e) => setArtifactFile(e.target.files?.[0] || null)} />
            </label>
            {artifactFile ? <p className="text-xs text-ghost md:col-span-2">Selected file: {artifactFile.name}</p> : null}
            <label className="field md:col-span-2">
              <span className="label">Notes</span>
              <textarea className="textarea min-h-[88px]" value={artifactForm.description} onChange={(e) => setArtifactForm((prev) => ({ ...prev, description: e.target.value }))} />
            </label>
            {artifactForm.artifact_type === 'autograph' ? (
              <label className="field md:col-span-2">
                <span className="label">Signature notes</span>
                <textarea className="textarea min-h-[72px]" value={artifactForm.signature_notes} onChange={(e) => setArtifactForm((prev) => ({ ...prev, signature_notes: e.target.value }))} />
              </label>
            ) : null}
            <div className="md:col-span-2 flex gap-2">
              <button className="btn-secondary flex-1" onClick={saveArtifact} disabled={artifactSaving}>
                {artifactSaving
                  ? <><Spinner size={14} />Saving…</>
                  : (editingArtifactId ? <><Icons.Check />Save Entry</> : <><Icons.Plus />Add Entry</>)}
              </button>
              {editingArtifactId ? <button className="btn-ghost" onClick={clearArtifactForm}>Cancel</button> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function EventPurchasedItemsReadback({ eventId, apiCall }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const [searchType, setSearchType] = useState('art');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [linkingId, setLinkingId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({
    title_snapshot: '',
    vendor_snapshot: '',
    booth_snapshot: '',
    price_snapshot: ''
  });

  const loadPurchasedItems = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const payload = await apiCall('get', `/events/${eventId}/purchased-items`);
      setItems(Array.isArray(payload?.items) ? payload.items : []);
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load purchased items');
    } finally {
      setLoading(false);
    }
  }, [apiCall, eventId]);

  useEffect(() => { loadPurchasedItems(); }, [loadPurchasedItems]);

  const linkedKeys = useMemo(() => new Set(items.map((item) => `${item.item_type}:${item.item_id}`)), [items]);

  const getCandidateId = (candidate, type = searchType) => Number(type === 'art' ? (candidate.native_art_id || candidate.id) : candidate.id);
  const getCandidateKey = (candidate, type = searchType) => `${type}:${getCandidateId(candidate, type)}`;

  const formatMoney = (value) => {
    if (value === null || value === undefined || value === '') return '';
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return `$${value}`;
    return `$${numeric.toFixed(Number.isInteger(numeric) ? 0 : 2)}`;
  };

  const formatPurchaseMeta = (item) => {
    const resolved = item?.resolved_item || {};
    const parts = [item.item_type === 'art' ? 'Art' : 'Collectible'];
    const maker = resolved.artist || resolved.series;
    if (maker) parts.push(maker);
    const vendor = item.vendor_snapshot || resolved.vendor;
    const booth = item.booth_snapshot || resolved.booth;
    if (vendor && booth) parts.push(`${vendor} / ${booth}`);
    else if (vendor || booth) parts.push(vendor || booth);
    const price = item.price_snapshot ?? resolved.price;
    if (price !== null && price !== undefined && price !== '') parts.push(formatMoney(price));
    return parts.filter(Boolean).join(' · ');
  };

  const formatCandidateMeta = (candidate, type = searchType) => {
    const parts = [];
    if (type === 'art') {
      parts.push('Art');
      if (candidate.franchise) parts.push(candidate.franchise);
      if (candidate.medium) parts.push(String(candidate.medium).replaceAll('_', ' '));
      if (candidate.artist) parts.push(candidate.artist);
      if (candidate.series) parts.push(candidate.series);
    } else {
      parts.push('Collectible');
      if (candidate.franchise) parts.push(candidate.franchise);
      if (candidate.category || candidate.category_key) parts.push(candidate.category || candidate.category_key);
      if (candidate.series) parts.push(candidate.series);
    }
    if (candidate.vendor && candidate.booth) parts.push(`${candidate.vendor} / ${candidate.booth}`);
    else if (candidate.vendor || candidate.booth) parts.push(candidate.vendor || candidate.booth);
    if (candidate.price !== null && candidate.price !== undefined && candidate.price !== '') parts.push(formatMoney(candidate.price));
    return parts.filter(Boolean).join(' · ');
  };

  const searchPurchaseSources = async () => {
    setSearching(true);
    setError('');
    setNotice('');
    try {
      const params = new URLSearchParams();
      params.set('limit', '8');
      params.set('sort_dir', 'asc');
      if (searchTerm.trim()) params.set('q', searchTerm.trim());
      const payload = await apiCall('get', `${searchType === 'art' ? '/art' : '/collectibles'}?${params.toString()}`);
      const rows = Array.isArray(payload?.items) ? payload.items : [];
      setSearchResults(rows);
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to search purchase sources');
    } finally {
      setSearching(false);
    }
  };

  const linkCandidate = async (candidate) => {
    const itemId = getCandidateId(candidate);
    if (!itemId) return;
    setLinkingId(itemId);
    setError('');
    setNotice('');
    try {
      await apiCall('post', `/events/${eventId}/purchased-items`, {
        item_type: searchType,
        item_id: itemId
      });
      await loadPurchasedItems();
      setLinkOpen(false);
      setSearchResults([]);
      setSearchTerm('');
      setNotice(`${candidate.title || 'Item'} linked to this event`);
    } catch (err) {
      if (err?.response?.status === 409) {
        setNotice('That item is already linked to this event.');
      } else {
        setError(err?.response?.data?.error || 'Failed to link purchased item');
      }
    } finally {
      setLinkingId(null);
    }
  };

  const beginEdit = (item) => {
    const resolved = item.resolved_item || {};
    setEditingId(item.id);
    setEditForm({
      title_snapshot: item.title_snapshot || resolved.title || '',
      vendor_snapshot: item.vendor_snapshot || resolved.vendor || '',
      booth_snapshot: item.booth_snapshot || resolved.booth || '',
      price_snapshot: item.price_snapshot ?? resolved.price ?? ''
    });
    setError('');
    setNotice('');
  };

  const savePurchaseSnapshot = async (item) => {
    setError('');
    setNotice('');
    try {
      await apiCall('patch', `/events/${eventId}/purchased-items/${item.id}`, {
        title_snapshot: editForm.title_snapshot || null,
        vendor_snapshot: editForm.vendor_snapshot || null,
        booth_snapshot: editForm.booth_snapshot || null,
        price_snapshot: editForm.price_snapshot === '' ? null : Number(editForm.price_snapshot)
      });
      setEditingId(null);
      await loadPurchasedItems();
      setNotice('Purchase details saved');
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to save purchase details');
    }
  };

  const unlinkPurchasedItem = async (item) => {
    if (!window.confirm('Remove this purchase link from the event?')) return;
    setError('');
    setNotice('');
    try {
      await apiCall('delete', `/events/${eventId}/purchased-items/${item.id}`);
      await loadPurchasedItems();
      setNotice('Purchase link removed');
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to remove purchase link');
    }
  };

  return (
    <section className="rounded-xl border border-edge bg-surface p-4">
      <div className="flex items-start gap-3">
        <div>
          <p className="label">Tracked purchases</p>
          <p className="text-sm text-dim">{items.length} linked item{items.length === 1 ? '' : 's'}</p>
        </div>
        <div className="flex-1" />
        <button
          className="btn-secondary btn-sm"
          onClick={() => {
            setLinkOpen((open) => !open);
            setError('');
            setNotice('');
          }}
        >
          <Icons.Plus />Link item
        </button>
        <button className="btn-ghost btn-sm" onClick={loadPurchasedItems} disabled={loading}>
          {loading ? <><Spinner size={14} />Loading…</> : 'Refresh'}
        </button>
      </div>
      {error ? <p className="mt-3 text-xs text-err">{error}</p> : null}
      {notice ? <p className="mt-3 text-xs text-ok">{notice}</p> : null}
      {linkOpen ? (
        <div className="mt-4 rounded-lg border border-edge bg-raised p-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[10rem_1fr_auto]">
            <label className="field">
              <span className="label">Library</span>
              <select
                className="select"
                value={searchType}
                onChange={(event) => {
                  setSearchType(event.target.value);
                  setSearchResults([]);
                }}
              >
                <option value="art">Art</option>
                <option value="collectible">Collectibles</option>
              </select>
            </label>
            <label className="field">
              <span className="label">Search</span>
              <input
                className="input"
                placeholder={searchType === 'art' ? 'Title, fandom, artist, or series' : 'Title, fandom, category, or vendor'}
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    searchPurchaseSources();
                  }
                }}
              />
            </label>
            <div className="flex items-end">
              <button className="btn-secondary w-full md:w-auto" onClick={searchPurchaseSources} disabled={searching}>
                {searching ? <><Spinner size={14} />Searching…</> : <><Icons.Search />Search</>}
              </button>
            </div>
          </div>
          {searchResults.length > 0 ? (
            <div className="mt-3 divide-y divide-edge/60 border-t border-edge/60">
              {searchResults.map((candidate) => {
                const candidateId = getCandidateId(candidate);
                const alreadyLinked = linkedKeys.has(getCandidateKey(candidate));
                return (
                  <article key={`${searchType}-${candidateId}`} className="flex items-start gap-3 py-3">
                    {candidate.image_path ? (
                      <div className="h-14 w-10 shrink-0 overflow-hidden rounded-md border border-edge bg-surface">
                        <img src={posterUrl(candidate.image_path)} alt="" className="h-full w-full object-cover" />
                      </div>
                    ) : (
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-edge bg-surface text-ghost">
                        {searchType === 'art' ? <Icons.Activity /> : <Icons.Library />}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink truncate">{candidate.title}</p>
                      <p className="mt-1 text-xs text-dim">{formatCandidateMeta(candidate)}</p>
                    </div>
                    <button
                      className={alreadyLinked ? 'btn-ghost btn-sm' : 'btn-secondary btn-sm'}
                      disabled={alreadyLinked || linkingId === candidateId}
                      onClick={() => linkCandidate(candidate)}
                    >
                      {alreadyLinked ? 'Linked' : (linkingId === candidateId ? <><Spinner size={14} />Linking…</> : 'Link')}
                    </button>
                  </article>
                );
              })}
            </div>
          ) : null}
          {!searching && searchResults.length === 0 ? (
            <p className="mt-3 text-sm text-ghost">Search existing Art or Collectibles, then link the tracked item here.</p>
          ) : null}
        </div>
      ) : null}
      {!loading && items.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-edge bg-raised px-3 py-3 text-sm text-ghost">
          No tracked Art or Collectibles purchases are linked through the shared purchase relationship yet.
        </p>
      ) : null}
      {items.length > 0 ? (
        <div className="mt-3 divide-y divide-edge/60">
          {items.map((item) => {
            const resolved = item.resolved_item || {};
            const title = item.title_snapshot || resolved.title || `${item.item_type} #${item.item_id}`;
            const isEditing = editingId === item.id;
            return (
              <article key={item.id} className="py-3">
                <div className="flex items-start gap-3">
                {resolved.image_path ? (
                  <div className="h-14 w-10 shrink-0 overflow-hidden rounded-md border border-edge bg-raised">
                    <img src={posterUrl(resolved.image_path)} alt="" className="h-full w-full object-cover" />
                  </div>
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-edge bg-raised text-ghost">
                    <Icons.Activity />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink truncate">{title}</p>
                  {formatPurchaseMeta(item) ? <p className="mt-1 text-xs text-dim">{formatPurchaseMeta(item)}</p> : null}
                </div>
                <span className="badge badge-dim text-[10px]">{item.item_type}</span>
                <button className="btn-ghost btn-sm" onClick={() => beginEdit(item)} aria-label={`Edit purchase details for ${title}`}>
                  <Icons.Edit />
                </button>
                <button className="btn-ghost btn-sm text-err hover:bg-err/10" onClick={() => unlinkPurchasedItem(item)} aria-label={`Remove purchase link for ${title}`}>
                  <Icons.Trash />
                </button>
                </div>
                {isEditing ? (
                  <div className="mt-3 grid grid-cols-1 gap-3 rounded-lg border border-edge bg-raised p-3 md:grid-cols-2">
                    <label className="field md:col-span-2">
                      <span className="label">Display title</span>
                      <input className="input" value={editForm.title_snapshot} onChange={(event) => setEditForm((prev) => ({ ...prev, title_snapshot: event.target.value }))} />
                    </label>
                    <label className="field">
                      <span className="label">Vendor</span>
                      <input className="input" value={editForm.vendor_snapshot} onChange={(event) => setEditForm((prev) => ({ ...prev, vendor_snapshot: event.target.value }))} />
                    </label>
                    <label className="field">
                      <span className="label">Booth</span>
                      <input className="input" value={editForm.booth_snapshot} onChange={(event) => setEditForm((prev) => ({ ...prev, booth_snapshot: event.target.value }))} />
                    </label>
                    <label className="field">
                      <span className="label">Price</span>
                      <input className="input" inputMode="decimal" value={editForm.price_snapshot} onChange={(event) => setEditForm((prev) => ({ ...prev, price_snapshot: event.target.value }))} />
                    </label>
                    <div className="flex items-end gap-2">
                      <button className="btn-secondary flex-1" onClick={() => savePurchaseSnapshot(item)}><Icons.Check />Save</button>
                      <button className="btn-ghost" onClick={() => setEditingId(null)}>Cancel</button>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function EventFormDrawer({ initial, apiCall, onClose, onSave, onDelete, onClearImage }) {
  const [form, setForm] = useState(() => ({
    ...DEFAULT_EVENT_FORM,
    ...(initial || {}),
    date_start: toInputDate(initial?.date_start),
    date_end: toInputDate(initial?.date_end)
  }));
  const [imageFile, setImageFile] = useState(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const eventTabs = useMemo(() => ([
    { id: 'core', label: 'Core Details' },
    { id: 'subevents', label: 'Schedule' },
    { id: 'storage', label: 'Storage & Notes' }
  ]), []);
  const [activeTab, setActiveTab] = useState('core');

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    setForm({
      ...DEFAULT_EVENT_FORM,
      ...(initial || {}),
      date_start: toInputDate(initial?.date_start),
      date_end: toInputDate(initial?.date_end)
    });
    setImageFile(null);
    setActiveTab('core');
  }, [initial]);

  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      await onSave({
        ...form,
        date_end: form.date_end || null,
        host: form.host || null,
        time_label: form.time_label || null,
        room: form.room || null,
        image_path: form.image_path || null,
        notes: form.notes || null
      }, imageFile);
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to save event');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-void/72" onClick={onClose} />
      <div className="ml-auto h-full w-full max-w-[40rem] bg-abyss border-l border-edge shadow-card relative flex flex-col">
        <div className="px-6 py-4 border-b border-edge flex items-center gap-3">
          <h2 className="section-title !text-xl">{initial?.id ? 'Edit Event' : 'Add Event'}</h2>
          <div className="flex-1" />
          <button className="btn-icon" onClick={onClose}><Icons.X /></button>
        </div>
        <div className="p-6 overflow-y-auto space-y-4">
          {error && <p className="text-sm text-err">{error}</p>}
          <SectionTabs
            tabs={eventTabs}
            activeId={activeTab}
            onChange={setActiveTab}
            showIndex
            stretch
            ariaLabel="Event editor steps"
            idBase="event-editor-steps"
          />
          <div className="space-y-4 border-t border-edge/60 pt-3">

            <SectionTabPanel activeId={activeTab} tabKey="core" idBase="event-editor-steps">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="field md:col-span-2"><span className="label">Title *</span><input className="input" value={form.title || ''} onChange={(e) => set({ title: e.target.value })} /></label>
                <label className="field md:col-span-2"><span className="label">URL *</span><input className="input" value={form.url || ''} onChange={(e) => set({ url: e.target.value })} /></label>
                <label className="field"><span className="label">Location *</span><input className="input" value={form.location || ''} onChange={(e) => set({ location: e.target.value })} /></label>
                <label className="field"><span className="label">Host</span><input className="input" value={form.host || ''} onChange={(e) => set({ host: e.target.value })} /></label>
                <label className="field"><span className="label">Start Date *</span><input type="date" className="input" value={form.date_start || ''} onChange={(e) => set({ date_start: e.target.value })} /></label>
                <label className="field"><span className="label">End Date</span><input type="date" className="input" value={form.date_end || ''} onChange={(e) => set({ date_end: e.target.value })} /></label>
                <label className="field"><span className="label">Time</span><input className="input" value={form.time_label || ''} onChange={(e) => set({ time_label: e.target.value })} /></label>
                <label className="field"><span className="label">Room</span><input className="input" value={form.room || ''} onChange={(e) => set({ room: e.target.value })} /></label>
              </div>
            </SectionTabPanel>

            <SectionTabPanel activeId={activeTab} tabKey="subevents" idBase="event-editor-steps">
              {activeTab === 'subevents' ? (
              initial?.id ? (
                <EventArtifactsEditor eventId={initial.id} apiCall={apiCall} onSaved={() => {}} />
              ) : (
                <div className="rounded-md border border-dashed border-edge px-4 py-6 text-sm text-ghost">
                  Save the event first, then come back here to add panels, parties, signings, purchases, and other sub-event history.
                </div>
              )
              ) : null}
            </SectionTabPanel>

            <SectionTabPanel activeId={activeTab} tabKey="storage" idBase="event-editor-steps">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="field md:col-span-2"><span className="label">Image URL (optional)</span><input className="input" value={form.image_path || ''} onChange={(e) => set({ image_path: e.target.value })} /></label>
                <label className="field md:col-span-2"><span className="label">Upload/Capture image</span><input className="input" type="file" accept="image/*" capture="environment" onChange={(e) => setImageFile(e.target.files?.[0] || null)} /></label>
                <div className="md:col-span-2 flex items-center gap-2">
                  <button type="button" onClick={() => setCameraOpen(true)} className="btn-secondary btn-sm"><Icons.Camera />Camera</button>
                </div>
                {imageFile ? <p className="text-xs text-ghost md:col-span-2">Selected file: {imageFile.name}</p> : null}
                {form.image_path ? (
                  <div className="md:col-span-2 flex items-center gap-2">
                    <a className="btn-ghost btn-sm" href={form.image_path} target="_blank" rel="noreferrer"><Icons.Link />Open image</a>
                    {initial?.id ? <button className="btn-ghost btn-sm" onClick={onClearImage}><Icons.X />Remove image</button> : null}
                  </div>
                ) : null}
                <label className="field md:col-span-2"><span className="label">Notes</span><textarea className="textarea min-h-[96px]" value={form.notes || ''} onChange={(e) => set({ notes: e.target.value })} /></label>
              </div>
            </SectionTabPanel>
          </div>
        </div>
        <div className="shrink-0 border-t border-edge bg-abyss px-6 py-4 flex items-center gap-3">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          {initial?.id && <button type="button" onClick={onDelete} className="btn-danger"><Icons.Trash />Delete</button>}
          <div className="flex-1" />
          <button type="button" onClick={submit} disabled={saving} className="btn-primary min-w-[100px]">{saving ? <Spinner size={16} /> : 'Save'}</button>
        </div>
        <CameraCaptureModal
          open={cameraOpen}
          title="Capture event image"
          description="Capture an event image and attach it directly to this event."
          confirmLabel="Use event image"
          onClose={() => setCameraOpen(false)}
          onCapture={async (file) => {
            setImageFile(file);
          }}
        />
      </div>
    </div>
  );
}

function EventDetailDrawer({ eventId, apiCall, onClose, onEdit, onDeleted, onSaved }) {
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const row = await apiCall('get', `/events/${eventId}`);
      if (row) setEvent(row);
    } finally {
      setLoading(false);
    }
  }, [apiCall, eventId]);

  useEffect(() => { load(); }, [load]);

  const deleteEvent = async () => {
    if (!window.confirm('Delete this event?')) return;
    await apiCall('delete', `/events/${eventId}`);
    onDeleted?.();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-void/72" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-xl h-full bg-abyss border-l border-edge flex flex-col animate-slide-in">
        {event?.image_path ? (
          <div className="relative h-48 shrink-0 overflow-hidden">
            <img src={posterUrl(event.image_path)} alt="" className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-hero-fade" />
          </div>
        ) : null}
        <div className="px-6 pt-6 pb-4 border-b border-edge">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <h2 className="text-2xl font-semibold tracking-tight text-ink leading-tight">{event?.title || `Event #${eventId}`}</h2>
                <p className="text-sm text-ghost">#{eventId}</p>
              </div>
              <p className="text-sm text-dim mt-1">{toDisplayDate(event?.date_start)}{event?.location ? ` · ${event.location}` : ''}</p>
            </div>
            <button onClick={onClose} className="btn-icon btn-sm shrink-0"><Icons.X /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto scroll-area p-6 space-y-5">
          {loading && <div className="flex items-center gap-2 text-dim"><Spinner size={16} />Loading…</div>}
          {!loading && (
            <>
              <div className="grid grid-cols-1 gap-x-8 gap-y-5 text-sm md:grid-cols-2">
                <DetailField label="Start Date">{toDisplayDate(event?.date_start) || 'Date pending'}</DetailField>
                <DetailField label="End Date">{event?.date_end ? toDisplayDate(event.date_end) : 'Single day event'}</DetailField>
                <DetailField label="Location">{event?.location}</DetailField>
                <DetailField label="Room">{event?.room}</DetailField>
                <DetailField label="Time">{event?.time_label}</DetailField>
                <DetailField label="Host">{event?.host}</DetailField>
                {event?.image_path ? (
                  <DetailField label="Image">
                    <a
                      className="inline-flex items-center gap-2 text-dim transition-colors hover:text-ink"
                      href={event.image_path}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Icons.Link />
                      Open image
                    </a>
                  </DetailField>
                ) : null}
                {event?.url ? (
                  <DetailField label="Event site">
                    <a
                      className="inline-flex items-center gap-2 text-dim transition-colors hover:text-ink"
                      href={event.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Icons.Link />
                      Open event site
                    </a>
                  </DetailField>
                ) : null}
              </div>
              {event?.notes ? (
                <DetailField label="Notes">
                  <p className="max-w-3xl text-dim leading-7">{event.notes}</p>
                </DetailField>
              ) : null}
              <EventPurchasedItemsReadback eventId={eventId} apiCall={apiCall} />
              <EventArtifactsEditor eventId={eventId} apiCall={apiCall} onSaved={onSaved} />
            </>
          )}
        </div>
        <div className="p-4 border-t border-edge flex gap-3 shrink-0">
          <button onClick={onClose} className="btn-ghost">Close</button>
          <button onClick={() => onEdit(event)} className="btn-ghost flex-1"><Icons.Edit />Edit</button>
          <button onClick={deleteEvent} className="btn-ghost text-err hover:bg-err/10"><Icons.Trash />Delete</button>
        </div>
      </div>
    </div>
  );
}

export default function EventsView({ apiCall, onToast }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [sortDir, setSortDir] = useState('asc');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [viewMode, setViewMode] = useState('cards');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [detailId, setDetailId] = useState(null);

  const supportsHover = useMemo(() => window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches, []);
  const activeFilterCount = useMemo(() => [search.trim(), fromDate, toDate].filter(Boolean).length, [fromDate, search, toDate]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(pageSize));
      if (search.trim()) params.set('q', search.trim());
      params.set('sort_dir', sortDir);
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
      const payload = await apiCall('get', `/events?${params.toString()}`);
      setItems(Array.isArray(payload?.items) ? payload.items : []);
      setPagination(payload?.pagination || { page, limit: pageSize, total: 0, totalPages: 1, hasMore: false });
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load events');
    } finally {
      setLoading(false);
    }
  }, [apiCall, fromDate, page, pageSize, search, sortDir, toDate]);

  useEffect(() => { load(); }, [load]);

  const saveEvent = async (payload, imageFile) => {
    if (editing?.id) {
      await apiCall('patch', `/events/${editing.id}`, payload);
      if (imageFile) {
        const formData = new FormData();
        formData.append('image', imageFile);
        await apiCall('post', `/events/${editing.id}/upload-image`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
      }
      onToast?.('Event saved');
    } else {
      const created = await apiCall('post', '/events', payload);
      if (imageFile && created?.id) {
        const formData = new FormData();
        formData.append('image', imageFile);
        await apiCall('post', `/events/${created.id}/upload-image`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
      }
      onToast?.('Event created');
    }
    setAdding(false);
    setEditing(null);
    await load();
  };

  const clearEventImage = async () => {
    if (!editing?.id) return;
    await apiCall('delete', `/events/${editing.id}/image`);
    onToast?.('Event image removed');
    const refreshed = await apiCall('get', `/events/${editing.id}`);
    setEditing(refreshed);
    await load();
  };

  const deleteEvent = async (id) => {
    if (!window.confirm('Delete this event?')) return;
    await apiCall('delete', `/events/${id}`);
    onToast?.('Event deleted');
    await load();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-edge shrink-0">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="section-title">Events</h1>
              <span className="badge badge-dim">{pagination.total || items.length}</span>
              {activeFilterCount > 0 ? <MetaPill tone="brand">{`${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'} active`}</MetaPill> : null}
            </div>
            <p className="mt-1 text-sm text-ghost">Track conventions, screenings, meetups, and the artifacts you picked up along the way.</p>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ghost pointer-events-none"><Icons.Search /></span>
            <input className="input pl-9 w-56" placeholder="Search title or location…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <input
            type="date"
            className="input w-40"
            value={fromDate}
            onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
            title="From date"
          />
          <input
            type="date"
            className="input w-40"
            value={toDate}
            onChange={(e) => { setToDate(e.target.value); setPage(1); }}
            title="To date"
          />
          <SectionTabs
            tabs={[
              {
                id: 'cards',
                label: (
                  <>
                    <span aria-hidden="true"><Icons.Film /></span>
                    <span className="sr-only">Cards</span>
                  </>
                )
              },
              {
                id: 'list',
                label: (
                  <>
                    <span aria-hidden="true"><Icons.List /></span>
                    <span className="sr-only">List</span>
                  </>
                )
              }
            ]}
            activeId={viewMode}
            onChange={setViewMode}
            semantics="buttons"
            showDivider={false}
            ariaLabel="Event view mode"
            listClassName="gap-2"
            buttonClassName="px-2"
          />
          <button
            onClick={() => { setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); setPage(1); }}
            className="btn-icon"
            title={sortDir === 'asc' ? 'Sort ascending' : 'Sort descending'}
          >
            {sortDir === 'asc' ? <Icons.ArrowUp /> : <Icons.ArrowDown />}
          </button>
          <button onClick={() => setAdding(true)} className="btn-primary"><Icons.Plus />Add</button>
          </div>
        </div>
        {activeFilterCount > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {search.trim() ? <MetaPill>{`Search: ${search.trim()}`}</MetaPill> : null}
            {fromDate ? <MetaPill>{`From ${toDisplayDate(fromDate)}`}</MetaPill> : null}
            {toDate ? <MetaPill>{`To ${toDisplayDate(toDate)}`}</MetaPill> : null}
            <button className="btn-ghost btn-sm" onClick={() => { setSearch(''); setFromDate(''); setToDate(''); setPage(1); }}>Clear filters</button>
          </div>
        ) : null}
      </div>
      <div className="flex-1 overflow-y-auto scroll-area p-6">
        {error && <p className="text-sm text-err mb-4">{error}</p>}
        {loading && <div className="flex items-center justify-center py-20"><Spinner size={32} /></div>}
        {!loading && items.length === 0 && (
          <div className="rounded-2xl border border-dashed border-edge bg-surface px-5 py-8 text-sm text-ghost">
            No events found. Start with a convention, screening, meetup, or release event so related artifacts have a home.
          </div>
        )}
        {!loading && viewMode === 'cards' && items.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {items.map((item) => (
              <EventCard
                key={item.id}
                item={item}
                supportsHover={supportsHover}
                onOpen={() => setDetailId(item.id)}
                onEdit={() => setEditing(item)}
                onDelete={deleteEvent}
              />
            ))}
          </div>
        )}
        {!loading && viewMode === 'list' && items.length > 0 && (
          <div className="space-y-2">
            {items.map((item) => (
              <EventListRow
                key={item.id}
                item={item}
                supportsHover={supportsHover}
                onOpen={() => setDetailId(item.id)}
                onEdit={() => setEditing(item)}
                onDelete={deleteEvent}
              />
            ))}
          </div>
        )}
      </div>
      <CollectionPaginationFooter
        page={page}
        totalPages={pagination.totalPages || 1}
        hasMore={pagination.hasMore}
        loading={loading}
        pageSize={pageSize}
        pageSizeOptions={[25, 50, 100]}
        onPrevious={() => setPage((p) => Math.max(1, p - 1))}
        onNext={() => setPage((p) => p + 1)}
        onPageSizeChange={(value) => { setPageSize(value); setPage(1); }}
      />
      {(adding || editing) && (
        <EventFormDrawer
          initial={editing}
          apiCall={apiCall}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSave={saveEvent}
          onDelete={editing?.id ? async () => { await deleteEvent(editing.id); setEditing(null); } : null}
          onClearImage={clearEventImage}
        />
      )}
      {detailId && (
        <EventDetailDrawer
          eventId={detailId}
          apiCall={apiCall}
          onClose={() => setDetailId(null)}
          onEdit={(item) => { setDetailId(null); setEditing(item); }}
          onDeleted={load}
          onSaved={load}
        />
      )}
    </div>
  );
}
