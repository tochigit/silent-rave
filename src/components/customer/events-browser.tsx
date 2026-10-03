"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { EventCard } from "./event-card";
import type { CatalogEvent } from "@/lib/customer/types";
import { lagosDay } from "@/lib/customer/format";
type Listing = {
  events: CatalogEvent[];
  pagination: { page: number; total_pages: number; total_events: number };
};
export function EventsBrowser() {
  const params = useSearchParams();
  const view = params.get("view") ?? "list";
  const date =
    params.get("date") ??
    (view === "month"
      ? lagosDay(new Date()).slice(0, 7)
      : view === "day"
        ? lagosDay(new Date())
        : "");
  const [data, setData] = useState<Listing | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [formView, setFormView] = useState(view);
  const [formDate, setFormDate] = useState(date);
  useEffect(() => {
    queueMicrotask(() => {
      setFormView(view);
      setFormDate(date);
    });
  }, [view, date]);
  const query = params.toString();
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    queueMicrotask(() => {
      if (active) {
        setData(null);
        setError("");
      }
    });
    fetch(`/api/events?${query}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error);
        return r.json();
      })
      .then((value) => {
        if (active) setData(value);
      })
      .catch((e) => {
        if (active && e.name !== "AbortError")
          setError(e.message || "Events are temporarily unavailable.");
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [query, retry]);
  function pageLink(page: number) {
    const next = new URLSearchParams(query);
    next.set("page", String(page));
    return `/events?${next}`;
  }
  const month = date.slice(0, 7);
  const monthStart = new Date(`${month}-01T00:00:00+01:00`);
  const days = Number.isFinite(monthStart.getTime())
    ? new Date(
        Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
      ).getUTCDate()
    : 0;
  const leading = days ? new Date(`${month}-01T12:00:00Z`).getUTCDay() : 0;
  return (
    <section className="stack">
      <div className="page-heading">
        <p className="eyebrow">FIND YOUR FREQUENCY</p>
        <h1>
          Upcoming nights
          <br />
          <span>and good company.</span>
        </h1>
        <p className="muted">
          All event times are in Africa/Lagos (WAT, UTC+1).
        </p>
      </div>
      <form action="/events" className="filters">
        <label>
          Search events
          <input
            name="search"
            defaultValue={params.get("search") ?? ""}
            maxLength={100}
            placeholder="Event or venue"
          />
        </label>
        <label>
          City
          <input
            name="city"
            defaultValue={params.get("city") ?? ""}
            maxLength={100}
            placeholder="Any city"
          />
        </label>
        <label>
          View
          <select
            name="view"
            value={formView}
            onChange={(e) => {
              const next = e.target.value;
              setFormView(next);
              setFormDate(
                next === "month"
                  ? (formDate || lagosDay(new Date())).slice(0, 7)
                  : formDate.length === 7
                    ? formDate + "-01"
                    : formDate,
              );
            }}
          >
            <option value="list">List</option>
            <option value="month">Month</option>
            <option value="day">Day</option>
          </select>
        </label>
        <label>
          Date
          <input
            name="date"
            type={formView === "month" ? "month" : "date"}
            value={formDate}
            onChange={(e) => setFormDate(e.target.value)}
          />
        </label>
        {params.get("filter") === "upcoming" && (
          <input name="filter" type="hidden" value="upcoming" />
        )}
        <button type="submit" className="button">
          Show events
        </button>
        <Link href="/events">Reset filters</Link>
      </form>
      {error ? (
        <div className="panel" role="alert">
          <p>{error}</p>
          <button onClick={() => setRetry((n) => n + 1)}>Retry events</button>
        </div>
      ) : !data ? (
        <div className="panel skeleton" role="status">
          Loading events…
        </div>
      ) : !data.events.length ? (
        <div className="panel empty">
          <h2>No events to show</h2>
          <p>
            {params.get("filter") === "upcoming"
              ? "No upcoming events — check back soon."
              : "Try another date or search. New nights will appear here when published."}
          </p>
          <Link href="/events">See all events</Link>
        </div>
      ) : (
        <>
          {view === "month" ? (
            <section
              aria-label="Month calendar in Lagos time"
              className="stack"
            >
              <h2>
                {new Intl.DateTimeFormat("en-NG", {
                  month: "long",
                  year: "numeric",
                  timeZone: "Africa/Lagos",
                }).format(monthStart)}
              </h2>
              <p className="muted">
                Calendar shows the events on this results page. Choose a day to
                see its events.
              </p>
              <div className="month-calendar">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                  (day) => (
                    <div key={day} className="weekday">
                      {day}
                    </div>
                  ),
                )}
                {Array.from({ length: leading }, (_, i) => (
                  <div key={`blank-${i}`} aria-hidden="true" />
                ))}
                {Array.from({ length: days }, (_, i) => {
                  const day = `${month}-${String(i + 1).padStart(2, "0")}`;
                  const start = new Date(`${day}T00:00:00+01:00`).getTime();
                  const events = data.events.filter(
                    (e) =>
                      e.starts_at &&
                      e.ends_at &&
                      new Date(e.starts_at).getTime() < start + 86400000 &&
                      new Date(e.ends_at).getTime() > start,
                  );
                  const next = new URLSearchParams(query);
                  next.set("view", "day");
                  next.set("date", day);
                  next.delete("page");
                  return (
                    <div className="calendar-day" key={day}>
                      <Link
                        className="calendar-date"
                        aria-label={`View events on ${day}`}
                        href={`/events?${next}`}
                      >
                        {i + 1}
                      </Link>
                      {events.map((e) => (
                        <Link
                          className="calendar-event"
                          key={e.id}
                          href={`/event/${encodeURIComponent(e.slug)}`}
                        >
                          {e.title}
                        </Link>
                      ))}
                    </div>
                  );
                })}
              </div>
            </section>
          ) : (
            <div className="event-grid">
              {data.events.map((e) => (
                <EventCard key={e.id} event={e} />
              ))}
            </div>
          )}
          <nav className="pagination" aria-label="Event pages">
            {data.pagination.page > 1 && (
              <Link
                className="secondary"
                href={pageLink(data.pagination.page - 1)}
              >
                Previous page
              </Link>
            )}
            <span>
              Page {data.pagination.page} of {data.pagination.total_pages}
            </span>
            {data.pagination.page < data.pagination.total_pages && (
              <Link
                className="secondary"
                href={pageLink(data.pagination.page + 1)}
              >
                Next page
              </Link>
            )}
          </nav>
        </>
      )}
    </section>
  );
}
