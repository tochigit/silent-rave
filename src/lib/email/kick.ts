import { processEmailJobs } from "./worker";
/** Registered via Next after() at route boundaries, after the DB commit. */
export async function kickEmailJobs(run: () => Promise<unknown> = processEmailJobs): Promise<void> {
  if (process.env.EMAIL_KICK_ENABLED === "0") return;
  try { await run(); } catch { /* scheduler retries; response is already committed */ }
}
