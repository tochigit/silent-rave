import { NextResponse, type NextRequest } from "next/server";
import { guardApi, ADMIN_API_ROLES } from "@/lib/auth/guards";
import { getStorage, verifyStorageSignature } from "@/lib/storage";
import { objectContract } from "@/lib/storage/keys";
import { privateHeaders } from "@/lib/auth/policy";
export const runtime = "nodejs";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/storage/object?key=<path>&exp=<epochSec>&sig=<base64url>
//
// Serves a PRIVATE stored object (proof images) for the OWNER review screens
// behind the local storage driver's signed-URL scheme (04: short-lived
// 60–120 s signed URLs, OWNER only). THREE gates, all mandatory:
//   1. an OWNER session (guardApi — and proxy.ts gates /api/admin/* first),
//   2. a valid HMAC signature over (key ":" exp) — constant-time compared,
//   3. a not-yet-passed expiry — enforced at read time, so an expired URL is
//      dead even if nothing else changed.
// A leaked URL without an OWNER session is useless; an OWNER session without
// a valid signature cannot enumerate or fetch arbitrary objects.
//
// GET is not state-changing → no Origin check (06). Proof files are NEVER
// served publicly — there is no unauthenticated route to any storage object.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const guard = await guardApi(request, ADMIN_API_ROLES);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const expParam = url.searchParams.get("exp");
  const sig = url.searchParams.get("sig");

  if (!key || expParam === null || !sig) {
    return NextResponse.json({ error: "Incomplete signed URL." }, { status: 400, headers: privateHeaders });
  }
  const exp = Number(expParam);
  if (!Number.isSafeInteger(exp)) {
    return NextResponse.json({ error: "Malformed signed URL." }, { status: 400, headers: privateHeaders });
  }

  let check;
  try { check = verifyStorageSignature(key, exp, sig); }
  catch { return NextResponse.json({ error: "Image temporarily unavailable." }, { status: 503, headers: privateHeaders }); }
  if (!check.ok) {
    const status = check.reason === "expired" ? 410 : 403;
    return NextResponse.json(
      { error: check.reason === "expired" ? "Signed URL has expired." : "Invalid signature." },
      { status, headers: privateHeaders }
    );
  }

  // Defense in depth: the proof-images namespace is only ever handed out as
  // signed URLs minted from actual payment_proofs rows.
  if (!key.startsWith("proofs/")) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 403, headers: privateHeaders });
  }

  let object;
  try {
    if (objectContract(key).kind !== "PROOF") throw new Error();
    object = await getStorage().getObject(key);
  } catch {
    return NextResponse.json({ error: "Image temporarily unavailable." }, { status: 503, headers: privateHeaders });
  }
  if (!object) {
    return NextResponse.json({ error: "Not found." }, { status: 404, headers: privateHeaders });
  }

  const live = await guardApi(request, ADMIN_API_ROLES);
  if (!live.ok) return live.response;
  const finalSignature = verifyStorageSignature(key, exp, sig);
  if (!finalSignature.ok) return NextResponse.json({ error: "Signed URL has expired." }, { status: 410, headers: privateHeaders });

  return new NextResponse(new Uint8Array(object.bytes), {
    status: 200,
    headers: {
      ...privateHeaders,
      "content-type": object.contentType,
      "cache-control": "private, no-store", // never cached — URLs are short-lived
    },
  });
}
