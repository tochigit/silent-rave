// ─────────────────────────────────────────────────────────────────────────────
// Silent Rave — Ed25519 ticket-signing keygen (05-ticketing-and-qr.md).
//
//   bun run keygen:ed25519
//
// Generates a fresh Ed25519 keypair with Node's built-in crypto and prints the
// three env lines to add to .env / .env.example:
//
//   TICKET_SIGNING_PRIVATE_KEY  — base64url of the 32-byte SEED (server-only).
//                                  Wrapped into PKCS#8 DER in code at load time.
//   TICKET_SIGNING_KID          — short key id: "sr1-" + 8 hex chars of
//                                  SHA-256(public key). Stable per key.
//   TICKET_SIGNING_PUBLIC_KEY   — base64url of the 32-byte public key.
//                                  Informational (for rotating key sets / the
//                                  manifest); verification derives the current
//                                  kid's public key from the private key.
//
// ROTATION (05): generate a new pair, set the new PRIVATE_KEY + KID as the
// signing key, and add the OLD public key to TICKET_SIGNING_PUBLIC_KEYS_JSON
// (see src/lib/tickets/qr.ts) so already-minted tickets keep verifying until
// they are irrelevant. Public keys are served to the scanner manifest (03).
// ─────────────────────────────────────────────────────────────────────────────

import { createHash, generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");

// Raw 32-byte seed: PKCS#8 DER for Ed25519 is a fixed 16-byte prefix + seed.
const pkcs8Der = privateKey.export({ format: "der", type: "pkcs8" }) as Buffer;
if (pkcs8Der.length !== 48 || !pkcs8Der.subarray(0, 16).equals(Buffer.from("302e020100300506032b657004220420", "hex"))) {
  throw new Error("unexpected PKCS#8 DER layout for Ed25519 key");
}
const seed = pkcs8Der.subarray(16);

// Raw 32-byte public key: SPKI DER is a fixed 12-byte prefix + key.
const spkiDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
if (spkiDer.length !== 44 || !spkiDer.subarray(0, 12).equals(Buffer.from("302a300506032b6570032100", "hex"))) {
  throw new Error("unexpected SPKI DER layout for Ed25519 key");
}
const rawPublicKey = spkiDer.subarray(12);

const kid = "sr1-" + createHash("sha256").update(rawPublicKey).digest("hex").slice(0, 8);

console.log(`TICKET_SIGNING_PRIVATE_KEY=${seed.toString("base64url")}`);
console.log(`TICKET_SIGNING_KID=${kid}`);
console.log(`TICKET_SIGNING_PUBLIC_KEY=${rawPublicKey.toString("base64url")}`);
