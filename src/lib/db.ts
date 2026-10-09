import { PrismaClient } from '@prisma/client'
import { runtimeDatabaseUrl } from './database/runtime-url'

// ─────────────────────────────────────────────────────────────────────────────
// Prisma client singleton.
//
// The connection string comes from DATABASE_URL. Local adapters use it unchanged;
// the selected Netlify/Supabase runtime validates strict TLS and materializes
// its bundled public CA in temporary storage. Operator URLs stay out of runtime.
//
// DIRECT_URL belongs to migration/operator tooling and is never supplied to the
// hosted application. Migrations remain plain Postgres DDL.
// ─────────────────────────────────────────────────────────────────────────────

// Only warnings/errors are logged — query logging would print session token
// hashes (and login lookups) into dev logs on every request (06-auth-and-roles.md:
// credential material is never logged).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

const prisma: PrismaClient | undefined = globalForPrisma.prisma

export const db: PrismaClient = prisma ?? new PrismaClient({ log: ['warn', 'error'], datasourceUrl: runtimeDatabaseUrl() })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
