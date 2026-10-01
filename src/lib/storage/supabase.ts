import type { PutResult, StorageAdapter, StoredObject } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Supabase Storage driver — DOCUMENTED STUB (not implemented in this phase).
//
// Production plan (implements the SAME StorageAdapter interface, so call sites
// never change):
//
//   1. Create a PRIVATE bucket (e.g. "proofs") in the Supabase dashboard;
//      no public access policy at all — objects are readable only via signed
//      URLs minted with the service-role key, which lives server-side only.
//   2. Add `@supabase/supabase-js` and construct the admin client:
//        const supabase = createClient(
//          process.env.SUPABASE_URL!,
//          process.env.SUPABASE_SERVICE_ROLE_KEY!,   // SERVER-SIDE ONLY
//          { auth: { persistSession: false } }
//        );
//   3. putObject:   supabase.storage.from("proofs").upload(key, bytes,
//                      { contentType, upsert: false })
//   4. getObject:   supabase.storage.from("proofs").download(key) → blob
//   5. createSignedUrl:
//                    supabase.storage.from("proofs").createSignedUrl(key, ttl,
//                      { download: false })
//      Supabase returns https://…/object/signature/…&token=… — the token IS
//      the authz for that object, so the URL must still only ever be handed
//      to an OWNER session (the route that mints it checks the session first;
//      there is no separate serving route for the Supabase driver — unlike
//      the local driver, the storage host serves the bytes directly).
//   6. Env additions: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, plus the
//      bucket name (STORAGE_BUCKET, default "proofs").
//
// Until this lands, constructing the driver throws — the env switch
// STORAGE_DRIVER=supabase is the deployment marker, not a silent fallback.
// ─────────────────────────────────────────────────────────────────────────────

export class SupabaseStorage implements StorageAdapter {
  readonly driver = "supabase";

  constructor() {
    throw new Error(
      "SupabaseStorage is a documented stub for this phase — it is not implemented yet. " +
        "Keep STORAGE_DRIVER=local for local dev and implement the plan in this file's header before switching it on."
    );
  }

  putObject(_key: string, _bytes: Uint8Array, _contentType: string): Promise<PutResult> {
    return Promise.reject(new Error("not implemented (stub)"));
  }

  getObject(_storagePath: string): Promise<StoredObject | null> {
    return Promise.reject(new Error("not implemented (stub)"));
  }

  createSignedUrl(_storagePath: string, _ttlSeconds: number): Promise<string> {
    return Promise.reject(new Error("not implemented (stub)"));
  }
}
