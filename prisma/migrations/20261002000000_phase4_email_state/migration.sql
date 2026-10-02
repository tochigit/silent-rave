ALTER TABLE email_jobs
  ADD COLUMN claim_token UUID,
  ADD COLUMN first_send_at TIMESTAMPTZ(3),
  ADD COLUMN encrypted_payload TEXT,
  ADD COLUMN payload_token_version INTEGER,
  ADD COLUMN context JSONB;
CREATE INDEX email_jobs_resend_message_id_idx ON email_jobs(resend_message_id);
CREATE TABLE email_worker_gate (
  id TEXT PRIMARY KEY CHECK (id = 'email'),
  owner UUID,
  lease_until TIMESTAMPTZ(3) NOT NULL DEFAULT 'epoch',
  next_send_at TIMESTAMPTZ(3) NOT NULL DEFAULT 'epoch'
);
INSERT INTO email_worker_gate(id) VALUES ('email');
