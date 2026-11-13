CREATE TABLE IF NOT EXISTS public.provider_series_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id INTEGER NOT NULL REFERENCES public.spaces(id) ON DELETE RESTRICT,
  provider_connection_id UUID NOT NULL,
  provider_series_id VARCHAR(512) NOT NULL,
  name VARCHAR(500) NOT NULL,
  source_kind VARCHAR(40) NOT NULL DEFAULT 'bookorbit_native'
    CHECK (source_kind IN ('bookorbit_native')),
  source_updated_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  active BOOLEAN NOT NULL DEFAULT true,
  deactivated_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT provider_series_records_connection_fk
    FOREIGN KEY (space_id, provider_connection_id)
    REFERENCES public.provider_connections(space_id, id) ON DELETE RESTRICT,
  CONSTRAINT provider_series_records_provider_key
    UNIQUE (space_id, provider_connection_id, provider_series_id),
  CONSTRAINT provider_series_records_scope_key
    UNIQUE (space_id, provider_connection_id, id),
  CONSTRAINT provider_series_records_lifecycle_check
    CHECK ((active AND deactivated_at IS NULL) OR (NOT active AND deactivated_at IS NOT NULL)),
  CONSTRAINT provider_series_records_seen_check
    CHECK (last_seen_at >= first_seen_at)
);

CREATE TABLE IF NOT EXISTS public.media_series_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id INTEGER NOT NULL REFERENCES public.spaces(id) ON DELETE RESTRICT,
  media_id INTEGER NOT NULL,
  provider_connection_id UUID NOT NULL,
  provider_series_record_id UUID NOT NULL,
  series_index VARCHAR(80),
  volume VARCHAR(255),
  issue_number VARCHAR(80),
  display_order INTEGER NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  expected_item_count INTEGER CHECK (expected_item_count IS NULL OR expected_item_count >= 0),
  source_kind VARCHAR(40) NOT NULL DEFAULT 'bookorbit_native'
    CHECK (source_kind IN ('bookorbit_native')),
  source_updated_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  active BOOLEAN NOT NULL DEFAULT true,
  deactivated_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT media_series_memberships_media_fk
    FOREIGN KEY (media_id, space_id)
    REFERENCES public.media(id, space_id) ON DELETE CASCADE,
  CONSTRAINT media_series_memberships_series_fk
    FOREIGN KEY (space_id, provider_connection_id, provider_series_record_id)
    REFERENCES public.provider_series_records(space_id, provider_connection_id, id) ON DELETE CASCADE,
  CONSTRAINT media_series_memberships_provider_key
    UNIQUE (space_id, media_id, provider_series_record_id),
  CONSTRAINT media_series_memberships_lifecycle_check
    CHECK ((active AND deactivated_at IS NULL) OR (NOT active AND deactivated_at IS NOT NULL)),
  CONSTRAINT media_series_memberships_seen_check
    CHECK (last_seen_at >= first_seen_at)
);

CREATE INDEX IF NOT EXISTS provider_series_records_lookup
  ON public.provider_series_records(space_id, provider_connection_id, active, name);

CREATE INDEX IF NOT EXISTS media_series_memberships_media
  ON public.media_series_memberships(space_id, media_id, active, display_order);

CREATE INDEX IF NOT EXISTS media_series_memberships_series
  ON public.media_series_memberships(space_id, provider_series_record_id, active, series_index);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_provider_series_records_updated_at') THEN
    CREATE TRIGGER update_provider_series_records_updated_at
      BEFORE UPDATE ON public.provider_series_records
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_media_series_memberships_updated_at') THEN
    CREATE TRIGGER update_media_series_memberships_updated_at
      BEFORE UPDATE ON public.media_series_memberships
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END;
$$;

ALTER TABLE public.provider_series_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS provider_series_records_scope ON public.provider_series_records;
CREATE POLICY provider_series_records_scope ON public.provider_series_records
  USING (collectz_scope.allows_workspace(space_id))
  WITH CHECK (collectz_scope.allows_workspace(space_id));

ALTER TABLE public.media_series_memberships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS media_series_memberships_scope ON public.media_series_memberships;
CREATE POLICY media_series_memberships_scope ON public.media_series_memberships
  USING (collectz_scope.allows_workspace(space_id))
  WITH CHECK (collectz_scope.allows_workspace(space_id));
