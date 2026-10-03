import { PrismaClient } from "@prisma/client";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { startFixture, runCommand } from "./fixture";
import { migrationFingerprints } from "./readiness";
import { TX_OPTIONS } from "../src/lib/constants";

// Only the existing guarded, owned loopback fixture can supply a connection.
// Never accepts a hosted target, invokes reset/history repair, or sends mail.
await mkdir("reports", { recursive: true });
const output = createWriteStream(`reports/step5-${process.platform}-db-preflight.txt`);
const log = (message: string) => { console.log(message); output.write(message + "\n"); };
let fixture: Awaited<ReturnType<typeof startFixture>> | undefined;
let first: PrismaClient | undefined;
let second: PrismaClient | undefined;
let stopping: Promise<void> | undefined;
const cleanup = () => (stopping ??= (async () => {
  await Promise.all([first?.$disconnect(), second?.$disconnect()]);
  await fixture?.cleanup();
})());
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => { void cleanup().finally(() => process.exit(130)); });
function assert(ok: unknown): asserts ok { if (!ok) throw new Error("PREFLIGHT_ASSERTION_FAILED"); }

try {
  log("Step 5 DB preflight: disposable PostgreSQL only; no app/provider/hosted connection.");
  fixture = await startFixture((chunk) => output.write(chunk));
  first = new PrismaClient({ datasources: { db: { url: fixture.env.DATABASE_URL } } });
  second = new PrismaClient({ datasources: { db: { url: fixture.env.DATABASE_URL } } });
  const db = first, other = second;
  const expected = await migrationFingerprints();
  const history = await db.$queryRaw<Array<{ migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null }>>`
    SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name`;
  assert(history.length === expected.length && history.every((row, index) =>
    row.migration_name === expected[index].name && row.checksum === expected[index].sha256 &&
    row.finished_at && !row.rolled_back_at));
  log("PASS: fresh forward migration chain and exact file checksums match Prisma history.");
  const owner = await db.staffUser.findFirstOrThrow({ where: { role: "OWNER" },
    select: { id: true, passwordHash: true, isActive: true, mustChangePassword: true } });
  await runCommand([process.execPath, "--no-env-file", "node_modules/prisma/build/index.js", "migrate", "deploy"], fixture.env,
    (chunk) => output.write(chunk));
  const after = await db.staffUser.findUniqueOrThrow({ where: { id: owner.id }, select:
    { id: true, passwordHash: true, isActive: true, mustChangePassword: true } });
  assert(JSON.stringify(owner) === JSON.stringify(after) && !after.mustChangePassword);
  log("PASS: repeat deploy is a no-op and preserves the disposable owner credential/state.");
  const tier = await db.ticketTier.findFirstOrThrow({ select: { id: true, reserved: true } });
  const lockId = 17051003;
  try {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(1::int, ${lockId}::int)`;
      await tx.$executeRaw`SELECT id FROM ticket_tiers WHERE id = ${tier.id}::uuid FOR UPDATE`;
      await tx.ticketTier.update({ where: { id: tier.id }, data: { reserved: { increment: 1 } } });
      await other.$transaction(async (peer) => {
        const locked = await peer.$queryRaw<Array<{ acquired: boolean }>>`
          SELECT pg_try_advisory_xact_lock(1::int, ${lockId}::int) AS acquired`;
        assert(locked[0]?.acquired === false);
        const skipped = await peer.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM ticket_tiers WHERE id = ${tier.id}::uuid FOR UPDATE SKIP LOCKED`;
        assert(skipped.length === 0);
      }, TX_OPTIONS);
      log("PASS: independent interactive transactions respect transaction advisory and row/SKIP LOCKED locks.");
      throw new Error("EXPECTED_PREFLIGHT_ROLLBACK");
    }, TX_OPTIONS);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "EXPECTED_PREFLIGHT_ROLLBACK") throw error;
  }
  assert((await db.ticketTier.findUniqueOrThrow({ where: { id: tier.id } })).reserved === tier.reserved);
  const acquired = await other.$transaction(async (tx) => {
    const result = await tx.$queryRaw<Array<{ acquired: boolean }>>`
      SELECT pg_try_advisory_xact_lock(1::int, ${lockId}::int) AS acquired`;
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM ticket_tiers WHERE id = ${tier.id}::uuid FOR UPDATE SKIP LOCKED`;
    return result[0]?.acquired && rows.length === 1;
  }, TX_OPTIONS);
  assert(acquired);
  log("PASS: rollback restores inventory and releases both locks without changing transaction limits.");
  log("4 checks passed; hosted Supavisor behavior remains UNVERIFIED.");
  process.exitCode = 0;
} catch {
  // Prisma/native errors can contain connection strings; use a fixed diagnostic.
  log("FAILED: disposable DB preflight; inspect fixture output without exposing environment values.");
  process.exitCode = 1;
} finally {
  try {
    await cleanup();
    log("Cleanup complete: owned database stopped and disposable directory removed.");
  } catch {
    log("FAILED: owned fixture cleanup incomplete; inspect its exact process/directory before recovery.");
    process.exitCode = 1;
  }
  await new Promise<void>((resolve) => output.end(resolve));
}
process.exit(process.exitCode ?? 1);
