import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { guardApi, ADMIN_API_ROLES } from "@/lib/auth/guards";
import { originCheck } from "@/lib/auth/origin";
import { approveOrder } from "@/lib/orders/review";
import { OrderServiceError } from "@/lib/orders/errors";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/orders/:id/approve (03 v2.1; runs approveOrder, 04).
//
// Body: { "confirmed_in_bank": true, "note"?: string } — the explicit
// confirmation that the owner checked the credit in the bank app (04: "The
// amount is not editable: if the buyer paid the wrong amount, reject with
// AMOUNT_MISMATCH"). Missing/false confirmation → 400 BEFORE anything runs.
//
// Idempotent on APPROVED; CAPACITY_GONE on a failed revive; EVENT_CANCELLED
// if the event was cancelled. OWNER only + Origin check (state-changing).
// ─────────────────────────────────────────────────────────────────────────────

const bodySchema = z.object({
  confirmed_in_bank: z.literal(true),
  note: z.string().trim().max(2000).optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardApi(request, ADMIN_API_ROLES);
  if (!guard.ok) return guard.response;

  const origin = originCheck(request, "admin");
  if (!origin.ok) return origin.response;

  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid order id." }, { status: 400 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json(
      { error: "confirmed_in_bank: true is required in the body." },
      { status: 400 }
    );
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Approving requires confirmed_in_bank: true (you checked the credit in the bank app)." },
      { status: 400 }
    );
  }

  try {
    const result = await approveOrder(id, guard.user.id);
    return NextResponse.json(
      {
        ok: true,
        idempotent: result.idempotent,
        revived: result.revived,
        ticket_count: result.ticketCount,
        note: parsed.data.note ?? null,
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof OrderServiceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.httpStatus });
    }
    console.error("[admin/orders/approve] unexpected error:", error);
    return NextResponse.json({ error: "Approval failed unexpectedly." }, { status: 500 });
  }
}
