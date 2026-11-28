-- 3.31.6 promotes reviewed source identifiers onto their correct Work or
-- Edition target. Raw capture facts remain immutable observation evidence.

CREATE UNIQUE INDEX IF NOT EXISTS edition_source_observations_id_space_library_key
  ON public.edition_source_observations(id, space_id, library_id);

CREATE TABLE IF NOT EXISTS public.collection_object_identifiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id INTEGER NOT NULL REFERENCES public.spaces(id) ON DELETE RESTRICT,
  library_id INTEGER NOT NULL,
  target_kind VARCHAR(20) NOT NULL CHECK (target_kind IN ('work', 'edition')),
  work_id UUID,
  edition_id UUID,
  identifier_scheme VARCHAR(80) NOT NULL
    CHECK (identifier_scheme ~ '^[a-z][a-z0-9_.:-]{1,79}$'),
  identifier_value_raw VARCHAR(500) NOT NULL CHECK (btrim(identifier_value_raw) <> ''),
  identifier_value_normalized VARCHAR(500) NOT NULL
    CHECK (btrim(identifier_value_normalized) <> ''),
  resolution_strength VARCHAR(20) NOT NULL
    CHECK (resolution_strength IN ('exclusive', 'corroborating', 'grouping')),
  source_provider VARCHAR(80) NOT NULL
    CHECK (source_provider ~ '^[a-z][a-z0-9_.:-]{1,79}$'),
  source_observation_id UUID,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT collection_object_identifiers_library_fk
    FOREIGN KEY (space_id, library_id)
    REFERENCES public.libraries(space_id, id) ON DELETE CASCADE,
  CONSTRAINT collection_object_identifiers_work_fk
    FOREIGN KEY (work_id, space_id, library_id)
    REFERENCES public.collection_works(id, space_id, library_id) ON DELETE CASCADE,
  CONSTRAINT collection_object_identifiers_edition_fk
    FOREIGN KEY (edition_id, space_id, library_id)
    REFERENCES public.collection_editions(id, space_id, library_id) ON DELETE CASCADE,
  CONSTRAINT collection_object_identifiers_observation_fk
    FOREIGN KEY (source_observation_id, space_id, library_id)
    REFERENCES public.edition_source_observations(id, space_id, library_id)
    ON DELETE SET NULL (source_observation_id),
  CONSTRAINT collection_object_identifiers_target_check CHECK (
    (target_kind = 'work' AND work_id IS NOT NULL AND edition_id IS NULL)
    OR
    (target_kind = 'edition' AND edition_id IS NOT NULL AND work_id IS NULL)
  ),
  CONSTRAINT collection_object_identifiers_seen_check CHECK (last_seen_at >= first_seen_at),
  CONSTRAINT collection_object_identifiers_id_scope_key UNIQUE (id, space_id, library_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS collection_object_identifiers_work_value_key
  ON public.collection_object_identifiers(
    space_id, library_id, work_id, identifier_scheme, identifier_value_normalized
  ) WHERE target_kind = 'work';

CREATE UNIQUE INDEX IF NOT EXISTS collection_object_identifiers_edition_value_key
  ON public.collection_object_identifiers(
    space_id, library_id, edition_id, identifier_scheme, identifier_value_normalized
  ) WHERE target_kind = 'edition';

-- These schemes are authoritative resolution keys. The other supported
-- schemes deliberately permit collisions and therefore require context.
CREATE UNIQUE INDEX IF NOT EXISTS collection_object_identifiers_imdb_exclusive_key
  ON public.collection_object_identifiers(space_id, library_id, identifier_scheme, identifier_value_normalized)
  WHERE target_kind = 'work' AND identifier_scheme = 'imdb.title';

CREATE UNIQUE INDEX IF NOT EXISTS collection_object_identifiers_bluray_product_exclusive_key
  ON public.collection_object_identifiers(space_id, library_id, identifier_scheme, identifier_value_normalized)
  WHERE target_kind = 'edition' AND identifier_scheme = 'bluray.product';

CREATE INDEX IF NOT EXISTS collection_object_identifiers_lookup
  ON public.collection_object_identifiers(
    space_id, library_id, identifier_scheme, identifier_value_normalized, target_kind
  );

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_collection_object_identifiers_updated_at') THEN
    CREATE TRIGGER update_collection_object_identifiers_updated_at
      BEFORE UPDATE ON public.collection_object_identifiers
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END;
$$;

ALTER TABLE public.collection_object_identifiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collection_object_identifiers_scope ON public.collection_object_identifiers;
CREATE POLICY collection_object_identifiers_scope ON public.collection_object_identifiers
  USING (collectz_scope.allows_library(space_id, library_id))
  WITH CHECK (collectz_scope.allows_library(space_id, library_id));
