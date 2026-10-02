import { emailConfig } from "../src/lib/email/config";
import { processEmailJobs } from "../src/lib/email/worker";
import { db } from "../src/lib/db";
if (process.env.NODE_ENV === "production" || emailConfig().transport !== "capture") throw new Error("DEV_CAPTURE_ONLY");
let stopped = false;
process.once("SIGINT", () => { stopped = true; }); process.once("SIGTERM", () => { stopped = true; });
while (!stopped) { try { console.log(await processEmailJobs()); } catch { console.error("Email worker unavailable."); } if (!stopped) await Bun.sleep(1000); }
await db.$disconnect();
