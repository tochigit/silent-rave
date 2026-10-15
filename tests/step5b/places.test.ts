import "../phase3b/load-env";
import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { db } from "../fixture-db";
import { placeOperation } from "@/lib/operations/places";
import { OperationError } from "@/lib/operations/http";
import { addressSuggestions } from "@/lib/venues/address-suggestions";
import { venueMapEmbedUrl } from "@/lib/venues/map";
import { consumeAddressLookupBudget, consumeRateLimit, rateLimitIdentity, RateLimitUnavailableError } from "@/lib/rate-limit";
import { publicEvent } from "@/lib/events/catalog";

const providerKey = "fixture-geoapify-server-key";
const savedKey = process.env.GEOAPIFY_API_KEY;
const savedGoogleKey = process.env.GOOGLE_PLACES_API_KEY;
const sharedKeys = ["geoapify-shared-second-v1", "geoapify-shared-day-v1"];
const hashes = sharedKeys.map((key) => rateLimitIdentity("places", key));
const actorHashes: string[] = [];
function actorId() { const id = randomUUID(); actorHashes.push(rateLimitIdentity("places", id)); return id; }
const row = { formatted: "1 Fixture Road, Lagos, Nigeria", country_code: "ng", lat: 6.43,
  lon: 3.42, city: "Lagos", state: "Lagos", country: "Nigeria" };
let fetchMock: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;
const cold = new PrismaClient({ datasourceUrl: process.env.TEST_RUNTIME_DATABASE_URL });

function request(input: unknown = { input: "Lagos venue" }) {
  return new NextRequest("http://localhost:3000/api/admin/places/autocomplete", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
  });
}
async function seedBudget(secondCount = 1, dayCount = 1) {
  for (const [index, count] of [secondCount, dayCount].entries()) {
    await db.rateLimitWindow.create({ data: { bucketName: "places", keyHmac: hashes[index],
      count: BigInt(count), resetAt: new Date(Date.now() + 86400000) } });
  }
}
beforeEach(async () => {
  process.env.GEOAPIFY_API_KEY = providerKey;
  await db.rateLimitWindow.deleteMany({ where: { bucketName: "places", keyHmac: { in: [...hashes, ...actorHashes.splice(0)] } } });
});
afterEach(async () => {
  fetchMock?.mockRestore(); fetchMock = undefined;
  if (savedKey === undefined) delete process.env.GEOAPIFY_API_KEY; else process.env.GEOAPIFY_API_KEY = savedKey;
  if (savedGoogleKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY; else process.env.GOOGLE_PLACES_API_KEY = savedGoogleKey;
  await db.rateLimitWindow.deleteMany({ where: { bucketName: "places", keyHmac: { in: [...hashes, ...actorHashes.splice(0)] } } });
});
afterAll(async () => { await cold.$disconnect(); await db.$disconnect(); });

test("suggestions reject bad coordinates and foreign countries, cap results, and strip provider identifiers/secrets", () => {
  const result = addressSuggestions({ results: [
    { ...row, place_id: "not-a-google-id", apiKey: providerKey },
    { ...row, country_code: "gb" }, { ...row, lat: 91 }, { ...row, lon: "3.42" },
    { ...row, formatted: "x".repeat(201) }, { ...row, lat: null },
  ] });
  expect(result).toEqual([{ label: row.formatted, address: row.formatted, latitude: 6.43,
    longitude: 3.42, city: "Lagos", state: "Lagos", country: "Nigeria" }]);
  expect(JSON.stringify(result)).not.toContain(providerKey);
  expect(JSON.stringify(result)).not.toContain("place_id");
  expect(addressSuggestions({ results: Array.from({ length: 8 }, () => row) })).toHaveLength(5);
  expect(addressSuggestions({ results: [{ ...row, country_code: "NG", city: undefined, town: "Fixture Town" }] })[0].city).toBe("Fixture Town");
  expect(() => addressSuggestions({ private: providerKey })).toThrow();
});

test("one bounded Nigeria-filtered provider request supplies all fields without a billed details call", async () => {
  fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ results: [row] }));
  const response = await placeOperation(request(), ["places", "autocomplete"], actorId());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  const data = await response.json();
  expect(data.suggestions[0].latitude).toBe(6.43);
  expect(data.suggestions[0].longitude).toBe(3.42);
  expect(JSON.stringify(data)).not.toContain(providerKey);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [input, init] = fetchMock.mock.calls[0];
  const url = new URL(String(input));
  expect(url.origin + url.pathname).toBe("https://api.geoapify.com/v1/geocode/autocomplete");
  expect(url.searchParams.get("filter")).toBe("countrycode:ng");
  expect(url.searchParams.get("limit")).toBe("5");
  expect(url.searchParams.get("apiKey")).toBe(providerKey);
  expect(init?.redirect).toBe("error");
  expect(init?.cache).toBe("no-store");
  expect(init?.credentials).toBe("omit");
  expect(init?.signal).toBeInstanceOf(AbortSignal);
});

test("missing free-provider key never falls back to Google or makes an outbound request", async () => {
  process.env.GEOAPIFY_API_KEY = "";
  process.env.GOOGLE_PLACES_API_KEY = "fixture-unused-google-key";
  fetchMock = spyOn(globalThis, "fetch");
  try { await placeOperation(request(), ["places", "autocomplete"], actorId()); throw new Error("Expected missing-key error"); }
  catch (error) { expect(error).toBeInstanceOf(OperationError); expect((error as OperationError).status).toBe(503); }
  expect(fetchMock).not.toHaveBeenCalled();
});

