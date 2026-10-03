import { after, type NextRequest } from "next/server";
import { guardApi, ADMIN_API_ROLES } from "@/lib/auth/guards";
import { originCheck } from "@/lib/auth/origin";
import { body, failure, reply } from "@/lib/operations/http";
import { issueOrder, issueSchema } from "@/lib/operations/issue";
import { kickEmailJobs } from "@/lib/email/kick";
// Static path is required: /orders/[id] otherwise takes precedence over the
// management catch-all and correctly returns 405 for a POST to "issue".
export async function POST(request: NextRequest) {
  const guard = await guardApi(request, ADMIN_API_ROLES);
  if (!guard.ok) return guard.response;
  const origin = originCheck(request, "admin");
  if (!origin.ok) return origin.response;
  try {
    const result = await issueOrder(
      await body(request, issueSchema),
      guard.user.id,
    );
    after(() => kickEmailJobs());
    return reply(result, 201);
  } catch (error) {
    return failure(error);
  }
}
