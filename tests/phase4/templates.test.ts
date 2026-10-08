import { test, expect } from "bun:test";
import { db } from "../fixture-db";
import { buildEmailPayload } from "@/lib/email/templates";
import { verifyStatusToken } from "@/lib/orders/status-token";
import { approvedOrder } from "./fixtures";
test("all React Email kinds render HTML/text, valid status links, no bank details/buyer subjects", async () => {
  const f = await approvedOrder();
  const hostile = '<script>alert("x")</script>\r\nBcc: attacker@test.ng';
  await db.ticketUnit.updateMany({ where: { orderId: f.order.id }, data: { holderName: hostile } });
  for (const kind of ["PROOF_RECEIVED", "TICKETS", "REJECTED", "STATUS_LINK"] as const) {
    const job = await db.emailJob.create({ data: { orderId: f.order.id, kind, dedupeKey: crypto.randomUUID(), recipientEmail: "evil@example.test", context: { reason: hostile, resubmittable: true } } });
    const email = await buildEmailPayload(job);
    expect(email.html).toContain("<html"); expect(email.text).toContain("View order status:");
    expect(email.html).not.toContain("<script>"); expect(email.text).not.toContain("<script>"); expect(email.text).not.toContain("\r");
    expect(email.subject).not.toContain("alert"); expect(email.subject).not.toContain("attacker");
    const link = new URL(email.text.split("View order status: ")[1]);
    expect(link.origin).toBe(process.env.PUBLIC_BASE_URL!); expect(link.pathname).toBe(`/order/${f.order.orderCode}`);
    expect(verifyStatusToken(f.order.id, f.order.statusTokenVersion, link.searchParams.get("t")!)).toBe(true);
    const account = await db.paymentAccount.findFirstOrThrow();
    for (const field of [account.accountNumber, account.bankName, account.accountName]) expect(email.html + email.text).not.toContain(field);
    if (kind === "TICKETS") {
      expect(email.attachments.map(a => a.filename)).toEqual([1, 2].map(n => `SilentRave-${f.order.orderCode}-${n}.pdf`));
      expect(email.html).toContain("Regular x 2"); expect(email.text).toContain("04 October 2030 at 00:30");
      for (const a of email.attachments) expect(Buffer.from(a.content, "base64").subarray(0, 4).toString()).toBe("%PDF");
      expect(email.html).toContain("&lt;script&gt;"); expect(email.text).toContain("&lt;script&gt;");
    } else expect(email.attachments).toHaveLength(0);
    if (kind === "STATUS_LINK") { expect(email.text).not.toContain(f.order.orderCode + "\n"); expect(email.text).not.toContain(f.event.title); }
    if (kind === "REJECTED") expect(email.text).toContain("may re-upload");
  }
});
