import { Prisma, type PrismaClient } from "@prisma/client";
import { db } from "../db";
import { TX_OPTIONS } from "../constants";
import { mailBudgets } from "./config";
export { mailBudgets } from "./config";

type Tx = Prisma.TransactionClient;
type Kind = "day" | "month";
export type QuotaPause = {
  allowed: false;
  retryAt: Date;
  retryAfterSec: number;
  reason: "QUOTA_DAY" | "QUOTA_MONTH";
};
export class MailQuotaPauseError extends Error {
  constructor(public retryAfterSec: number) {
    super("MAIL_QUOTA_PAUSED");
  }
}
async function clock(tx: Tx) {
  const [row] = await tx.$queryRaw<
    Array<{ now: Date }>
  >`SELECT clock_timestamp() AS now`;
  return { now: row.now, windows: utcMailWindows(row.now) };
}
export function utcMailWindows(now: Date) {
  const day = new Date(now);
  day.setUTCHours(0, 0, 0, 0);
  const month = new Date(day);
  month.setUTCDate(1);
  const nextDay = new Date(day);
  nextDay.setUTCDate(day.getUTCDate() + 1);
  const nextMonth = new Date(month);
  nextMonth.setUTCMonth(month.getUTCMonth() + 1);
  return [
    { kind: "day" as const, starts: day, reset: nextDay },
    { kind: "month" as const, starts: month, reset: nextMonth },
  ];
}
function checkSend(id: string, amount: number) {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      id,
    ) ||
    !Number.isInteger(amount) ||
    amount < 1 ||
    amount > 10
  )
    throw new Error("INVALID_MAIL_RESERVATION");
}
export async function reserveMail(
  tx: Tx,
  id: string,
  amount = 1,
): Promise<{ allowed: true } | QuotaPause> {
  checkSend(id, amount);
  const budgets = mailBudgets(),
    time = await clock(tx);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(31::int, hashtext(${id}))`;
  const needed: typeof time.windows = [];
  let denied: QuotaPause | undefined;
  // Fixed day->month order, independent of inventory/order/tier locks.
  for (const window of time.windows) {
    await tx.$executeRaw`INSERT INTO public.mail_quota_windows(kind, starts_at, reset_at)
      VALUES(${window.kind}, ${window.starts}, ${window.reset}) ON CONFLICT DO NOTHING`;
    const [usage] = await tx.$queryRaw<
      Array<{ reserved: number }>
    >`SELECT reserved FROM public.mail_quota_windows
      WHERE kind=${window.kind} AND starts_at=${window.starts} FOR UPDATE`;
    const [existing] = await tx.$queryRaw<
      Array<{ amount: number; state: string }>
    >`SELECT amount,state FROM public.mail_send_reservations
      WHERE send_id=${id}::uuid AND kind=${window.kind} AND starts_at=${window.starts}`;
    if (existing && existing.amount !== amount)
      throw new Error("MAIL_RESERVATION_CHANGED");
    if (existing && existing.state !== "REJECTED") continue;
    needed.push(window);
    if (usage.reserved + amount > budgets[window.kind]) {
      const retryAt = new Date(window.reset.getTime() + 60000);
      if (!denied || retryAt > denied.retryAt)
        denied = {
          allowed: false,
          retryAt,
          retryAfterSec: Math.max(
            1,
            Math.ceil((retryAt.getTime() - time.now.getTime()) / 1000),
          ),
          reason: window.kind === "day" ? "QUOTA_DAY" : "QUOTA_MONTH",
        };
    }
  }
  if (denied) return denied;
  for (const window of needed) {
    await tx.$executeRaw`UPDATE public.mail_quota_windows SET reserved=reserved+${amount}
      WHERE kind=${window.kind} AND starts_at=${window.starts}`;
    await tx.$executeRaw`INSERT INTO public.mail_send_reservations(send_id,kind,starts_at,amount,state)
      VALUES(${id}::uuid,${window.kind},${window.starts},${amount},'RESERVED')
      ON CONFLICT(send_id,kind,starts_at) DO UPDATE SET state='RESERVED',updated_at=clock_timestamp()`;
  }
  return { allowed: true };
}
export async function settleMail(
  tx: Tx,
  id: string,
  state: "UNCERTAIN" | "ACCEPTED" | "REJECTED",
  release = false,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(31::int, hashtext(${id}))`;
  const rows = await tx.$queryRaw<
    Array<{ kind: Kind; starts_at: Date; amount: number; state: string }>
  >`
    SELECT kind,starts_at,amount,state FROM public.mail_send_reservations WHERE send_id=${id}::uuid ORDER BY kind,starts_at`;
  for (const row of rows) {
    if (row.state === "ACCEPTED" || row.state === "REJECTED") continue;
    if (release)
      await tx.$executeRaw`UPDATE public.mail_quota_windows SET reserved=GREATEST(0,reserved-${row.amount})
      WHERE kind=${row.kind} AND starts_at=${row.starts_at}`;
    await tx.$executeRaw`UPDATE public.mail_send_reservations SET state=${state},updated_at=clock_timestamp()
      WHERE send_id=${id}::uuid AND kind=${row.kind} AND starts_at=${row.starts_at}`;
  }
}
export async function providerQuotaPause(
  tx: Tx,
  kind: Kind,
  owner: string,
  retryAfterMs = 0,
): Promise<QuotaPause> {
  const time = await clock(tx),
    window = time.windows.find((w) => w.kind === kind)!;
  const retryAt = new Date(
    Math.max(window.reset.getTime() + 60000, time.now.getTime() + retryAfterMs),
  );
  const reason = kind === "day" ? "QUOTA_DAY" : "QUOTA_MONTH";
  await tx.$executeRaw`UPDATE public.email_worker_gate SET next_send_at=GREATEST(next_send_at,${retryAt}),pause_reason=${reason}
    WHERE id='email' AND owner=${owner}::uuid`;
  return {
    allowed: false,
    retryAt,
    reason,
    retryAfterSec: Math.max(
      1,
      Math.ceil((retryAt.getTime() - time.now.getTime()) / 1000),
    ),
  };
}
/** Contacts use the same gate and quota without persisting contact content. */
export async function reserveContactMail(
  id: string,
  client: PrismaClient = db,
) {
  return client.$transaction(async (tx) => {
    const time = await clock(tx);
    const [gate] = await tx.$queryRaw<
      Array<{ lease_until: Date; next_send_at: Date }>
    >`
      SELECT lease_until,next_send_at FROM public.email_worker_gate WHERE id='email' FOR UPDATE`;
    if (!gate) throw new Error("MAIL_GATE_UNAVAILABLE");
    const retry =
      Math.max(gate.lease_until.getTime(), gate.next_send_at.getTime()) -
      time.now.getTime();
    if (retry > 0)
      return {
        allowed: false as const,
        retryAfterSec: Math.max(1, Math.ceil(retry / 1000)),
      };
    const quota = await reserveMail(tx, id);
    if (!quota.allowed) return quota;
    await tx.$executeRaw`UPDATE public.email_worker_gate SET owner=${id}::uuid,
      lease_until=${new Date(time.now.getTime() + 60000)}, next_send_at=${new Date(time.now.getTime() + 600)} WHERE id='email'`;
    await settleMail(tx, id, "UNCERTAIN");
    return { allowed: true as const };
  }, TX_OPTIONS);
}
/** Only long-expired metadata; no queued mail, PII, active budget or business row. */
export async function cleanupMailQuotas(client: PrismaClient = db) {
  return client.$executeRaw`WITH expired AS (SELECT kind,starts_at FROM public.mail_quota_windows
    WHERE reset_at < statement_timestamp() - interval '40 days' ORDER BY reset_at,kind
    FOR UPDATE SKIP LOCKED LIMIT 1000)
    DELETE FROM public.mail_quota_windows w USING expired e WHERE w.kind=e.kind AND w.starts_at=e.starts_at`;
}
