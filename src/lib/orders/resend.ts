import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { TX_OPTIONS } from "@/lib/constants";
import { writeAudit } from "@/lib/audit";
import { OrderServiceError } from "./errors";
export async function resendTickets(orderId: string, actorId: string) {
  return db.$transaction(async tx => {
    const orders = await tx.$queryRaw<{ status: string; customer_email: string }[]>(Prisma.sql`SELECT status::text, customer_email FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`);
    if (!orders[0]) throw new OrderServiceError("NOT_FOUND", "Order not found.");
    if (orders[0].status !== "APPROVED") throw new OrderServiceError("INVALID_STATE", "Only approved orders can resend tickets.");
    // Order row lock serializes this count + insert on every app instance.
    const counts = await tx.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT count(*) FROM audit_log_entries WHERE action = 'TICKET_RESENT' AND entity_type = 'order' AND entity_id = ${orderId}::uuid AND created_at > now() - interval '1 hour'`);
    if (Number(counts[0].count) >= 5) throw new OrderServiceError("RATE_LIMITED", "Too many ticket resends for this order.");
    const job = await tx.emailJob.create({ data: { orderId, kind: "TICKETS", dedupeKey: `resend-${randomUUID()}`, recipientEmail: orders[0].customer_email } });
    await writeAudit(tx, { actorId, action: "TICKET_RESENT", entityType: "order", entityId: orderId, metadata: { job_id: job.id } });
    return { ok: true, job_id: job.id };
  }, TX_OPTIONS);
}
