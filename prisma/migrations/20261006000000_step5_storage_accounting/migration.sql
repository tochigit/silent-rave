-- Additive accounting only. No bucket provisioning, import, object moves or deletion.
CREATE TABLE public.storage_objects (
  key text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('PROOF', 'PDF', 'BANNER')),
  state text NOT NULL CHECK (state IN ('UPLOADING', 'STORED', 'LINKED', 'ORPHAN_CANDIDATE', 'LEGACY_REFERENCED')),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  linked_entity_id uuid,
  linked_entity_type text CHECK (linked_entity_type IN ('ORDER', 'TICKET', 'EVENT')),
  stored_bytes bigint CHECK (stored_bytes > 0),
  stored_sha256 text CHECK (stored_sha256 ~ '^[0-9a-f]{64}$'),
  input_hash text CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  last_error text CHECK (last_error IN ('CONFIG', 'KEY', 'TYPE', 'SIZE', 'PROVIDER', 'TIMEOUT', 'COLLISION', 'COLLISION_METADATA', 'BUSINESS_ROLLBACK')),
  checked_at timestamptz(3),
  CHECK ((linked_entity_id IS NULL) = (linked_entity_type IS NULL)),
  CHECK ((stored_bytes IS NULL) = (stored_sha256 IS NULL))
);
CREATE INDEX storage_objects_state_created_at_idx ON public.storage_objects(state, created_at);
CREATE INDEX storage_objects_linked_entity_type_linked_entity_id_idx ON public.storage_objects(linked_entity_type, linked_entity_id);

-- Denied from the moment it exists, including inherited provider default grants.
ALTER TABLE public.storage_objects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.storage_objects FROM PUBLIC;
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON public.storage_objects FROM %I', role_name);
    END IF;
  END LOOP;
END $$;

-- Preserve old pointers exactly. Unknown byte/hash metadata stays explicitly unknown.
INSERT INTO public.storage_objects(key, kind, state, created_at, linked_entity_id, linked_entity_type)
SELECT storage_path, 'PROOF', 'LEGACY_REFERENCED', MIN(created_at), (array_agg(order_id))[1], 'ORDER'
FROM public.payment_proofs GROUP BY storage_path
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.storage_objects(key, kind, state, linked_entity_id, linked_entity_type)
SELECT pdf_url, 'PDF', 'LEGACY_REFERENCED', (array_agg(id))[1], 'TICKET'
FROM public.ticket_units WHERE pdf_url IS NOT NULL GROUP BY pdf_url
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.storage_objects(key, kind, state, linked_entity_id, linked_entity_type)
SELECT 'banners/' || substring(banner_image_url FROM 14), 'BANNER', 'LEGACY_REFERENCED', (array_agg(id))[1], 'EVENT'
FROM public.events WHERE banner_image_url LIKE '/api/banners/%' GROUP BY banner_image_url
ON CONFLICT (key) DO NOTHING;