test("invalid search and retired details endpoint do not spend provider credits", async () => {
  fetchMock = spyOn(globalThis, "fetch");
  for (const [input, path, status] of [[{ input: "a" }, "autocomplete", 400], [{ input: "Lagos", unexpected: "value" }, "autocomplete", 400], [{ place_id: "old" }, "details", 404]] as const) {
    try { await placeOperation(request(input), ["places", path], actorId()); throw new Error("Expected invalid request"); }
    catch (error) { expect(error).toBeInstanceOf(OperationError); expect((error as OperationError).status).toBe(status); }
  }
  expect(fetchMock).not.toHaveBeenCalled();
});

test("provider errors, redirects and malformed payloads are redacted and never retried", async () => {
  for (const response of [new Response(providerKey, { status: 403 }), new Response(null, { status: 302, headers: { Location: "https://example.invalid/steal" } }), Response.json({ error: providerKey })]) {
    await db.rateLimitWindow.deleteMany({ where: { bucketName: "places", keyHmac: { in: hashes } } });
    fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(response);
    await expect(placeOperation(request(), ["places", "autocomplete"], actorId())).rejects.toThrow(
      "Address lookup unavailable. Check the address and coordinates before saving.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRestore(); fetchMock = undefined;
  }
});

test("concurrent different owners share the remaining daily allowance before any provider call", async () => {
  await seedBudget(1, 999);
  await db.$executeRaw`UPDATE public.rate_limit_windows SET reset_at=clock_timestamp()-interval '1 second' WHERE bucket_name='places' AND key_hmac=${hashes[0]}`;
  fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ results: [row] }));
  const responses = await Promise.all(Array.from({ length: 8 }, () => placeOperation(request(), ["places", "autocomplete"], actorId())));
  expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
  expect(responses.filter((r) => r.status === 429)).toHaveLength(7);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect((await db.rateLimitWindow.findUniqueOrThrow({ where: { bucketName_keyHmac: { bucketName: "places", keyHmac: hashes[1] } } })).count).toBe(1001n);
  for (const response of responses.filter((r) => r.status === 429)) {
    expect(response.headers.get("retry-after")).not.toBeNull();
    expect(response.headers.get("cache-control")).toContain("no-store");
  }
});

test("provider per-second allowance is atomic across independent restricted connections", async () => {
  await seedBudget(1, 1);
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => consumeAddressLookupBudget(i % 2 ? cold : undefined)));
  expect(results.filter((r) => !r.limited)).toHaveLength(1);
  expect(results.filter((r) => r.limited)).toHaveLength(7);
});

test("database expiry restores the lookup allowance and arbitrary actor policies stay rejected", async () => {
  await seedBudget(1, 1000);
  expect((await consumeAddressLookupBudget(cold)).limited).toBe(true);
  await db.$executeRaw`UPDATE public.rate_limit_windows SET reset_at=clock_timestamp()-interval '1 second' WHERE bucket_name='places' AND key_hmac=${hashes[1]}`;
  await db.$executeRaw`UPDATE public.rate_limit_windows SET reset_at=clock_timestamp()-interval '1 second' WHERE bucket_name='places' AND key_hmac=${hashes[0]}`;
  expect((await consumeAddressLookupBudget(cold)).limited).toBe(false);
  await expect(consumeRateLimit("places", randomUUID(), { limit: 1000, windowMs: 86400000 }, cold)).rejects.toBeInstanceOf(RateLimitUnavailableError);
});

test("coordinate maps need no key and do not invent zero coordinates for missing values", () => {
  expect(venueMapEmbedUrl({ latitude: null, longitude: 3.42 })).toBeNull();
  expect(venueMapEmbedUrl({ latitude: 6.43, longitude: undefined })).toBeNull();
  for (const latitude of [NaN, Infinity, 91, 86]) expect(venueMapEmbedUrl({ latitude, longitude: 3.42 })).toBeNull();
  expect(venueMapEmbedUrl({ latitude: 6.43, longitude: 181 })).toBeNull();
  const url = new URL(venueMapEmbedUrl({ latitude: { toString: () => "6.43" }, longitude: { toString: () => "3.42" } })!);
  expect(url.origin + url.pathname).toBe("https://www.openstreetmap.org/export/embed.html");
  expect(url.searchParams.get("marker")).toBe("6.430000,3.420000");
  expect(url.searchParams.get("bbox")).toBe("3.414000,6.424000,3.426000,6.436000");
  expect(url.searchParams.has("key")).toBe(false);
  expect(url.searchParams.has("apiKey")).toBe(false);
  expect(venueMapEmbedUrl({ latitude: 0, longitude: 0 })).toContain("marker=0.000000%2C0.000000");
});

test("published event detail uses its saved coordinates for the free map without changing event visibility", async () => {
  const organizer = await db.organizer.findFirstOrThrow();
  const venue = await db.venue.create({ data: { name: "Free-map fixture venue", address: row.formatted,
    city: "Lagos", latitude: 6.43, longitude: 3.42 } });
  const event = await db.event.create({ data: { slug: `free-map-${randomUUID()}`, title: "Free-map fixture event",
    description: "Fixture only", startsAt: new Date("2099-01-01T18:00:00Z"), endsAt: new Date("2099-01-01T23:00:00Z"),
    status: "PUBLISHED", isDateConfirmed: true, organizerId: organizer.id, venueId: venue.id } });
  try {
    const detail = await publicEvent(event.slug);
    expect(detail?.venue.map_embed_url).toBe(venueMapEmbedUrl(venue));
    expect(detail?.venue.directions_url).toContain("query=6.43%2C3.42");
    await db.event.update({ where: { id: event.id }, data: { status: "DRAFT" } });
    expect(await publicEvent(event.slug)).toBeNull();
  } finally { await db.event.delete({ where: { id: event.id } }); await db.venue.delete({ where: { id: venue.id } }); }
});
