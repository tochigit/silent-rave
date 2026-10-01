import { PrismaClient } from '@prisma/client'

// ─────────────────────────────────────────────────────────────────────────────
// Prisma client singleton.
//
// PORTABILITY NOTE (sandbox fixture vs production): this module — and all
// application code — contains ZERO environment-specific connection logic.
// There is no host, port, credential, auth-mode, SSL, or pool-size assumption
// anywhere in src/ or prisma/; the connection string comes exclusively from
// the DATABASE_URL environment variable (see prisma/schema.prisma datasource).
//
// The sandbox's embedded PostgreSQL 18 dev fixture (trust auth, loopback-only
// 127.0.0.1:54329 — provisioned because this sandbox has no Postgres service)
// therefore exists ONLY as a DATABASE_URL value in the local gitignored .env
// and in dev-server/CLI invocation prefixes. Moving to real Supabase or
// direct Postgres is a pure configuration change: set DATABASE_URL (runtime,
// may be the transaction pooler with ?pgbouncer=true) and DIRECT_URL
// (migrations) to the real endpoints and run `prisma migrate deploy`. The
// migrations are plain Postgres DDL with no sandbox-specific statements, so
// they apply unchanged.
// ─────────────────────────────────────────────────────────────────────────────

// Only warnings/errors are logged — query logging would print session token
// hashes (and login lookups) into dev logs on every request (06-auth-and-roles.md:
// credential material is never logged).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

const prisma: PrismaClient | undefined = globalForPrisma.prisma

export const db: PrismaClient = prisma ?? new PrismaClient({ log: ['warn', 'error'] })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
