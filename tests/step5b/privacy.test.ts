import "../phase3b/load-env";
import { afterAll, expect, test } from "bun:test";
import { PrismaClient } from "@prisma/client";
import { readFile } from "node:fs/promises";
import { db } from "../fixture-db";
const runtime = new PrismaClient({
  datasourceUrl: process.env.TEST_RUNTIME_DATABASE_URL,
});
afterAll(async () => {
  await runtime.$disconnect();
  await db.$disconnect();
});
test("complete table inventory has RLS and provider roles lack table/sequence/routine access", async () => {
  const tables = await db.$queryRaw<
    Array<{ name: string; rls: boolean; owner: string }>
  >`SELECT c.relname AS name,c.relrowsecurity AS rls,r.rolname AS owner
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner
    WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname`;
  expect(tables).toHaveLength(22);
  expect(
    tables.every(
      (t) => t.rls && t.owner !== "sr_runtime" && t.owner !== "fixture_runtime",
    ),
  ).toBe(true);
  for (const role of ["anon", "authenticated", "service_role"]) {
    for (const table of tables) {
      await expect(
        db.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
          await tx.$queryRawUnsafe(
            `SELECT 1 FROM public."${table.name}" LIMIT 1`,
          );
        }),
      ).rejects.toThrow();
    }
    const [access] = await db.$queryRaw<
      Array<{ sequence: boolean; routine: boolean }>
    >`SELECT
      has_sequence_privilege(${role},'public.ticket_units_sync_seq','USAGE') AS sequence,
      has_function_privilege(${role},'public.assign_ticket_sync_seq()','EXECUTE') AS routine`;
    expect(access).toEqual({ sequence: false, routine: false });
  }
});
test("RLS still denies provider reads and writes after an accidental table grant", async () => {
  try {
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        "GRANT SELECT,INSERT ON public.organizers TO anon",
      );
      await tx.$executeRawUnsafe("SET LOCAL ROLE anon");
      expect(await tx.organizer.count()).toBe(0);
      await expect(
        Promise.resolve(
          tx.organizer.create({ data: { name: "must be denied" } }),
        ),
      ).rejects.toThrow();
      throw new Error("ROLLBACK_TEST_GRANT");
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "ROLLBACK_TEST_GRANT")
      throw error;
  }
  expect(await db.organizer.count({ where: { name: "must be denied" } })).toBe(
    0,
  );
});
test("runtime is a nonowner restricted login with append-only ledgers and no migration/DDL access", async () => {
  const [role] = await runtime.$queryRaw<
    Array<{ name: string; super: boolean; bypass: boolean }>
  >`SELECT current_user AS name,rolsuper AS super,rolbypassrls AS bypass FROM pg_roles WHERE rolname=current_user`;
  expect(role).toEqual({
    name: "fixture_runtime",
    super: false,
    bypass: false,
  });
  expect(await runtime.event.count()).toBeGreaterThan(0);
  for (const table of [
    "order_line_items",
    "audit_log_entries",
    "check_in_scans",
  ]) {
    await expect(
      Promise.resolve(
        runtime.$executeRawUnsafe(`UPDATE public.${table} SET id=id`),
      ),
    ).rejects.toThrow();
    await expect(
      Promise.resolve(
        runtime.$executeRawUnsafe(`DELETE FROM public.${table} WHERE false`),
      ),
    ).rejects.toThrow();
  }
  await expect(
    Promise.resolve(
      runtime.$queryRawUnsafe("SELECT 1 FROM public._prisma_migrations"),
    ),
  ).rejects.toThrow();
  await expect(
    Promise.resolve(
      runtime.$executeRawUnsafe(
        "CREATE TABLE public.runtime_forbidden(id int)",
      ),
    ),
  ).rejects.toThrow();
  const [sync] = await runtime.$queryRaw<
    Array<{ value: bigint }>
  >`SELECT nextval('public.ticket_units_sync_seq'::regclass) AS value`;
  expect(sync.value).toBeGreaterThan(0n);
  const [routine] = await db.$queryRaw<
    Array<{ definer: boolean; config: string[] }>
  >`SELECT prosecdef AS definer,proconfig AS config FROM pg_proc WHERE oid='public.assign_ticket_sync_seq()'::regprocedure`;
  expect(routine.definer).toBe(false);
  expect(routine.config.join()).toContain("search_path=pg_catalog, public");
});
test("actual migration guards reject elevated roles and unknown views, policies, grants and column grants", async () => {
  const sql = await readFile(
    "prisma/migrations/20261008000200_step5_private_runtime/migration.sql",
    "utf8",
  );
  const guard = sql.match(/DO \$\$[\s\S]*?END \$\$;/)![0];
  const cases = [
    { mutation: "GRANT sr_runtime TO anon", message: "provider role membership drift", clear: false },
    { mutation: "GRANT CREATE ON DATABASE silentrave_test TO sr_runtime", message: "runtime DDL/ownership drift", clear: false },
    { mutation: "CREATE ROLE fixture_sequence_grantee NOLOGIN", extra: "GRANT USAGE ON SEQUENCE public.ticket_units_sync_seq TO fixture_sequence_grantee", message: "unknown sync object grants", clear: false },
    { mutation: "CREATE ROLE fixture_function_grantee NOLOGIN", extra: "GRANT EXECUTE ON FUNCTION public.assign_ticket_sync_seq() TO fixture_function_grantee", message: "unknown sync object grants", clear: false },
    { mutation: "CREATE ROLE fixture_sync_owner NOLOGIN", extra: "ALTER SEQUENCE public.ticket_units_sync_seq OWNER TO fixture_sync_owner", message: "sync object owner drift", clear: false },
    {
      mutation: "ALTER ROLE sr_runtime CREATEDB",
      message: "sr_runtime role drift",
      clear: false,
    },
    {
      mutation: "CREATE VIEW public.fixture_unknown_view AS SELECT 1 AS value",
      message: "unknown public view",
      clear: false,
    },
    {
      mutation:
        "CREATE POLICY fixture_unknown_policy ON public.organizers TO anon USING(true)",
      message: "unknown application policy",
      clear: true,
    },
    {
      mutation: "CREATE ROLE fixture_unknown_grantee NOLOGIN",
      message: "unknown application grants",
      clear: true,
      extra: "GRANT SELECT ON public.organizers TO fixture_unknown_grantee",
    },
    {
      mutation: "GRANT SELECT(name) ON public.organizers TO anon",
      message: "column grants",
      clear: true,
    },
  ];
  for (const scenario of cases) {
    await expect(
      db.$transaction(async (tx) => {
        if (scenario.clear)
          await tx.$executeRawUnsafe(`DO $$ DECLARE p record; BEGIN
        FOR p IN SELECT tablename,policyname FROM pg_policies WHERE schemaname='public' LOOP
          EXECUTE format('DROP POLICY %I ON public.%I',p.policyname,p.tablename);
        END LOOP; END $$`);
        await tx.$executeRawUnsafe(scenario.mutation);
        if (scenario.extra) await tx.$executeRawUnsafe(scenario.extra);
        await tx.$executeRawUnsafe(guard);
      }),
    ).rejects.toThrow(scenario.message);
  }
  expect(await runtime.event.count()).toBeGreaterThan(0);
});
