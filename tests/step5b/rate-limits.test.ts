import "../phase3b/load-env";
import { afterAll, expect, test } from "bun:test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { db } from "../fixture-db";
import {
  cleanupRateLimits,
  consumeRateLimit,
  normalizeIp,
  rateLimitIdentity,
  RateLimitUnavailableError,
} from "@/lib/rate-limit";
const first = new PrismaClient({
  datasourceUrl: process.env.TEST_RUNTIME_DATABASE_URL,
});
const second = new PrismaClient({
  datasourceUrl: process.env.TEST_RUNTIME_DATABASE_URL,
});
afterAll(async () => {
  await Promise.all([
    first.$disconnect(),
    second.$disconnect(),
    db.$disconnect(),
  ]);
});
const login = { limit: 10, windowMs: 600000 };

test("independent connections and cold instance share one atomic first-request window", async () => {
  const key = `${randomUUID()}@example.test`;
  const results = await Promise.all(
    Array.from({ length: 24 }, (_, i) =>
      consumeRateLimit("login", key, login, i % 2 ? first : second),
    ),
  );
  expect(results.filter((r) => !r.limited)).toHaveLength(10);
  expect(
    results.every((r) => r.retryAfterSec > 0 && r.retryAfterSec <= 600),
  ).toBe(true);
  const saved = await db.rateLimitWindow.findUniqueOrThrow({
    where: {
      bucketName_keyHmac: {
        bucketName: "login",
        keyHmac: rateLimitIdentity("login", key),
      },
    },
  });
  expect(saved.count).toBe(24n);
  const cold = new PrismaClient({
    datasourceUrl: process.env.TEST_RUNTIME_DATABASE_URL,
  });
  try {
    expect((await consumeRateLimit("login", key, login, cold)).limited).toBe(
      true,
    );
  } finally {
    await cold.$disconnect();
  }
  const after = await db.rateLimitWindow.findUniqueOrThrow({
    where: {
      bucketName_keyHmac: { bucketName: "login", keyHmac: saved.keyHmac },
    },
  });
  expect(after.resetAt).toEqual(saved.resetAt);
});
test("HMAC canonical identities hide PII; mapped IPs agree without subnet collapse", () => {
  expect(normalizeIp("::ffff:192.0.2.1")).toBe("192.0.2.1");
  expect(normalizeIp("2001:0DB8:0:0:0:0:0:1")).toBe("2001:db8::1");
  expect(rateLimitIdentity("lookup-ip", "::ffff:c000:201")).toBe(
    rateLimitIdentity("lookup-ip", "192.0.2.1"),
  );
  expect(rateLimitIdentity("login", " USER@EXAMPLE.TEST ")).toBe(
    rateLimitIdentity("login", "user@example.test"),
  );
  expect(rateLimitIdentity("lookup-code", " sr-ab ")).toBe(
    rateLimitIdentity("lookup-code", "SR-AB"),
  );
  expect(rateLimitIdentity("lookup-ip", "2001:db8::1")).not.toBe(
    rateLimitIdentity("lookup-ip", "2001:db8::2"),
  );
  expect(rateLimitIdentity("login", "private@example.test")).toMatch(
    /^[0-9a-f]{64}$/,
  );
  expect(() => normalizeIp("unknown")).toThrow(RateLimitUnavailableError);
  expect(() => rateLimitIdentity("login", "x", "bad")).toThrow(
    RateLimitUnavailableError,
  );
});
test("database clock resets expired windows, ignores app clock skew and clamps saturated bigint", async () => {
  const key = randomUUID(),
    hmac = rateLimitIdentity("login", key);
  const original = Date.now;
  try {
    Date.now = () => 0;
    expect(
      (await consumeRateLimit("login", key, login, first)).retryAfterSec,
    ).toBeGreaterThan(590);
  } finally {
    Date.now = original;
  }
  await db.rateLimitWindow.update({
    where: { bucketName_keyHmac: { bucketName: "login", keyHmac: hmac } },
    data: { count: 9223372036854775807n },
  });
  expect((await consumeRateLimit("login", key, login, second)).limited).toBe(
    true,
  );
  await db.$executeRaw`UPDATE public.rate_limit_windows SET reset_at=clock_timestamp()-interval '1 second' WHERE bucket_name='login' AND key_hmac=${hmac}`;
  expect((await consumeRateLimit("login", key, login, first)).limited).toBe(
    false,
  );
  expect(
    (
      await db.rateLimitWindow.findUniqueOrThrow({
        where: { bucketName_keyHmac: { bucketName: "login", keyHmac: hmac } },
      })
    ).count,
  ).toBe(1n);
});
test("cleanup is bounded to 1000 expired rows, skips a locked row and preserves active counters", async () => {
  const salt = randomUUID();
  await db.$executeRaw`INSERT INTO public.rate_limit_windows(bucket_name,key_hmac,count,reset_at)
    SELECT 'places',md5(${salt}||n::text)||md5(n::text||${salt}),1,clock_timestamp()-interval '1 minute' FROM generate_series(1,1002) n`;
  const locked = await db.rateLimitWindow.findFirstOrThrow({
    where: { bucketName: "places" },
  });
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT count FROM public.rate_limit_windows WHERE bucket_name='places' AND key_hmac=${locked.keyHmac} FOR UPDATE`;
    expect(await cleanupRateLimits(second)).toBe(1000);
    expect(
      await tx.rateLimitWindow.count({ where: { bucketName: "places" } }),
    ).toBe(2);
  });
  expect(await cleanupRateLimits(first)).toBe(2);
  expect(
    await db.rateLimitWindow.count({ where: { resetAt: { gt: new Date() } } }),
  ).toBeGreaterThan(0);
});
test("invalid policy, missing secret and unavailable backend never fall back to memory", async () => {
  await expect(
    consumeRateLimit("unknown", "x", login, first),
  ).rejects.toBeInstanceOf(RateLimitUnavailableError);
  const broken = new PrismaClient({
    datasourceUrl:
      "postgresql://fixture@127.0.0.1:1/silentrave_test?connect_timeout=1",
  });
  try {
    await expect(
      consumeRateLimit("login", randomUUID(), login, broken),
    ).rejects.toBeInstanceOf(RateLimitUnavailableError);
  } finally {
    await broken.$disconnect();
  }
  const driver = process.env.RATE_LIMIT_DRIVER,
    secret = process.env.RATE_LIMIT_SECRET,
    host = process.env.HOST_PLATFORM;
  try {
    process.env.RATE_LIMIT_SECRET = "";
    await expect(
      consumeRateLimit("login", "x", login, first),
    ).rejects.toBeInstanceOf(RateLimitUnavailableError);
    process.env.RATE_LIMIT_SECRET = secret;
    process.env.RATE_LIMIT_DRIVER = "memory";
    process.env.HOST_PLATFORM = "netlify";
    await expect(
      consumeRateLimit("login", "x", login, first),
    ).rejects.toBeInstanceOf(RateLimitUnavailableError);
  } finally {
    process.env.RATE_LIMIT_DRIVER = driver;
    process.env.RATE_LIMIT_SECRET = secret;
    process.env.HOST_PLATFORM = host;
  }
});
