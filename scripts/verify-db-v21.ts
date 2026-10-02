// Dev-only: verify v2.1 DB-level objects are live (called ad-hoc, not part of tests).
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

const q = (sql: string) => db.$queryRawUnsafe(sql) as Promise<any[]>;

const run = async () => {
  const checks = await q(`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid IN ('ticket_tiers'::regclass, 'orders'::regclass) AND contype = 'c'
    ORDER BY conname`);
  console.log("CHECK constraints:");
  for (const c of checks) console.log(`  ${c.conname}: ${c.def}`);

  const idx = await q(`
    SELECT indexdef FROM pg_indexes
    WHERE indexname IN ('payment_accounts_at_most_one_active','payment_proofs_transfer_reference_unique_live')`);
  console.log("Partial unique indexes:");
  for (const i of idx) console.log(`  ${i.indexdef}`);

  const trig = await q(`
    SELECT pg_get_triggerdef(oid) AS def FROM pg_trigger
    WHERE tgrelid = 'ticket_units'::regclass AND NOT tgisinternal`);
  console.log("Triggers on ticket_units:");
  for (const t of trig) console.log(`  ${t.def}`);

  const seq = await q(`SELECT last_value, is_called FROM ticket_units_sync_seq`);
  console.log("ticket_units_sync_seq last_value:", String(seq[0].last_value), "is_called:", seq[0].is_called);

  const enums = await q(`
    SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS vals
    FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname IN ('OrderStatus','OrderSource','EmailJobKind','ProofStatus','ScanResult','EventStatus')
    GROUP BY t.typname ORDER BY t.typname`);
  console.log("Enums:");
  for (const e of enums) console.log(`  ${e.typname}: ${e.vals.join(",")}`);

  const uniqueJob = await q(`
    SELECT indexdef FROM pg_indexes
    WHERE tablename='email_jobs' AND indexdef LIKE '%kind%dedupe_key%'`);
  console.log("email_jobs dedupe unique:");
  for (const u of uniqueJob) console.log(`  ${u.indexdef}`);

  const cols = await q(`
    SELECT column_name, is_nullable FROM information_schema.columns
    WHERE table_name = 'audit_log_entries' AND column_name IN ('actor_id','entity_type','entity_id')`);
  console.log("audit_log_entries nullability:", cols.map((c: any) => `${c.column_name}=${c.is_nullable}`).join(", "));

  const ocols = await q(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'orders' ORDER BY ordinal_position`);
  console.log("orders columns:", ocols.map((c: any) => c.column_name).join(", "));

  await db.$disconnect();
};

run().catch((e) => { console.error(e); process.exit(1); });
