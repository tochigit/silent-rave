import "../phase3b/load-env";
import { test, expect } from "bun:test";
import { emailConfig, EMAIL, retryDelay, safeEmailError } from "@/lib/email/config";

test("config is fail-closed; capture cannot run in production; origins have no credentials/path", () => {
  expect(emailConfig().transport).toBe("capture");
  expect(() => emailConfig({ ...process.env, EMAIL_TRANSPORT: "" })).toThrow();
  expect(() => emailConfig({ ...process.env, EMAIL_PAYLOAD_SECRET: "" })).toThrow();
  expect(() => emailConfig({ ...process.env, NODE_ENV: "production" })).toThrow();
  expect(() => emailConfig({ ...process.env, PUBLIC_BASE_URL: "https://user:secret@example.com/path" })).toThrow();
  expect(EMAIL.maxAttempts).toBe(6);
  expect(EMAIL.batchSize).toBe(20);
  expect(EMAIL.leaseMs).toBe(300_000);
  expect(EMAIL.timeoutMs).toBe(15_000);
});
test("backoff schedule has bounded jitter and errors contain no provider content", () => {
  expect([1, 2, 3, 4, 5].map(n => retryDelay(n, () => 0.5))).toEqual([...EMAIL.backoffMs]);
  expect(retryDelay(1, () => 0)).toBe(54_000);
  expect(safeEmailError("https://evil.test/?t=secret buyer@test.ng")).toBe("PAYLOAD_ERROR");
});
