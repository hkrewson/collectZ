-- Preserve immutable edition evidence when a converted Capture Inbox receipt is
-- removed, while permitting normal cascades when its Edition/Work is deleted.

ALTER TABLE public.edition_source_observations
  ALTER COLUMN capture_item_id DROP NOT NULL;

ALTER TABLE public.edition_source_observations
  DROP CONSTRAINT IF EXISTS edition_source_observations_capture_fk;
ALTER TABLE public.edition_source_observations
  ADD CONSTRAINT edition_source_observations_capture_fk
  FOREIGN KEY (capture_item_id, space_id, library_id)
  REFERENCES public.capture_items(id, space_id, library_id)
  ON DELETE SET NULL (capture_item_id);

ALTER TABLE public.edition_source_observations
  DROP CONSTRAINT IF EXISTS edition_source_observations_edition_fk;
ALTER TABLE public.edition_source_observations
  ADD CONSTRAINT edition_source_observations_edition_fk
  FOREIGN KEY (edition_id, space_id, library_id)
  REFERENCES public.collection_editions(id, space_id, library_id)
  ON DELETE CASCADE;

DROP TRIGGER IF EXISTS edition_source_observations_append_only
  ON public.edition_source_observations;

CREATE OR REPLACE FUNCTION collectz_scope.immutable_edition_source_observation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF pg_trigger_depth() > 1
     AND OLD.capture_item_id IS NOT NULL
     AND NEW.capture_item_id IS NULL
     AND (OLD.id, OLD.space_id, OLD.library_id, OLD.edition_id,
          OLD.source_provider, OLD.source_item_id, OLD.schema_version,
          OLD.idempotency_key, OLD.content_hash, OLD.normalized_facts,
          OLD.source_observed_at, OLD.observed_at, OLD.actor_user_id)
         IS NOT DISTINCT FROM
         (NEW.id, NEW.space_id, NEW.library_id, NEW.edition_id,
          NEW.source_provider, NEW.source_item_id, NEW.schema_version,
          NEW.idempotency_key, NEW.content_hash, NEW.normalized_facts,
          NEW.source_observed_at, NEW.observed_at, NEW.actor_user_id) THEN
    IF session_user <> current_user
       AND NOT collectz_scope.allows_library(OLD.space_id, OLD.library_id) THEN
      RAISE EXCEPTION 'Edition source observation capture cleanup requires authorized scope' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Edition source observations are append-only' USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION collectz_scope.immutable_edition_source_observation() FROM PUBLIC;

CREATE TRIGGER edition_source_observations_immutable_update
  BEFORE UPDATE ON public.edition_source_observations
  FOR EACH ROW EXECUTE FUNCTION collectz_scope.immutable_edition_source_observation();

CREATE OR REPLACE FUNCTION collectz_scope.guard_edition_source_observation_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION 'Edition source observations are append-only' USING ERRCODE = '42501';
  END IF;
  IF session_user <> current_user
     AND NOT collectz_scope.allows_library(OLD.space_id, OLD.library_id) THEN
    RAISE EXCEPTION 'Edition source observation deletion requires authorized scope' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION collectz_scope.guard_edition_source_observation_delete() FROM PUBLIC;

DROP TRIGGER IF EXISTS edition_source_observations_scoped_delete
  ON public.edition_source_observations;
CREATE TRIGGER edition_source_observations_scoped_delete
  BEFORE DELETE ON public.edition_source_observations
  FOR EACH ROW EXECUTE FUNCTION collectz_scope.guard_edition_source_observation_delete();
