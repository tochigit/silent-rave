import bcrypt from "bcryptjs";

// ─────────────────────────────────────────────────────────────────────────────
// Password hashing (06-auth-and-roles.md: "bcrypt or argon2 — never stored
// plaintext, never logged").
//
// ⚠ LIBRARY CHOICE — DELIBERATE DECISION REQUIRED BEFORE PRODUCTION ⚠
// bcryptjs is a PURE-JAVASCRIPT reimplementation of bcrypt, chosen because
// this sandbox toolchain cannot reliably compile native addons. It produces
// standard $2b$ bcrypt hashes that verify with ANY bcrypt implementation
// (native `bcrypt`, OS bcrypt, etc.), so stored password_hash rows are fully
// portable — but the library itself is slower per hash than native code, and
// a security-relevant crypto primitive should not be silently inherited into
// production. Before deploying to real hosting, EITHER confirm bcryptjs is
// acceptable for the invite-only staff user base, OR swap `bcryptjs` →
// native `bcrypt` or `argon2` (npm) if the target host supports native
// builds. A swap requires: this file (import + API are identical for
// `bcrypt`), and the `serverExternalPackages` entry in next.config.ts.
// Existing hashes keep verifying either way — no rehash migration needed.
//
// COST FACTOR: 12 (BCRYPT_COST below). Native bcrypt defaults to 10; the
// usual modern baseline is 10–12 (OWASP recommends ≥10). 12 therefore meets
// or exceeds native-library defaults. Measured on this sandbox: ~275 ms per
// hash/verify in pure JS (vs ~69 ms at cost 10) — acceptable for an
// invite-only user base logging in a handful of times per day, and it
// doubles as the deliberate constant work factor on the login route's
// timing-equalized unknown-email path (see fakeVerify below).
// ─────────────────────────────────────────────────────────────────────────────

const BCRYPT_COST = 12;

// ── Timing-equalization for unknown emails ───────────────────────────────────
//
// A dummy bcrypt hash is compared against when the login email does not exist,
// so "unknown email" and "wrong password" burn the same ~CPU time and take the
// same code path — prevents user-enumeration via response-timing analysis.
//
// Task 0a (Phase 3): the hash is GENERATED from BCRYPT_COST above (lazily, once,
// cached, race-safe via a shared promise) rather than a hardcoded literal, so
// the dummy compare's cost factor is tied to the real hashing cost BY
// CONSTRUCTION — changing BCRYPT_COST can never silently desynchronize the two.
// It never corresponds to any real account (fixed non-secret seed string).
const DUMMY_HASH_SEED = "silentrave-timing-equalizer-not-a-real-password-v1";

let dummyHashPromise: Promise<string> | null = null;

function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = bcrypt.hash(DUMMY_HASH_SEED, BCRYPT_COST);
  }
  return dummyHashPromise;
}

export async function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, BCRYPT_COST);
}

export async function verifyPassword(plainPassword: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(plainPassword, passwordHash);
}

/** Timing-equalization compare for unknown emails — result is always discarded. */
export async function fakeVerify(plainPassword: string): Promise<void> {
  await bcrypt.compare(plainPassword, await getDummyHash());
}
