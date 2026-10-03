import { expect, test } from "bun:test";
import "../phase3b/load-env";
import {
  currentPublicKeyB64url,
  getSigningKey,
  signTicketToken,
} from "../../src/lib/tickets/qr";
import {
  mergeManifest,
  offlineDecision,
  verifyLocally,
  type Manifest,
  type LocalState,
} from "../../src/lib/scanner/local";
const eventId = crypto.randomUUID(),
  id = crypto.randomUUID();
const keys = [{ kid: getSigningKey().kid, key: currentPublicKeyB64url() }];
const token = signTicketToken(id, eventId);
const m: Manifest = {
  event_id: eventId,
  event_title: "Fixture",
  starts_at: new Date().toISOString(),
  ends_at: new Date(Date.now() + 3600000).toISOString(),
  offline_until: new Date(Date.now() + 3600000).toISOString(),
  cancelled: false,
  server_time: new Date().toISOString(),
  next_since: "1500",
  public_keys: keys,
  tickets: [
    {
      id,
      tier_name: "General",
      holder_name: "Chidi",
      check_in_status: "NOT_CHECKED_IN",
      checked_in_at: null,
      voided: false,
      sync_seq: "1500",
    },
  ],
};
const state: LocalState = {
  userId: crypto.randomUUID(),
  deviceId: "local",
  manifest: m,
  syncedAt: new Date().toISOString(),
  offset: 0,
  outbox: [],
};
test("browser verifier matches Node Ed25519, and rejects tamper/version/malformed/key", () => {
  expect(verifyLocally(token, keys)).toEqual({ ticketId: id, eventId });
  for (const bad of [
    token.replace(/^1\./, "2."),
    token + "x",
    "garbage",
    token.slice(0, -20),
  ])
    expect(verifyLocally(bad, keys)).toBeNull();
  expect(verifyLocally(token, [])).toBeNull();
});
test("offline event/void/local duplicate/pending/unlisted/expiry decisions", () => {
  expect(offlineDecision(state, token).result).toBe("valid");
  expect(
    offlineDecision(
      state,
      signTicketToken(crypto.randomUUID(), crypto.randomUUID()),
    ).result,
  ).toBe("wrong_event");
  expect(
    offlineDecision(state, signTicketToken(crypto.randomUUID(), eventId))
      .result,
  ).toBe("unlisted");
  expect(
    offlineDecision({ ...state, manifest: { ...m, cancelled: true } }, token)
      .result,
  ).toBe("void");
  expect(
    offlineDecision(
      {
        ...state,
        manifest: { ...m, tickets: [{ ...m.tickets[0], voided: true }] },
      },
      token,
    ).result,
  ).toBe("void");
  expect(
    offlineDecision(
      {
        ...state,
        outbox: [
          {
            token,
            event_id: eventId,
            client_scan_id: crypto.randomUUID(),
            scanned_at: new Date().toISOString(),
          },
        ],
      },
      token,
    ).result,
  ).toBe("duplicate");
  expect(offlineDecision(state, token, Date.now() + 7200000).result).toBe(
    "expired",
  );
});
test("out-of-order overlap deltas never un-check-in or un-void a ticket or regress cursor", () => {
  const previous: Manifest = {
    ...m,
    tickets: [
      {
        ...m.tickets[0],
        check_in_status: "CHECKED_IN",
        checked_in_at: new Date().toISOString(),
        voided: true,
      },
    ],
  };
  const incoming: Manifest = {
    ...m,
    next_since: "1200",
    tickets: [{ ...m.tickets[0], sync_seq: "1200" }],
  };
  const merged = mergeManifest(previous, incoming, []);
  expect(merged.tickets[0].check_in_status).toBe("CHECKED_IN");
  expect(merged.tickets[0].voided).toBe(true);
  expect(merged.next_since).toBe("1500");
});
