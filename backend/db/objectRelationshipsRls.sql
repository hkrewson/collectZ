-- Object relationships are request-only, workspace-owned links. The source
-- object is authoritative for stored ownership, while targets may live in a
-- different library inside the same workspace.
WITH resolved AS (
  SELECT r.id, source.space_id, source.library_id
    FROM public.object_relationships r
    JOIN LATERAL (
      SELECT m.space_id, m.library_id, true AS active FROM public.media m
       WHERE r.source_type = 'media' AND m.id = r.source_id
      UNION ALL
      SELECT a.space_id, a.library_id, a.archived_at IS NULL AS active FROM public.art_items a
       WHERE r.source_type = 'art' AND a.id = r.source_id
      UNION ALL
      SELECT c.space_id, c.library_id, c.archived_at IS NULL AS active FROM public.collectibles c
       WHERE r.source_type = 'collectible' AND c.id = r.source_id
      UNION ALL
      SELECT e.space_id, e.library_id, e.archived_at IS NULL AS active FROM public.events e
       WHERE r.source_type = 'event' AND e.id = r.source_id
    ) source ON true
)
UPDATE public.object_relationships r
   SET space_id = resolved.space_id,
       library_id = resolved.library_id
  FROM resolved
 WHERE r.id = resolved.id
   AND (r.space_id, r.library_id) IS DISTINCT FROM (resolved.space_id, resolved.library_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.object_relationships r
      LEFT JOIN LATERAL (
        SELECT m.space_id, m.library_id, true AS active FROM public.media m
         WHERE r.source_type = 'media' AND m.id = r.source_id
        UNION ALL
        SELECT a.space_id, a.library_id, a.archived_at IS NULL AS active FROM public.art_items a
         WHERE r.source_type = 'art' AND a.id = r.source_id
        UNION ALL
        SELECT c.space_id, c.library_id, c.archived_at IS NULL AS active FROM public.collectibles c
         WHERE r.source_type = 'collectible' AND c.id = r.source_id
        UNION ALL
        SELECT e.space_id, e.library_id, e.archived_at IS NULL AS active FROM public.events e
         WHERE r.source_type = 'event' AND e.id = r.source_id
      ) source ON true
      LEFT JOIN LATERAL (
        SELECT m.space_id, m.library_id, true AS active FROM public.media m
         WHERE r.target_type = 'media' AND m.id = r.target_id
        UNION ALL
        SELECT a.space_id, a.library_id, a.archived_at IS NULL AS active FROM public.art_items a
         WHERE r.target_type = 'art' AND a.id = r.target_id
        UNION ALL
        SELECT c.space_id, c.library_id, c.archived_at IS NULL AS active FROM public.collectibles c
         WHERE r.target_type = 'collectible' AND c.id = r.target_id
        UNION ALL
        SELECT e.space_id, e.library_id, e.archived_at IS NULL AS active FROM public.events e
         WHERE r.target_type = 'event' AND e.id = r.target_id
      ) target ON true
      LEFT JOIN public.libraries l ON l.id = source.library_id AND l.space_id = source.space_id
      LEFT JOIN public.libraries target_l ON target_l.id = target.library_id AND target_l.space_id = target.space_id
     WHERE source.space_id IS NULL
        OR source.library_id IS NULL
        OR target.space_id IS NULL
        OR target.library_id IS NULL
        OR source.space_id IS DISTINCT FROM target.space_id
        OR (r.archived_at IS NULL AND (NOT source.active OR NOT target.active))
        OR (r.space_id, r.library_id) IS DISTINCT FROM (source.space_id, source.library_id)
        OR l.id IS NULL
        OR target_l.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Object relationships have unresolved ownership; repair before migration 140';
  END IF;
END;
$$;

ALTER TABLE public.object_relationships
  ALTER COLUMN space_id SET NOT NULL,
  ALTER COLUMN library_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'object_relationships_library_scope_fk'
       AND conrelid = 'public.object_relationships'::regclass
  ) THEN
    ALTER TABLE public.object_relationships
      ADD CONSTRAINT object_relationships_library_scope_fk
      FOREIGN KEY (space_id, library_id)
      REFERENCES public.libraries(space_id, id) ON DELETE RESTRICT;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION collectz_scope.enforce_object_relationship_scope()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  source_space INTEGER;
  source_library INTEGER;
  target_space INTEGER;
  target_library INTEGER;
  source_active BOOLEAN;
  target_active BOOLEAN;
