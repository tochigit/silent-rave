import "../phase3b/load-env";
import { test, expect } from "bun:test";
import { ResendTransport, CaptureTransport, retryAfter, type EmailPayload } from "@/lib/email/transport";
const payload: EmailPayload = { from: "a@example.test", reply_to: "b@example.test", to: ["c@example.test"], subject: "Fixed", html: "<p>test</p>", text: "test", attachments: [{ filename: "ticket.pdf", content: "cGRm" }], tags: [{ name: "job_id", value: "test" }] };
test("direct transport sends stable idempotency header, job tag, base64 attachments and timeout", async () => {
  const transport = new ResendTransport("fake", (async (url, options) => {
    expect(url).toBe("https://api.resend.com/emails");
    expect((options!.headers as Record<string, string>)["Idempotency-Key"]).toBe("job");
    expect(JSON.parse(options!.body as string)).toEqual(payload);
    expect(options!.signal).toBeInstanceOf(AbortSignal);
    return Response.json({ id: "message" });
  }) as unknown as typeof fetch);
  expect(await transport.send("job", payload)).toEqual({ ok: true, messageId: "message" });
});
test("transport classifies 500/422/429/quota/concurrent-key; errors never retain provider messages", async () => {
  for (const [status, name, transient, quota] of [[500, "application_error", true, false], [422, "validation_error", false, false], [429, "rate_limit_exceeded", true, false], [429, "daily_quota_exceeded", true, true], [409, "concurrent_idempotent_requests", true, false]] as const) {
    const t = new ResendTransport("fake", (async () => Response.json({ name, message: "buyer@test.ng https://evil/?t=secret" }, { status, headers: { "retry-after": "12" } })) as unknown as typeof fetch);
    expect(await t.send("job", payload)).toEqual({ ok: false, code: `HTTP_${status}`, transient, quota, retryAfterMs: 12_000 });
  }
  const t = new ResendTransport("fake", (async () => { throw new Error("token=secret"); }) as unknown as typeof fetch);
  expect(await t.send("job", payload)).toEqual({ ok: false, transient: true, code: "NETWORK_ERROR" });
});
test("Retry-After supports seconds/date and capture returns same id for same payload", async () => {
  expect(retryAfter("bad")).toBeUndefined();
  expect(retryAfter("Thu, 01 Jan 1970 00:00:12 GMT", 0)).toBe(12_000);
  const t = new CaptureTransport(); const id = crypto.randomUUID();
  expect(await t.send(id, payload)).toEqual(await t.send(id, payload));
  expect((await t.send(id, { ...payload, text: "different" })).ok).toBe(false);
});
