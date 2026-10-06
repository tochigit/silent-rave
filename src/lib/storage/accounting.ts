import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getStorage } from "./index";
import { StorageCollisionError, StorageUnavailableError } from "./errors";
import { objectContract } from "./keys";

export async function storageIntent(key: string) {
  const contract = objectContract(key);
  await db.storageObject.upsert({ where: { key }, create: { key, kind: contract.kind, state: "UPLOADING", inputHash: contract.inputHash }, update: {} });
}
export async function storageStored(key: string, bytes: Uint8Array) {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await db.$executeRaw(Prisma.sql`UPDATE storage_objects SET state = CASE WHEN state = 'LINKED' THEN state ELSE 'STORED' END,
    stored_bytes = ${BigInt(bytes.length)}, stored_sha256 = ${sha256}, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE key = ${key}`);
}
export async function storageFailed(key: string, error: unknown) {
  const code = error instanceof StorageCollisionError ? "COLLISION" : error instanceof StorageUnavailableError ? error.code : "BUSINESS_ROLLBACK";
  await db.storageObject.updateMany({ where: { key, state: { not: "LINKED" } }, data: { lastError: code } });
}
export async function storageLinked(tx: Prisma.TransactionClient, key: string, type: "ORDER" | "TICKET" | "EVENT", id: string) {
  await tx.storageObject.update({ where: { key }, data: { state: "LINKED", linkedEntityType: type, linkedEntityId: id, lastError: null } });
}
/** UUID allocation retries are bounded; a collision never replaces evidence. */
export async function storeNewImage(allocate: () => string, bytes: Uint8Array, contentType: string): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const key = allocate(); await storageIntent(key);
    try {
      await getStorage().putObject(key, bytes, contentType); await storageStored(key, bytes); return key;
    } catch (error) {
      await storageFailed(key, error);
      if (!(error instanceof StorageCollisionError)) throw error;
    }
  }
  throw new StorageUnavailableError("COLLISION_METADATA");
}
