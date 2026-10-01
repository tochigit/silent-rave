import { createHash, createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Ticket QR tokens — Ed25519 signatures (05-ticketing-and-qr.md v2.1).
//
//   qr_token = "1." + kid + "." + base64url(ticket_id_16B || event_id_16B)
//                     + "." + base64url(Ed25519_sign(priv, "SR1" || ticket_id_16B || event_id_16B))
//
// Why asymmetric (05): offline verification with HMAC would put the shared
// secret on every staff phone; with Ed25519 phones hold only a PUBLIC key —
// they can verify but never mint. The server signs with Node's built-in
// Ed25519; the scanner PWA uses @noble/ed25519 (NOT this module).
//
// Domain separation: the "SR1" prefix is part of the signed message, so a
// signature can never be replayed as some other protocol's Ed25519 signature
// over the same bytes. event_id is INSIDE the signed payload so a device can
// reject another event's ticket even when it is not in the manifest.
//
// Keys (env): TICKET_SIGNING_PRIVATE_KEY = base64url of the 32-byte SEED
// (wrapped into PKCS#8 DER here — the fixed 16-byte prefix 302e0201003005
// 06032b657004220420 + seed), TICKET_SIGNING_KID = short key id. Generate
// with `bun run keygen:ed25519` (scripts/keygen-ed25519.ts).
//
// ROTATION = multiple public keys (05): signing always uses
// TICKET_SIGNING_KID; verification additionally accepts the optional
// TICKET_SIGNING_PUBLIC_KEYS_JSON = [{"kid":"…","publicKey":"<base64url 32B>"}]
// list of OLD public keys so already-minted tickets keep verifying until they
// are irrelevant. Public keys are served in the scanner manifest (03).
//
// Verification order (05 — server and device identical):
//   parse → check version and kid known → verify signature (constant-time
//   inside the library) → check event_id → only then any lookup.
// Invalid signatures never touch the database (the check-in route's job).
// ─────────────────────────────────────────────────────────────────────────────

const TOKEN_VERSION = "1";
const DOMAIN_SEPARATION_PREFIX = Buffer.from("SR1", "utf8");
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SigningKey = {
  kid: string;
  privateKey: ReturnType<typeof createPrivateKey>;
  publicKeyRaw: Buffer;
};

export type VerificationKey = {
  kid: string;
  publicKeyRaw: Buffer;
};

// ── key loading ──────────────────────────────────────────────────────────────

let cachedSigningKey: SigningKey | null = null;

/** Load + cache the signing key from env. Throws loudly when misconfigured. */
export function getSigningKey(): SigningKey {
  if (cachedSigningKey) return cachedSigningKey;

  const seedB64 = process.env.TICKET_SIGNING_PRIVATE_KEY;
  const kid = process.env.TICKET_SIGNING_KID;
  if (!seedB64 || !kid) {
    throw new Error(
      "TICKET_SIGNING_PRIVATE_KEY / TICKET_SIGNING_KID are unset — refusing to mint QR tokens. Generate with `bun run keygen:ed25519` (see .env.example)."
    );
  }

  const seed = Buffer.from(seedB64, "base64url");
  if (seed.length !== 32) {
    throw new Error(`TICKET_SIGNING_PRIVATE_KEY must decode to 32 bytes (got ${seed.length}).`);
  }
  if (!/^[\w-]{1,64}$/.test(kid)) {
    throw new Error(`TICKET_SIGNING_KID must be a short slug (got ${JSON.stringify(kid)}).`);
  }

  const pkcs8 = Buffer.concat([PKCS8_ED25519_PREFIX, seed]);
  const privateKey = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  // SPKI export requires a PUBLIC KeyObject — derive it from the private key.
  const publicKeyObject = createPublicKey(privateKey);
  const spki = publicKeyObject.export({ format: "der", type: "spki" }) as Buffer;
  if (spki.length !== 44) throw new Error("unexpected SPKI length for Ed25519 key");
  const publicKeyRaw = Buffer.from(spki.subarray(12));

  cachedSigningKey = { kid, privateKey, publicKeyRaw };
  return cachedSigningKey;
}

let cachedVerificationKeys: Map<string, VerificationKey> | null = null;

/**
 * All keys accepted for VERIFICATION: the current signing key's kid, plus any
 * old kids listed in optional TICKET_SIGNING_PUBLIC_KEYS_JSON (rotation).
 */
export function getVerificationKeys(): Map<string, VerificationKey> {
  if (cachedVerificationKeys) return cachedVerificationKeys;

  const map = new Map<string, VerificationKey>();
  const current = getSigningKey();
  map.set(current.kid, { kid: current.kid, publicKeyRaw: current.publicKeyRaw });

  const extraJson = process.env.TICKET_SIGNING_PUBLIC_KEYS_JSON;
  if (extraJson && extraJson.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(extraJson);
    } catch {
      throw new Error("TICKET_SIGNING_PUBLIC_KEYS_JSON is not valid JSON.");
    }
    if (!Array.isArray(parsed)) {
      throw new Error("TICKET_SIGNING_PUBLIC_KEYS_JSON must be an array of {kid, publicKey}.");
    }
    for (const entry of parsed) {
      if (typeof entry !== "object" || entry === null) {
        throw new Error("TICKET_SIGNING_PUBLIC_KEYS_JSON entries must be objects.");
      }
      const { kid, publicKey } = entry as Record<string, unknown>;
      if (typeof kid !== "string" || typeof publicKey !== "string") {
        throw new Error("TICKET_SIGNING_PUBLIC_KEYS_JSON entries need string kid + publicKey.");
      }
      const raw = Buffer.from(publicKey, "base64url");
      if (raw.length !== 32) {
        throw new Error(`public key for kid ${kid} must decode to 32 bytes.`);
      }
      map.set(kid, { kid, publicKeyRaw: raw });
    }
  }

  cachedVerificationKeys = map;
  return cachedVerificationKeys;
}

