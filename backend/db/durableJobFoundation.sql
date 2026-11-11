ALTER TABLE public.sync_jobs
  ADD COLUMN IF NOT EXISTS public_id UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS job_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS space_id INTEGER,
  ADD COLUMN IF NOT EXISTS library_id INTEGER,
  ADD COLUMN IF NOT EXISTS provider_connection_id UUID,
  ADD COLUMN IF NOT EXISTS correlation_id UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS target_ref JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS lease_owner TEXT,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

UPDATE public.sync_jobs
   SET public_id = gen_random_uuid()
 WHERE public_id IS NULL;

UPDATE public.sync_jobs
   SET correlation_id = gen_random_uuid()
 WHERE correlation_id IS NULL;

UPDATE public.sync_jobs j
   SET space_id = parsed.space_id
  FROM (
    SELECT id, (scope->>'spaceId')::INTEGER AS space_id
      FROM public.sync_jobs
     WHERE scope->>'spaceId' ~ '^[0-9]+$'
  ) parsed
  JOIN public.spaces s ON s.id = parsed.space_id
 WHERE j.id = parsed.id
   AND j.space_id IS NULL;

UPDATE public.sync_jobs j
   SET library_id = parsed.library_id
  FROM (
    SELECT id, (scope->>'libraryId')::INTEGER AS library_id
      FROM public.sync_jobs
     WHERE scope->>'libraryId' ~ '^[0-9]+$'
  ) parsed
  JOIN public.libraries l ON l.id = parsed.library_id
 WHERE j.id = parsed.id
   AND j.library_id IS NULL
   AND (j.space_id IS NULL OR l.space_id = j.space_id);

UPDATE public.sync_jobs j
   SET provider_connection_id = parsed.provider_connection_id
  FROM (
    SELECT id, (scope->>'connectionId')::UUID AS provider_connection_id
      FROM public.sync_jobs
     WHERE scope->>'connectionId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) parsed
  JOIN public.provider_connections pc ON pc.id = parsed.provider_connection_id
 WHERE j.id = parsed.id
   AND j.provider_connection_id IS NULL
   AND (j.space_id IS NULL OR pc.space_id = j.space_id);

ALTER TABLE public.sync_jobs
  ALTER COLUMN public_id SET NOT NULL,
  ALTER COLUMN public_id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN correlation_id SET NOT NULL,
  ALTER COLUMN correlation_id SET DEFAULT gen_random_uuid();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'libraries_space_id_id_key'
       AND conrelid = 'public.libraries'::regclass
  ) THEN
    ALTER TABLE public.libraries
      ADD CONSTRAINT libraries_space_id_id_key UNIQUE (space_id, id);
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'sync_jobs_status_check'
       AND conrelid = 'public.sync_jobs'::regclass
  ) THEN
    ALTER TABLE public.sync_jobs DROP CONSTRAINT sync_jobs_status_check;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'sync_jobs_status_check'
       AND conrelid = 'public.sync_jobs'::regclass
  ) THEN
    ALTER TABLE public.sync_jobs
      ADD CONSTRAINT sync_jobs_status_check
      CHECK (status IN ('queued', 'running', 'retry_wait', 'cancelled', 'failed', 'succeeded'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'sync_jobs_public_id_key'
       AND conrelid = 'public.sync_jobs'::regclass
  ) THEN
    ALTER TABLE public.sync_jobs
      ADD CONSTRAINT sync_jobs_public_id_key UNIQUE (public_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'sync_jobs_space_fk'
       AND conrelid = 'public.sync_jobs'::regclass
  ) THEN
    ALTER TABLE public.sync_jobs
      ADD CONSTRAINT sync_jobs_space_fk
      FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'sync_jobs_library_scope_fk'
       AND conrelid = 'public.sync_jobs'::regclass
  ) THEN
    ALTER TABLE public.sync_jobs
      ADD CONSTRAINT sync_jobs_library_scope_fk
      FOREIGN KEY (space_id, library_id)
      REFERENCES public.libraries(space_id, id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'sync_jobs_connection_scope_fk'
       AND conrelid = 'public.sync_jobs'::regclass
  ) THEN
    ALTER TABLE public.sync_jobs
      ADD CONSTRAINT sync_jobs_connection_scope_fk
      FOREIGN KEY (space_id, provider_connection_id)
      REFERENCES public.provider_connections(space_id, id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'sync_jobs_attempt_count_check'
       AND conrelid = 'public.sync_jobs'::regclass
  ) THEN
    ALTER TABLE public.sync_jobs
      ADD CONSTRAINT sync_jobs_attempt_count_check
      CHECK (attempt_count >= 0 AND max_attempts >= 1 AND attempt_count <= max_attempts);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'sync_jobs_target_ref_object_check'
       AND conrelid = 'public.sync_jobs'::regclass
  ) THEN
    ALTER TABLE public.sync_jobs
      ADD CONSTRAINT sync_jobs_target_ref_object_check
      CHECK (jsonb_typeof(target_ref) = 'object');
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS sync_jobs_durable_idempotency_key
  ON public.sync_jobs(space_id, job_type, provider, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS sync_jobs_durable_claim
  ON public.sync_jobs(status, available_at, created_at)
  WHERE status IN ('queued', 'retry_wait');

CREATE INDEX IF NOT EXISTS sync_jobs_expired_lease
  ON public.sync_jobs(lease_expires_at)
  WHERE status = 'running';

CREATE INDEX IF NOT EXISTS sync_jobs_workspace_recent
  ON public.sync_jobs(space_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_sync_job_identity_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.public_id IS DISTINCT FROM OLD.public_id
     OR NEW.job_type IS DISTINCT FROM OLD.job_type
     OR NEW.job_version IS DISTINCT FROM OLD.job_version
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.space_id IS DISTINCT FROM OLD.space_id
     OR NEW.library_id IS DISTINCT FROM OLD.library_id
     OR NEW.provider_connection_id IS DISTINCT FROM OLD.provider_connection_id
     OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
    RAISE EXCEPTION 'durable job identity and ownership are immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_jobs_immutable_identity ON public.sync_jobs;
CREATE TRIGGER sync_jobs_immutable_identity
  BEFORE UPDATE ON public.sync_jobs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_sync_job_identity_mutation();
