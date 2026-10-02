import "../phase3b/load-env";
import { test, expect } from "bun:test";
import { directionsUrl } from "@/lib/venues/directions";
test("directions prefers place id, then coordinates, then safe URL, then null", () => {
  const venue = { name: "Hall & Café", googlePlaceId: "place", latitude: 6.5, longitude: 3.2, googleMapsUrl: "https://maps.google.com/example" };
  const url = new URL(directionsUrl(venue)!); expect(url.searchParams.get("query_place_id")).toBe("place"); expect(url.searchParams.get("query")).toBe(venue.name);
  expect(new URL(directionsUrl({ ...venue, googlePlaceId: null })!).searchParams.get("query")).toBe("6.5,3.2");
  expect(directionsUrl({ ...venue, googlePlaceId: null, latitude: null })).toBe(venue.googleMapsUrl);
  expect(directionsUrl({ name: "Hall", googleMapsUrl: "javascript:alert(1)" })).toBeNull();
  expect(directionsUrl({ name: "Hall" })).toBeNull();
});