BEGIN
  IF TG_OP = 'UPDATE'
     AND (OLD.source_type, OLD.source_id, OLD.target_type, OLD.target_id, OLD.space_id, OLD.library_id)
         IS DISTINCT FROM
         (NEW.source_type, NEW.source_id, NEW.target_type, NEW.target_id, NEW.space_id, NEW.library_id) THEN
    RAISE EXCEPTION 'Object relationship ownership and endpoints are immutable' USING ERRCODE = '42501';
  END IF;

  IF NEW.source_type = 'media' THEN
    SELECT space_id, library_id, true INTO source_space, source_library, source_active FROM public.media WHERE id = NEW.source_id;
  ELSIF NEW.source_type = 'art' THEN
    SELECT space_id, library_id, archived_at IS NULL INTO source_space, source_library, source_active FROM public.art_items WHERE id = NEW.source_id;
  ELSIF NEW.source_type = 'collectible' THEN
    SELECT space_id, library_id, archived_at IS NULL INTO source_space, source_library, source_active FROM public.collectibles WHERE id = NEW.source_id;
  ELSIF NEW.source_type = 'event' THEN
    SELECT space_id, library_id, archived_at IS NULL INTO source_space, source_library, source_active FROM public.events WHERE id = NEW.source_id;
  END IF;

  IF NEW.target_type = 'media' THEN
    SELECT space_id, library_id, true INTO target_space, target_library, target_active FROM public.media WHERE id = NEW.target_id;
  ELSIF NEW.target_type = 'art' THEN
    SELECT space_id, library_id, archived_at IS NULL INTO target_space, target_library, target_active FROM public.art_items WHERE id = NEW.target_id;
  ELSIF NEW.target_type = 'collectible' THEN
    SELECT space_id, library_id, archived_at IS NULL INTO target_space, target_library, target_active FROM public.collectibles WHERE id = NEW.target_id;
  ELSIF NEW.target_type = 'event' THEN
    SELECT space_id, library_id, archived_at IS NULL INTO target_space, target_library, target_active FROM public.events WHERE id = NEW.target_id;
  END IF;

  IF source_space IS NULL OR source_library IS NULL THEN
    RAISE EXCEPTION 'Object relationship source is missing or unscoped' USING ERRCODE = '23503';
  END IF;
  IF target_space IS NULL OR target_library IS NULL THEN
    RAISE EXCEPTION 'Object relationship target is missing or unscoped' USING ERRCODE = '23503';
  END IF;
  IF source_space IS DISTINCT FROM target_space THEN
    RAISE EXCEPTION 'Object relationship endpoints must share a workspace' USING ERRCODE = '23503';
  END IF;
  IF NEW.archived_at IS NULL AND (NOT COALESCE(source_active, false) OR NOT COALESCE(target_active, false)) THEN
    RAISE EXCEPTION 'Active object relationships require active endpoints' USING ERRCODE = '23503';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.libraries l
     WHERE l.id = source_library AND l.space_id = source_space
  ) OR NOT EXISTS (
    SELECT 1 FROM public.libraries l
     WHERE l.id = target_library AND l.space_id = target_space
  ) THEN
    RAISE EXCEPTION 'Object relationship endpoints must belong to valid workspace libraries' USING ERRCODE = '23503';
  END IF;
  IF (NEW.space_id, NEW.library_id) IS DISTINCT FROM (source_space, source_library) THEN
    RAISE EXCEPTION 'Object relationship scope must match its source' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION collectz_scope.enforce_object_relationship_scope() FROM PUBLIC;

