import type { NextRequest } from "next/server";
import { z } from "zod";
import { body, OperationError, reply } from "./http";
import { consumeAddressLookupBudget, consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { addressSuggestions } from "@/lib/venues/address-suggestions";

export async function placeOperation(request: NextRequest, parts: string[], actorId: string) {
  if (request.method !== "POST" || parts.length !== 2 || parts[1] !== "autocomplete")
    throw new OperationError(404, "Route not found.");
  const rate = await consumeRateLimit("places", actorId, { limit: 60, windowMs: 60000 });
  if (rate.limited) return rateLimitResponse(rate.retryAfterSec, "Too many address lookups.");
  const input = await body(request, z.object({
    input: z.string().trim().min(3).max(200),
    mode: z.enum(["address", "venue", "full"]).default("address"),
    // Accept cached clients' old session field; Geoapify does not need it.
    session_token: z.uuid().optional(),
  }).strict());
  const key = process.env.GEOAPIFY_API_KEY?.trim();
  if (!key) throw new OperationError(503,
    "Address suggestions are temporarily unavailable. You can enter a verified address and coordinates.");

  // Shared across owners and server instances; one call with no automatic retry.
  const budget = await consumeAddressLookupBudget();
  if (budget.limited) return rateLimitResponse(budget.retryAfterSec,
    "Address lookup limit reached. You can enter a verified address and coordinates.");
  try {
    const url = new URL(`https://api.geoapify.com/v1/geocode/${input.mode === "full" ? "search" : "autocomplete"}`);
    url.search = new URLSearchParams({ text: input.input, filter: "countrycode:ng",
      format: "json", limit: "10", lang: "en", apiKey: key }).toString();
    if (input.mode === "venue") url.searchParams.set("type", "amenity");
    const response = await fetch(url, {
      method: "GET", headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000), redirect: "error", credentials: "omit", cache: "no-store",
    });
    if (!response.ok) throw new Error("ADDRESS_PROVIDER_UNAVAILABLE");
    return reply({ suggestions: addressSuggestions(await response.json()) });
  } catch {
    // Provider bodies, URLs and errors can contain the key. Never log them.
    throw new OperationError(503,
      "Address lookup unavailable. Check the address and coordinates before saving.");
  }
}
