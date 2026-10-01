// ─────────────────────────────────────────────────────────────────────────────
// Minimal in-memory sliding-window rate limiter. No Redis (per spec: no extra
// middleware at this scale), no DB write on the hot path.
//
// WHERE THE LIMITER STATE LIVES: a module-level Map inside the Node server
// process. Consequences (accepted for v1, documented): per-process only —
// resets on server restart and is NOT shared across instances. This is fine
// for the v1 deployment shape (single app server); a multi-instance deploy
// would need a shared store before these limits mean anything globally.
// The authoritative protections are elsewhere (transfer-reference
// uniqueness, DB CHECK constraints, signature/token checks) — these limits
// only blunt abuse.
//
// Consumers (manual-payment phase):
//   • login route            — 10 attempts / 10 min / per email
//   • checkout initialize    — per-IP 10/hour (INITIALIZE_IP_RATE_LIMIT_PER_HOUR)
//   • proof submission       — per-IP 30/hour
//   • orders lookup          — per-IP 10/hour + per-order-code 3/hour
// ─────────────────────────────────────────────────────────────────────────────

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function pruneExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export type RateLimitOptions = {
  /** Max requests within the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
};

export type RateLimitResult = {
  /** true = the request is over the limit and must be rejected. */
  limited: boolean;
  /** Seconds until the bucket resets (for the Retry-After header). */
  retryAfterSec: number;
};

/**
 * Consume one request from the named bucket (e.g. "checkout-email", "login").
 * Increments the counter even when returning over-limit — a hammering client
 * never "waits off" the limit by continuing to hit it.
 */
export function consumeRateLimit(
  bucketName: string,
  key: string,
  { limit, windowMs }: RateLimitOptions
): RateLimitResult {
  const now = Date.now();
  if (buckets.size > 5000) pruneExpired(now);

  const compositeKey = `${bucketName}:${key}`;
  const existing = buckets.get(compositeKey);

  if (!existing || existing.resetAt <= now) {
    buckets.set(compositeKey, { count: 1, resetAt: now + windowMs });
    return { limited: false, retryAfterSec: Math.ceil(windowMs / 1000) };
  }

  existing.count += 1;
  const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
  return { limited: existing.count > limit, retryAfterSec };
}

/** 429 response helper with the standard Retry-After header. */
export function rateLimitResponse(retryAfterSec: number, message: string) {
  return Response.json({ error: message }, {
    status: 429,
    headers: { "Retry-After": String(retryAfterSec) },
  });
}
