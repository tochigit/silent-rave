import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { emailConfig } from "@/lib/email/config";
import { getEmailTransport, type EmailTransport } from "@/lib/email/transport";
export const contactSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    email: z.email().max(254),
    message: z.string().trim().min(10).max(5000),
  })
  .strict();
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
/** Separate contact delivery, with no order or order-email kind. Never accepts a recipient from the client. */
export async function deliverContact(
  input: z.infer<typeof contactSchema>,
  transport?: EmailTransport,
) {
  const page = await db.sitePage.findFirst({
    where: { slug: "contact", isPublished: true },
    select: { contactOrganizer: { select: { contactEmail: true } } },
  });
  const recipient = z.email().safeParse(page?.contactOrganizer?.contactEmail);
  if (!recipient.success) return false;
  const config = emailConfig();
  const result = await (transport ?? getEmailTransport()).send(randomUUID(), {
    from: config.from,
    reply_to: config.replyTo,
    to: [recipient.data],
    subject: "Silent Rave contact enquiry",
    html: `<h1>Contact enquiry</h1><p>${escape(input.name)}</p><p>${escape(input.email)}</p><p style="white-space:pre-wrap">${escape(input.message)}</p>`,
    text: `Contact enquiry\nName: ${input.name.replace(/[\r\n]/g, " ")}\nEmail: ${input.email}\n\n${input.message}`,
    attachments: [],
    tags: [{ name: "source", value: "contact" }],
  });
  return result.ok;
}
