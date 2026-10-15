"use client";
import { useId, useRef, useState } from "react";
import type { AddressSuggestion } from "@/lib/venues/address-suggestions";
import { coordinatesFromInput, mapsSearchUrl } from "@/lib/venues/coordinate-input";
import { venueMapEmbedUrl } from "@/lib/venues/map";

function fillFields(form: HTMLFormElement, values: Record<string, string | number>) {
  for (const [name, value] of Object.entries(values)) {
    const field = form.elements.namedItem(name);
    if (field instanceof HTMLInputElement) field.value = String(value);
  }
}

export function PlaceInput() {
  const id = useId();
  const pending = useRef(false);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState("address");
  const [coordinateInput, setCoordinateInput] = useState("");
  const [map, setMap] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [attribution, setAttribution] = useState(false);
  function applyCoordinates(form: HTMLFormElement | null) {
    const coordinates = coordinatesFromInput(coordinateInput);
    if (!coordinates) {
      setMessage("Paste two coordinates (latitude, longitude) or a full Maps link containing the pin coordinates. Short links and short Plus Codes such as CV67+5VV need a location reference; open them in Maps and copy the coordinates.");
      return;
    }
    if (!form) return;
    fillFields(form, { ...coordinates, google_place_id: "", google_maps_url: "" });
    setSuggestions([]); setMap(venueMapEmbedUrl(coordinates));
    setMessage("Exact map coordinates filled. Enter or check the venue’s address, city and state below, then save.");
  }
  async function findAddress() {
    if (pending.current) return;
    const query = input.trim();
    setSuggestions([]);
    if (query.length < 3) { setMessage("Enter at least 3 characters to find an address."); return; }
    pending.current = true;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/places/autocomplete", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: query, mode }), signal: AbortSignal.timeout(15000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Address lookup unavailable.");
      if (!Array.isArray(data.suggestions) || data.suggestions.length > 10)
        throw new Error("Address lookup unavailable.");
      const rows: AddressSuggestion[] = data.suggestions;
      setSuggestions(rows); setAttribution((shown) => shown || rows.length > 0);
      setMessage(rows.length
        ? `${rows.length} result${rows.length === 1 ? "" : "s"}. City and state results are area centres; choose the actual venue for an accurate pin.`
        : "No address found in this search index. Try the venue name with its town or use the map option below.");
    } catch (error) {
      setMessage(error instanceof Error && error.name === "Error"
        ? error.message : "Address lookup unavailable. You can enter the address and coordinates manually.");
    } finally { pending.current = false; setBusy(false); }
  }
  return (
    <div className="venue-lookup">
      <label htmlFor={`${id}-search`}>Find a venue address</label>
      <input id={`${id}-search`} type="search" maxLength={200} value={input}
        onChange={(event) => { setInput(event.target.value); setSuggestions([]); setMessage(""); }}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void findAddress(); } }}
        placeholder="Venue name + town, or street + city" disabled={busy} aria-describedby={`${id}-hint`} />
      <p id={`${id}-hint`}>Use a specific place, for example “Eko Hotel, Victoria Island, Lagos”.
        Searching only “Lagos” usually finds the city or state. Some venues are missing from the free search index.</p>
      <label htmlFor={`${id}-mode`}>Search for</label>
      <select id={`${id}-mode`} value={mode} disabled={busy}
        onChange={(event) => { setMode(event.target.value); setSuggestions([]); setMessage(""); }}>
        <option value="address">Streets, areas and cities</option>
        <option value="venue">Venues and landmarks</option>
        <option value="full">Full street address</option>
      </select>
      <button type="button" className="secondary" disabled={busy} onClick={() => void findAddress()}>
        {busy ? "Finding address…" : "Find address"}
      </button>
      {suggestions.length > 0 && <div aria-label="Address suggestions">
        {suggestions.map((suggestion, index) => <button key={`${suggestion.latitude}:${suggestion.longitude}:${index}`}
          type="button" className="secondary" onClick={(event) => {
            const form = event.currentTarget.closest("form");
            if (!form) return;
            fillFields(form, { address: suggestion.address, latitude: suggestion.latitude,
              longitude: suggestion.longitude, city: suggestion.city, state: suggestion.state,
              country: suggestion.country, google_place_id: "", google_maps_url: "" });
            setSuggestions([]); setMap(venueMapEmbedUrl(suggestion));
            setMessage("Address and map coordinates filled. Check the pin and address before saving.");
          }}><span>{suggestion.label}</span><small>{suggestion.kind}</small></button>)}
      </div>}
      {attribution && <p>Powered by <a href="https://www.geoapify.com/">Geoapify</a> ·
        {" "}<a href="https://www.geoapify.com/credits/">Data attribution</a></p>}
      <p role="status">{message}</p>
      <details>
        <summary>Can’t find the venue? Use an exact map pin</summary>
        <p>Open the place in Google Maps, find its exact pin, then right-click that spot on a computer
          (or hold it on a phone). Copy the two coordinates, such as “6.430000, 3.420000”, and paste them below.
          This opens the free Maps website and needs no API key or billing account.</p>
        {input.trim().length >= 3 && <p><a href={mapsSearchUrl(input.trim())} target="_blank" rel="noopener noreferrer">
          Search this place on Google Maps</a></p>}
        <label htmlFor={`${id}-coordinates`}>Exact coordinates or pinned Google Maps link</label>
        <input id={`${id}-coordinates`} type="text" value={coordinateInput} maxLength={4096}
          onKeyDown={(event) => { if (event.key === "Enter") {
            event.preventDefault(); applyCoordinates(event.currentTarget.closest("form"));
          } }}
          onChange={(event) => setCoordinateInput(event.target.value)} placeholder="Latitude, longitude" />
        <button type="button" className="secondary" onClick={(event) => applyCoordinates(event.currentTarget.closest("form"))}>
          Use these coordinates</button>
      </details>
      {map && <div><p>Check that this pin marks the venue’s entrance.</p>
        <iframe title="Selected venue map" src={map} loading="lazy" referrerPolicy="no-referrer"
          style={{ width: "100%", height: 260, border: 0 }} />
      </div>}
    </div>
  );
}
