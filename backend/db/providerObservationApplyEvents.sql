CREATE TABLE IF NOT EXISTS public.provider_observation_apply_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id INTEGER NOT NULL REFERENCES public.spaces(id) ON DELETE RESTRICT,
  library_id INTEGER NOT NULL,
  media_id INTEGER NOT NULL,
  provider_observation_id UUID NOT NULL,
  observation_fingerprint CHAR(64) NOT NULL
    CHECK (observation_fingerprint ~ '^[0-9a-f]{64}$'),
  plan_fingerprint CHAR(64) NOT NULL
    CHECK (plan_fingerprint ~ '^[0-9a-f]{64}$'),
  field_changes JSONB NOT NULL
    CHECK (jsonb_typeof(field_changes) = 'array' AND jsonb_array_length(field_changes) > 0),
  applied_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT provider_observation_apply_events_media_fk
    FOREIGN KEY (media_id, space_id, library_id)
    REFERENCES public.media(id, space_id, library_id) ON DELETE CASCADE,
  CONSTRAINT provider_observation_apply_events_library_fk
    FOREIGN KEY (space_id, library_id)
    REFERENCES public.libraries(space_id, id) ON DELETE CASCADE,
  CONSTRAINT provider_observation_apply_events_observation_fk
    FOREIGN KEY (provider_observation_id, space_id)
    REFERENCES public.provider_source_observations(id, space_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS provider_observation_apply_events_history
  ON public.provider_observation_apply_events
  (space_id, library_id, media_id, applied_at DESC, id DESC);

CREATE OR REPLACE FUNCTION collectz_scope.immutable_provider_observation_apply_event()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Provider observation apply events are append-only' USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION collectz_scope.immutable_provider_observation_apply_event() FROM PUBLIC;

DROP TRIGGER IF EXISTS provider_observation_apply_events_append_only
  ON public.provider_observation_apply_events;
CREATE TRIGGER provider_observation_apply_events_append_only
  BEFORE UPDATE ON public.provider_observation_apply_events
  FOR EACH ROW EXECUTE FUNCTION collectz_scope.immutable_provider_observation_apply_event();

CREATE OR REPLACE FUNCTION collectz_scope.guard_provider_observation_apply_event_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION 'Provider observation apply events are append-only' USING ERRCODE = '42501';
  END IF;
  IF session_user <> current_user
     AND NOT collectz_scope.allows_library(OLD.space_id, OLD.library_id) THEN
    RAISE EXCEPTION 'Provider observation apply event deletion requires authorized scope' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION collectz_scope.guard_provider_observation_apply_event_delete() FROM PUBLIC;

DROP TRIGGER IF EXISTS provider_observation_apply_events_scoped_delete
  ON public.provider_observation_apply_events;
CREATE TRIGGER provider_observation_apply_events_scoped_delete
  BEFORE DELETE ON public.provider_observation_apply_events
  FOR EACH ROW EXECUTE FUNCTION collectz_scope.guard_provider_observation_apply_event_delete();

ALTER TABLE public.provider_observation_apply_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS provider_observation_apply_events_scope
  ON public.provider_observation_apply_events;
CREATE POLICY provider_observation_apply_events_scope
  ON public.provider_observation_apply_events
  USING (collectz_scope.allows_library(space_id, library_id))
  WITH CHECK (collectz_scope.allows_library(space_id, library_id));
