type VenueDirections = { name: string; googlePlaceId?: string | null; latitude?: { toString(): string } | number | null; longitude?: { toString(): string } | number | null; googleMapsUrl?: string | null };
export function directionsUrl(venue: VenueDirections): string | null {
  const base = "https://www.google.com/maps/search/";
  if (venue.googlePlaceId) return `${base}?${new URLSearchParams({ api: "1", query: venue.name, query_place_id: venue.googlePlaceId })}`;
  if (venue.latitude != null && venue.longitude != null) return `${base}?${new URLSearchParams({ api: "1", query: `${venue.latitude},${venue.longitude}` })}`;
  if (venue.googleMapsUrl) {
    try { const url = new URL(venue.googleMapsUrl); if (url.protocol === "https:" && !url.username && !url.password) return url.href; } catch { /* no unsafe links */ }
  }
  return null;
}
