BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sr_runtime') THEN
    CREATE ROLE sr_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sr_runtime' AND
    (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) OR
    EXISTS (SELECT 1 FROM pg_auth_members WHERE member = 'sr_runtime'::regrole) THEN
    RAISE EXCEPTION 'Unexpected sr_runtime privileges; operator reconciliation required';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN('anon','authenticated','service_role')
    AND pg_has_role(r.oid,'sr_runtime'::regrole,'MEMBER')) THEN
    RAISE EXCEPTION 'Unexpected provider membership in sr_runtime; operator reconciliation required';
  END IF;
END $$;
CREATE TABLE public.rate_limit_windows (
  bucket_name text NOT NULL CHECK (bucket_name IN ('login','checkout-initialize-ip','proof-submit-ip',
    'lookup-ip','lookup-code','contact-ip','password-change','scanner','places')),
  key_hmac text NOT NULL CHECK (key_hmac ~ '^[a-f0-9]{64}$'),
  count bigint NOT NULL CHECK (count >= 1), reset_at timestamptz(3) NOT NULL,
  PRIMARY KEY (bucket_name, key_hmac)
);
CREATE INDEX rate_limit_windows_reset_at_idx ON public.rate_limit_windows (reset_at);
ALTER TABLE public.rate_limit_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limit_windows FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON public.rate_limit_windows FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA public TO sr_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rate_limit_windows TO sr_runtime;
CREATE POLICY sr_runtime_access ON public.rate_limit_windows TO sr_runtime USING (true) WITH CHECK (true);
COMMIT;
