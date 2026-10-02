import { render } from "@react-email/render";
import { db } from "@/lib/db";
import type { EmailJob } from "@prisma/client";
import { deriveStatusToken, statusPagePath } from "@/lib/orders/status-token";
import { directionsUrl } from "@/lib/venues/directions";
import { getTicketPdf, lagosDate } from "@/lib/tickets/pdf";
import { emailConfig } from "./config";
import type { EmailPayload } from "./transport";

const subjects = { PROOF_RECEIVED: "Silent Rave: proof received", TICKETS: "Your Silent Rave tickets", REJECTED: "Silent Rave: payment review", STATUS_LINK: "Your Silent Rave status link" };
// React escapes text nodes. Plain text additionally neutralizes markup/CRLF
// buyer content, without altering the separate first-party status URL.
const clean = (text: string) => text.replace(/[\r\n\u0000-\u001f\u007f]/g, " ");
const plainEscape = (text: string) => clean(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
export async function buildEmailPayload(job: EmailJob): Promise<EmailPayload> {
  const config = emailConfig();
  const order = await db.order.findUniqueOrThrow({ where: { id: job.orderId }, include: { event: { include: { venue: true } }, lineItems: { orderBy: { id: "asc" }, include: { tier: true } }, ticketUnits: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] }, proofs: { orderBy: { attemptNo: "desc" }, take: 1 } } });
  const statusLink = config.baseUrl + statusPagePath(order.orderCode, deriveStatusToken(order.id, order.statusTokenVersion));
  const lines: string[] = []; const attachments: EmailPayload["attachments"] = [];
  let directions: string | null = null;
  switch (job.kind) {
    case "PROOF_RECEIVED": lines.push(`Order ${order.orderCode}`, "We received your proof and are checking the payment."); break;
    case "STATUS_LINK": break; // no order/buyer/event details
    case "REJECTED": {
      const context = job.context as { reason?: string; resubmittable?: boolean } | null;
      lines.push(`Order ${order.orderCode}`, context?.reason ?? order.proofs[0]?.rejectMessage ?? "The payment proof could not be approved.",
        (context?.resubmittable ?? (order.status === "NEEDS_RESUBMIT")) ? "You may re-upload your proof using the status link." : "Re-upload is not allowed for this decision.");
      break;
    }
    case "TICKETS": {
      if (order.status !== "APPROVED") throw new Error("ORDER_NOT_APPROVED");
      lines.push(order.event.title, order.event.isDateConfirmed ? lagosDate(order.event.startsAt) : "Date to be announced", order.event.venue.name, order.event.venue.address, `Order ${order.orderCode}`);
      for (const line of order.lineItems) lines.push(`${line.tier.name} x ${line.quantity}`);
      for (const unit of order.ticketUnits) if (unit.holderName) lines.push(`Holder: ${unit.holderName}`);
      directions = directionsUrl(order.event.venue);
      for (const [i, unit] of order.ticketUnits.entries()) {
        const pdf = await getTicketPdf(unit.id);
        attachments.push({ filename: `SilentRave-${order.orderCode}-${i + 1}.pdf`, content: Buffer.from(pdf.bytes).toString("base64") });
      }
      break;
    }
  }
  const html = await render(<html lang="en"><body><h1>Silent Rave</h1>{lines.map((line, i) => <p key={i}>{clean(line)}</p>)}{directions && <p><a href={directions}>Get Directions</a></p>}<p><a href={statusLink}>View order status</a></p></body></html>);
  const text = [...lines.map(plainEscape), ...(directions ? [`Get Directions: ${directions}`] : []), `View order status: ${statusLink}`].join("\n\n");
  return { from: config.from, reply_to: config.replyTo, to: [order.customerEmail], subject: subjects[job.kind], html, text, attachments, tags: [{ name: "job_id", value: job.id }] };
}
