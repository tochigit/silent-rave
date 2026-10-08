import { Prisma, type EmailJob, type PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { db as defaultDb } from "@/lib/db";
import { TX_OPTIONS } from "@/lib/constants";
import { EMAIL, emailConfig, retryDelay, safeEmailError } from "./config";
import {
  getEmailTransport,
  type EmailTransport,
  type EmailPayload,
} from "./transport";
import { openPayload, sealPayload } from "./payload";
import {
  mailBudgets,
  providerQuotaPause,
  reserveMail,
  settleMail,
} from "./quota";

type Options = {
  client?: PrismaClient;
  transport?: EmailTransport;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  limit?: number;
  buildPayload?: (job: EmailJob) => Promise<EmailPayload>;
  afterAccepted?: () => Promise<void>; // fault injection, never exposed by HTTP
};

/** All locks live in short transactions. Provider/PDF/storage I/O is outside. */
export async function processEmailJobs(options: Options = {}) {
  const db = options.client ?? defaultDb;
  const config = emailConfig(); // fail before claiming anything
  mailBudgets();
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const transport = options.transport ?? getEmailTransport();
  const owner = randomUUID();
  const started = now();
  const result = { processed: 0, sent: 0, paused: false, busy: false };
  const acquired = await db.emailWorkerGate.updateMany({
    where: { id: "email", leaseUntil: { lte: new Date(now()) } },
    data: { owner, leaseUntil: new Date(now() + EMAIL.gateLeaseMs) },
  });
  if (!acquired.count) return { ...result, busy: true };
  const renew = async () =>
    (
      await db.emailWorkerGate.updateMany({
        where: { id: "email", owner, leaseUntil: { gt: new Date(now()) } },
        data: { leaseUntil: new Date(now() + EMAIL.gateLeaseMs) },
      })
    ).count === 1;
  try {
    for (
      let i = 0;
      i < Math.min(options.limit ?? EMAIL.batchSize, EMAIL.batchSize);
      i++
    ) {
      if (
        now() - started + EMAIL.timeoutMs >= EMAIL.runBudgetMs ||
        !(await renew())
      )
        break;
      const gate = await db.emailWorkerGate.findUniqueOrThrow({
        where: { id: "email" },
      });
      const wait = gate.nextSendAt.getTime() - now();
      if (wait > 0) {
        if (now() - started + wait + EMAIL.timeoutMs >= EMAIL.runBudgetMs) {
          result.paused = true;
          break;
        }
        await sleep(wait);
        if (!(await renew())) break;
      }
      const claimToken = randomUUID();
      const job = await db.$transaction(async (tx) => {
        const gateRows = await tx.$queryRaw<
          Array<{ owner: string | null }>
        >`SELECT owner FROM public.email_worker_gate WHERE id='email' FOR UPDATE`;
        if (gateRows[0]?.owner !== owner) return null;
        const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT id FROM email_jobs WHERE status = 'QUEUED' AND next_attempt_at <= ${new Date(now())}
          ORDER BY next_attempt_at, created_at, id FOR UPDATE SKIP LOCKED LIMIT 1
        `);
        if (!rows[0]) return null;
        const quota = await reserveMail(tx, rows[0].id);
        if (!quota.allowed) {
          await tx.emailJob.update({
            where: { id: rows[0].id },
            data: { nextAttemptAt: quota.retryAt, lastError: quota.reason },
          });
          await tx.emailWorkerGate.updateMany({
            where: { id: "email", owner },
            data: { nextSendAt: quota.retryAt, pauseReason: quota.reason },
          });
          result.paused = true;
          return null;
        }
        return tx.emailJob.update({
          where: { id: rows[0].id },
          data: {
            claimToken,
            attempts: { increment: 1 },
            nextAttemptAt: new Date(now() + EMAIL.leaseMs),
          },
        });
      }, TX_OPTIONS);
      if (!job) break;
      result.processed++;
      const owned = { id: job.id, claimToken, status: "QUEUED" as const };
      const fail = async (code: string) =>
        db.$transaction(async (tx) => {
          const updated = await tx.emailJob.updateMany({
            where: owned,
            data: {
              status: "FAILED",
              lastError: safeEmailError(code),
              claimToken: null,
            },
          });
          if (updated.count && !job.firstSendAt)
            await settleMail(tx, job.id, "REJECTED", true);
        }, TX_OPTIONS);
      if (job.attempts > EMAIL.maxAttempts) {
        await fail("MAX_ATTEMPTS");
        continue;
      }
      if (
        job.firstSendAt &&
        now() - job.firstSendAt.getTime() >= EMAIL.retentionMs
      ) {
        await fail("DELIVERY_UNCERTAIN");
        continue;
      }
      let payload: EmailPayload;
      let version: number;
      try {
        const order = await db.order.findUniqueOrThrow({
          where: { id: job.orderId },
        });
        if (job.kind === "TICKETS" && order.status !== "APPROVED") {
          await fail("ORDER_NOT_APPROVED");
          continue;
        }
        version = order.statusTokenVersion;
        if (job.encryptedPayload) {
          payload = openPayload(job.id, job.encryptedPayload);
          if (
            payload.to.length !== 1 ||
            payload.to[0] !== order.customerEmail
          ) {
            await fail("RECIPIENT_CHANGED");
            continue;
          }
          if (job.payloadTokenVersion !== version) {
            await fail("TOKEN_VERSION_CHANGED");
            continue;
          }
        } else {
          const builder =
            options.buildPayload ??
            (await import("./templates")).buildEmailPayload;
          payload = await builder(job);
          // Enforce recipient and tags centrally, even with a custom builder.
          payload.to = [order.customerEmail];
          payload.tags = [{ name: "job_id", value: job.id }];
        }
        if (
          payload.attachments.length > 10 ||
          payload.attachments.reduce((n, a) => n + a.content.length, 0) >
            40 * 1024 * 1024
        )
          throw new Error("PAYLOAD_ERROR");
      } catch {
        await fail("PAYLOAD_ERROR");
        continue;
      }
      // PDF/storage preparation may outlive a lease. A stale owner cannot send.
      if (
        now() - started + EMAIL.timeoutMs >= EMAIL.runBudgetMs ||
        !(await renew())
      )
        break;
      const ready = await db.emailJob.updateMany({
        where: { ...owned, nextAttemptAt: { gt: new Date(now()) } },
        data: {
          encryptedPayload:
            job.encryptedPayload ?? sealPayload(job.id, payload),
          payloadTokenVersion: version,
          firstSendAt: job.firstSendAt ?? new Date(now()),
          nextAttemptAt: new Date(now() + EMAIL.leaseMs),
        },
      });
      if (!ready.count) continue;
      // Last read immediately before provider call; no transaction held over I/O.
      const current = await db.order.findUniqueOrThrow({
        where: { id: job.orderId },
      });
      if (job.kind === "TICKETS" && current.status !== "APPROVED") {
        await fail("ORDER_NOT_APPROVED");
        continue;
      }
      if (current.customerEmail !== payload.to[0]) {
        await fail("RECIPIENT_CHANGED");
        continue;
      }
      if (current.statusTokenVersion !== version) {
        await fail("TOKEN_VERSION_CHANGED");
        continue;
      }
      // Final fence immediately before external I/O. A DB stall after payload
      // preparation must not let an expired owner send; renew both leases in
      // one short transaction and honour a webhook that already finished it.
      const canSend = await db.$transaction(async (tx) => {
        const gateOwned = await tx.emailWorkerGate.updateMany({
          where: { id: "email", owner, leaseUntil: { gt: new Date(now()) } },
          data: {
            leaseUntil: new Date(now() + EMAIL.gateLeaseMs),
            nextSendAt: new Date(now() + config.intervalMs),
            pauseReason: null,
          },
        });
        if (!gateOwned.count) return false;
        const jobOwned = await tx.emailJob.updateMany({
          where: { ...owned, nextAttemptAt: { gt: new Date(now()) } },
          data: { nextAttemptAt: new Date(now() + EMAIL.leaseMs) },
        });
        if (jobOwned.count) await settleMail(tx, job.id, "UNCERTAIN");
        return jobOwned.count === 1;
      }, TX_OPTIONS);
      if (!canSend) continue;
      const outcome = await transport.send(job.id, payload);
      if (outcome.ok) {
        await options.afterAccepted?.();
        // Save message id first, preserving webhook terminal status if it won.
        await db.$transaction(async (tx) => {
          await tx.emailJob.updateMany({
            where: { id: job.id, claimToken },
            data: { resendMessageId: outcome.messageId },
          });
          await tx.emailJob.updateMany({
            where: owned,
            data: { status: "SENT", lastError: null },
          });
          await tx.emailJob.updateMany({
            where: { id: job.id, claimToken },
            data: { claimToken: null },
          });
          // Match reclaim/failure order: job row before reservation locks.
          await settleMail(tx, job.id, "ACCEPTED");
        }, TX_OPTIONS);
        result.sent++;
      } else {
        if (outcome.quota) {
          await db.$transaction(async (tx) => {
            const pause = await providerQuotaPause(
              tx,
              outcome.quota === "month" ? "month" : "day",
              owner,
              outcome.retryAfterMs,
            );
            const updated = await tx.emailJob.updateMany({
              where: owned,
              data: {
                status: "QUEUED",
                attempts: { decrement: 1 },
                lastError: pause.reason,
                nextAttemptAt: pause.retryAt,
                claimToken: null,
                // A definitive first rejection permits a new first-send marker.
                // Earlier uncertainty always keeps its original retention deadline.
                ...(!job.firstSendAt ? { firstSendAt: null } : {}),
              },
            });
            if (updated.count && !job.firstSendAt)
              await settleMail(tx, job.id, "REJECTED", true);
          }, TX_OPTIONS);
          result.paused = true;
          break;
        }
        const delay = Math.max(
          retryDelay(job.attempts, options.random),
          outcome.retryAfterMs ?? 0,
        );
        await db.emailJob.updateMany({
          where: owned,
          data: {
            status:
              !outcome.transient || job.attempts >= EMAIL.maxAttempts
                ? "FAILED"
                : "QUEUED",
            lastError: safeEmailError(outcome.code),
            nextAttemptAt: new Date(now() + delay),
            claimToken: null,
          },
        });
        if (outcome.retryAfterMs) {
          await db.emailWorkerGate.updateMany({
            where: { id: "email", owner },
            data: { nextSendAt: new Date(now() + delay) },
          });
          result.paused = true;
          break;
        }
      }
    }
    return result;
  } finally {
    await db.emailWorkerGate.updateMany({
      where: { id: "email", owner },
      data: { owner: null, leaseUntil: new Date(0) },
    });
  }
}
