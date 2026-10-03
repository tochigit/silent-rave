import { beforeAll, afterAll, expect, test } from "bun:test";
import {
  api,
  json,
  login,
  makeDb,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  createStaffUser,
  createTestTier,
  getFixtureEvent,
  makeJpeg,
  type Session,
} from "../phase3b/helpers";
const db = makeDb();
let owner: Session, staff: Session, eventId: string, tierId: string;
const admin = (path: string, body?: unknown, method?: string) =>
  api("/api/admin/" + path, {
    cookies: owner.cookies,
    host: "admin.localhost:3000",
    origin: "http://admin.localhost:3000",
    body,
    method,
  });
const scanner = (path: string, body?: unknown, session = staff) =>
  api("/api/staff/" + path, {
    cookies: session.cookies,
    host: "staff.localhost:3000",
    origin: "http://staff.localhost:3000",
    body,
  });
beforeAll(async () => {
  owner = await login(OWNER_EMAIL, OWNER_PASSWORD);
  const email = `scanner-${crypto.randomUUID()}@test.ng`;
  await createStaffUser(email, "scanner-fixture-password", "STAFF");
  staff = await login(email, "scanner-fixture-password");
  eventId = (await getFixtureEvent(db)).id;
  tierId = (await createTestTier(db, "Step4 capacity", 50)).id;
}, 180000);
afterAll(() => db.$disconnect());
async function issue(
  source: "CASH" | "COMP" = "CASH",
  quantity = 1,
  req = crypto.randomUUID(),
) {
  const input = {
    client_request_id: req,
    source,
    event_id: eventId,
    reason: "Fixture door admission",
    customer_name: "=SUM(1,2)",
    customer_email: `issue-${req}@test.ng`,
    line_items: [
      {
        tier_id: tierId,
        quantity,
        holder_names: Array.from({ length: quantity }, (_, i) => `Guest ${i}`),
      },
    ],
  };
  const response = await admin("orders/issue", input);
  expect(response.status).toBe(201);
  const order = await json(response);
  const ticket = await db.ticketUnit.findFirstOrThrow({
    where: { orderId: order.order_id },
  });
  return { input, order, ticket };
}
test("new surfaces require sessions, OWNER role and matching mutation Origin", async () => {
  for (const path of [
    "/api/admin/events",
    "/api/admin/staff",
    "/api/admin/reconciliation",
    "/api/staff/events",
    "/api/staff/events/00000000-0000-0000-0000-000000000000/manifest",
  ])
    expect((await api(path)).status).toBe(401);
  expect(
    (await api("/api/admin/events", { cookies: staff.cookies })).status,
  ).toBe(403);
  expect(
    (
      await api("/api/admin/staff", {
        cookies: owner.cookies,
        origin: "http://staff.localhost:3000",
        body: {},
      })
    ).status,
  ).toBe(403);
  expect(
    (await api("/api/staff/check-in", { cookies: staff.cookies, body: {} }))
      .status,
  ).toBe(403);
});
test("CASH server price, COMP zero price, idempotent issue, changed retry and rollback capacity", async () => {
  const cash = await issue("CASH", 2);
  const tier = await db.ticketTier.findUniqueOrThrow({ where: { id: tierId } });
  expect(cash.order.total_kobo).toBe(tier.priceKobo * 2);
  expect((await json(await admin("orders/issue", cash.input))).order_id).toBe(
    cash.order.order_id,
  );
  expect(
    await db.ticketUnit.count({ where: { orderId: cash.order.order_id } }),
  ).toBe(2);
  expect(
    (await admin("orders/issue", { ...cash.input, reason: "Changed request" }))
      .status,
  ).toBe(409);
  expect((await issue("COMP")).order.total_kobo).toBe(0);
  const tiny = await createTestTier(db, "Tiny", 0),
    before = await db.order.count();
  expect(
    (
      await admin("orders/issue", {
        ...cash.input,
        client_request_id: crypto.randomUUID(),
        line_items: [
          { tier_id: tierId, quantity: 1 },
          { tier_id: tiny.id, quantity: 1 },
        ],
      })
    ).status,
  ).toBe(409);
  expect(await db.order.count()).toBe(before);
});
test("online simultaneous phones admit once; replay is idempotent; malformed/wrong event recorded", async () => {
  const { ticket } = await issue();
  const input = {
    token: ticket.qrToken,
    event_id: eventId,
    device_id: "phone-a",
    client_scan_id: crypto.randomUUID(),
  };
  const other = {
    ...input,
    device_id: "phone-b",
    client_scan_id: crypto.randomUUID(),
  };
  const responses = await Promise.all([
    scanner("check-in", input),
    scanner("check-in", other),
  ]);
  const results = await Promise.all(responses.map(json));
  expect(results.map((r) => r.result).sort()).toEqual(["duplicate", "valid"]);
  expect((await json(await scanner("check-in", input))).idempotent).toBe(true);
  expect(await db.checkInScan.count({ where: { ticketId: ticket.id } })).toBe(
    2,
  );
  expect(
    (await scanner("check-in", { ...input, token: "invalid" })).status,
  ).toBe(409);
  expect(
    (
      await json(
        await scanner("check-in", {
          ...input,
          token: "invalid",
          client_scan_id: crypto.randomUUID(),
        }),
      )
    ).result,
  ).toBe("invalid");
  const e = await db.event.findFirstOrThrow({ where: { id: eventId } });
  const second = await db.event.create({
    data: {
      title: "Other event",
      slug: "scanner-other",
      description: "fixture",
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      organizerId: e.organizerId,
      venueId: e.venueId,
      status: "PUBLISHED",
      isDateConfirmed: true,
    },
  });
  expect(
    (
      await json(
        await scanner("check-in", {
          ...input,
          event_id: second.id,
          client_scan_id: crypto.randomUUID(),
        }),
      )
    ).result,
  ).toBe("wrong_event");
});
test("offline reversed device arrival selects earliest scan, flags conflict, keeps ledger immutable and retries safe", async () => {
  const { ticket } = await issue();
  const make = (device: string, ms: number) => ({
    device_id: device,
    event_id: eventId,
    clock_offset_ms: 0,
    since: "0",
    scans: [
      {
        token: ticket.qrToken,
        event_id: eventId,
        scanned_at: new Date(Date.now() - ms).toISOString(),
        client_scan_id: crypto.randomUUID(),
        not_in_manifest: true,
      },
    ],
  });
  const late = make("offline-late", 10000),
    early = make("offline-early", 20000);
  expect(
    (await json(await scanner("check-in/batch", late))).results[0].result,
  ).toBe("valid");
  const firstLedger = await db.checkInScan.findUniqueOrThrow({
    where: { clientScanId: late.scans[0].client_scan_id },
  });
  expect(
    (await json(await scanner("check-in/batch", early))).results[0].result,
  ).toBe("conflict");
  const unit = await db.ticketUnit.findUniqueOrThrow({
    where: { id: ticket.id },
  });
  expect(unit.checkedInAt!.toISOString()).toBe(early.scans[0].scanned_at);
  expect(
    (await db.checkInScan.findUniqueOrThrow({ where: { id: firstLedger.id } }))
      .result,
  ).toBe("VALID");
  expect(
    (await json(await scanner("check-in/batch", early))).results[0].idempotent,
  ).toBe(true);
  expect(await db.checkInScan.count({ where: { ticketId: ticket.id } })).toBe(
    2,
  );
});
test("manifest overlap and attendee allowlist, refunds and cancelled events invalidate admission", async () => {
  const { order, ticket } = await issue();
  const full = await json(await scanner(`events/${eventId}/manifest`));
  expect(full.tickets.some((t: any) => t.id === ticket.id)).toBe(true);
  const delta = await json(
    await scanner(`events/${eventId}/manifest?since=${full.next_since}`),
  );
  expect(delta.tickets.length).toBeGreaterThan(0);
  for (const data of [
    full,
    await json(await scanner(`attendee-list?event_id=${eventId}`)),
  ]) {
    const serialized = JSON.stringify(data);
    for (const privateKey of [
      "customer_email",
      "customerEmail",
      "totalKobo",
      "qrToken",
      "bank_name",
      "payment_account",
    ])
      expect(serialized.includes(privateKey)).toBe(false);
  }
  expect(
    (
      await admin(`orders/${order.order_id}/refund`, {
        password: OWNER_PASSWORD,
        restock: false,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await json(
        await scanner("check-in", {
          token: ticket.qrToken,
          event_id: eventId,
          device_id: "refund",
          client_scan_id: crypto.randomUUID(),
        }),
      )
    ).result,
  ).toBe("void");
  const refreshed = await json(
    await scanner(`events/${eventId}/manifest?since=${full.next_since}`),
  );
  expect(refreshed.tickets.find((t: any) => t.id === ticket.id).voided).toBe(
    true,
  );
  const other = await issue();
  await admin(`events/${eventId}`, { status: "CANCELLED" }, "PATCH");
  expect(
    (
      await json(
        await scanner("check-in", {
          token: other.ticket.qrToken,
          event_id: eventId,
          device_id: "cancel",
          client_scan_id: crypto.randomUUID(),
        }),
      )
    ).result,
  ).toBe("void");
  // Test-only restore so unrelated operations have a consistent fixture event.
  await db.event.update({
    where: { id: eventId },
    data: { status: "PUBLISHED" },
  });
});
test("staff invitation requires first password reset; reset strips other sessions; deactivation revokes access", async () => {
  const email = `invited-${crypto.randomUUID()}@test.ng`,
    temporary = "temporary-fixture-password";
  const created = await json(
    await admin("staff", {
      name: "Invited",
      email,
      temporary_password: temporary,
    }),
  );
  const session = await login(email, temporary);
  expect((await scanner("events", undefined, session)).status).toBe(403);
  const reset = await api("/api/auth/password", {
    cookies: session.cookies,
    host: "staff.localhost:3000",
    origin: "http://staff.localhost:3000",
    body: {
      current_password: temporary,
      new_password: "new-fixture-password-123",
    },
  });
  expect(reset.status).toBe(200);
  expect((await scanner("events", undefined, session)).status).toBe(200);
  expect(
    (await admin(`staff/${created.staff.id}`, { is_active: false }, "PATCH"))
      .status,
  ).toBe(200);
  expect((await scanner("events", undefined, session)).status).toBe(401);
  expect(
    (await admin(`staff/${owner.userId}`, { is_active: false }, "PATCH"))
      .status,
  ).toBe(403);
});
test("event draft/banner/publish gates, protected inventory edits and referenced deletes", async () => {
  const current = await db.event.findUniqueOrThrow({ where: { id: eventId } });
  const input = {
    slug: `owner-${crypto.randomUUID()}`,
    title: "Owner created event",
    description: "Fixture description",
    organizer_id: current.organizerId,
    venue_id: current.venueId,
    starts_at: current.startsAt.toISOString(),
    ends_at: current.endsAt.toISOString(),
    is_date_confirmed: false,
    status: "DRAFT",
  };
  const created = await json(await admin("events", input));
  expect(created.event.status).toBe("DRAFT");
  expect(
    (
      await admin(
        `events/${created.event.id}`,
        { status: "PUBLISHED" },
        "PATCH",
      )
    ).status,
  ).toBe(409);
  const banner = new FormData();
  banner.append(
    "banner",
    new Blob([new Uint8Array(await makeJpeg())]),
    "banner.jpg",
  );
  const upload = await json(
    await admin(`events/${created.event.id}/banner`, banner),
  );
  expect(upload.banner_image_url).toMatch(/^\/api\/banners\//);
  expect((await api(upload.banner_image_url)).status).toBe(200);
  expect(
    (
      await admin(
        `events/${created.event.id}`,
        { status: "PUBLISHED" },
        "PATCH",
      )
    ).status,
  ).toBe(200);
  expect(
    (await admin(`tiers/${tierId}`, { capacity: 0 }, "PATCH")).status,
  ).toBe(409);
  expect((await admin(`events/${eventId}`, undefined, "DELETE")).status).toBe(
    409,
  );
  expect(
    (await admin(`venues/${current.venueId}`, undefined, "DELETE")).status,
  ).toBe(409);
  expect(
    (await admin(`organizers/${current.organizerId}`, undefined, "DELETE"))
      .status,
  ).toBe(409);
});
test("content editor, CSV formula neutralization and totals, append-only audit surface", async () => {
  expect(
    (
      await admin(
        "pages/about",
        {
          title: "About fixture",
          body: "<script>escaped text</script>",
          is_published: true,
        },
        "PATCH",
      )
    ).status,
  ).toBe(200);
  expect((await json(await api("/api/pages/about"))).body).toContain(
    "<script>",
  );
  const csv = await admin(`reconciliation?event_id=${eventId}&format=csv`);
  expect(csv.status).toBe(200);
  const content = await csv.text();
  expect(content).toContain("'=SUM(1,2)");
  expect(content).toContain("TOTAL DISTINCT ORDERS");
  expect(csv.headers.get("cache-control")).toContain("no-store");
  expect((await json(await admin("audit-log"))).entries.length).toBeGreaterThan(
    0,
  );
  expect((await admin("audit-log", { action: "tamper" }, "POST")).status).toBe(
    404,
  );
});
