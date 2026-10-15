import { useState } from "react";
import { createRoot } from "react-dom/client";
import { PlaceInput } from "../../src/components/operations/place-input";
import { OwnerPanel } from "../../src/components/operations/owner";

function VenueForm() {
  const [saved, setSaved] = useState("");
  return <main><h1>Venue address acceptance</h1><form onSubmit={(event) => {
    event.preventDefault(); setSaved(JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))));
  }}><PlaceInput />
    {Object.entries({ address: "Previous address", latitude: "1", longitude: "2", city: "Previous city",
      state: "Previous state", country: "Nigeria", google_place_id: "ChIJprevious", google_maps_url: "https://www.google.com/maps/previous" })
      .map(([name, value]) => name === "google_place_id"
        ? <input key={name} type="hidden" name={name} defaultValue={value} />
        : <label key={name}>{name}<input name={name} defaultValue={value} /></label>)}
    <button type="submit">Save venue</button>
  </form><pre id="saved-values">{saved}</pre></main>;
}
createRoot(document.getElementById("root")!).render(window.location.pathname === "/owner"
  ? <OwnerPanel section={["venues"]} /> : <div className="operations-site"><VenueForm /></div>);
