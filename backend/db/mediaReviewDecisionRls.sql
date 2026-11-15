-- Dashboard review decisions are the first post-pilot legacy table family to
-- adopt workspace RLS. Ownership is derived only from the referenced media
-- row; unresolved legacy rows stop the migration instead of being guessed.
UPDATE public.media_review_decisions d
   SET space_id = m.space_id,
       library_id = m.library_id
  FROM public.media m
 WHERE d.media_id = m.id
   AND (d.space_id IS DISTINCT FROM m.space_id OR d.library_id IS DISTINCT FROM m.library_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.media_review_decisions d
      LEFT JOIN public.media m ON m.id = d.media_id
     WHERE m.id IS NULL
        OR d.space_id IS NULL
        OR d.library_id IS NULL
        OR d.space_id IS DISTINCT FROM m.space_id
        OR d.library_id IS DISTINCT FROM m.library_id
  ) THEN
    RAISE EXCEPTION 'Dashboard review decisions have unresolved ownership; repair before migration 137';
  END IF;
END;
$$;

ALTER TABLE public.media_review_decisions
  ALTER COLUMN space_id SET NOT NULL,
  ALTER COLUMN library_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'media_review_decisions_media_scope_fk'
       AND conrelid = 'public.media_review_decisions'::regclass
  ) THEN
    ALTER TABLE public.media_review_decisions
      ADD CONSTRAINT media_review_decisions_media_scope_fk
      FOREIGN KEY (media_id, space_id)
      REFERENCES public.media(id, space_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'media_review_decisions_library_scope_fk'
       AND conrelid = 'public.media_review_decisions'::regclass
  ) THEN
    ALTER TABLE public.media_review_decisions
      ADD CONSTRAINT media_review_decisions_library_scope_fk
      FOREIGN KEY (space_id, library_id)
      REFERENCES public.libraries(space_id, id) ON DELETE CASCADE;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION collectz_scope.immutable_media_review_decision_owner()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF (OLD.media_id, OLD.space_id, OLD.library_id) IS DISTINCT FROM
     (NEW.media_id, NEW.space_id, NEW.library_id) THEN
    RAISE EXCEPTION 'Dashboard review decision ownership is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION collectz_scope.immutable_media_review_decision_owner() FROM PUBLIC;

DROP TRIGGER IF EXISTS media_review_decision_immutable_owner ON public.media_review_decisions;
CREATE TRIGGER media_review_decision_immutable_owner
  BEFORE UPDATE ON public.media_review_decisions
  FOR EACH ROW EXECUTE FUNCTION collectz_scope.immutable_media_review_decision_owner();

ALTER TABLE public.media_review_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS media_review_decisions_scope ON public.media_review_decisions;
CREATE POLICY media_review_decisions_scope ON public.media_review_decisions
  USING (collectz_scope.allows_workspace(space_id))
  WITH CHECK (collectz_scope.allows_workspace(space_id));

-- Referential actions execute as the relation owner and otherwise bypass RLS.
-- Require the originating runtime transaction to hold the matching workspace
-- grant before a parent delete may cascade into review-decision history.
CREATE OR REPLACE FUNCTION collectz_scope.guard_media_review_decision_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF session_user <> current_user
     AND NOT collectz_scope.allows_workspace(OLD.space_id) THEN
    RAISE EXCEPTION 'Dashboard review decision deletion requires authorized scope' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION collectz_scope.guard_media_review_decision_delete() FROM PUBLIC;

DROP TRIGGER IF EXISTS media_review_decision_scoped_delete ON public.media_review_decisions;
CREATE TRIGGER media_review_decision_scoped_delete
  BEFORE DELETE ON public.media_review_decisions
  FOR EACH ROW EXECUTE FUNCTION collectz_scope.guard_media_review_decision_delete();
