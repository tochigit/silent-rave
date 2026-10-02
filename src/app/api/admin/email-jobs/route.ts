import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { guardApi, ADMIN_API_ROLES } from "@/lib/auth/guards";
import { emailJobSelect, emailJobDto } from "@/lib/email/dto";
const schema = z.object({ status: z.enum(["QUEUED", "SENT", "DELIVERED", "BOUNCED", "FAILED"]).optional(), order_id: z.uuid().optional(), page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) });
export async function GET(request: NextRequest) {
  const guard = await guardApi(request, ADMIN_API_ROLES); if (!guard.ok) return guard.response;
  const parsed = schema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid filters or pagination." }, { status: 400 });
  const { status, order_id: orderId, page, limit } = parsed.data;
  const where = { status, orderId };
  const [jobs, total] = await Promise.all([db.emailJob.findMany({ where, select: emailJobSelect, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (page - 1) * limit, take: limit }), db.emailJob.count({ where })]);
  return NextResponse.json({ jobs: jobs.map(emailJobDto), pagination: { page, total_pages: Math.ceil(total / limit), total } }, { headers: { "Cache-Control": "private, no-store" } });
}
