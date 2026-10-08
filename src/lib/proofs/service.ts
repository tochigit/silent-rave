import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { storeNewImage, storageLinked, storageFailed } from "@/lib/storage/accounting";
import { sanitizeImage } from "@/lib/uploads/sanitize";
import { emitServerEvent } from "@/lib/events/emitter";
import { verifyStatusToken } from "@/lib/orders/status-token";
import {
  HOLD_CAP_MS,
  LATE_PROOF_GRACE_MS,
  MAX_PROOF_FILE_BYTES,
  MAX_PROOF_SUBMISSIONS,
  PROOF_IMAGE_MAX_DIMENSION,
  PROOF_IMAGE_MIN_DIMENSION,
  TX_OPTIONS,
} from "@/lib/constants";
import { OrderServiceError } from "@/lib/orders/errors";

// ─────────────────────────────────────────────────────────────────────────────
// Proof submission — "I have paid" (04-manual-payment.md "Proof submission
// contract" + "Late proofs").
//
// Server-side handling, in order:
//   1. Order exists AND status_token verifies. Close-out fix A3: an unknown
//      code, a WRONG token and a MISSING token are INDISTINGUISHABLE — one
//      uniform NOT_FOUND ("Order not found.") for all three, mirroring the
//      status route's no-oracle 404. The token check still runs BEFORE any
//      file VALIDATION (magic bytes / re-encode) per the 04 ordering — only
//      the multipart parse and byte read happen earlier, which is what keeps
//      the three failure paths on comparable timing.
//      EITHER (a) status is
//      AWAITING_PAYMENT or NEEDS_RESUBMIT with the hold not expired, OR (b)
//      status is EXPIRED with NO proof yet and now() <= hold_expires_at +
//      LATE_PROOF_GRACE (a late proof); attempts not exhausted (else 403).
//   2. File validated by MAGIC BYTES (not client MIME): JPEG/PNG/WebP only
//      (HEIC must be converted client-side); ≤ 3 MiB; sane dimensions; then
//      RE-ENCODED server-side (strips EXIF/GPS and any embedded payload —
//      sharp, a maintained native image library). file_sha256 is of the
//      ORIGINAL upload.
//   3. transfer_reference normalised (trim, uppercase, no spaces); uniqueness
//      among PENDING/APPROVED proofs enforced by the partial unique index —
//      collision → 409 + system audit PROOF_DUPLICATE_REFERENCE_ATTEMPT.
//   4. Duplicate image (same sha256 on a DIFFERENT order) → FLAGGED, not
//      blocked: flags.duplicate_image_of = <proof id>.
//   5. Stored in PRIVATE storage (never public, never guessable).
//   6. ONE transaction: insert payment_proofs, flip order to
//      PROOF_SUBMITTED, set hold_expires_at = first_proof_at + HOLD_CAP (set
//      ONCE, never extended), proof_attempts += 1 on EVERY submission, queue
//      PROOF_RECEIVED email job (first submission only). Late path: proof
//      PENDING with flags.late, first_proof_at + proof_attempts = 1, order
//      STAYS EXPIRED, inventory untouched, hold_expires_at unchanged.
//
// Idempotency: client_submission_id + order_id — a flaky-network retry returns
// the existing attempt and creates no second row. The unique index is the
// backstop; concurrent duplicates are caught and converted to a replay.
// ─────────────────────────────────────────────────────────────────────────────

export type SubmitProofInput = {
  orderCode: string;
  statusToken: string;
  transferReference: string;
  senderName: string;
  clientSubmissionId: string;
  /** Original upload bytes (pre-re-encode) — file_sha256 is computed over these. */
  fileBytes: Buffer;
};

export type SubmitProofResult = {
  /** Order status AFTER the submission (EXPIRED stays EXPIRED for late proofs). */
  status: string;
  attemptNo: number;
  late: boolean;
  /** true when an existing client_submission_id was returned as a no-op. */
  idempotentReplay: boolean;
};

// ── magic-byte sniffing + dimension parsing (no client MIME ever trusted) ────

export type SniffedImageType = "image/jpeg" | "image/png" | "image/webp";

export function sniffImageType(bytes: Buffer): SniffedImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** JPEG width/height from the first SOF marker (C0–CF except C4/C8/CC). */
function jpegDimensions(bytes: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset++;
      continue;
    }
    // standalone markers without a length payload
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd8 || marker === 0xd9 || marker === 0xda) return null; // hit SOS/EOI without SOF
    const length = bytes.readUInt16BE(offset + 2);
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const height = bytes.readUInt16BE(offset + 5);
      const width = bytes.readUInt16BE(offset + 7);
      return { width, height };
    }
    offset += 2 + length;
  }
  return null;
}

function pngDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  if (bytes.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function webpDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 30) return null;
  const chunk = bytes.toString("ascii", 12, 16);
  if (chunk === "VP8X") {
    // extended format: canvas size − 1, 3 bytes LE each, at payload offsets 4..9
    const width = 1 + (bytes[20 + 4] | (bytes[20 + 5] << 8) | (bytes[20 + 6] << 16));
    const height = 1 + (bytes[20 + 7] | (bytes[20 + 8] << 8) | (bytes[20 + 9] << 16));
    return { width, height };
  }
  if (chunk === "VP8L") {
    // lossless: signature byte, then 14+14 bits LE-packed
    if (bytes[20] !== 0x2f) return null;
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8 ") {
    // lossy: 3-byte frame tag, 3-byte sync code (9d 01 2a), then w/h LE
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

export function imageDimensions(
  bytes: Buffer,
  type: SniffedImageType
): { width: number; height: number } | null {
  switch (type) {
    case "image/jpeg":
      return jpegDimensions(bytes);
    case "image/png":
      return pngDimensions(bytes);
    case "image/webp":
      return webpDimensions(bytes);
  }
}

// ── normalization ────────────────────────────────────────────────────────────

/** trim → uppercase → strip ALL whitespace (02: "trim, uppercase, no spaces"). */
export function normalizeTransferReference(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

// ── submission ───────────────────────────────────────────────────────────────

export async function submitProof(input: SubmitProofInput): Promise<SubmitProofResult> {
  // 1. Order + derived status token — uniform NOT_FOUND for unknown code,
  //    wrong token and missing token alike (close-out fix A3: no oracle on
  //    order-code existence).
  const order = await db.order.findUnique({
    where: { orderCode: input.orderCode },
    select: {
      id: true,
      status: true,
      statusTokenVersion: true,
      holdExpiresAt: true,
      firstProofAt: true,
      proofAttempts: true,
      customerEmail: true,
    },
  });
  if (!order || !verifyStatusToken(order.id, order.statusTokenVersion, input.statusToken)) {
    throw new OrderServiceError("NOT_FOUND", "Order not found.");
  }

  // 2. Idempotency — same client_submission_id returns the existing attempt.
  const existing = await db.paymentProof.findUnique({
    where: {
      orderId_clientSubmissionId: {
        orderId: order.id,
        clientSubmissionId: input.clientSubmissionId,
      },
    },
    select: { attemptNo: true, flags: true },
  });
  if (existing) {
    const flags = (existing.flags ?? {}) as Record<string, unknown>;
    const current = await db.order.findUnique({
      where: { id: order.id },
      select: { status: true },
    });
    return {
      status: current?.status ?? order.status,
      attemptNo: existing.attemptNo,
      late: flags.late === true,
      idempotentReplay: true,
    };
  }

  // 3. Cheap state pre-check (fast-fail before the expensive file work; the
  //    authoritative state machine re-runs under the row lock below).
  precheckState(order.status, order.holdExpiresAt, order.firstProofAt, order.proofAttempts);

  // 4. File validation — magic bytes, size, dimensions.
  if (input.fileBytes.length === 0) {
    throw new OrderServiceError("BAD_FILE", "No file uploaded.");
  }
  if (input.fileBytes.length > MAX_PROOF_FILE_BYTES) {
    throw new OrderServiceError(
      "BAD_FILE",
      `Proof image must be at most ${MAX_PROOF_FILE_BYTES / (1024 * 1024)} MiB.`
    );
  }
  const sniffed = sniffImageType(input.fileBytes);
  if (!sniffed) {
    throw new OrderServiceError("BAD_FILE", "Proof must be a JPEG, PNG or WebP image.");
  }
  const dims = imageDimensions(input.fileBytes, sniffed);
  if (!dims) {
    throw new OrderServiceError("BAD_FILE", "Could not read image dimensions.");
  }
  for (const [label, value] of [
    ["width", dims.width],
    ["height", dims.height],
  ] as const) {
    if (
      !Number.isInteger(value) ||
      value < PROOF_IMAGE_MIN_DIMENSION ||
      value > PROOF_IMAGE_MAX_DIMENSION
    ) {
      throw new OrderServiceError(
        "BAD_FILE",
        `Image ${label} out of sane bounds (1–${PROOF_IMAGE_MAX_DIMENSION}px).`
      );
    }
  }

  // 5. Re-encode server-side — strips EXIF/GPS and any embedded payload
  //    (sharp keeps no metadata unless asked). Auto-orients first so the
  //    orientation EXIF is baked in before being dropped.
  let storedBytes: Buffer;
  try {
    storedBytes = await sanitizeImage(input.fileBytes, "proof");
  } catch {
    throw new OrderServiceError("BAD_FILE", "Image could not be decoded.");
  }

  const fileSha256 = createHash("sha256").update(input.fileBytes).digest("hex");
  const transferReference = normalizeTransferReference(input.transferReference);
  if (!transferReference || transferReference.length > 128) {
    throw new OrderServiceError("VALIDATION", "transfer_reference is required (≤128 chars).");
  }
  if (!input.senderName.trim() || input.senderName.trim().length > 200) {
    throw new OrderServiceError("VALIDATION", "sender_name is required (≤200 chars).");
  }
  if (!input.clientSubmissionId || input.clientSubmissionId.length > 128) {
    throw new OrderServiceError("VALIDATION", "client_submission_id is required (≤128 chars).");
  }

  // 6. Duplicate-image FLAG (not a block): same sha256 on a DIFFERENT order.
  const duplicateOf = await db.paymentProof.findFirst({
    where: { fileSha256, NOT: { orderId: order.id } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const flags: Record<string, unknown> = {};
  if (duplicateOf) flags.duplicate_image_of = duplicateOf.id;

  // 7. Store privately BEFORE the DB transaction. If the tx then fails, an
  //    orphaned private file remains — harmless (no row references it) and
  //    preferred to doing storage I/O inside the transaction.
  const storagePath = await storeNewImage(() => `proofs/${order.id}/${randomUUID()}.jpg`, storedBytes, "image/jpeg");

  // 8. The transaction — state machine under the order row lock.
  try {
    const result = await db.$transaction(
      async (tx): Promise<SubmitProofResult> => {
        const locked = await lockOrderForProof(tx, order.id);
        const replay = await tx.paymentProof.findFirst({ where: { orderId: order.id, clientSubmissionId: input.clientSubmissionId } });
        if (replay) return { status: locked.status, attemptNo: replay.attemptNo, late: Boolean((replay.flags as Record<string, unknown> | null)?.late), idempotentReplay: true };
        const now = new Date();

        // Lazy single-order expiry (mirrors expireHolds for THIS order): a
        // lapsed hold materializes as EXPIRED before we evaluate the paths,
        // so behavior never depends on sweep timing.
        if (
          ["AWAITING_PAYMENT", "NEEDS_RESUBMIT", "PROOF_SUBMITTED"].includes(locked.status) &&
          locked.hold_expires_at &&
          locked.hold_expires_at < now &&
          !locked.inventory_released
        ) {
          const lines = await tx.$queryRaw<{ tier_id: string; total_qty: bigint }[]>(Prisma.sql`
            SELECT tier_id, SUM(quantity) AS total_qty
            FROM order_line_items
            WHERE order_id = ${order.id}::uuid
            GROUP BY tier_id
            ORDER BY tier_id
          `);
          for (const line of lines) {
            await tx.$executeRaw(Prisma.sql`
              UPDATE ticket_tiers SET reserved = reserved - ${Number(line.total_qty)}
              WHERE id = ${line.tier_id}::uuid
            `);
          }
          await tx.order.update({
            where: { id: order.id },
            data: { status: "EXPIRED", inventoryReleased: true },
          });
          locked.status = "EXPIRED";
        }

        const lateFlags = { ...flags, late: true };

        if (locked.status === "AWAITING_PAYMENT" || locked.status === "NEEDS_RESUBMIT" || locked.status === "PROOF_SUBMITTED") {
          // ── NORMAL path ── attempts check FIRST (04 contract step 1:
          // "attempts are not exhausted … else 403") — an exhausted order
          // gets 403 regardless of whether it is AWAITING_PAYMENT,
          // NEEDS_RESUBMIT or already PROOF_SUBMITTED with a review pending.
          if (locked.proof_attempts >= MAX_PROOF_SUBMISSIONS) {
            throw new OrderServiceError(
              "ATTEMPTS_EXHAUSTED",
              `Proof submissions are exhausted (max ${MAX_PROOF_SUBMISSIONS}).`
            );
          }
          if (locked.status === "PROOF_SUBMITTED") {
            // Attempts remain but a proof is already under review — the only
            // valid re-upload transition is NEEDS_RESUBMIT → PROOF_SUBMITTED.
            throw new OrderServiceError(
              "INVALID_STATE",
              "A proof is already under review for this order."
            );
          }
          const isFirst = locked.first_proof_at === null;
          const attemptNo = locked.proof_attempts + 1;

          await insertProofRow(tx, {
            orderId: order.id,
            attemptNo,
            clientSubmissionId: input.clientSubmissionId,
            storagePath,
            fileSha256,
            mimeType: sniffed,
            sizeBytes: input.fileBytes.length,
            transferReference,
            senderName: input.senderName.trim(),
            flags,
          });

          // hold_expires_at = first_proof_at + HOLD_CAP, set ONCE (never
          // extended: only assigned when first_proof_at was null).
          await tx.order.update({
            where: { id: order.id },
            data: {
              status: "PROOF_SUBMITTED",
              firstProofAt: isFirst ? now : undefined,
              proofAttempts: { increment: 1 },
              holdExpiresAt: isFirst ? new Date(now.getTime() + HOLD_CAP_MS) : undefined,
            },
          });

          if (isFirst) {
            await tx.emailJob.create({
              data: {
                orderId: order.id,
                kind: "PROOF_RECEIVED",
                dedupeKey: "initial",
                recipientEmail: locked.customer_email,
              },
            });
          }

          return { status: "PROOF_SUBMITTED", attemptNo, late: false, idempotentReplay: false };
        }

        if (locked.status === "EXPIRED") {
          // ── LATE path (04 "Late proofs") ──
          if (locked.first_proof_at !== null) {
            // A proof already exists (a late proof, or the order expired while
            // PROOF_SUBMITTED / from NEEDS_RESUBMIT). Not revivable by upload.
            throw new OrderServiceError(
              "INVALID_STATE",
              "This order already has a proof under review — the owner will revive or dismiss it."
            );
          }
          const graceUntil = new Date(locked.hold_expires_at!.getTime() + LATE_PROOF_GRACE_MS);
          if (now > graceUntil) {
            throw new OrderServiceError(
              "HOLD_EXPIRED",
              "The payment window and the late-proof grace have both lapsed."
            );
          }

          await insertProofRow(tx, {
            orderId: order.id,
            attemptNo: 1,
            clientSubmissionId: input.clientSubmissionId,
            storagePath,
            fileSha256,
            mimeType: sniffed,
            sizeBytes: input.fileBytes.length,
            transferReference,
            senderName: input.senderName.trim(),
            flags: lateFlags,
          });

          // Order STAYS EXPIRED; inventory untouched; hold_expires_at unchanged.
          await tx.order.update({
            where: { id: order.id },
            data: { firstProofAt: now, proofAttempts: 1 },
          });

          await tx.emailJob.create({
            data: {
              orderId: order.id,
              kind: "PROOF_RECEIVED",
              dedupeKey: "initial",
              recipientEmail: locked.customer_email,
            },
          });

          return { status: "EXPIRED", attemptNo: 1, late: true, idempotentReplay: false };
        }

        throw new OrderServiceError(
          "INVALID_STATE",
          `Cannot submit a proof for an order in status ${locked.status}.`,
          { from: locked.status }
        );
      },
      TX_OPTIONS
    );

    // After commit: realtime event (IDs only, no PII).
    emitServerEvent("order.proof_submitted", order.id);
    return result;
  } catch (error) {
    await storageFailed(storagePath, error);
    // RLS can redact the key/constraint hint from a unique-violation DETAIL.
    // Resolve that conflict after rollback through the same restricted client.
    // The database index remains the authoritative concurrent write guard.
    let referenceCollision = false;
    if (isUniqueViolation(error)) {
      const replay = await db.paymentProof.findUnique({
        where: { orderId_clientSubmissionId: { orderId: order.id, clientSubmissionId: input.clientSubmissionId } },
        select: { id: true },
      });
      if (replay) return submitProof(input);
      referenceCollision = !!(await db.paymentProof.findFirst({
        where: { transferReference, status: { in: ["PENDING", "APPROVED"] } },
        select: { id: true },
      }));
    }
    // transfer_reference collision on the partial unique index → 409 + system
    // audit entry. Written AFTER the rollback, outside the transaction.
    // (Postgres 23505 messages name the COLUMN, not the partial index —
    // "Key (transfer_reference)=(…) already exists" — so we match on that.)
    if (referenceCollision || isUniqueViolationOn(error, "transfer_reference")) {
      await writeAudit(db, {
        actorId: null,
        action: "PROOF_DUPLICATE_REFERENCE_ATTEMPT",
        entityType: "payment_proof",
        entityId: order.id,
        metadata: { order_id: order.id, transfer_reference: transferReference },
      });
      throw new OrderServiceError(
        "DUPLICATE_REFERENCE",
        "This transfer reference is already used by a pending or approved proof."
      );
    }
    // Concurrent duplicate of OUR client_submission_id (or of the first
    // submission's PROOF_RECEIVED job) → idempotent replay: re-run, the row
    // now exists and step 2 returns it.
    if (
      isUniqueViolationOn(error, "client_submission_id") ||
      isUniqueViolationOn(error, "dedupe_key")
    ) {
      return submitProof(input);
    }
    throw error;
  }
}

// ── internals ────────────────────────────────────────────────────────────────

type LockedProofOrder = {
  status: string;
  hold_expires_at: Date | null;
  first_proof_at: Date | null;
  proof_attempts: number;
  inventory_released: boolean;
  customer_email: string;
};

async function lockOrderForProof(
  tx: Prisma.TransactionClient,
  orderId: string
): Promise<LockedProofOrder> {
  const rows = await tx.$queryRaw<LockedProofOrder[]>(Prisma.sql`
    SELECT status::text AS status, hold_expires_at, first_proof_at,
           proof_attempts, inventory_released, customer_email
    FROM orders WHERE id = ${orderId}::uuid
    FOR UPDATE
  `);
  const row = rows[0];
  if (!row) throw new OrderServiceError("NOT_FOUND", "Order not found.");
  return row;
}

/** Raw INSERT so violations of the partial unique indexes surface precisely. */
async function insertProofRow(
  tx: Prisma.TransactionClient,
  data: {
    orderId: string;
    attemptNo: number;
    clientSubmissionId: string;
    storagePath: string;
    fileSha256: string;
    mimeType: string;
    sizeBytes: number;
    transferReference: string;
    senderName: string;
    flags: Record<string, unknown>;
  }
): Promise<void> {
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO payment_proofs
      (order_id, attempt_no, client_submission_id, storage_path, file_sha256,
       mime_type, size_bytes, transfer_reference, sender_name, status, flags)
    VALUES
      (${data.orderId}::uuid, ${data.attemptNo}, ${data.clientSubmissionId}, ${data.storagePath},
       ${data.fileSha256}, ${data.mimeType}, ${data.sizeBytes}, ${data.transferReference},
       ${data.senderName}, 'PENDING', ${JSON.stringify(data.flags)}::jsonb)
  `);
  await storageLinked(tx, data.storagePath, "ORDER", data.orderId);
}

/**
 * Detects a Postgres unique violation naming a given COLUMN (P2010 raw path:
 * meta.message is Postgres's own text, e.g. "Key (transfer_reference)=(…)
 * already exists"; P2002 is the ORM path). Column hints are unambiguous
 * across the partial/composite indexes on payment_proofs and email_jobs.
 */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2002" || (error.code === "P2010" && error.meta?.code === "23505"));
}

function isUniqueViolationOn(error: unknown, columnHint: string): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const message = String(
      (error.meta as { message?: string } | undefined)?.message ?? error.message
    );
    if ((error.code === "P2010" || error.code === "P2002") && message.includes(columnHint)) {
      return true;
    }
  }
  return false;
}

/** Pre-tx fast-fail state check (authoritative check runs under the lock). */
function precheckState(
  status: string,
  holdExpiresAt: Date | null,
  firstProofAt: Date | null,
  proofAttempts: number
): void {
  if (proofAttempts >= MAX_PROOF_SUBMISSIONS) {
    throw new OrderServiceError(
      "ATTEMPTS_EXHAUSTED",
      `Proof submissions are exhausted (max ${MAX_PROOF_SUBMISSIONS}).`
    );
  }
  if (status === "APPROVED" || status === "REJECTED" || status === "REFUNDED") {
    throw new OrderServiceError("INVALID_STATE", `Order is already ${status}.`, {
      from: status,
    });
  }
  if (status === "EXPIRED" && firstProofAt !== null) {
    throw new OrderServiceError("INVALID_STATE", "This order already has a proof under review.");
  }
  if (status === "EXPIRED" && holdExpiresAt) {
    const graceUntil = new Date(holdExpiresAt.getTime() + LATE_PROOF_GRACE_MS);
    if (new Date() > graceUntil) {
      throw new OrderServiceError(
        "HOLD_EXPIRED",
        "The payment window and the late-proof grace have both lapsed."
      );
    }
  }
}
