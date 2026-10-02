-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('AWAITING_PAYMENT', 'PROOF_SUBMITTED', 'NEEDS_RESUBMIT', 'APPROVED', 'REJECTED', 'EXPIRED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('ONLINE', 'CASH', 'COMP');

-- CreateEnum
CREATE TYPE "ProofStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TicketCheckInStatus" AS ENUM ('NOT_CHECKED_IN', 'CHECKED_IN');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('OWNER', 'STAFF');

-- CreateEnum
CREATE TYPE "EmailJobStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'BOUNCED', 'FAILED');

-- CreateEnum
CREATE TYPE "EmailJobKind" AS ENUM ('PROOF_RECEIVED', 'TICKETS', 'REJECTED', 'STATUS_LINK');

-- CreateEnum
CREATE TYPE "ScanResult" AS ENUM ('VALID', 'DUPLICATE', 'INVALID', 'WRONG_EVENT', 'VOID', 'CONFLICT');

-- CreateTable
CREATE TABLE "organizers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "contact_email" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venues" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT,
    "country" TEXT NOT NULL DEFAULT 'Nigeria',
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "google_place_id" TEXT,
    "google_maps_url" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "venues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "banner_image_url" TEXT,
    "organizer_id" UUID NOT NULL,
    "venue_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "is_date_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_tiers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price_kobo" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,
    "sold" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "sales_start_at" TIMESTAMPTZ(3),
    "sales_end_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_code" TEXT NOT NULL,
    "status_token_version" INTEGER NOT NULL DEFAULT 1,
    "event_id" UUID NOT NULL,
    "customer_name" TEXT NOT NULL,
    "customer_email" TEXT NOT NULL,
    "customer_phone" TEXT,
    "total_kobo" INTEGER NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "source" "OrderSource" NOT NULL DEFAULT 'ONLINE',
    "payment_account_id" UUID,
    "hold_expires_at" TIMESTAMPTZ(3),
    "first_proof_at" TIMESTAMPTZ(3),
    "proof_attempts" INTEGER NOT NULL DEFAULT 0,
    "inventory_released" BOOLEAN NOT NULL DEFAULT false,
    "approved_at" TIMESTAMPTZ(3),
    "approved_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_line_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "tier_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_kobo" INTEGER NOT NULL,
    "holder_names" JSONB,

    CONSTRAINT "order_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bank_name" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_proofs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "attempt_no" INTEGER NOT NULL,
    "client_submission_id" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "file_sha256" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "transfer_reference" TEXT NOT NULL,
    "sender_name" TEXT NOT NULL,
    "status" "ProofStatus" NOT NULL DEFAULT 'PENDING',
    "reject_reason_code" TEXT,
    "reject_message" TEXT,
    "reject_final" BOOLEAN,
    "flags" JSONB NOT NULL DEFAULT '{}',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_proofs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_units" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "tier_id" UUID NOT NULL,
    "holder_name" TEXT,
    "qr_token" TEXT NOT NULL,
    "check_in_status" "TicketCheckInStatus" NOT NULL DEFAULT 'NOT_CHECKED_IN',
    "checked_in_at" TIMESTAMPTZ(3),
    "checked_in_by" UUID,
    "voided_at" TIMESTAMPTZ(3),
    "sync_seq" BIGINT NOT NULL,
    "pdf_url" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "check_in_scans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_scan_id" TEXT NOT NULL,
    "event_id" UUID,
    "ticket_id" UUID,
    "staff_user_id" UUID NOT NULL,
    "device_id" TEXT NOT NULL,
    "scanned_at" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "offline" BOOLEAN NOT NULL,
    "result" "ScanResult" NOT NULL,
    "flags" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "check_in_scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,
    "invited_by" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMPTZ(3),

    CONSTRAINT "staff_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "staff_user_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_success_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "kind" "EmailJobKind" NOT NULL,
    "dedupe_key" TEXT NOT NULL DEFAULT 'initial',
    "recipient_email" TEXT NOT NULL,
    "status" "EmailJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "resend_message_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "events_slug_key" ON "events"("slug");

-- CreateIndex
CREATE INDEX "events_status_starts_at_idx" ON "events"("status", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_code_key" ON "orders"("order_code");

-- CreateIndex
CREATE INDEX "orders_status_hold_expires_at_idx" ON "orders"("status", "hold_expires_at");

-- CreateIndex
CREATE INDEX "orders_status_first_proof_at_idx" ON "orders"("status", "first_proof_at");

-- CreateIndex
CREATE INDEX "orders_customer_email_idx" ON "orders"("customer_email");

-- CreateIndex
CREATE INDEX "orders_customer_phone_idx" ON "orders"("customer_phone");

-- CreateIndex
CREATE INDEX "order_line_items_order_id_idx" ON "order_line_items"("order_id");

-- CreateIndex
CREATE INDEX "order_line_items_tier_id_idx" ON "order_line_items"("tier_id");

-- CreateIndex
CREATE INDEX "payment_proofs_file_sha256_idx" ON "payment_proofs"("file_sha256");

-- CreateIndex
CREATE INDEX "payment_proofs_order_id_idx" ON "payment_proofs"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_proofs_order_id_client_submission_id_key" ON "payment_proofs"("order_id", "client_submission_id");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_units_qr_token_key" ON "ticket_units"("qr_token");

-- CreateIndex
CREATE INDEX "ticket_units_order_id_idx" ON "ticket_units"("order_id");

-- CreateIndex
CREATE INDEX "ticket_units_event_id_sync_seq_idx" ON "ticket_units"("event_id", "sync_seq");

-- CreateIndex
CREATE UNIQUE INDEX "check_in_scans_client_scan_id_key" ON "check_in_scans"("client_scan_id");

-- CreateIndex
CREATE INDEX "check_in_scans_event_id_idx" ON "check_in_scans"("event_id");

-- CreateIndex
CREATE INDEX "check_in_scans_ticket_id_idx" ON "check_in_scans"("ticket_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_users_email_key" ON "staff_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_staff_user_id_idx" ON "push_subscriptions"("staff_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "audit_log_entries_entity_type_entity_id_idx" ON "audit_log_entries"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_entries_actor_id_idx" ON "audit_log_entries"("actor_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_jobs_order_id_kind_dedupe_key_key" ON "email_jobs"("order_id", "kind", "dedupe_key");

-- CreateIndex
CREATE INDEX "email_jobs_status_next_attempt_at_idx" ON "email_jobs"("status", "next_attempt_at");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_organizer_id_fkey" FOREIGN KEY ("organizer_id") REFERENCES "organizers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_tiers" ADD CONSTRAINT "ticket_tiers_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_payment_account_id_fkey" FOREIGN KEY ("payment_account_id") REFERENCES "payment_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line_items" ADD CONSTRAINT "order_line_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line_items" ADD CONSTRAINT "order_line_items_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "ticket_tiers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_units" ADD CONSTRAINT "ticket_units_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_units" ADD CONSTRAINT "ticket_units_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_units" ADD CONSTRAINT "ticket_units_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "ticket_tiers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_units" ADD CONSTRAINT "ticket_units_checked_in_by_fkey" FOREIGN KEY ("checked_in_by") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_in_scans" ADD CONSTRAINT "check_in_scans_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_in_scans" ADD CONSTRAINT "check_in_scans_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "ticket_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_in_scans" ADD CONSTRAINT "check_in_scans_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_users" ADD CONSTRAINT "staff_users_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "staff_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log_entries" ADD CONSTRAINT "audit_log_entries_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_jobs" ADD CONSTRAINT "email_jobs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- Hand-written additions (Prisma DSL cannot express these) — 02 v2.1
-- ─────────────────────────────────────────────────────────────────────────────

-- ticket_tiers: DB-level backstops (02 "Constraints (DB-level backstops, not
-- just application logic)")
ALTER TABLE "ticket_tiers" ADD CONSTRAINT "ticket_tiers_price_kobo_nonnegative" CHECK ("price_kobo" >= 0);
ALTER TABLE "ticket_tiers" ADD CONSTRAINT "ticket_tiers_capacity_nonnegative" CHECK ("capacity" >= 0);
ALTER TABLE "ticket_tiers" ADD CONSTRAINT "ticket_tiers_sold_reserved_within_capacity" CHECK ("sold" + "reserved" <= "capacity");
ALTER TABLE "ticket_tiers" ADD CONSTRAINT "ticket_tiers_counters_nonnegative" CHECK ("reserved" >= 0 AND "sold" >= 0);

-- orders: ONLINE-source requirements (02 v2.1 — nullable columns, CHECKs keep
-- them required for source ONLINE; admin-issued CASH/COMP orders are exempt)
ALTER TABLE "orders" ADD CONSTRAINT "orders_online_requires_phone" CHECK ("source" <> 'ONLINE' OR "customer_phone" IS NOT NULL);
ALTER TABLE "orders" ADD CONSTRAINT "orders_online_requires_payment_account" CHECK ("source" <> 'ONLINE' OR "payment_account_id" IS NOT NULL);
ALTER TABLE "orders" ADD CONSTRAINT "orders_online_requires_hold_expiry" CHECK ("source" <> 'ONLINE' OR "hold_expires_at" IS NOT NULL);

-- payment_accounts: at most one active row (partial unique index — all
-- included rows have is_active = true, so at most one can exist)
CREATE UNIQUE INDEX "payment_accounts_at_most_one_active"
  ON "payment_accounts" ("is_active") WHERE ("is_active" = true);

-- payment_proofs: a transfer reference can be reused only after its earlier
-- proof was rejected (02 v2.1)
CREATE UNIQUE INDEX "payment_proofs_transfer_reference_unique_live"
  ON "payment_proofs" ("transfer_reference")
  WHERE ("status" IN ('PENDING', 'APPROVED'));

-- ticket_units: global sequence + BEFORE INSERT OR UPDATE trigger assigning
-- sync_seq — minting, check-in and voiding all bump it; no code path can
-- forget it. Sequence values are NOT commit-ordered, so delta sync uses an
-- overlap window (03 manifest, SYNC_OVERLAP).
CREATE SEQUENCE "ticket_units_sync_seq";
CREATE OR REPLACE FUNCTION "assign_ticket_sync_seq"() RETURNS trigger AS $$
BEGIN
  NEW."sync_seq" := nextval('ticket_units_sync_seq');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ticket_units_sync_seq_trigger"
  BEFORE INSERT OR UPDATE ON "ticket_units"
  FOR EACH ROW EXECUTE FUNCTION "assign_ticket_sync_seq"();
