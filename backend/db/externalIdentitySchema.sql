CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.media
  ADD COLUMN IF NOT EXISTS public_id UUID;

ALTER TABLE public.media
  ALTER COLUMN public_id SET DEFAULT gen_random_uuid();

CREATE OR REPLACE FUNCTION collectz_scope.allows_workspace(p_space INTEGER)
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
  );
$$;
REVOKE ALL ON FUNCTION collectz_scope.allows_workspace(integer) FROM PUBLIC;

CREATE TABLE IF NOT EXISTS public.provider_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id INTEGER NOT NULL REFERENCES public.spaces(id) ON DELETE RESTRICT,
  provider_type VARCHAR(80) NOT NULL CHECK (provider_type ~ '^[a-z][a-z0-9_-]{1,79}$'),
  display_name VARCHAR(255) NOT NULL CHECK (BTRIM(display_name) <> ''),
  endpoint_url TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'archived')),
  settings JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
  created_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  disabled_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  CONSTRAINT provider_connections_lifecycle_check CHECK (
    (status = 'active' AND disabled_at IS NULL AND archived_at IS NULL)
    OR (status = 'disabled' AND disabled_at IS NOT NULL AND archived_at IS NULL)
    OR (status = 'archived' AND archived_at IS NOT NULL)
  ),
  CONSTRAINT provider_connections_space_id_id_key UNIQUE (space_id, id)
);

CREATE TABLE IF NOT EXISTS public.provider_connection_credentials (
  provider_connection_id UUID PRIMARY KEY,
  space_id INTEGER NOT NULL,
  secret_payload_encrypted TEXT NOT NULL CHECK (BTRIM(secret_payload_encrypted) <> ''),
  updated_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT provider_connection_credentials_owner_fk
    FOREIGN KEY (space_id, provider_connection_id)
    REFERENCES public.provider_connections(space_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.external_media_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id INTEGER NOT NULL REFERENCES public.spaces(id) ON DELETE RESTRICT,
  provider_connection_id UUID NOT NULL,
  identity_kind VARCHAR(80) NOT NULL CHECK (identity_kind ~ '^[a-z][a-z0-9_.:-]{0,79}$'),
  external_id_raw TEXT NOT NULL CHECK (BTRIM(external_id_raw) <> ''),
  external_id_normalized TEXT NOT NULL CHECK (BTRIM(external_id_normalized) <> ''),
  media_id INTEGER NOT NULL REFERENCES public.media(id) ON DELETE RESTRICT,
  source_url TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  active BOOLEAN NOT NULL DEFAULT true,
  deactivated_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT external_media_identities_connection_fk
    FOREIGN KEY (space_id, provider_connection_id)
    REFERENCES public.provider_connections(space_id, id) ON DELETE RESTRICT,
  CONSTRAINT external_media_identities_lifecycle_check
    CHECK ((active AND deactivated_at IS NULL) OR (NOT active AND deactivated_at IS NOT NULL)),
  CONSTRAINT external_media_identities_seen_check CHECK (last_seen_at >= first_seen_at),
  CONSTRAINT external_media_identities_space_id_id_key UNIQUE (space_id, id)
);

CREATE TABLE IF NOT EXISTS public.external_media_identity_events (
  id BIGSERIAL PRIMARY KEY,
  space_id INTEGER NOT NULL REFERENCES public.spaces(id) ON DELETE RESTRICT,
  identity_id UUID NOT NULL,
  event_type VARCHAR(24) NOT NULL CHECK (event_type IN ('attached', 'observed', 'deactivated', 'reactivated', 'reassigned')),
  from_media_id INTEGER REFERENCES public.media(id) ON DELETE RESTRICT,
  to_media_id INTEGER REFERENCES public.media(id) ON DELETE RESTRICT,
  actor_user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT external_media_identity_events_identity_fk
    FOREIGN KEY (space_id, identity_id)
    REFERENCES public.external_media_identities(space_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_provider_connections_space_status
  ON public.provider_connections(space_id, status, provider_type);
CREATE INDEX IF NOT EXISTS idx_external_media_identities_media
  ON public.external_media_identities(space_id, media_id, active);
CREATE INDEX IF NOT EXISTS idx_external_media_identity_events_identity
  ON public.external_media_identity_events(space_id, identity_id, occurred_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS external_media_identities_active_key
  ON public.external_media_identities(space_id, provider_connection_id, identity_kind, external_id_normalized)
  WHERE active;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_provider_connections_updated_at') THEN
    CREATE TRIGGER update_provider_connections_updated_at BEFORE UPDATE ON public.provider_connections
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_provider_connection_credentials_updated_at') THEN
    CREATE TRIGGER update_provider_connection_credentials_updated_at BEFORE UPDATE ON public.provider_connection_credentials
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END;
$$;

ALTER TABLE public.provider_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_connection_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_media_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_media_identity_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS provider_connections_scope ON public.provider_connections;
CREATE POLICY provider_connections_scope ON public.provider_connections
  USING (collectz_scope.allows_workspace(space_id))
  WITH CHECK (collectz_scope.allows_workspace(space_id));
DROP POLICY IF EXISTS provider_connection_credentials_scope ON public.provider_connection_credentials;
CREATE POLICY provider_connection_credentials_scope ON public.provider_connection_credentials
  USING (collectz_scope.allows_workspace(space_id))
  WITH CHECK (collectz_scope.allows_workspace(space_id));
DROP POLICY IF EXISTS external_media_identities_scope ON public.external_media_identities;
CREATE POLICY external_media_identities_scope ON public.external_media_identities
  USING (collectz_scope.allows_workspace(space_id))
  WITH CHECK (collectz_scope.allows_workspace(space_id));
DROP POLICY IF EXISTS external_media_identity_events_scope ON public.external_media_identity_events;
CREATE POLICY external_media_identity_events_scope ON public.external_media_identity_events
  USING (collectz_scope.allows_workspace(space_id))
  WITH CHECK (collectz_scope.allows_workspace(space_id));
