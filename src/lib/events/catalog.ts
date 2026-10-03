import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { directionsUrl } from "@/lib/venues/directions";
import { lagosDay } from "@/lib/customer/format";
import type {
  CatalogEvent,
  EventDetail,
  SaleState,
} from "@/lib/customer/types";
import { CALENDAR_FORMATS } from "./calendar";

const select = {
  id: true,
  slug: true,
  title: true,
  description: true,
  bannerImageUrl: true,
  startsAt: true,
  endsAt: true,
  isDateConfirmed: true,
  status: true,
  createdAt: true,
  venue: {
    select: {
      name: true,
      city: true,
      address: true,
      latitude: true,
      longitude: true,
      googlePlaceId: true,
      googleMapsUrl: true,
    },
  },
  organizer: { select: { name: true, description: true } },
  ticketTiers: {
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      name: true,
      priceKobo: true,
      capacity: true,
      sold: true,
      reserved: true,
      salesStartAt: true,
      salesEndAt: true,
    },
  },
} satisfies Prisma.EventSelect;
type Row = Prisma.EventGetPayload<{ select: typeof select }>;
export const catalogQuery = z.object({
  view: z.enum(["list", "month", "day"]).default("list"),
  date: z.string().max(10).optional(),
  search: z.string().trim().max(100).default(""),
  city: z.string().trim().max(100).default(""),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  filter: z.enum(["all", "upcoming"]).default("all"),
});
export type CatalogQuery = z.infer<typeof catalogQuery>;
const available = (tier: Row["ticketTiers"][number]) =>
  Math.max(0, tier.capacity - tier.sold - tier.reserved);
