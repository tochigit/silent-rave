import { LocalDiskStorage } from "./local";
import { SupabaseStorage } from "./supabase";
import type { StorageAdapter } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Storage driver selection (STORAGE_DRIVER env; default "local" for dev).
// See types.ts for the adapter contract and each driver for its specifics.
// ─────────────────────────────────────────────────────────────────────────────

let cached: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (cached) return cached;
  const driver = (process.env.STORAGE_DRIVER ?? "local").trim().toLowerCase();
  switch (driver) {
    case "local":
      cached = new LocalDiskStorage();
      return cached;
    case "supabase":
      cached = new SupabaseStorage(); // throws — documented stub
      return cached;
    default:
      throw new Error(`Unknown STORAGE_DRIVER ${JSON.stringify(driver)} — use "local" or "supabase".`);
  }
}

export type { StorageAdapter, PutResult, StoredObject } from "./types";
export { signStoragePath, verifyStorageSignature } from "./local";
