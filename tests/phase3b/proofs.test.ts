import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  api,
  backdateHold,
  check,
  checkEqual,
  createTestTier,
  getOrder,
  getTierState,
  initializeOrder,
  makeDb,
  makeJpeg,
  makeJpegWithExif,
  makePng,
  makeWebp,
  runSweep,
  submitProof,
} from "./helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Proof submission — file validation, storage, hold policy, late proofs
// (04-manual-payment.md "Proof submission contract" + "Late proofs" +
// "Hold policy"). IP buckets: this file uses 10.30.x.x.
// ─────────────────────────────────────────────────────────────────────────────

const db = makeDb();
let tier: { id: string; eventId: string; priceKobo: number; capacity: number };

beforeAll(async () => {
  tier = await createTestTier(db, "proofs-tier", 100);
});

afterAll(async () => {
  await db.$disconnect();
});

let orderCounter = 0;
async function freshOrder(suffix: string): Promise<{ orderCode: string; token: string; orderId: string }> {
  orderCounter += 1;
  const { status, body } = await initializeOrder({
    tierId: tier.id,
    email: `proofs-${suffix}@test.ng`,
    phone: `090${String(10000000 + Math.floor(Math.random() * 8999999))}`,
    ip: `10.30.0.${10 + orderCounter}`, // rotate per-IP rate buckets (10/h each)
  });
  checkEqual(status, 201, `fixture order for ${suffix}`);
  const order = await db.order.findUniqueOrThrow({ where: { orderCode: body!.order_code } });
  return { orderCode: body!.order_code, token: body!.status_token, orderId: order.id };
}

describe("proof — file validation (magic bytes, size, dimensions)", () => {
  test("non-image file → 422", async () => {
    const order = await freshOrder("nonimage");
    const result = await submitProof({
      orderCode: order.orderCode,
      statusToken: order.token,
      reference: `NONIMG${Date.now()}`,
      file: Buffer.from("this is definitely not an image, just text bytes"),
    });
    checkEqual(result.status, 422, "text upload rejected");
    checkEqual(result.body.code, "BAD_FILE", "error code");
  });

  test("disguised file (renamed .jpg but wrong magic bytes) → 422", async () => {
    const order = await freshOrder("disguised");
    const result = await submitProof({
      orderCode: order.orderCode,
      statusToken: order.token,
      reference: `DISG${Date.now()}`,
      file: Buffer.concat([
        Buffer.from("pretend-jpeg-header"),
        Buffer.alloc(2048, 0x41),
      ]),
      filename: "receipt.jpg",
      mimeType: "image/jpeg", // client MIME must NOT be trusted
    });
    checkEqual(result.status, 422, "magic-byte mismatch rejected despite .jpg name + MIME");
  });

  test("oversized (> 3 MiB) valid JPEG → 422", async () => {
    const order = await freshOrder("oversized");
    const smallJpeg = await makeJpeg(64, 64);
    const padded = Buffer.concat([smallJpeg, Buffer.alloc(3 * 1024 * 1024 + 1 - smallJpeg.length, 0x00)]);
    const result = await submitProof({
      orderCode: order.orderCode,
      statusToken: order.token,
      reference: `BIG${Date.now()}`,
      file: padded,
    });
    checkEqual(result.status, 422, "3 MiB+1 upload rejected");
    checkEqual(result.body.code, "BAD_FILE", "error code");
  });

  test("absurd pixel dimensions → 422", async () => {
    const order = await freshOrder("dims");
    const tallImage = await makeJpeg(10, 10001); // height over the sane bound
    const result = await submitProof({
      orderCode: order.orderCode,
      statusToken: order.token,
      reference: `DIMS${Date.now()}`,
      file: tallImage,
    });
    checkEqual(result.status, 422, "10,001px height rejected");
  });

  test("PNG and WebP accepted; stored re-encoded JPEG strips EXIF", async () => {
    const pngOrder = await freshOrder("png");
    const pngResult = await submitProof({
      orderCode: pngOrder.orderCode,
      statusToken: pngOrder.token,
      reference: `PNG${Date.now()}`,
      file: await makePng(),
    });
    checkEqual(pngResult.status, 200, "PNG accepted");
    const pngProof = await db.paymentProof.findFirstOrThrow({ where: { orderId: pngOrder.orderId } });
    checkEqual(pngProof.mimeType, "image/png", "mime detected from bytes");

    const webpOrder = await freshOrder("webp");
    const webpResult = await submitProof({
      orderCode: webpOrder.orderCode,
      statusToken: webpOrder.token,
      reference: `WEBP${Date.now()}`,
      file: await makeWebp(),
    });
    checkEqual(webpResult.status, 200, "WebP accepted");

    // EXIF strip: upload a JPEG carrying an EXIF Copyright marker; the stored
    // re-encode must not contain it.
    const exifOrder = await freshOrder("exif");
    const exifBytes = await makeJpegWithExif();
    check(exifBytes.includes(Buffer.from("SECRET-EXIF-PAYLOAD")), "sanity: source carries the EXIF marker");
    const exifResult = await submitProof({
      orderCode: exifOrder.orderCode,
      statusToken: exifOrder.token,
      reference: `EXIF${Date.now()}`,
      file: exifBytes,
    });
    checkEqual(exifResult.status, 200, "EXIF-bearing upload accepted");
    const proof = await db.paymentProof.findFirstOrThrow({ where: { orderId: exifOrder.orderId } });
    const { getStorage } = await import("@/lib/storage");
    const stored = await getStorage().getObject(proof.storagePath);
    check(stored !== null, "stored object readable");
    check(
      !Buffer.from(stored!.bytes).includes(Buffer.from("SECRET-EXIF-PAYLOAD")),
      "stored re-encode has stripped the EXIF payload"
    );
    // file_sha256 is of the ORIGINAL upload
    const { createHash } = await import("node:crypto");
    checkEqual(
      proof.fileSha256,
      createHash("sha256").update(exifBytes).digest("hex"),
      "file_sha256 = SHA-256 of the original upload"
    );
  });
});

