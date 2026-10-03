import { hashes, verify } from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
hashes.sha512 = sha512;

export type LocalTicket = {
  id: string;
  tier_name: string;
  holder_name: string | null;
  check_in_status: "NOT_CHECKED_IN" | "CHECKED_IN";
  checked_in_at: string | null;
  voided: boolean;
  sync_seq: string;
};
export type Manifest = {
  event_id: string;
  event_title: string;
  starts_at: string;
  ends_at: string;
  offline_until: string;
  cancelled: boolean;
  server_time: string;
  next_since: string;
  public_keys: { kid: string; key: string }[];
  tickets: LocalTicket[];
};
export type SavedScan = {
  client_scan_id: string;
  token: string;
  event_id: string;
  scanned_at: string;
  not_in_manifest?: boolean;
};
export type LocalState = {
  userId: string;
  deviceId: string;
  manifest: Manifest;
  syncedAt: string;
  offset: number;
  outbox: SavedScan[];
};
function b64(value: string) {
  if (!/^[\w-]+$/.test(value)) throw new Error();
  return Uint8Array.from(
    atob(value.replaceAll("-", "+").replaceAll("_", "/")),
    (c) => c.charCodeAt(0),
  );
}
function uuid(bytes: Uint8Array) {
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export function verifyLocally(token: string, keys: Manifest["public_keys"]) {
  try {
    const parts = token.split(".");
    if (parts.length !== 4 || parts[0] !== "1") return null;
    const key = keys.find((k) => k.kid === parts[1]);
    if (!key) return null;
    const payload = b64(parts[2]),
      sig = b64(parts[3]),
      pub = b64(key.key);
    if (payload.length !== 32 || sig.length !== 64 || pub.length !== 32)
      return null;
    const message = new Uint8Array(35);
    message.set(new TextEncoder().encode("SR1"));
    message.set(payload, 3);
    if (!verify(sig, message, pub, { zip215: false })) return null;
    return {
      ticketId: uuid(payload.slice(0, 16)),
      eventId: uuid(payload.slice(16)),
    };
  } catch {
    return null;
  }
}
export function mergeManifest(
  previous: Manifest,
  incoming: Manifest,
  pending: SavedScan[],
): Manifest {
  const rows = new Map(previous.tickets.map((t) => [t.id, t]));
  for (const row of incoming.tickets) {
    const old = rows.get(row.id);
    if (!old || BigInt(row.sync_seq) >= BigInt(old.sync_seq))
      rows.set(row.id, {
        ...row,
        check_in_status:
          old?.check_in_status === "CHECKED_IN"
            ? "CHECKED_IN"
            : row.check_in_status,
        checked_in_at:
          old?.checked_in_at && row.checked_in_at
            ? old.checked_in_at < row.checked_in_at
              ? old.checked_in_at
              : row.checked_in_at
            : (row.checked_in_at ?? old?.checked_in_at ?? null),
        voided: row.voided || !!old?.voided,
      });
  }
  for (const scan of pending) {
    const decoded = verifyLocally(scan.token, incoming.public_keys);
    const row = decoded && rows.get(decoded.ticketId);
    if (row)
      rows.set(row.id, {
        ...row,
        check_in_status: "CHECKED_IN",
        checked_in_at: row.checked_in_at ?? scan.scanned_at,
      });
  }
  return {
    ...incoming,
    next_since:
      BigInt(incoming.next_since) > BigInt(previous.next_since)
        ? incoming.next_since
        : previous.next_since,
    tickets: [...rows.values()],
  };
}
export function offlineDecision(
  state: LocalState,
  token: string,
  now = Date.now(),
) {
  if (now + state.offset >= Math.min(new Date(state.manifest.offline_until).getTime(), new Date(state.manifest.ends_at).getTime()))
    return {
      result: "expired",
      message: "Offline preparation has expired. Connect and prepare again.",
    };
  if (state.manifest.cancelled)
    return { result: "void", message: "Event cancelled." };
  const verified = verifyLocally(token, state.manifest.public_keys);
  if (!verified) return { result: "invalid", message: "Invalid QR signature." };
  if (verified.eventId !== state.manifest.event_id)
    return {
      result: "wrong_event",
      message: "Ticket belongs to another event.",
    };
  const ticket = state.manifest.tickets.find((t) => t.id === verified.ticketId);
  if (ticket?.voided) return { result: "void", message: "Ticket voided." };
  if (
    ticket?.check_in_status === "CHECKED_IN" ||
    state.outbox.some(
      (s) =>
        verifyLocally(s.token, state.manifest.public_keys)?.ticketId ===
        verified.ticketId,
    )
  )
    return {
      result: "duplicate",
      message: `Already scanned ${ticket?.checked_in_at ?? "on this device"}.`,
    };
  return {
    result: ticket ? "valid" : "unlisted",
    message: ticket
      ? `${ticket.tier_name} · ${ticket.holder_name ?? "Unnamed ticket"}`
      : "Valid signature, not on your list. Admission will be flagged for owner review.",
    ticketId: verified.ticketId,
  };
}
