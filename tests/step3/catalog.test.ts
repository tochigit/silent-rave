import "../phase3b/load-env";
import { test, expect, beforeAll, afterAll } from "bun:test";
import { db } from "../fixture-db";
import { nextUpcoming, publicEvent } from "@/lib/events/catalog";
import { api } from "../phase3b/helpers";
let saved: { id: string; status: "DRAFT" | "PUBLISHED" | "CANCELLED" }[] = [];
const ids: string[] = [];
async function event(
  slug: string,
  confirmed = true,
  start = "2099-01-02T22:30:00Z",
  status: "DRAFT" | "PUBLISHED" | "CANCELLED" = "PUBLISHED",
) {
  const organizer = await db.organizer.findFirstOrThrow();
  const venue = await db.venue.create({
    data: {
      name: "Fixture venue",
      address: "1 Fixture Road",
      city: "Test City",
      googlePlaceId: "ChIJfixture",
    },
  });
  const row = await db.event.create({
    data: {
      slug: `step3-${slug}-${crypto.randomUUID()}`,
      title: `Catalog ${slug}`,
      description: "Fixture description <script>ignored()</script>",
      startsAt: new Date(start),
      endsAt: new Date(new Date(start).getTime() + 4 * 3600000),
      isDateConfirmed: confirmed,
      status,
      organizerId: organizer.id,
      venueId: venue.id,
      bannerImageUrl: "javascript:alert(1)",
    },
  });
  ids.push(row.id);
  await db.ticketTier.create({
    data: {
      eventId: row.id,
      name: "Fixture tier",
      priceKobo: 123456,
      capacity: 10,
      sold: 2,
      reserved: 3,
    },
  });
  return row;
}
beforeAll(async () => {
  saved = await db.event.findMany({ select: { id: true, status: true } });
  await db.event.updateMany({ data: { status: "DRAFT" } });
});
afterAll(async () => {
  await db.event.updateMany({
    where: { id: { in: ids } },
    data: { status: "DRAFT" },
  });
  for (const row of saved)
    await db.event.update({
      where: { id: row.id },
      data: { status: row.status },
    });
});
test("public list/detail allowlist excludes drafts, private counters, finance, buyers and unsafe poster URLs", async () => {
  const visible = await event("visibility");
  const draft = await event("private", true, undefined, "DRAFT");
  const r = await api("/api/events?search=visibility");
  expect(r.status).toBe(200);
  const data = await r.json();
  expect(data.events).toHaveLength(1);
  expect(data.events[0].banner_image_url).toBeNull();
  expect(data.events[0].price_range).toEqual({
    min_kobo: 123456,
    max_kobo: 123456,
  });
  const detail = await (await api(`/api/events/${visible.slug}`)).json();
  expect(detail.ticket_tiers[0].available).toBe(5);
  expect(detail.venue.map_embed_url).toBeNull();
  expect(detail.venue.directions_url).toContain("query_place_id=ChIJfixture");
  for (const key of [
    "capacity",
    "reserved",
    "sold",
    "contact_email",
    "customer_email",
    "payment_account",
    "orders",
  ])
    expect(JSON.stringify(detail)).not.toContain(`"${key}"`);
  expect((await api(`/api/events/${draft.slug}`)).status).toBe(404);
});
test("CTA none, single, Lagos-day tie, in-progress and unconfirmed fallback", async () => {
  await db.event.updateMany({ data: { status: "DRAFT" } });
  const now = new Date("2099-01-01T00:00:00Z");
  expect(await nextUpcoming(now)).toEqual({ result: "none" });
  expect(await (await api("/api/events/next-upcoming")).json()).toEqual({
    result: "none",
  });
  const single = await event("single");
  expect(await nextUpcoming(now)).toEqual({
    result: "single",
    event: { slug: single.slug },
  });
  const tied = await event("tie", true, "2099-01-02T23:30:00Z");
  expect((await nextUpcoming(now)).result).toBe("single");
  await db.event.update({
    where: { id: single.id },
    data: { startsAt: new Date("2099-01-02T23:05:00Z") },
  });
  expect((await nextUpcoming(now)).result).toBe("multiple");
  expect((await (await api("/api/events/next-upcoming")).json()).result).toBe(
    "multiple",
  );
  expect((await nextUpcoming(new Date("2099-01-03T00:30:00Z"))).result).toBe(
    "multiple",
  );
  await db.event.updateMany({
    where: { id: { in: [single.id, tied.id] } },
    data: { status: "DRAFT" },
  });
  const unknown = await event("unconfirmed", false);
  expect(await nextUpcoming(now)).toEqual({
    result: "single",
    event: { slug: unknown.slug },
  });
  await event("another-unconfirmed", false);
  expect((await nextUpcoming(now)).result).toBe("multiple");
});
test("month/day use Lagos midnight, spanning events, search/city and invalid dates", async () => {
  await db.event.updateMany({ data: { status: "DRAFT" } });
  await event("boundary", true, "2099-01-02T23:30:00Z");
  await event("unknown", false);
  const day = await (
    await api(
      "/api/events?view=day&date=2099-01-03&city=Test%20City&search=boundary",
    )
  ).json();
  expect(day.events).toHaveLength(1);
  expect(
    (await (await api("/api/events?view=day&date=2099-01-02")).json()).events,
  ).toHaveLength(0);
  expect(
    (await (await api("/api/events?view=month&date=2099-01")).json()).events,
  ).toHaveLength(1);
  for (const query of [
    "page=0",
    "date=2099-02-30",
    "view=invalid",
    "view=day&date=garbage",
  ])
    expect((await api(`/api/events?${query}`)).status).toBe(400);
});
test("stable pagination covers all published events without duplicates", async () => {
  await db.event.updateMany({ data: { status: "DRAFT" } });
  for (let i = 0; i < 14; i++) await event(`pagination-${i}`);
  const first = await (
    await api("/api/events?search=pagination&page=1")
  ).json();
  const second = await (
    await api("/api/events?search=pagination&page=2")
  ).json();
  expect(first.events).toHaveLength(12);
  expect(second.events).toHaveLength(2);
  expect(first.pagination.total_pages).toBe(2);
  expect(
    new Set([...first.events, ...second.events].map((e) => e.id)).size,
  ).toBe(14);
  expect(
    (await (await api("/api/events?search=unmatched")).json()).events,
  ).toHaveLength(0);
});
test("tier state covers unconfirmed, cancelled, ended, coming-soon, closed and sold-out", async () => {
  const row = await event("state");
  const tier = await db.ticketTier.findFirstOrThrow({
    where: { eventId: row.id },
  });
  const now = new Date("2099-01-01T00:00:00Z");
  expect((await publicEvent(row.slug, now))!.ticket_tiers[0].state).toBe(
    "OPEN",
  );
  await db.ticketTier.update({
    where: { id: tier.id },
    data: { salesStartAt: new Date("2099-01-02T00:00:00Z") },
  });
  expect((await publicEvent(row.slug, now))!.ticket_tiers[0].state).toBe(
    "COMING_SOON",
  );
  await db.ticketTier.update({
    where: { id: tier.id },
    data: { salesStartAt: null, salesEndAt: new Date("2098-12-31T00:00:00Z") },
  });
  expect((await publicEvent(row.slug, now))!.ticket_tiers[0].state).toBe(
    "CLOSED",
  );
  await db.ticketTier.update({
    where: { id: tier.id },
    data: { salesEndAt: null, capacity: 5 },
  });
  expect((await publicEvent(row.slug, now))!.ticket_tiers[0].state).toBe(
    "SOLD_OUT",
  );
  expect(
    (await publicEvent(row.slug, new Date("2100-01-01")))!.ticket_tiers[0]
      .state,
  ).toBe("ENDED");
  await db.event.update({
    where: { id: row.id },
    data: { isDateConfirmed: false },
  });
  const unknown = (await publicEvent(row.slug, now))!;
  expect(unknown.ticket_tiers[0].state).toBe("UNCONFIRMED");
  expect(unknown.starts_at).toBeNull();
  expect(unknown.calendar_links).toEqual({});
  await db.event.update({
    where: { id: row.id },
    data: { status: "CANCELLED" },
  });
  expect((await publicEvent(row.slug, now))!.ticket_tiers[0].state).toBe(
    "CANCELLED",
  );
});
test("all calendar formats use true UTC instants; unconfirmed date returns 200 empty state", async () => {
  const row = await event("calendar", true, "2099-01-02T23:30:00Z");
  const ics = await (await api(`/api/events/${row.slug}/calendar/ics`)).text();
  expect(ics).toContain("DTSTART:20990102T233000Z");
  expect(ics).toContain("DTEND:20990103T033000Z");
  expect(ics).toContain("\r\n");
  expect(
    (await api(`/api/events/${row.slug}/calendar/ical`)).headers.get(
      "content-disposition",
    ),
  ).toContain("attachment");
  for (const format of ["google", "outlook365", "outlooklive"]) {
    const r = await api(`/api/events/${row.slug}/calendar/${format}`);
    expect(r.status).toBe(302);
    const url = new URL(r.headers.get("location")!);
    expect(url.protocol).toBe("https:");
    if (format === "google")
      expect(url.searchParams.get("dates")).toBe(
        "20990102T233000Z/20990103T033000Z",
      );
    else
      expect(url.searchParams.get("startdt")).toBe("2099-01-02T23:30:00.000Z");
  }
  await db.event.update({
    where: { id: row.id },
    data: { isDateConfirmed: false },
  });
  expect((await api(`/api/events/${row.slug}/calendar/ics`)).status).toBe(200);
  expect(
    (await (await api(`/api/events/${row.slug}/calendar/ics`)).json()).message,
  ).toBe("Date to be announced.");
  await db.event.update({ where: { id: row.id }, data: { status: "DRAFT" } });
  expect((await api(`/api/events/${row.slug}/calendar/ics`)).status).toBe(404);
});
