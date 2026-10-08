import "../phase3b/load-env";
import { db } from "../fixture-db";
import { approveOrder } from "@/lib/orders/review";
export async function orderFixture(qty = 2, approved = true) {
  const organizer = await db.organizer.findFirstOrThrow();
  const venue = await db.venue.create({ data: { name: "Campus Hall", address: "1 University Road, Lagos", city: "Lagos", googlePlaceId: "ChIJfixture" } });
  const event = await db.event.create({ data: { slug: `phase4-${crypto.randomUUID()}`, title: "Campus Silent Rave", description: "Fixture", organizerId: organizer.id, venueId: venue.id, startsAt: new Date("2030-10-03T23:30:00Z"), endsAt: new Date("2030-10-04T03:00:00Z"), isDateConfirmed: true, status: "PUBLISHED" } });
  const tier = await db.ticketTier.create({ data: { eventId: event.id, name: "Regular", capacity: 20, reserved: qty, priceKobo: 500000 } });
  const account = await db.paymentAccount.findFirstOrThrow(); const owner = await db.staffUser.findFirstOrThrow({ where: { role: "OWNER" } });
  const order = await db.order.create({ data: { orderCode: `SR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, eventId: event.id, customerName: "Test Buyer", customerEmail: "buyer@example.test", customerPhone: "08012345678", paymentAccountId: account.id, totalKobo: qty * 500000, holdExpiresAt: new Date(Date.now() + 60_000), status: "PROOF_SUBMITTED", proofAttempts: 1, lineItems: { create: { tierId: tier.id, quantity: qty, unitPriceKobo: 500000, holderNames: Array.from({ length: qty }, () => "Chloé Ọlá") } } } });
  await db.paymentProof.create({ data: { orderId: order.id, attemptNo: 1, clientSubmissionId: crypto.randomUUID(), storagePath: `proofs/${order.id}/${crypto.randomUUID()}.jpg`, fileSha256: "fixture", mimeType: "image/jpeg", sizeBytes: 100, transferReference: crypto.randomUUID(), senderName: "Fixture" } });
  if (approved) await approveOrder(order.id, owner.id);
  const tickets = await db.ticketUnit.findMany({ where: { orderId: order.id }, orderBy: { id: "asc" } });
  return { order: await db.order.findUniqueOrThrow({ where: { id: order.id } }), tickets, event, venue, tier, owner };
}
export const approvedOrder = (qty = 2) => orderFixture(qty);
