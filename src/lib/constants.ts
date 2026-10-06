// ─────────────────────────────────────────────────────────────────────────────
// Silent Rave — domain constants (04-manual-payment.md "Hold policy (locked)"
// + 02/03 v2.1). Single source of truth; services must never inline these.
// ─────────────────────────────────────────────────────────────────────────────

/** 15 minutes from order creation to submit a proof (04). */
export const PROOF_SUBMIT_WINDOW_MS = 15 * 60 * 1000;

/** 48 hours from the FIRST proof submission; never extended by re-uploads (04). */
export const HOLD_CAP_MS = 48 * 60 * 60 * 1000;

/** Max re-uploads after resubmittable rejections (04). */
export const MAX_RESUBMISSIONS = 3;

/** Total proof submissions allowed = 1 + MAX_RESUBMISSIONS = 4 (02 v2.1). */
export const MAX_PROOF_SUBMISSIONS = 1 + MAX_RESUBMISSIONS;

/** Max quantity per order line item (04). */
export const MAX_QTY_PER_ORDER = 10;

/**
 * Late-proof grace: a proof for an EXPIRED order that had NO proof yet is
 * recorded (PENDING, flags.late) within 24 h after hold_expires_at; after that
 * the endpoint returns 410 (04 "Late proofs").
 */
export const LATE_PROOF_GRACE_MS = 24 * 60 * 60 * 1000;

/** Max proof upload size in bytes (4 MB; applies to the ORIGINAL upload). */
export { IMAGE_FILE_BYTES as MAX_PROOF_FILE_BYTES } from "./uploads/limits";

/** "Sane pixel dimensions" (04) — inclusive bounds on width and height. */
export const PROOF_IMAGE_MAX_DIMENSION = 10000;
export const PROOF_IMAGE_MIN_DIMENSION = 1;

/**
 * Max unresolved (AWAITING_PAYMENT | PROOF_SUBMITTED | NEEDS_RESUBMIT) orders
 * per email AND per phone (04). NOT a per-IP cap — campus users share NAT
 * addresses and would block each other.
 */
export const MAX_UNRESOLVED_ORDERS_PER_EMAIL = 2;
export const MAX_UNRESOLVED_ORDERS_PER_PHONE = 2;

/**
 * Per-IP initialize rate limit: default 10 requests/hour (04), configurable
 * via INITIALIZE_IP_RATE_LIMIT_PER_HOUR (tests raise it / lower it).
 */
export function initializeIpRatePerHour(): number {
  const raw = Number(process.env.INITIALIZE_IP_RATE_LIMIT_PER_HOUR);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 10;
}

/** Per-IP proof-submission rate limit (04 mentions rate limits on proof). */
export const PROOF_IP_RATE_PER_HOUR = 30;

/** Lookup endpoint: per-IP and per-order-code rate limits (03 "strictly"). */
export const LOOKUP_IP_RATE_PER_HOUR = 10;
export const LOOKUP_CODE_RATE_PER_HOUR = 3;

/**
 * Order-code alphabet — unambiguous (no 0/O/1/I), non-sequential (02 v2.1).
 * 31 symbols, 6 random chars → 31^6 ≈ 887M codes.
 */
export const ORDER_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const ORDER_CODE_PREFIX = "SR-";
export const ORDER_CODE_LENGTH = 6;

/** Order statuses that count toward the per-email/per-phone abuse caps. */
export const UNRESOLVED_ORDER_STATUSES = [
  "AWAITING_PAYMENT",
  "PROOF_SUBMITTED",
  "NEEDS_RESUBMIT",
] as const;

/** Proof reject reason codes (02 v2.1 payment_proofs.reject_reason_code). */
export const PROOF_REJECT_REASON_CODES = [
  "UNREADABLE",
  "AMOUNT_MISMATCH",
  "NOT_RECEIVED",
  "DUPLICATE_REFERENCE",
  "CAPACITY_GONE",
  "OTHER",
] as const;
export type ProofRejectReasonCode = (typeof PROOF_REJECT_REASON_CODES)[number];

/** Status token header/query name used by order routes (03). */
export const STATUS_TOKEN_HEADER = "x-status-token";

/** Signed proof-image URL lifetime for OWNER review screens (04: 60–120 s). */
export const PROOF_SIGNED_URL_TTL_SECONDS = 90;

/**
 * Transaction options for all interactive transactions in the payment flow.
 *
 * Timeout rationale: every such transaction is short (row locks + a handful of
 * single-row UPDATEs/INSERTs; NO external I/O inside — storage writes and
 * notification emits happen before/after commit). 10 s is far above the worst
 * observed case but far below the 15-min proof window, so a stuck transaction
 * cannot pin tier locks for a meaningful share of a hold's life. maxWait 5 s
 * bounds how long a request queues for a pool connection before failing fast.
 */
export const TX_OPTIONS = { timeout: 10_000, maxWait: 5_000 } as const;
