CREATE TABLE IF NOT EXISTS public.canonical_media_field_controls (
  space_id INTEGER NOT NULL REFERENCES public.spaces(id) ON DELETE RESTRICT,
  media_id INTEGER NOT NULL REFERENCES public.media(id) ON DELETE CASCADE,
  field_path VARCHAR(160) NOT NULL
    CHECK (field_path ~ '^(media|type_details)\.[a-z][a-z0-9_]{0,79}$'),
  authority VARCHAR(16) NOT NULL
    CHECK (authority IN ('provider', 'manual', 'reviewed')),
  provider_write_mode VARCHAR(16) NOT NULL DEFAULT 'preserve'
    CHECK (provider_write_mode IN ('preserve', 'refresh')),
  locked BOOLEAN NOT NULL DEFAULT false,
  source_provider_connection_id UUID,
  last_observed_at TIMESTAMPTZ,
  decided_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (media_id, field_path),
  CONSTRAINT canonical_media_field_controls_connection_scope_fk
    FOREIGN KEY (space_id, source_provider_connection_id)
    REFERENCES public.provider_connections(space_id, id) ON DELETE RESTRICT,
  CONSTRAINT canonical_media_field_controls_provider_source_check
    CHECK (authority <> 'provider' OR source_provider_connection_id IS NOT NULL),
  CONSTRAINT canonical_media_field_controls_refresh_check
    CHECK (
      provider_write_mode <> 'refresh'
      OR (
        authority IN ('provider', 'reviewed')
        AND source_provider_connection_id IS NOT NULL
        AND NOT locked
      )
    ),
  CONSTRAINT canonical_media_field_controls_lock_check
    CHECK (NOT locked OR provider_write_mode = 'preserve')
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'canonical_media_field_controls_media_scope_fk') THEN
    ALTER TABLE public.canonical_media_field_controls
      ADD CONSTRAINT canonical_media_field_controls_media_scope_fk
      FOREIGN KEY (media_id, space_id)
      REFERENCES public.media(id, space_id) ON DELETE CASCADE;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_canonical_media_field_controls_scope
  ON public.canonical_media_field_controls(space_id, media_id);
CREATE INDEX IF NOT EXISTS idx_canonical_media_field_controls_provider
  ON public.canonical_media_field_controls(space_id, source_provider_connection_id)
  WHERE source_provider_connection_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_canonical_media_field_controls_updated_at') THEN
    CREATE TRIGGER update_canonical_media_field_controls_updated_at
      BEFORE UPDATE ON public.canonical_media_field_controls
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END;
$$;

ALTER TABLE public.canonical_media_field_controls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS canonical_media_field_controls_scope ON public.canonical_media_field_controls;
CREATE POLICY canonical_media_field_controls_scope ON public.canonical_media_field_controls
  USING (collectz_scope.allows_workspace(space_id))
  WITH CHECK (collectz_scope.allows_workspace(space_id));
