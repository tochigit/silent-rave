import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { guardApi, ADMIN_API_ROLES } from "@/lib/auth/guards";
import { originCheck } from "@/lib/auth/origin";
import { verifyPassword } from "@/lib/auth/password";
import { refundOrder } from "@/lib/orders/refund";
import { OrderServiceError } from "@/lib/orders/errors";
const schema = z.object({ password: z.string().min(1).max(200), restock: z.boolean().default(false), acknowledge_checked_in: z.boolean().default(false), note: z.string().trim().max(2000).optional() }).strict();
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardApi(request, ADMIN_API_ROLES); if (!guard.ok) return guard.response;
  const origin = originCheck(request, "admin"); if (!origin.ok) return origin.response;
  const { id } = await params; if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid order id." }, { status: 400 });
  const body = schema.safeParse(await request.json().catch(() => null)); if (!body.success) return NextResponse.json({ error: "Valid refund fields and password are required." }, { status: 400 });
  const actor = await db.staffUser.findUnique({ where: { id: guard.user.id }, select: { passwordHash: true } });
  if (!actor || !await verifyPassword(body.data.password, actor.passwordHash)) return NextResponse.json({ error: "Password confirmation failed." }, { status: 403 });
  try { return NextResponse.json(await refundOrder(id, guard.user.id, body.data)); }
  catch (e) { return e instanceof OrderServiceError ? NextResponse.json({ error: e.message, code: e.code }, { status: e.httpStatus }) : NextResponse.json({ error: "Refund failed." }, { status: 500 }); }
}
