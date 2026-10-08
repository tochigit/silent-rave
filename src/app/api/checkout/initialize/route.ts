import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  MAX_QTY_PER_ORDER,
  initializeIpRatePerHour,
  PROOF_IP_RATE_PER_HOUR,
} from "@/lib/constants";
import {
  consumeRateLimit,
  RateLimitUnavailableError,
  rateLimitUnavailableResponse,
  rateLimitIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { initializeCheckout } from "@/lib/checkout/service";
import { OrderServiceError } from "@/lib/orders/errors";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/checkout/initialize (03-api-routes.md v2.1 "Public — Checkout").
//
// Public (no session — guests check out with name/email/phone, 06). IP is a
// RATE limit only (default 10/hour, configurable) — NOT an unresolved-order
// cap (shared campus NAT, 04). Unresolved caps are per-email/per-phone and
// enforced inside the service's reservation transaction.
//
// Prices are never accepted from the client (server-side pricing in the
// service). Responses carry exactly what the buyer needs to pay: order code,
// derived status token, amount, hold expiry and the ACTIVE bank account.
// ─────────────────────────────────────────────────────────────────────────────

const bodySchema = z.object({
  event_id: z.string().uuid(),
  customer_name: z.string().trim().min(1).max(200),
  customer_email: z.string().trim().toLowerCase().email().max(320),
  customer_phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9]{7,15}$/, "phone must be 7–15 digits, optional leading +"),
  line_items: z
    .array(
      z.object({
        tier_id: z.string().uuid(),
        quantity: z.number().int().min(1).max(MAX_QTY_PER_ORDER),
        holder_names: z.array(z.string().trim().min(1).max(200)).optional(),
      }),
    )
    .min(1)
    .max(20),
});

export async function POST(request: NextRequest) {
  try {
    // Per-IP rate limit (10/hour default; INITIALIZE_IP_RATE_LIMIT_PER_HOUR).
    const ip = clientIp(request);
    const limited = await consumeRateLimit("checkout-initialize-ip", ip, {
      limit: initializeIpRatePerHour(),
      windowMs: 60 * 60 * 1000,
    });
    if (limited.limited) {
      return rateLimitResponse(
        limited.retryAfterSec,
        "Too many checkout attempts from this network.",
      );
    }

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body." },
        { status: 400 },
      );
    }

    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          issues: parsed.error.issues.map((i) => i.message),
        },
        { status: 400 },
      );
    }

    const body = parsed.data;
    for (const line of body.line_items) {
      if (
        line.holder_names !== undefined &&
        line.holder_names.length !== line.quantity
      ) {
        return NextResponse.json(
          { error: "holder_names length must equal quantity (or be omitted)." },
          { status: 400 },
        );
      }
    }

    try {
      const result = await initializeCheckout({
        eventId: body.event_id,
        customerName: body.customer_name,
        customerEmail: body.customer_email,
        customerPhone: body.customer_phone,
        lineItems: body.line_items.map((line) => ({
          tierId: line.tier_id,
          quantity: line.quantity,
          holderNames: line.holder_names,
        })),
      });

      return NextResponse.json(
        {
          order_code: result.orderCode,
          status_token: result.statusToken,
          amount_kobo: result.amountKobo,
          hold_expires_at: result.holdExpiresAt.toISOString(),
          payment_account: {
            bank_name: result.paymentAccount.bankName,
            account_number: result.paymentAccount.accountNumber,
            account_name: result.paymentAccount.accountName,
          },
        },
        { status: 201 },
      );
    } catch (error) {
      if (error instanceof OrderServiceError) {
        return NextResponse.json(
          { error: error.message, code: error.code },
          { status: error.httpStatus },
        );
      }
      console.error("[checkout/initialize] unexpected error");
      return NextResponse.json(
        { error: "Checkout failed unexpectedly." },
        { status: 500 },
      );
    }
  } catch (error) {
    if (error instanceof RateLimitUnavailableError)
      return rateLimitUnavailableResponse();
    throw error;
  }
}

/** Canonical platform IP (explicit synthetic fixture identity in local tests). */
function clientIp(request: NextRequest): string {
  return rateLimitIp(request);
}
