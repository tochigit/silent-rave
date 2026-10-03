import type { NextRequest } from "next/server";
import { z } from "zod";
import webpush from "web-push";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { body, OperationError, reply } from "./http";

function safeEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      (url.hostname === "fcm.googleapis.com" ||
        url.hostname === "web.push.apple.com" ||
        url.hostname.endsWith(".push.services.mozilla.com") ||
        url.hostname.endsWith(".notify.windows.com"))
    );
  } catch {
    return false;
  }
}
export async function pushOperation(
  request: NextRequest,
  pathParts: string[],
  actorId: string,
) {
  const route = pathParts.join("/");
  if (request.method === "GET" && route === "push/status")
    return reply({
      active:
        (await db.pushSubscription.count({
          where: { staffUserId: actorId, isActive: true },
        })) > 0,
      configured: !!(
        process.env.VAPID_PUBLIC_KEY &&
        process.env.VAPID_PRIVATE_KEY &&
        process.env.VAPID_SUBJECT
      ),
      public_key: process.env.VAPID_PUBLIC_KEY ?? null,
    });
  if (route !== "push/subscribe")
    throw new OperationError(404, "Route not found.");
  if (request.method === "DELETE") {
    const input = await body(
      request,
      z.object({ endpoint: z.url().max(2000) }).strict(),
    );
    await db.pushSubscription.updateMany({
      where: { endpoint: input.endpoint, staffUserId: actorId },
      data: { isActive: false },
    });
    return reply({ ok: true });
  }
  if (request.method !== "POST")
    throw new OperationError(404, "Route not found.");
  const input = await body(
    request,
    z
      .object({
        endpoint: z.url().max(2000),
        keys: z
          .object({
            p256dh: z.string().regex(/^[\w-]{87}$/),
            auth: z.string().regex(/^[\w-]{22}$/),
          })
          .strict(),
      })
      .strict(),
  );
  if (!safeEndpoint(input.endpoint))
    throw new OperationError(400, "Unsupported push service endpoint.");
  const existing = await db.pushSubscription.findUnique({
    where: { endpoint: input.endpoint },
    select: { staffUserId: true },
  });
  if (existing && existing.staffUserId !== actorId)
    throw new OperationError(
      409,
      "Subscription already belongs to another account.",
    );
  await db.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    update: {
      isActive: true,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
    },
    create: {
      staffUserId: actorId,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: request.headers.get("user-agent")?.slice(0, 300),
    },
  });
  return reply({ ok: true });
}
/** Best effort after proof commit. Notifications carry code and relative link only.
 * Polling remains mandatory: pushes are never a durable payment review queue. */
export async function dispatchOwnerPush(orderCode: string) {
  try {
    const order = await db.order.findUnique({
      where: { orderCode },
      select: { id: true, orderCode: true },
    });
    if (!order) return;
    const payload = {
      title: "Payment proof received",
      order_code: order.orderCode,
      url: `/admin/orders/${order.id}`,
    };
    const subs = await db.pushSubscription.findMany({
      where: { isActive: true, staff: { role: "OWNER", isActive: true } },
      take: 20,
    });
    for (const sub of subs) {
      if (!safeEndpoint(sub.endpoint)) continue;
      try {
        if (process.env.PUSH_ADAPTER === "capture") {
          if (
            process.env.SILENT_RAVE_ISOLATED_FIXTURE !== "1" ||
            !process.env.PUSH_CAPTURE_DIR
          )
            throw new Error("Unsafe capture configuration");
          await mkdir(process.env.PUSH_CAPTURE_DIR, { recursive: true });
          await appendFile(
            path.join(process.env.PUSH_CAPTURE_DIR, "push.jsonl"),
            JSON.stringify({ subscription_id: sub.id, payload }) + "\n",
          );
        } else {
          if (
            !process.env.VAPID_PUBLIC_KEY ||
            !process.env.VAPID_PRIVATE_KEY ||
            !process.env.VAPID_SUBJECT
          )
            return;
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            JSON.stringify(payload),
            {
              vapidDetails: {
                subject: process.env.VAPID_SUBJECT,
                publicKey: process.env.VAPID_PUBLIC_KEY,
                privateKey: process.env.VAPID_PRIVATE_KEY,
              },
              TTL: 300,
              timeout: 5000,
            },
          );
        }
        await db.pushSubscription.update({
          where: { id: sub.id },
          data: { lastSuccessAt: new Date() },
        });
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410)
          await db.pushSubscription.update({
            where: { id: sub.id },
            data: { isActive: false },
          });
      }
    }
  } catch {
    /* never undo a proof commit; polling catches every pending proof */
  }
}
