import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { guardApi, STAFF_API_ROLES } from "@/lib/auth/guards";
import { originCheck } from "@/lib/auth/origin";
import {
  body,
  failure,
  OperationError,
  reply,
  uuid,
} from "@/lib/operations/http";
import { checkIn, manifest } from "@/lib/scanner/service";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit";

const scan = z
  .object({
    token: z.string().min(1).max(300),
    event_id: uuid,
    device_id: z.string().min(1).max(100),
    client_scan_id: uuid,
    scanned_at: z.iso.datetime().optional(),
    not_in_manifest: z.boolean().optional(),
  })
  .strict();
async function handle(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const guard = await guardApi(request, STAFF_API_ROLES);
  if (!guard.ok) return guard.response;
  const origin = originCheck(request, "staff");
  if (!origin.ok) return origin.response;
  try {
    const { path } = await context.params;
    const route = path.join("/");
    const q = request.nextUrl.searchParams;
    if (request.method === "GET") {
      if (route === "session")
        return reply({ id: guard.user.id, name: guard.user.name });
      if (route === "events")
        return reply({
          events: await db.event.findMany({
            where: {
              status: "PUBLISHED",
              isDateConfirmed: true,
              endsAt: { gt: new Date() },
            },
            orderBy: { startsAt: "asc" },
            select: { id: true, title: true, startsAt: true, endsAt: true },
          }),
        });
      if (path.length === 3 && path[0] === "events" && path[2] === "manifest") {
        const id = uuid.parse(path[1]);
        const since = q.get("since");
        if (since && !/^\d{1,18}$/.test(since))
          throw new OperationError(400, "Invalid sync cursor.");
        return reply(await manifest(id, since));
      }
      if (route === "attendee-list") {
        const id = uuid.parse(q.get("event_id"));
        const page = z.coerce
          .number()
          .int()
          .min(1)
          .parse(q.get("page") ?? 1);
        const search = (q.get("search") ?? "").slice(0, 200);
        const where = {
          eventId: id,
          ...(search
            ? { holderName: { contains: search, mode: "insensitive" as const } }
            : {}),
        };
        const [tickets, total] = await Promise.all([
          db.ticketUnit.findMany({
            where,
            select: {
              id: true,
              holderName: true,
              checkInStatus: true,
              voidedAt: true,
            },
            orderBy: { id: "asc" },
            take: 50,
            skip: (page - 1) * 50,
          }),
          db.ticketUnit.count({ where }),
        ]);
        return reply({
          attendees: tickets.map((t) => ({
            ticket_id: t.id,
            holder_name: t.holderName,
            check_in_status: t.checkInStatus,
            voided: !!t.voidedAt,
          })),
          page,
          total,
        });
      }
    } else if (request.method === "POST") {
      const limit = consumeRateLimit("scanner", guard.user.id, {
        limit: 300,
        windowMs: 60000,
      });
      if (limit.limited)
        return rateLimitResponse(
          limit.retryAfterSec,
          "Too many scans. Retry shortly.",
        );
      if (route === "check-in")
        return reply(await checkIn(await body(request, scan), guard.user.id));
      if (route === "check-in/batch") {
        const input = await body(
          request,
          z
            .object({
              device_id: z.string().min(1).max(100),
              clock_offset_ms: z.number().int().min(-86400000).max(86400000),
              event_id: uuid,
              since: z
                .string()
                .regex(/^\d{1,18}$/)
                .optional(),
              scans: z
                .array(
                  scan
                    .omit({ device_id: true })
                    .extend({ scanned_at: z.iso.datetime() }),
                )
                .max(100),
            })
            .strict(),
        );
        if (input.scans.some((s) => s.event_id !== input.event_id))
          throw new OperationError(400, "Batch must belong to one event.");
        const scans = [...input.scans].sort((a, b) =>
          a.scanned_at.localeCompare(b.scanned_at),
        );
        const results: Awaited<ReturnType<typeof checkIn>>[] = [];
        for (const item of scans)
          results.push(
            await checkIn(
              { ...item, device_id: input.device_id },
              guard.user.id,
              true,
              input.clock_offset_ms,
            ),
          );
        return reply({
          results,
          manifest: await manifest(input.event_id, input.since),
        });
      }
    }
    throw new OperationError(404, "Route not found.");
  } catch (error) {
    if (error instanceof z.ZodError)
      return reply({ error: "Invalid request." }, 400);
    return failure(error);
  }
}
export const GET = handle;
export const POST = handle;
