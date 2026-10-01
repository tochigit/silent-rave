import { createHmac, timingSafeEqual } from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Derived status-link tokens (02-database-schema.md v2.1, orders.
// status_token_version; CHANGELOG v2.1 item 6).
//
//   token = base64url(HMAC-SHA256(STATUS_TOKEN_SECRET, order_id ":" version))
//
// The token is DERIVED, never stored: the email worker can put the link into
// any email without a raw token ever being persisted. Bumping
// status_token_version invalidates old links. Verification recomputes and
// compares in CONSTANT TIME — the HMAC output is a fixed 32 bytes, so the
// comparison is always 32-vs-32 bytes (a different-length input is rejected
// before the compare; length is not secret).
//
// STATUS_TOKEN_SECRET is a server-only env var (06). Missing secret = fail
// closed with a loud error, never a silently-degraded token.
// ─────────────────────────────────────────────────────────────────────────────

function getStatusTokenSecret(): Buffer {
  const raw = process.env.STATUS_TOKEN_SECRET;
  if (!raw || raw.length < 16) {
    throw new Error(
      "STATUS_TOKEN_SECRET is unset or too short (<16 chars) — refusing to derive status tokens. Set it in the environment (see .env.example)."
    );
  }
  return Buffer.from(raw, "utf8");
}

/** Derive the buyer's status-link token for an order id + token version. */
export function deriveStatusToken(orderId: string, statusTokenVersion: number): string {
  const mac = createHmac("sha256", getStatusTokenSecret())
    .update(`${orderId}:${statusTokenVersion}`)
    .digest();
  return mac.toString("base64url");
}

/**
 * Verify a presented token against the derived token for (orderId, version).
 * Constant-time: recomputes the HMAC and compares the two 32-byte digests with
 * crypto.timingSafeEqual — no early exit on byte mismatch.
 */
export function verifyStatusToken(
  orderId: string,
  statusTokenVersion: number,
  presentedToken: string
): boolean {
  if (typeof presentedToken !== "string" || presentedToken.length === 0) return false;

  const expected = Buffer.from(deriveStatusToken(orderId, statusTokenVersion), "base64url");
  let given: Buffer;
  try {
    given = Buffer.from(presentedToken, "base64url");
  } catch {
    return false;
  }

  // Fixed-length HMAC digests: a legitimate token always decodes to 32 bytes.
  // Anything else is malformed and rejected (length is not secret material).
  if (given.length !== expected.length || expected.length === 0) return false;

  return timingSafeEqual(expected, given);
}

/** Build the status-page path the way emails / lookup jobs will carry it. */
export function statusPagePath(orderCode: string, token: string): string {
  return `/order/${encodeURIComponent(orderCode)}?t=${encodeURIComponent(token)}`;
}
