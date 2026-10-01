import { describe, expect, test } from "bun:test";
import {
  getSigningKey,
  resetKeyCachesForTests,
  signTicketToken,
  suggestKidForPublicKey,
  verifyTicketToken,
} from "@/lib/tickets/qr";
import { deriveStatusToken, verifyStatusToken } from "@/lib/orders/status-token";
import { signStoragePath, verifyStorageSignature } from "@/lib/storage/local";
import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import "./load-env";

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests — Ed25519 QR tokens (05), derived status tokens (02 v2.1), and
// the local storage driver's signed-URL scheme. No server or DB needed.
// ─────────────────────────────────────────────────────────────────────────────

const TICKET_ID = "67c25b75-58cf-4dd5-b7c1-cd25946933d2";
const EVENT_ID = "447fb93b-cefe-49df-91ed-ac7cfba6d5e8";
const OTHER_EVENT_ID = "0fb06513-6b9d-46ab-bb48-1913b97ce645";
const ORDER_ID = "11111111-2222-3333-4444-555555555555";

describe("QR token module (Ed25519, 05)", () => {
  test("valid token verifies and round-trips ticket_id + event_id", () => {
    const token = signTicketToken(TICKET_ID, EVENT_ID);
    // Format: "1." + kid + "." + b64url(32B payload) + "." + b64url(64B sig)
    expect(token.split(".")).toHaveLength(4);
    const [version, kid] = token.split(".");
    expect(version).toBe("1");
    expect(process.env.TICKET_SIGNING_KID).toBe(kid);
    const result = verifyTicketToken(token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ticketId).toBe(TICKET_ID);
      expect(result.eventId).toBe(EVENT_ID);
      expect(result.kid).toBe(kid);
    }
  });

  test("tampered payload → bad_signature (signature covers the payload)", () => {
    const token = signTicketToken(TICKET_ID, EVENT_ID);
    const parts = token.split(".");
    // flip one bit inside the payload: swap two base64url chars
    const payload = parts[2];
    parts[2] = payload[0] === "A" ? "B" + payload.slice(1) : "A" + payload.slice(1);
    const result = verifyTicketToken(parts.join("."));
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  test("tampered signature → bad_signature", () => {
    const token = signTicketToken(TICKET_ID, EVENT_ID);
    const parts = token.split(".");
    const sig = parts[3];
    parts[3] = sig[0] === "A" ? "B" + sig.slice(1) : "A" + sig.slice(1);
    const result = verifyTicketToken(parts.join("."));
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  test("truncated signature → malformed", () => {
    const token = signTicketToken(TICKET_ID, EVENT_ID);
    const parts = token.split(".");
    parts[3] = parts[3].slice(0, 40); // 30 decoded bytes, not 64
    expect(verifyTicketToken(parts.join("."))).toEqual({ ok: false, reason: "malformed" });
  });

  test("wrong kid → unknown_kid (before any signature math)", () => {
    const token = signTicketToken(TICKET_ID, EVENT_ID);
    const parts = token.split(".");
    parts[1] = "sr1-00000000";
    expect(verifyTicketToken(parts.join("."))).toEqual({ ok: false, reason: "unknown_kid" });
  });

  test("wrong version → bad_version", () => {
    const token = signTicketToken(TICKET_ID, EVENT_ID);
    expect(verifyTicketToken(token.replace(/^1\./, "2."))).toEqual({ ok: false, reason: "bad_version" });
  });

  test("truncated / garbage input → malformed, never throws", () => {
    for (const garbage of ["", ".", "1", "1.kid", "1.kid.payload", "1.kid.payload.sig.extra", "!!!", "1..."]) {
      const result = verifyTicketToken(garbage);
      expect(result.ok).toBe(false);
    }
  });

  test("wrong event: signature is valid but event_id inside the payload differs — the caller's event check catches it (05 verification order)", () => {
    const token = signTicketToken(TICKET_ID, OTHER_EVENT_ID);
    const result = verifyTicketToken(token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.eventId).toBe(OTHER_EVENT_ID);
      expect(result.eventId).not.toBe(EVENT_ID); // a device scoped to EVENT_ID rejects
    }
  });

  test("multiple public keys: old kid keeps verifying after rotation (extra keys via TICKET_SIGNING_PUBLIC_KEYS_JSON)", () => {
    const oldKey = getSigningKey();
    const oldToken = signTicketToken(TICKET_ID, EVENT_ID);

    // Rotate: fresh keypair as the signing key, old public key as an extra verifier.
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const oldSeedPkcs8 = createPrivateKey({
      key: Buffer.concat([
        Buffer.from("302e020100300506032b657004220420", "hex"),
        Buffer.from(process.env.TICKET_SIGNING_PRIVATE_KEY!, "base64url"),
      ]),
      format: "der",
      type: "pkcs8",
    });
    const oldPublicRaw = (createPublicKey(oldSeedPkcs8).export({
      format: "der",
      type: "spki",
    }) as Buffer).subarray(12);
    expect(oldPublicRaw.equals(oldKey.publicKeyRaw)).toBe(true);

    const newSeed = (privateKey.export({ format: "der", type: "pkcs8" }) as Buffer).subarray(16);
    const newPublicRaw = (publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(12);
    const newKid = suggestKidForPublicKey(newPublicRaw);

    const previous = {
      private: process.env.TICKET_SIGNING_PRIVATE_KEY,
      kid: process.env.TICKET_SIGNING_KID,
      extra: process.env.TICKET_SIGNING_PUBLIC_KEYS_JSON,
    };
    try {
      process.env.TICKET_SIGNING_PRIVATE_KEY = newSeed.toString("base64url");
      process.env.TICKET_SIGNING_KID = newKid;
      process.env.TICKET_SIGNING_PUBLIC_KEYS_JSON = JSON.stringify([
        { kid: oldKey.kid, publicKey: oldPublicRaw.toString("base64url") },
      ]);
      resetKeyCachesForTests();

      // new tokens sign with the new kid
      const newToken = signTicketToken(TICKET_ID, EVENT_ID);
      expect(newToken.split(".")[1]).toBe(newKid);
      const newResult = verifyTicketToken(newToken);
      expect(newResult.ok).toBe(true);

      // old tokens still verify via the extra public key
      const oldResult = verifyTicketToken(oldToken);
      expect(oldResult.ok).toBe(true);
      if (oldResult.ok) expect(oldResult.kid).toBe(oldKey.kid);
    } finally {
      process.env.TICKET_SIGNING_PRIVATE_KEY = previous.private;
      process.env.TICKET_SIGNING_KID = previous.kid;
      process.env.TICKET_SIGNING_PUBLIC_KEYS_JSON = previous.extra;
      resetKeyCachesForTests();
    }
  });
});

describe("Derived status token (02 v2.1)", () => {
  test("derived token verifies; recomputation is deterministic", () => {
    const token = deriveStatusToken(ORDER_ID, 1);
    expect(token).toBe(deriveStatusToken(ORDER_ID, 1));
    expect(verifyStatusToken(ORDER_ID, 1, token)).toBe(true);
  });

  test("wrong token (one char changed) fails", () => {
    const token = deriveStatusToken(ORDER_ID, 1);
    const tampered = token[0] === "A" ? "B" + token.slice(1) : "A" + token.slice(1);
    expect(verifyStatusToken(ORDER_ID, 1, tampered)).toBe(false);
  });

  test("right token, wrong order id fails", () => {
    const token = deriveStatusToken(ORDER_ID, 1);
    expect(verifyStatusToken(OTHER_EVENT_ID, 1, token)).toBe(false);
  });

  test("right token, wrong version fails (bumping the version invalidates old links)", () => {
    const token = deriveStatusToken(ORDER_ID, 1);
    expect(verifyStatusToken(ORDER_ID, 2, token)).toBe(false);
    const tokenV2 = deriveStatusToken(ORDER_ID, 2);
    expect(tokenV2).not.toBe(token);
    expect(verifyStatusToken(ORDER_ID, 2, tokenV2)).toBe(true);
  });

  test("malformed/truncated tokens fail without throwing", () => {
    for (const bad of ["", "!!!not-base64", "AAAA", "§§§", "a.b.c"]) {
      expect(verifyStatusToken(ORDER_ID, 1, bad)).toBe(false);
    }
  });

  test("comparison is constant-time by construction: the derived HMAC is always 32 bytes, compared with timingSafeEqual (32 vs 32); non-32-byte inputs are rejected on length, which is not secret", () => {
    // Structural assertion: every derived token decodes to exactly 32 bytes.
    const token = deriveStatusToken(ORDER_ID, 1);
    const decoded = Buffer.from(token, "base64url");
    expect(decoded.length).toBe(32);
    // And a wrong-length presented token is rejected before the compare.
    expect(verifyStatusToken(ORDER_ID, 1, decoded.subarray(0, 31).toString("base64url"))).toBe(false);
  });
});

describe("Local storage signed URLs", () => {
  test("sign → verify round-trips", () => {
    const { key, exp, sig } = signStoragePath("proofs/order123/abc.jpg", 90);
    expect(verifyStorageSignature(key, exp, sig)).toEqual({ ok: true });
  });

  test("expired signature → expired (checked against wall clock)", () => {
    const { key, exp, sig } = signStoragePath("proofs/order123/abc.jpg", -1);
    expect(verifyStorageSignature(key, exp, sig)).toEqual({ ok: false, reason: "expired" });
  });

  test("tampered signature → bad_signature (constant-time compare on the digest)", () => {
    const { key, exp, sig } = signStoragePath("proofs/order123/abc.jpg", 90);
    const tampered = sig[0] === "A" ? "B" + sig.slice(1) : "A" + sig.slice(1);
    expect(verifyStorageSignature(key, exp, tampered)).toEqual({ ok: false, reason: "bad_signature" });
  });

  test("signature for a different key/path → bad_signature", () => {
    const { key, exp, sig } = signStoragePath("proofs/order123/abc.jpg", 90);
    expect(verifyStorageSignature("proofs/other/file.jpg", exp, sig)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });
});