describe("proof — transfer reference & duplicate handling", () => {
  test("duplicate LIVE transfer_reference → 409 + system audit PROOF_DUPLICATE_REFERENCE_ATTEMPT, no row", async () => {
    const orderA = await freshOrder("dupref-a");
    const orderB = await freshOrder("dupref-b");
    const sharedRef = `DUPREF${Date.now()}`;
    const first = await submitProof({
      orderCode: orderA.orderCode,
      statusToken: orderA.token,
      reference: sharedRef,
    });
    checkEqual(first.status, 200, "first use of the reference accepted");

    const second = await submitProof({
      orderCode: orderB.orderCode,
      statusToken: orderB.token,
      reference: ` ${sharedRef} `, // normalisation (trim) must still collide
      submissionId: "dup-ref-second",
    });
    checkEqual(second.status, 409, "duplicate live reference rejected");
    checkEqual(second.body.code, "DUPLICATE_REFERENCE", "error code");

    const proofsOnB = await db.paymentProof.count({ where: { orderId: orderB.orderId } });
    checkEqual(proofsOnB, 0, "no proof row created for the colliding submission");
    const audit = await db.auditLogEntry.findFirst({
      where: { action: "PROOF_DUPLICATE_REFERENCE_ATTEMPT", entityId: orderB.orderId },
      orderBy: { createdAt: "desc" },
    });
    check(audit !== null, "system audit entry written");
    checkEqual(audit!.actorId, null, "system event: actor_id IS NULL");
  });

  test("duplicate image (same sha256, different order) → FLAGGED, not blocked", async () => {
    const sameBytes = await makeJpeg(320, 200, "#112233");
    const orderA = await freshOrder("dupimg-a");
    const orderB = await freshOrder("dupimg-b");
    const first = await submitProof({
      orderCode: orderA.orderCode,
      statusToken: orderA.token,
      reference: `IMG1${Date.now()}`,
      file: sameBytes,
    });
    checkEqual(first.status, 200, "first upload fine");
    const second = await submitProof({
      orderCode: orderB.orderCode,
      statusToken: orderB.token,
      reference: `IMG2${Date.now()}`,
      file: sameBytes, // identical bytes, different order
    });
    checkEqual(second.status, 200, "duplicate image NOT blocked");
    const proofB = await db.paymentProof.findFirstOrThrow({ where: { orderId: orderB.orderId } });
    const flags = proofB.flags as Record<string, unknown>;
    check(typeof flags.duplicate_image_of === "string", "flags.duplicate_image_of set on the second order");
    const proofA = await db.paymentProof.findFirstOrThrow({ where: { orderId: orderA.orderId } });
    checkEqual(flags.duplicate_image_of, proofA.id, "flag points at the first order's proof id");
  });

  test("idempotent retry with the same client_submission_id creates no second attempt", async () => {
    const order = await freshOrder("idem");
    const submissionId = `idem-${Date.now()}`;
    const first = await submitProof({
      orderCode: order.orderCode,
      statusToken: order.token,
      reference: `IDEM${Date.now()}`,
      submissionId,
    });
    checkEqual(first.status, 200, "first submission ok");
    checkEqual(first.body.attempt_no, 1, "attempt 1");
    const retry = await submitProof({
      orderCode: order.orderCode,
      statusToken: order.token,
      reference: `IDEM${Date.now()}`, // even different fields: key is the id
      submissionId,
    });
    checkEqual(retry.status, 200, "retry returns 200");
    checkEqual(retry.body.attempt_no, 1, "same attempt returned");
    checkEqual(retry.body.idempotent_replay, true, "marked as replay");
    const proofCount = await db.paymentProof.count({ where: { orderId: order.orderId } });
    checkEqual(proofCount, 1, "still exactly one proof row");
    const stored = await getOrder(db, order.orderCode);
    checkEqual(stored.proofAttempts, 1, "proof_attempts still 1");
  });
});

