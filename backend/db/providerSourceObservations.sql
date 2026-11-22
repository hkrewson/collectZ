CREATE UNIQUE INDEX IF NOT EXISTS external_media_identities_observation_scope_key
  ON public.external_media_identities(space_id, provider_connection_id, id);

CREATE TABLE IF NOT EXISTS public.provider_source_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id INTEGER NOT NULL REFERENCES public.spaces(id) ON DELETE RESTRICT,
  provider_connection_id UUID NOT NULL,
  external_identity_id UUID NOT NULL,
  observed_media_public_id UUID NOT NULL,
  source_kind VARCHAR(80) NOT NULL
    CHECK (source_kind ~ '^[a-z][a-z0-9_.:-]{1,79}$'),
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  idempotency_key CHAR(64) NOT NULL CHECK (idempotency_key ~ '^[0-9a-f]{64}$'),
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  normalized_facts JSONB NOT NULL CHECK (jsonb_typeof(normalized_facts) = 'object'),
  source_updated_at TIMESTAMPTZ,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor_user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT provider_source_observations_connection_fk
    FOREIGN KEY (space_id, provider_connection_id)
    REFERENCES public.provider_connections(space_id, id) ON DELETE RESTRICT,
  CONSTRAINT provider_source_observations_identity_fk
    FOREIGN KEY (space_id, provider_connection_id, external_identity_id)
    REFERENCES public.external_media_identities(space_id, provider_connection_id, id) ON DELETE RESTRICT,
  CONSTRAINT provider_source_observations_idempotency_key
    UNIQUE (space_id, provider_connection_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS provider_source_observations_identity_time
  ON public.provider_source_observations(space_id, external_identity_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS provider_source_observations_media_time
  ON public.provider_source_observations(space_id, observed_media_public_id, observed_at DESC);

CREATE OR REPLACE FUNCTION collectz_scope.append_only_provider_source_observation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Provider source observations are append-only' USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION collectz_scope.append_only_provider_source_observation() FROM PUBLIC;

DROP TRIGGER IF EXISTS provider_source_observations_append_only ON public.provider_source_observations;
CREATE TRIGGER provider_source_observations_append_only
  BEFORE UPDATE OR DELETE ON public.provider_source_observations
  FOR EACH ROW EXECUTE FUNCTION collectz_scope.append_only_provider_source_observation();

ALTER TABLE public.provider_source_observations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS provider_source_observations_scope ON public.provider_source_observations;
CREATE POLICY provider_source_observations_scope ON public.provider_source_observations
  USING (collectz_scope.allows_workspace(space_id))
  WITH CHECK (collectz_scope.allows_workspace(space_id));
