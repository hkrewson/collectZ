-- Add an exact-workspace grant for token-validated webhook ingestion. The
-- grant cannot claim or mutate job lifecycle state.
ALTER TABLE collectz_scope.worker_transactions
  DROP CONSTRAINT IF EXISTS worker_transactions_action_check;
ALTER TABLE collectz_scope.worker_transactions
  DROP CONSTRAINT IF EXISTS worker_transactions_check;
ALTER TABLE collectz_scope.worker_transactions
  ADD CONSTRAINT worker_transactions_action_check
  CHECK (action IN ('claim', 'recover', 'lifecycle', 'observe', 'maintain', 'ingest'));
ALTER TABLE collectz_scope.worker_transactions
  ADD CONSTRAINT worker_transactions_check
  CHECK (
    (action IN ('claim', 'recover', 'observe', 'maintain') AND space_id IS NULL AND library_id IS NULL)
    OR (action = 'lifecycle' AND space_id IS NOT NULL)
    OR (action = 'ingest' AND space_id IS NOT NULL AND library_id IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION collectz_scope.authorize_worker(
  p_pid INTEGER,
  p_xid TEXT,
  p_action TEXT,
  p_worker TEXT,
  p_job_types TEXT[],
  p_space INTEGER,
  p_library INTEGER
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  target_role NAME;
  normalized_job_types TEXT[];
BEGIN
  SELECT runtime_role INTO target_role
    FROM collectz_scope.brokers
   WHERE broker_role = session_user;

  SELECT array_agg(DISTINCT lower(value) ORDER BY lower(value))
    INTO normalized_job_types
    FROM unnest(p_job_types) AS value;

  IF target_role IS NULL
     OR p_xid IS NULL OR p_xid !~ '^[0-9]+$'
     OR p_action NOT IN ('claim', 'recover', 'lifecycle', 'observe', 'maintain', 'ingest')
     OR p_worker IS NULL OR char_length(p_worker) NOT BETWEEN 1 AND 160
     OR p_worker !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$'
     OR normalized_job_types IS NULL OR cardinality(normalized_job_types) NOT BETWEEN 1 AND 16
     OR EXISTS (
       SELECT 1 FROM unnest(normalized_job_types) AS job_type
        WHERE job_type !~ '^[a-z][a-z0-9_.:-]{1,79}$'
     )
     OR (p_action IN ('claim', 'recover', 'observe', 'maintain') AND (p_space IS NOT NULL OR p_library IS NOT NULL))
     OR (p_action = 'lifecycle' AND (p_space IS NULL OR p_space <= 0))
     OR (p_action = 'ingest' AND (
       p_space IS NULL OR p_space <= 0 OR p_library IS NULL OR p_library <= 0
     ))
     OR (p_library IS NOT NULL AND p_library <= 0) THEN
    RAISE EXCEPTION 'Invalid worker database scope grant' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_stat_activity
     WHERE pid = p_pid
       AND usename = target_role
       AND datname = current_database()
       AND backend_xid::text = mod(p_xid::numeric, 4294967296)::text
  ) THEN
    RAISE EXCEPTION 'Database transaction is unavailable' USING ERRCODE = '42501';
  END IF;

  IF p_action IN ('lifecycle', 'ingest') AND (
    NOT EXISTS (SELECT 1 FROM public.spaces WHERE id = p_space AND archived_at IS NULL)
    OR (p_library IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.libraries
       WHERE id = p_library AND space_id = p_space AND archived_at IS NULL
    ))
  ) THEN
    RAISE EXCEPTION 'Invalid worker database scope grant' USING ERRCODE = '42501';
  END IF;

  DELETE FROM collectz_scope.worker_transactions
   WHERE expires_at < clock_timestamp();
  INSERT INTO collectz_scope.worker_transactions(
    backend_pid, transaction_id, runtime_role, action, worker_id,
    job_types, space_id, library_id
  ) VALUES (
    p_pid, p_xid, target_role, p_action, p_worker,
    normalized_job_types, p_space, p_library
  );
END;
$$;

CREATE OR REPLACE FUNCTION collectz_scope.worker_allows_ingest(
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
       AND grant_row.action = 'ingest'
       AND lower(p_job_type) = ANY(grant_row.job_types)
       AND grant_row.space_id = p_space
       AND grant_row.library_id = p_library
       AND EXISTS (
         SELECT 1 FROM public.libraries library_row
          WHERE library_row.id = p_library
            AND library_row.space_id = p_space
            AND library_row.archived_at IS NULL
       )
  );
$$;

REVOKE ALL ON FUNCTION collectz_scope.authorize_worker(integer,text,text,text,text[],integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION collectz_scope.worker_allows_ingest(integer,integer,text) FROM PUBLIC;
