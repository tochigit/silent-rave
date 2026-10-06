import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, stat, link, unlink } from "node:fs/promises";
import path from "node:path";
import { objectContract, validObject } from "./keys";
import { StorageCollisionError, StorageUnavailableError } from "./errors";
import { applicationSignedUrl } from "./signatures";
import type { PutResult, StorageAdapter, StoredObject } from "./types";
export { signStoragePath, verifyStorageSignature } from "./signatures";

export class LocalDiskStorage implements StorageAdapter {
  readonly driver = "local";
  private resolve(key: string): string {
    objectContract(key);
    return path.join(process.env.LOCAL_STORAGE_DIR ?? path.join(process.cwd(), ".storage-local"), ...key.split("/"));
  }
  async putObject(key: string, bytes: Uint8Array, contentType: string): Promise<PutResult> {
    const contract = objectContract(key); const absolute = this.resolve(key);
    if (contract.contentType !== contentType || !validObject(bytes, contentType)) throw new StorageUnavailableError("TYPE");
    if (bytes.length > contract.limit) throw new StorageUnavailableError("SIZE");
    const temporary = `${absolute}.${randomUUID()}.pending`;
    try {
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
      await link(temporary, absolute); // Atomic no-overwrite publication; readers never observe a partial write.
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        if (contract.kind !== "PDF") throw new StorageCollisionError();
        const existing = await this.getObject(key);
        if (!existing) throw new StorageUnavailableError("COLLISION_METADATA");
      } else throw new StorageUnavailableError("PROVIDER");
    } finally { await unlink(temporary).catch(() => {}); }
    return { storagePath: key };
  }
  async getObject(key: string): Promise<StoredObject | null> {
    const contract = objectContract(key); const absolute = this.resolve(key);
    try {
      const info = await stat(absolute);
      if (!info.isFile() || info.size > contract.limit) throw new StorageUnavailableError("SIZE");
      const bytes = await readFile(absolute);
      if (bytes.length > contract.limit || !validObject(bytes, contract.contentType)) throw new StorageUnavailableError("TYPE");
      return { bytes: new Uint8Array(bytes), contentType: contract.contentType };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      if (error instanceof StorageUnavailableError) throw error;
      throw new StorageUnavailableError("PROVIDER");
    }
  }
  async createSignedUrl(key: string, _ttlSeconds: number): Promise<string> { return applicationSignedUrl(key); }
}
