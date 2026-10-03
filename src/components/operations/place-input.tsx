"use client";
import { useState } from "react";
export function PlaceInput() {
  const [suggestions, setSuggestions] = useState<
      { place_id: string; label: string }[]
    >([]),
    [message, setMessage] = useState("");
  const [token] = useState(() => crypto.randomUUID());
  async function request(kind: string, input: unknown) {
    const r = await fetch(`/api/admin/places/${kind}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...(input as object), session_token: token }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    return data;
  }
  return (
    <div>
      <label>
        Find a venue address
        <input
          type="search"
          id="place-search"
          placeholder="Venue or address in Nigeria"
        />
      </label>
      <button
        type="button"
        className="secondary"
        onClick={async () => {
          try {
            const text = (
              document.getElementById("place-search") as HTMLInputElement
            ).value;
            const result = await request("autocomplete", { input: text });
            setSuggestions(result.suggestions);
            setMessage("");
          } catch (e) {
            setMessage((e as Error).message);
          }
        }}
      >
        Find address
      </button>
      {suggestions.length > 0 && (
        <div aria-label="Address suggestions">
          {suggestions.map((s) => (
            <button
              key={s.place_id}
              type="button"
              className="secondary"
              onClick={async (e) => {
                const form = e.currentTarget.closest("form")!;
                try {
                  const details = await request("details", {
                    place_id: s.place_id,
                  });
                  for (const [name, value] of Object.entries(details)) {
                    const field = form.elements.namedItem(
                      name,
                    ) as HTMLInputElement;
                    if (field) field.value = String(value ?? "");
                  }
                  setSuggestions([]);
                  setMessage(
                    "Address and map coordinates filled. Check them before saving.",
                  );
                } catch (error) {
                  setMessage((error as Error).message);
                }
              }}
            >
              {s.label}
            </button>
          ))}
          <p>Google Maps</p>
        </div>
      )}
      <p role="status">{message}</p>
    </div>
  );
}
