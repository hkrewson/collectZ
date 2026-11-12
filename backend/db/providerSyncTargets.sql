CREATE TABLE IF NOT EXISTS public.provider_sync_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id INTEGER NOT NULL REFERENCES public.spaces(id) ON DELETE RESTRICT,
  provider_connection_id UUID NOT NULL,
  library_id INTEGER NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  interval_minutes INTEGER NOT NULL DEFAULT 360 CHECK (interval_minutes BETWEEN 60 AND 10080),
  last_enqueued_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT provider_sync_targets_connection_fk
    FOREIGN KEY (space_id, provider_connection_id)
    REFERENCES public.provider_connections(space_id, id) ON DELETE RESTRICT,
  CONSTRAINT provider_sync_targets_library_fk
    FOREIGN KEY (space_id, library_id)
    REFERENCES public.libraries(space_id, id) ON DELETE RESTRICT,
  CONSTRAINT provider_sync_targets_connection_key
    UNIQUE (provider_connection_id)
);

CREATE INDEX IF NOT EXISTS provider_sync_targets_due
  ON public.provider_sync_targets(space_id, enabled, last_enqueued_at)
  WHERE enabled;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_provider_sync_targets_updated_at') THEN
    CREATE TRIGGER update_provider_sync_targets_updated_at
      BEFORE UPDATE ON public.provider_sync_targets
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END;
$$;

ALTER TABLE public.provider_sync_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS provider_sync_targets_scope ON public.provider_sync_targets;
CREATE POLICY provider_sync_targets_scope ON public.provider_sync_targets
  USING (collectz_scope.allows_workspace(space_id))
  WITH CHECK (collectz_scope.allows_workspace(space_id));
