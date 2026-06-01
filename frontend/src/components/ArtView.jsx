import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckboxControl, CollectionPaginationFooter, CoverImagePicker, DetailDrawerShell, DrawerBackdrop, Icons, PageHeaderSearchToolbar, Spinner, SectionTabPanel, SectionTabs, cx, posterUrl, ObjectPosterCard } from './app/AppPrimitives';
import SignatureManager from './app/SignatureManager';

const ART_MEDIUM_OPTIONS = [
  { value: 'original', label: 'Original' },
  { value: 'print', label: 'Print' },
  { value: 'comic_panel', label: 'Comic Panel' },
  { value: 'sketch', label: 'Sketch' },
  { value: 'commission', label: 'Commission' },
  { value: 'other', label: 'Other' }
];

const ART_DIMENSION_UNIT_OPTIONS = [
  { value: 'in', label: 'in' },
  { value: 'cm', label: 'cm' }
];

const DEFAULT_FORM = {
  title: '',
  series: '',
  franchise: '',
  artist: '',
  medium: '',
  height: '',
  width: '',
  dimension_unit: 'in',
  framed: false,
  print_number: '',
  print_run: '',
  artist_id: '',
  artist_role: 'Artist',
  event_id: '',
  vendor: '',
  booth: '',
  price: '',
  exclusive: false,
  signed: false,
  signer_name: '',
  signer_role: '',
  signed_on: '',
  signed_at: '',
  signed_event_id: '',
  signature_proof_path: '',
  signature_notes: '',
  image_path: '',
  notes: ''
};

const parseUploadError = (message) => {
  const raw = String(message || '');
  if (raw.includes('status code 413')) return 'Image upload failed: file too large (max 10MB)';
  return raw || 'Image upload failed';
};

const hasPurchaseContext = (item) => {
  const record = item || {};
  return Boolean(
    record.event_id
    || record.event_title
    || record.vendor
    || record.booth
    || record.booth_or_vendor
  );
};

