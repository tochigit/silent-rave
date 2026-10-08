"use client";
import { useEffect, useState } from "react";
import { usePoll } from "@/components/customer/use-poll";
import { LogoutButton } from "@/components/auth/logout-button";
import { PlaceInput } from "./place-input";
import { BannerUpload } from "./banner-upload";

type Field = {
  key: string;
  label: string;
  type?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
};
const money = (kobo: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(
    kobo / 100,
  );
const when = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("en-NG", { timeZone: "Africa/Lagos" })
    : "—";
async function change(url: string, data?: unknown, method = "POST") {
  const r = await fetch(url, {
    method,
    headers:
      data instanceof FormData ? {} : { "content-type": "application/json" },
    body:
      data instanceof FormData ? data : data ? JSON.stringify(data) : undefined,
  });
  const result = await r.json();
  if (!r.ok) throw new Error(result.error ?? "Request failed.");
  return result;
}
function Editor({
  fields,
  initial = {},
  onSave,
  title,
  onClose,
}: {
  fields: Field[];
  initial?: Record<string, any>;
  onSave: (data: Record<string, any>) => Promise<void>;
  title: string;
  onClose?: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="op-card">
      <h2>{title}</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          const result: Record<string, any> = {};
          for (const f of fields) {
            const value = data.get(f.key);
            result[f.key] =
              f.type === "checkbox"
                ? value === "on"
                : f.type === "number"
                  ? value === "" && !f.required
                    ? null
                    : Number(value)
                  : f.type === "datetime-local"
                    ? value
                      ? new Date(
                          `${String(value).slice(0, 16)}:00+01:00`,
                        ).toISOString()
                      : null
                    : value || (f.required ? "" : null);
          }
          setBusy(true);
          setError("");
          try {
            await onSave(result);
            onClose?.();
          } catch (error) {
            setError((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {fields.some((f) => f.key === "google_place_id") && <PlaceInput />}
        <div className="op-form-grid">
          {fields.map((f) => (
            <label key={f.key}>
              {f.label}
              {f.type === "textarea" ? (
                <textarea
                  name={f.key}
                  defaultValue={initial[f.key] ?? ""}
                  required={f.required}
                />
              ) : f.options ? (
                <select
                  name={f.key}
                  defaultValue={initial[f.key] ?? ""}
                  required={f.required}
                >
                  <option value="">Choose…</option>
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  name={f.key}
                  type={f.type ?? "text"}
                  required={f.required}
                  min={
                    f.type === "number" &&
                    !["latitude", "longitude"].includes(f.key)
                      ? 0
                      : undefined
                  }
                  step={
                    f.type === "number" &&
                    ["latitude", "longitude"].includes(f.key)
                      ? "any"
                      : undefined
                  }
                  defaultChecked={
                    f.type === "checkbox" ? !!initial[f.key] : undefined
                  }
                  defaultValue={
                    f.type === "checkbox"
                      ? undefined
                      : f.type === "datetime-local" && initial[f.key]
                        ? new Date(new Date(initial[f.key]).getTime() + 3600000)
                            .toISOString()
                            .slice(0, 16)
                        : (initial[f.key] ?? "")
                  }
                  autoComplete={
                    f.type === "password" ? "new-password" : undefined
                  }
                />
              )}
            </label>
          ))}
        </div>
        <p>
          Times use Africa/Lagos. Prices are entered in kobo (₦1 = 100 kobo).
        </p>
        <div className="op-actions">
          <button disabled={busy}>{busy ? "Saving…" : "Save"}</button>
          {onClose && (
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
          )}
        </div>
        <p role="alert">{error}</p>
      </form>
    </section>
  );
}
const required = (key: string, label: string, type?: string): Field => ({
  key,
  label,
  type,
  required: true,
});
const nav = [
  ["payments", "Payment review"],
  ["orders", "Orders"],
  ["events", "Events & tiers"],
  ["venues", "Venues"],
  ["organizers", "Organizers"],
  ["pages", "About & Contact"],
  ["payment-accounts", "Bank accounts"],
  ["staff", "Staff accounts"],
  ["reconciliation", "Reconciliation"],
  ["email-jobs", "Email delivery"],
  ["audit-log", "Audit & scans"],
];

export function OwnerPanel({ section = ["payments"] }: { section?: string[] }) {
  const resource = section[0],
    id = section[1];
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Record<string, any> | null>(null);
  const [message, setMessage] = useState("");
  const poll = usePoll<any>(
    `/api/admin/${resource}${id ? `/${id}` : ""}${query}`,
    { interval: 12000 },
  );
  const auxiliary = usePoll<any>("/api/admin/organizers", {
    interval: 60000,
    enabled: resource === "events" || resource === "pages",
  });
  const venues = usePoll<any>("/api/admin/venues", {
    interval: 60000,
    enabled: resource === "events",
  });
  const events = usePoll<any>("/api/admin/events", {
    interval: 60000,
    enabled: !id && ["orders", "reconciliation"].includes(resource),
  });
  const notify = usePoll<any>("/api/admin/push/status", { interval: 60000 });
  const [notificationError, setNotificationError] = useState("");
  async function run(work: () => Promise<unknown>) {
    setMessage("");
    try {
      await work();
      setMessage("Saved.");
      poll.refresh();
      auxiliary.refresh();
      events.refresh();
      venues.refresh();
    } catch (error) {
      setMessage((error as Error).message);
    }
  }
  const options = (rows: any[] = []) =>
    rows.map((r) => ({ value: r.id, label: r.name ?? r.title }));
  let fields: Field[] = [],
    rows: any[] = [],
    key = resource;
  if (resource === "events") {
    fields = [
      required("slug", "Event URL slug"),
      required("title", "Event title"),
      required("description", "Description", "textarea"),
      {
        ...required("organizer_id", "Organizer"),
        options: options(auxiliary.data?.organizers),
      },
      {
        ...required("venue_id", "Venue"),
        options: options(venues.data?.venues),
      },
      required("starts_at", "Start (Lagos)", "datetime-local"),
      required("ends_at", "End (Lagos)", "datetime-local"),
      { key: "is_date_confirmed", label: "Date confirmed", type: "checkbox" },
      {
        key: "status",
        label: "Status",
        options: optionsStatus(["DRAFT", "PUBLISHED", "CANCELLED"]),
        required: true,
      },
    ];
    rows = id
      ? poll.data?.event
        ? [poll.data.event]
        : []
      : (poll.data?.events ?? []);
  }
  if (resource === "venues") {
    fields = [
      required("name", "Venue name"),
      required("address", "Address"),
      required("city", "City"),
      { key: "state", label: "State" },
      required("country", "Country"),
      { key: "google_place_id", label: "Google Place ID" },
      { key: "latitude", label: "Latitude", type: "number" },
      { key: "longitude", label: "Longitude", type: "number" },
      { key: "google_maps_url", label: "Directions fallback URL", type: "url" },
    ];
    rows = poll.data?.venues ?? [];
  }
  if (resource === "organizers") {
    fields = [
      required("name", "Organizer name"),
      { key: "description", label: "Description", type: "textarea" },
      { key: "contact_email", label: "Contact email", type: "email" },
    ];
    rows = poll.data?.organizers ?? [];
  }
  if (resource === "staff") {
    fields = [
      required("name", "Staff name"),
      required("email", "Email", "email"),
      required(
        "temporary_password",
        "Temporary password (12–72 characters)",
        "password",
      ),
    ];
    rows = poll.data?.staff ?? [];
  }
  if (resource === "pages") {
    fields = [
      required("title", "Page title"),
      { key: "body", label: "Page content", type: "textarea" },
      { key: "is_published", label: "Published", type: "checkbox" },
      {
        key: "contact_organizer_id",
        label: "Contact recipient organizer",
        options: options(auxiliary.data?.organizers),
      },
    ];
    rows = ["about", "contact"].map(
      (slug) =>
        poll.data?.pages?.find((p: any) => p.slug === slug) ?? {
          slug,
          title: slug === "about" ? "About" : "Contact",
          body: "",
          isPublished: false,
        },
    );
  }
  if (resource === "payment-accounts") {
    fields = [
      required("bank_name", "Bank"),
      required("account_number", "Account number"),
      required("account_name", "Account name"),
      { key: "is_active", label: "Active for new checkouts", type: "checkbox" },
      required("password", "Re-enter your password", "password"),
    ];
    rows = poll.data?.accounts ?? [];
  }
  if (["orders", "reconciliation"].includes(resource) && !id)
    rows = poll.data?.orders ?? [];
  if (resource === "payments") rows = poll.data?.queue ?? [];
  if (resource === "email-jobs")
    rows = poll.data?.jobs ?? poll.data?.email_jobs ?? [];
  if (resource === "audit-log") rows = poll.data?.entries ?? [];
  function editRow(row: any) {
    const values: any = { ...row };
    for (const [snake, camel] of [
      ["organizer_id", "organizerId"],
      ["venue_id", "venueId"],
      ["starts_at", "startsAt"],
      ["ends_at", "endsAt"],
      ["is_date_confirmed", "isDateConfirmed"],
      ["contact_email", "contactEmail"],
      ["google_place_id", "googlePlaceId"],
      ["google_maps_url", "googleMapsUrl"],
      ["is_published", "isPublished"],
      ["contact_organizer_id", "contactOrganizerId"],
    ])
      if (row[camel] !== undefined) values[snake] = row[camel];
    setEditing(values);
  }
  return (
    <div className="operations-site">
      <a className="op-skip" href="#owner-main">
        Skip to owner workspace
      </a>
      <header className="op-header">
        <a href="/admin" className="brand">
          SILENT RAVE <small>Owner</small>
        </a>
        <LogoutButton loginPath="/admin/login" />
      </header>
      <div className="op-layout">
        <nav aria-label="Owner operations">
          {nav.map(([path, label]) => (
            <a
              key={path}
              href={`/admin/${path}`}
              aria-current={resource === path ? "page" : undefined}
            >
              {label}
            </a>
          ))}
          <a
            href="/staff"
            onClick={(event) => {
              event.preventDefault();
              const target = new URL(window.location.href);
              target.hostname = `staff.${target.hostname.replace(/^admin\./, "")}`;
              target.pathname = "/staff";
              target.search = "";
              target.hash = "";
              window.location.assign(target.href);
            }}
          >
            Open staff tools
          </a>
        </nav>
        <main id="owner-main" tabIndex={-1}>
          <p className="eyebrow">Owner operations</p>
          <h1>
            {id && resource === "orders"
              ? "Review order"
              : (nav.find((n) => n[0] === resource)?.[1] ?? "Owner dashboard")}
          </h1>
          {notify.data && !notify.data.active && (
            <aside className="op-notice">
              Payment alerts are off. The queue refreshes every 12 seconds while
              visible. On iPhone, add the owner site to your Home Screen to
              enable push.
              <button
                disabled={!notify.data.configured}
                onClick={async () => {
                  try {
                    if (!navigator.serviceWorker || !("PushManager" in window))
                      throw new Error("Push is unavailable in this browser.");
                    const permission = await Notification.requestPermission();
                    if (permission !== "granted")
                      throw new Error(
                        "Notification permission was not granted.",
                      );
                    const registration =
                      await navigator.serviceWorker.register("/owner-sw.js");
                    const ready = await navigator.serviceWorker.ready;
                    const subscription = await ready.pushManager.subscribe({
                      userVisibleOnly: true,
                      applicationServerKey: notify.data.public_key,
                    });
                    await change(
                      "/api/admin/push/subscribe",
                      subscription.toJSON(),
                    );
                    notify.refresh();
                  } catch (error) {
                    setNotificationError((error as Error).message);
                  }
                }}
              >
                Enable alerts
              </button>
              {!notify.data.configured && (
                <p>Push is awaiting launch configuration.</p>
              )}
              <p role="alert">{notificationError}</p>
            </aside>
          )}
          {(message || poll.error || poll.notFound) && (
            <p role="alert" className="op-notice">
              {message || poll.error || "This page is unavailable."}
            </p>
          )}
          {!poll.data && !poll.notFound && <p role="status">Loading…</p>}
          {[
            "payments",
            "orders",
            "reconciliation",
            "email-jobs",
            "audit-log",
          ].includes(resource) &&
            !id && (
              <form
                className="op-filter"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget),
                    q = new URLSearchParams();
                  for (const [k, v] of f) if (v) q.set(k, String(v));
                  setQuery("?" + q);
                }}
              >
                {["payments", "orders"].includes(resource) && (
                  <label>
                    Search
                    <input
                      name="search"
                      placeholder="Order code, email, phone or reference"
                    />
                  </label>
                )}
                {resource !== "payments" &&
                  resource !== "email-jobs" &&
                  resource !== "audit-log" && (
                    <label>
                      Event
                      <select name="event_id">
                        <option value="">All events</option>
                        {options(events.data?.events).map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                {["payments", "orders", "email-jobs"].includes(resource) && (
                  <label>
                    Status
                    <select name="status">
                      <option value="">All</option>
                      {optionsStatus(
                        resource === "payments"
                          ? [
                              "PROOF_SUBMITTED",
                              "NEEDS_RESUBMIT",
                              "EXPIRED_HAD_PROOF",
                            ]
                          : resource === "email-jobs"
                            ? [
                                "QUEUED",
                                "SENT",
                                "DELIVERED",
                                "BOUNCED",
                                "FAILED",
                              ]
                            : [
                                "AWAITING_PAYMENT",
                                "PROOF_SUBMITTED",
                                "NEEDS_RESUBMIT",
                                "APPROVED",
                                "EXPIRED",
                                "REJECTED",
                                "REFUNDED",
                              ],
                      ).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {["orders", "reconciliation"].includes(resource) && (
                  <>
                    <label>
                      Source
                      <select name="source">
                        <option value="">All</option>
                        {optionsStatus(["ONLINE", "CASH", "COMP"]).map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Date (Lagos)
                      <input name="date" type="date" />
                    </label>
                  </>
                )}
                {resource === "audit-log" && (
                  <>
                    <label>
                      Action
                      <input name="action" />
                    </label>
                    <label>
                      Actor ID
                      <input name="actor" />
                    </label>
                    <label>
                      Entity ID
                      <input name="entity" />
                    </label>
                  </>
                )}
                <button>Apply filters</button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setQuery("")}
                >
                  Clear filters
                </button>
              </form>
            )}
          {resource === "reconciliation" && (
            <section className="op-card">
              <h2>Approved orders</h2>
              <p>
                {poll.data?.total ?? 0} orders ·{" "}
                {money(poll.data?.total_kobo ?? 0)}
              </p>
              <a
                className="op-button"
                href={`/api/admin/reconciliation${query || "?"}${query ? "&" : ""}format=csv`}
              >
                Download CSV
              </a>
              <p>
                Return money in your bank app; recording a refund here does not
                move funds.
              </p>
            </section>
          )}
          {resource === "orders" && !id && (
            <IssueForm
              events={events.data?.events ?? []}
              onDone={() => poll.refresh()}
            />
          )}
          {fields.length > 0 && resource !== "pages" && !editing && (
            <button
              onClick={() =>
                setEditing(
                  resource === "events"
                    ? { status: "DRAFT" }
                    : resource === "venues"
                      ? { country: "Nigeria" }
                      : {},
                )
              }
            >
              Create{" "}
              {resource === "payment-accounts"
                ? "bank account"
                : resource.replace(/s$/, "")}
            </button>
          )}
          {editing && (
            <Editor
              key={editing.id ?? editing.slug ?? "new"}
              title={`${editing.id || editing.slug ? "Edit" : "Create"} ${key}`}
              fields={fields}
              initial={editing}
              onClose={() => setEditing(null)}
              onSave={async (input) => {
                await change(
                  `/api/admin/${resource}${editing.id ? `/${editing.id}` : editing.slug ? `/${editing.slug}` : ""}`,
                  input,
                  editing.id || editing.slug ? "PATCH" : "POST",
                );
                poll.refresh();
              }}
            />
          )}
          {id && resource === "orders" && poll.data && (
            <OrderReview order={poll.data} refresh={poll.refresh} />
          )}
          <div className="op-records">
            {rows.map((row, index) => (
              <article
                className="op-card"
                key={row.id ?? row.order_id ?? row.slug ?? index}
              >
                <h2>
                  {row.title ??
                    row.name ??
                    row.order_code ??
                    row.orderCode ??
                    row.slug ??
                    row.action ??
                    row.kind ??
                    "Record"}
                </h2>
                {resource === "payments" && (
                  <>
                    <p>
                      {row.buyer.name} · {money(row.expected_amount_kobo)} ·{" "}
                      {row.bucket.replaceAll("_", " ")}
                    </p>
                    <p>
                      {row.line_items
                        .map((l: any) => `${l.quantity} × ${l.tier_name}`)
                        .join(", ")}
                    </p>
                    <p>
                      {row.transfer_reference} · {row.sender_name}
                    </p>
                    <p>
                      Submitted {when(row.submitted_at)} · Attempt{" "}
                      {row.attempt_no} · Hold: {row.urgency} (
                      {row.hours_left_on_hold} hours left)
                    </p>
                    {Object.keys(row.flags ?? {}).length > 0 && (
                      <p className="op-notice">
                        Flagged: {Object.keys(row.flags).join(", ")}
                      </p>
                    )}
                    <a
                      className="op-button"
                      href={`/admin/orders/${row.order_id}`}
                    >
                      Review payment
                    </a>
                  </>
                )}
                {["orders", "reconciliation"].includes(resource) && !id && (
                  <>
                    <p>
                      {row.customerName} · {row.status} · {row.source} ·{" "}
                      {money(row.totalKobo)}
                    </p>
                    <p>
                      {row.event.title} · {when(row.createdAt)}
                    </p>
                    <a href={`/admin/orders/${row.id}`}>Open order</a>
                  </>
                )}
                {resource === "events" && (
                  <>
                    <p>
                      {row.status} ·{" "}
                      {row.isDateConfirmed
                        ? when(row.startsAt)
                        : "Date to be announced"}
                    </p>
                    {row.bannerImageUrl ? (
                      <img
                        src={row.bannerImageUrl}
                        alt={`${row.title} banner`}
                        className="op-banner"
                      />
                    ) : (
                      <p>Upload a banner before publishing.</p>
                    )}
                    <BannerUpload eventId={row.id} onUploaded={poll.refresh} />
                    <TierManager event={row} refresh={poll.refresh} />
                    <Checkins eventId={row.id} />
                  </>
                )}
                {resource === "venues" && (
                  <p>
                    {row.address} · {row.city}
                    {row.googlePlaceId
                      ? " · Place linked"
                      : " · Coordinates or directions fallback"}
                  </p>
                )}
                {resource === "organizers" && (
                  <p>{row.contactEmail ?? "No contact email"}</p>
                )}
                {resource === "payment-accounts" && (
                  <p>
                    {row.bank_name} · {row.account_number} · {row.account_name}{" "}
                    · {row.is_active ? "Active" : "Inactive"}
                  </p>
                )}
                {resource === "pages" && (
                  <p>{row.isPublished ? "Published" : "Unpublished"}</p>
                )}
                {resource === "staff" && (
                  <>
                    <p>
                      {row.email} · {row.isActive ? "Active" : "Deactivated"} ·{" "}
                      {row.mustChangePassword
                        ? "Password change required"
                        : "Ready"}
                    </p>
                    <button
                      className="secondary"
                      onClick={() =>
                        void run(() =>
                          change(
                            `/api/admin/staff/${row.id}`,
                            { is_active: !row.isActive },
                            "PATCH",
                          ),
                        )
                      }
                    >
                      {row.isActive ? "Deactivate" : "Reactivate"}
                    </button>
                  </>
                )}
                {resource === "audit-log" && (
                  <>
                    <p>
                      {row.actor} · {when(row.at)} · {row.entity}
                    </p>
                    <pre>{JSON.stringify(row.metadata, null, 2)}</pre>
                  </>
                )}
                {resource === "email-jobs" && (
                  <>
                    <p>
                      {row.status} · Attempts {row.attempts}
                    </p>
                    <p>{row.last_error ?? "No delivery error"}</p>
                    <p>{when(row.created_at)}</p>
                  </>
                )}
                {fields.length > 0 && resource !== "staff" && (
                  <div className="op-actions">
                    <button className="secondary" onClick={() => editRow(row)}>
                      Edit
                    </button>
                    {["events", "venues", "organizers"].includes(resource) && (
                      <button
                        className="secondary"
                        onClick={() => {
                          if (
                            confirm(
                              "Delete this unreferenced record? Existing orders or references will block deletion.",
                            )
                          )
                            void run(() =>
                              change(
                                `/api/admin/${resource}/${row.id}`,
                                undefined,
                                "DELETE",
                              ),
                            );
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
          {poll.data && !rows.length && !id && (
            <p className="op-card">No records match this view.</p>
          )}
          {poll.data &&
            !id &&
            [
              "payments",
              "orders",
              "events",
              "email-jobs",
              "audit-log",
            ].includes(resource) && (
              <div className="op-actions">
                <button
                  className="secondary"
                  disabled={
                    Number(new URLSearchParams(query).get("page") ?? 1) <= 1
                  }
                  onClick={() => {
                    const q = new URLSearchParams(query);
                    q.set(
                      "page",
                      String(Math.max(1, Number(q.get("page") ?? 1) - 1)),
                    );
                    setQuery("?" + q);
                  }}
                >
                  Previous
                </button>
                <span>Page {new URLSearchParams(query).get("page") ?? 1}</span>
                <button
                  className="secondary"
                  disabled={!rows.length}
                  onClick={() => {
                    const q = new URLSearchParams(query);
                    q.set("page", String(Number(q.get("page") ?? 1) + 1));
                    setQuery("?" + q);
                  }}
                >
                  Next
                </button>
                <button className="secondary" onClick={poll.refresh}>
                  Refresh now
                </button>
              </div>
            )}
        </main>
      </div>
    </div>
  );
}
function optionsStatus(values: string[]) {
  return values.map((value) => ({ value, label: value.replaceAll("_", " ") }));
}

function TierManager({ event, refresh }: { event: any; refresh: () => void }) {
  const [editing, setEditing] = useState<any>(null);
  const [message, setMessage] = useState("");
  const fields: Field[] = [
    required("name", "Tier name"),
    required("price_kobo", "Price (kobo)", "number"),
    required("capacity", "Capacity", "number"),
    required("sort_order", "Display order", "number"),
    {
      key: "sales_start_at",
      label: "Sales start (Lagos)",
      type: "datetime-local",
    },
    { key: "sales_end_at", label: "Sales end (Lagos)", type: "datetime-local" },
  ];
  return (
    <section>
      <h3>Ticket tiers</h3>
      {event.ticketTiers.map((tier: any) => (
        <div key={tier.id} className="op-tier">
          <p>
            {tier.name} · {money(tier.priceKobo)} · {tier.sold} sold /{" "}
            {tier.reserved} reserved /{" "}
            {tier.capacity - tier.sold - tier.reserved} available
          </p>
          <button
            className="secondary"
            onClick={() =>
              setEditing({
                id: tier.id,
                name: tier.name,
                price_kobo: tier.priceKobo,
                capacity: tier.capacity,
                sort_order: tier.sortOrder,
                sales_start_at: tier.salesStartAt,
                sales_end_at: tier.salesEndAt,
              })
            }
          >
            Edit tier
          </button>
          <button
            className="secondary"
            onClick={async () => {
              if (!confirm("Delete this unused tier?")) return;
              try {
                await change(
                  `/api/admin/tiers/${tier.id}`,
                  undefined,
                  "DELETE",
                );
                refresh();
              } catch (e) {
                setMessage((e as Error).message);
              }
            }}
          >
            Delete tier
          </button>
        </div>
      ))}
      <button
        className="secondary"
        onClick={() => setEditing({ sort_order: event.ticketTiers.length })}
      >
        Add tier
      </button>
      {editing && (
        <Editor
          title="Ticket tier"
          fields={fields}
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={async (data) => {
            await change(
              editing.id
                ? `/api/admin/tiers/${editing.id}`
                : `/api/admin/events/${event.id}/tiers`,
              data,
              editing.id ? "PATCH" : "POST",
            );
            refresh();
          }}
        />
      )}
      <p role="alert">{message}</p>
    </section>
  );
}
function OrderReview({ order, refresh }: { order: any; refresh: () => void }) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const actionable = ["PROOF_SUBMITTED", "NEEDS_RESUBMIT", "EXPIRED"].includes(
    order.status,
  );
  async function action(kind: string, data: any) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await change(`/api/admin/orders/${order.order_id}/${kind}`, data);
      refresh();
      setMessage("Saved.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="op-card">
        <h2>{order.order_code}</h2>
        <p>
          {order.event.title} · {order.status} · {order.source}
        </p>
        <p className="op-amount">Expected {money(order.total_kobo)}</p>
        <p>
          {order.buyer.name} · {order.buyer.email} · {order.buyer.phone}
        </p>
        <p>Hold ends {when(order.hold_expires_at)}</p>
        {order.payment_account && (
          <p>
            Bank instructions given to buyer: {order.payment_account.bank_name}
            {" · "}
            {order.payment_account.account_number}
            {" · "}
            {order.payment_account.account_name}
          </p>
        )}
        {order.line_items.map((l: any, i: number) => (
          <p key={i}>
            {l.quantity} × {l.tier_name} · {money(l.unit_price_kobo)} each ·{" "}
            {l.holder_names?.join(", ")}
          </p>
        ))}
        <button className="secondary" onClick={refresh}>
          Refresh order / receipt links
        </button>
      </section>
      {order.proof_attempts_detail.map((p: any) => (
        <section className="op-card" key={p.attempt_no}>
          <h2>Receipt attempt {p.attempt_no}</h2>
          <p>
            {p.status} · Submitted {when(p.submitted_at)}
          </p>
          <p>
            <strong>Transfer reference:</strong> {p.transfer_reference}
          </p>
          <p>
            <strong>Sender:</strong> {p.sender_name}
          </p>
          {Object.keys(p.flags ?? {}).length > 0 && (
            <aside className="op-notice">
              Receipt flags: {Object.keys(p.flags).join(", ")}
            </aside>
          )}
          <img
            className="op-receipt"
            src={p.image_url}
            alt={`Payment receipt attempt ${p.attempt_no}`}
          />
          <p>
            {p.reject_reason_code} · {p.reject_message}
          </p>
          <p>
            Receipt links expire after 90 seconds. Refresh this order to view
            them again.
          </p>
        </section>
      ))}
      {actionable && (
        <section className="op-card">
          <h2>Owner decision</h2>
          <p>
            Check the actual credit in your bank app. A receipt alone does not
            confirm payment.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void action("approve", {
                confirmed_in_bank: f.get("confirmed") === "on",
                note: f.get("note") || undefined,
              });
            }}
          >
            <label className="op-check">
              <input name="confirmed" type="checkbox" required />I checked the
              credit in the bank app
            </label>
            <label>
              Owner note
              <input name="note" />
            </label>
            <button disabled={busy || order.status === "NEEDS_RESUBMIT"}>
              {order.status === "EXPIRED"
                ? "Revive and approve"
                : "Approve payment"}
            </button>
          </form>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void action("reject", {
                reason_code: f.get("reason"),
                message: f.get("message"),
                final:
                  order.status !== "PROOF_SUBMITTED" || f.get("final") === "on",
              });
            }}
          >
            <label>
              Reject reason
              <select name="reason">
                {optionsStatus([
                  "UNREADABLE",
                  "AMOUNT_MISMATCH",
                  "NOT_RECEIVED",
                  "DUPLICATE_REFERENCE",
                  "CAPACITY_GONE",
                  "OTHER",
                ]).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Message to buyer
              <textarea name="message" required maxLength={2000} />
            </label>
            <label className="op-check">
              <input
                type="checkbox"
                name="final"
                defaultChecked={order.status !== "PROOF_SUBMITTED"}
              />
              Final rejection / close case
            </label>
            <button className="secondary" disabled={busy}>
              Reject or dismiss
            </button>
          </form>
        </section>
      )}
      {order.status === "APPROVED" && (
        <section className="op-card">
          <h2>Tickets and refunds</h2>
          <p>
            {order.tickets.length} tickets. Checked in:{" "}
            {
              order.tickets.filter(
                (t: any) => t.check_in_status === "CHECKED_IN",
              ).length
            }
          </p>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void action("resend-tickets", {})}
          >
            Resend tickets to original buyer
          </button>
          <p>
            Return money manually in the bank app first. This action records the
            refund and voids tickets.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              if (
                confirm(
                  "Record this refund and void every ticket in this order?",
                )
              )
                void action("refund", {
                  password: f.get("password"),
                  note: f.get("note") || undefined,
                  restock: f.get("restock") === "on",
                  acknowledge_checked_in: f.get("acknowledge") === "on",
                });
            }}
          >
            <label>
              Re-enter your password
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                required
              />
            </label>
            <label>
              Refund note
              <input name="note" />
            </label>
            <label className="op-check">
              <input name="restock" type="checkbox" />
              Return tickets to available inventory
            </label>
            <label className="op-check">
              <input name="acknowledge" type="checkbox" />I acknowledge any
              tickets already checked in
            </label>
            <button className="secondary" disabled={busy}>
              Record refund
            </button>
          </form>
        </section>
      )}
      <section className="op-card">
        <h2>Email delivery</h2>
        {order.email_jobs.map((j: any) => (
          <p key={j.id}>
            {j.kind} · {j.status} · {j.attempts} attempts ·{" "}
            {j.last_error ?? "No error"}
          </p>
        ))}
        {order.tickets.map((t: any) => (
          <p key={t.ticket_id}>
            {t.tier_name} · {t.holder_name ?? "Unnamed"} ·{" "}
            {t.voided_at ? "VOID" : t.check_in_status}
          </p>
        ))}
      </section>
      <p role="alert">{message}</p>
    </>
  );
}
function IssueForm({ events, onDone }: { events: any[]; onDone: () => void }) {
  const [eventId, setEventId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const tiers = usePoll<any>(
    eventId ? `/api/admin/events/${eventId}/tiers` : "/api/admin/events",
    { interval: 60000 },
  );
  return (
    <details className="op-card">
      <summary>Issue CASH / COMP tickets</summary>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setMessage("");
          try {
            const r = await change("/api/admin/orders/issue", {
              client_request_id: requestId,
              event_id: eventId,
              source: f.get("source"),
              reason: f.get("reason"),
              customer_name: f.get("name"),
              customer_email: f.get("email"),
              customer_phone: f.get("phone") || undefined,
              line_items: [
                { tier_id: f.get("tier"), quantity: Number(f.get("quantity")) },
              ],
            });
            setMessage(
              `Issued ${r.order_code} · ${money(r.total_kobo)}. Open the order below.`,
            );
            onDone();
            setRequestId(crypto.randomUUID());
          } catch (e) {
            setMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Event
          <select
            required
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
          >
            <option value="">Choose…</option>
            {events
              .filter((e) => e.status === "PUBLISHED" && e.isDateConfirmed)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
          </select>
        </label>
        <label>
          Source
          <select name="source">
            <option value="CASH">CASH — cash received</option>
            <option value="COMP">COMP — complimentary</option>
          </select>
        </label>
        <label>
          Reason
          <input name="reason" required maxLength={200} />
        </label>
        <label>
          Buyer name
          <input name="name" required />
        </label>
        <label>
          Buyer email
          <input name="email" type="email" required />
        </label>
        <label>
          Phone (optional)
          <input name="phone" />
        </label>
        <label>
          Tier
          <select name="tier" required>
            <option value="">Choose…</option>
            {tiers.data?.tiers?.map((t: any) => (
              <option key={t.id} value={t.id}>
                {t.name} · {money(t.priceKobo)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Quantity
          <input
            name="quantity"
            type="number"
            min={1}
            max={10}
            defaultValue={1}
            required
          />
        </label>
        <p>
          CASH uses the current server price; COMP is free. Tickets consume
          inventory and email goes to the buyer above.
        </p>
        <button disabled={busy}>{busy ? "Issuing…" : "Issue tickets"}</button>
        <p role="alert">{message}</p>
      </form>
    </details>
  );
}
function Checkins({ eventId }: { eventId: string }) {
  const poll = usePoll<any>(`/api/admin/events/${eventId}/checkins`, {
    interval: 12000,
  });
  return (
    <details>
      <summary>Check-in counts and scan conflicts</summary>
      <p>
        {poll.data?.admitted ?? 0} checked in · {poll.data?.conflicts ?? 0}{" "}
        conflicts
      </p>
      {poll.data?.scans?.map((s: any) => (
        <p key={s.id}>
          {s.result} · {s.staff.name} · {s.deviceId} · {when(s.scannedAt)}
          {s.offline ? " · Offline" : ""}
        </p>
      ))}
    </details>
  );
}
