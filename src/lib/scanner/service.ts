import { Prisma, type ScanResult } from "@prisma/client";
import { db } from "@/lib/db";
import { getVerificationKeys, verifyTicketToken } from "@/lib/tickets/qr";
import { TX_OPTIONS } from "@/lib/constants";
import { OperationError } from "@/lib/operations/http";
import { createHash } from "node:crypto";

export type ScanInput = {
  token: string;
  event_id: string;
  device_id: string;
  client_scan_id: string;
  scanned_at?: string;
  not_in_manifest?: boolean;
};
const ticketSelect = {
  id: true,
  eventId: true,
  qrToken: true,
  orderId: true,
  checkInStatus: true,
  checkedInAt: true,
  checkedInBy: true,
  voidedAt: true,
  holderName: true,
  tier: { select: { name: true } },
  event: { select: { title: true, status: true } },
  checkedInByStaff: { select: { name: true } },
} satisfies Prisma.TicketUnitSelect;

/** Receipt ledger is immutable. A later earlier offline scan adds a conflict
 * entry identifying the displaced scan; it never rewrites its historical result. */
export async function checkIn(
  input: ScanInput,
  staffId: string,
  offline = false,
  offset = 0,
) {
  const verified = verifyTicketToken(input.token); // before admission DB lookup
  const corrected = offline
    ? new Date(new Date(input.scanned_at!).getTime() + offset)
    : new Date();
  if (
    !Number.isFinite(corrected.getTime()) ||
    corrected.getTime() > Date.now() + 300000 ||
    corrected.getTime() < Date.now() - 7 * 86400000
  )
    throw new OperationError(
      400,
      "Scan time is outside the allowed seven-day sync window.",
    );
  return db.$transaction(async (tx) => {
    // Idempotency across concurrent batches/devices; no session advisory locks.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(4, hashtext(${input.client_scan_id}))`;
    const existing = await tx.checkInScan.findUnique({
      where: { clientScanId: input.client_scan_id },
    });
    if (existing) {
      if (
        existing.staffUserId !== staffId ||
        existing.deviceId !== input.device_id ||
        existing.eventId !== input.event_id ||
        (existing.flags as Record<string, unknown>).token_hash !==
          createHash("sha256").update(input.token).digest("hex")
      )
        throw new OperationError(
          409,
          "Scan identifier already belongs to another request.",
        );
      const previousUnit = existing.ticketId
        ? await tx.ticketUnit.findUnique({
            where: { id: existing.ticketId },
            select: ticketSelect,
          })
        : null;
      return {
        client_scan_id: existing.clientScanId,
        result: existing.result.toLowerCase(),
        idempotent: true,
        ...(previousUnit &&
        ["VALID", "DUPLICATE", "CONFLICT"].includes(existing.result)
          ? {
              tier_name: previousUnit.tier.name,
              holder_name: previousUnit.holderName,
              event_name: previousUnit.event.title,
              checked_in_at: previousUnit.checkedInAt?.toISOString(),
              checked_in_by_name: previousUnit.checkedInByStaff?.name,
            }
          : {}),
      };
    }
    const event = await tx.event.findUnique({
      where: { id: input.event_id },
      select: { id: true, status: true, endsAt: true, isDateConfirmed: true },
    });
    if (!event) throw new OperationError(404, "Event not found.");
    let result: ScanResult = !verified.ok
      ? "INVALID"
      : verified.eventId !== input.event_id
        ? "WRONG_EVENT"
        : "INVALID";
    let unit: Prisma.TicketUnitGetPayload<{
      select: typeof ticketSelect;
    }> | null = null;
    const flags: Record<string, unknown> = {
      token_hash: createHash("sha256").update(input.token).digest("hex"),
      ...(input.not_in_manifest ? { not_in_manifest: true } : {}),
    };
    if (verified.ok && verified.eventId === input.event_id) {
      const candidate = await tx.ticketUnit.findUnique({
        where: { id: verified.ticketId },
        select: { orderId: true },
      });
      if (candidate) {
        // Same order -> ticket lock order as refund, preventing refund/check-in races.
        await tx.$queryRaw`SELECT id FROM orders WHERE id = ${candidate.orderId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM ticket_units WHERE id = ${verified.ticketId}::uuid FOR UPDATE`;
        unit = await tx.ticketUnit.findUnique({
          where: { id: verified.ticketId },
          select: ticketSelect,
        });
        const order = await tx.order.findUnique({
          where: { id: candidate.orderId },
          select: { status: true },
        });
        if (
          !unit ||
          unit.eventId !== input.event_id ||
          unit.qrToken !== input.token
        )
          result = "INVALID";
        else if (
          unit.voidedAt ||
          order?.status !== "APPROVED" ||
          event.status === "CANCELLED" ||
          !event.isDateConfirmed ||
          event.endsAt <= new Date()
        )
          result = "VOID";
        else if (unit.checkInStatus === "NOT_CHECKED_IN") {
          const changed = await tx.ticketUnit.updateMany({
            where: {
              id: unit.id,
              checkInStatus: "NOT_CHECKED_IN",
              voidedAt: null,
            },
            data: {
              checkInStatus: "CHECKED_IN",
              checkedInAt: corrected,
              checkedInBy: staffId,
            },
          });
          result = changed.count === 1 ? "VALID" : "DUPLICATE";
        } else if (
          !offline ||
          (unit.checkedInBy === staffId &&
            (await tx.checkInScan.findFirst({
              where: {
                ticketId: unit.id,
                deviceId: input.device_id,
                result: "VALID",
              },
            })))
        )
          result = "DUPLICATE";
        else if (unit.checkedInAt && corrected < unit.checkedInAt) {
          flags.displaced_check_in_at = unit.checkedInAt.toISOString();
          flags.displaced_staff_id = unit.checkedInBy;
          flags.earliest_scan_wins = true;
          await tx.ticketUnit.update({
            where: { id: unit.id },
            data: { checkedInAt: corrected, checkedInBy: staffId },
          });
          result = "CONFLICT";
        } else result = "CONFLICT";
        unit =
          unit &&
          (await tx.ticketUnit.findUnique({
            where: { id: unit.id },
            select: ticketSelect,
          }));
      }
    }
    await tx.checkInScan.create({
      data: {
        clientScanId: input.client_scan_id,
        eventId: input.event_id,
        ticketId: unit?.id ?? null,
        staffUserId: staffId,
        deviceId: input.device_id,
        scannedAt: corrected,
        offline,
        result,
        flags: flags as Prisma.InputJsonValue,
      },
    });
    return {
      client_scan_id: input.client_scan_id,
      result: result.toLowerCase(),
      idempotent: false,
      ...(unit && ["VALID", "DUPLICATE", "CONFLICT"].includes(result)
        ? {
            tier_name: unit.tier.name,
            holder_name: unit.holderName,
            event_name: unit.event.title,
            checked_in_at: unit.checkedInAt?.toISOString(),
            checked_in_by_name: unit.checkedInByStaff?.name,
          }
        : {}),
    };
  }, TX_OPTIONS);
}

