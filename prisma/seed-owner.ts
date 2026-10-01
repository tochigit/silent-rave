import { db } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth/password";

// ─────────────────────────────────────────────────────────────────────────────
// One-time OWNER seed (06-auth-and-roles.md):
//
//   "The OWNER account is provisioned once, directly (seed script / manual DB
//    insert / one-time setup flow), not through a public form."
//
// CLI-only — there is deliberately NO HTTP route for account creation
// anywhere in this app. STAFF accounts will later be created by an OWNER via
// the admin dashboard (a later build phase); this script only bootstraps the
// first OWNER.
//
// Usage:
//   bun run db:seed-owner <email> [password] [display-name]
//   — or —
//   OWNER_EMAIL=… OWNER_PASSWORD=… [OWNER_NAME=…] bun run db:seed-owner
//
// Refuses to overwrite an existing account (idempotent no-op with a clear
// error, not a silent update).
// ─────────────────────────────────────────────────────────────────────────────

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

async function main() {
  const email = (process.argv[2] ?? process.env.OWNER_EMAIL ?? "").trim().toLowerCase();
  const password = process.argv[3] ?? process.env.OWNER_PASSWORD ?? "";
  const name = (process.argv[4] ?? process.env.OWNER_NAME ?? "Owner").trim() || "Owner";

  if (!email) {
    fail("usage: bun run db:seed-owner <email> [password] [display-name]  (or OWNER_EMAIL / OWNER_PASSWORD / OWNER_NAME env vars)");
  }
  if (!password) {
    fail("password required — pass it as the 2nd argument or OWNER_PASSWORD env var");
  }
  if (password.length < 10) {
    fail("password must be at least 10 characters");
  }

  const existing = await db.staffUser.findUnique({ where: { email } });
  if (existing) {
    fail(`an account already exists for ${email} (role ${existing.role}) — refusing to overwrite`);
  }

  // Only the bcrypt hash is ever stored — the plaintext never touches the DB
  // and is never logged.
  const passwordHash = await hashPassword(password);

  const owner = await db.staffUser.create({
    data: { email, name, passwordHash, role: "OWNER" },
    select: { id: true, email: true, name: true, role: true },
  });

  console.log(`✔ OWNER account created: ${owner.email} (${owner.name}) — id ${owner.id}`);
  console.log(`  Log in at /admin (or admin.${process.env.ROOT_DOMAIN ?? "localhost"}).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
