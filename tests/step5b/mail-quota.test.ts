import "../phase3b/load-env";
import { afterAll, beforeEach, expect, test } from "bun:test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { db } from "../fixture-db";
import { TX_OPTIONS } from "@/lib/constants";
import { EMAIL } from "@/lib/email/config";
import {
  reserveMail,
  reserveContactMail,
  settleMail,
  utcMailWindows,
  cleanupMailQuotas,
} from "@/lib/email/quota";
import { processEmailJobs } from "@/lib/email/worker";
import { openPayload } from "@/lib/email/payload";
import { deliverContact } from "@/lib/content/contact";
import type { EmailPayload, EmailTransport } from "@/lib/email/transport";
const runtime = new PrismaClient({
  datasourceUrl: process.env.TEST_RUNTIME_DATABASE_URL,
});
const peer = new PrismaClient({
  datasourceUrl: process.env.TEST_RUNTIME_DATABASE_URL,
});
beforeEach(async () => {
  process.env.EMAIL_DAILY_BUDGET = "90";
  process.env.EMAIL_MONTHLY_BUDGET = "2700";
  await db.emailJob.deleteMany();
  await db.mailQuotaWindow.deleteMany();
  await db.emailWorkerGate.update({
    where: { id: "email" },
    data: {
      owner: null,
      leaseUntil: new Date(0),
      nextSendAt: new Date(0),
      pauseReason: null,
    },
  });
});
afterAll(async () => {
  await Promise.all([
    runtime.$disconnect(),
    peer.$disconnect(),
    db.$disconnect(),
  ]);
});
const reserve = (id: string, client = runtime) =>
  client.$transaction((tx) => reserveMail(tx, id), TX_OPTIONS);
