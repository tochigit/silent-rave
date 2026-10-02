import { NextResponse, type NextRequest } from "next/server";
import { Webhook } from "svix";
import { z } from "zod";
import { db } from "@/lib/db";
export const runtime = "nodejs";
export const WEBHOOK_BODY_LIMIT = 64 * 1024;
async function rawBody(request: NextRequest) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > WEBHOOK_BODY_LIMIT) throw new Error("TOO_LARGE");
  const reader = request.body?.getReader(); if (!reader) return "";
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength; if (size > WEBHOOK_BODY_LIMIT) { await reader.cancel(); throw new Error("TOO_LARGE"); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook unavailable." }, { status: 503 });
  let raw: string;
  try { raw = await rawBody(request); } catch { return NextResponse.json({ error: "Payload too large." }, { status: 413 }); }
  try {
    new Webhook(secret).verify(raw, { "svix-id": request.headers.get("svix-id") ?? "", "svix-timestamp": request.headers.get("svix-timestamp") ?? "", "svix-signature": request.headers.get("svix-signature") ?? "" });
  } catch { return NextResponse.json({ error: "Invalid signature." }, { status: 401 }); }
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid event." }, { status: 400 }); }
  const parsed = z.object({ type: z.string(), data: z.unknown().optional() }).safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid event." }, { status: 400 });
  if (!["email.delivered", "email.bounced"].includes(parsed.data.type)) return NextResponse.json({ ok: true });
  const data = z.object({ email_id: z.string().min(1).max(256), tags: z.union([z.record(z.string(), z.string()), z.array(z.object({ name: z.string(), value: z.string() }))]).optional() }).safeParse(parsed.data.data);
  if (!data.success) return NextResponse.json({ error: "Invalid event." }, { status: 400 });
  const { email_id: messageId, tags } = data.data;
  const tag = Array.isArray(tags) ? tags.find(t => t.name === "job_id")?.value : tags?.job_id;
  const byId = await db.emailJob.findFirst({ where: { resendMessageId: messageId }, select: { id: true } });
  const byTag = !byId && tag && z.uuid().safeParse(tag).success ? await db.emailJob.findFirst({ where: { id: tag, OR: [{ resendMessageId: null }, { resendMessageId: messageId }] }, select: { id: true } }) : null;
  const job = byId ?? byTag;
  if (!job) return NextResponse.json({ error: "Email job not found." }, { status: 404 });
  const status = parsed.data.type === "email.bounced" ? "BOUNCED" : "DELIVERED";
  await db.emailJob.updateMany({ where: { id: job.id, status: { notIn: status === "BOUNCED" ? ["BOUNCED"] : ["BOUNCED", "DELIVERED"] } }, data: { status, resendMessageId: messageId } });
  return NextResponse.json({ ok: true });
}
