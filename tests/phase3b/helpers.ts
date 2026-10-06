// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers for the Phase 3b (manual payment) test suite.
//
// Tests run against the runner's REAL dev server on a dedicated loopback port
// and verify DB state through independent Prisma
// clients (separate connections from the server's pool).
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient, type EmailJobKind } from "@prisma/client";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import "./load-env";

// Fixture configuration is supplied explicitly and checked by load-env.

export const BASE = process.env.TEST_BASE_URL!;
export const DB_URL = process.env.TEST_DATABASE_URL!;

// ── DB clients (independent connections from the server's pool) ──────────────

export function makeDb(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: DB_URL } } });
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

export type ApiOptions = {
  method?: string;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  /** Origin header to send (state-changing routes check it per 06). */
  origin?: string | null;
  /** Host header (surface routing: localhost / admin.localhost / staff.localhost). */
  host?: string;
  /** Fake client IP for per-IP rate-limit buckets. */
  ip?: string;
  body?: unknown;
};

export async function api(path: string, options: ApiOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.host) headers.host = options.host;
  if (options.origin !== null && options.origin !== undefined) {
    headers.origin = options.origin;
  }
  if (options.ip) headers["x-sr-test-ip"] = options.ip;
  if (options.cookies) {
    headers.cookie = Object.entries(options.cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    if (options.body instanceof FormData) {
      body = options.body;
    } else {
      headers["content-type"] = "application/json";
      body = JSON.stringify(options.body);
    }
  }
  return fetch(`${BASE}${path}`, {
    method: options.method ?? (body ? "POST" : "GET"),
    headers,
    body,
    redirect: "manual",
  });
}

export async function json(response: Response): Promise<any> {
  return response.json();
}

// ── sessions ─────────────────────────────────────────────────────────────────

export type Session = { cookies: Record<string, string>; userId: string };

