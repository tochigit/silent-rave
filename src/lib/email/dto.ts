import type { Prisma } from "@prisma/client";
import { safeEmailError } from "./config";
export const emailJobSelect = { id: true, orderId: true, kind: true, status: true, attempts: true, lastError: true, nextAttemptAt: true, createdAt: true, updatedAt: true } satisfies Prisma.EmailJobSelect;
type Job = Prisma.EmailJobGetPayload<{ select: typeof emailJobSelect }>;
export function emailJobDto(job: Job) {
  return { id: job.id, order_id: job.orderId, kind: job.kind, status: job.status, attempts: job.attempts,
    last_error: job.lastError ? safeEmailError(job.lastError) : null,
    next_attempt_at: job.nextAttemptAt.toISOString(), created_at: job.createdAt.toISOString(), updated_at: job.updatedAt.toISOString() };
}
