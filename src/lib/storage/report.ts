import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { getStorage } from "./index";
import { objectContract } from "./keys";
type ReportItem = {
  key: string; kind: string | null; state: string | null;
  stored_bytes: string | null; stored_sha256: string | null; input_hash: string | null;
  references: Array<{ type: string; id: string }>;
  object_status: "UNCHECKED" | "PRESENT" | "MISSING" | "UNAVAILABLE";
  flags: string[]; deletion_allowed: false;
};

/** Operator-only, bounded keyset dry-run. No ledger changes, list calls or object deletion. */
export async function storageReport(after = "", verify = false) {
  const take = verify ? 3 : 25; // Worst-case private reads include two 5s operations per PDF; stays within a synchronous invocation.
  const rows = await db.$queryRaw<Array<{ key: string; kind: string | null; state: string | null; created_at: Date | null; stored_bytes: bigint | null; stored_sha256: string | null; input_hash: string | null; last_error: string | null; linked_entity_id: string | null; linked_entity_type: string | null; references: Prisma.JsonValue }>>(Prisma.sql`
    WITH refs AS (
      SELECT storage_path AS key, 'ORDER' AS type, order_id AS id FROM payment_proofs
      UNION ALL SELECT pdf_url, 'TICKET', id FROM ticket_units WHERE pdf_url IS NOT NULL
      UNION ALL SELECT 'banners/' || substring(banner_image_url FROM 14), 'EVENT', id FROM events WHERE banner_image_url LIKE '/api/banners/%'
    ), keys AS (SELECT key FROM storage_objects UNION SELECT key FROM refs)
    SELECT k.key, s.kind, s.state, s.created_at, s.stored_bytes, s.stored_sha256, s.input_hash, s.last_error,
      s.linked_entity_id, s.linked_entity_type,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('type', r.type, 'id', r.id)) FROM refs r WHERE r.key = k.key), '[]'::jsonb) AS references
    FROM keys k LEFT JOIN storage_objects s ON s.key = k.key
    WHERE k.key > ${after} ORDER BY k.key LIMIT ${take + 1}`);
  const page = rows.slice(0, take);
  const items: ReportItem[] = [];
  for (const row of page) {
    const refs = row.references as Array<{ type: string; id: string }>;
    const flags: string[] = [];
    try {
      const contract = objectContract(row.key);
      if (row.kind && (row.kind !== contract.kind || row.input_hash && row.input_hash !== contract.inputHash)) flags.push("KIND_INPUT_MISMATCH");
    } catch { flags.push("UNSUPPORTED_LEGACY_KEY"); }
    if (!row.state) flags.push("UNACCOUNTED_REFERENCE");
    if (row.state === "LEGACY_REFERENCED") flags.push("LEGACY_METADATA_UNKNOWN");
    if (row.last_error) flags.push("FAILED_WRITE");
    if (row.state === "UPLOADING") flags.push("INCOMPLETE_WRITE");
    if (row.linked_entity_id && !refs.some(r => r.type === row.linked_entity_type && r.id === row.linked_entity_id)) flags.push("REPLACED_REFERENCE");
    const gracePassed = !!row.created_at && Date.now() - row.created_at.getTime() >= 24 * 3600_000;
    if (!refs.length) flags.push(gracePassed ? "ORPHAN_CANDIDATE" : "INSPECTION_GRACE");
    let objectStatus: "UNCHECKED" | "PRESENT" | "MISSING" | "UNAVAILABLE" = "UNCHECKED";
    if (verify && !flags.includes("UNSUPPORTED_LEGACY_KEY")) {
      try {
        const object = await getStorage().getObject(row.key);
        objectStatus = object ? "PRESENT" : "MISSING";
        if (!object) flags.push("MISSING_OBJECT");
        else if ((row.stored_bytes !== null && row.stored_bytes !== BigInt(object.bytes.length)) || (row.stored_sha256 !== null && row.stored_sha256 !== createHash("sha256").update(object.bytes).digest("hex"))) flags.push("BYTE_METADATA_MISMATCH");
      } catch { objectStatus = "UNAVAILABLE"; flags.push("PROVIDER_UNAVAILABLE"); }
    }
    items.push({ key: row.key, kind: row.kind, state: row.state, stored_bytes: row.stored_bytes?.toString() ?? null, stored_sha256: row.stored_sha256, input_hash: row.input_hash, references: refs, object_status: objectStatus, flags, deletion_allowed: false });
  }
  return { mode: "DRY_RUN", inspection_grace_hours: 24, deletion_allowed: false, items, next: rows.length > take ? page.at(-1)!.key : null };
}