const build = async (): Promise<EmailPayload> => ({
  from: "a@example.test",
  reply_to: "b@example.test",
  to: [],
  subject: "Fixed",
  html: "<p>stable</p>",
  text: "stable",
  attachments: [],
  tags: [],
});
async function queued() {
  const event = await db.event.findFirstOrThrow(),
    account = await db.paymentAccount.findFirstOrThrow();
  const order = await db.order.create({
    data: {
      orderCode: `SR-${randomUUID().slice(0, 8)}`,
      eventId: event.id,
      customerName: "Quota fixture",
      customerEmail: "quota@example.test",
      customerPhone: "08012345678",
      totalKobo: 0,
      paymentAccountId: account.id,
      holdExpiresAt: new Date(),
      status: "APPROVED",
    },
  });
  return db.emailJob.create({
    data: {
      orderId: order.id,
      kind: "STATUS_LINK",
      recipientEmail: order.customerEmail,
      nextAttemptAt: new Date(Date.now() - 1000),
    },
  });
}
function options(transport: EmailTransport) {
  let time = Date.now();
  return {
    client: runtime,
    transport,
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
    random: () => 0.5,
    buildPayload: build,
  };
}
const success: EmailTransport = {
  send: async () => ({ ok: true, messageId: "fixture-success" }),
};
test("concurrent reservations share day/month ceilings and deduplicate opaque send IDs", async () => {
  process.env.EMAIL_DAILY_BUDGET = "3";
  process.env.EMAIL_MONTHLY_BUDGET = "5";
  const ids = Array.from({ length: 8 }, () => randomUUID());
  const results = await Promise.all(
    ids.map((id, i) => reserve(id, i % 2 ? peer : runtime)),
  );
  expect(results.filter((r) => r.allowed)).toHaveLength(3);
  expect(
    results
      .filter((r) => !r.allowed)
      .every((r) => !r.allowed && r.reason === "QUOTA_DAY"),
  ).toBe(true);
  const accepted = ids[results.findIndex((r) => r.allowed)];
  await Promise.all([reserve(accepted), reserve(accepted, peer)]);
  expect((await db.mailQuotaWindow.findMany()).map((w) => w.reserved)).toEqual([
    3, 3,
  ]);
  expect(await db.mailSendReservation.count()).toBe(6);
  const windows = utcMailWindows(new Date());
  expect(
    (await db.mailQuotaWindow.findMany({ orderBy: { kind: "asc" } })).map(
      (w) => w.startsAt,
    ),
  ).toEqual(windows.map((w) => w.starts));
});
test("UTC calendar boundaries handle year rollover and leap day; past windows do not consume current quotas", async () => {
  expect(
    utcMailWindows(new Date("2028-02-29T23:59:59Z")).map((w) =>
      w.reset.toISOString(),
    ),
  ).toEqual(["2028-03-01T00:00:00.000Z", "2028-03-01T00:00:00.000Z"]);
  expect(
    utcMailWindows(new Date("2026-12-31T23:59:59Z")).map((w) =>
      w.reset.toISOString(),
    ),
  ).toEqual(["2027-01-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z"]);
  const id = randomUUID();
  for (const window of utcMailWindows(new Date("2025-12-31T12:00:00Z"))) {
    await db.mailQuotaWindow.create({
      data: {
        kind: window.kind,
        startsAt: window.starts,
        resetAt: window.reset,
        reserved: 90,
      },
    });
    await db.mailSendReservation.create({
      data: {
        sendId: id,
        kind: window.kind,
        startsAt: window.starts,
        amount: 1,
        state: "UNCERTAIN",
      },
    });
  }
  expect((await reserve(id)).allowed).toBe(true);
  expect(await db.mailSendReservation.count({ where: { sendId: id } })).toBe(4);
  expect(await cleanupMailQuotas(runtime)).toBe(2);
  expect(await db.mailSendReservation.count({ where: { sendId: id } })).toBe(2);
});
test("month refusal defers untouched job before attempt/claim/payload/first send; no transport call", async () => {
  process.env.EMAIL_MONTHLY_BUDGET = "1";
  await reserve(randomUUID());
  const j = await queued();
  let sends = 0;
  const result = await processEmailJobs(
    options({
      send: async () => {
        sends++;
        return { ok: true, messageId: "bad" };
      },
    }),
  );
  const saved = await db.emailJob.findUniqueOrThrow({ where: { id: j.id } });
  expect(result.paused).toBe(true);
  expect(result.processed).toBe(0);
  expect(sends).toBe(0);
  expect(saved.status).toBe("QUEUED");
  expect(saved.attempts).toBe(0);
  expect(saved.firstSendAt).toBeNull();
  expect(saved.claimToken).toBeNull();
  expect(saved.encryptedPayload).toBeNull();
  expect(saved.lastError).toBe("QUOTA_MONTH");
  expect(saved.nextAttemptAt.getTime()).toBe(
    utcMailWindows(new Date())[1].reset.getTime() + 60000,
  );
});
test("definitive first provider quota undoes only fresh attempt/marker and releases new reservations", async () => {
  const j = await queued();
  await processEmailJobs(
    options({
      send: async () => ({
        ok: false,
        transient: true,
        code: "HTTP_429",
        quota: "month",
      }),
    }),
  );
  const saved = await db.emailJob.findUniqueOrThrow({ where: { id: j.id } });
  expect(saved.attempts).toBe(0);
  expect(saved.firstSendAt).toBeNull();
  expect(saved.encryptedPayload).not.toBeNull();
  expect(saved.lastError).toBe("QUOTA_MONTH");
  expect(saved.nextAttemptAt.getTime()).toBe(
    utcMailWindows(new Date())[1].reset.getTime() + 60000,
  );
  expect(
    (await db.mailQuotaWindow.findMany()).every((w) => w.reserved === 0),
  ).toBe(true);
  expect((await processEmailJobs(options(success))).paused).toBe(true);
});
test("network ambiguity followed by quota preserves original retention, immutable retry body and conservative counts", async () => {
  const j = await queued(),
    bodies: string[] = [];
  await processEmailJobs(
    options({
      send: async (_id, payload) => {
        bodies.push(JSON.stringify(payload));
        return { ok: false, transient: true, code: "NETWORK_ERROR" };
      },
    }),
  );
  const first = await db.emailJob.findUniqueOrThrow({ where: { id: j.id } });
  await db.emailJob.update({
    where: { id: j.id },
    data: { nextAttemptAt: new Date(0) },
  });
  await db.emailWorkerGate.update({
    where: { id: "email" },
    data: { nextSendAt: new Date(0) },
  });
  await processEmailJobs({
    ...options({
      send: async (_id, payload) => {
        bodies.push(JSON.stringify(payload));
        return { ok: false, transient: true, code: "HTTP_429", quota: "day" };
      },
    }),
    buildPayload: async () => {
      throw new Error("must reuse");
    },
  });
  const saved = await db.emailJob.findUniqueOrThrow({ where: { id: j.id } });
  expect(bodies[1]).toBe(bodies[0]);
  expect(saved.firstSendAt).toEqual(first.firstSendAt);
  expect(saved.attempts).toBe(1);
  expect(
    (await db.mailQuotaWindow.findMany()).every((w) => w.reserved === 1),
  ).toBe(true);
  expect(openPayload(j.id, saved.encryptedPayload!).to).toEqual([
    "quota@example.test",
  ]);
});
test("crash after reservation and after acceptance retries one reservation with identical body", async () => {
  const j = await queued();
  await reserve(j.id); // simulate process death before claim
  const bodies = new Map<string, string>();
  let effective = 0;
  const transport: EmailTransport = {
    send: async (id, p) => {
      const body = JSON.stringify(p);
      if (bodies.has(id)) expect(body).toBe(bodies.get(id)!);
      else {
        bodies.set(id, body);
        effective++;
      }
      return { ok: true, messageId: "one" };
    },
  };
  await expect(
    processEmailJobs({
      ...options(transport),
      afterAccepted: async () => {
        throw new Error("SIMULATED_CRASH");
      },
    }),
  ).rejects.toThrow("SIMULATED_CRASH");
  await db.emailJob.update({
    where: { id: j.id },
    data: { nextAttemptAt: new Date(0) },
  });
  await db.emailWorkerGate.update({
    where: { id: "email" },
    data: { nextSendAt: new Date(0) },
  });
  await processEmailJobs({
    ...options(transport),
    buildPayload: async () => {
      throw new Error("must reuse");
    },
  });
  expect(effective).toBe(1);
  expect(
    (await db.mailQuotaWindow.findMany()).every((w) => w.reserved === 1),
  ).toBe(true);
  expect(
    (await db.mailSendReservation.findMany()).every(
      (r) => r.state === "ACCEPTED",
    ),
  ).toBe(true);
});
test("contact and order share gate/budget; busy contact stores no contents and makes no send", async () => {
  const id = randomUUID();
  expect((await reserveContactMail(id, runtime)).allowed).toBe(true);
  expect((await reserveContactMail(randomUUID(), peer)).allowed).toBe(false);
  await queued();
  expect((await processEmailJobs(options(success))).busy).toBe(true);
  let sends = 0;
  await expect(
    deliverContact(
      {
        name: "Private fixture name",
        email: "private@example.test",
        message: "Private contact fixture contents",
      },
      {
        send: async () => {
          sends++;
          return { ok: true, messageId: "bad" };
        },
      },
    ),
  ).rejects.toThrow("MAIL_QUOTA_PAUSED");
  expect(sends).toBe(0);
  expect(await db.mailSendReservation.count()).toBe(2);
  expect(JSON.stringify(await db.mailSendReservation.findMany())).not.toContain(
    "Private",
  );
});
test("stale worker fence after preparation blocks I/O; oversized attachments fail before send", async () => {
  const j = await queued();
  let sends = 0;
  await processEmailJobs({
    ...options({
      send: async () => {
        sends++;
        return { ok: true, messageId: "bad" };
      },
    }),
    buildPayload: async () => {
      await db.emailWorkerGate.update({
        where: { id: "email" },
        data: {
          owner: randomUUID(),
          leaseUntil: new Date(Date.now() + EMAIL.gateLeaseMs),
        },
      });
      return build();
    },
  });
  expect(sends).toBe(0);
  expect(
    (await db.emailJob.findUniqueOrThrow({ where: { id: j.id } })).status,
  ).toBe("QUEUED");
  await db.emailJob.deleteMany();
  await db.emailWorkerGate.update({
    where: { id: "email" },
    data: { owner: null, leaseUntil: new Date(0), nextSendAt: new Date(0) },
  });
  const large = await queued();
  await processEmailJobs({
    ...options(success),
    buildPayload: async () => ({
      ...(await build()),
      attachments: Array.from({ length: 11 }, () => ({
        filename: "ticket.pdf",
        content: "small",
      })),
    }),
  });
  expect(
    (await db.emailJob.findUniqueOrThrow({ where: { id: large.id } }))
      .lastError,
  ).toBe("PAYLOAD_ERROR");
});
test("repeated settlement never releases accepted or already rejected budget twice", async () => {
  const accepted = randomUUID(),
    rejected = randomUUID();
  await reserve(accepted);
  await reserve(rejected);
  await runtime.$transaction(
    (tx) => settleMail(tx, accepted, "ACCEPTED"),
    TX_OPTIONS,
  );
  await runtime.$transaction(
    (tx) => settleMail(tx, accepted, "REJECTED", true),
    TX_OPTIONS,
  );
  await runtime.$transaction(
    (tx) => settleMail(tx, rejected, "REJECTED", true),
    TX_OPTIONS,
  );
  await runtime.$transaction(
    (tx) => settleMail(tx, rejected, "REJECTED", true),
    TX_OPTIONS,
  );
  expect(
    (await db.mailQuotaWindow.findMany()).every((w) => w.reserved === 1),
  ).toBe(true);
});
test("acceptance waiting on a job row leaves reservation locks available to reclaim", async () => {
  const j = await queued();
  let release = () => {},
    signal = () => {};
  const accepted = new Promise<void>((resolve) => {
    signal = resolve;
  });
  const resumed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = processEmailJobs({
    ...options(success),
    limit: 1,
    afterAccepted: async () => {
      signal();
      await resumed;
    },
  });
  await accepted;
  try {
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM public.email_jobs WHERE id=${j.id}::uuid FOR UPDATE`;
      // Prime the observer before the worker resumes: a transaction keeps its
      // activity snapshot until explicitly cleared, even while a peer changes.
      await tx.$queryRaw`SELECT count(*) FROM pg_stat_activity`;
      release();
      let blocked = false;
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        await tx.$executeRaw`SELECT pg_stat_clear_snapshot()`;
        const [row] = await tx.$queryRaw<
          Array<{ blocked: boolean }>
        >`SELECT EXISTS(
          SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock'
            AND pg_backend_pid()=ANY(pg_blocking_pids(pid))
            AND query LIKE '%email_jobs%') AS blocked`;
        if (row.blocked) {
          blocked = true;
          break;
        }
        await Bun.sleep(10);
      }
      expect(blocked).toBe(true);
      const [lock] = await tx.$queryRaw<
        Array<{ acquired: boolean }>
      >`SELECT pg_try_advisory_xact_lock(31::int,hashtext(${j.id})) AS acquired`;
      expect(lock.acquired).toBe(true);
      expect((await reserveMail(tx, j.id)).allowed).toBe(true);
    }, TX_OPTIONS);
  } finally {
    release();
    await pending;
  }
  expect(
    (await db.emailJob.findUniqueOrThrow({ where: { id: j.id } })).status,
  ).toBe("SENT");
  expect(
    (await db.mailQuotaWindow.findMany()).every((w) => w.reserved === 1),
  ).toBe(true);
});
test("a provider Retry-After later than daily reset postpones the gate without consuming a first attempt", async () => {
  const j = await queued(), started = Date.now();
  await processEmailJobs(options({ send: async () => ({ ok: false, transient: true,
    code: "HTTP_429", quota: "day", retryAfterMs: 36 * 3600000,
  }) }));
  const saved = await db.emailJob.findUniqueOrThrow({ where: { id: j.id } });
  const gate = await db.emailWorkerGate.findUniqueOrThrow({ where: { id: "email" } });
  expect(saved.attempts).toBe(0); expect(saved.firstSendAt).toBeNull();
  expect(saved.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(started + 36 * 3600000);
  expect(gate.nextSendAt).toEqual(saved.nextAttemptAt);
});
test("aggregate attachment budget fails before encryption/provider I/O and releases a fresh reservation", async () => {
  const j = await queued(); let sends = 0;
  await processEmailJobs({ ...options({ send: async () => { sends++; return { ok: true, messageId: "bad" }; } }),
    buildPayload: async () => ({ ...await build(), attachments: [{ filename: "ticket.pdf", content: "A".repeat(40*1024*1024+1) }] }),
  });
  const saved = await db.emailJob.findUniqueOrThrow({ where: { id: j.id } });
  expect(sends).toBe(0); expect(saved.lastError).toBe("PAYLOAD_ERROR"); expect(saved.encryptedPayload).toBeNull();
  expect((await db.mailQuotaWindow.findMany()).every(w => w.reserved === 0)).toBe(true);
});
