import "./phase3b/load-env";
import { PrismaClient } from "@prisma/client";
// Fixture writes/inspection use the operator. Application imports keep the
// restricted DATABASE_URL supplied by Batch B, including direct service tests.
export const db = new PrismaClient({
  datasourceUrl: process.env.TEST_DATABASE_URL,
});
