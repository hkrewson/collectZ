-- Durable jobs serve authenticated requests, background workers, and service
-- observers. Refuse activation when retained ownership is incomplete instead
-- of guessing workspace scope for historical rows.
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.sync_jobs j
      LEFT JOIN public.spaces s ON s.id = j.space_id
      LEFT JOIN public.libraries l
        ON l.id = j.library_id
       AND l.space_id = j.space_id
     WHERE j.space_id IS NULL
        OR s.id IS NULL
        OR (j.library_id IS NOT NULL AND l.id IS NULL)
  ) THEN
    RAISE EXCEPTION 'Durable jobs have unresolved ownership; repair before migration 144';
  END IF;
END;
$$;

-- Lifecycle updates require the old row to remain bound to the lease owner.
-- Their new row may clear the lease during settlement, so visibility and the
-- post-update check use this exact workspace/library/type predicate instead.
CREATE OR REPLACE FUNCTION collectz_scope.worker_allows_lifecycle_scope(
  p_space INTEGER,
  p_library INTEGER,
  p_job_type TEXT
)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM collectz_scope.worker_transactions grant_row
     WHERE grant_row.backend_pid = pg_backend_pid()
       AND grant_row.transaction_id = pg_current_xact_id()::text
       AND grant_row.runtime_role = session_user
       AND grant_row.server_started = pg_postmaster_start_time()
       AND grant_row.expires_at > statement_timestamp()
       AND grant_row.action = 'lifecycle'
       AND lower(p_job_type) = ANY(grant_row.job_types)
       AND grant_row.space_id = p_space
       AND (grant_row.library_id IS NULL OR grant_row.library_id = p_library)
       AND (p_library IS NULL OR EXISTS (
         SELECT 1 FROM public.libraries library_row
          WHERE library_row.id = p_library
            AND library_row.space_id = p_space
            AND library_row.archived_at IS NULL
       ))
  );
$$;
REVOKE ALL ON FUNCTION collectz_scope.worker_allows_lifecycle_scope(integer,integer,text) FROM PUBLIC;

ALTER TABLE public.sync_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sync_jobs_actor_select ON public.sync_jobs;
CREATE POLICY sync_jobs_actor_select ON public.sync_jobs
  FOR SELECT
  USING (collectz_scope.allows_workspace(space_id));

DROP POLICY IF EXISTS sync_jobs_actor_insert ON public.sync_jobs;
CREATE POLICY sync_jobs_actor_insert ON public.sync_jobs
  FOR INSERT
  WITH CHECK (collectz_scope.allows_workspace(space_id));

DROP POLICY IF EXISTS sync_jobs_actor_update ON public.sync_jobs;
CREATE POLICY sync_jobs_actor_update ON public.sync_jobs
  FOR UPDATE
  USING (collectz_scope.allows_workspace(space_id))
  WITH CHECK (collectz_scope.allows_workspace(space_id));

DROP POLICY IF EXISTS sync_jobs_actor_delete ON public.sync_jobs;
CREATE POLICY sync_jobs_actor_delete ON public.sync_jobs
  FOR DELETE
  USING (collectz_scope.allows_workspace(space_id));

DROP POLICY IF EXISTS sync_jobs_worker_select ON public.sync_jobs;
CREATE POLICY sync_jobs_worker_select ON public.sync_jobs
  FOR SELECT
  USING (
    collectz_scope.worker_allows_global('claim', job_type)
    OR collectz_scope.worker_allows_global('recover', job_type)
    OR collectz_scope.worker_allows_global('observe', job_type)
    OR collectz_scope.worker_allows_global('maintain', job_type)
    OR collectz_scope.worker_allows_lifecycle_scope(space_id, library_id, job_type)
    OR collectz_scope.worker_allows_ingest(space_id, library_id, job_type)
  );

DROP POLICY IF EXISTS sync_jobs_worker_insert ON public.sync_jobs;
CREATE POLICY sync_jobs_worker_insert ON public.sync_jobs
  FOR INSERT
  WITH CHECK (collectz_scope.worker_allows_ingest(space_id, library_id, job_type));

DROP POLICY IF EXISTS sync_jobs_worker_update ON public.sync_jobs;
CREATE POLICY sync_jobs_worker_update ON public.sync_jobs
  FOR UPDATE
  USING (
    collectz_scope.worker_allows_global('claim', job_type)
    OR collectz_scope.worker_allows_global('recover', job_type)
    OR collectz_scope.worker_allows_global('maintain', job_type)
    OR collectz_scope.worker_allows_lifecycle(space_id, library_id, job_type, lease_owner)
  )
  WITH CHECK (
    collectz_scope.worker_allows_global('claim', job_type)
    OR collectz_scope.worker_allows_global('recover', job_type)
    OR collectz_scope.worker_allows_global('maintain', job_type)
    OR collectz_scope.worker_allows_lifecycle_scope(space_id, library_id, job_type)
  );
