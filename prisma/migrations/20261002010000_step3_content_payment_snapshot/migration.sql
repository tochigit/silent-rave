-- Forward-only: editorial content is opt-in, with no permanent content seeded.
CREATE TABLE "site_pages" (
  "slug" TEXT PRIMARY KEY CHECK (slug IN ('about', 'contact')),
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "is_published" BOOLEAN NOT NULL DEFAULT false,
  "contact_organizer_id" UUID REFERENCES organizers(id) ON DELETE SET NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE orders ADD COLUMN payment_account_snapshot JSONB;
-- Legacy rows can only recover the referenced account's migration-time values.
-- New checkouts save the exact returned fields immutably, before any bank edit.
UPDATE orders o SET payment_account_snapshot = jsonb_build_object(
  'bank_name', p.bank_name, 'account_number', p.account_number, 'account_name', p.account_name
) FROM payment_accounts p WHERE o.payment_account_id = p.id;
