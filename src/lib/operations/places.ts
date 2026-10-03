import type { NextRequest } from "next/server";
import { z } from "zod";
import { body, OperationError, reply } from "./http";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit";
export async function placeOperation(
  request: NextRequest,
  parts: string[],
  actorId: string,
) {
  if (
    request.method !== "POST" ||
    parts.length !== 2 ||
    !["autocomplete", "details"].includes(parts[1])
  )
    throw new OperationError(404, "Route not found.");
  const rate = consumeRateLimit("places", actorId, {
    limit: 60,
    windowMs: 60000,
  });
  if (rate.limited)
    return rateLimitResponse(rate.retryAfterSec, "Too many address lookups.");
  const input = await body(
    request,
    z
      .object({
        input: z.string().trim().min(3).max(200).optional(),
        place_id: z
          .string()
          .regex(/^[\w-]{1,200}$/)
          .optional(),
        session_token: z.uuid(),
      })
      .strict(),
  );
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key)
    throw new OperationError(
      503,
      "Address suggestions await Google Places configuration. You can save a verified address and coordinates meanwhile.",
    );
  try {
    if (parts[1] === "autocomplete") {
      if (!input.input) throw new OperationError(400, "Search text required.");
      const r = await fetch(
        "https://places.googleapis.com/v1/places:autocomplete",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": key,
            "X-Goog-FieldMask":
              "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text",
          },
          body: JSON.stringify({
            input: input.input,
            sessionToken: input.session_token,
            includedRegionCodes: ["ng"],
          }),
          signal: AbortSignal.timeout(5000),
          redirect: "error",
        },
      );
      if (!r.ok) throw new Error();
      const data = await r.json();
      return reply({
        suggestions: (data.suggestions ?? [])
          .filter((s: any) => s.placePrediction?.placeId)
          .map((s: any) => ({
            place_id: s.placePrediction.placeId,
            label: s.placePrediction.text.text,
          })),
      });
    }
    if (!input.place_id) throw new OperationError(400, "Place ID required.");
    const r = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(input.place_id)}?sessionToken=${input.session_token}`,
      {
        headers: {
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": "id,formattedAddress,location,addressComponents",
        },
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      },
    );
    if (!r.ok) throw new Error();
    const data = await r.json();
    const part = (type: string) =>
      data.addressComponents?.find((c: any) => c.types.includes(type))
        ?.longText;
    return reply({
      google_place_id: data.id,
      address: data.formattedAddress,
      latitude: data.location?.latitude,
      longitude: data.location?.longitude,
      city: part("locality") ?? part("administrative_area_level_2") ?? "",
      state: part("administrative_area_level_1") ?? "",
      country: part("country") ?? "Nigeria",
    });
  } catch (error) {
    if (error instanceof OperationError) throw error;
    throw new OperationError(
      503,
      "Address lookup unavailable. Check the address and coordinates before saving.",
    );
  }
}
