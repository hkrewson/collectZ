import React, { useMemo, useState } from 'react';
import { Icons, ImageSourceControl, Spinner, cx, posterUrl } from './AppPrimitives';

const EMPTY_SIGNATURE = {
  signer_name: '',
  signer_role: '',
  signed_on: '',
  signed_at: '',
  signed_event_id: '',
  proof_path: '',
  notes: ''
};

const EMPTY_PROOF_METADATA = {
  proof_type: '',
  label: '',
  notes: ''
};

const PROOF_TYPE_OPTIONS = [
  ['photo', 'Photo'],
  ['coa', 'Certificate'],
  ['receipt', 'Receipt'],
  ['event', 'Event record'],
  ['artist_post', 'Artist post'],
  ['other', 'Other']
];

function normalizeDate(value) {
  if (!value) return '';
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function normalizeSignature(signature = {}) {
  return {
    signer_name: signature.signer_name || '',
    signer_role: signature.signer_role || '',
    signed_on: normalizeDate(signature.signed_on),
    signed_at: signature.signed_at || '',
    signed_event_id: signature.signed_event_id ? String(signature.signed_event_id) : '',
    proof_path: signature.proof_path || signature.signed_proof_path || '',
    notes: signature.notes || signature.signature_notes || ''
  };
}

function signaturePayload(form = {}) {
  return {
    signer_name: String(form.signer_name || '').trim() || null,
    signer_role: String(form.signer_role || '').trim() || null,
    signed_on: normalizeDate(form.signed_on) || null,
    signed_at: String(form.signed_at || '').trim() || null,
    signed_event_id: form.signed_event_id ? Number(form.signed_event_id) : null,
    proof_path: String(form.proof_path || '').trim() || null,
    notes: String(form.notes || '').trim() || null
  };
}

function signatureLine(signature, events = []) {
  const eventTitle = events.find((evt) => String(evt.id) === String(signature?.signed_event_id))?.title || null;
  return [
    signature?.signer_name,
    signature?.signer_role,
    signature?.signed_on ? normalizeDate(signature.signed_on) : null,
    signature?.signed_at || eventTitle
  ].filter(Boolean).join(' · ') || 'Signed copy';
}

function normalizeProofMetadata(proof = {}) {
  return {
    proof_type: proof.proof_type || '',
    label: proof.label || '',
    notes: proof.notes || ''
  };
}

function proofMetadataPayload(form = {}) {
  return {
    proof_type: String(form.proof_type || '').trim() || null,
    label: String(form.label || '').trim() || null,
    notes: String(form.notes || '').trim() || null
  };
}

function proofTitle(proof, index) {
  if (proof?.label) return proof.label;
  if (proof?.proof_type) {
    const option = PROOF_TYPE_OPTIONS.find(([value]) => value === proof.proof_type);
    return option?.[1] || proof.proof_type;
  }
  return proof?.is_primary ? 'Primary proof' : `Proof ${index + 1}`;
}

function ProofMetadataFields({ draft, idPrefix, onChange }) {
  const set = (patch) => onChange({ ...draft, ...patch });
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
      <label className="field">
        <span className="label">Evidence type</span>
        <select id={`${idPrefix}-type`} className="select" value={draft.proof_type || ''} onChange={(e) => set({ proof_type: e.target.value })}>
          <option value="">Unspecified</option>
          {PROOF_TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="field">
        <span className="label">Label</span>
        <input id={`${idPrefix}-label`} className="input" placeholder="COA, booth photo…" value={draft.label || ''} onChange={(e) => set({ label: e.target.value })} />
      </label>
      <label className="field md:col-span-2">
        <span className="label">Evidence notes</span>
        <textarea id={`${idPrefix}-notes`} className="textarea min-h-[56px]" value={draft.notes || ''} onChange={(e) => set({ notes: e.target.value })} />
      </label>
    </div>
  );
}

function SignatureFields({ draft, events, idPrefix, onChange }) {
  const set = (patch) => onChange({ ...draft, ...patch });
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <label className="field">
        <span className="label">Signer</span>
        <input id={`${idPrefix}-signer`} className="input" value={draft.signer_name || ''} onChange={(e) => set({ signer_name: e.target.value })} />
      </label>
      <label className="field">
        <span className="label">Signer role</span>
        <input id={`${idPrefix}-role`} className="input" placeholder="Artist, writer, cast…" value={draft.signer_role || ''} onChange={(e) => set({ signer_role: e.target.value })} />
      </label>
      <label className="field">
        <span className="label">Signed on</span>
        <input id={`${idPrefix}-date`} className="input" type="date" value={draft.signed_on || ''} onChange={(e) => set({ signed_on: e.target.value })} />
      </label>
      {events?.length ? (
        <label className="field">
          <span className="label">Signing event</span>
          <select id={`${idPrefix}-event`} className="select" value={draft.signed_event_id || ''} onChange={(e) => set({ signed_event_id: e.target.value })}>
            <option value="">None</option>
            {events.map((evt) => <option key={evt.id} value={String(evt.id)}>{evt.title}</option>)}
          </select>
        </label>
      ) : null}
      <label className={cx('field', events?.length ? 'md:col-span-2' : '')}>
        <span className="label">Signed at</span>
        <input id={`${idPrefix}-location`} className="input" placeholder="Booth, gallery, convention…" value={draft.signed_at || ''} onChange={(e) => set({ signed_at: e.target.value })} />
      </label>
      <label className="field md:col-span-2">
        <span className="label">Proof image URL</span>
        <input id={`${idPrefix}-proof`} className="input" value={draft.proof_path || ''} onChange={(e) => set({ proof_path: e.target.value })} />
      </label>
      <label className="field md:col-span-2">
        <span className="label">Notes</span>
        <textarea id={`${idPrefix}-notes`} className="textarea min-h-[72px]" value={draft.notes || ''} onChange={(e) => set({ notes: e.target.value })} />
      </label>
    </div>
  );
}

