-- Durable workers need a different authorization shape from authenticated
-- actors. Keep their transaction grants separate so neither path can broaden
-- the other, and defer sync_jobs RLS until every lifecycle path adopts this
-- contract.
CREATE TABLE IF NOT EXISTS collectz_scope.worker_transactions (
  backend_pid INTEGER NOT NULL,
  transaction_id TEXT NOT NULL,
  runtime_role NAME NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('claim', 'recover', 'lifecycle')),
  worker_id TEXT NOT NULL CHECK (
    char_length(worker_id) BETWEEN 1 AND 160
    AND worker_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$'
  ),
  job_types TEXT[] NOT NULL CHECK (
    cardinality(job_types) BETWEEN 1 AND 16
    AND array_position(job_types, NULL) IS NULL
  ),
  space_id INTEGER,
  library_id INTEGER,
  server_started TIMESTAMPTZ NOT NULL DEFAULT pg_postmaster_start_time(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp() + interval '5 minutes',
  PRIMARY KEY (backend_pid, transaction_id),
  CHECK (
    (action IN ('claim', 'recover') AND space_id IS NULL AND library_id IS NULL)
    OR (action = 'lifecycle' AND space_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS worker_scope_transactions_expiry
  ON collectz_scope.worker_transactions(expires_at);
REVOKE ALL ON collectz_scope.worker_transactions FROM PUBLIC;

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
     OR p_action NOT IN ('claim', 'recover', 'lifecycle')
     OR p_worker IS NULL OR char_length(p_worker) NOT BETWEEN 1 AND 160
     OR p_worker !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$'
     OR normalized_job_types IS NULL OR cardinality(normalized_job_types) NOT BETWEEN 1 AND 16
     OR EXISTS (
       SELECT 1 FROM unnest(normalized_job_types) AS job_type
        WHERE job_type !~ '^[a-z][a-z0-9_.:-]{1,79}$'
     )
     OR (p_action IN ('claim', 'recover') AND (p_space IS NOT NULL OR p_library IS NOT NULL))
     OR (p_action = 'lifecycle' AND (p_space IS NULL OR p_space <= 0))
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

  IF p_action = 'lifecycle' AND (
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

CREATE OR REPLACE FUNCTION collectz_scope.revoke_worker(p_pid INTEGER, p_xid TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  DELETE FROM collectz_scope.worker_transactions
   WHERE backend_pid = p_pid
     AND transaction_id = p_xid
     AND runtime_role = (
       SELECT runtime_role FROM collectz_scope.brokers WHERE broker_role = session_user
     );
$$;

CREATE OR REPLACE FUNCTION collectz_scope.worker_allows_global(p_action TEXT, p_job_type TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM collectz_scope.worker_transactions grant_row
     WHERE grant_row.backend_pid = pg_backend_pid()
       AND grant_row.transaction_id = pg_current_xact_id()::text
       AND grant_row.runtime_role = session_user
       AND grant_row.server_started = pg_postmaster_start_time()
       AND grant_row.expires_at > statement_timestamp()
       AND grant_row.action = p_action
       AND lower(p_job_type) = ANY(grant_row.job_types)
       AND grant_row.space_id IS NULL
       AND grant_row.library_id IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION collectz_scope.worker_allows_lifecycle(
  p_space INTEGER,
  p_library INTEGER,
  p_job_type TEXT,
  p_lease_owner TEXT
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
       AND grant_row.worker_id = p_lease_owner
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

REVOKE ALL ON FUNCTION collectz_scope.authorize_worker(integer,text,text,text,text[],integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION collectz_scope.revoke_worker(integer,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION collectz_scope.worker_allows_global(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION collectz_scope.worker_allows_lifecycle(integer,integer,text,text) FROM PUBLIC;