DROP TRIGGER IF EXISTS object_relationships_scope_guard ON public.object_relationships;
CREATE TRIGGER object_relationships_scope_guard
  BEFORE INSERT OR UPDATE ON public.object_relationships
  FOR EACH ROW EXECUTE FUNCTION collectz_scope.enforce_object_relationship_scope();

CREATE OR REPLACE FUNCTION collectz_scope.guard_active_object_relationship_owner()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  owner_type TEXT := TG_ARGV[0];
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1 FROM public.object_relationships r
     WHERE r.archived_at IS NULL
       AND ((r.source_type = owner_type AND r.source_id = OLD.id)
         OR (r.target_type = owner_type AND r.target_id = OLD.id))
  ) THEN
    RAISE EXCEPTION 'Archive active object relationships before deleting their owner' USING ERRCODE = '23503';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.space_id IS DISTINCT FROM NEW.space_id AND EXISTS (
    SELECT 1 FROM public.object_relationships r
     WHERE r.archived_at IS NULL
       AND ((r.source_type = owner_type AND r.source_id = OLD.id)
         OR (r.target_type = owner_type AND r.target_id = OLD.id))
  ) THEN
    RAISE EXCEPTION 'Active object relationship owners cannot change workspace' USING ERRCODE = '23503';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.library_id IS DISTINCT FROM NEW.library_id AND EXISTS (
    SELECT 1 FROM public.object_relationships r
     WHERE r.archived_at IS NULL
       AND r.source_type = owner_type
       AND r.source_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Active object relationship sources cannot change library' USING ERRCODE = '23503';
  END IF;

  IF TG_OP = 'UPDATE'
     AND (to_jsonb(OLD)->'archived_at') IS DISTINCT FROM (to_jsonb(NEW)->'archived_at')
     AND (to_jsonb(NEW)->>'archived_at') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.object_relationships r
        WHERE r.archived_at IS NULL
          AND ((r.source_type = owner_type AND r.source_id = OLD.id)
            OR (r.target_type = owner_type AND r.target_id = OLD.id))
     ) THEN
    RAISE EXCEPTION 'Archive active object relationships before archiving their owner' USING ERRCODE = '23503';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION collectz_scope.guard_active_object_relationship_owner() FROM PUBLIC;

DROP TRIGGER IF EXISTS media_object_relationship_owner_guard ON public.media;
CREATE TRIGGER media_object_relationship_owner_guard
  BEFORE UPDATE OF space_id, library_id OR DELETE ON public.media
  FOR EACH ROW EXECUTE FUNCTION collectz_scope.guard_active_object_relationship_owner('media');
DROP TRIGGER IF EXISTS art_object_relationship_owner_guard ON public.art_items;
CREATE TRIGGER art_object_relationship_owner_guard
  BEFORE UPDATE OF space_id, library_id, archived_at OR DELETE ON public.art_items
  FOR EACH ROW EXECUTE FUNCTION collectz_scope.guard_active_object_relationship_owner('art');
DROP TRIGGER IF EXISTS collectible_object_relationship_owner_guard ON public.collectibles;
CREATE TRIGGER collectible_object_relationship_owner_guard
  BEFORE UPDATE OF space_id, library_id, archived_at OR DELETE ON public.collectibles
  FOR EACH ROW EXECUTE FUNCTION collectz_scope.guard_active_object_relationship_owner('collectible');
DROP TRIGGER IF EXISTS event_object_relationship_owner_guard ON public.events;
CREATE TRIGGER event_object_relationship_owner_guard
  BEFORE UPDATE OF space_id, library_id, archived_at OR DELETE ON public.events
  FOR EACH ROW EXECUTE FUNCTION collectz_scope.guard_active_object_relationship_owner('event');

ALTER TABLE public.object_relationships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS object_relationships_scope ON public.object_relationships;
CREATE POLICY object_relationships_scope ON public.object_relationships
  USING (collectz_scope.allows_workspace(space_id))
  WITH CHECK (collectz_scope.allows_workspace(space_id));
