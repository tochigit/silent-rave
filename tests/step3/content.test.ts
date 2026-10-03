import "../phase3b/load-env";
import { test, expect } from "bun:test";
import { db } from "@/lib/db";
import { api } from "../phase3b/helpers";
import { deliverContact } from "@/lib/content/contact";
import type { EmailPayload } from "@/lib/email/transport";
test("public content reflects database edits, publication and exact allowlist", async () => {
  const before = await db.sitePage.findUniqueOrThrow({
    where: { slug: "about" },
  });
  try {
    await db.sitePage.update({
      where: { slug: "about" },
      data: { title: "Owner edited title", body: "Owner supplied body" },
    });
    const r = await api("/api/pages/about");
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(Object.keys(body).sort()).toEqual([
      "body",
      "slug",
      "title",
      "updated_at",
    ]);
    expect(body.title).toBe("Owner edited title");
    await db.sitePage.update({
      where: { slug: "about" },
      data: { isPublished: false },
    });
    expect((await api("/api/pages/about")).status).toBe(404);
    expect((await api("/api/pages/private")).status).toBe(404);
  } finally {
    await db.sitePage.update({
      where: { slug: "about" },
      data: {
        title: before.title,
        body: before.body,
        isPublished: before.isPublished,
      },
    });
  }
});
test("contact resolves organizer recipient, escapes input, fixed subject, separate transport without order jobs", async () => {
  const page = await db.sitePage.findUniqueOrThrow({
    where: { slug: "contact" },
    include: { contactOrganizer: true },
  });
  const jobs = await db.emailJob.count();
  let captured: EmailPayload | undefined;
  expect(
    await deliverContact(
      {
        name: "<script>buyer</script>",
        email: "fake@example.test",
        message: "<b>Fixture enquiry only</b>",
      },
      {
        send: async (_id, payload) => {
          captured = payload;
          return { ok: true, messageId: "fake" };
        },
      },
    ),
  ).toBe(true);
  expect(captured!.to).toEqual([page.contactOrganizer!.contactEmail!]);
  expect(captured!.html).not.toContain("<script>");
  expect(captured!.html).toContain("&lt;script&gt;");
  expect(captured!.subject).toBe("Silent Rave contact enquiry");
  expect(captured!.attachments).toEqual([]);
  expect(await db.emailJob.count()).toBe(jobs);
});
test("contact HTTP capture, strict validation/body cap and rate limit", async () => {
  const input = {
    name: "Fixture Contact",
    email: "fake@example.test",
    message: "Disposable contact enquiry.",
  };
  expect(
    (await api("/api/contact", { ip: "10.93.0.1", body: input })).status,
  ).toBe(202);
  for (const body of [
    { ...input, to: "attacker@example.test" },
    { ...input, email: "bad" },
    { ...input, message: "short" },
  ])
    expect(
      (await api("/api/contact", { ip: crypto.randomUUID(), body })).status,
    ).toBe(400);
  expect(
    (
      await api("/api/contact", {
        ip: "10.93.0.2",
        body: { ...input, message: "x".repeat(17000) },
      })
    ).status,
  ).toBe(413);
  for (let i = 0; i < 5; i++)
    expect(
      (await api("/api/contact", { ip: "10.93.0.3", body: {} })).status,
    ).toBe(400);
  const limited = await api("/api/contact", { ip: "10.93.0.3", body: input });
  expect(limited.status).toBe(429);
  expect(limited.headers.get("retry-after")).toBeTruthy();
});
test("missing organizer/contact configuration fails closed; fake provider failure is not a success", async () => {
  const page = await db.sitePage.findUniqueOrThrow({
    where: { slug: "contact" },
  });
  try {
    expect(
      await deliverContact(
        {
          name: "Fake",
          email: "fake@example.test",
          message: "Fixture failure test",
        },
        {
          send: async () => ({
            ok: false,
            transient: true,
            code: "NETWORK_ERROR",
          }),
        },
      ),
    ).toBe(false);
    await db.sitePage.update({
      where: { slug: "contact" },
      data: { contactOrganizerId: null },
    });
    expect(
      (
        await api("/api/contact", {
          ip: "10.93.0.4",
          body: {
            name: "Fake",
            email: "fake@example.test",
            message: "Fixture failure test",
          },
        })
      ).status,
    ).toBe(503);
  } finally {
    await db.sitePage.update({
      where: { slug: "contact" },
      data: { contactOrganizerId: page.contactOrganizerId },
    });
  }
});