describe("proof — hold policy (04 'Hold policy (locked)')", () => {
  test("no proof in 15 min → sweep sets EXPIRED + releases; second sweep is a no-op", async () => {
    const order = await freshOrder("expire");
    const before = await getTierState(db, tier.id);

    await backdateHold(db, order.orderCode, 60 * 1000); // hold lapsed 1 min ago
    const sweep1 = await runSweep();
    checkEqual(sweep1.status, 200, "sweep runs");
    check(sweep1.body.expired >= 1, "at least our order expired");

    const after = await getOrder(db, order.orderCode);
    checkEqual(after.status, "EXPIRED", "order EXPIRED");
    checkEqual(after.inventoryReleased, true, "inventory_released set");

    const mid = await getTierState(db, tier.id);
    checkEqual(mid.reserved, before.reserved - 1, "reserved decremented once");

    // Idempotency: run twice more — nothing changes.
    const sweep2 = await runSweep();
    const sweep3 = await runSweep();
    checkEqual(sweep2.body.expired, 0, "second sweep finds no candidates");
    checkEqual(sweep3.body.expired, 0, "third sweep finds no candidates");
    const finalTier = await getTierState(db, tier.id);
    checkEqual(finalTier.reserved, mid.reserved, "reserved decremented exactly once across sweeps");
  });

  test("proof submitted → hold becomes first_proof_at + 48h and does NOT move on resubmission", async () => {
    const order = await freshOrder("hold48");
    const first = await submitProof({
      orderCode: order.orderCode,
      statusToken: order.token,
      reference: `H48A${Date.now()}`,
    });
    checkEqual(first.status, 200, "first proof");
    const afterFirst = await getOrder(db, order.orderCode);
    check(afterFirst.firstProofAt !== null, "first_proof_at set");
    const expectedHold = afterFirst.firstProofAt!.getTime() + 48 * 60 * 60 * 1000;
    check(
      Math.abs(afterFirst.holdExpiresAt!.getTime() - expectedHold) < 5000,
      `hold = first_proof_at + 48h (got ${afterFirst.holdExpiresAt!.toISOString()})`
    );

    // Simulate owner rejecting resubmittably, then a resubmission: the hold
    // must stay anchored to the ORIGINAL first_proof_at.
    const ownerLogin = await (await import("./helpers")).login(
      process.env.OWNER_EMAIL ?? "owner@silentrave.ng",
      process.env.OWNER_PASSWORD ?? "silentrave-dev-owner"
    );
    const reject = await api(`/api/admin/orders/${order.orderId}/reject`, {
      host: "admin.localhost:3000",
      origin: "http://admin.localhost:3000",
      cookies: ownerLogin.cookies,
      body: { reason_code: "UNREADABLE", message: "Please re-upload a clearer receipt.", final: false },
    });
    checkEqual(reject.status, 200, "resubmittable rejection");

    // Backdate first_proof_at by 1h (hold follows it in the anchored past).
    await db.$executeRawUnsafe(
      `UPDATE orders SET first_proof_at = now() - interval '1 hour', hold_expires_at = first_proof_at + interval '48 hours' WHERE order_code = $1`,
      order.orderCode
    );
    const anchored = await getOrder(db, order.orderCode);

    const resubmit = await submitProof({
      orderCode: order.orderCode,
      statusToken: order.token,
      reference: `H48B${Date.now()}`,
    });
    checkEqual(resubmit.status, 200, "resubmission accepted");
    checkEqual(resubmit.body.attempt_no, 2, "attempt 2");
    const afterResubmit = await getOrder(db, order.orderCode);
    checkEqual(
      afterResubmit.holdExpiresAt!.toISOString(),
      anchored.holdExpiresAt!.toISOString(),
      "hold NOT extended by the resubmission"
    );
    checkEqual(afterResubmit.proofAttempts, 2, "proof_attempts counts every submission");
  });

  test("wrong/missing status token and unknown code on the proof route are INDISTINGUISHABLE (A3: uniform 404)", async () => {
    const order = await freshOrder("token");
    const { makeJpeg: mkJpeg } = await import("./helpers");
    const image = await mkJpeg();
    const noTokenForm = new FormData();
    noTokenForm.append("proof", new Blob([new Uint8Array(image)], { type: "image/jpeg" }), "r.jpg");
    noTokenForm.append("transfer_reference", `NT${Date.now()}`);
    noTokenForm.append("sender_name", "S");
    noTokenForm.append("client_submission_id", `nt-${Date.now()}`);
    const noToken = await api(`/api/orders/${order.orderCode}/proof`, {
      ip: "10.30.0.9",
      body: noTokenForm,
    });
    checkEqual(noToken.status, 404, "missing token → uniform 404");
    const noTokenText = await noToken.text();
    const badToken = await submitProof({
      orderCode: order.orderCode,
      statusToken: "totally-wrong-token",
      reference: `BADT${Date.now()}`,
    });
    checkEqual(badToken.status, 404, "wrong token → uniform 404");
    const unknown = await submitProof({
      orderCode: "SR-NOPE00",
      statusToken: "whatever",
      reference: `UNK${Date.now()}`,
    });
    checkEqual(unknown.status, 404, "unknown order code → uniform 404");
    const bodies = new Set([noTokenText, JSON.stringify(badToken.body), JSON.stringify(unknown.body)]);
    checkEqual(bodies.size, 1, `all three bodies byte-identical: ${[...bodies].join(" | ")}`);
    // No state leaked into the DB by any of the three probes.
    const attempts = await db.paymentProof.count({ where: { orderId: order.orderId } });
    checkEqual(attempts, 0, "no proof row created by any failed probe");
  });
});