export default function SignatureManager({
  apiCall,
  endpointBase,
  events = [],
  ownerId,
  ownerLabel = 'item',
  signatures = [],
  onChange
}) {
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState(EMPTY_SIGNATURE);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(EMPTY_SIGNATURE);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [proofFiles, setProofFiles] = useState({});
  const [proofMetadata, setProofMetadata] = useState({});
  const [editingProofId, setEditingProofId] = useState(null);
  const [proofEditDraft, setProofEditDraft] = useState(EMPTY_PROOF_METADATA);

  const rows = useMemo(() => (
    [...(Array.isArray(signatures) ? signatures : [])]
      .filter((signature) => !signature.archived_at)
      .sort((a, b) => {
        if (a.is_primary && !b.is_primary) return -1;
        if (!a.is_primary && b.is_primary) return 1;
        return Number(a.id || 0) - Number(b.id || 0);
      })
  ), [signatures]);

  const applyMutation = (payload) => {
    const nextSignatures = payload?.signatures || payload?.art?.signatures || payload?.media?.signatures || [];
    onChange?.({
      owner: payload?.art || payload?.media || null,
      signature: payload?.signature || null,
      signatures: nextSignatures,
      response: payload
    });
  };

  const run = async (label, action) => {
    setBusy(label);
    setError('');
    try {
      const result = await action();
      applyMutation(result);
      return result;
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Signature update failed');
      return null;
    } finally {
      setBusy('');
    }
  };

  const addSignature = async () => {
    if (!ownerId || !endpointBase) return;
    const result = await run('add', () => apiCall('post', `${endpointBase}/signatures`, signaturePayload(addDraft)));
    if (result) {
      setAddDraft(EMPTY_SIGNATURE);
      setAdding(false);
    }
  };

  const saveSignature = async (signatureId) => {
    if (!ownerId || !endpointBase || !signatureId) return;
    const result = await run(`edit:${signatureId}`, () => apiCall('patch', `${endpointBase}/signatures/${signatureId}`, signaturePayload(editDraft)));
    if (result) {
      setEditingId(null);
      setEditDraft(EMPTY_SIGNATURE);
    }
  };

  const promoteSignature = async (signatureId) => {
    if (!ownerId || !endpointBase || !signatureId) return;
    await run(`primary:${signatureId}`, () => apiCall('post', `${endpointBase}/signatures/${signatureId}/primary`));
  };

  const archiveSignature = async (signatureId) => {
    if (!ownerId || !endpointBase || !signatureId) return;
    if (!window.confirm('Remove this signature record?')) return;
    await run(`archive:${signatureId}`, () => apiCall('delete', `${endpointBase}/signatures/${signatureId}`));
  };

  const setProofFile = (signatureId, file) => {
    setProofFiles((prev) => ({
      ...prev,
      [signatureId]: file || null
    }));
  };

  const setProofDraft = (signatureId, patch) => {
    setProofMetadata((prev) => ({
      ...prev,
      [signatureId]: {
        ...(prev[signatureId] || EMPTY_PROOF_METADATA),
        ...patch
      }
    }));
  };

  const uploadProof = async (signatureId) => {
    const file = proofFiles[signatureId];
    if (!ownerId || !endpointBase || !signatureId || !file) return;
    const body = new FormData();
    body.append('proof', file);
    const metadata = proofMetadataPayload(proofMetadata[signatureId] || EMPTY_PROOF_METADATA);
    Object.entries(metadata).forEach(([key, value]) => {
      if (value) body.append(key, value);
    });
    const result = await run(`proof:${signatureId}`, () => apiCall('post', `${endpointBase}/signatures/${signatureId}/proof`, body, { headers: { 'Content-Type': 'multipart/form-data' } }));
    if (result) {
      setProofFiles((prev) => ({ ...prev, [signatureId]: null }));
      setProofMetadata((prev) => ({ ...prev, [signatureId]: EMPTY_PROOF_METADATA }));
    }
  };

  const saveProofMetadata = async (signatureId, proofId) => {
    if (!ownerId || !endpointBase || !signatureId || !proofId) return;
    const result = await run(`proof-meta:${proofId}`, () => apiCall('patch', `${endpointBase}/signatures/${signatureId}/proofs/${proofId}`, proofMetadataPayload(proofEditDraft)));
    if (result) {
      setEditingProofId(null);
      setProofEditDraft(EMPTY_PROOF_METADATA);
    }
  };

  const removeProof = async (signatureId, proofId = null) => {
    if (!ownerId || !endpointBase || !signatureId) return;
    const suffix = proofId ? `/proofs/${proofId}` : '/proof';
    await run(`proof-remove:${signatureId}:${proofId || 'primary'}`, () => apiCall('delete', `${endpointBase}/signatures/${signatureId}${suffix}`));
  };

  if (!ownerId) {
    return (
      <div className="md:col-span-2 border-t border-edge/60 pt-3 text-sm text-ghost">
        Save this {ownerLabel} before adding multiple signatures.
      </div>
    );
  }

  return (
    <div className="md:col-span-2 space-y-3 border-t border-edge/60 pt-3" data-signature-manager>
      {error ? <p className="text-xs text-err">{error}</p> : null}
      <div className="space-y-2">
        {rows.length ? rows.map((signature) => {
          const isEditing = editingId === signature.id;
          return (
            <div
              key={signature.id}
              className="border-t border-edge/70 pt-3 first:border-t-0 first:pt-0"
              data-signature-row={signature.id}
              data-signature-editing={isEditing ? 'true' : undefined}
            >
              {isEditing ? (
                <div className="space-y-3">
                  <SignatureFields
                    draft={editDraft}
                    events={events}
                    idPrefix={`signature-${signature.id}`}
                    onChange={setEditDraft}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className="btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => saveSignature(signature.id)}>
                      {busy === `edit:${signature.id}` ? <><Spinner size={14} />Saving…</> : <><Icons.Check />Save signature</>}
                    </button>
                    <button type="button" className="btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => { setEditingId(null); setEditDraft(EMPTY_SIGNATURE); }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm text-ink">{signatureLine(signature, events)}</p>
                        {signature.is_primary ? <span className="badge badge-dim">Primary</span> : <span className="badge badge-dim">Secondary</span>}
                      </div>
                      {signature.notes ? <p className="mt-1 text-xs leading-5 text-ghost">{signature.notes}</p> : null}
                      {Array.isArray(signature.proofs) && signature.proofs.length ? (
                        <div className="mt-2 space-y-1 rounded-lg border border-edge/70 bg-void/30 p-2">
                          <p className="text-xs font-medium text-ghost">Proof images</p>
                          {signature.proofs.map((proof, index) => (
                            <div key={proof.id || `${signature.id}:proof:${index}`} className="space-y-2 border-t border-edge/50 pt-2 first:border-t-0 first:pt-0">
                              <div className="flex flex-wrap items-start justify-between gap-2 text-xs">
                                <div className="min-w-0">
                                  <a className="inline-flex min-w-0 items-center gap-1.5 text-dim hover:text-ink" href={posterUrl(proof.proof_path)} target="_blank" rel="noreferrer">
                                    <Icons.Link />{proofTitle(proof, index)}
                                  </a>
                                  <div className="mt-1 flex flex-wrap items-center gap-2 text-ghost">
                                    {proof.is_primary ? <span>Primary</span> : null}
                                    {proof.proof_type ? <span>{proofTitle({ proof_type: proof.proof_type }, index)}</span> : null}
                                    {proof.original_filename ? <span>{proof.original_filename}</span> : null}
                                  </div>
                                  {proof.notes ? <p className="mt-1 leading-5 text-ghost">{proof.notes}</p> : null}
                                </div>
                                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                                  <button
                                    type="button"
                                    className="btn-ghost btn-sm"
                                    disabled={Boolean(busy) || !proof.id}
                                    onClick={() => {
                                      setEditingProofId(proof.id);
                                      setProofEditDraft(normalizeProofMetadata(proof));
                                    }}
                                  >
                                    Edit metadata
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-ghost btn-sm text-err"
                                    disabled={Boolean(busy) || !proof.id}
                                    onClick={() => removeProof(signature.id, proof.id)}
                                  >
                                    <Icons.Trash />Remove
                                  </button>
                                </div>
                              </div>
                              {editingProofId === proof.id ? (
                                <div className="space-y-2">
                                  <ProofMetadataFields
                                    draft={proofEditDraft}
                                    idPrefix={`proof-${proof.id}`}
                                    onChange={setProofEditDraft}
                                  />
                                  <div className="flex flex-wrap items-center gap-2">
                                    <button type="button" className="btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => saveProofMetadata(signature.id, proof.id)}>
                                      {busy === `proof-meta:${proof.id}` ? <><Spinner size={14} />Saving…</> : <><Icons.Check />Save metadata</>}
                                    </button>
                                    <button type="button" className="btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => { setEditingProofId(null); setProofEditDraft(EMPTY_PROOF_METADATA); }}>Cancel</button>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : signature.proof_path ? (
                        <a className="mt-1 inline-flex items-center gap-1.5 text-xs text-dim hover:text-ink" href={posterUrl(signature.proof_path)} target="_blank" rel="noreferrer"><Icons.Link />Open proof</a>
                      ) : null}
                      <div className="mt-2 flex flex-wrap items-end gap-2">
                        <ImageSourceControl
                          className="min-w-[16rem]"
                          label="Add proof image"
                          selectedFile={proofFiles[signature.id]}
                          selectedLabel="Selected proof"
                          chooseLabel="Choose from Library"
                          onChooseFile={(file) => setProofFile(signature.id, file)}
                          onCameraFile={(file) => setProofFile(signature.id, file)}
                        />
                        <button type="button" className="btn-secondary btn-sm" disabled={Boolean(busy) || !proofFiles[signature.id]} onClick={() => uploadProof(signature.id)}>
                          {busy === `proof:${signature.id}` ? <><Spinner size={14} />Uploading…</> : <><Icons.Upload />Add proof</>}
                        </button>
                        <button type="button" className="btn-ghost btn-sm text-err" disabled={Boolean(busy) || !signature.proof_path} onClick={() => removeProof(signature.id)}><Icons.Trash />Remove primary proof</button>
                      </div>
                      {proofFiles[signature.id] ? (
                        <div className="mt-2 space-y-2 rounded-lg border border-edge/70 bg-void/30 p-2">
                          <p className="text-xs text-ghost">Selected proof: {proofFiles[signature.id].name}</p>
                          <ProofMetadataFields
                            draft={proofMetadata[signature.id] || EMPTY_PROOF_METADATA}
                            idPrefix={`proof-new-${signature.id}`}
                            onChange={(next) => setProofDraft(signature.id, next)}
                          />
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-2">
                      {!signature.is_primary ? <button type="button" className="btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => promoteSignature(signature.id)}>Make primary</button> : null}
                      <button type="button" className="btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => { setEditingId(signature.id); setEditDraft(normalizeSignature(signature)); }}>Edit</button>
                        <button type="button" className="btn-ghost btn-sm text-err" disabled={Boolean(busy)} aria-label="Remove signature" onClick={() => archiveSignature(signature.id)}>Remove</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        }) : (
          <p className="text-sm text-ghost">No signature records yet.</p>
        )}
      </div>
      {adding ? (
        <div className="space-y-3 border-t border-edge/70 pt-3">
          <SignatureFields draft={addDraft} events={events} idPrefix="signature-new" onChange={setAddDraft} />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-primary btn-sm" disabled={Boolean(busy)} onClick={addSignature}>
              {busy === 'add' ? <><Spinner size={14} />Adding…</> : <><Icons.Plus />Add signature</>}
            </button>
            <button type="button" className="btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => { setAdding(false); setAddDraft(EMPTY_SIGNATURE); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn-secondary btn-sm" onClick={() => setAdding(true)}><Icons.Plus />Add signature</button>
      )}
    </div>
  );
}
