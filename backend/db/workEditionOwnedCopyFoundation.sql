-- 3.31.0 expands the collection model without rewriting existing media rows.
-- Existing media and media_variants remain compatibility projections while
-- reviewed Blu-ray intake begins writing explicit Work, Edition, and Owned Copy
-- records.

CREATE UNIQUE INDEX IF NOT EXISTS media_id_space_library_key
  ON public.media(id, space_id, library_id);

CREATE UNIQUE INDEX IF NOT EXISTS capture_items_id_space_library_key
  ON public.capture_items(id, space_id, library_id);

CREATE TABLE IF NOT EXISTS public.collection_works (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id INTEGER NOT NULL REFERENCES public.spaces(id) ON DELETE RESTRICT,
  library_id INTEGER NOT NULL,
  media_id INTEGER NOT NULL,
  work_kind VARCHAR(30) NOT NULL
    CHECK (work_kind IN ('movie', 'tv_series', 'book', 'comic_book', 'audio', 'game', 'other')),
  created_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT collection_works_library_fk
    FOREIGN KEY (space_id, library_id)
    REFERENCES public.libraries(space_id, id) ON DELETE CASCADE,
  CONSTRAINT collection_works_media_fk
    FOREIGN KEY (media_id, space_id, library_id)
    REFERENCES public.media(id, space_id, library_id) ON DELETE CASCADE,
  CONSTRAINT collection_works_media_key UNIQUE (space_id, library_id, media_id),
  CONSTRAINT collection_works_id_scope_key UNIQUE (id, space_id, library_id)
);

CREATE INDEX IF NOT EXISTS collection_works_scope_time
  ON public.collection_works(space_id, library_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.collection_editions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id INTEGER NOT NULL REFERENCES public.spaces(id) ON DELETE RESTRICT,
  library_id INTEGER NOT NULL,
  work_id UUID NOT NULL,
  source_provider VARCHAR(80) NOT NULL
    CHECK (source_provider ~ '^[a-z][a-z0-9_.:-]{1,79}$'),
  source_item_id VARCHAR(255) NOT NULL CHECK (btrim(source_item_id) <> ''),
  edition_name VARCHAR(255),
  release_date DATE,
  format_label VARCHAR(100),
  owned_formats TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  technical_facts JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(technical_facts) = 'object'),
  reviewed_at TIMESTAMPTZ NOT NULL,
  reviewed_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT collection_editions_library_fk
    FOREIGN KEY (space_id, library_id)
    REFERENCES public.libraries(space_id, id) ON DELETE CASCADE,
  CONSTRAINT collection_editions_work_fk
    FOREIGN KEY (work_id, space_id, library_id)
    REFERENCES public.collection_works(id, space_id, library_id) ON DELETE CASCADE,
  CONSTRAINT collection_editions_source_key
    UNIQUE (space_id, library_id, source_provider, source_item_id),
  CONSTRAINT collection_editions_id_scope_key UNIQUE (id, space_id, library_id)
);

CREATE INDEX IF NOT EXISTS collection_editions_work_time
  ON public.collection_editions(space_id, library_id, work_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.owned_copies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id INTEGER NOT NULL REFERENCES public.spaces(id) ON DELETE RESTRICT,
  library_id INTEGER NOT NULL,
  edition_id UUID NOT NULL,
  ownership_status VARCHAR(20) NOT NULL DEFAULT 'owned'
    CHECK (ownership_status IN ('owned', 'ordered', 'loaned', 'for_sale')),
  source_kind VARCHAR(40) NOT NULL
    CHECK (source_kind ~ '^[a-z][a-z0-9_.:-]{1,39}$'),
  source_item_key VARCHAR(255) NOT NULL CHECK (btrim(source_item_key) <> ''),
  condition_label VARCHAR(100),
  location VARCHAR(255),
  acquisition_notes TEXT CHECK (acquisition_notes IS NULL OR char_length(acquisition_notes) <= 2000),
  acquired_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT owned_copies_library_fk
    FOREIGN KEY (space_id, library_id)
    REFERENCES public.libraries(space_id, id) ON DELETE CASCADE,
  CONSTRAINT owned_copies_edition_fk
    FOREIGN KEY (edition_id, space_id, library_id)
    REFERENCES public.collection_editions(id, space_id, library_id) ON DELETE CASCADE,
  CONSTRAINT owned_copies_intake_key
    UNIQUE (space_id, library_id, source_kind, source_item_key),
  CONSTRAINT owned_copies_id_scope_key UNIQUE (id, space_id, library_id)
);

