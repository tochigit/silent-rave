// ─────────────────────────────────────────────────────────────────────────────
// In-process server-event emitter — a THIN INTERFACE ONLY (04 "Notifications
// and realtime": "Realtime is a convenience layer, not the source of truth").
//
// Call sites emit AFTER COMMIT, carrying IDs ONLY (no PII — the payload must
// never include buyer names, emails, phones, references or amounts). Clients
// refetch through the authenticated API.
//
// NOT implemented in this phase (by instruction): Supabase Realtime broadcast
// transport, web push sending, any polling client. A future transport wires
// subscribeServerEvents() into e.g. a Supabase channel publisher.
// ─────────────────────────────────────────────────────────────────────────────

export type ServerEventType = "order.proof_submitted" | "order.approved" | "order.rejected";

export type ServerEvent = {
  type: ServerEventType;
  /** IDs only — deliberately no PII, no codes, no amounts (04). */
  orderId: string;
  at: number;
};

type Listener = (event: ServerEvent) => void;

const listeners = new Set<Listener>();

/**
 * Emit a server event. Fire-and-forget AFTER the DB transaction commits — a
 * listener failure must never affect the request path that emitted.
 */
export function emitServerEvent(type: ServerEventType, orderId: string): void {
  const event: ServerEvent = { type, orderId, at: Date.now() };
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      console.error("[server-events] listener threw (ignored):", error);
    }
  }
}

/** Subscribe for future transports (tests, realtime publisher). Returns an unsubscribe fn. */
export function subscribeServerEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
