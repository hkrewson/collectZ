DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.external_media_identity_events
     WHERE (from_media_id IS NOT NULL AND from_media_public_id IS NULL)
        OR (to_media_id IS NOT NULL AND to_media_public_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'External identity event public UUID backfill is incomplete';
  END IF;
END;
$$;

ALTER TABLE public.external_media_identity_events
  VALIDATE CONSTRAINT external_media_identity_events_from_media_scope_fk;

ALTER TABLE public.external_media_identity_events
  VALIDATE CONSTRAINT external_media_identity_events_to_media_scope_fk;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'external_media_identity_events_public_reference_check'
  ) THEN
    ALTER TABLE public.external_media_identity_events
      ADD CONSTRAINT external_media_identity_events_public_reference_check
      CHECK (
        (from_media_id IS NULL OR from_media_public_id IS NOT NULL)
        AND (to_media_id IS NULL OR to_media_public_id IS NOT NULL)
      ) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.external_media_identity_events
  VALIDATE CONSTRAINT external_media_identity_events_public_reference_check;