export async function manifest(eventId: string, since?: string | null) {
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      status: true,
      isDateConfirmed: true,
    },
  });
  if (!event || !event.isDateConfirmed || event.status === "DRAFT")
    throw new OperationError(404, "Event not available for scanning.");
  const cursor = since ? BigInt(since) : BigInt(0);
  const rows = await db.ticketUnit.findMany({
    where: {
      eventId,
      ...(since
        ? {
            syncSeq: {
              gt: cursor > BigInt(1000) ? cursor - BigInt(1000) : BigInt(0),
            },
          }
        : {}),
    },
    select: {
      id: true,
      holderName: true,
      checkInStatus: true,
      checkedInAt: true,
      syncSeq: true,
      voidedAt: true,
      tier: { select: { name: true } },
      order: { select: { status: true } },
    },
    orderBy: { syncSeq: "asc" },
  });
  return {
    event_id: eventId,
    event_title: event.title,
    starts_at: event.startsAt.toISOString(),
    ends_at: event.endsAt.toISOString(),
    // Offline grace ends on the Lagos calendar day of event end.
    offline_until: new Date(
      Date.UTC(
        event.endsAt.getUTCFullYear(),
        event.endsAt.getUTCMonth(),
        event.endsAt.getUTCDate() + (event.endsAt.getUTCHours() >= 23 ? 2 : 1),
      ) - 3600000,
    ).toISOString(),
    cancelled: event.status === "CANCELLED",
    server_time: new Date().toISOString(),
    next_since: String(
      rows.reduce(
        (max, row) => (row.syncSeq > max ? row.syncSeq : max),
        cursor,
      ),
    ),
    public_keys: [...getVerificationKeys()].map(([kid, key]) => ({
      kid,
      key: key.publicKeyRaw.toString("base64url"),
    })),
    tickets: rows.map((row) => ({
      id: row.id,
      tier_name: row.tier.name,
      holder_name: row.holderName,
      check_in_status: row.checkInStatus,
      checked_in_at: row.checkedInAt?.toISOString() ?? null,
      voided:
        !!row.voidedAt ||
        row.order.status !== "APPROVED" ||
        event.status === "CANCELLED",
      sync_seq: String(row.syncSeq),
    })),
  };
}
