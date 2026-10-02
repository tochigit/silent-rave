import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFName, PDFString, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { directionsUrl } from "@/lib/venues/directions";

export const PDF_STYLE = { version: 1, qrMm: 60, quietModules: 4, mint: "#7CEFCB", purple: "#A78BFA" } as const;
const fontPath = path.join(process.cwd(), "assets/fonts/NotoSans-Regular.ttf");
let fontBytes: Promise<Buffer> | undefined;
function font() { return fontBytes ??= readFile(fontPath); }
export function lagosDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date) + " (Africa/Lagos)";
}
export type PdfInputs = { ticketId: string; event: string; date: string; venue: string; address: string; directions: string | null; tier: string; holder: string | null; orderCode: string; qrToken: string };
export async function pdfCacheKey(input: PdfInputs): Promise<string> {
  const fontHash = createHash("sha256").update(await font()).digest("hex");
  const hash = createHash("sha256").update(JSON.stringify({ input, style: PDF_STYLE, fontHash })).digest("hex");
  return `tickets/${input.ticketId}/${hash}.pdf`;
}
export async function renderTicketPdf(input: PdfInputs, encoder = (token: string) => QRCode.create(token, { errorCorrectionLevel: "Q" })) {
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  const embedded = await pdf.embedFont(await font(), { subset: true });
  let page = pdf.addPage([420, 595]); let y = 552;
  const write = (raw: string, size = 12) => {
    const text = raw.replace(/[\u0000-\u001f\u007f]/g, " ");
    let line = "";
    const draw = () => {
      if (y < 45) { page = pdf.addPage([420, 595]); y = 552; }
      page.drawText(line, { x: 30, y, size, font: embedded, color: rgb(0, 0, 0) }); y -= size + 7; line = "";
    };
    // Character wrapping preserves the complete directions URL and long names.
    for (const ch of text) { if (embedded.widthOfTextAtSize(line + ch, size) > 360) draw(); line += ch; }
    if (line) draw();
  };
  write("Silent Rave", 22); write(input.event, 17); write(input.date);
  write(input.venue); write(input.address); write(`Tier: ${input.tier}`);
  if (input.holder) write(`Holder: ${input.holder}`);
  write(`Order: ${input.orderCode}`);
  if (input.directions) {
    if (y < 45) { page = pdf.addPage([420, 595]); y = 552; }
    const linkPage = page; const linkY = y;
    write("Get Directions", 11); write(input.directions, 8);
    const annotation = pdf.context.register(pdf.context.obj({ Type: "Annot", Subtype: "Link", Rect: [30, linkY - 3, 130, linkY + 12], Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: PDFString.of(input.directions) } }));
    const annotations = linkPage.node.Annots() ?? pdf.context.obj([]);
    annotations.push(annotation); linkPage.node.set(PDFName.of("Annots"), annotations);
  }
  const qr = encoder(input.qrToken); // stored token, never re-signed
  const side = PDF_STYLE.qrMm * 72 / 25.4;
  const count = qr.modules.size + 2 * PDF_STYLE.quietModules;
  const cell = side / count;
  if (qr.modules.size * cell < 40 * 72 / 25.4) throw new Error("QR_TOO_SMALL");
  if (y < side + 60) { page = pdf.addPage([420, 595]); y = 552; }
  const x = 30; const bottom = y - side - 10;
  page.drawRectangle({ x, y: bottom, width: side, height: side, color: rgb(1, 1, 1) });
  for (let row = 0; row < qr.modules.size; row++) for (let col = 0; col < qr.modules.size; col++) {
    if (qr.modules.get(row, col)) page.drawRectangle({ x: x + (col + 4) * cell, y: bottom + (count - row - 5) * cell, width: cell, height: cell, color: rgb(0, 0, 0) });
  }
  pdf.setTitle("Silent Rave ticket"); pdf.setCreator("Silent Rave");
  return { bytes: await pdf.save(), qrToken: input.qrToken, qrMm: PDF_STYLE.qrMm, activeQrMm: qr.modules.size * cell * 25.4 / 72 };
}
export class PdfAccessError extends Error { constructor(public status: 409 | 410) { super(status === 410 ? "Ticket no longer valid." : "Order not approved."); } }
export async function ticketPdfInputs(ticketId: string) {
  const unit = await db.ticketUnit.findUniqueOrThrow({ where: { id: ticketId }, include: { order: true, tier: true, event: { include: { venue: true } } } });
  if (unit.voidedAt || unit.order.status === "REFUNDED") throw new PdfAccessError(410);
  if (unit.order.status !== "APPROVED") throw new PdfAccessError(409);
  const input: PdfInputs = { ticketId, event: unit.event.title, date: unit.event.isDateConfirmed ? lagosDate(unit.event.startsAt) : "Date to be announced", venue: unit.event.venue.name, address: unit.event.venue.address, directions: directionsUrl(unit.event.venue), tier: unit.tier.name, holder: unit.holderName, orderCode: unit.order.orderCode, qrToken: unit.qrToken };
  return { input, storedKey: unit.pdfUrl };
}
export async function getTicketPdf(ticketId: string) {
  const storage = getStorage();
  for (let attempt = 0; attempt < 3; attempt++) {
    const snapshot = await ticketPdfInputs(ticketId); const key = await pdfCacheKey(snapshot.input);
    const cached = snapshot.storedKey === key ? await storage.getObject(key) : null;
    const bytes = cached?.bytes ?? (await renderTicketPdf(snapshot.input)).bytes;
    if (!cached) await storage.putObject(key, bytes, "application/pdf");
    // Revalidate after I/O; concurrent edits/refunds must never serve stale cache.
    const fresh = await ticketPdfInputs(ticketId);
    if (await pdfCacheKey(fresh.input) !== key) continue;
    await db.ticketUnit.updateMany({ where: { id: ticketId, voidedAt: null, order: { status: "APPROVED" }, OR: [{ pdfUrl: null }, { pdfUrl: { not: key } }] }, data: { pdfUrl: key } });
    return { bytes, key, cached: Boolean(cached) };
  }
  throw new Error("PDF_INPUTS_CHANGED");
}
