-- Private scope grants are written only through the separately authenticated
-- scope broker. Runtime SQL cannot manufacture authorization by changing GUCs.
CREATE SCHEMA IF NOT EXISTS collectz_scope;
REVOKE ALL ON SCHEMA collectz_scope FROM PUBLIC;
CREATE TABLE IF NOT EXISTS collectz_scope.brokers (
  broker_role NAME PRIMARY KEY,
  runtime_role NAME NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS collectz_scope.transactions (
  backend_pid INTEGER NOT NULL,
  transaction_id TEXT NOT NULL,
  runtime_role NAME NOT NULL,
  space_id INTEGER NOT NULL,
  library_id INTEGER,
  actor_id INTEGER NOT NULL,
  server_started TIMESTAMPTZ NOT NULL DEFAULT pg_postmaster_start_time(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp() + interval '5 minutes',
  PRIMARY KEY (backend_pid, transaction_id)
);
CREATE INDEX IF NOT EXISTS scope_transactions_expiry ON collectz_scope.transactions(expires_at);
REVOKE ALL ON ALL TABLES IN SCHEMA collectz_scope FROM PUBLIC;
CREATE OR REPLACE FUNCTION collectz_scope.authorize(p_pid INTEGER, p_xid TEXT, p_space INTEGER, p_library INTEGER, p_actor INTEGER)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE target_role NAME;
BEGIN
  SELECT runtime_role INTO target_role FROM collectz_scope.brokers WHERE broker_role = session_user;
  IF target_role IS NULL OR p_space IS NULL OR p_space <= 0 OR p_actor IS NULL OR p_actor <= 0
     OR (p_library IS NOT NULL AND p_library <= 0) OR p_xid !~ '^[0-9]+$' OR p_xid IS NULL THEN
    RAISE EXCEPTION 'Invalid database scope grant' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity
     WHERE pid = p_pid AND usename = target_role AND datname = current_database()
       AND backend_xid::text = mod(p_xid::numeric, 4294967296)::text) THEN
    RAISE EXCEPTION 'Database transaction is unavailable' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.spaces WHERE id = p_space AND archived_at IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_actor)
     OR (p_library IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.libraries WHERE id = p_library AND space_id = p_space AND archived_at IS NULL)) THEN
    RAISE EXCEPTION 'Invalid database scope grant' USING ERRCODE = '42501';
  END IF;
  DELETE FROM collectz_scope.transactions WHERE expires_at < clock_timestamp();
  INSERT INTO collectz_scope.transactions(backend_pid, transaction_id, runtime_role, space_id, library_id, actor_id)
    VALUES (p_pid, p_xid, target_role, p_space, p_library, p_actor);
END;
$$;
CREATE OR REPLACE FUNCTION collectz_scope.revoke(p_pid INTEGER, p_xid TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  DELETE FROM collectz_scope.transactions WHERE backend_pid = p_pid AND transaction_id = p_xid
    AND runtime_role = (SELECT runtime_role FROM collectz_scope.brokers WHERE broker_role = session_user);
$$;
CREATE OR REPLACE FUNCTION collectz_scope.allows(p_space INTEGER, p_library INTEGER, p_actor INTEGER)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT EXISTS (SELECT 1 FROM collectz_scope.transactions s
    WHERE s.backend_pid = pg_backend_pid() AND s.transaction_id = pg_current_xact_id()::text
      AND s.runtime_role = session_user AND s.server_started = pg_postmaster_start_time()
      AND s.expires_at > statement_timestamp() AND s.space_id = p_space AND s.actor_id = p_actor
      AND (s.library_id IS NULL OR s.library_id = p_library)
      AND (p_library IS NULL OR EXISTS (
        SELECT 1 FROM public.libraries l WHERE l.id = p_library AND l.space_id = p_space AND l.archived_at IS NULL)));
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA collectz_scope FROM PUBLIC;
-- Only unambiguous library ownership is backfilled. Unresolvable legacy rows
-- remain retained and inaccessible, rather than guessed into another workspace.
UPDATE public.saved_library_views v SET space_id = l.space_id
  FROM public.libraries l WHERE v.library_id = l.id AND v.space_id IS NULL;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.saved_library_views v
    WHERE v.space_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.spaces s WHERE s.id=v.space_id)
       OR (v.library_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.libraries l WHERE l.id=v.library_id AND l.space_id=v.space_id))) THEN
    RAISE EXCEPTION 'Saved views have unresolved workspace ownership; repair ownership before migration 124';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION collectz_scope.immutable_saved_view_owner()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF (OLD.owner_user_id, OLD.space_id, OLD.library_id) IS DISTINCT FROM
     (NEW.owner_user_id, NEW.space_id, NEW.library_id) THEN
    RAISE EXCEPTION 'Saved view ownership is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION collectz_scope.immutable_saved_view_owner() FROM PUBLIC;
DROP TRIGGER IF EXISTS saved_view_immutable_owner ON public.saved_library_views;
CREATE TRIGGER saved_view_immutable_owner BEFORE UPDATE ON public.saved_library_views
  FOR EACH ROW EXECUTE FUNCTION collectz_scope.immutable_saved_view_owner();
ALTER TABLE public.saved_library_views ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS saved_view_scope ON public.saved_library_views;
CREATE POLICY saved_view_scope ON public.saved_library_views
  USING (collectz_scope.allows(space_id, library_id, owner_user_id))
  WITH CHECK (collectz_scope.allows(space_id, library_id, owner_user_id));

-- Referential actions bypass RLS. Guard cascaded deletes as well, so unscoped
-- runtime SQL cannot erase another owner's views by deleting a parent row.
CREATE OR REPLACE FUNCTION collectz_scope.guard_saved_view_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF session_user <> current_user AND NOT collectz_scope.allows(OLD.space_id, OLD.library_id, OLD.owner_user_id) THEN
    RAISE EXCEPTION 'Saved view deletion requires authorized scope' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION collectz_scope.guard_saved_view_delete() FROM PUBLIC;
DROP TRIGGER IF EXISTS saved_view_scoped_delete ON public.saved_library_views;
CREATE TRIGGER saved_view_scoped_delete BEFORE DELETE ON public.saved_library_views
  FOR EACH ROW EXECUTE FUNCTION collectz_scope.guard_saved_view_delete();
