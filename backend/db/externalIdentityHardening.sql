DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.media m
     WHERE m.library_id IS NOT NULL
       AND (
         m.space_id IS NULL
         OR NOT EXISTS (
           SELECT 1 FROM public.libraries l
            WHERE l.id = m.library_id AND l.space_id = m.space_id
         )
       )
  ) THEN
    RAISE EXCEPTION 'Media/library ownership is unresolved; repair retained data before migration 127';
  END IF;
  IF EXISTS (SELECT 1 FROM public.media WHERE public_id IS NULL) THEN
    RAISE EXCEPTION 'Canonical media UUID backfill is incomplete';
  END IF;
END;
$$;

ALTER TABLE public.media
  ALTER COLUMN public_id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN public_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS media_public_id_key ON public.media(public_id);
CREATE UNIQUE INDEX IF NOT EXISTS libraries_id_space_id_key ON public.libraries(id, space_id);
CREATE UNIQUE INDEX IF NOT EXISTS media_id_space_id_key ON public.media(id, space_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_library_requires_space_check') THEN
    ALTER TABLE public.media
      ADD CONSTRAINT media_library_requires_space_check
      CHECK (library_id IS NULL OR space_id IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_library_scope_fk') THEN
    ALTER TABLE public.media
      ADD CONSTRAINT media_library_scope_fk
      FOREIGN KEY (library_id, space_id)
      REFERENCES public.libraries(id, space_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'external_media_identities_media_scope_fk') THEN
    ALTER TABLE public.external_media_identities
      ADD CONSTRAINT external_media_identities_media_scope_fk
      FOREIGN KEY (media_id, space_id)
      REFERENCES public.media(id, space_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'external_media_identity_events_from_media_scope_fk') THEN
    ALTER TABLE public.external_media_identity_events
      ADD CONSTRAINT external_media_identity_events_from_media_scope_fk
      FOREIGN KEY (from_media_id, space_id)
      REFERENCES public.media(id, space_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'external_media_identity_events_to_media_scope_fk') THEN
    ALTER TABLE public.external_media_identity_events
      ADD CONSTRAINT external_media_identity_events_to_media_scope_fk
      FOREIGN KEY (to_media_id, space_id)
      REFERENCES public.media(id, space_id) ON DELETE RESTRICT;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION collectz_scope.immutable_media_public_id()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF OLD.public_id IS DISTINCT FROM NEW.public_id THEN
    RAISE EXCEPTION 'Canonical media UUID is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION collectz_scope.immutable_media_public_id() FROM PUBLIC;

CREATE OR REPLACE FUNCTION collectz_scope.immutable_provider_connection_owner()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF (OLD.id, OLD.space_id, OLD.provider_type) IS DISTINCT FROM
     (NEW.id, NEW.space_id, NEW.provider_type) THEN
    RAISE EXCEPTION 'Provider connection identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION collectz_scope.immutable_provider_connection_owner() FROM PUBLIC;

CREATE OR REPLACE FUNCTION collectz_scope.immutable_external_identity_key()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF (OLD.id, OLD.space_id, OLD.provider_connection_id, OLD.identity_kind, OLD.external_id_normalized, OLD.first_seen_at)
     IS DISTINCT FROM
     (NEW.id, NEW.space_id, NEW.provider_connection_id, NEW.identity_kind, NEW.external_id_normalized, NEW.first_seen_at) THEN
    RAISE EXCEPTION 'External identity key is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION collectz_scope.immutable_external_identity_key() FROM PUBLIC;

CREATE OR REPLACE FUNCTION collectz_scope.append_only_identity_event()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'External identity lifecycle events are append-only' USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION collectz_scope.append_only_identity_event() FROM PUBLIC;

DROP TRIGGER IF EXISTS media_immutable_public_id ON public.media;
CREATE TRIGGER media_immutable_public_id BEFORE UPDATE ON public.media
  FOR EACH ROW EXECUTE FUNCTION collectz_scope.immutable_media_public_id();
DROP TRIGGER IF EXISTS provider_connection_immutable_owner ON public.provider_connections;
CREATE TRIGGER provider_connection_immutable_owner BEFORE UPDATE ON public.provider_connections
  FOR EACH ROW EXECUTE FUNCTION collectz_scope.immutable_provider_connection_owner();
DROP TRIGGER IF EXISTS external_identity_immutable_key ON public.external_media_identities;
CREATE TRIGGER external_identity_immutable_key BEFORE UPDATE ON public.external_media_identities
  FOR EACH ROW EXECUTE FUNCTION collectz_scope.immutable_external_identity_key();
DROP TRIGGER IF EXISTS external_identity_event_append_only ON public.external_media_identity_events;
CREATE TRIGGER external_identity_event_append_only BEFORE UPDATE OR DELETE ON public.external_media_identity_events
  FOR EACH ROW EXECUTE FUNCTION collectz_scope.append_only_identity_event();
