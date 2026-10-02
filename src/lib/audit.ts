import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

// ─────────────────────────────────────────────────────────────────────────────
// Audit-log writer (audit_log_entries is append-only by design — no update or
// delete path exists anywhere for this table).
//
// actor_id / entity_type / entity_id are NULLABLE — SYSTEM events have no
// human actor and pass actorId: null (e.g. PROOF_DUPLICATE_REFERENCE_ATTEMPT,
// 06's own example of a system event).
//
// Action vocabulary used by the manual-payment phase (04/06):
//   ORDER_APPROVED / ORDER_REJECTED / ORDER_REVIVED — payment review decisions
//   BANK_ACCOUNT_CHANGED                            — payment account mutations
//   PROOF_DUPLICATE_REFERENCE_ATTEMPT               — transfer-reference collision
//                                                    (system actor, null actor_id)
// ─────────────────────────────────────────────────────────────────────────────

export type AuditClient = Prisma.TransactionClient | typeof db;

export type AuditEntry = {
  /** null/undefined for system events (A1). */
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
};

/** Metadata values must never carry secrets or PII beyond what ops needs. */
export async function writeAudit(client: AuditClient, entry: AuditEntry): Promise<void> {
  await client.auditLogEntry.create({
    data: {
      actorId: entry.actorId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