describe("proof — LATE proofs (04 'Late proofs')", () => {
  test("within grace → recorded PENDING with flags.late, order STAYS EXPIRED, inventory untouched, in queue, revivable", async () => {
    const order = await freshOrder("late-ok");
    await backdateHold(db, order.orderCode, 60 * 1000); // expired 1 min ago
    const sweep = await runSweep();
    check(sweep.body.expired >= 1, "sweep expired it");
    const expired = await getOrder(db, order.orderCode);
    checkEqual(expired.status, "EXPIRED", "expired before the late proof");
    // Baseline AFTER the sweep (the sweep itself legitimately releases the
    // reservation — the late proof must touch nothing on top of that).
    const tierAfterSweep = await getTierState(db, tier.id);

    const late = await submitProof({
      orderCode: order.orderCode,
      statusToken: order.token,
      reference: `LATE${Date.now()}`,
      submissionId: `late-ok-${Date.now()}`,
    });
    checkEqual(late.status, 200, "late proof accepted within grace");
    checkEqual(late.body.late, true, "response says late: true");
    checkEqual(late.body.attempt_no, 1, "attempt 1");
    checkEqual(late.body.status, "EXPIRED", "order stays EXPIRED in the response");

    const after = await getOrder(db, order.orderCode);
    checkEqual(after.status, "EXPIRED", "order STAYS EXPIRED (04)");
    checkEqual(after.proofAttempts, 1, "proof_attempts = 1");
    checkEqual(after.inventoryReleased, true, "inventory still released (untouched)");
    checkEqual(after.holdExpiresAt!.toISOString(), expired.holdExpiresAt!.toISOString(), "hold_expires_at unchanged");
    const afterTier = await getTierState(db, tier.id);
    checkEqual(afterTier.reserved, tierAfterSweep.reserved, "inventory untouched by the late proof (vs post-sweep baseline)");

    const proof = await db.paymentProof.findFirstOrThrow({ where: { orderId: order.orderId } });
    checkEqual(proof.status, "PENDING", "late proof is PENDING");
    checkEqual((proof.flags as Record<string, unknown>).late, true, "flags.late = true");
    const proofReceivedJobs = await db.emailJob.count({
      where: { orderId: order.orderId, kind: "PROOF_RECEIVED", dedupeKey: "initial" },
    });
    checkEqual(proofReceivedJobs, 1, "PROOF_RECEIVED email job queued (late or not)");

    // Appears in the payment queue as EXPIRED_HAD_PROOF and is revivable.
    const owner = await (await import("./helpers")).login(
      process.env.OWNER_EMAIL ?? "owner@silentrave.ng",
      process.env.OWNER_PASSWORD ?? "silentrave-dev-owner"
    );
    const queue = await api("/api/admin/payments?status=EXPIRED_HAD_PROOF", {
      host: "localhost:3000",
      cookies: owner.cookies,
    });
    const queueBody = await queue.json();
    check(
      queueBody.queue.some((row: any) => row.order_code === order.orderCode),
      "late-proof order listed under EXPIRED_HAD_PROOF"
    );

    const approve = await api(`/api/admin/orders/${order.orderId}/approve`, {
      host: "admin.localhost:3000",
      origin: "http://admin.localhost:3000",
      cookies: owner.cookies,
      body: { confirmed_in_bank: true },
    });
    checkEqual(approve.status, 200, "revive & approve works");
    const approveBody = await approve.json();
    checkEqual(approveBody.revived, true, "approve reports the revive path");
    const revived = await getOrder(db, order.orderCode);
    checkEqual(revived.status, "APPROVED", "EXPIRED → APPROVED via revive");
    const tickets = await db.ticketUnit.count({ where: { orderId: order.orderId } });
    checkEqual(tickets, 1, "ticket minted after revive");
    const tierAfterRevive = await getTierState(db, tier.id);
    // revive: sold += 1 with reserved untouched (it was already released)
    checkEqual(tierAfterRevive.sold, afterTier.sold + 1, "revive increments sold by the line quantity");
    checkEqual(tierAfterRevive.reserved, afterTier.reserved, "revive leaves reserved untouched");
    const jobs = await db.emailJob.count({ where: { orderId: order.orderId, kind: "TICKETS" } });
    checkEqual(jobs, 1, "TICKETS email job after revive");
  });

  test("outside grace (hold_expires_at + 24h) → 410", async () => {
    const order = await freshOrder("late-gone");
    await backdateHold(db, order.orderCode, 25 * 60 * 60 * 1000); // 25h ago — grace is 24h
    const result = await submitProof({
      orderCode: order.orderCode,
      statusToken: order.token,
      reference: `GONE${Date.now()}`,
    });
    checkEqual(result.status, 410, "outside the grace window → 410");
    const proofs = await db.paymentProof.count({ where: { orderId: order.orderId } });
    checkEqual(proofs, 0, "no proof recorded");
  });

  test("a SECOND late proof is rejected", async () => {
    const order = await freshOrder("late-2nd");
    await backdateHold(db, order.orderCode, 60 * 1000);
    await runSweep();
    const first = await submitProof({
      orderCode: order.orderCode,
      statusToken: order.token,
      reference: `L2A${Date.now()}`,
      submissionId: `late2-first-${Date.now()}`,
    });
    checkEqual(first.status, 200, "first late proof accepted");
    const second = await submitProof({
      orderCode: order.orderCode,
      statusToken: order.token,
      reference: `L2B${Date.now()}`,
      submissionId: `late2-second-${Date.now()}`,
    });
    checkEqual(second.status, 409, "second late proof rejected");
    const proofs = await db.paymentProof.count({ where: { orderId: order.orderId } });
    checkEqual(proofs, 1, "still exactly one proof");
  });
});
