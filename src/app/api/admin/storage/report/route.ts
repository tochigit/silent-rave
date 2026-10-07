import type { NextRequest } from "next/server";
import { ADMIN_API_ROLES, guardApi } from "@/lib/auth/guards";
import { reply, failure } from "@/lib/operations/http";
import { storageReport } from "@/lib/storage/report";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const guard = await guardApi(request, ADMIN_API_ROLES);
  if (!guard.ok) return guard.response;
  const after = request.nextUrl.searchParams.get("after") ?? "";
  if (after.length > 1024 || ![null, "0", "1"].includes(request.nextUrl.searchParams.get("verify"))) return reply({ error: "Invalid report request." }, 400);
  try {
    const report = await storageReport(after, request.nextUrl.searchParams.get("verify") === "1");
    const live = await guardApi(request, ADMIN_API_ROLES);
    return live.ok ? reply(report) : live.response;
  } catch (error) { return failure(error); }
}
