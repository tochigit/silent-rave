import { type NextRequest, NextResponse } from "next/server";
import { contactSchema, deliverContact } from "@/lib/content/contact";
import { MailQuotaPauseError } from "@/lib/email/quota";
import { privateHeaders } from "@/lib/auth/policy";
import {
  consumeRateLimit,
  RateLimitUnavailableError,
  rateLimitUnavailableResponse,
  rateLimitIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
export async function POST(request: NextRequest) {
  try {
    const ip = rateLimitIp(request);
    const limit = await consumeRateLimit("contact-ip", ip, {
      limit: 5,
      windowMs: 3600000,
    });
    if (limit.limited)
      return rateLimitResponse(
        limit.retryAfterSec,
        "Too many contact requests. Please try later.",
      );
    // Bound streaming input even when Content-Length is missing or dishonest.
    const reader = request.body?.getReader();
    if (!reader)
      return NextResponse.json(
        { error: "Contact details required." },
        { status: 400 },
      );
    let raw = "";
    let size = 0;
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 16384) {
          await reader.cancel();
          return NextResponse.json(
            { error: "Message too large." },
            { status: 413 },
          );
        }
        raw += decoder.decode(value, { stream: true });
      }
      raw += decoder.decode();
    } catch {
      return NextResponse.json(
        { error: "Could not read message." },
        { status: 400 },
      );
    }
    let input: unknown;
    try {
      input = JSON.parse(raw);
    } catch {
      return NextResponse.json(
        { error: "Invalid contact details." },
        { status: 400 },
      );
    }
    const parsed = contactSchema.safeParse(input);
    if (!parsed.success)
      return NextResponse.json(
        {
          error: "Enter a name, valid email and message of 10–5000 characters.",
        },
        { status: 400 },
      );
    try {
      if (!(await deliverContact(parsed.data)))
        return NextResponse.json(
          {
            error:
              "Contact delivery is temporarily unavailable. Try again later.",
          },
          { status: 503, headers: privateHeaders },
        );
      return NextResponse.json(
        { message: "Your message has been sent to the organizer." },
        { status: 202, headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      if (error instanceof MailQuotaPauseError)
        return NextResponse.json(
          {
            error:
              "Contact delivery is temporarily unavailable. Try again later.",
          },
          {
            status: 503,
            headers: {
              ...privateHeaders,
              "Retry-After": String(
                Math.min(35 * 86400, Math.max(1, error.retryAfterSec)),
              ),
            },
          },
        );
      return NextResponse.json(
        {
          error:
            "Contact delivery is temporarily unavailable. Try again later.",
        },
        { status: 503, headers: privateHeaders },
      );
    }
  } catch (error) {
    if (error instanceof RateLimitUnavailableError)
      return rateLimitUnavailableResponse();
    throw error;
  }
}
