BEGIN;
DO $$
DECLARE item record; expected text[] := ARRAY[
  'organizers','venues','events','ticket_tiers','orders','order_line_items',
  'payment_accounts','payment_proofs','ticket_units','check_in_scans','staff_users',
  'push_subscriptions','sessions','audit_log_entries','email_jobs','email_worker_gate',
  'site_pages','storage_objects','rate_limit_windows','mail_quota_windows','mail_send_reservations'];
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sr_runtime' AND
    (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication))
    OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sr_runtime') THEN
    RAISE EXCEPTION 'sr_runtime role drift: reconcile before migration';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='sr_runtime')) THEN
    RAISE EXCEPTION 'sr_runtime must not inherit other roles';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN('anon','authenticated','service_role')
    AND pg_has_role(r.oid,'sr_runtime'::regrole,'MEMBER')) THEN
    RAISE EXCEPTION 'provider role membership drift: public roles must not inherit runtime';
  END IF;
  IF has_database_privilege('sr_runtime',current_database(),'CREATE')
    OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='public' AND nspowner='sr_runtime'::regrole)
    OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a
      WHERE n.nspname='public' AND a.grantee='sr_runtime'::regrole AND a.privilege_type='CREATE')
    OR EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.assign_ticket_sync_seq()'::regprocedure AND proowner='sr_runtime'::regrole)
    OR EXISTS(SELECT 1 FROM pg_class WHERE oid='public.ticket_units_sync_seq'::regclass AND relowner='sr_runtime'::regrole) THEN
    RAISE EXCEPTION 'runtime DDL/ownership drift: operator reconciliation required';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN('r','p','f') AND c.relname<>ALL(expected||ARRAY['_prisma_migrations'])) THEN
    RAISE EXCEPTION 'unknown public table: operator inventory required';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN('v','m','S') AND c.relname<>'ticket_units_sync_seq'
      AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=c.oid AND d.classid='pg_class'::regclass AND d.deptype='e')) THEN
    RAISE EXCEPTION 'unknown public view or sequence: operator inventory required';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.oid<>'public.assign_ticket_sync_seq()'::regprocedure
      AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.classid='pg_proc'::regclass AND d.deptype='e')) THEN
    RAISE EXCEPTION 'unknown public routine: operator inventory required';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_class WHERE oid='public.ticket_units_sync_seq'::regclass
      AND relowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user))
    OR EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.assign_ticket_sync_seq()'::regprocedure
      AND proowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user)) THEN
    RAISE EXCEPTION 'sync object owner drift: named migration owner required';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
      WHERE c.oid='public.ticket_units_sync_seq'::regclass AND a.grantee<>0 AND a.grantee<>c.relowner
        AND a.grantee NOT IN(SELECT oid FROM pg_roles WHERE rolname IN('sr_runtime','anon','authenticated','service_role')))
    OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
      WHERE p.oid='public.assign_ticket_sync_seq()'::regprocedure AND a.grantee<>0 AND a.grantee<>p.proowner
        AND a.grantee NOT IN(SELECT oid FROM pg_roles WHERE rolname IN('sr_runtime','anon','authenticated','service_role'))) THEN
    RAISE EXCEPTION 'unknown sync object grants: operator reconciliation required';
  END IF;
  FOR item IN SELECT unnest(expected||ARRAY['_prisma_migrations']) AS name LOOP
    IF to_regclass(format('public.%I',item.name)) IS NULL THEN RAISE EXCEPTION 'missing application table'; END IF;
    IF EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass(format('public.%I',item.name))
      AND relowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user)) THEN RAISE EXCEPTION 'application owner drift: named migration owner required'; END IF;
    IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=item.name
      AND policyname<>'sr_runtime_access') THEN RAISE EXCEPTION 'unknown application policy: operator reconciliation required'; END IF;
    IF EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
      WHERE c.oid=to_regclass(format('public.%I',item.name)) AND a.grantee<>0 AND a.grantee<>c.relowner
        AND a.grantee NOT IN(SELECT oid FROM pg_roles WHERE rolname IN('sr_runtime','anon','authenticated','service_role'))) THEN
      RAISE EXCEPTION 'unknown application grants: operator reconciliation required';
    END IF;
    IF EXISTS(SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) g
      WHERE a.attrelid=to_regclass(format('public.%I',item.name)) AND g.grantee<>(SELECT relowner FROM pg_class WHERE oid=a.attrelid)) THEN
      RAISE EXCEPTION 'column grants require operator reconciliation';
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE table_name text; role_name text; action text; privileges text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'organizers','venues','events','ticket_tiers','orders','order_line_items',
    'payment_accounts','payment_proofs','ticket_units','check_in_scans','staff_users',
    'push_subscriptions','sessions','audit_log_entries','email_jobs','email_worker_gate',
    'site_pages','storage_objects','rate_limit_windows','mail_quota_windows','mail_send_reservations','_prisma_migrations'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, sr_runtime',table_name);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('REVOKE ALL ON public.%I FROM %I',table_name,role_name);
      END IF;
    END LOOP;
    IF table_name='_prisma_migrations' THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS sr_runtime_access ON public.%I',table_name);
    privileges := CASE
      WHEN table_name IN('organizers','venues','events','ticket_tiers','sessions','rate_limit_windows','mail_quota_windows') THEN 'SELECT,INSERT,UPDATE,DELETE'
      WHEN table_name IN('order_line_items','audit_log_entries','check_in_scans') THEN 'SELECT,INSERT'
      WHEN table_name='email_worker_gate' THEN 'SELECT,UPDATE'
      ELSE 'SELECT,INSERT,UPDATE' END;
    EXECUTE format('GRANT %s ON public.%I TO sr_runtime',privileges,table_name);
    FOREACH action IN ARRAY string_to_array(privileges,',') LOOP
      IF action='SELECT' OR action='DELETE' THEN
        EXECUTE format('CREATE POLICY sr_%s ON public.%I FOR %s TO sr_runtime USING(true)',lower(action),table_name,action);
      ELSIF action='INSERT' THEN
        EXECUTE format('CREATE POLICY sr_insert ON public.%I FOR INSERT TO sr_runtime WITH CHECK(true)',table_name);
      ELSE
        EXECUTE format('CREATE POLICY sr_update ON public.%I FOR UPDATE TO sr_runtime USING(true) WITH CHECK(true)',table_name);
      END IF;
    END LOOP;
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA public TO sr_runtime;
REVOKE CREATE ON SCHEMA public FROM PUBLIC, sr_runtime;
REVOKE ALL ON SEQUENCE public.ticket_units_sync_seq FROM PUBLIC;
GRANT USAGE,SELECT ON SEQUENCE public.ticket_units_sync_seq TO sr_runtime;
CREATE OR REPLACE FUNCTION public.assign_ticket_sync_seq() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN NEW.sync_seq := nextval('public.ticket_units_sync_seq'::regclass); RETURN NEW; END;
$$;
REVOKE ALL ON FUNCTION public.assign_ticket_sync_seq() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_ticket_sync_seq() TO sr_runtime;
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON SEQUENCE public.ticket_units_sync_seq FROM %I',role_name);
      EXECUTE format('REVOKE ALL ON FUNCTION public.assign_ticket_sync_seq() FROM %I',role_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I',role_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I',role_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I',role_name);
    END IF;
  END LOOP;
END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC;
COMMIT;
