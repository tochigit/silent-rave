import { beforeAll, afterAll, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import webpush from "web-push";
import {
  api,
  json,
  login,
  makeDb,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  createStaffUser,
  getFixtureEvent,
  type Session,
} from "../phase3b/helpers";
import { dispatchOwnerPush } from "../../src/lib/operations/push";
const db = makeDb();
let owner: Session;
beforeAll(async () => {
  owner = await login(OWNER_EMAIL, OWNER_PASSWORD);
}, 120000);
afterAll(() => db.$disconnect());
test("OWNER push subscriptions reject arbitrary URLs and never expose private VAPID keys", async () => {
  const keys = {
    p256dh: webpush.generateVAPIDKeys().publicKey,
    auth: randomBytes(16).toString("base64url"),
  };
  const post = (endpoint: string) =>
    api("/api/admin/push/subscribe", {
      cookies: owner.cookies,
      host: "admin.localhost:3000",
      origin: "http://admin.localhost:3000",
      body: { endpoint, keys },
    });
  expect((await post("http://127.0.0.1/private")).status).toBe(400);
  expect((await post("https://attacker.example/push")).status).toBe(400);
  const endpoint =
    "https://fcm.googleapis.com/fcm/send/fixture-" + crypto.randomUUID();
  expect((await post(endpoint)).status).toBe(200);
  const status = await json(
    await api("/api/admin/push/status", { cookies: owner.cookies }),
  );
  expect(status.active).toBe(true);
  expect(status.private_key).toBeUndefined();
  const event = await getFixtureEvent(db);
  const order = await db.order.create({
    data: {
      orderCode: "SR-PUSHTEST",
      eventId: event.id,
      customerName: "Private buyer",
      customerEmail: "private@example.test",
      source: "COMP",
      totalKobo: 0,
      status: "APPROVED",
    },
  });
  await dispatchOwnerPush(order.orderCode);
  const captured = await readFile(
    path.join(process.env.PUSH_CAPTURE_DIR!, "push.jsonl"),
    "utf8",
  );
  expect(captured).toContain("SR-PUSHTEST");
  expect(captured).not.toContain("private@example.test");
  expect(captured).not.toContain("Private buyer");
  expect(captured).not.toContain(endpoint);
  expect(
    (
      await api("/api/admin/push/subscribe", {
        cookies: owner.cookies,
        host: "admin.localhost:3000",
        origin: "http://admin.localhost:3000",
        body: { endpoint },
        method: "DELETE",
      })
    ).status,
  ).toBe(200);
});
test("STAFF cannot register owner notifications and Places fails closed without configuration", async () => {
  const email = `push-staff-${crypto.randomUUID()}@test.ng`;
  await createStaffUser(email, "push-staff-fixture-password", "STAFF");
  const staff = await login(email, "push-staff-fixture-password");
  expect(
    (await api("/api/admin/push/status", { cookies: staff.cookies })).status,
  ).toBe(403);
  const response = await api("/api/admin/places/autocomplete", {
    cookies: owner.cookies,
    host: "admin.localhost:3000",
    origin: "http://admin.localhost:3000",
    body: { input: "Lagos venue", session_token: crypto.randomUUID() },
  });
  expect(response.status).toBe(503);
});