/** Log in over the API and keep the session cookie. */
export async function login(email: string, password: string): Promise<Session> {
  const response = await api("/api/auth/login", {
    host: "localhost:3000",
    origin: "http://localhost:3000",
    body: { email, password },
  });
  if (response.status !== 200) {
    throw new Error(`login failed for ${email}: ${response.status} ${await response.text()}`);
  }
  const setCookie = response.headers.getSetCookie?.() ?? [];
  const jar: Record<string, string> = {};
  for (const raw of setCookie) {
    const [pair] = raw.split(";");
    const eq = pair.indexOf("=");
    jar[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  const db = makeDb();
  const user = await db.staffUser.findUnique({ where: { email }, select: { id: true } });
  await db.$disconnect();
  return { cookies: jar, userId: user!.id };
}

/** Create a staff user directly in the DB (no admin API for this yet). */
export async function createStaffUser(
  email: string,
  password: string,
  role: "OWNER" | "STAFF"
): Promise<string> {
  const db = makeDb();
  const existing = await db.staffUser.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    await db.$disconnect();
    return existing.id;
  }
  const user = await db.staffUser.create({
    data: {
      name: `Test ${role}`,
      email,
      passwordHash: await bcrypt.hash(password, 4), // low cost: tests only
      role,
    },
    select: { id: true },
  });
  await db.$disconnect();
  return user.id;
}

// ── fixture data ─────────────────────────────────────────────────────────────

export const OWNER_EMAIL = process.env.OWNER_EMAIL ?? "owner@silentrave.ng";
export const OWNER_PASSWORD = process.env.OWNER_PASSWORD ?? "silentrave-dev-owner";

export async function getFixtureEvent(db: PrismaClient) {
  const event = await db.event.findUniqueOrThrow({
    where: { slug: "dev-fixture-silent-rave" },
    select: { id: true, title: true },
  });
  return event;
}

export async function getFixtureTier(db: PrismaClient, name = "Early Bird") {
  const event = await getFixtureEvent(db);
  const tier = await db.ticketTier.findFirstOrThrow({
    where: { eventId: event.id, name },
    select: { id: true, priceKobo: true, capacity: true, sold: true, reserved: true },
  });
  return { ...tier, eventId: event.id };
}

/** A dedicated tier for a specific test (unique name → re-runnable against a warm DB). */
export async function createTestTier(
  db: PrismaClient,
  name: string,
  capacity: number,
  overrides: { sold?: number; reserved?: number; priceKobo?: number } = {}
): Promise<{ id: string; eventId: string; priceKobo: number; capacity: number }> {
  const event = await getFixtureEvent(db);
  const uniqueName = `${name}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const tier = await db.ticketTier.create({
    data: {
      eventId: event.id,
      name: uniqueName,
      priceKobo: overrides.priceKobo ?? 123000,
      capacity,
      sold: overrides.sold ?? 0,
      reserved: overrides.reserved ?? 0,
    },
    select: { id: true, eventId: true, priceKobo: true, capacity: true },
  });
  return tier;
}

// ── checkout helpers ─────────────────────────────────────────────────────────

export type InitializeResponse = {
  order_code: string;
  status_token: string;
  amount_kobo: number;
  hold_expires_at: string;
  payment_account: { bank_name: string; account_number: string; account_name: string };
};

export async function initializeOrder(args: {
  tierId: string;
  quantity?: number;
  email?: string;
  phone?: string;
  ip?: string;
  holderNames?: string[];
  /** Defaults to the fixture event; tests with custom events pass it explicitly. */
  eventId?: string;
}): Promise<{ response: Response; body: InitializeResponse | null; status: number }> {
  let eventId = args.eventId;
  if (!eventId) {
    const db = makeDb();
    try {
      eventId = (await getFixtureEvent(db)).id;
    } finally {
      await db.$disconnect();
    }
  }
  const response = await api("/api/checkout/initialize", {
    ip: args.ip ?? "10.0.0.1",
    body: {
      event_id: eventId,
      customer_name: "Test Buyer",
      customer_email: args.email ?? `buyer-${crypto.randomUUID().slice(0, 8)}@test.ng`,
      customer_phone: args.phone ?? `080${Math.floor(10000000 + Math.random() * 89999999)}`,
      line_items: [
        {
          tier_id: args.tierId,
          quantity: args.quantity ?? 1,
          ...(args.holderNames ? { holder_names: args.holderNames } : {}),
        },
      ],
    },
  });
  const body = response.status === 201 ? ((await response.json()) as InitializeResponse) : null;
  return { response, body, status: response.status };
}

// ── proof helpers ────────────────────────────────────────────────────────────

export async function makeJpeg(
  width = 320,
  height = 200,
  fill = "#3366aa"
): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: fill } })
    .jpeg()
    .toBuffer();
}

export async function makePng(width = 64, height = 64): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: "#ff9900" } })
    .png()
    .toBuffer();
}

export async function makeWebp(width = 64, height = 64): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#00aa66" } })
    .webp()
    .toBuffer();
}

/** A JPEG that carries EXIF GPS data (to prove the re-encode strips it). */
export async function makeJpegWithExif(width = 320, height = 200): Promise<Buffer> {
  const base = await makeJpeg(width, height);
  return sharp(base)
    .withMetadata({ exif: { IFD0: { Copyright: "SECRET-EXIF-PAYLOAD" } } })
    .jpeg()
    .toBuffer();
}

export async function submitProof(args: {
  orderCode: string;
  statusToken: string;
  reference: string;
  submissionId?: string;
  ip?: string;
  file?: Buffer;
  filename?: string;
  mimeType?: string;
}): Promise<{ response: Response; status: number; body: any }> {
  const form = new FormData();
  form.append(
    "proof",
    new Blob([new Uint8Array(args.file ?? (await makeJpeg()))], {
      type: args.mimeType ?? "image/jpeg",
    }),
    args.filename ?? "receipt.jpg"
  );
  form.append("transfer_reference", args.reference);
  form.append("sender_name", "Sender Name");
  form.append("client_submission_id", args.submissionId ?? crypto.randomUUID());
  const response = await api(`/api/orders/${args.orderCode}/proof`, {
    ip: args.ip ?? "10.0.1.1",
    headers: { "x-status-token": args.statusToken },
    body: form,
  });
  const text = await response.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }
  return { response, status: response.status, body };
}

// ── time manipulation (the fixture DB is ours) ───────────────────────────────

export async function backdateHold(db: PrismaClient, orderCode: string, msAgo: number) {
  await db.$executeRawUnsafe(
    `UPDATE orders SET hold_expires_at = now() - ($1 || ' milliseconds')::interval WHERE order_code = $2`,
    String(msAgo),
    orderCode
  );
}

export async function getOrder(db: PrismaClient, orderCode: string) {
  return db.order.findUniqueOrThrow({
    where: { orderCode },
    select: {
      id: true,
      status: true,
      holdExpiresAt: true,
      firstProofAt: true,
      proofAttempts: true,
      inventoryReleased: true,
      customerEmail: true,
      totalKobo: true,
    },
  });
}

export async function getTierState(db: PrismaClient, tierId: string) {
  const tier = await db.ticketTier.findUniqueOrThrow({
    where: { id: tierId },
    select: { sold: true, reserved: true, capacity: true },
  });
  return tier;
}

export async function countEmailJobs(
  db: PrismaClient,
  orderId: string,
  kind: EmailJobKind,
  dedupeKey?: string
): Promise<number> {
  return db.emailJob.count({
    where: { orderId, kind, ...(dedupeKey ? { dedupeKey } : {}) },
  });
}

/** The lazy sweep runs inside initialize; the internal endpoint is the cron path. */
export async function runSweep(): Promise<{ status: number; body: any }> {
  const secret = process.env.CRON_SECRET ?? "";
  const response = await api("/api/internal/expire-holds", {
    headers: { "x-cron-secret": secret },
    body: {},
  });
  return { status: response.status, body: await response.json() };
}

export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`EXPECT FAILED: ${message}`);
}

export function checkEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`EXPECT FAILED: ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
