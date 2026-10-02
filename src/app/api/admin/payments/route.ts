import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { guardApi, ADMIN_API_ROLES } from "@/lib/auth/guards";
import { HOLD_CAP_MS } from "@/lib/constants";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/payments — the owner's review queue (03 v2.1 "Payments and
// orders"). OWNER only; server-side role check on every request (06).
//
//   ?status=PROOF_SUBMITTED | NEEDS_RESUBMIT | EXPIRED_HAD_PROOF   (optional)
//   ?page=1  ?search=<code|email|name|phone|transfer reference>    (optional)
//
// Default view = the queue 04 describes: PROOF_SUBMITTED oldest first, then
// "Expired — had proof" (EXPIRED with a PENDING proof). Each row carries the
// review-screen essentials: order code, buyer contact, tier+qty, expected
// amount, submitted time, attempt number, transfer reference + sender name,
// flags (duplicate image / late), and urgency near the 48 h cap.
// GET is not state-changing → no Origin check (06).
// ─────────────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;
const URGENT_WITHIN_MS = 6 * 60 * 60 * 1000; // 04: "approaching the cap (e.g. 6h left)"

type QueueStatus = "PROOF_SUBMITTED" | "NEEDS_RESUBMIT" | "EXPIRED";

const orderSelect = {
  id: true,
  orderCode: true,
  status: true,
  customerName: true,
  customerEmail: true,
  customerPhone: true,
  totalKobo: true,
  firstProofAt: true,
  proofAttempts: true,
  holdExpiresAt: true,
  createdAt: true,
  lineItems: {
    select: { quantity: true, unitPriceKobo: true, tier: { select: { name: true } } },
  },
  proofs: {
    orderBy: { attemptNo: "desc" as const },
    take: 1,
    select: {
      attemptNo: true,
      transferReference: true,
      senderName: true,
      status: true,
      flags: true,
      createdAt: true,
    },
  },
} satisfies Prisma.OrderSelect;

type QueueOrder = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;

function buildWhere(status: QueueStatus, search: string): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = { status };
  if (status === "EXPIRED") {
    // EXPIRED_HAD_PROOF = EXPIRED with a PENDING proof (03).
    where.proofs = { some: { status: "PENDING" } };
  }
  if (search) {
    const textMatch: Prisma.OrderWhereInput[] = [
      { orderCode: { contains: search, mode: "insensitive" } },
      { customerEmail: { contains: search, mode: "insensitive" } },
      { customerName: { contains: search, mode: "insensitive" } },
      { customerPhone: { contains: search } },
      { proofs: { some: { transferReference: { contains: search.toUpperCase() } } } },
    ];
    where.AND = [
      ...(status === "EXPIRED" ? [{ proofs: { some: { status: "PENDING" as const } } }] : []),
      { OR: textMatch },
    ];
  }
  return where;
}

async function fetchPage(status: QueueStatus, search: string, page: number): Promise<QueueOrder[]> {
  return db.order.findMany({
    where: buildWhere(status, search),
    orderBy: [{ firstProofAt: "asc" }, { createdAt: "asc" }],
    select: orderSelect,
    take: PAGE_SIZE,
    skip: (page - 1) * PAGE_SIZE,
  });
}

function toQueueRow(order: QueueOrder) {
  const latestProof = order.proofs[0] ?? null;
  const flags = (latestProof?.flags ?? {}) as Record<string, unknown>;
  const holdMsLeft = order.holdExpiresAt ? order.holdExpiresAt.getTime() - Date.now() : null;
  return {
    order_id: order.id,
    order_code: order.orderCode,
    status: order.status,
    bucket: order.status === "EXPIRED" ? "EXPIRED_HAD_PROOF" : order.status,
    buyer: {
      name: order.customerName,
      email: order.customerEmail,
      phone: order.customerPhone,
    },
    expected_amount_kobo: order.totalKobo,
    line_items: order.lineItems.map((item) => ({
      tier_name: item.tier.name,
      quantity: item.quantity,
      unit_price_kobo: item.unitPriceKobo,
    })),
    submitted_at: latestProof?.createdAt ?? order.firstProofAt,
    attempt_no: latestProof?.attemptNo ?? order.proofAttempts,
    transfer_reference: latestProof?.transferReference ?? null,
    sender_name: latestProof?.senderName ?? null,
    flags,
    urgency:
      holdMsLeft === null ? null : holdMsLeft <= 0 ? "expired" : holdMsLeft <= URGENT_WITHIN_MS ? "urgent" : "ok",
    hours_left_on_hold: holdMsLeft === null ? null : Math.round(holdMsLeft / 3_600_000),
    hold_cap_ms: HOLD_CAP_MS,
  };
}

export async function GET(request: NextRequest) {
  const guard = await guardApi(request, ADMIN_API_ROLES);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const search = url.searchParams.get("search")?.trim() ?? "";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);

  try {
    let rows: ReturnType<typeof toQueueRow>[];
    if (statusParam === "PROOF_SUBMITTED" || statusParam === "NEEDS_RESUBMIT" || statusParam === "EXPIRED_HAD_PROOF") {
      const status: QueueStatus =
        statusParam === "EXPIRED_HAD_PROOF" ? "EXPIRED" : statusParam;
      rows = (await fetchPage(status, search, page)).map(toQueueRow);
    } else if (statusParam) {
      return NextResponse.json(
        { error: "status must be PROOF_SUBMITTED, NEEDS_RESUBMIT or EXPIRED_HAD_PROOF." },
        { status: 400 }
      );
    } else {
      // Default queue (04): PROOF_SUBMITTED oldest first, then expired-had-proof.
      const submitted = await fetchPage("PROOF_SUBMITTED", search, page);
      const expiredWithProof = await fetchPage("EXPIRED", search, page);
      rows = [...submitted, ...expiredWithProof].map(toQueueRow);
    }

    return NextResponse.json(
      { queue: rows, pagination: { page, page_size: PAGE_SIZE } },
      { status: 200 }
    );
  } catch (error) {
    console.error("[admin/payments] queue query failed:", error);
    return NextResponse.json({ error: "Queue query failed." }, { status: 500 });
  }
}
