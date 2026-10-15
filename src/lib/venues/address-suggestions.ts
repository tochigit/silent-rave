import { z } from "zod";

export type AddressSuggestion = {
  label: string; address: string; latitude: number; longitude: number;
  city: string; state: string; country: string;
};
const resultSchema = z.object({
  formatted: z.string().trim().min(1).max(200),
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
  country_code: z.string(),
  city: z.string().max(200).optional(),
  town: z.string().max(200).optional(),
  county: z.string().max(200).optional(),
  state: z.string().max(200).optional(),
  country: z.string().max(200).optional(),
});
export function addressSuggestions(data: unknown): AddressSuggestion[] {
  const payload = z.object({ results: z.array(z.unknown()).max(100) }).parse(data);
  return payload.results.flatMap((item) => {
    const parsed = resultSchema.safeParse(item);
    if (!parsed.success || parsed.data.country_code.toLowerCase() !== "ng") return [];
    const row = parsed.data;
    return [{ label: row.formatted, address: row.formatted,
      latitude: row.lat, longitude: row.lon,
      city: row.city ?? row.town ?? row.county ?? "",
      state: row.state ?? "", country: row.country ?? "Nigeria" }];
  }).slice(0, 5);
}