// Test seam: clear key caches after env changes (used by tests only).
export function resetKeyCachesForTests(): void {
  cachedSigningKey = null;
  cachedVerificationKeys = null;
}

// ── uuid ↔ 16 raw bytes ─────────────────────────────────────────────────────

/** Parse a UUID string into its 16 raw bytes (throws on malformed input). */
export function uuidToBytes(uuid: string): Buffer {
  if (!UUID_RE.test(uuid)) throw new Error(`not a UUID: ${JSON.stringify(uuid)}`);
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}

/** Format 16 raw bytes back into a canonical lowercase UUID string. */
export function bytesToUuid(bytes: Buffer): string {
  if (bytes.length !== 16) throw new Error(`expected 16 bytes, got ${bytes.length}`);
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function base64urlNoPad(buf: Buffer): string {
  return buf.toString("base64url");
}

// ── sign / verify ────────────────────────────────────────────────────────────

/** Mint the QR token for one ticket (pure computation — safe inside a txn). */
export function signTicketToken(ticketId: string, eventId: string): string {
  const ticketBytes = uuidToBytes(ticketId);
  const eventBytes = uuidToBytes(eventId);
  const payload = Buffer.concat([ticketBytes, eventBytes]);
  const message = Buffer.concat([DOMAIN_SEPARATION_PREFIX, payload]);
  const key = getSigningKey();
  const signature = edSign(null, message, key.privateKey);
  return [TOKEN_VERSION, key.kid, base64urlNoPad(payload), base64urlNoPad(signature)].join(".");
}

export type TicketTokenVerification =
  | { ok: true; ticketId: string; eventId: string; kid: string }
  | { ok: false; reason: "malformed" | "bad_version" | "unknown_kid" | "bad_signature" };

/**
 * Verify a scanned/entered token. Signature is verified BEFORE any DB access;
 * the event_id check is the CALLER's job after this returns ok (05's order:
 * parse → version+kid → signature → event → lookup).
 */
export function verifyTicketToken(token: string): TicketTokenVerification {
  if (typeof token !== "string") return { ok: false, reason: "malformed" };

  const parts = token.split(".");
  if (parts.length !== 4) return { ok: false, reason: "malformed" };
  const [version, kid, payloadB64, sigB64] = parts;
  if (!version || !kid || !payloadB64 || !sigB64) return { ok: false, reason: "malformed" };

  if (version !== TOKEN_VERSION) return { ok: false, reason: "bad_version" };

  const keys = getVerificationKeys();
  const verificationKey = keys.get(kid);
  if (!verificationKey) return { ok: false, reason: "unknown_kid" };

  let payload: Buffer;
  let signature: Buffer;
  try {
    payload = Buffer.from(payloadB64, "base64url");
    signature = Buffer.from(sigB64, "base64url");
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (payload.length !== 32 || signature.length !== 64) {
    return { ok: false, reason: "malformed" };
  }

  const ticketBytes = payload.subarray(0, 16);
  const eventBytes = payload.subarray(16, 32);
  const message = Buffer.concat([DOMAIN_SEPARATION_PREFIX, payload]);
  const publicKey = createPublicKey({
    key: Buffer.concat([SPKI_ED25519_PREFIX, verificationKey.publicKeyRaw]),
    format: "der",
    type: "spki",
  });
  // Node's Ed25519 verify is constant-time inside the library (05).
  const valid = edVerify(null, message, publicKey, signature);
  if (!valid) return { ok: false, reason: "bad_signature" };

  return {
    ok: true,
    ticketId: bytesToUuid(ticketBytes),
    eventId: bytesToUuid(eventBytes),
    kid,
  };
}

/** The signing key's public half in base64url (for the manifest / rotation). */
export function currentPublicKeyB64url(): string {
  return base64urlNoPad(getSigningKey().publicKeyRaw);
}

/** Deterministic kid suggestion for a raw public key (used by keygen + tests). */
export function suggestKidForPublicKey(publicKeyRaw: Buffer): string {
  return "sr1-" + createHash("sha256").update(publicKeyRaw).digest("hex").slice(0, 8);
}
