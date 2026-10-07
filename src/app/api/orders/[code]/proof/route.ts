import { readTrustedContextNode } from "@/lib/hosting/request-context-node";
import { kickEmailJobs } from "@/lib/email/kick";
import { dispatchOwnerPush } from "@/lib/operations/push";
import { NextResponse, type NextRequest, after } from "next/server";
import { PROOF_IP_RATE_PER_HOUR, STATUS_TOKEN_HEADER } from "@/lib/constants";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { submitProof } from "@/lib/proofs/service";
import { OrderServiceError } from "@/lib/orders/errors";
import { imageMultipart, UploadError } from "@/lib/uploads/multipart";
import { StorageUnavailableError, StorageCollisionError } from "@/lib/storage";
import { privateHeaders } from "@/lib/auth/policy";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/orders/:code/proof — "I have paid" (03 v2.1; full contract in
// 04-manual-payment.md "Proof submission contract").
//
// MULTIPART fields: proof (image file), transfer_reference, sender_name,
// client_submission_id; the order's status_token is required via the
// x-status-token header OR ?t= query (03).
//
// Idempotent on client_submission_id. Responses: 200 { status, attempt_no,
// late? } — 200 (not 201) because retries and fresh submissions are
// indistinguishable by design. Errors: 409 duplicate live transfer_reference,
// 410 hold expired and outside the late-proof grace, 422 bad file, 403
// resubmissions exhausted.
//
// NO-ORACLE GUARANTEE (close-out fix A3): unknown order code, WRONG token and
// MISSING token return the IDENTICAL status code and body — the uniform 404
// {"error":"Order not found.","code":"NOT_FOUND"} the service emits — and all
// three travel the same code path (multipart parse → file read → order lookup
// → token verification), so response times are comparable. A prober cannot
// distinguish "code exists, token wrong" from "code does not exist".
//
// No Origin check: public route, no ambient cookie credential — the status
// token is a per-request bearer secret (06 scopes Origin checks to admin and
// staff routes). Per-IP rate limit below.
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  const ip = readTrustedContextNode(request).clientIp;
  const limited = consumeRateLimit("proof-submit-ip", ip, {
    limit: PROOF_IP_RATE_PER_HOUR,
    windowMs: 60 * 60 * 1000,
  });
  if (limited.limited) {
    return rateLimitResponse(limited.retryAfterSec, "Too many proof uploads from this network.");
  }

  let form: FormData;
  try {
    form = await imageMultipart(request, "proof", { transfer_reference: 128, sender_name: 200, client_submission_id: 128 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof UploadError ? error.message : "Could not parse the upload.", code: error instanceof UploadError ? error.code : "BAD_UPLOAD" }, { status: error instanceof UploadError ? error.status : 400, headers: privateHeaders });
  }

  // The status_token (header or ?t=) is resolved BEFORE the service call but
  // NOT rejected early: an empty token flows into submitProof, where the
  // uniform unknown-code / wrong-token / missing-token check runs — all three
  // cases share one code path and one response (see the header comment).
  const statusToken =
    request.headers.get(STATUS_TOKEN_HEADER) ?? request.nextUrl.searchParams.get("t") ?? "";

  const file = form.get("proof");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "proof (image file) is required." }, { status: 422 });
  }
  const transferReference = String(form.get("transfer_reference") ?? "");
  const senderName = String(form.get("sender_name") ?? "");
  const clientSubmissionId = String(form.get("client_submission_id") ?? "");

  let fileBytes: Buffer;
  try {
    fileBytes = Buffer.from(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "Could not read the uploaded file." }, { status: 422 });
  }

  try {
    const result = await submitProof({
      orderCode: code,
      statusToken,
      transferReference,
      senderName,
      clientSubmissionId,
      fileBytes,
    });
    after(kickEmailJobs);
    if (!result.idempotentReplay) after(() => dispatchOwnerPush(code));

    const body: Record<string, unknown> = {
      status: result.status,
      attempt_no: result.attemptNo,
    };
    if (result.late) body.late = true;
    if (result.idempotentReplay) body.idempotent_replay = true;
    return NextResponse.json(body, { status: 200 });
  } catch (error) {
    if (error instanceof StorageUnavailableError || error instanceof StorageCollisionError) {
      return NextResponse.json({ error: "Image storage is temporarily unavailable. Your fields are saved; retry with the same submission.", code: "STORAGE_UNAVAILABLE" }, { status: 503, headers: privateHeaders });
    }
    if (error instanceof OrderServiceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.httpStatus });
    }
    console.error("[orders/proof] unexpected error");
    return NextResponse.json({ error: "Proof submission failed unexpectedly." }, { status: 500 });
  }
}
