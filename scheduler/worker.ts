type SchedulerEnvironment = { CRON_SECRET: string };
type SchedulerRequest = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
const targets = [
  "https://silentrave.space/api/internal/expire-holds",
  "https://silentrave.space/api/internal/process-email-jobs",
] as const;

/** Source only. No inbound HTTP handler or configurable target URL. */
export async function runScheduled(
  env: SchedulerEnvironment,
  request: SchedulerRequest = fetch,
) {
  if (!env.CRON_SECRET || env.CRON_SECRET.length < 32)
    throw new Error("SCHEDULER_SECRET_REQUIRED");
  const results = await Promise.allSettled(
    targets.map(async (target) => {
      const response = await request(target, {
        method: "POST",
        headers: { "x-cron-secret": env.CRON_SECRET },
        // Workers supports manual; reject the returned 3xx without following it.
        redirect: "manual",
        credentials: "omit",
        cache: "no-store",
        signal: AbortSignal.timeout(70000),
      });
      // Discard response bodies, which are never needed by the scheduler.
      await response.body?.cancel();
      return response.ok;
    }),
  );
  if (results.some((r) => r.status !== "fulfilled" || !r.value))
    throw new Error("SCHEDULED_TARGET_FAILED");
}
const scheduler = {
  async scheduled(_controller: unknown, env: SchedulerEnvironment) {
    await runScheduled(env);
  },
};
export default scheduler;
