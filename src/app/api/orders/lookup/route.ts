import { kickEmailJobs } from "@/lib/email/kick";
import { NextResponse, type NextRequest, after } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  LOOKUP_CODE_RATE_PER_HOUR,
  LOOKUP_IP_RATE_PER_HOUR,
} from "@/lib/constants";
import {
  consumeRateLimit,
  RateLimitUnavailableError,
  rateLimitUnavailableResponse,
  rateLimitIp,
  rateLimitResponse,
} from "@/lib/rate-limit";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/orders/lookup (03-api-routes.md v2.1 as changed by CHANGELOG
// item 6).
//
//   { order_code, email } → ALWAYS 202 with the SAME generic body:
//   "If those details match an order, we have emailed its status link."
//
//   • When code and email match an order: insert a STATUS_LINK email_jobs row
//     with a FRESH dedupe key (random — every lookup may mail). The link is
//     derived at send time from STATUS_TOKEN_SECRET, so nothing is stored or
//     rotated here. NO email is sent in this phase (job row only; the worker
//     is later work).
//   • It NEVER returns order data. Response and timing must not reveal which
//     field was wrong: the same SELECT runs on every call, the only extra
//     work on a match is the job INSERT (~ms), and a small fixed delay
//     flattens the remainder (see below).
//   • Rate limited per IP (10/h) and per order code (3/h). The per-code limit
//     can only reveal that a code was looked up often — never whether it
//     exists.
// ─────────────────────────────────────────────────────────────────────────────

const GENERIC_BODY = {
  message: "If those details match an order, we have emailed its status link.",
} as const;

const bodySchema = z.object({
  order_code: z.string().trim().min(3).max(64),
  email: z.string().trim().toLowerCase().email().max(320),
});

/** Uniform response for EVERY outcome (byte-identical). */
function generic202(): NextResponse {
  return NextResponse.json(GENERIC_BODY, { status: 202 });
}

export async function POST(request: NextRequest) {
  try {
    const ip = rateLimitIp(request);
    const ipLimited = await consumeRateLimit("lookup-ip", ip, {
      limit: LOOKUP_IP_RATE_PER_HOUR,
      windowMs: 60 * 60 * 1000,
    });
    if (ipLimited.limited) {
      return rateLimitResponse(
        ipLimited.retryAfterSec,
        "Too many lookups from this network.",
      );
    }

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return generic202(); // malformed body: same generic answer, no oracle
    }
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return generic202(); // validation failure: same generic answer
    }

    const { order_code, email } = parsed.data;

    const codeLimited = await consumeRateLimit(
      "lookup-code",
      order_code.toUpperCase(),
      {
        limit: LOOKUP_CODE_RATE_PER_HOUR,
        windowMs: 60 * 60 * 1000,
      },
    );
    if (codeLimited.limited) {
      return rateLimitResponse(
        codeLimited.retryAfterSec,
        "Too many lookups for this order code.",
      );
    }

    // The one and only SELECT — identical on match and non-match.
    const order = await db.order.findUnique({
      where: { orderCode: order_code },
      select: { id: true, customerEmail: true },
    });

    if (order && order.customerEmail === email) {
      // Fresh dedupe key every time (03: STATUS_LINK uses a fresh key).
      await db.emailJob.create({
        data: {
          orderId: order.id,
          kind: "STATUS_LINK",
          dedupeKey: `statuslink-${randomUUID()}`,
          recipientEmail: order.customerEmail,
        },
      });
    }

    // Flatten the timing difference the INSERT introduces (~1–3 ms) so the
    // response time does not act as a match/non-match oracle.
    await new Promise((resolve) => setTimeout(resolve, 50));

    after(kickEmailJobs);
    return generic202();
  } catch (error) {
    if (error instanceof RateLimitUnavailableError)
      return rateLimitUnavailableResponse();
    throw error;
  }
}