CREATE INDEX IF NOT EXISTS owned_copies_edition_time
  ON public.owned_copies(space_id, library_id, edition_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.edition_source_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id INTEGER NOT NULL REFERENCES public.spaces(id) ON DELETE RESTRICT,
  library_id INTEGER NOT NULL,
  edition_id UUID NOT NULL,
  capture_item_id INTEGER NOT NULL,
  source_provider VARCHAR(80) NOT NULL
    CHECK (source_provider ~ '^[a-z][a-z0-9_.:-]{1,79}$'),
  source_item_id VARCHAR(255) NOT NULL CHECK (btrim(source_item_id) <> ''),
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  idempotency_key CHAR(64) NOT NULL CHECK (idempotency_key ~ '^[0-9a-f]{64}$'),
  content_hash CHAR(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  normalized_facts JSONB NOT NULL CHECK (jsonb_typeof(normalized_facts) = 'object'),
  source_observed_at TIMESTAMPTZ,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor_user_id INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT edition_source_observations_library_fk
    FOREIGN KEY (space_id, library_id)
    REFERENCES public.libraries(space_id, id) ON DELETE CASCADE,
  CONSTRAINT edition_source_observations_edition_fk
    FOREIGN KEY (edition_id, space_id, library_id)
    REFERENCES public.collection_editions(id, space_id, library_id) ON DELETE RESTRICT,
  CONSTRAINT edition_source_observations_capture_fk
    FOREIGN KEY (capture_item_id, space_id, library_id)
    REFERENCES public.capture_items(id, space_id, library_id) ON DELETE RESTRICT,
  CONSTRAINT edition_source_observations_idempotency_key
    UNIQUE (space_id, library_id, edition_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS edition_source_observations_edition_time
  ON public.edition_source_observations(space_id, library_id, edition_id, observed_at DESC);

CREATE OR REPLACE FUNCTION collectz_scope.immutable_edition_source_observation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Edition source observations are append-only' USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION collectz_scope.immutable_edition_source_observation() FROM PUBLIC;

DROP TRIGGER IF EXISTS edition_source_observations_append_only
  ON public.edition_source_observations;
CREATE TRIGGER edition_source_observations_append_only
  BEFORE UPDATE OR DELETE ON public.edition_source_observations
  FOR EACH ROW EXECUTE FUNCTION collectz_scope.immutable_edition_source_observation();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_collection_works_updated_at') THEN
    CREATE TRIGGER update_collection_works_updated_at BEFORE UPDATE ON public.collection_works
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_collection_editions_updated_at') THEN
    CREATE TRIGGER update_collection_editions_updated_at BEFORE UPDATE ON public.collection_editions
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_owned_copies_updated_at') THEN
    CREATE TRIGGER update_owned_copies_updated_at BEFORE UPDATE ON public.owned_copies
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END;
$$;

ALTER TABLE public.collection_works ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_editions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owned_copies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edition_source_observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collection_works_scope ON public.collection_works;
CREATE POLICY collection_works_scope ON public.collection_works
  USING (collectz_scope.allows_library(space_id, library_id))
  WITH CHECK (collectz_scope.allows_library(space_id, library_id));

DROP POLICY IF EXISTS collection_editions_scope ON public.collection_editions;
CREATE POLICY collection_editions_scope ON public.collection_editions
  USING (collectz_scope.allows_library(space_id, library_id))
  WITH CHECK (collectz_scope.allows_library(space_id, library_id));

DROP POLICY IF EXISTS owned_copies_scope ON public.owned_copies;
CREATE POLICY owned_copies_scope ON public.owned_copies
  USING (collectz_scope.allows_library(space_id, library_id))
  WITH CHECK (collectz_scope.allows_library(space_id, library_id));

DROP POLICY IF EXISTS edition_source_observations_scope ON public.edition_source_observations;
CREATE POLICY edition_source_observations_scope ON public.edition_source_observations
  USING (collectz_scope.allows_library(space_id, library_id))
  WITH CHECK (collectz_scope.allows_library(space_id, library_id));
