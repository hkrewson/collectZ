ALTER TABLE public.external_media_identity_events
  ADD COLUMN IF NOT EXISTS from_media_public_id UUID,
  ADD COLUMN IF NOT EXISTS to_media_public_id UUID;

ALTER TABLE public.external_media_identity_events
  DROP CONSTRAINT IF EXISTS external_media_identity_events_from_media_id_fkey,
  DROP CONSTRAINT IF EXISTS external_media_identity_events_to_media_id_fkey,
  DROP CONSTRAINT IF EXISTS external_media_identity_events_from_media_scope_fk,
  DROP CONSTRAINT IF EXISTS external_media_identity_events_to_media_scope_fk;

ALTER TABLE public.external_media_identity_events
  ADD CONSTRAINT external_media_identity_events_from_media_scope_fk
    FOREIGN KEY (from_media_id, space_id)
    REFERENCES public.media(id, space_id)
    ON DELETE SET NULL (from_media_id)
    NOT VALID,
  ADD CONSTRAINT external_media_identity_events_to_media_scope_fk
    FOREIGN KEY (to_media_id, space_id)
    REFERENCES public.media(id, space_id)
    ON DELETE SET NULL (to_media_id)
    NOT VALID;
