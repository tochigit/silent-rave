BEGIN;
CREATE TABLE public.mail_quota_windows (
  kind text NOT NULL CHECK (kind IN ('day','month')),
  starts_at timestamptz(3) NOT NULL, reset_at timestamptz(3) NOT NULL,
  reserved integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  PRIMARY KEY (kind, starts_at), CHECK (reset_at > starts_at)
);
CREATE INDEX mail_quota_windows_reset_at_idx ON public.mail_quota_windows(reset_at);
CREATE TABLE public.mail_send_reservations (
  send_id uuid NOT NULL, kind text NOT NULL, starts_at timestamptz(3) NOT NULL,
  amount integer NOT NULL CHECK (amount BETWEEN 1 AND 10),
  state text NOT NULL CHECK (state IN ('RESERVED','UNCERTAIN','ACCEPTED','REJECTED')),
  created_at timestamptz(3) NOT NULL DEFAULT now(), updated_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (send_id, kind, starts_at),
  FOREIGN KEY (kind, starts_at) REFERENCES public.mail_quota_windows(kind, starts_at) ON DELETE CASCADE
);
CREATE INDEX mail_send_reservations_created_at_idx ON public.mail_send_reservations(created_at);
ALTER TABLE public.email_worker_gate ADD COLUMN pause_reason text
  CHECK (pause_reason IN ('QUOTA_DAY','QUOTA_MONTH'));
DO $$ DECLARE table_name text; role_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['mail_quota_windows','mail_send_reservations'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', table_name);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('REVOKE ALL ON public.%I FROM %I', table_name, role_name);
      END IF;
    END LOOP;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO sr_runtime', table_name);
    EXECUTE format('CREATE POLICY sr_runtime_access ON public.%I TO sr_runtime USING(true) WITH CHECK(true)', table_name);
  END LOOP;
END $$;
COMMIT;
