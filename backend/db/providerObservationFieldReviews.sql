CREATE UNIQUE INDEX IF NOT EXISTS provider_source_observations_id_space_key
  ON public.provider_source_observations(id, space_id);

CREATE TABLE IF NOT EXISTS public.provider_observation_field_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id INTEGER NOT NULL REFERENCES public.spaces(id) ON DELETE RESTRICT,
  library_id INTEGER NOT NULL,
  media_id INTEGER NOT NULL,
  provider_observation_id UUID NOT NULL,
  field_path VARCHAR(100) NOT NULL
    CHECK (field_path ~ '^(media|type_details)\.[a-z][a-z0-9_]{0,79}$'),
  observation_fingerprint CHAR(64) NOT NULL
    CHECK (observation_fingerprint ~ '^[0-9a-f]{64}$'),
  canonical_value_fingerprint CHAR(64) NOT NULL
    CHECK (canonical_value_fingerprint ~ '^[0-9a-f]{64}$'),
  decision VARCHAR(20) NOT NULL CHECK (decision IN ('approved', 'rejected', 'deferred')),
  note TEXT CHECK (note IS NULL OR char_length(note) <= 500),
  deferred_until TIMESTAMPTZ,
  decided_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT provider_observation_field_reviews_media_fk
    FOREIGN KEY (media_id, space_id)
    REFERENCES public.media(id, space_id) ON DELETE CASCADE,
  CONSTRAINT provider_observation_field_reviews_library_fk
    FOREIGN KEY (space_id, library_id)
    REFERENCES public.libraries(space_id, id) ON DELETE CASCADE,
  CONSTRAINT provider_observation_field_reviews_observation_fk
    FOREIGN KEY (provider_observation_id, space_id)
    REFERENCES public.provider_source_observations(id, space_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS provider_observation_field_reviews_latest
  ON public.provider_observation_field_reviews
  (space_id, media_id, provider_observation_id, field_path, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION collectz_scope.immutable_provider_observation_field_review()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Provider observation field reviews are append-only' USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION collectz_scope.immutable_provider_observation_field_review() FROM PUBLIC;

DROP TRIGGER IF EXISTS provider_observation_field_reviews_append_only
  ON public.provider_observation_field_reviews;
CREATE TRIGGER provider_observation_field_reviews_append_only
  BEFORE UPDATE ON public.provider_observation_field_reviews
  FOR EACH ROW EXECUTE FUNCTION collectz_scope.immutable_provider_observation_field_review();

CREATE OR REPLACE FUNCTION collectz_scope.guard_provider_observation_field_review_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION 'Provider observation field reviews are append-only' USING ERRCODE = '42501';
  END IF;
  IF session_user <> current_user
     AND NOT collectz_scope.allows_library(OLD.space_id, OLD.library_id) THEN
    RAISE EXCEPTION 'Provider observation field review deletion requires authorized scope' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION collectz_scope.guard_provider_observation_field_review_delete() FROM PUBLIC;

DROP TRIGGER IF EXISTS provider_observation_field_reviews_scoped_delete
  ON public.provider_observation_field_reviews;
CREATE TRIGGER provider_observation_field_reviews_scoped_delete
  BEFORE DELETE ON public.provider_observation_field_reviews
  FOR EACH ROW EXECUTE FUNCTION collectz_scope.guard_provider_observation_field_review_delete();

ALTER TABLE public.provider_observation_field_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS provider_observation_field_reviews_scope
  ON public.provider_observation_field_reviews;
CREATE POLICY provider_observation_field_reviews_scope
  ON public.provider_observation_field_reviews
  USING (collectz_scope.allows_library(space_id, library_id))
  WITH CHECK (collectz_scope.allows_library(space_id, library_id));
