// ─────────────────────────────────────────────────────────────────────────────
// Typed service errors for the manual-payment order flow. Routes map code →
// HTTP status once, here; services throw and never build HTTP themselves.
// ─────────────────────────────────────────────────────────────────────────────

export type OrderServiceErrorCode =
  | "CHECKED_IN_TICKETS"
  | "VALIDATION" //        400 — malformed input the route's zod didn't catch
  | "NOT_FOUND" //         404 — unknown order/event/tier id or code
  | "INSUFFICIENT_INVENTORY" // 409 — a tier cannot cover a line (409 per 03)
  | "RATE_LIMITED" //      429 — per-IP or per-key rate limit
  | "TOO_MANY_UNRESOLVED" // 429 — per-email/per-phone unresolved-order cap (03: "limits")
  | "NO_PAYMENT_ACCOUNT" // 503 — no active bank account to pay into (03)
  | "EVENT_CANCELLED" //   409 — approveOrder on a cancelled event (04)
  | "CAPACITY_GONE" //     409 — revive could not re-reserve capacity (04)
  | "INVALID_STATE" //     409 — transition not allowed from the current state
  | "ATTEMPTS_EXHAUSTED" // 403 — proof_attempts >= 1 + MAX_RESUBMISSIONS (04)
  | "HOLD_EXPIRED" //      410 — hold lapsed and outside the late-proof grace
  | "DUPLICATE_REFERENCE" // 409 — transfer_reference collision (04)
  | "BAD_FILE" //          422 — failed magic-byte/size/dimension validation
  | "UNAUTHORIZED" //      403 — wrong/missing status token or password
  | "FORBIDDEN"; //        403 — role/permission failures surfaced by services

const HTTP_BY_CODE: Record<OrderServiceErrorCode, number> = {
  CHECKED_IN_TICKETS: 409,
  VALIDATION: 400,
  NOT_FOUND: 404,
  INSUFFICIENT_INVENTORY: 409,
  RATE_LIMITED: 429,
  TOO_MANY_UNRESOLVED: 429,
  NO_PAYMENT_ACCOUNT: 503,
  EVENT_CANCELLED: 409,
  CAPACITY_GONE: 409,
  INVALID_STATE: 409,
  ATTEMPTS_EXHAUSTED: 403,
  HOLD_EXPIRED: 410,
  DUPLICATE_REFERENCE: 409,
  BAD_FILE: 422,
  UNAUTHORIZED: 403,
  FORBIDDEN: 403,
};

export class OrderServiceError extends Error {
  readonly code: OrderServiceErrorCode;
  readonly httpStatus: number;
  /** Machine-readable detail for logs/tests; never contains secrets or PII. */
  readonly detail?: Record<string, unknown>;

  constructor(code: OrderServiceErrorCode, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = "OrderServiceError";
    this.code = code;
    this.httpStatus = HTTP_BY_CODE[code];
    this.detail = detail;
  }
}
