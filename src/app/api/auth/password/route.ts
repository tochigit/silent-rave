import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionUserFromRequest } from "@/lib/auth/session";
import { originCheck } from "@/lib/auth/origin";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { body, failure, OperationError, reply } from "@/lib/operations/http";
import {
  consumeRateLimit,
  RateLimitUnavailableError,
  rateLimitUnavailableResponse,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { surfaceUrl } from "@/lib/auth/navigation";
export async function POST(request: NextRequest) {
  try {
    const session = await getSessionUserFromRequest(request);
    if (!session) return reply({ error: "Authentication required." }, 401);
    const origin = originCheck(request, "auth");
    if (!origin.ok) return origin.response;
    const rate = await consumeRateLimit("password-change", session.user.id, {
      limit: 5,
      windowMs: 600000,
    });
    if (rate.limited)
      return rateLimitResponse(rate.retryAfterSec, "Retry later.");
    try {
      const input = await body(
        request,
        z
          .object({
            current_password: z.string().min(1).max(200),
            new_password: z.string().min(12).max(72),
          })
          .strict(),
      );
      const user = await db.staffUser.findUniqueOrThrow({
        where: { id: session.user.id },
      });
      if (
        !(await verifyPassword(input.current_password, user.passwordHash)) ||
        input.current_password === input.new_password
      )
        throw new OperationError(
          403,
          "Use the correct current password and a different new password.",
        );
      const passwordHash = await hashPassword(input.new_password);
      await db.$transaction(async (tx) => {
        await tx.staffUser.update({
          where: { id: user.id },
          data: { passwordHash, mustChangePassword: false },
        });
        await tx.session.deleteMany({
          where: { userId: user.id, id: { not: session.session.id } },
        });
        await writeAudit(tx, {
          actorId: user.id,
          action: "PASSWORD_CHANGED",
          entityType: "staff",
          entityId: user.id,
        });
      });
      return reply({
        ok: true,
        redirectTo: user.role === "OWNER" ? surfaceUrl("admin", "/admin") : surfaceUrl("staff", "/staff"),
      });
    } catch (error) {
      return failure(error);
    }
  } catch (error) {
    if (error instanceof RateLimitUnavailableError)
      return rateLimitUnavailableResponse();
    throw error;
  }
}
