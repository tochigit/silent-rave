import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { guardApi, ADMIN_API_ROLES } from "@/lib/auth/guards";
import { originCheck } from "@/lib/auth/origin";
import { rejectOrder } from "@/lib/orders/review";
import { PROOF_REJECT_REASON_CODES } from "@/lib/constants";
import { OrderServiceError } from "@/lib/orders/errors";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/orders/:id/reject (03 v2.1; runs rejectOrder, 04 + CHANGELOG
// item 2). OWNER only + Origin check (state-changing).
//
// Body: { reason_code, message, final }. Allowed from the three source states:
//   • PROOF_SUBMITTED (resubmittable if attempts remain and final is false)
//   • NEEDS_RESUBMIT  (owner closes → always final)
//   • EXPIRED with a PENDING proof (dismiss → always final, releases nothing)
// Queues a REJECTED email job (dedupe attempt-<n>; fresh key for close/dismiss).
// ─────────────────────────────────────────────────────────────────────────────

const bodySchema = z.object({
  reason_code: z.enum(PROOF_REJECT_REASON_CODES),
  message: z.string().trim().min(1).max(2000),
  final: z.boolean(),
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
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "reason_code, message and final are required.", issues: parsed.error.issues.map((i) => i.message) },
      { status: 400 }
    );
  }

  try {
    const result = await rejectOrder(id, guard.user.id, {
      reasonCode: parsed.data.reason_code,
      message: parsed.data.message,
      final: parsed.data.final,
    });
    return NextResponse.json(
      {
        ok: true,
        from: result.from,
        order_status: result.orderStatus,
        released: result.released,
        email_dedupe_key: result.emailDedupeKey,
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof OrderServiceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.httpStatus });
    }
    console.error("[admin/orders/reject] unexpected error:", error);
    return NextResponse.json({ error: "Rejection failed unexpectedly." }, { status: 500 });
  }
}
