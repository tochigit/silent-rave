export class StorageUnavailableError extends Error {
  constructor(public code: "CONFIG" | "KEY" | "TYPE" | "SIZE" | "PROVIDER" | "TIMEOUT" | "COLLISION_METADATA" = "PROVIDER") {
    super("Storage temporarily unavailable."); this.name = "StorageUnavailableError";
  }
}
export class StorageCollisionError extends Error {
  constructor() { super("Storage object already exists."); this.name = "StorageCollisionError"; }
}
