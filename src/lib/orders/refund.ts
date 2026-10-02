import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { TX_OPTIONS } from "@/lib/constants";
import { writeAudit } from "@/lib/audit";
import { OrderServiceError } from "./errors";

export async function refundOrder(orderId: string, actorId: string, input: { restock: boolean; acknowledge_checked_in: boolean; note?: string }) {
  return db.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status::text FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`);
    if (!rows[0]) throw new OrderServiceError("NOT_FOUND", "Order not found.");
    if (rows[0].status === "REFUNDED") return { ok: true, idempotent: true, status: "REFUNDED" };
    if (rows[0].status !== "APPROVED") throw new OrderServiceError("INVALID_STATE", "Only approved orders can be refunded.");
    // Serialize with a ticket's conditional check-in update, too.
    const tickets = await tx.$queryRaw<{ check_in_status: string }[]>(Prisma.sql`SELECT check_in_status::text FROM ticket_units WHERE order_id = ${orderId}::uuid ORDER BY id FOR UPDATE`);
    if (tickets.some(t => t.check_in_status === "CHECKED_IN") && !input.acknowledge_checked_in) throw new OrderServiceError("CHECKED_IN_TICKETS", "A checked-in ticket requires acknowledgement.");
    if (input.restock) {
      const lines = await tx.$queryRaw<{ tier_id: string; quantity: bigint }[]>(Prisma.sql`SELECT tier_id, SUM(quantity) AS quantity FROM order_line_items WHERE order_id = ${orderId}::uuid GROUP BY tier_id ORDER BY tier_id`);
      for (const line of lines) await tx.$executeRaw(Prisma.sql`UPDATE ticket_tiers SET sold = GREATEST(0, sold - ${Number(line.quantity)}) WHERE id = ${line.tier_id}::uuid`);
    }
    await tx.ticketUnit.updateMany({ where: { orderId }, data: { voidedAt: new Date() } });
    await tx.order.update({ where: { id: orderId }, data: { status: "REFUNDED" } });
    await writeAudit(tx, { actorId, action: "ORDER_REFUNDED", entityType: "order", entityId: orderId, metadata: { restock: input.restock, acknowledge_checked_in: input.acknowledge_checked_in, note: input.note ?? null } });
    return { ok: true, idempotent: false, status: "REFUNDED" };
  }, TX_OPTIONS);
}
