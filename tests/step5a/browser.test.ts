import { test, expect } from "bun:test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../fixture-db";
import { deriveStatusToken } from "@/lib/orders/status-token";
import { orderFixture } from "../phase4/fixtures";
import { login } from "../phase3b/helpers";
import { runCommand } from "../../scripts/fixture";
import { IMAGE_FILE_BYTES, MULTIPART_BYTES } from "@/lib/uploads/limits";

// The guarded runner owns app/database state; supported Node 24 runs Playwright.
test.skipIf(process.env.SILENT_RAVE_BROWSER_STEP5A !== "1")("owned Chrome: real canvas preparation, non-JSON 413/saved retry ID, HEIC fallback, mobile/banner feedback", async () => {
  const fixture = await orderFixture(1, false);
  await db.paymentProof.deleteMany({ where: { orderId: fixture.order.id } });
  fixture.order = await db.order.update({ where: { id: fixture.order.id }, data: { status: "AWAITING_PAYMENT", proofAttempts: 0, holdExpiresAt: new Date(Date.now() + 3600_000) } });
  const owner = await login(process.env.OWNER_EMAIL!, process.env.OWNER_PASSWORD!);
  const input = path.join(path.dirname(process.env.LOCAL_STORAGE_DIR!), "browser-input.json");
  await writeFile(input, JSON.stringify({ fixture, owner, token: deriveStatusToken(fixture.order.id, fixture.order.statusTokenVersion), imageFileBytes: IMAGE_FILE_BYTES, multipartBytes: MULTIPART_BYTES }), { mode: 0o600 });
  const env: Record<string, string> = {}; for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  await runCommand(["node", "scripts/browser-step5a.mjs", input], env);
  expect(await db.paymentProof.count({ where: { orderId: fixture.order.id } })).toBe(1);
}, 300_000);
