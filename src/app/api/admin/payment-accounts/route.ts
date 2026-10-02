import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { guardApi, ADMIN_API_ROLES } from "@/lib/auth/guards";
import { originCheck } from "@/lib/auth/origin";
import { verifyPassword } from "@/lib/auth/password";
import { writeAudit } from "@/lib/audit";

// ─────────────────────────────────────────────────────────────────────────────
// Payment accounts (03 v2.1 "Payment accounts"; 04 — bank details live in the
// DB, never hardcoded in the front end). OWNER only.
//
//   GET  /api/admin/payment-accounts            — list (no password needed)
//   POST /api/admin/payment-accounts            — create (password re-entry)
//
// Mutations REQUIRE password re-entry (06: sensitive owner actions; a swapped
// account number is the classic scam) and write a BANK_ACCOUNT_CHANGED audit
// entry with before/after. At most one active row is enforced BOTH in the
// transaction (deactivate the others) and by the partial unique index.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const guard = await guardApi(request, ADMIN_API_ROLES);
  if (!guard.ok) return guard.response;

  const accounts = await db.paymentAccount.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      bankName: true,
      accountNumber: true,
      accountName: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return NextResponse.json(
    {
      accounts: accounts.map((account) => ({
        id: account.id,
        bank_name: account.bankName,
        account_number: account.accountNumber,
        account_name: account.accountName,
        is_active: account.isActive,
        created_at: account.createdAt.toISOString(),
        updated_at: account.updatedAt.toISOString(),
      })),
    },
    { status: 200 }
  );
}

const createSchema = z.object({
  bank_name: z.string().trim().min(1).max(200),
  account_number: z.string().trim().regex(/^[0-9]{6,20}$/, "account_number must be 6–20 digits"),
  account_name: z.string().trim().min(1).max(200),
  is_active: z.boolean().optional().default(false),
  password: z.string().min(1).max(200),
});

export async function POST(request: NextRequest) {
  const guard = await guardApi(request, ADMIN_API_ROLES);
  if (!guard.ok) return guard.response;

  const origin = originCheck(request, "admin");
  if (!origin.ok) return origin.response;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed.", issues: parsed.error.issues.map((i) => i.message) },
      { status: 400 }
    );
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
    const created = await db.$transaction(async (tx) => {
      let deactivateCount = 0;
      if (parsed.data.is_active) {
        // At most one active row: deactivate the previous active account in
        // the same transaction (partial unique index is the DB backstop).
        deactivateCount = (await tx.paymentAccount.updateMany({
          where: { isActive: true },
          data: { isActive: false, updatedBy: guard.user.id },
        })).count;
      }
      const account = await tx.paymentAccount.create({
        data: {
          bankName: parsed.data.bank_name,
          accountNumber: parsed.data.account_number,
          accountName: parsed.data.account_name,
          isActive: parsed.data.is_active,
          createdBy: guard.user.id,
          updatedBy: guard.user.id,
        },
      });
      await writeAudit(tx, {
        actorId: guard.user.id,
        action: "BANK_ACCOUNT_CHANGED",
        entityType: "payment_account",
        entityId: account.id,
        metadata: {
          change: "created",
          before: null,
          after: {
            bank_name: account.bankName,
            account_number: account.accountNumber,
            account_name: account.accountName,
            is_active: account.isActive,
          },
          deactivated_previous: deactivateCount,
        },
      });
      return account;
    });

    return NextResponse.json(
      {
        id: created.id,
        bank_name: created.bankName,
        account_number: created.accountNumber,
        account_name: created.accountName,
        is_active: created.isActive,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[admin/payment-accounts] create failed:", error);
    return NextResponse.json({ error: "Could not create the account." }, { status: 500 });
  }
}
