CREATE OR REPLACE FUNCTION collectz_scope.append_only_identity_event()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(OLD) - 'from_media_id' - 'to_media_id') =
         (to_jsonb(NEW) - 'from_media_id' - 'to_media_id')
     AND (
       NEW.from_media_id IS NOT DISTINCT FROM OLD.from_media_id
       OR (OLD.from_media_id IS NOT NULL AND NEW.from_media_id IS NULL)
     )
     AND (
       NEW.to_media_id IS NOT DISTINCT FROM OLD.to_media_id
       OR (OLD.to_media_id IS NOT NULL AND NEW.to_media_id IS NULL)
     ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'External identity lifecycle events are append-only' USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION collectz_scope.append_only_identity_event() FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'external_media_identity_events_from_media_id_fkey'
  ) THEN
    ALTER TABLE public.external_media_identity_events
      ADD CONSTRAINT external_media_identity_events_from_media_id_fkey
      FOREIGN KEY (from_media_id)
      REFERENCES public.media(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'external_media_identity_events_to_media_id_fkey'
  ) THEN
    ALTER TABLE public.external_media_identity_events
      ADD CONSTRAINT external_media_identity_events_to_media_id_fkey
      FOREIGN KEY (to_media_id)
      REFERENCES public.media(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.external_media_identity_events
  VALIDATE CONSTRAINT external_media_identity_events_from_media_id_fkey;

ALTER TABLE public.external_media_identity_events
  VALIDATE CONSTRAINT external_media_identity_events_to_media_id_fkey;
