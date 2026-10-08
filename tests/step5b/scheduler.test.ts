import "../phase3b/load-env";
import { expect, test } from "bun:test";
import worker, { runScheduled } from "../../scheduler/worker";
test("scheduler posts exactly two fixed authenticated targets with independent bounded no-redirect calls", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const deadlines: number[] = [],
    timeout = AbortSignal.timeout;
  AbortSignal.timeout = (ms: number) => {
    deadlines.push(ms);
    return timeout(ms);
  };
  try {
    await runScheduled({ CRON_SECRET: "s".repeat(32) }, async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(null);
    });
  } finally {
    AbortSignal.timeout = timeout;
  }
  expect(calls.map((c) => c.url).sort()).toEqual([
    "https://silentrave.space/api/internal/expire-holds",
    "https://silentrave.space/api/internal/process-email-jobs",
  ]);
  expect(deadlines).toEqual([70000, 70000]);
  for (const { init } of calls) {
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect(init?.credentials).toBe("omit");
    expect(init?.cache).toBe("no-store");
    expect(new Headers(init?.headers).get("x-cron-secret")).toBe(
      "s".repeat(32),
    );
    expect(init?.body).toBeUndefined();
  }
  expect(Object.keys(worker)).toEqual(["scheduled"]);
});
test("one failed scheduler target never prevents calling the other and errors stay fixed", async () => {
  let count = 0;
  await expect(
    runScheduled({ CRON_SECRET: "s".repeat(32) }, async () => {
      count++;
      throw new Error("private-provider-body");
    }),
  ).rejects.toThrow("SCHEDULED_TARGET_FAILED");
  expect(count).toBe(2);
  await expect(runScheduled({ CRON_SECRET: "" })).rejects.toThrow(
    "SCHEDULER_SECRET_REQUIRED",
  );
});
