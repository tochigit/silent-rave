// ─────────────────────────────────────────────────────────────────────────────
// Storage adapter interface (proof images + future banners/PDFs).
//
// Contract (04-manual-payment.md):
//   • Proof images live in a PRIVATE bucket — never public, never a guessable
//     URL. The only access path is a short-lived signed URL minted per
//     request for OWNER review screens (60–120 s).
//   • putObject keys are server-generated (uuid-ish, no user input in paths).
//
// Drivers:
//   • local  — dev fixture: files under ./.storage-local (gitignored, 0600),
//              signed URLs are HMAC'd query params verified by
//              /api/admin/storage/object (OWNER + signature + expiry).
//   • supabase — production: bounded HTTP; application-signed private serving.
// Selected via STORAGE_DRIVER (default "local").
// ─────────────────────────────────────────────────────────────────────────────

export type PutResult = { storagePath: string };

export type StoredObject = {
  bytes: Uint8Array;
  contentType: string;
};

export interface StorageAdapter {
  readonly driver: string;

  /** Store bytes under a server-generated key. Returns the private storage path. */
  putObject(key: string, bytes: Uint8Array, contentType: string): Promise<PutResult>;

  /** Read an object back (server-side use only, e.g. re-serving via signed URL routes). */
  getObject(storagePath: string): Promise<StoredObject | null>;

  /**
   * Mint a short-lived (60–120 s) signed URL for OWNER-only access. The URL
   * must only be usable together with an OWNER session — the serving route
   * re-checks authz (see /api/admin/storage/object for the local driver).
   */
  createSignedUrl(storagePath: string, ttlSeconds: number): Promise<string>;
}
