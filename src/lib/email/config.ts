import { z } from "zod";

export const EMAIL = {
  intervalMs: 600,
  maxAttempts: 6,
  backoffMs: [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000],
  leaseMs: 300_000,
  batchSize: 20,
  timeoutMs: 15_000,
  runBudgetMs: 45_000,
  gateLeaseMs: 60_000,
  retentionMs: 23 * 60 * 60_000,
} as const;

export function mailBudgets(
  env: Record<string, string | undefined> = process.env,
) {
  const day = Number(env.EMAIL_DAILY_BUDGET ?? 90),
    month = Number(env.EMAIL_MONTHLY_BUDGET ?? 2700);
  if (
    !Number.isInteger(day) ||
    day < 1 ||
    day > 90 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 2700
  )
    throw new Error("INVALID_MAIL_BUDGET");
  return { day, month };
}

export function emailConfig(env = process.env) {
  const transport = z.enum(["capture", "resend"]).parse(env.EMAIL_TRANSPORT);
  if (transport === "capture" && env.NODE_ENV === "production")
    throw new Error("CAPTURE_DEV_ONLY");
  const base = new URL(z.string().min(1).parse(env.PUBLIC_BASE_URL));
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== "/" ||
    (base.protocol !== "https:" &&
      !(
        env.NODE_ENV !== "production" &&
        base.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(base.hostname)
      ))
  ) {
    throw new Error("INVALID_PUBLIC_BASE_URL");
  }
  const from = z.email().parse(env.EMAIL_FROM);
  const replyTo = z.email().parse(env.EMAIL_REPLY_TO);
  const payloadKey = Buffer.from(env.EMAIL_PAYLOAD_SECRET ?? "", "base64url");
  if (payloadKey.length !== 32) throw new Error("INVALID_EMAIL_PAYLOAD_SECRET");
  const apiKey =
    transport === "resend" ? z.string().min(1).parse(env.RESEND_API_KEY) : "";
  const intervalMs = z.coerce
    .number()
    .int()
    .min(500)
    .max(60_000)
    .parse(env.EMAIL_SEND_INTERVAL_MS ?? EMAIL.intervalMs);
  return {
    transport,
    baseUrl: base.origin,
    from,
    replyTo,
    payloadKey,
    apiKey,
    intervalMs,
  };
}

/** Only fixed codes are persisted; provider error messages can contain PII. */
export function safeEmailError(code: string): string {
  const allowed =
    /^(HTTP_[0-9]{3}|NETWORK_ERROR|ORDER_NOT_APPROVED|MAX_ATTEMPTS|DELIVERY_UNCERTAIN|PAYLOAD_ERROR|RECIPIENT_CHANGED|TOKEN_VERSION_CHANGED|QUOTA_DAY|QUOTA_MONTH)$/;
  return allowed.test(code) ? code : "PAYLOAD_ERROR";
}

export function retryDelay(attempts: number, random = Math.random): number {
  return Math.round(
    EMAIL.backoffMs[Math.min(Math.max(attempts - 1, 0), 4)] *
      (0.9 + random() * 0.2),
  );
}
