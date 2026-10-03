import { Suspense } from "react";
import { EventsBrowser } from "@/components/customer/events-browser";
export default function EventsPage() {
  return (
    <Suspense fallback={<p role="status">Loading events…</p>}>
      <EventsBrowser />
    </Suspense>
  );
}
