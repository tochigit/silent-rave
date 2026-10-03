-- Existing accounts and the permanent owner remain unchanged.
ALTER TABLE staff_users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
CREATE INDEX check_in_scans_event_received_idx ON check_in_scans(event_id, received_at);
CREATE INDEX audit_log_entries_created_idx ON audit_log_entries(created_at);
