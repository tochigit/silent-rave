import { randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  TX_OPTIONS,
  ORDER_CODE_ALPHABET,
  ORDER_CODE_LENGTH,
  ORDER_CODE_PREFIX,
} from "@/lib/constants";
import { signTicketToken } from "@/lib/tickets/qr";
import { writeAudit } from "@/lib/audit";
import { OperationError, text, uuid } from "./http";

export const issueSchema = z
  .object({
    client_request_id: uuid,
    event_id: uuid,
    source: z.enum(["CASH", "COMP"]),
    reason: text,
    customer_name: text,
    customer_email: z.email().max(254),
    customer_phone: z.string().trim().max(30).optional(),
    line_items: z
      .array(
        z
          .object({
            tier_id: uuid,
            quantity: z.number().int().min(1).max(10),
            holder_names: z.array(text).max(10).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(10),
  })
  .strict();
export async function issueOrder(
  input: z.infer<typeof issueSchema>,
  actorId: string,
) {
  if (
    new Set(input.line_items.map((l) => l.tier_id)).size !==
      input.line_items.length ||
    input.line_items.reduce((s, l) => s + l.quantity, 0) > 10 ||
    input.line_items.some(
      (l) => l.holder_names && l.holder_names.length !== l.quantity,
    )
  )
    throw new OperationError(
      400,
      "Use distinct tiers, up to ten tickets, and one holder name per ticket if supplied.",
    );
  const fingerprint = JSON.stringify(input);
  const order = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(3, hashtext(${input.client_request_id}))`;
    const prior = await tx.auditLogEntry.findFirst({
      where: {
        actorId,
        action: { in: ["ORDER_ISSUED_CASH", "ORDER_ISSUED_COMP"] },
        metadata: {
          path: ["client_request_id"],
          equals: input.client_request_id,
        },
      },
    });
    if (prior) {
      const meta = prior.metadata as Record<string, unknown>;
      if (meta.request_fingerprint !== fingerprint)
        throw new OperationError(
          409,
          "Request identifier reused with changed details.",
        );
      return tx.order.findUniqueOrThrow({
        where: { id: prior.entityId! },
        select: { id: true, orderCode: true, totalKobo: true },
      });
    }
    const event = await tx.event.findUnique({ where: { id: input.event_id } });
    if (
      !event ||
      event.status !== "PUBLISHED" ||
      !event.isDateConfirmed ||
      event.endsAt <= new Date()
    )
      throw new OperationError(
        409,
        "Only a confirmed, published, not-ended event can issue tickets.",
      );
    const lines: {
      tier_id: string;
      quantity: number;
      holder_names?: string[];
      price: number;
    }[] = [];
    let total = 0;
    for (const line of [...input.line_items].sort((a, b) =>
      a.tier_id.localeCompare(b.tier_id),
    )) {
      const rows = await tx.$queryRaw<{ id: string; price_kobo: number }[]>`
        UPDATE ticket_tiers SET sold = sold + ${line.quantity}
        WHERE id = ${line.tier_id}::uuid AND event_id = ${input.event_id}::uuid
          AND capacity - sold - reserved >= ${line.quantity} RETURNING id, price_kobo`;
      if (!rows[0])
        throw new OperationError(
          409,
          "Capacity unavailable. Nothing has been issued.",
        );
      const price = input.source === "COMP" ? 0 : rows[0].price_kobo;
      total += price * line.quantity;
      lines.push({ ...line, price });
    }
    if (!Number.isSafeInteger(total) || total > 2147483647)
      throw new OperationError(400, "Order total is too large.");
    let code = ORDER_CODE_PREFIX;
    for (let i = 0; i < ORDER_CODE_LENGTH; i++)
      code += ORDER_CODE_ALPHABET[randomInt(ORDER_CODE_ALPHABET.length)];
    const created = await tx.order.create({
      data: {
        orderCode: code,
        eventId: input.event_id,
        customerName: input.customer_name,
        customerEmail: input.customer_email.toLowerCase(),
        customerPhone: input.customer_phone || null,
        totalKobo: total,
        status: "APPROVED",
        source: input.source,
        approvedAt: new Date(),
        approvedBy: actorId,
        inventoryReleased: true,
        lineItems: {
          create: lines.map((l) => ({
            tierId: l.tier_id,
            quantity: l.quantity,
            unitPriceKobo: l.price,
            holderNames: l.holder_names,
          })),
        },
      },
      select: { id: true, orderCode: true, totalKobo: true },
    });
    for (const l of lines)
      for (let n = 0; n < l.quantity; n++) {
        const id = randomUUID();
        const token = signTicketToken(id, input.event_id);
        await tx.$executeRaw`INSERT INTO ticket_units (id, order_id, event_id, tier_id, holder_name, qr_token)
        VALUES (${id}::uuid, ${created.id}::uuid, ${input.event_id}::uuid, ${l.tier_id}::uuid, ${l.holder_names?.[n] ?? null}, ${token})`;
      }
    await tx.emailJob.create({
      data: {
        orderId: created.id,
        kind: "TICKETS",
        recipientEmail: input.customer_email.toLowerCase(),
      },
    });
    await writeAudit(tx, {
      actorId,
      action: `ORDER_ISSUED_${input.source}`,
      entityType: "order",
      entityId: created.id,
      metadata: {
        source: input.source,
        reason: input.reason,
        client_request_id: input.client_request_id,
        request_fingerprint: fingerprint,
      },
    });
    return created;
  }, TX_OPTIONS);
  return {
    order_id: order.id,
    order_code: order.orderCode,
    total_kobo: order.totalKobo,
  };
}