export function saleState(
  event: Pick<Row, "status" | "isDateConfirmed" | "endsAt">,
  tier: Row["ticketTiers"][number],
  now = new Date(),
): SaleState {
  if (event.status === "CANCELLED") return "CANCELLED";
  if (!event.isDateConfirmed) return "UNCONFIRMED";
  if (event.endsAt <= now) return "ENDED";
  if (tier.salesStartAt && tier.salesStartAt > now) return "COMING_SOON";
  if (tier.salesEndAt && tier.salesEndAt < now) return "CLOSED";
  return available(tier) <= 0 ? "SOLD_OUT" : "OPEN";
}
export function safePoster(url: string | null) {
  if (!url) return null;
  if (/^\/(?!\/)/.test(url) && !/[\\\r\n]/.test(url)) return url;
  try {
    const value = new URL(url);
    return value.protocol === "https:" && !value.username && !value.password
      ? value.href
      : null;
  } catch {
    return null;
  }
}
function summary(row: Row): CatalogEvent {
  const prices = row.ticketTiers.map((t) => t.priceKobo);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    banner_image_url: safePoster(row.bannerImageUrl),
    starts_at: row.isDateConfirmed ? row.startsAt.toISOString() : null,
    ends_at: row.isDateConfirmed ? row.endsAt.toISOString() : null,
    is_date_confirmed: row.isDateConfirmed,
    venue: { name: row.venue.name, city: row.venue.city },
    price_range: prices.length
      ? { min_kobo: Math.min(...prices), max_kobo: Math.max(...prices) }
      : null,
    sold_out:
      row.ticketTiers.length > 0 &&
      row.ticketTiers.every((t) => available(t) <= 0),
  };
}
function dateRange(query: CatalogQuery) {
  if (query.view === "list" && !query.date) return null;
  const date = query.date ?? lagosDay(new Date());
  const day =
    query.view === "month" && /^\d{4}-\d{2}$/.test(date) ? date + "-01" : date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("INVALID_DATE");
  const start = new Date(`${day}T00:00:00+01:00`);
  if (!Number.isFinite(start.getTime()) || lagosDay(start) !== day)
    throw new Error("INVALID_DATE");
  if (query.view === "month") {
    const [year, month] = day.split("-").map(Number);
    return {
      start: new Date(`${day.slice(0, 7)}-01T00:00:00+01:00`),
      end: new Date(Date.UTC(year, month, 1, -1)),
    };
  }
  return { start, end: new Date(start.getTime() + 86400000) };
}
export async function listEvents(query: CatalogQuery, now = new Date()) {
  const range = dateRange(query);
  const where: Prisma.EventWhereInput = {
    status: "PUBLISHED",
    AND: [
      ...(query.search
        ? [
            {
              OR: [
                {
                  title: {
                    contains: query.search,
                    mode: "insensitive" as const,
                  },
                },
                {
                  venue: {
                    name: {
                      contains: query.search,
                      mode: "insensitive" as const,
                    },
                  },
                },
              ],
            },
          ]
        : []),
      ...(query.city
        ? [
            {
              venue: {
                city: { equals: query.city, mode: "insensitive" as const },
              },
            },
          ]
        : []),
      ...(range
        ? [
            {
              isDateConfirmed: true,
              startsAt: { lt: range.end },
              endsAt: { gt: range.start },
            },
          ]
        : []),
      ...(query.filter === "upcoming"
        ? [{ OR: [{ isDateConfirmed: false }, { endsAt: { gt: now } }] }]
        : []),
    ],
  };
  const [total, rows] = await db.$transaction([
    db.event.count({ where }),
    db.event.findMany({
      where,
      select,
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      skip: (query.page - 1) * 12,
      take: 12,
    }),
  ]);
  return {
    events: rows.map(summary),
    pagination: {
      page: query.page,
      total_pages: Math.max(1, Math.ceil(total / 12)),
      total_events: total,
    },
  };
}
export async function nextUpcoming(now = new Date()) {
  const rows = await db.event.findMany({
    where: { status: "PUBLISHED", isDateConfirmed: true, endsAt: { gt: now } },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    select: { slug: true, startsAt: true },
  });
  const upcoming = rows.length
    ? rows.filter((r) => lagosDay(r.startsAt) === lagosDay(rows[0].startsAt))
    : await db.event.findMany({
        where: { status: "PUBLISHED", isDateConfirmed: false },
        orderBy: { id: "asc" },
        select: { slug: true },
      });
  if (!upcoming.length) return { result: "none" as const };
  return upcoming.length === 1
    ? { result: "single" as const, event: { slug: upcoming[0].slug } }
    : {
        result: "multiple" as const,
        events: upcoming.map((r) => ({ slug: r.slug })),
      };
}
export async function publicEvent(
  slug: string,
  now = new Date(),
): Promise<EventDetail | null> {
  const row = await db.event.findFirst({
    where: { slug, status: { in: ["PUBLISHED", "CANCELLED"] } },
    select,
  });
  if (!row) return null;
  const key = process.env.GOOGLE_MAPS_EMBED_API_KEY?.trim();
  const query = row.venue.googlePlaceId
    ? `place_id:${row.venue.googlePlaceId}`
    : row.venue.latitude != null && row.venue.longitude != null
      ? `${row.venue.latitude},${row.venue.longitude}`
      : row.venue.address;
  return {
    ...summary(row),
    description: row.description,
    status: row.status as EventDetail["status"],
    venue: {
      name: row.venue.name,
      city: row.venue.city,
      address: row.venue.address,
      latitude: row.venue.latitude == null ? null : Number(row.venue.latitude),
      longitude:
        row.venue.longitude == null ? null : Number(row.venue.longitude),
      directions_url: directionsUrl(row.venue),
      map_embed_url: key
        ? "https://www.google.com/maps/embed/v1/place?" +
          new URLSearchParams({ key, q: query })
        : null,
    },
    organizer: row.organizer,
    ticket_tiers: row.ticketTiers.map((t) => ({
      id: t.id,
      name: t.name,
      price_kobo: t.priceKobo,
      available: available(t),
      sales_start_at: t.salesStartAt?.toISOString() ?? null,
      sales_end_at: t.salesEndAt?.toISOString() ?? null,
      state: saleState(row, t, now),
    })),
    calendar_links:
      row.isDateConfirmed && row.status === "PUBLISHED"
        ? Object.fromEntries(
            CALENDAR_FORMATS.map((f) => [
              f,
              `/api/events/${encodeURIComponent(row.slug)}/calendar/${f}`,
            ]),
          )
        : {},
  };
}
