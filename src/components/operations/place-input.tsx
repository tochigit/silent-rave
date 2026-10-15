"use client";
import { useId, useRef, useState } from "react";
import type { AddressSuggestion } from "@/lib/venues/address-suggestions";

export function PlaceInput() {
  const searchId = useId();
  const search = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [attribution, setAttribution] = useState(false);
  return (
    <div>
      <label htmlFor={searchId}>Find a venue address</label>
      <input ref={search} id={searchId} type="search" maxLength={200}
        placeholder="Venue or address in Nigeria" disabled={busy} />
      <button type="button" className="secondary" disabled={busy} onClick={async () => {
        if (pending.current) return;
        const input = search.current?.value.trim() ?? "";
        setSuggestions([]);
        if (input.length < 3) { setMessage("Enter at least 3 characters to find an address."); return; }
        pending.current = true;
        setBusy(true); setMessage("");
        try {
          const response = await fetch("/api/admin/places/autocomplete", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ input }), signal: AbortSignal.timeout(15000),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? "Address lookup unavailable.");
          if (!Array.isArray(data.suggestions) || data.suggestions.length > 5)
            throw new Error("Address lookup unavailable.");
          const rows: AddressSuggestion[] = data.suggestions;
          setSuggestions(rows); setAttribution((shown) => shown || rows.length > 0);
          if (!rows.length) setMessage("No address found. Try a street and city, or enter the address and coordinates manually.");
        } catch (error) {
          setMessage(error instanceof Error && error.name === "Error"
            ? error.message : "Address lookup unavailable. You can enter the address and coordinates manually.");
        } finally { pending.current = false; setBusy(false); }
      }}>{busy ? "Finding address…" : "Find address"}</button>
      {suggestions.length > 0 && <div aria-label="Address suggestions">
        {suggestions.map((suggestion, index) => <button key={`${suggestion.latitude}:${suggestion.longitude}:${index}`}
          type="button" className="secondary" onClick={(event) => {
            const form = event.currentTarget.closest("form");
            if (!form) return;
            // Never put a Geoapify ID into the legacy Google Place ID field.
            const fields = { address: suggestion.address, latitude: suggestion.latitude,
              longitude: suggestion.longitude, city: suggestion.city, state: suggestion.state,
              country: suggestion.country, google_place_id: "", google_maps_url: "" };
            for (const [name, value] of Object.entries(fields)) {
              const field = form.elements.namedItem(name);
              if (field instanceof HTMLInputElement) field.value = String(value);
            }
            setSuggestions([]);
            setMessage("Address and map coordinates filled. Check them before saving.");
          }}>{suggestion.label}</button>)}
      </div>}
      {attribution && <p>Powered by <a href="https://www.geoapify.com/">Geoapify</a> ·
        {" "}<a href="https://www.geoapify.com/credits/">Data attribution</a></p>}
      <p role="status">{message}</p>
    </div>
  );
}
