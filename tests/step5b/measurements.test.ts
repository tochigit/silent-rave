import "../phase3b/load-env";
import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { db } from "../fixture-db";
import { approvedOrder } from "../phase4/fixtures";
import { buildEmailPayload } from "@/lib/email/templates";
test("real ten-ticket payload and database size fit measured local bounds", async () => {
  const fixture = await approvedOrder(10);
  const job = await db.emailJob.findFirstOrThrow({
    where: { orderId: fixture.order.id, kind: "TICKETS" },
  });
  const started = performance.now();
  const payload = await buildEmailPayload(job);
  const preparationMs = Math.ceil(performance.now() - started);
  const attachmentBytes = payload.attachments.reduce(
    (n, a) => n + a.content.length,
    0,
  );
  const [size] = await db.$queryRaw<
    Array<{ bytes: bigint }>
  >`SELECT pg_database_size(current_database()) AS bytes`;
  expect(payload.attachments).toHaveLength(10);
  expect(payload.to).toHaveLength(1);
  expect(
    payload.attachments.every(
      (a) =>
        Buffer.from(a.content, "base64").subarray(0, 5).toString() === "%PDF-",
    ),
  ).toBe(true);
  expect(attachmentBytes).toBeLessThan(40 * 1024 * 1024);
  expect(preparationMs).toBeLessThan(30000);
  expect(Number(size.bytes)).toBeLessThan(300 * 1024 * 1024);
  await mkdir("reports", { recursive: true });
  await writeFile(
    `reports/step5b-${process.platform}-measurements.json`,
    JSON.stringify(
      {
        mode: "DISPOSABLE_LOCAL_FIXTURE",
        tickets: 10,
        recipients: 1,
        attachmentBase64Bytes: attachmentBytes,
        preparationMs,
        databaseBytes: Number(size.bytes),
        hostedPerformanceVerified: false,
        providerUsageVerified: false,
      },
      null,
      2,
    ),
  );
}, 60000);