function FilterPill({ children, tone = 'default' }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-md border px-2 py-1 text-[11px] font-medium',
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

function ArtistRecordPicker({ apiCall, form, setForm }) {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState({ aliases: '', website_url: '', notes: '' });
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const artistName = String(form.artist || '').trim();
  const selectedId = Number(form.artist_id || 0) || null;
  const selected = matches.find((artist) => Number(artist.id) === selectedId) || form.artist_record || null;
  const exactMatch = matches.find((artist) => artist.name?.toLowerCase() === artistName.toLowerCase());
  const linkedWorksLabel = selected?.linked_works_count === 1 ? '1 work' : `${selected?.linked_works_count} works`;

  useEffect(() => {
    if (artistName.length < 2) {
      setMatches([]);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const payload = await apiCall('get', `/art/artists?q=${encodeURIComponent(artistName)}&limit=8`);
        if (!cancelled) setMatches(Array.isArray(payload?.artists) ? payload.artists : []);
      } catch (err) {
        if (!cancelled) setError(err?.response?.data?.error || 'Artist lookup failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [apiCall, artistName]);

  const selectArtist = (artist) => {
    setForm((prev) => ({
      ...prev,
      artist_id: artist?.id ? String(artist.id) : '',
      artist: artist?.name || prev.artist,
      artist_record: artist || null,
      artist_role: prev.artist_role || 'Artist'
    }));
    setCreateOpen(false);
    setError('');
  };

  const clearLink = () => {
    setForm((prev) => ({ ...prev, artist_id: '', artist_record: null }));
  };

  const createArtist = async () => {
    if (!artistName || working) return;
    setWorking(true);
    setError('');
    try {
      const payload = await apiCall('post', '/art/artists', {
        name: artistName,
        aliases: draft.aliases || null,
        website_url: draft.website_url || null,
        notes: draft.notes || null
      });
      const artist = payload?.artist;
      if (artist?.id) {
        selectArtist(artist);
        setMatches((current) => [artist, ...current.filter((entry) => Number(entry.id) !== Number(artist.id))].slice(0, 8));
        setDraft({ aliases: '', website_url: '', notes: '' });
      }
    } catch (err) {
      setError(err?.response?.data?.error || 'Artist record could not be created');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="field md:col-span-2">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem]">
        <label className="field">
          <span className="label">Artist</span>
          <input
            className="input"
            value={form.artist || ''}
            onChange={(e) => setForm((prev) => ({ ...prev, artist: e.target.value, artist_id: '', artist_record: null }))}
          />
        </label>
        <label className="field">
          <span className="label">Role</span>
          <input
            className="input"
            placeholder="Artist"
            value={form.artist_role || ''}
            onChange={(e) => setForm((prev) => ({ ...prev, artist_role: e.target.value }))}
          />
        </label>
      </div>
      {selected ? (
        <div className="mt-2 rounded-md border border-edge/70 bg-surface px-3 py-2 text-sm text-dim">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              {selected.website_url ? (
                <a className="block truncate text-xs text-dim transition-colors hover:text-ink" href={selected.website_url} target="_blank" rel="noreferrer">
                  {selected.website_url}
                </a>
              ) : null}
              {selected.linked_works_count !== undefined ? <p className="mt-1 text-xs text-ghost">{linkedWorksLabel}</p> : null}
            </div>
            <button type="button" className="btn-ghost btn-sm shrink-0" onClick={clearLink}>Unlink</button>
          </div>
          {Array.isArray(selected.aliases) && selected.aliases.length ? <p className="mt-1 text-xs text-ghost">Aliases: {selected.aliases.join(', ')}</p> : null}
          {selected.notes ? <p className="mt-1 text-xs leading-5 text-ghost">{selected.notes}</p> : null}
        </div>
      ) : null}
      {!selected && (loading || matches.length > 0 || artistName.length >= 2) ? (
        <div className="mt-2 rounded-md border border-edge/70 bg-surface px-3 py-2">
          <div className="flex items-center gap-2 text-xs text-ghost">
            {loading ? <Spinner size={12} /> : null}
            <span>{loading ? 'Searching artists…' : matches.length ? 'Matching artists' : 'No linked artist record yet'}</span>
          </div>
          {matches.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {matches.map((artist) => (
                <button key={artist.id} type="button" className="btn-secondary btn-sm" onClick={() => selectArtist(artist)}>
                  {artist.name}
                </button>
              ))}
            </div>
          ) : null}
          {!exactMatch && artistName ? (
            <button type="button" className="btn-ghost btn-sm mt-2" onClick={() => setCreateOpen((value) => !value)}>
              <Icons.Plus />Create artist record
            </button>
          ) : null}
        </div>
      ) : null}
      {createOpen ? (
        <div className="mt-2 rounded-md border border-edge/70 bg-raised/70 px-3 py-3 space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="field"><span className="label">Aliases</span><input className="input" placeholder="Comma separated" value={draft.aliases} onChange={(e) => setDraft((prev) => ({ ...prev, aliases: e.target.value }))} /></label>
            <label className="field"><span className="label">Website / link</span><input className="input" value={draft.website_url} onChange={(e) => setDraft((prev) => ({ ...prev, website_url: e.target.value }))} /></label>
            <label className="field md:col-span-2"><span className="label">Artist notes</span><textarea className="textarea min-h-[72px]" value={draft.notes} onChange={(e) => setDraft((prev) => ({ ...prev, notes: e.target.value }))} /></label>
          </div>
          <div className="flex items-center justify-between gap-3">
            {error ? <p className="text-xs text-err">{error}</p> : <p className="text-xs text-ghost">Creates a reusable artist record for future artwork.</p>}
            <button type="button" className="btn-secondary btn-sm" onClick={createArtist} disabled={working}>
              {working ? <Spinner size={12} /> : <Icons.Check />}Create
            </button>
          </div>
        </div>
      ) : error ? <p className="mt-2 text-xs text-err">{error}</p> : null}
    </div>
  );
}

function CompactDetailRow({ label, children }) {
  if (!children) return null;
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 border-t border-edge/60 py-2 first:border-t-0">
      <p className="text-sm text-ghost">{label}</p>
      <div className="min-w-0 text-sm text-ink">{children}</div>
    </div>
  );
}

function formatDimensionValue(value, unit) {
  if (value === null || value === undefined || value === '') return null;
  return [value, unit].filter(Boolean).join(' ');
}

function formatPrintEdition(item) {
  const printNumber = item?.print_number;
  const printRun = item?.print_run;
  const hasPrintNumber = printNumber !== null && printNumber !== undefined && printNumber !== '';
  const hasPrintRun = printRun !== null && printRun !== undefined && printRun !== '';
  if (hasPrintNumber && hasPrintRun) return `#${printNumber}/${printRun}`;
  if (hasPrintNumber) return `#${printNumber}`;
  if (hasPrintRun) return `Run ${printRun}`;
  return null;
}

function ArtCard({ item, supportsHover, onOpen, onEdit, onDelete }) {
  const mediumLabel = ART_MEDIUM_OPTIONS.find((option) => option.value === item.medium)?.label || null;
  const printEdition = formatPrintEdition(item);
  const subtitle = [printEdition, item.signed ? 'Signed' : null, mediumLabel].filter(Boolean).join(' ');
  return (
    <ObjectPosterCard
      title={item.title}
      imagePath={item.image_path}
      fallbackIcon={<Icons.Library />}
      supportsHover={supportsHover}
      onOpen={() => onOpen(item)}
      subtitle={subtitle || 'Artwork'}
      onEdit={() => onEdit(item)}
      onDelete={() => onDelete(item.id)}
    />
  );
}

function ArtRow({ item, supportsHover, onOpen, onEdit, onDelete }) {
  const mediumLabel = ART_MEDIUM_OPTIONS.find((option) => option.value === item.medium)?.label || null;
  const printEdition = formatPrintEdition(item);
  return (
    <article className="group flex items-center gap-4 rounded-xl border border-edge bg-surface p-3 hover:border-muted hover:bg-raised transition-colors duration-150 animate-fade-in cursor-pointer" onClick={() => onOpen(item)}>
      <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-edge bg-raised text-ghost"><Icons.Activity /></div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ink truncate">{item.title}</p>
        <div className="mt-1 flex flex-wrap gap-2">
          <FilterPill>Art</FilterPill>
          {mediumLabel ? <FilterPill>{mediumLabel}</FilterPill> : null}
          {item.franchise ? <FilterPill>{item.franchise}</FilterPill> : null}
          {item.series ? <FilterPill>{item.series}</FilterPill> : null}
          {item.artist ? <FilterPill>{item.artist}</FilterPill> : null}
          {item.event_title ? <FilterPill>{item.event_title}</FilterPill> : null}
          {printEdition ? <FilterPill tone="brand">{`Print ${printEdition}`}</FilterPill> : null}
          {item.signed ? <FilterPill tone="brand">Signed</FilterPill> : null}
          {item.exclusive ? <FilterPill tone="brand">Exclusive</FilterPill> : null}
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

function ArtDetailDrawer({ artId, apiCall, events, onClose, onEdit, onDeleted, onViewArtistWorks }) {
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const row = await apiCall('get', `/art/${artId}`);
      setItem(row || null);
    } finally {
      setLoading(false);
    }
  }, [apiCall, artId]);

  useEffect(() => { load(); }, [load]);

  const deleteArt = async () => {
    if (!item?.id) return;
    if (!window.confirm('Delete this art piece?')) return;
    await apiCall('delete', `/art/${item.id}`);
    onDeleted?.();
    onClose();
  };

  const resolvedEvent = item?.event_title
    || events.find((evt) => String(evt.id) === String(item?.event_id))?.title
    || null;
  const showPurchaseContext = hasPurchaseContext(item);
  const mediumLabel = ART_MEDIUM_OPTIONS.find((option) => option.value === item?.medium)?.label || null;
  const artistRecord = item?.artist_record || null;
  const factSummary = [item?.franchise, item?.series, item?.artist, mediumLabel, resolvedEvent].filter(Boolean);
  const dimensionsSummary = [item?.height, item?.width].filter((value) => value !== null && value !== undefined && value !== '').length
    ? `${item?.height || '?'} × ${item?.width || '?'}${item?.dimension_unit ? ` ${item.dimension_unit}` : ''}`
    : null;
  const printEdition = formatPrintEdition(item);
  const statusSummary = [
    printEdition ? `Print ${printEdition}` : null,
    item?.signed ? 'Signed' : null,
    item?.framed ? 'Framed' : null,
    item?.exclusive ? 'Exclusive' : null
  ].filter(Boolean).join(' · ');
  const purchaseSummary = [
    item?.vendor || item?.booth_or_vendor || null,
    item?.booth ? `Booth ${item.booth}` : null,
    item?.price !== null && item?.price !== undefined && item?.price !== '' ? `$${item.price}` : null
  ].filter(Boolean).join(' · ');
  const primarySignature = item?.signatures?.find((signature) => signature.is_primary) || item?.signatures?.[0] || null;
  const signatureEventTitle = events.find((evt) => String(evt.id) === String(primarySignature?.signed_event_id || item?.signed_event_id))?.title || null;
  const signatureSummary = [
    primarySignature?.signer_name || item?.signer_name,
    primarySignature?.signer_role || item?.signer_role,
    primarySignature?.signed_on || item?.signed_on,
    primarySignature?.signed_at || item?.signed_at || signatureEventTitle
  ].filter(Boolean).join(' · ');
  const signatureRows = Array.isArray(item?.signatures) ? item.signatures : [];
  const formatSignatureLine = (signature) => {
    const eventTitle = events.find((evt) => String(evt.id) === String(signature?.signed_event_id))?.title || null;
    return [
      signature?.signer_name,
      signature?.signer_role,
      signature?.signed_on,
      signature?.signed_at || eventTitle
    ].filter(Boolean).join(' · ') || 'Signed copy';
  };

  return (
    <DetailDrawerShell onClose={onClose} testId="art-detail-drawer">
        <DrawerBackdrop imagePath={item?.image_path} className="h-32 sm:h-44 md:h-48" />
        <div className="flex items-start gap-3 px-4 pt-4 pb-3 shrink-0 sm:gap-4 sm:px-6 sm:pt-6 sm:pb-4">
          {item?.image_path ? (
            <div className="relative z-10 -mt-10 w-16 shrink-0 shadow-card sm:-mt-16 sm:w-20">
              <div className="poster rounded-md">
                <img src={posterUrl(item.image_path)} alt={item?.title || 'Art'} className="absolute inset-0 h-full w-full object-cover" />
              </div>
            </div>
          ) : null}
          <div className={cx('min-w-0 flex-1', item?.image_path ? 'mt-1' : '')}>
            <div className="flex items-baseline gap-2">
              <h2 className="text-xl font-semibold tracking-tight text-ink leading-tight sm:text-2xl">{item?.title || `Art #${artId}`}</h2>
              <p className="text-sm text-ghost">#{artId}</p>
            </div>
            <p className="mt-1 text-sm leading-6 text-dim">{factSummary.join(' · ')}</p>
          </div>
          <button onClick={onClose} className="btn-icon btn-sm shrink-0"><Icons.X /></button>
        </div>
        <div className="divider" />
        <div className="flex-1 overflow-y-auto scroll-area p-4 space-y-4 sm:p-6 sm:space-y-5">
          {loading ? <div className="flex items-center gap-2 text-dim"><Spinner size={16} />Loading…</div> : null}
          {!loading && item ? (
            <>
            <div className="md:hidden">
              <CompactDetailRow label="Dimensions">{dimensionsSummary}</CompactDetailRow>
              <CompactDetailRow label="Status">{statusSummary || 'Standard'}</CompactDetailRow>
              {showPurchaseContext ? <CompactDetailRow label="Purchase">{purchaseSummary || resolvedEvent || 'Linked event'}</CompactDetailRow> : null}
              {item.signed || primarySignature ? <CompactDetailRow label="Signature">{signatureSummary || 'Signed copy'}</CompactDetailRow> : null}
              {(primarySignature?.proof_path || item.signature_proof_path) ? (
                <CompactDetailRow label="Proof">
                  <a className="inline-flex items-center gap-2 text-dim transition-colors hover:text-ink" href={posterUrl(primarySignature?.proof_path || item.signature_proof_path)} target="_blank" rel="noreferrer"><Icons.Link />Open proof</a>
                </CompactDetailRow>
              ) : null}
              {signatureRows.length > 1 ? (
                <CompactDetailRow label="Signatures">
                  <div className="space-y-2">
                    {signatureRows.map((signature) => (
                      <div key={signature.id} className="border-t border-edge/60 pt-2 first:border-t-0 first:pt-0">
                        <p className="text-ink">{formatSignatureLine(signature)}</p>
                        {signature.notes ? <p className="mt-1 text-xs leading-5 text-ghost">{signature.notes}</p> : null}
                      </div>
                    ))}
                  </div>
                </CompactDetailRow>
              ) : null}
              {item.image_path ? (
                <CompactDetailRow label="Image">
                  <a className="inline-flex items-center gap-2 text-dim transition-colors hover:text-ink" href={item.image_path} target="_blank" rel="noreferrer"><Icons.Link />Open image</a>
                </CompactDetailRow>
              ) : null}
              {item.notes ? (
                <CompactDetailRow label="Notes">
                  <p className="leading-6 text-dim">{item.notes}</p>
                </CompactDetailRow>
              ) : null}
            </div>
            <div className="hidden grid-cols-1 gap-x-8 gap-y-5 text-sm md:grid md:grid-cols-2">
              <DetailField label="Series">{item.series}</DetailField>
              <DetailField label="Fandom / Franchise">{item.franchise}</DetailField>
              <DetailField label="Medium / Type">{mediumLabel}</DetailField>
              <DetailField label="Artist">
                <div className="space-y-2">
                  <p>{item.artist}</p>
                  {artistRecord ? (
                    <div className="rounded-md border border-edge/70 bg-surface/60 px-3 py-2 text-xs text-ghost">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        {artistRecord.website_url ? (
                          <a className="inline-flex items-center gap-2 text-dim transition-colors hover:text-ink" href={artistRecord.website_url} target="_blank" rel="noreferrer">
                            <Icons.Link />Website
                          </a>
                        ) : null}
                        <button type="button" className="btn-ghost btn-sm ml-auto" onClick={() => onViewArtistWorks?.(item)}>Other works</button>
                      </div>
                      {Array.isArray(artistRecord.aliases) && artistRecord.aliases.length ? <p className="mt-2">Aliases: {artistRecord.aliases.join(', ')}</p> : null}
                      {artistRecord.notes ? <p className="mt-1 leading-5">{artistRecord.notes}</p> : null}
                    </div>
                  ) : null}
                </div>
              </DetailField>
              <DetailField label="Height">{formatDimensionValue(item.height, item.dimension_unit)}</DetailField>
              <DetailField label="Width">{formatDimensionValue(item.width, item.dimension_unit)}</DetailField>
              <DetailField label="Print">{printEdition}</DetailField>
              <DetailField label="Framed">{item.framed ? 'Yes' : 'No'}</DetailField>
              <DetailField label="Event">{resolvedEvent || 'None linked'}</DetailField>
              <DetailField label="Signed">{item.signed ? 'Yes' : 'No'}</DetailField>
              {item.signed || primarySignature ? <DetailField label="Signature provenance">{signatureSummary || 'Signed copy'}</DetailField> : null}
              {signatureRows.length > 1 ? (
                <DetailField label="All signatures" className="md:col-span-2">
                  <div className="space-y-2">
                    {signatureRows.map((signature) => (
                      <div key={signature.id} className="border-t border-edge/70 pt-2 first:border-t-0 first:pt-0">
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-dim">{formatSignatureLine(signature)}</p>
                          {signature.is_primary ? <span className="badge badge-dim shrink-0">Primary</span> : null}
                        </div>
                        {signature.notes ? <p className="mt-1 text-xs text-ghost">{signature.notes}</p> : null}
                        {Array.isArray(signature.proofs) && signature.proofs.length ? (
                          <div className="mt-1 flex flex-wrap gap-2">
                            {signature.proofs.map((proof, index) => (
                              <a key={proof.id || `${signature.id}:proof:${index}`} className="inline-flex items-center gap-2 text-xs text-dim transition-colors hover:text-ink" href={posterUrl(proof.proof_path)} target="_blank" rel="noreferrer"><Icons.Link />{proof.label || proof.proof_type || (proof.is_primary ? 'Primary proof' : `Proof ${index + 1}`)}</a>
                            ))}
                          </div>
                        ) : signature.proof_path ? (
                          <a className="mt-1 inline-flex items-center gap-2 text-xs text-dim transition-colors hover:text-ink" href={posterUrl(signature.proof_path)} target="_blank" rel="noreferrer"><Icons.Link />Open proof</a>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </DetailField>
              ) : null}
              {(primarySignature?.notes || item.signature_notes) ? (
                <DetailField label="Signature notes" className="md:col-span-2">
                  <p className="max-w-3xl text-dim leading-7">{primarySignature?.notes || item.signature_notes}</p>
                </DetailField>
              ) : null}
              {(primarySignature?.proof_path || item.signature_proof_path) ? (
                <DetailField label="Signature proof">
                  <a className="inline-flex items-center gap-2 text-dim transition-colors hover:text-ink" href={posterUrl(primarySignature?.proof_path || item.signature_proof_path)} target="_blank" rel="noreferrer"><Icons.Link />Open proof</a>
                </DetailField>
              ) : null}
              <DetailField label="Exclusive">{item.exclusive ? 'Yes' : 'No'}</DetailField>
              {showPurchaseContext ? <DetailField label="Vendor">{item.vendor || item.booth_or_vendor}</DetailField> : null}
              {showPurchaseContext ? <DetailField label="Booth">{item.booth}</DetailField> : null}
              <DetailField label="Price">{item.price !== null && item.price !== undefined && item.price !== '' ? `$${item.price}` : null}</DetailField>
              {item.image_path ? (
                <DetailField label="Image">
                  <a className="inline-flex items-center gap-2 text-dim transition-colors hover:text-ink" href={item.image_path} target="_blank" rel="noreferrer"><Icons.Link />Open image</a>
                </DetailField>
              ) : null}
              {item.notes ? (
                <DetailField label="Notes" className="md:col-span-2">
                  <p className="max-w-3xl text-dim leading-7">{item.notes}</p>
                </DetailField>
              ) : null}
            </div>
            </>
          ) : null}
        </div>
        <div className="p-4 border-t border-edge flex gap-3 shrink-0">
          <button onClick={onClose} className="btn-ghost">Close</button>
          <button onClick={() => onEdit(item)} className="btn-ghost flex-1" disabled={!item}><Icons.Edit />Edit</button>
          <button onClick={deleteArt} className="btn-ghost text-err hover:bg-err/10" disabled={!item}><Icons.Trash />Delete</button>
        </div>
    </DetailDrawerShell>
  );
}

function ArtDrawer({ initial, events, saving, error, notice, apiCall, onClose, onSave, onDelete, onClearImage, onUploadSignatureProof, onRemoveSignatureProof, onSignatureChange }) {
  const primaryInitialSignature = initial?.signatures?.find((signature) => signature.is_primary) || initial?.signatures?.[0] || null;
  const [form, setForm] = useState(() => ({
    ...DEFAULT_FORM,
    ...(initial || {}),
    event_id: initial?.event_id ? String(initial.event_id) : '',
    signer_name: primaryInitialSignature?.signer_name || initial?.signer_name || '',
    signer_role: primaryInitialSignature?.signer_role || initial?.signer_role || '',
    signed_on: primaryInitialSignature?.signed_on || initial?.signed_on || '',
    signed_at: primaryInitialSignature?.signed_at || initial?.signed_at || '',
    signed_event_id: primaryInitialSignature?.signed_event_id ? String(primaryInitialSignature.signed_event_id) : (initial?.signed_event_id ? String(initial.signed_event_id) : ''),
    signature_proof_path: primaryInitialSignature?.proof_path || initial?.signature_proof_path || '',
    signature_notes: primaryInitialSignature?.notes || initial?.signature_notes || '',
    height: initial?.height ?? '',
    width: initial?.width ?? '',
    dimension_unit: initial?.dimension_unit || 'in',
    framed: Boolean(initial?.framed),
    print_number: initial?.print_number ?? '',
    print_run: initial?.print_run ?? '',
    artist_id: initial?.artist_id ? String(initial.artist_id) : '',
    artist_role: initial?.artist_role || 'Artist',
    artist_record: initial?.artist_record || null,
    vendor: initial?.vendor || '',
    booth: initial?.booth || ''
  }));
  const [imageFile, setImageFile] = useState(null);
  const [proofFile, setProofFile] = useState(null);
  const [proofWorking, setProofWorking] = useState(false);
  const tabs = useMemo(() => ([
    { id: 'core', label: 'Core Details' },
    { id: 'signatures', label: 'Signatures' },
    { id: 'notes', label: 'Image & Notes' }
  ]), []);
  const [activeTab, setActiveTab] = useState('core');

  useEffect(() => {
    setForm({
      ...DEFAULT_FORM,
      ...(initial || {}),
      event_id: initial?.event_id ? String(initial.event_id) : '',
      signer_name: primaryInitialSignature?.signer_name || initial?.signer_name || '',
      signer_role: primaryInitialSignature?.signer_role || initial?.signer_role || '',
      signed_on: primaryInitialSignature?.signed_on || initial?.signed_on || '',
      signed_at: primaryInitialSignature?.signed_at || initial?.signed_at || '',
      signed_event_id: primaryInitialSignature?.signed_event_id ? String(primaryInitialSignature.signed_event_id) : (initial?.signed_event_id ? String(initial.signed_event_id) : ''),
      signature_proof_path: primaryInitialSignature?.proof_path || initial?.signature_proof_path || '',
      signature_notes: primaryInitialSignature?.notes || initial?.signature_notes || '',
      height: initial?.height ?? '',
      width: initial?.width ?? '',
      dimension_unit: initial?.dimension_unit || 'in',
      framed: Boolean(initial?.framed),
      print_number: initial?.print_number ?? '',
      print_run: initial?.print_run ?? '',
      artist_id: initial?.artist_id ? String(initial.artist_id) : '',
      artist_role: initial?.artist_role || 'Artist',
      artist_record: initial?.artist_record || null,
      vendor: initial?.vendor || '',
      booth: initial?.booth || ''
    });
    setImageFile(null);
    setProofFile(null);
    setProofWorking(false);
    setActiveTab('core');
  }, [initial, primaryInitialSignature]);

  const showPurchaseContext = hasPurchaseContext(form);
  const submit = () => onSave(form, imageFile, proofFile);
  const currentProofPath = form.signature_proof_path || '';

  const uploadSignatureProof = async () => {
    if (!initial?.id || !proofFile || !onUploadSignatureProof) return;
    setProofWorking(true);
    try {
      const updated = await onUploadSignatureProof(initial.id, proofFile);
      const nextPath = updated?.signature_proof_path || updated?.proof_path || '';
      setForm((prev) => ({ ...prev, signed: true, signature_proof_path: nextPath }));
      setProofFile(null);
    } finally {
      setProofWorking(false);
    }
  };

  const removeSignatureProof = async () => {
    if (!initial?.id || !currentProofPath || !onRemoveSignatureProof) return;
    setProofWorking(true);
    try {
      await onRemoveSignatureProof(initial.id);
      setForm((prev) => ({ ...prev, signature_proof_path: '' }));
      setProofFile(null);
    } finally {
      setProofWorking(false);
    }
  };

  const applySignatureChange = ({ owner, signatures }) => {
    const nextSignatures = Array.isArray(signatures) ? signatures : (owner?.signatures || []);
    const nextPrimary = nextSignatures.find((signature) => signature.is_primary) || nextSignatures[0] || null;
    setForm((prev) => ({
      ...prev,
      ...(owner || {}),
      event_id: owner?.event_id ? String(owner.event_id) : prev.event_id,
      signed: Boolean(owner?.signed || nextSignatures.length),
      signatures: nextSignatures,
      signer_name: nextPrimary?.signer_name || owner?.signer_name || '',
      signer_role: nextPrimary?.signer_role || owner?.signer_role || '',
      signed_on: nextPrimary?.signed_on || owner?.signed_on || '',
      signed_at: nextPrimary?.signed_at || owner?.signed_at || '',
      signed_event_id: nextPrimary?.signed_event_id ? String(nextPrimary.signed_event_id) : (owner?.signed_event_id ? String(owner.signed_event_id) : ''),
      signature_proof_path: nextPrimary?.proof_path || owner?.signature_proof_path || '',
      signature_notes: nextPrimary?.notes || owner?.signature_notes || ''
    }));
    onSignatureChange?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-void/72" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-[40rem] h-full bg-abyss border-l border-edge flex flex-col animate-slide-in">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-edge shrink-0">
          <h2 className="section-title !text-xl">{initial?.id ? 'Edit Art' : 'Add Art'}</h2>
          <div className="flex-1" />
          {initial?.id ? <p className="text-sm text-ghost">#{initial.id}</p> : null}
          <button onClick={onClose} className="btn-icon btn-sm shrink-0"><Icons.X /></button>
        </div>
        <div className="flex-1 overflow-y-auto scroll-area p-6 space-y-4">
          {error ? <p className="text-xs text-err">{error}</p> : null}
          {notice ? <p className="text-xs text-ok">{notice}</p> : null}
          <SectionTabs
            tabs={tabs}
            activeId={activeTab}
            onChange={setActiveTab}
            showIndex
            stretch
            ariaLabel="Art editor steps"
            idBase="art-editor-steps"
          />
          <div className="space-y-4 border-t border-edge/60 pt-3">
            <SectionTabPanel activeId={activeTab} tabKey="core" idBase="art-editor-steps">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <CoverImagePicker
                  className="md:col-span-2 max-w-[8.5rem]"
                  label="Artwork image"
                  imagePath={form.image_path || ''}
                  selectedFile={imageFile}
                  emptyLabel="Add image"
                  replaceLabel="Replace image"
                  onSelectFile={setImageFile}
                  onRemove={initial?.id ? onClearImage : undefined}
                />
                <label className="field"><span className="label">Title *</span><input className="input" value={form.title || ''} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} /></label>
                <label className="field"><span className="label">Series</span><input className="input" value={form.series || ''} onChange={(e) => setForm((p) => ({ ...p, series: e.target.value }))} /></label>
                <label className="field"><span className="label">Fandom / Franchise</span><input className="input" value={form.franchise || ''} onChange={(e) => setForm((p) => ({ ...p, franchise: e.target.value }))} /></label>
                <label className="field"><span className="label">Medium / Type</span>
                  <select className="select" value={form.medium || ''} onChange={(e) => setForm((p) => ({ ...p, medium: e.target.value }))}>
                    <option value="">None</option>
                    {ART_MEDIUM_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <ArtistRecordPicker apiCall={apiCall} form={form} setForm={setForm} />
                <label className="field"><span className="label">Price</span><input className="input" value={form.price ?? ''} onChange={(e) => setForm((p) => ({ ...p, price: e.target.value }))} /></label>
                <label className="field"><span className="label">Height</span><input className="input" type="number" min="0" step="0.01" value={form.height ?? ''} onChange={(e) => setForm((p) => ({ ...p, height: e.target.value }))} /></label>
                <label className="field"><span className="label">Width</span><input className="input" type="number" min="0" step="0.01" value={form.width ?? ''} onChange={(e) => setForm((p) => ({ ...p, width: e.target.value }))} /></label>
                <label className="field"><span className="label">Print #</span><input className="input" type="number" min="1" step="1" value={form.print_number ?? ''} onChange={(e) => setForm((p) => ({ ...p, print_number: e.target.value }))} /></label>
                <label className="field"><span className="label">Run</span><input className="input" type="number" min="1" step="1" value={form.print_run ?? ''} onChange={(e) => setForm((p) => ({ ...p, print_run: e.target.value }))} /></label>
                <label className="field"><span className="label">Unit</span>
                  <select className="select" value={form.dimension_unit || 'in'} onChange={(e) => setForm((p) => ({ ...p, dimension_unit: e.target.value }))}>
                    {ART_DIMENSION_UNIT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className="field md:col-span-2"><span className="label">Linked Event</span>
                  <select className="select" value={form.event_id || ''} onChange={(e) => setForm((p) => ({ ...p, event_id: e.target.value }))}>
                    <option value="">None</option>
                    {events.map((evt) => <option key={evt.id} value={String(evt.id)}>{evt.title}</option>)}
                  </select>
                </label>
                {showPurchaseContext ? (
                  <>
                    <label className="field"><span className="label">Vendor</span><input className="input" value={form.vendor || ''} onChange={(e) => setForm((p) => ({ ...p, vendor: e.target.value }))} /></label>
                    <label className="field"><span className="label">Booth</span><input className="input" value={form.booth || ''} onChange={(e) => setForm((p) => ({ ...p, booth: e.target.value }))} /></label>
                  </>
                ) : null}
                <div className="md:col-span-2 flex flex-wrap items-center gap-x-6 gap-y-1 pt-1">
                  <CheckboxControl id="art-framed" checked={Boolean(form.framed)} onChange={(e) => setForm((p) => ({ ...p, framed: e.target.checked }))}>Framed</CheckboxControl>
                  <CheckboxControl id="art-exclusive" checked={Boolean(form.exclusive)} onChange={(e) => setForm((p) => ({ ...p, exclusive: e.target.checked }))}>Exclusive item</CheckboxControl>
                  <CheckboxControl id="art-signed" checked={Boolean(form.signed)} onChange={(e) => setForm((p) => ({ ...p, signed: e.target.checked }))}>Signed</CheckboxControl>
                </div>
              </div>
            </SectionTabPanel>
            <SectionTabPanel activeId={activeTab} tabKey="signatures" idBase="art-editor-steps">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="md:col-span-2">
                  <CheckboxControl id="art-signature-signed" checked={Boolean(form.signed)} onChange={(e) => setForm((p) => ({ ...p, signed: e.target.checked }))}>This piece is signed</CheckboxControl>
                </div>
                <label className="field"><span className="label">Signer</span><input className="input" value={form.signer_name || ''} onChange={(e) => setForm((p) => ({ ...p, signer_name: e.target.value, signed: Boolean(e.target.value.trim()) || p.signed }))} /></label>
                <label className="field"><span className="label">Signer role</span><input className="input" placeholder="Artist, writer, voice actor…" value={form.signer_role || ''} onChange={(e) => setForm((p) => ({ ...p, signer_role: e.target.value }))} /></label>
                <label className="field"><span className="label">Signed on</span><input className="input" type="date" value={form.signed_on || ''} onChange={(e) => setForm((p) => ({ ...p, signed_on: e.target.value }))} /></label>
                <label className="field"><span className="label">Signed at</span><input className="input" placeholder="Convention, gallery, signing table…" value={form.signed_at || ''} onChange={(e) => setForm((p) => ({ ...p, signed_at: e.target.value }))} /></label>
                <label className="field"><span className="label">Signing event</span>
                  <select className="select" value={form.signed_event_id || ''} onChange={(e) => setForm((p) => ({ ...p, signed_event_id: e.target.value }))}>
                    <option value="">None</option>
                    {events.map((evt) => <option key={evt.id} value={String(evt.id)}>{evt.title}</option>)}
                  </select>
                </label>
                <label className="field"><span className="label">Primary proof URL</span><input className="input" value={form.signature_proof_path || ''} onChange={(e) => setForm((p) => ({ ...p, signature_proof_path: e.target.value }))} /></label>
                <p className="md:col-span-2 text-xs leading-5 text-ghost">Proof file upload and removal live on each signature record below, so Art and media use the same evidence workflow.</p>
                <label className="field md:col-span-2"><span className="label">Signature notes</span><textarea className="textarea min-h-[80px]" value={form.signature_notes || ''} onChange={(e) => setForm((p) => ({ ...p, signature_notes: e.target.value }))} /></label>
                <SignatureManager
                  apiCall={apiCall}
                  endpointBase={initial?.id ? `/art/${initial.id}` : ''}
                  events={events}
                  ownerId={initial?.id}
                  ownerLabel="art piece"
                  signatures={form.signatures || []}
                  onChange={applySignatureChange}
                />
              </div>
            </SectionTabPanel>
            <SectionTabPanel activeId={activeTab} tabKey="notes" idBase="art-editor-steps">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="field md:col-span-2"><span className="label">Image URL (optional)</span><input className="input" value={form.image_path || ''} onChange={(e) => setForm((p) => ({ ...p, image_path: e.target.value }))} /></label>
                <label className="field md:col-span-2"><span className="label">Notes</span><textarea className="textarea min-h-[90px]" value={form.notes || ''} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} /></label>
              </div>
            </SectionTabPanel>
          </div>
        </div>
        <div className="p-4 border-t border-edge flex gap-3 shrink-0">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          {initial?.id ? <button onClick={onDelete} className="btn-danger"><Icons.Trash />Delete</button> : null}
          <div className="flex-1" />
          <button onClick={submit} disabled={saving} className="btn-primary min-w-[120px]">
            {saving ? <><Spinner size={14} />Saving…</> : <><Icons.Check />Save</>}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ArtView({ apiCall, onToast, focusTarget = null }) {
  const api = useCallback((method, path, data, config = {}) => (
    apiCall(method, path, data, { timeout: 15000, ...config })
  ), [apiCall]);

  const [items, setItems] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [headerCompact, setHeaderCompact] = useState(false);
  const [sortDir, setSortDir] = useState('asc');
  const [viewMode, setViewMode] = useState('cards');
  const [eventFilter, setEventFilter] = useState('');
  const [exclusiveFilter, setExclusiveFilter] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1, hasMore: false });
  const [editing, setEditing] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [adding, setAdding] = useState(false);
  const filterMenuRef = useRef(null);
  const handleContentScroll = useCallback((event) => {
    const nextCompact = event.currentTarget.scrollTop > 24;
    setHeaderCompact((current) => (current === nextCompact ? current : nextCompact));
  }, []);

  const supportsHover = useMemo(() => window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches, []);
  const activeFilterCount = useMemo(
    () => [search.trim(), eventFilter, exclusiveFilter].filter(Boolean).length,
    [eventFilter, exclusiveFilter, search]
  );

  const loadEvents = useCallback(async () => {
    try {
      const payload = await api('get', '/events?page=1&limit=200');
      setEvents(Array.isArray(payload?.items) ? payload.items : []);
    } catch (_) {
      setEvents([]);
    }
  }, [api]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(pageSize));
      params.set('sort_dir', sortDir);
      if (search.trim()) params.set('q', search.trim());
      if (eventFilter) params.set('event_id', eventFilter);
      if (exclusiveFilter) params.set('exclusive', exclusiveFilter);
      const payload = await api('get', `/art?${params.toString()}`);
      setItems(Array.isArray(payload?.items) ? payload.items : []);
      setPagination(payload?.pagination || { page, limit: pageSize, total: 0, totalPages: 1, hasMore: false });
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load art');
    } finally {
      setLoading(false);
    }
  }, [api, eventFilter, exclusiveFilter, page, pageSize, search, sortDir]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadEvents(); }, [loadEvents]);
  useEffect(() => {
    if (focusTarget?.entityType !== 'art' || !focusTarget?.entityId) return;
    setDetailId(Number(focusTarget.entityId));
  }, [focusTarget?.createdAt, focusTarget?.entityId, focusTarget?.entityType]);
  useEffect(() => {
    const onPointerDown = (event) => {
      if (!filterMenuRef.current) return;
      if (filterMenuRef.current.contains(event.target)) return;
      setFilterOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const closeDrawer = () => {
    setAdding(false);
    setEditing(null);
    setDetailId(null);
    setError('');
    setNotice('');
  };

  const uploadSignatureProof = async (id, proofFile) => {
    if (!id || !proofFile) return null;
    const formData = new FormData();
    formData.append('proof', proofFile);
    const updated = await api('post', `/art/${id}/upload-signature-proof`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
    onToast?.('Signature proof uploaded');
    return updated;
  };

  const removeSignatureProof = async (id) => {
    if (!id) return null;
    const updated = await api('delete', `/art/${id}/signature-proof`);
    onToast?.('Signature proof removed');
    return updated;
  };

  const saveArt = async (form, imageFile, proofFile) => {
    if (!String(form.title || '').trim()) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const payload = {
        title: String(form.title || '').trim(),
        series: form.series || null,
        franchise: form.franchise || null,
        medium: form.medium || null,
        height: form.height === '' ? null : Number(form.height),
        width: form.width === '' ? null : Number(form.width),
        dimension_unit: form.height === '' && form.width === '' ? null : (form.dimension_unit || 'in'),
        framed: Boolean(form.framed),
        print_number: form.print_number === '' ? null : Number(form.print_number),
        print_run: form.print_run === '' ? null : Number(form.print_run),
        subtype: 'art',
        event_id: form.event_id ? Number(form.event_id) : null,
        artist_id: form.artist_id ? Number(form.artist_id) : null,
        artist_role: form.artist_role || null,
        artist: form.artist || null,
        vendor: form.vendor || null,
        booth: form.booth || null,
        price: form.price === '' ? null : Number(form.price),
        exclusive: Boolean(form.exclusive),
        signed: Boolean(form.signed),
        signer_name: form.signer_name || null,
        signer_role: form.signer_role || null,
        signed_on: form.signed_on || null,
        signed_at: form.signed_at || null,
        signed_event_id: form.signed_event_id ? Number(form.signed_event_id) : null,
        signature_proof_path: form.signature_proof_path || null,
        signature_notes: form.signature_notes || null,
        image_path: form.image_path || null,
        notes: form.notes || null
      };
      let id = editing?.id;
      if (editing?.id) {
        await api('patch', `/art/${editing.id}`, payload);
      } else {
        const created = await api('post', '/art', payload);
        id = created?.id;
      }
      if (imageFile && id) {
        try {
          const formData = new FormData();
          formData.append('image', imageFile);
          await api('post', `/art/${id}/upload-image`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
        } catch (uploadErr) {
          setError(parseUploadError(uploadErr?.response?.data?.error || uploadErr?.message));
        }
      }
      if (proofFile && id) {
        try {
          await uploadSignatureProof(id, proofFile);
        } catch (uploadErr) {
          setError(parseUploadError(uploadErr?.response?.data?.error || uploadErr?.message));
        }
      }
      onToast?.(editing?.id ? 'Art saved' : 'Art created');
      setNotice(editing?.id ? 'Art saved' : 'Art created');
      setAdding(false);
      setEditing(null);
      await load();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to save art piece');
    } finally {
      setSaving(false);
    }
  };

  const deleteArt = async (id) => {
    if (!window.confirm('Delete this art piece?')) return;
    await api('delete', `/art/${id}`);
    onToast?.('Art deleted');
    await load();
    if (editing?.id === id) closeDrawer();
    if (detailId === id) setDetailId(null);
  };

  const clearImage = async () => {
    if (!editing?.id) return;
    await api('delete', `/art/${editing.id}/image`);
    onToast?.('Image removed');
    const refreshed = await api('get', `/art/${editing.id}`);
    setEditing(refreshed);
    await load();
  };

  const viewArtistWorks = (item) => {
    const artistName = item?.artist_record?.name || item?.artist || '';
    if (!artistName) return;
    setSearch(artistName);
    setPage(1);
    setDetailId(null);
  };

  const uploadSignatureProofFromDrawer = async (id, proofFile) => {
    const updated = await uploadSignatureProof(id, proofFile);
    const refreshed = await api('get', `/art/${id}`);
    setEditing(refreshed);
    await load();
    return updated;
  };

  const removeSignatureProofFromDrawer = async (id) => {
    const updated = await removeSignatureProof(id);
    const refreshed = await api('get', `/art/${id}`);
    setEditing(refreshed);
    await load();
    return updated;
  };

  return (
    <div className="flex flex-col h-full">
      <PageHeaderSearchToolbar
        title="Art"
        total={pagination.total || items.length}
        description="Track original art, prints, and sketch commissions as their own library while keeping event purchase context attached."
        searchValue={search}
        onSearchChange={(value) => { setSearch(value); setPage(1); }}
        filters={(
          <div className="relative" ref={filterMenuRef}>
            <button className="btn-secondary" onClick={() => setFilterOpen((v) => !v)}>Filter<Icons.ChevronDown /></button>
            {filterOpen ? (
              <div className="absolute right-0 z-20 mt-2 w-80 space-y-3 rounded-lg border border-edge bg-raised p-3 shadow-lg">
                <div>
                  <p className="mb-2 text-xs text-ghost">Events</p>
                  <select className="select w-full" value={eventFilter} onChange={(e) => { setEventFilter(e.target.value); setPage(1); }}>
                    <option value="">All events</option>
                    {events.map((evt) => <option key={evt.id} value={String(evt.id)}>{evt.title}</option>)}
                  </select>
                </div>
                <div>
                  <p className="mb-2 text-xs text-ghost">Exclusives</p>
                  <div className="flex gap-2">
                    <button className={cx('btn-ghost btn-sm', exclusiveFilter === '' && 'bg-brand/20 text-brand')} onClick={() => { setExclusiveFilter(''); setPage(1); }}>All</button>
                    <button className={cx('btn-ghost btn-sm', exclusiveFilter === 'true' && 'bg-brand/20 text-brand')} onClick={() => { setExclusiveFilter('true'); setPage(1); }}>Exclusive</button>
                    <button className={cx('btn-ghost btn-sm', exclusiveFilter === 'false' && 'bg-brand/20 text-brand')} onClick={() => { setExclusiveFilter('false'); setPage(1); }}>Non-exclusive</button>
                  </div>
                </div>
                <div className="flex justify-end border-t border-edge pt-1">
                  <button className="btn-ghost btn-sm" onClick={() => { setEventFilter(''); setExclusiveFilter(''); setPage(1); }}>Clear filters</button>
                </div>
              </div>
            ) : null}
          </div>
        )}
        filterCount={activeFilterCount}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        viewAriaLabel="Art view mode"
        sortDirection={sortDir}
        onToggleSort={() => { setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); setPage(1); }}
        onAdd={() => setAdding(true)}
        addLabel="Add Art"
        addAriaLabel="Add Art"
        Icons={Icons}
        compact={headerCompact}
        testId="art-mobile-header"
        toolbarTestId="art-mobile-toolbar"
      />
      {activeFilterCount > 0 ? (
        <div className="shrink-0 border-b border-edge bg-void/95 px-3 py-2 sm:px-6">
        {activeFilterCount > 0 ? (
          <div className="flex flex-wrap gap-2">
            {search.trim() ? <FilterPill>{`Search: ${search.trim()}`}</FilterPill> : null}
            {eventFilter ? <FilterPill>{`Event: ${events.find((evt) => String(evt.id) === String(eventFilter))?.title || eventFilter}`}</FilterPill> : null}
            {exclusiveFilter ? <FilterPill>{exclusiveFilter === 'true' ? 'Exclusive only' : 'Non-exclusive only'}</FilterPill> : null}
            <button className="btn-ghost btn-sm" onClick={() => { setEventFilter(''); setExclusiveFilter(''); setSearch(''); setPage(1); }}>Clear filters</button>
          </div>
        ) : null}
      </div>
      ) : null}
      <div className="flex-1 overflow-y-auto scroll-area p-6" onScroll={handleContentScroll}>
        {error ? <p className="text-sm text-err mb-3">{error}</p> : null}
        {loading ? <div className="flex items-center justify-center py-20"><Spinner size={32} /></div> : null}
        {!loading && items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-edge bg-surface px-5 py-8 text-sm text-ghost">
            No art found yet. Add commissions, prints, and original pieces here so artist, series, and event purchase history stay together.
          </div>
        ) : null}
        {!loading && viewMode === 'cards' && items.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {items.map((item) => (
              <ArtCard key={item.id} item={item} supportsHover={supportsHover} onOpen={(row) => setDetailId(row.id)} onEdit={setEditing} onDelete={deleteArt} />
            ))}
          </div>
        ) : null}
        {!loading && viewMode === 'list' && items.length > 0 ? (
          <div className="space-y-2">
            {items.map((item) => (
              <ArtRow key={item.id} item={item} supportsHover={supportsHover} onOpen={(row) => setDetailId(row.id)} onEdit={setEditing} onDelete={deleteArt} />
            ))}
          </div>
        ) : null}
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
      {(adding || editing) ? (
        <ArtDrawer
          initial={editing}
          events={events}
          saving={saving}
          error={error}
          notice={notice}
          apiCall={api}
          onClose={closeDrawer}
          onSave={saveArt}
          onDelete={editing?.id ? () => deleteArt(editing.id) : null}
          onClearImage={clearImage}
          onUploadSignatureProof={uploadSignatureProofFromDrawer}
          onRemoveSignatureProof={removeSignatureProofFromDrawer}
          onSignatureChange={load}
        />
      ) : null}
      {detailId ? (
        <ArtDetailDrawer
          artId={detailId}
          apiCall={api}
          events={events}
          onClose={() => setDetailId(null)}
          onEdit={(item) => { setDetailId(null); setEditing(item); }}
          onDeleted={load}
          onViewArtistWorks={viewArtistWorks}
        />
      ) : null}
    </div>
  );
}
