-- 3.31.1 adds one durable, exact-library receipt for a manual authenticated
-- provider collection traversal. Child capture_items remain the compatibility
-- intake records used by the reviewed single-title apply path, but are hidden
-- from the ordinary Capture Inbox list and addressed through their batch.

CREATE TABLE IF NOT EXISTS public.capture_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id INTEGER NOT NULL REFERENCES public.spaces(id) ON DELETE RESTRICT,
  library_id INTEGER NOT NULL,
  client_batch_id VARCHAR(255) NOT NULL CHECK (btrim(client_batch_id) <> ''),
  source_provider VARCHAR(80) NOT NULL
    CHECK (source_provider ~ '^[a-z][a-z0-9_.:-]{1,79}$'),
  source_collection_key VARCHAR(255),
  source_url TEXT CHECK (source_url IS NULL OR char_length(source_url) <= 2000),
  status VARCHAR(32) NOT NULL DEFAULT 'collecting'
    CHECK (status IN ('collecting', 'paused', 'ready', 'applying', 'completed', 'completed_with_errors', 'discarded')),
  current_page INTEGER NOT NULL DEFAULT 0 CHECK (current_page >= 0),
  total_pages INTEGER CHECK (total_pages IS NULL OR total_pages > 0),
  expected_item_count INTEGER CHECK (expected_item_count IS NULL OR expected_item_count >= 0),
  received_item_count INTEGER NOT NULL DEFAULT 0 CHECK (received_item_count >= 0),
  applied_item_count INTEGER NOT NULL DEFAULT 0 CHECK (applied_item_count >= 0),
  failed_item_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_item_count >= 0),
  pause_reason VARCHAR(80),
  pause_detail VARCHAR(500),
  created_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT capture_batches_library_fk
    FOREIGN KEY (space_id, library_id)
    REFERENCES public.libraries(space_id, id) ON DELETE CASCADE,
  CONSTRAINT capture_batches_client_key
    UNIQUE (space_id, library_id, client_batch_id),
  CONSTRAINT capture_batches_id_scope_key
    UNIQUE (id, space_id, library_id)
);

CREATE INDEX IF NOT EXISTS capture_batches_scope_status_time
  ON public.capture_batches(space_id, library_id, status, updated_at DESC);

ALTER TABLE public.capture_items
  ADD COLUMN IF NOT EXISTS capture_batch_id UUID,
  ADD COLUMN IF NOT EXISTS capture_batch_item_key VARCHAR(255),
  ADD COLUMN IF NOT EXISTS capture_batch_position INTEGER
    CHECK (capture_batch_position IS NULL OR capture_batch_position > 0),
  ADD COLUMN IF NOT EXISTS capture_batch_source_status VARCHAR(40);

ALTER TABLE public.capture_items
  DROP CONSTRAINT IF EXISTS capture_items_batch_fk;
ALTER TABLE public.capture_items
  ADD CONSTRAINT capture_items_batch_fk
  FOREIGN KEY (capture_batch_id, space_id, library_id)
  REFERENCES public.capture_batches(id, space_id, library_id)
  ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS capture_items_batch_item_key
  ON public.capture_items(capture_batch_id, capture_batch_item_key)
  WHERE capture_batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS capture_items_batch_position
  ON public.capture_items(capture_batch_id, capture_batch_position, id)
  WHERE capture_batch_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_capture_batches_updated_at') THEN
    CREATE TRIGGER update_capture_batches_updated_at
      BEFORE UPDATE ON public.capture_batches
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END;
$$;

ALTER TABLE public.capture_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS capture_batches_scope ON public.capture_batches;
CREATE POLICY capture_batches_scope ON public.capture_batches
  USING (collectz_scope.allows_library(space_id, library_id))
  WITH CHECK (collectz_scope.allows_library(space_id, library_id));
