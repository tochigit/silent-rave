import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { guardApi, ADMIN_API_ROLES } from "@/lib/auth/guards";
import { originCheck } from "@/lib/auth/origin";
import { verifyPassword } from "@/lib/auth/password";
import { writeAudit } from "@/lib/audit";

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/admin/payment-accounts/:id — edit / activate (03 v2.1). OWNER
// only + Origin check + PASSWORD RE-ENTRY (06: sensitive owner action; a
// swapped account number is the classic scam). Writes BANK_ACCOUNT_CHANGED
// with before/after. Activation keeps at most one active row (deactivates the
// others in the same transaction; partial unique index is the DB backstop).
// ─────────────────────────────────────────────────────────────────────────────

const patchSchema = z.object({
  bank_name: z.string().trim().min(1).max(200).optional(),
  account_number: z.string().trim().regex(/^[0-9]{6,20}$/, "account_number must be 6–20 digits").optional(),
  account_name: z.string().trim().min(1).max(200).optional(),
  is_active: z.boolean().optional(),
  password: z.string().min(1).max(200),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardApi(request, ADMIN_API_ROLES);
  if (!guard.ok) return guard.response;

  const origin = originCheck(request, "admin");
  if (!origin.ok) return origin.response;

  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid account id." }, { status: 400 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed.", issues: parsed.error.issues.map((i) => i.message) },
      { status: 400 }
    );
  }
  if (
    parsed.data.bank_name === undefined &&
    parsed.data.account_number === undefined &&
    parsed.data.account_name === undefined &&
    parsed.data.is_active === undefined
  ) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  // Password re-entry — verified against the CALLER's own hash (04/06).
  const actor = await db.staffUser.findUnique({
    where: { id: guard.user.id },
    select: { passwordHash: true },
  });
  if (!actor || !(await verifyPassword(parsed.data.password, actor.passwordHash))) {
    return NextResponse.json({ error: "Password confirmation failed." }, { status: 403 });
  }

  try {
    const updated = await db.$transaction(async (tx) => {
      const before = await tx.paymentAccount.findUnique({ where: { id } });
      if (!before) return { notFound: true as const };

      let deactivateCount = 0;
      if (parsed.data.is_active) {
        // At most one active row: deactivate the previous active account in
        // the same transaction (partial unique index is the DB backstop).
        deactivateCount = (await tx.paymentAccount.updateMany({
          where: { isActive: true, NOT: { id } },
          data: { isActive: false, updatedBy: guard.user.id },
        })).count;
      }

      const after = await tx.paymentAccount.update({
        where: { id },
        data: {
          bankName: parsed.data.bank_name ?? undefined,
          accountNumber: parsed.data.account_number ?? undefined,
          accountName: parsed.data.account_name ?? undefined,
          isActive: parsed.data.is_active ?? undefined,
          updatedBy: guard.user.id,
        },
      });

      await writeAudit(tx, {
        actorId: guard.user.id,
        action: "BANK_ACCOUNT_CHANGED",
        entityType: "payment_account",
        entityId: id,
        metadata: {
          change: "updated",
          before: {
            bank_name: before.bankName,
            account_number: before.accountNumber,
            account_name: before.accountName,
            is_active: before.isActive,
          },
          after: {
            bank_name: after.bankName,
            account_number: after.accountNumber,
            account_name: after.accountName,
            is_active: after.isActive,
          },
          deactivated_previous: deactivateCount,
        },
      });

      return { notFound: false as const, account: after };
    });

    if (updated.notFound) {
      return NextResponse.json({ error: "Payment account not found." }, { status: 404 });
    }

    return NextResponse.json(
      {
        id: updated.account.id,
        bank_name: updated.account.bankName,
        account_number: updated.account.accountNumber,
        account_name: updated.account.accountName,
        is_active: updated.account.isActive,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[admin/payment-accounts] patch failed:", error);
    return NextResponse.json({ error: "Could not update the account." }, { status: 500 });
  }
}
