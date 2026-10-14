type Coordinate = number | { toString(): string } | null | undefined;
export function venueMapEmbedUrl(venue: { latitude: Coordinate; longitude: Coordinate }): string | null {
  if (venue.latitude == null || venue.longitude == null) return null;
  const latitude = Number(venue.latitude), longitude = Number(venue.longitude);
  const maxLatitude = 85.05112878;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
    Math.abs(latitude) > maxLatitude || Math.abs(longitude) > 180) return null;
  const bbox = [Math.max(-180, longitude - 0.006), Math.max(-maxLatitude, latitude - 0.006),
    Math.min(180, longitude + 0.006), Math.min(maxLatitude, latitude + 0.006)];
  return "https://www.openstreetmap.org/export/embed.html?" + new URLSearchParams({
    bbox: bbox.map((n) => n.toFixed(6)).join(","), layer: "mapnik",
    marker: `${latitude.toFixed(6)},${longitude.toFixed(6)}`,
  });
}
