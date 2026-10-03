import type { NextRequest } from "next/server";
import { z } from "zod";
import { guardApi, ADMIN_API_ROLES } from "@/lib/auth/guards";
import { originCheck } from "@/lib/auth/origin";
import { adminOperation } from "@/lib/operations/admin";
import { failure, reply } from "@/lib/operations/http";
import { pushOperation } from "@/lib/operations/push";
import { placeOperation } from "@/lib/operations/places";
async function handle(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const guard = await guardApi(request, ADMIN_API_ROLES);
  if (!guard.ok) return guard.response;
  const origin = originCheck(request, "admin");
  if (!origin.ok) return origin.response;
  try {
    const { path } = await context.params;
    return path[0] === "places"
      ? await placeOperation(request, path, guard.user.id)
      : path[0] === "push"
        ? await pushOperation(request, path, guard.user.id)
        : await adminOperation(request, path, guard.user.id);
  } catch (error) {
    if (error instanceof z.ZodError)
      return reply({ error: "Invalid request." }, 400);
    return failure(error);
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
