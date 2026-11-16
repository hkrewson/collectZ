-- Event exclusive-source observations are request-only, library-owned state.
-- The parent event is authoritative for retained ownership.
UPDATE public.event_exclusive_sources s
   SET space_id = e.space_id,
       library_id = e.library_id
  FROM public.events e
 WHERE e.id = s.event_id
   AND (s.space_id IS DISTINCT FROM e.space_id
     OR s.library_id IS DISTINCT FROM e.library_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.event_exclusive_sources s
      LEFT JOIN public.events e ON e.id = s.event_id
      LEFT JOIN public.libraries l ON l.id = e.library_id AND l.space_id = e.space_id
      LEFT JOIN public.wanted_items w ON w.id = s.promoted_wanted_item_id
      LEFT JOIN public.collectibles c ON c.id = s.promoted_collectible_id
     WHERE e.id IS NULL
        OR e.space_id IS NULL
        OR e.library_id IS NULL
        OR l.id IS NULL
        OR (s.space_id, s.library_id) IS DISTINCT FROM (e.space_id, e.library_id)
        OR (s.promoted_wanted_item_id IS NOT NULL
          AND (w.space_id, w.library_id) IS DISTINCT FROM (e.space_id, e.library_id))
        OR (s.promoted_collectible_id IS NOT NULL
          AND (c.space_id, c.library_id) IS DISTINCT FROM (e.space_id, e.library_id))
  ) THEN
    RAISE EXCEPTION 'Event exclusive sources have unresolved ownership; repair before migration 139';
  END IF;
END;
$$;

ALTER TABLE public.event_exclusive_sources
  ALTER COLUMN space_id SET NOT NULL,
  ALTER COLUMN library_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS events_id_space_id_library_id_key
  ON public.events(id, space_id, library_id);
CREATE UNIQUE INDEX IF NOT EXISTS wanted_items_id_space_id_library_id_key
  ON public.wanted_items(id, space_id, library_id);
CREATE UNIQUE INDEX IF NOT EXISTS collectibles_id_space_id_library_id_key
  ON public.collectibles(id, space_id, library_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'event_exclusive_sources_event_scope_fk'
       AND conrelid = 'public.event_exclusive_sources'::regclass
  ) THEN
    ALTER TABLE public.event_exclusive_sources
      ADD CONSTRAINT event_exclusive_sources_event_scope_fk
      FOREIGN KEY (event_id, space_id, library_id)
      REFERENCES public.events(id, space_id, library_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'event_exclusive_sources_library_scope_fk'
       AND conrelid = 'public.event_exclusive_sources'::regclass
  ) THEN
    ALTER TABLE public.event_exclusive_sources
      ADD CONSTRAINT event_exclusive_sources_library_scope_fk
      FOREIGN KEY (space_id, library_id)
      REFERENCES public.libraries(space_id, id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'event_exclusive_sources_wanted_scope_fk'
       AND conrelid = 'public.event_exclusive_sources'::regclass
  ) THEN
    ALTER TABLE public.event_exclusive_sources
      ADD CONSTRAINT event_exclusive_sources_wanted_scope_fk
      FOREIGN KEY (promoted_wanted_item_id, space_id, library_id)
      REFERENCES public.wanted_items(id, space_id, library_id)
      ON DELETE SET NULL (promoted_wanted_item_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'event_exclusive_sources_collectible_scope_fk'
       AND conrelid = 'public.event_exclusive_sources'::regclass
  ) THEN
    ALTER TABLE public.event_exclusive_sources
      ADD CONSTRAINT event_exclusive_sources_collectible_scope_fk
      FOREIGN KEY (promoted_collectible_id, space_id, library_id)
      REFERENCES public.collectibles(id, space_id, library_id)
      ON DELETE SET NULL (promoted_collectible_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION collectz_scope.enforce_event_exclusive_source_scope()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (OLD.event_id, OLD.space_id, OLD.library_id) IS DISTINCT FROM
         (NEW.event_id, NEW.space_id, NEW.library_id) THEN
    RAISE EXCEPTION 'Event exclusive source ownership is immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.promoted_wanted_item_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.wanted_items w
        WHERE w.id = NEW.promoted_wanted_item_id
          AND (w.space_id, w.library_id) = (NEW.space_id, NEW.library_id)
     ) THEN
    RAISE EXCEPTION 'Promoted wishlist item must share event exclusive source scope' USING ERRCODE = '23503';
  END IF;
  IF NEW.promoted_collectible_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.collectibles c
        WHERE c.id = NEW.promoted_collectible_id
          AND (c.space_id, c.library_id) = (NEW.space_id, NEW.library_id)
     ) THEN
    RAISE EXCEPTION 'Promoted collectible must share event exclusive source scope' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION collectz_scope.enforce_event_exclusive_source_scope() FROM PUBLIC;

DROP TRIGGER IF EXISTS event_exclusive_sources_scope_guard ON public.event_exclusive_sources;
CREATE TRIGGER event_exclusive_sources_scope_guard
  BEFORE INSERT OR UPDATE ON public.event_exclusive_sources
  FOR EACH ROW EXECUTE FUNCTION collectz_scope.enforce_event_exclusive_source_scope();

ALTER TABLE public.event_exclusive_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS event_exclusive_sources_scope ON public.event_exclusive_sources;
CREATE POLICY event_exclusive_sources_scope ON public.event_exclusive_sources
  USING (collectz_scope.allows_library(space_id, library_id))
  WITH CHECK (collectz_scope.allows_library(space_id, library_id));

CREATE OR REPLACE FUNCTION collectz_scope.guard_event_exclusive_source_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF session_user <> current_user
     AND NOT collectz_scope.allows_library(OLD.space_id, OLD.library_id) THEN
    RAISE EXCEPTION 'Event exclusive source deletion requires authorized scope' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION collectz_scope.guard_event_exclusive_source_delete() FROM PUBLIC;

DROP TRIGGER IF EXISTS event_exclusive_sources_scoped_delete ON public.event_exclusive_sources;
CREATE TRIGGER event_exclusive_sources_scoped_delete
  BEFORE DELETE ON public.event_exclusive_sources
  FOR EACH ROW EXECUTE FUNCTION collectz_scope.guard_event_exclusive_source_delete();
