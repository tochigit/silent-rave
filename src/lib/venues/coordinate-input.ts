export type Coordinates = { latitude: number; longitude: number };

// Parse only an explicit coordinate pair or a pinned Google Maps URL. A map's
// @lat,lon camera centre and short links are not evidence of the venue's pin.
export function coordinatesFromInput(input: string): Coordinates | null {
  if (input.length > 4096) return null;
  let text = input.trim();
  if (/^https:\/\//i.test(text)) {
    let url: URL;
    try { url = new URL(text); } catch { return null; }
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !["google.com", "www.google.com", "maps.google.com"].includes(url.hostname)) return null;
    if (url.hostname !== "maps.google.com" && !/^\/maps(?:\/|$)/.test(url.pathname)) return null;
    const pins = [...url.pathname.matchAll(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g)];
    if (pins.length > 1) return null;
    const pin = url.pathname.startsWith("/maps/place/") ? pins[0] : undefined;
    text = pin ? `${pin[1]},${pin[2]}` : url.searchParams.get("query") ?? url.searchParams.get("q") ?? "";
  }
  const pair = text.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!pair) return null;
  const latitude = Number(pair[1]), longitude = Number(pair[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
    latitude < -85 || latitude > 85 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

export function mapsSearchUrl(query: string) {
  const url = new URL("https://www.google.com/maps/search/");
  url.search = new URLSearchParams({ api: "1", query }).toString();
  return url.toString();
}
