CREATE TABLE IF NOT EXISTS public.provider_integration_bindings (
  space_id INTEGER NOT NULL REFERENCES public.spaces(id) ON DELETE RESTRICT,
  integration_key VARCHAR(80) NOT NULL
    CHECK (integration_key ~ '^[a-z][a-z0-9_.:-]{1,79}$'),
  provider_connection_id UUID NOT NULL,
  created_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (space_id, integration_key),
  CONSTRAINT provider_integration_bindings_connection_scope_fk
    FOREIGN KEY (space_id, provider_connection_id)
    REFERENCES public.provider_connections(space_id, id) ON DELETE RESTRICT,
  CONSTRAINT provider_integration_bindings_connection_key
    UNIQUE (space_id, provider_connection_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_integration_bindings_connection
  ON public.provider_integration_bindings(space_id, provider_connection_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_provider_integration_bindings_updated_at') THEN
    CREATE TRIGGER update_provider_integration_bindings_updated_at
      BEFORE UPDATE ON public.provider_integration_bindings
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END;
$$;

ALTER TABLE public.provider_integration_bindings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS provider_integration_bindings_scope ON public.provider_integration_bindings;
CREATE POLICY provider_integration_bindings_scope ON public.provider_integration_bindings
  USING (collectz_scope.allows_workspace(space_id))
  WITH CHECK (collectz_scope.allows_workspace(space_id));
