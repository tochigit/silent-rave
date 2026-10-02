import "../phase3b/load-env";
import { test, expect } from "bun:test";
import { kickEmailJobs } from "@/lib/email/kick";
test("best-effort kick swallows worker failure; fixture flag disables automatic sends", async () => {
  const previous = process.env.EMAIL_KICK_ENABLED;
  try {
    process.env.EMAIL_KICK_ENABLED = "1"; let called = 0;
    await expect(kickEmailJobs(async () => { called++; throw new Error("failure"); })).resolves.toBeUndefined(); expect(called).toBe(1);
    process.env.EMAIL_KICK_ENABLED = "0";
    await kickEmailJobs(async () => { called++; }); expect(called).toBe(1);
  } finally { process.env.EMAIL_KICK_ENABLED = previous; }
});
