import "../phase3b/load-env";
import { expect, test } from "bun:test";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { db } from "../fixture-db";
import { api } from "../phase3b/helpers";
import { SESSION_COOKIE_NAME } from "@/lib/auth/policy";
const outageTest =
  process.env.RATE_LIMIT_DRIVER === "invalid" ? test : test.skip;
outageTest(
  "limiter configuration outage returns identical private 503 before login, checkout, lookup or contact writes",
  async () => {
    const owner = await db.staffUser.findFirstOrThrow({
      where: { role: "OWNER" },
    });
    const token = randomBytes(32).toString("base64url");
    await db.session.create({
      data: {
        userId: owner.id,
        tokenHash: createHash("sha256").update(token).digest("hex"),
        expiresAt: new Date(Date.now() + 12 * 3600000),
      },
    });
    const before = {
      sessions: await db.session.count(),
      orders: await db.order.count(),
      jobs: await db.emailJob.count(),
      reservations: await db.mailSendReservation.count(),
      scans: await db.checkInScan.count(),
      proofs: await db.paymentProof.count(),
    };
    const requests: Array<[string, unknown]> = [
      [
        "/api/auth/login",
        {
          email: process.env.OWNER_EMAIL,
          password: process.env.OWNER_PASSWORD,
        },
      ],
      ["/api/checkout/initialize", {}],
      [
        "/api/orders/lookup",
        { order_code: "SR-MISSING", email: "buyer@example.test" },
      ],
      [
        "/api/orders/lookup",
        { order_code: "SR-DIFFERENT", email: "other@example.test" },
      ],
      [
        "/api/contact",
        {
          name: "Fixture",
          email: "contact@example.test",
          message: "No delivery should occur",
        },
      ],
      ["/api/orders/SR-MISSING/proof", {}],
    ];
    const bodies: string[] = [];
    for (const [path, body] of requests) {
      const response = await api(path, {
        method: "POST",
        body,
        ip: randomUUID(),
        host: "localhost:3000",
        origin: "http://localhost:3000",
      });
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("cdn-cache-control")).toBe("no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      bodies.push(await response.text());
    }
    for (const path of [
      "/api/auth/password",
      "/api/admin/places/autocomplete",
      "/api/staff/check-in",
    ]) {
      const surface = path.startsWith("/api/staff") ? "staff" : "admin";
      const response = await api(path, {
        method: "POST",
        body: {},
        cookies: { [SESSION_COOKIE_NAME]: token },
        host: `${surface}.localhost:3000`,
        origin: `http://${surface}.localhost:3000`,
      });
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toContain("no-store");
      bodies.push(await response.text());
    }
    expect(new Set(bodies).size).toBe(1);
    expect({
      sessions: await db.session.count(),
      orders: await db.order.count(),
      jobs: await db.emailJob.count(),
      reservations: await db.mailSendReservation.count(),
      scans: await db.checkInScan.count(),
      proofs: await db.paymentProof.count(),
    }).toEqual(before);
  },
);
