import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { MAX_RESUBMISSIONS, STATUS_TOKEN_HEADER } from "@/lib/constants";
import { verifyStatusToken } from "@/lib/orders/status-token";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/orders/:code/status (03-api-routes.md v2.1).
//
// Requires the order's status_token (x-status-token header or ?t=). Returns
// status, proof_attempts, max_resubmissions, latest reject reason/message
// when NEEDS_RESUBMIT/REJECTED, hold_expires_at, late_proof_received when an
// EXPIRED order has a late (PENDING) proof — and ONLY when APPROVED, the
// ticket list. No PDF URLs yet (Phase 4). No PII beyond what the buyer
// entered themselves at checkout.
//
// Uniform 404 for unknown codes AND wrong tokens alike (the token is the only
// secret; wrong-token on a known code must not confirm the code exists).
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const token =
    request.headers.get(STATUS_TOKEN_HEADER) ?? request.nextUrl.searchParams.get("t") ?? "";

  const order = await db.order.findUnique({
    where: { orderCode: code },
    select: {
      id: true,
      orderCode: true,
      status: true,
      statusTokenVersion: true,
      holdExpiresAt: true,
      proofAttempts: true,
      eventId: true,
      event: { select: { title: true } },
    },
  });

  if (!order || !token || !verifyStatusToken(order.id, order.statusTokenVersion, token)) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  // Latest reject reason/message when NEEDS_RESUBMIT or REJECTED (03).
  let rejection: { reason_code: string | null; message: string | null } | null = null;
  if (order.status === "NEEDS_RESUBMIT" || order.status === "REJECTED") {
    const latestProof = await db.paymentProof.findFirst({
      where: { orderId: order.id },
      orderBy: { attemptNo: "desc" },
      select: { rejectReasonCode: true, rejectMessage: true },
    });
    rejection = {
      reason_code: latestProof?.rejectReasonCode ?? null,
      message: latestProof?.rejectMessage ?? null,
    };
  }

  // late_proof_received: an EXPIRED order with a late proof (03 v2.1).
  let lateProofReceived = false;
  if (order.status === "EXPIRED") {
    const lateProof = await db.paymentProof.findFirst({
      where: { orderId: order.id },
      orderBy: { attemptNo: "desc" },
      select: { flags: true },
    });
    const flags = (latestProofFlags(lateProof)) as Record<string, unknown>;
    lateProofReceived = flags.late === true;
  }

  // Ticket list ONLY when APPROVED — no PDF URLs for now (Phase 4 per 03).
  let tickets: Array<{ ticket_id: string; tier_name: string; holder_name: string | null }> = [];
  if (order.status === "APPROVED") {
    const units = await db.ticketUnit.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, holderName: true, tier: { select: { name: true } } },
    });
    tickets = units.map((unit) => ({
      ticket_id: unit.id,
      tier_name: unit.tier.name,
      holder_name: unit.holderName,
    }));
  }

  const body: Record<string, unknown> = {
    order_code: order.orderCode,
    status: order.status,
    proof_attempts: order.proofAttempts,
    max_resubmissions: MAX_RESUBMISSIONS,
    hold_expires_at: order.holdExpiresAt?.toISOString() ?? null,
  };
  if (rejection) {
    body.rejection = rejection;
  }
  if (lateProofReceived) {
    body.late_proof_received = true;
  }
  if (order.status === "APPROVED") {
    body.tickets = tickets;
  }

  return NextResponse.json(body, { status: 200 });
}

function latestProofFlags(proof: { flags: unknown } | null): unknown {
  return proof?.flags ?? {};
}
