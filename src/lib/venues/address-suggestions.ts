import { z } from "zod";

export type AddressSuggestion = {
  label: string; address: string; latitude: number; longitude: number;
  city: string; state: string; country: string;
  kind: string;
};
const resultSchema = z.object({
  formatted: z.string().trim().min(1).max(200),
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
  country_code: z.string(),
  name: z.string().trim().max(200).optional(),
  result_type: z.string().max(100).optional(),
  city: z.string().max(200).optional(),
  town: z.string().max(200).optional(),
  county: z.string().max(200).optional(),
  state: z.string().max(200).optional(),
  country: z.string().max(200).optional(),
});
export function addressSuggestions(data: unknown): AddressSuggestion[] {
  const payload = z.object({ results: z.array(z.unknown()).max(100) }).parse(data);
  const seen = new Set<string>();
  return payload.results.flatMap((item) => {
    const parsed = resultSchema.safeParse(item);
    if (!parsed.success || parsed.data.country_code.toLowerCase() !== "ng") return [];
    const row = parsed.data;
    const identity = `${row.lat.toFixed(5)}:${row.lon.toFixed(5)}:${row.formatted.toLowerCase()}:${row.name?.toLowerCase() ?? ""}`;
    if (seen.has(identity)) return [];
    seen.add(identity);
    const kinds: Record<string, string> = { amenity: "Venue or landmark", building: "Building",
      city: "City or town", state: "State", county: "Local government area", suburb: "Neighbourhood",
      district: "District", street: "Street", postcode: "Postcode" };
    const name = row.name && !row.formatted.toLowerCase().includes(row.name.toLowerCase()) ? row.name : "";
    return [{ label: name ? `${name} — ${row.formatted}` : row.formatted, address: row.formatted,
      latitude: row.lat, longitude: row.lon,
      city: row.city ?? row.town ?? row.county ?? "",
      state: row.state ?? "", country: row.country ?? "Nigeria",
      kind: kinds[row.result_type ?? ""] ?? "Address or place" }];
  }).slice(0, 10);
}
