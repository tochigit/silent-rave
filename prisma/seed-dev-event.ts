import { db } from "../src/lib/db";

// ─────────────────────────────────────────────────────────────────────────────
// DEV FIXTURE DATA ONLY — never runs in production.
//
// Seeds one PUBLISHED, upcoming, DATE-CONFIRMED event + two ticket tiers + one
// ACTIVE payment account, so the manual-payment checkout flow has something to
// buy and a bank account to pay into (initialize returns 503 without an active
// account). Called by `bun run db:fixture` after migrations; idempotent —
// skips whatever already exists.
//
// No credentials, no secrets, no customer data — just enough catalog rows to
// exercise /api/checkout/initialize end to end.
// ─────────────────────────────────────────────────────────────────────────────

const FIXTURE_SLUG = "dev-fixture-silent-rave";

async function main() {
  const existing = await db.event.findUnique({ where: { slug: FIXTURE_SLUG } });
  if (existing) {
    console.log(`✔ dev fixture event already present (${FIXTURE_SLUG}) — skipping event seed`);
  } else {
    const organizer = await db.organizer.create({
      data: { name: "Silent Rave (dev fixture)", contactEmail: "dev-fixture@silentrave.ng" },
    });

    const venue = await db.venue.create({
      data: { name: "Dev Fixture Arena", address: "1 Test Road", city: "Owerri", state: "Imo" },
    });

    const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // one week out
    const endsAt = new Date(startsAt.getTime() + 6 * 60 * 60 * 1000);

    const event = await db.event.create({
      data: {
        slug: FIXTURE_SLUG,
        title: "Dev Fixture — Silent Rave Test Event",
        description: "Dev-fixture event for exercising the manual-payment checkout flow. Not real.",
        organizerId: organizer.id,
        venueId: venue.id,
        startsAt,
        endsAt,
        isDateConfirmed: true, // v2.1: sales require a confirmed date (02/03)
        status: "PUBLISHED",
      },
    });

    await db.ticketTier.createMany({
      data: [
        { eventId: event.id, name: "Early Bird", priceKobo: 500000, capacity: 30, sortOrder: 0 },
        { eventId: event.id, name: "Regular", priceKobo: 1000000, capacity: 50, sortOrder: 1 },
      ],
    });

    console.log(`✔ dev fixture event created: ${FIXTURE_SLUG} (Early Bird ×30 @ ₦5,000, Regular ×50 @ ₦10,000 — confirmed date)`);
  }

  // Active payment account — exactly one (partial unique index enforces it).
  const active = await db.paymentAccount.findFirst({ where: { isActive: true } });
  if (!active) {
    await db.paymentAccount.create({
      data: {
        bankName: "Dev Fixture Bank",
        accountNumber: "0123456789",
        accountName: "Silent Rave Dev Fixture",
        isActive: true,
      },
    });
    console.log("✔ dev fixture payment account created (active)");
  } else {
    console.log("✔ an active payment account already exists — skipping account seed");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
