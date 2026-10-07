import type { NextRequest } from "next/server";
import { Prisma, OrderStatus, OrderSource } from "@prisma/client";
import { z } from "zod";
import { sanitizeImage } from "@/lib/uploads/sanitize";
import { imageMultipart } from "@/lib/uploads/multipart";
import { storeNewImage, storageLinked, storageFailed } from "@/lib/storage/accounting";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth/password";
import { TX_OPTIONS } from "@/lib/constants";
import { kickEmailJobs } from "@/lib/email/kick";
import { issueOrder, issueSchema } from "./issue";
import { body, OperationError, paging, reply, text, uuid } from "./http";

const optionalText = z.string().trim().max(2000).nullable().optional();
const eventSchema = z
  .object({
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(100),
    title: text,
    description: z.string().trim().min(1).max(20000),
    organizer_id: uuid,
    venue_id: uuid,
    starts_at: z.iso.datetime({ offset: true }),
    ends_at: z.iso.datetime({ offset: true }),
    is_date_confirmed: z.boolean(),
    status: z.enum(["DRAFT", "PUBLISHED", "CANCELLED"]).default("DRAFT"),
  })
  .strict();
const tierSchema = z
  .object({
    name: text,
    price_kobo: z.number().int().min(0).max(2147483647),
    capacity: z.number().int().min(0).max(1000000),
    sort_order: z.number().int().min(0).max(10000).default(0),
    sales_start_at: z.iso.datetime({ offset: true }).nullable().optional(),
    sales_end_at: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .strict();
const venueSchema = z
  .object({
    name: text,
    address: text,
    city: text,
    state: optionalText,
    country: text.default("Nigeria"),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    google_place_id: optionalText,
    google_maps_url: z
      .url()
      .max(2000)
      .startsWith("https://")
      .nullable()
      .optional(),
  })
  .strict();
const organizerSchema = z
  .object({
    name: text,
    description: optionalText,
    contact_email: z.email().max(254).nullable().optional(),
  })
  .strict();
const eventInclude = {
  venue: true,
  organizer: true,
  ticketTiers: { orderBy: { sortOrder: "asc" as const } },
};
function iso(value: string | null | undefined) {
  return value ? new Date(value) : null;
}
function csvCell(value: unknown) {
  let s = value == null ? "" : String(value);
  if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export async function adminOperation(
  request: NextRequest,
  path: string[],
  actorId: string,
) {
  const method = request.method;
  const route = path.join("/");
  const { q, page, take, skip } = paging(request);
  const id =
    path.length > 1 && !["issue", "status", "subscribe"].includes(path[1])
      ? path[1]
      : undefined;
  if (id && !["pages", "push"].includes(path[0])) uuid.parse(id);
  if (method === "GET") {
    if (route === "events")
      return reply({
        events: await db.event.findMany({
          include: eventInclude,
          orderBy: { startsAt: "desc" },
          take,
          skip,
        }),
        page,
        total: await db.event.count(),
      });
    if (path[0] === "events" && path.length === 2)
      return reply({
        event: await db.event.findUniqueOrThrow({
          where: { id },
          include: eventInclude,
        }),
      });
    if (path[0] === "events" && path[2] === "tiers")
      return reply({
        tiers: await db.ticketTier.findMany({
          where: { eventId: id },
          orderBy: { sortOrder: "asc" },
        }),
      });
    if (route === "venues")
      return reply({
        venues: await db.venue.findMany({
          orderBy: { name: "asc" },
          take: 500,
        }),
      });
    if (route === "organizers")
      return reply({
        organizers: await db.organizer.findMany({
          orderBy: { name: "asc" },
          take: 500,
        }),
      });
    if (route === "pages")
      return reply({ pages: await db.sitePage.findMany() });
    if (route === "staff")
      return reply({
        staff: await db.staffUser.findMany({
          where: { role: "STAFF" },
          select: {
            id: true,
            name: true,
            email: true,
            isActive: true,
            mustChangePassword: true,
            lastLoginAt: true,
            invitedBy: true,
          },
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
      });
    if (route === "orders" || route === "reconciliation") {
      const where: Prisma.OrderWhereInput = {};
      if (q.get("event_id")) where.eventId = uuid.parse(q.get("event_id"));
      if (q.get("status"))
        where.status = z.enum(OrderStatus).parse(q.get("status"));
      if (q.get("source"))
        where.source = z.enum(OrderSource).parse(q.get("source"));
      if (q.get("date")) {
        const day = z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .parse(q.get("date"));
        const start = new Date(`${day}T00:00:00+01:00`);
        if (!Number.isFinite(start.getTime()))
          throw new OperationError(400, "Invalid date.");
        where.createdAt = {
          gte: start,
          lt: new Date(start.getTime() + 86400000),
        };
      }
      const search = q.get("search")?.trim().slice(0, 200);
      if (search)
        where.OR = [
          { orderCode: { contains: search, mode: "insensitive" } },
          { customerEmail: { contains: search, mode: "insensitive" } },
          { customerPhone: { contains: search } },
        ];
      if (route === "reconciliation") where.status = "APPROVED";
      const orders = await db.order.findMany({
        where,
        select: {
          id: true,
          orderCode: true,
          customerName: true,
          customerEmail: true,
          customerPhone: true,
          totalKobo: true,
          status: true,
          source: true,
          createdAt: true,
          approvedAt: true,
          approvedByStaff: { select: { name: true } },
          event: { select: { title: true } },
          lineItems: {
            select: {
              quantity: true,
              unitPriceKobo: true,
              tier: { select: { name: true } },
            },
          },
          proofs: {
            where: { status: "APPROVED" },
            select: { transferReference: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: route === "reconciliation" ? 10001 : take,
        skip: route === "reconciliation" ? 0 : skip,
      });
      const total = await db.order.aggregate({
        where,
        _count: true,
        _sum: { totalKobo: true },
      });
      if (route === "reconciliation" && orders.length > 10000)
        throw new OperationError(
          413,
          "Choose an event or date to export fewer than 10,001 orders.",
        );
      if (route === "reconciliation" && q.get("format") === "csv") {
        const lines = [
          [
            "Order",
            "Source",
            "Buyer",
            "Email",
            "Phone",
            "Event",
            "Tier",
            "Quantity",
            "Unit kobo",
            "Order total kobo",
            "Reference",
            "Approved time",
            "Approver",
          ],
        ];
        for (const o of orders)
          for (const l of o.lineItems)
            lines.push([
              o.orderCode,
              o.source,
              o.customerName,
              o.customerEmail,
              o.customerPhone ?? "",
              o.event.title,
              l.tier.name,
              String(l.quantity),
              String(l.unitPriceKobo),
              String(o.totalKobo),
              o.proofs[0]?.transferReference ?? "",
              o.approvedAt?.toISOString() ?? "",
              o.approvedByStaff?.name ?? "",
            ]);
        // Per-line order total repeats for context; footer sums distinct orders.
        lines.push([
          "TOTAL DISTINCT ORDERS",
          String(total._count),
          "TOTAL KOBO",
          String(total._sum.totalKobo ?? 0),
        ]);
        return new Response(
          lines.map((row) => row.map(csvCell).join(",")).join("\r\n"),
          {
            headers: {
              "Content-Type": "text/csv; charset=utf-8",
              "Content-Disposition":
                'attachment; filename="SilentRave-reconciliation.csv"',
              "Cache-Control": "private, no-store",
            },
          },
        );
      }
      return reply({
        orders,
        page,
        total: total._count,
        total_kobo: total._sum.totalKobo ?? 0,
      });
    }
    if (route === "audit-log") {
      const where: Prisma.AuditLogEntryWhereInput = {};
      if (q.get("actor")) where.actorId = uuid.parse(q.get("actor"));
      if (q.get("action")) where.action = q.get("action")!.slice(0, 100);
      if (q.get("entity")) where.entityId = uuid.parse(q.get("entity"));
      if (q.get("date")) {
        const start = new Date(
          z.iso.datetime({ offset: true }).parse(q.get("date")),
        );
        where.createdAt = { gte: start };
      }
      const scansWhere: Prisma.CheckInScanWhereInput = {};
      if (where.actorId) scansWhere.staffUserId = String(where.actorId);
      if (where.entityId) scansWhere.ticketId = String(where.entityId);
      if (q.get("date"))
        scansWhere.receivedAt = { gte: new Date(q.get("date")!) };
      if (q.get("action")) {
        const result = z
          .enum([
            "VALID",
            "DUPLICATE",
            "INVALID",
            "WRONG_EVENT",
            "VOID",
            "CONFLICT",
          ])
          .safeParse(q.get("action"));
        if (result.success) scansWhere.result = result.data;
        else scansWhere.id = "00000000-0000-0000-0000-000000000000";
      }
      const [audits, scans] = await Promise.all([
        db.auditLogEntry.findMany({
          where,
          include: { actor: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
          take: skip + take,
        }),
        db.checkInScan.findMany({
          where: scansWhere,
          include: { staff: { select: { name: true } } },
          orderBy: { receivedAt: "desc" },
          take: skip + take,
        }),
      ]);
      const entries = [
        ...audits.map((a) => ({
          id: a.id,
          at: a.createdAt,
          action: a.action,
          actor: a.actor?.name ?? "System",
          entity: a.entityId,
          metadata: a.metadata,
        })),
        ...scans.map((s) => ({
          id: s.id,
          at: s.receivedAt,
          action: s.result,
          actor: s.staff.name,
          entity: s.ticketId,
          metadata: {
            device_id: s.deviceId,
            offline: s.offline,
            scanned_at: s.scannedAt,
            flags: s.flags,
          },
        })),
      ]
        .sort((a, b) => b.at.getTime() - a.at.getTime())
        .slice(skip, skip + take);
      return reply({
        entries,
        page,
        total:
          (await db.auditLogEntry.count({ where })) +
          (await db.checkInScan.count({ where: scansWhere })),
      });
    }
    if (path[0] === "events" && path[2] === "checkins") {
      const [scans, admitted, conflicts, total] = await Promise.all([
        db.checkInScan.findMany({
          where: { eventId: id },
          include: { staff: { select: { name: true } } },
          orderBy: { receivedAt: "desc" },
          take,
          skip,
        }),
        db.ticketUnit.count({
          where: { eventId: id, checkInStatus: "CHECKED_IN" },
        }),
        db.checkInScan.count({ where: { eventId: id, result: "CONFLICT" } }),
        db.checkInScan.count({ where: { eventId: id } }),
      ]);
      return reply({ scans, admitted, conflicts, total, page });
    }
  }
  if (method === "POST" && route === "orders/issue") {
    const result = await issueOrder(await body(request, issueSchema), actorId);
    after(() => kickEmailJobs());
    return reply(result, 201);
  }
  if (
    path[0] === "events" &&
    path.length <= 2 &&
    ["POST", "PATCH", "DELETE"].includes(method)
  ) {
    if (method === "DELETE") {
      await db.$transaction(async (tx) => {
        const current = await tx.event.findUniqueOrThrow({ where: { id } });
        if (await tx.order.count({ where: { eventId: id } }))
          throw new OperationError(
            409,
            "This event has orders. Cancel it instead.",
          );
        await tx.event.delete({ where: { id } });
        await writeAudit(tx, {
          actorId,
          action: "EVENT_DELETED",
          entityType: "event",
          entityId: current.id,
        });
      }, TX_OPTIONS);
      return reply({ ok: true });
    }
    const input = await body(
      request,
      method === "PATCH"
        ? eventSchema
            .partial()
            .extend({
              status: z.enum(["DRAFT", "PUBLISHED", "CANCELLED"]).optional(),
            })
        : eventSchema,
    );
    const event = await db.$transaction(async (tx) => {
      const previous = id
        ? await tx.event.findUniqueOrThrow({ where: { id } })
        : null;
      const data = {
        slug: input.slug,
        title: input.title,
        description: input.description,
        organizerId: input.organizer_id,
        venueId: input.venue_id,
        startsAt: input.starts_at ? new Date(input.starts_at) : undefined,
        endsAt: input.ends_at ? new Date(input.ends_at) : undefined,
        isDateConfirmed: input.is_date_confirmed,
        status: input.status,
      };
      const merged = {
        ...previous,
        ...Object.fromEntries(
          Object.entries(data).filter(([, v]) => v !== undefined),
        ),
      } as Prisma.EventUncheckedCreateInput;
      if (new Date(merged.endsAt) <= new Date(merged.startsAt))
        throw new OperationError(400, "Event end must follow its start.");
      if (
        previous?.status === "CANCELLED" &&
        input.status &&
        input.status !== "CANCELLED"
      )
        throw new OperationError(409, "Cancelled events cannot be reopened.");
      if (merged.status === "PUBLISHED" && !previous?.bannerImageUrl)
        throw new OperationError(
          409,
          "Save a draft and upload its banner before publishing.",
        );
      const changed = previous
        ? await tx.event.update({ where: { id }, data })
        : await tx.event.create({ data: merged });
      await writeAudit(tx, {
        actorId,
        action: !previous
          ? "EVENT_CREATED"
          : changed.status === "CANCELLED" && previous.status !== "CANCELLED"
            ? "EVENT_CANCELLED"
            : changed.isDateConfirmed && !previous.isDateConfirmed
              ? "EVENT_DATE_CONFIRMED"
              : "EVENT_UPDATED",
        entityType: "event",
        entityId: changed.id,
        metadata: {
          before: previous
            ? {
                status: previous.status,
                title: previous.title,
                starts_at: previous.startsAt.toISOString(),
              }
            : null,
          after: {
            status: changed.status,
            title: changed.title,
            starts_at: changed.startsAt.toISOString(),
          },
        },
      });
      return changed;
    }, TX_OPTIONS);
    return reply({ event }, method === "POST" ? 201 : 200);
  }
  if (method === "POST" && path[0] === "events" && path[2] === "banner") {
    const eventId = uuid.parse(path[1]);
    const form = await imageMultipart(request, "banner");
    const file = form.get("banner");
    if (!(file instanceof File)) throw new OperationError(422, "Choose a JPEG, PNG or WebP banner under 3 MiB.");
    let bytes: Buffer;
    try {
      bytes = await sanitizeImage(Buffer.from(await file.arrayBuffer()), "banner");
    } catch {
      throw new OperationError(422, "Invalid image. Use JPEG, PNG or WebP.");
    }
    await db.event.findUniqueOrThrow({ where: { id } });
    const key = await storeNewImage(() => `banners/${randomUUID()}.webp`, bytes, "image/webp");
    const url = `/api/banners/${key.split("/")[1]}`;
    try { await db.$transaction(async (tx) => {
      await tx.event.update({ where: { id }, data: { bannerImageUrl: url } });
      await storageLinked(tx, key, "EVENT", eventId);
      await writeAudit(tx, {
        actorId,
        action: "EVENT_UPDATED",
        entityType: "event",
        entityId: id,
        metadata: { banner: url },
      });
    }, TX_OPTIONS); } catch (error) { await storageFailed(key, error); throw error; }
    return reply({ banner_image_url: url });
  }
  if (
    (path[0] === "events" && path[2] === "tiers" && method === "POST") ||
    (path[0] === "tiers" &&
      path.length === 2 &&
      ["PATCH", "DELETE"].includes(method))
  ) {
    const input =
      method === "DELETE"
        ? null
        : await body(
            request,
            method === "PATCH"
              ? tierSchema
                  .partial()
                  .extend({
                    sort_order: z.number().int().min(0).max(10000).optional(),
                  })
              : tierSchema,
          );
    const tier = await db.$transaction(async (tx) => {
      if (path[0] === "tiers")
        await tx.$queryRaw`SELECT id FROM ticket_tiers WHERE id = ${id}::uuid FOR UPDATE`;
      const previous =
        path[0] === "tiers"
          ? await tx.ticketTier.findUniqueOrThrow({ where: { id } })
          : null;
      if (method === "DELETE") {
        if (
          previous!.sold > 0 ||
          previous!.reserved > 0 ||
          (await tx.orderLineItem.count({ where: { tierId: id } }))
        )
          throw new OperationError(
            409,
            "Referenced, sold or reserved tiers cannot be deleted.",
          );
        await tx.ticketTier.delete({ where: { id } });
        await writeAudit(tx, {
          actorId,
          action: "TIER_DELETED",
          entityType: "tier",
          entityId: id,
        });
        return null;
      }
      const data = {
        name: input!.name,
        priceKobo: input!.price_kobo,
        capacity: input!.capacity,
        sortOrder: input!.sort_order,
        salesStartAt:
          input!.sales_start_at === undefined
            ? undefined
            : iso(input!.sales_start_at),
        salesEndAt:
          input!.sales_end_at === undefined
            ? undefined
            : iso(input!.sales_end_at),
      };
      if (
        previous &&
        (data.capacity ?? previous.capacity) < previous.sold + previous.reserved
      )
        throw new OperationError(
          409,
          "Capacity cannot fall below sold plus reserved.",
        );
      const start =
        data.salesStartAt === undefined
          ? previous?.salesStartAt
          : data.salesStartAt;
      const end =
        data.salesEndAt === undefined ? previous?.salesEndAt : data.salesEndAt;
      if (start && end && end <= start)
        throw new OperationError(400, "Sales end must follow start.");
      const changed = previous
        ? await tx.ticketTier.update({ where: { id }, data })
        : await tx.ticketTier.create({
            data: {
              ...data,
              name: input!.name!,
              priceKobo: input!.price_kobo!,
              capacity: input!.capacity!,
              eventId: id!,
            },
          });
      for (const [action, before, afterValue] of [
        ["TIER_PRICE_CHANGED", previous?.priceKobo, changed.priceKobo],
        ["TIER_CAPACITY_CHANGED", previous?.capacity, changed.capacity],
      ] as const)
        if (before !== afterValue)
          await writeAudit(tx, {
            actorId,
            action,
            entityType: "tier",
            entityId: changed.id,
            metadata: { before: before ?? null, after: afterValue },
          });
      return changed;
    }, TX_OPTIONS);
    return reply({ tier }, method === "POST" ? 201 : 200);
  }
  if (
    ["venues", "organizers"].includes(path[0]) &&
    path.length <= 2 &&
    ["POST", "PATCH", "DELETE"].includes(method)
  ) {
    const isVenue = path[0] === "venues";
    if (method === "DELETE") {
      await db.$transaction(async (tx) => {
        if (
          await tx.event.count({
            where: isVenue ? { venueId: id } : { organizerId: id },
          })
        )
          throw new OperationError(
            409,
            "This record is referenced by an event and cannot be deleted.",
          );
        if (isVenue) await tx.venue.delete({ where: { id } });
        else await tx.organizer.delete({ where: { id } });
        await writeAudit(tx, {
          actorId,
          action: isVenue ? "VENUE_DELETED" : "ORGANIZER_DELETED",
          entityType: path[0],
          entityId: id,
        });
      }, TX_OPTIONS);
      return reply({ ok: true });
    }
    const input = isVenue
      ? await body(
          request,
          method === "PATCH"
            ? venueSchema.partial().extend({ country: text.optional() })
            : venueSchema,
        )
      : await body(
          request,
          method === "PATCH" ? organizerSchema.partial() : organizerSchema,
        );
    const record = await db.$transaction(async (tx) => {
      let record;
      if (isVenue) {
        const v = input as z.infer<typeof venueSchema>;
        const data = {
          name: v.name,
          address: v.address,
          city: v.city,
          state: v.state,
          country: v.country,
          latitude: v.latitude,
          longitude: v.longitude,
          googlePlaceId: v.google_place_id,
          googleMapsUrl: v.google_maps_url,
        };
        record = id
          ? await tx.venue.update({ where: { id }, data })
          : await tx.venue.create({ data });
      } else {
        const v = input as z.infer<typeof organizerSchema>;
        const data = {
          name: v.name,
          description: v.description,
          contactEmail: v.contact_email,
        };
        record = id
          ? await tx.organizer.update({ where: { id }, data })
          : await tx.organizer.create({ data });
      }
      await writeAudit(tx, {
        actorId,
        action: `${isVenue ? "VENUE" : "ORGANIZER"}_${id ? "UPDATED" : "CREATED"}`,
        entityType: path[0],
        entityId: record.id,
      });
      return record;
    }, TX_OPTIONS);
    return reply({ record }, method === "POST" ? 201 : 200);
  }
  if (path[0] === "pages" && path.length === 2 && method === "PATCH") {
    const slug = z.enum(["about", "contact"]).parse(id);
    const input = await body(
      request,
      z
        .object({
          title: text,
          body: z.string().trim().max(20000),
          is_published: z.boolean(),
          contact_organizer_id: uuid.nullable().optional(),
        })
        .strict(),
    );
    const page = await db.$transaction(async (tx) => {
      const data = {
        title: input.title,
        body: input.body,
        isPublished: input.is_published,
        contactOrganizerId: input.contact_organizer_id,
      };
      const page = await tx.sitePage.upsert({
        where: { slug },
        create: { slug, ...data },
        update: data,
      });
      await writeAudit(tx, {
        actorId,
        action: "PAGE_UPDATED",
        entityType: "page",
        metadata: { slug, published: input.is_published },
      });
      return page;
    }, TX_OPTIONS);
    return reply({ page });
  }
  if (path[0] === "staff" && ["POST", "PATCH"].includes(method)) {
    if (method === "POST") {
      const input = await body(
        request,
        z
          .object({
            name: text,
            email: z.email().max(254),
            temporary_password: z.string().min(12).max(72),
          })
          .strict(),
      );
      const passwordHash = await hashPassword(input.temporary_password);
      const user = await db.$transaction(async (tx) => {
        const user = await tx.staffUser.create({
          data: {
            name: input.name,
            email: input.email.toLowerCase(),
            passwordHash,
            role: "STAFF",
            invitedBy: actorId,
            mustChangePassword: true,
          },
          select: { id: true, name: true, email: true },
        });
        await writeAudit(tx, {
          actorId,
          action: "STAFF_ACCOUNT_CREATED",
          entityType: "staff",
          entityId: user.id,
        });
        return user;
      }, TX_OPTIONS);
      return reply({ staff: user }, 201);
    }
    const input = await body(
      request,
      z.object({ is_active: z.boolean() }).strict(),
    );
    await db.$transaction(async (tx) => {
      const user = await tx.staffUser.findUniqueOrThrow({ where: { id } });
      if (user.role !== "STAFF")
        throw new OperationError(
          403,
          "Owner accounts cannot be changed through staff management.",
        );
      await tx.staffUser.update({
        where: { id },
        data: { isActive: input.is_active },
      });
      if (!input.is_active)
        await tx.session.deleteMany({ where: { userId: id } });
      await writeAudit(tx, {
        actorId,
        action: input.is_active
          ? "STAFF_ACCOUNT_REACTIVATED"
          : "STAFF_ACCOUNT_DEACTIVATED",
        entityType: "staff",
        entityId: id,
      });
    }, TX_OPTIONS);
    return reply({ ok: true });
  }
  throw new OperationError(404, "Route not found.");
}
