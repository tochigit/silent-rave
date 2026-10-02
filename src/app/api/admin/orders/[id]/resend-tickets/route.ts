import { NextResponse, type NextRequest, after } from "next/server";
import { z } from "zod";
import { guardApi, ADMIN_API_ROLES } from "@/lib/auth/guards";
import { originCheck } from "@/lib/auth/origin";
import { resendTickets } from "@/lib/orders/resend";
import { OrderServiceError } from "@/lib/orders/errors";
import { kickEmailJobs } from "@/lib/email/kick";
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardApi(request, ADMIN_API_ROLES); if (!guard.ok) return guard.response;
  const origin = originCheck(request, "admin"); if (!origin.ok) return origin.response;
  const { id } = await params; if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid order id." }, { status: 400 });
  // No recipient or editable content accepted by this endpoint.
  if (request.headers.get("content-length") !== "0") {
    const body = await request.text();
    let value: unknown = {};
    try { if (body) value = JSON.parse(body); } catch { value = null; }
    if (!z.object({}).strict().safeParse(value).success) return NextResponse.json({ error: "No resend fields are accepted." }, { status: 400 });
  }
  try { const result = await resendTickets(id, guard.user.id); after(kickEmailJobs); return NextResponse.json(result); }
  catch (e) { return e instanceof OrderServiceError ? NextResponse.json({ error: e.message, code: e.code }, { status: e.httpStatus }) : NextResponse.json({ error: "Resend failed." }, { status: 500 }); }
}
