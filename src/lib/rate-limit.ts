import { createHmac } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { db } from "./db";
import { privateHeaders } from "./auth/policy";
import { localMode } from "./hosting/config";
import { readTrustedContextNode } from "./hosting/request-context-node";

const policy = {
  login: [10, 600000],
  "checkout-initialize-ip": [10, 3600000],
  "proof-submit-ip": [30, 3600000],
  "lookup-ip": [10, 3600000],
  "lookup-code": [3, 3600000],
  "contact-ip": [5, 3600000],
  "password-change": [5, 600000],
  scanner: [300, 60000],
  places: [60, 60000],
} as const;
export type RateLimitOptions = { limit: number; windowMs: number };
export type RateLimitResult = { limited: boolean; retryAfterSec: number };
export class RateLimitUnavailableError extends Error {
  constructor() {
    super("RATE_LIMIT_UNAVAILABLE");
  }
}

/** Canonical address, including IPv4-mapped IPv6, without subnet aggregation. */
export function normalizeIp(value: string): string {
  if (
    /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value) &&
    value.split(".").every((n) => +n <= 255)
  )
    return value.split(".").map(Number).join(".");
  if (!/^[a-f0-9:.]+$/i.test(value) || !value.includes(":"))
    throw new RateLimitUnavailableError();
  let ip: string;
  try {
    ip = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  } catch {
    throw new RateLimitUnavailableError();
  }
  const mapped = /^::ffff:([a-f0-9]+):([a-f0-9]+)$/.exec(ip);
  if (mapped) {
    const a = parseInt(mapped[1], 16),
      b = parseInt(mapped[2], 16);
    return [a >> 8, a & 255, b >> 8, b & 255].join(".");
  }
  return ip;
}
export function rateLimitIp(request: Request): string {
  try {
    return normalizeIp(readTrustedContextNode(request).clientIp);
  } catch {
    throw new RateLimitUnavailableError();
  }
}
export function rateLimitIdentity(
  bucket: string,
  key: string,
  secret = process.env.RATE_LIMIT_SECRET,
): string {
  if (
    !secret ||
    !/^[A-Za-z0-9_-]{43}$/.test(secret) ||
    Buffer.from(secret, "base64url").toString("base64url") !== secret
  )
    throw new RateLimitUnavailableError();
  const normalized = bucket.endsWith("-ip")
    ? normalizeIp(key)
    : bucket === "lookup-code"
      ? key.trim().toUpperCase()
      : key.trim().toLowerCase();
  if (!normalized || normalized.length > 320)
    throw new RateLimitUnavailableError();
  return createHmac("sha256", Buffer.from(secret, "base64url"))
    .update(JSON.stringify([1, bucket, normalized]))
    .digest("hex");
}
const memory = new Map<string, { count: number; resetAt: number }>();
export async function consumeRateLimit(
  bucket: string,
  key: string,
  options: RateLimitOptions,
  client: PrismaClient = db,
): Promise<RateLimitResult> {
  try {
    const expected = policy[bucket as keyof typeof policy];
    if (
      !expected ||
      !Number.isSafeInteger(options.limit) ||
      options.limit < 1 ||
      options.limit > 1000000 ||
      options.windowMs !== expected[1] ||
      (bucket !== "checkout-initialize-ip" && options.limit !== expected[0])
    )
      throw new RateLimitUnavailableError();
    const identity = rateLimitIdentity(bucket, key);
    if (process.env.RATE_LIMIT_DRIVER === "memory") {
      if (!localMode()) throw new RateLimitUnavailableError();
      const now = Date.now(),
        id = `${bucket}:${identity}`;
      if (memory.size > 5000)
        for (const [name, row] of memory)
          if (row.resetAt <= now) memory.delete(name);
      let row = memory.get(id);
      if (!row || row.resetAt <= now) {
        row = { count: 0, resetAt: now + options.windowMs };
        memory.set(id, row);
      }
      row.count = Math.min(Number.MAX_SAFE_INTEGER, row.count + 1);
      return {
        limited: row.count > options.limit,
        retryAfterSec: Math.max(1, Math.ceil((row.resetAt - now) / 1000)),
      };
    }
    if (process.env.RATE_LIMIT_DRIVER !== "postgres")
      throw new RateLimitUnavailableError();
    const rows = await client.$queryRaw<
      Array<{ count: bigint; retry: number }>
    >(Prisma.sql`
      WITH instant AS MATERIALIZED (SELECT clock_timestamp()::timestamptz(3) AS value), consumed AS (
        INSERT INTO public.rate_limit_windows (bucket_name, key_hmac, count, reset_at)
        SELECT ${bucket}, ${identity}, 1, value + ${options.windowMs} * interval '1 millisecond' FROM instant
        ON CONFLICT (bucket_name, key_hmac) DO UPDATE SET
          count = CASE WHEN rate_limit_windows.reset_at <= (SELECT value FROM instant) THEN 1
            ELSE LEAST(rate_limit_windows.count, 9223372036854775806::bigint) + 1 END,
          reset_at = CASE WHEN rate_limit_windows.reset_at <= (SELECT value FROM instant)
            THEN (SELECT value FROM instant) + ${options.windowMs} * interval '1 millisecond'
            ELSE rate_limit_windows.reset_at END
        RETURNING count, reset_at
      ) SELECT count, GREATEST(1, ceil(extract(epoch FROM reset_at - value)))::int AS retry
        FROM consumed CROSS JOIN instant
    `);
    if (!rows[0]) throw new RateLimitUnavailableError();
    return {
      limited: rows[0].count > BigInt(options.limit),
      retryAfterSec: rows[0].retry,
    };
  } catch {
    throw new RateLimitUnavailableError();
  }
}
export async function cleanupRateLimits(
  client: PrismaClient = db,
): Promise<number> {
  if (process.env.RATE_LIMIT_DRIVER === "memory" && localMode()) return 0;
  if (process.env.RATE_LIMIT_DRIVER !== "postgres")
    throw new RateLimitUnavailableError();
  return client.$executeRaw`WITH expired AS (
    SELECT bucket_name, key_hmac FROM public.rate_limit_windows WHERE reset_at <= statement_timestamp()
    ORDER BY reset_at, bucket_name, key_hmac FOR UPDATE SKIP LOCKED LIMIT 1000
  ) DELETE FROM public.rate_limit_windows w USING expired e
    WHERE w.bucket_name = e.bucket_name AND w.key_hmac = e.key_hmac`;
}
export function rateLimitUnavailableResponse() {
  return Response.json(
    { error: "Service temporarily unavailable. Please retry later." },
    { status: 503, headers: privateHeaders },
  );
}
export function rateLimitResponse(retryAfterSec: number, message: string) {
  return Response.json(
    { error: message },
    {
      status: 429,
      headers: { ...privateHeaders, "Retry-After": String(retryAfterSec) },
    },
  );
}
