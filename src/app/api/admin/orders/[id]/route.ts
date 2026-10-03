import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { guardApi, ADMIN_API_ROLES } from "@/lib/auth/guards";
import { getStorage } from "@/lib/storage";
import { PROOF_SIGNED_URL_TTL_SECONDS } from "@/lib/constants";
import { emailJobDto, emailJobSelect } from "@/lib/email/dto";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/orders/:id — full review detail (03 v21): buyer info, line
// items, ALL proof attempts (with short-lived SIGNED image URLs, 60–120 s,
// minted per request for OWNER only), ticket units and check-in state.
// GET is not state-changing → no Origin check (06). proxy.ts already gates
// /api/admin/* centrally; guardApi is the per-route enforcement point.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardApi(request, ADMIN_API_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid order id." }, { status: 400 });
  }

  const order = await db.order.findUnique({
    where: { id },
    select: {
      id: true,
      emailJobs: { select: emailJobSelect, orderBy: { createdAt: "asc" } },
      orderCode: true,
      status: true,
      source: true,
      customerName: true,
      customerEmail: true,
      customerPhone: true,
      totalKobo: true,
      holdExpiresAt: true,
      firstProofAt: true,
      proofAttempts: true,
      inventoryReleased: true,
      approvedAt: true,
      approvedBy: true,
      createdAt: true,
      event: { select: { id: true, title: true, status: true } },
      paymentAccount: { select: { bankName: true, accountNumber: true, accountName: true } },
      paymentAccountSnapshot: true,
      lineItems: {
        select: {
          quantity: true,
          unitPriceKobo: true,
          holderNames: true,
          tier: { select: { id: true, name: true } },
        },
      },
      proofs: {
        orderBy: { attemptNo: "asc" },
        select: {
          id: true,
          attemptNo: true,
          clientSubmissionId: true,
          storagePath: true,
          fileSha256: true,
          mimeType: true,
          sizeBytes: true,
          transferReference: true,
          senderName: true,
          status: true,
          rejectReasonCode: true,
          rejectMessage: true,
          rejectFinal: true,
          flags: true,
          reviewedAt: true,
          createdAt: true,
        },
      },
      ticketUnits: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          holderName: true,
          checkInStatus: true,
          checkedInAt: true,
          voidedAt: true,
          syncSeq: true,
          tier: { select: { name: true } },
        },
      },
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  // Mint short-lived signed URLs per request (60–120 s). The serving route
  // re-checks the OWNER session AND the signature AND the expiry — none of
  // the three alone is enough (04: proof images are OWNER-only).
  const storage = getStorage();
  const proofs = await Promise.all(
    order.proofs.map(async (proof) => ({
      ...proof,
      holderNames: undefined,
      storagePath: undefined, // never leak the raw private path to the client
      image_url: await storage.createSignedUrl(proof.storagePath, PROOF_SIGNED_URL_TTL_SECONDS),
    }))
  );

  return NextResponse.json(
    {
      order_id: order.id,
      email_jobs: order.emailJobs.map(emailJobDto),
      order_code: order.orderCode,
      status: order.status,
      source: order.source,
      buyer: {
        name: order.customerName,
        email: order.customerEmail,
        phone: order.customerPhone,
      },
      total_kobo: order.totalKobo,
      hold_expires_at: order.holdExpiresAt?.toISOString() ?? null,
      first_proof_at: order.firstProofAt?.toISOString() ?? null,
      proof_attempts: order.proofAttempts,
      inventory_released: order.inventoryReleased,
      approved_at: order.approvedAt?.toISOString() ?? null,
      approved_by: order.approvedBy,
      created_at: order.createdAt.toISOString(),
      event: order.event,
      payment_account: order.paymentAccountSnapshot,
      line_items: order.lineItems.map((item) => ({
        tier_id: item.tier.id,
        tier_name: item.tier.name,
        quantity: item.quantity,
        unit_price_kobo: item.unitPriceKobo,
        holder_names: item.holderNames,
      })),
      proof_attempts_detail: proofs.map((proof) => ({
        attempt_no: proof.attemptNo,
        client_submission_id: proof.clientSubmissionId,
        file_sha256: proof.fileSha256,
        mime_type: proof.mimeType,
        size_bytes: proof.sizeBytes,
        transfer_reference: proof.transferReference,
        sender_name: proof.senderName,
        status: proof.status,
        reject_reason_code: proof.rejectReasonCode,
        reject_message: proof.rejectMessage,
        reject_final: proof.rejectFinal,
        flags: proof.flags,
        reviewed_at: proof.reviewedAt?.toISOString() ?? null,
        submitted_at: proof.createdAt.toISOString(),
        image_url: proof.image_url,
      })),
      tickets: order.ticketUnits.map((unit) => ({
        ticket_id: unit.id,
        tier_name: unit.tier.name,
        holder_name: unit.holderName,
        check_in_status: unit.checkInStatus,
        checked_in_at: unit.checkedInAt?.toISOString() ?? null,
        voided_at: unit.voidedAt?.toISOString() ?? null,
        sync_seq: String(unit.syncSeq),
      })),
    },
    { status: 200 }
  );
}
