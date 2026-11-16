-- Manual merge recommendation feedback is request-only, library-owned state.
-- Derive legacy ownership from the canonical media row and reject any pair
-- whose four media references do not resolve to the exact same scope.
UPDATE public.media_merge_recommendation_feedback f
   SET space_id = canonical.space_id,
       library_id = canonical.library_id
  FROM public.media canonical
 WHERE canonical.id = f.canonical_media_id
   AND (f.space_id IS DISTINCT FROM canonical.space_id
     OR f.library_id IS DISTINCT FROM canonical.library_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.media_merge_recommendation_feedback f
      LEFT JOIN public.media pair_low ON pair_low.id = f.pair_low_media_id
      LEFT JOIN public.media pair_high ON pair_high.id = f.pair_high_media_id
      LEFT JOIN public.media canonical ON canonical.id = f.canonical_media_id
      LEFT JOIN public.media duplicate ON duplicate.id = f.duplicate_media_id
     WHERE f.space_id IS NULL
        OR f.library_id IS NULL
        OR pair_low.id IS NULL
        OR pair_high.id IS NULL
        OR canonical.id IS NULL
        OR duplicate.id IS NULL
        OR (pair_low.space_id, pair_low.library_id) IS DISTINCT FROM (f.space_id, f.library_id)
        OR (pair_high.space_id, pair_high.library_id) IS DISTINCT FROM (f.space_id, f.library_id)
        OR (canonical.space_id, canonical.library_id) IS DISTINCT FROM (f.space_id, f.library_id)
        OR (duplicate.space_id, duplicate.library_id) IS DISTINCT FROM (f.space_id, f.library_id)
  ) THEN
    RAISE EXCEPTION 'Merge recommendation feedback has unresolved ownership; repair before migration 138';
  END IF;
END;
$$;

ALTER TABLE public.media_merge_recommendation_feedback
  ALTER COLUMN space_id SET NOT NULL,
  ALTER COLUMN library_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS media_id_space_id_library_id_key
  ON public.media(id, space_id, library_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'merge_feedback_pair_low_scope_fk'
       AND conrelid = 'public.media_merge_recommendation_feedback'::regclass
  ) THEN
    ALTER TABLE public.media_merge_recommendation_feedback
      ADD CONSTRAINT merge_feedback_pair_low_scope_fk
      FOREIGN KEY (pair_low_media_id, space_id, library_id)
      REFERENCES public.media(id, space_id, library_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'merge_feedback_pair_high_scope_fk'
       AND conrelid = 'public.media_merge_recommendation_feedback'::regclass
  ) THEN
    ALTER TABLE public.media_merge_recommendation_feedback
      ADD CONSTRAINT merge_feedback_pair_high_scope_fk
      FOREIGN KEY (pair_high_media_id, space_id, library_id)
      REFERENCES public.media(id, space_id, library_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'merge_feedback_canonical_scope_fk'
       AND conrelid = 'public.media_merge_recommendation_feedback'::regclass
  ) THEN
    ALTER TABLE public.media_merge_recommendation_feedback
      ADD CONSTRAINT merge_feedback_canonical_scope_fk
      FOREIGN KEY (canonical_media_id, space_id, library_id)
      REFERENCES public.media(id, space_id, library_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'merge_feedback_duplicate_scope_fk'
       AND conrelid = 'public.media_merge_recommendation_feedback'::regclass
  ) THEN
    ALTER TABLE public.media_merge_recommendation_feedback
      ADD CONSTRAINT merge_feedback_duplicate_scope_fk
      FOREIGN KEY (duplicate_media_id, space_id, library_id)
      REFERENCES public.media(id, space_id, library_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'merge_feedback_library_scope_fk'
       AND conrelid = 'public.media_merge_recommendation_feedback'::regclass
  ) THEN
    ALTER TABLE public.media_merge_recommendation_feedback
      ADD CONSTRAINT merge_feedback_library_scope_fk
      FOREIGN KEY (space_id, library_id)
      REFERENCES public.libraries(space_id, id) ON DELETE CASCADE;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION collectz_scope.allows_library(p_space INTEGER, p_library INTEGER)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1
      FROM collectz_scope.transactions s
     WHERE s.backend_pid = pg_backend_pid()
       AND s.transaction_id = pg_current_xact_id()::text
       AND s.runtime_role = session_user
       AND s.server_started = pg_postmaster_start_time()
       AND s.expires_at > statement_timestamp()
       AND s.space_id = p_space
       AND s.library_id = p_library
       AND EXISTS (
         SELECT 1
           FROM public.libraries l
          WHERE l.id = p_library
            AND l.space_id = p_space
            AND l.archived_at IS NULL
       )
  );
$$;
REVOKE ALL ON FUNCTION collectz_scope.allows_library(integer, integer) FROM PUBLIC;

CREATE OR REPLACE FUNCTION collectz_scope.immutable_merge_feedback_owner()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF (OLD.pair_low_media_id, OLD.pair_high_media_id, OLD.space_id, OLD.library_id) IS DISTINCT FROM
     (NEW.pair_low_media_id, NEW.pair_high_media_id, NEW.space_id, NEW.library_id) THEN
    RAISE EXCEPTION 'Merge recommendation feedback ownership is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION collectz_scope.immutable_merge_feedback_owner() FROM PUBLIC;

DROP TRIGGER IF EXISTS merge_feedback_immutable_owner ON public.media_merge_recommendation_feedback;
CREATE TRIGGER merge_feedback_immutable_owner
  BEFORE UPDATE ON public.media_merge_recommendation_feedback
  FOR EACH ROW EXECUTE FUNCTION collectz_scope.immutable_merge_feedback_owner();

ALTER TABLE public.media_merge_recommendation_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS media_merge_recommendation_feedback_scope ON public.media_merge_recommendation_feedback;
CREATE POLICY media_merge_recommendation_feedback_scope ON public.media_merge_recommendation_feedback
  USING (collectz_scope.allows_library(space_id, library_id))
  WITH CHECK (collectz_scope.allows_library(space_id, library_id));

-- Cascades execute as the table owner. Refuse a runtime parent delete unless
-- the originating transaction has the exact library grant for this feedback.
CREATE OR REPLACE FUNCTION collectz_scope.guard_merge_feedback_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF session_user <> current_user
     AND NOT collectz_scope.allows_library(OLD.space_id, OLD.library_id) THEN
    RAISE EXCEPTION 'Merge recommendation feedback deletion requires authorized scope' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION collectz_scope.guard_merge_feedback_delete() FROM PUBLIC;

DROP TRIGGER IF EXISTS merge_feedback_scoped_delete ON public.media_merge_recommendation_feedback;
CREATE TRIGGER merge_feedback_scoped_delete
  BEFORE DELETE ON public.media_merge_recommendation_feedback
  FOR EACH ROW EXECUTE FUNCTION collectz_scope.guard_merge_feedback_delete();
