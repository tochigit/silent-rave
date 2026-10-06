import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { STATUS_TOKEN_HEADER } from "@/lib/constants";
import { verifyStatusToken } from "@/lib/orders/status-token";
import { getTicketPdf, PdfAccessError } from "@/lib/tickets/pdf";
import { privateHeaders } from "@/lib/auth/policy";
export const runtime = "nodejs";
const headers = { ...privateHeaders, "X-Content-Type-Options": "nosniff" };
const missing = () => NextResponse.json({ error: "Order not found." }, { status: 404, headers });
export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string; ticketId: string }> }) {
  const { code, ticketId } = await params;
  const token = request.headers.get(STATUS_TOKEN_HEADER) ?? request.nextUrl.searchParams.get("t") ?? "";
  const order = await db.order.findUnique({ where: { orderCode: code }, select: { id: true, statusTokenVersion: true } });
  if (!order || !token || !verifyStatusToken(order.id, order.statusTokenVersion, token) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ticketId)) return missing();
  const unit = await db.ticketUnit.findFirst({ where: { id: ticketId, orderId: order.id }, select: { id: true } });
  if (!unit) return missing();
  try {
    const pdf = await getTicketPdf(unit.id);
    const current = await db.order.findUniqueOrThrow({ where: { id: order.id }, select: { statusTokenVersion: true, status: true } });
    if (!verifyStatusToken(order.id, current.statusTokenVersion, token)) return missing();
    if (current.status === "REFUNDED") throw new PdfAccessError(410);
    if (current.status !== "APPROVED") throw new PdfAccessError(409);
    return new NextResponse(new Uint8Array(pdf.bytes), { headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="SilentRave-${code}-${ticketId}.pdf"` } });
  } catch (error) {
    if (error instanceof PdfAccessError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    return NextResponse.json({ error: "PDF temporarily unavailable." }, { status: 503, headers });
  }
}
