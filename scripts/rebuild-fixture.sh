#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Silent Rave — LOCAL DEV FIXTURE REBUILD (one command, repeatable).
#
#   bun run db:fixture
#
# Rebuilds the sandbox's embedded PostgreSQL 18 dev fixture from scratch AND
# regenerates .env (the platform resets clobber it back to a sqlite
# placeholder, so this script is the single recovery command):
#   1. stops & wipes any existing cluster (data dir removed — destructive, dev only)
#   2. initdb (trust auth, loopback-only)
#   3. creates the `silentrave` database
#   4. starts postgres daemonized on 127.0.0.1:54329 (survives this script)
#   5. regenerates .env (fresh secrets each rebuild — the DB is wiped anyway,
#      so nothing signed by the old keys survives)
#   6. prisma generate + migrate deploy (all migrations)
#   7. seeds the OWNER account, the dev test event, and the active payment account
#
# DEV FIXTURE ONLY — production uses Supabase/direct Postgres per spec; this
# script must never run against a real database.
#
# Owner credentials come from OWNER_EMAIL / OWNER_PASSWORD / OWNER_NAME env
# vars; defaults below are obviously-fake local sandbox values.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

# ── 0. DEV-ONLY guards (refuse before ANY destructive step) ──────────────────
if [ "${NODE_ENV:-}" = "production" ]; then
  echo "✖ refusing to run: NODE_ENV=production — db:fixture is a DEV-ONLY destructive rebuild (wipes the cluster)." >&2
  exit 1
fi
if [ -n "${DATABASE_URL:-}" ]; then
  case "${DATABASE_URL}" in
    postgres://*|postgresql://*)
      # Ambient DATABASE_URL declares a Postgres server — it must be the
      # embedded local one (127.0.0.1:54329 / localhost:54329). Anything else
      # (Supabase, staging, prod…) → refuse.
      guard_rest="${DATABASE_URL#*://}"      # strip scheme
      guard_rest="${guard_rest%%\?*}"       # strip query string
      guard_hostport="${guard_rest%%/*}"    # keep up to the path
      guard_hostport="${guard_hostport##*@}" # strip userinfo if present
      case "${guard_hostport}" in
        127.0.0.1:54329|localhost:54329)
          ;; # the embedded local server — OK
        *)
          echo "✖ refusing to run: DATABASE_URL points at '${guard_hostport}', not the embedded local server (127.0.0.1:54329) — db:fixture is a DEV-ONLY destructive rebuild." >&2
          exit 1
          ;;
      esac
      ;;
    *)
      # Non-Postgres ambient value (e.g. the platform's stale sqlite file:…
      # placeholder). This script NEVER connects via the ambient URL — it
      # defines its own target and regenerates .env — so a non-Postgres value
      # is not a danger signal; proceed with a note.
      echo "▸ note: ambient DATABASE_URL is not a Postgres URL — the fixture regenerates .env and defines its own target"
      ;;
  esac
fi

PG_BIN="node_modules/@embedded-postgres/linux-x64/native/bin"
PGDATA="/home/z/.pgdata/silentrave"
PGPORT="54329"
PGSOCK="/tmp/pg-sock-silentrave"
DB_URL="postgresql://postgres@127.0.0.1:${PGPORT}/silentrave"
DB_URL_POOL="${DB_URL}?connection_limit=8"

OWNER_EMAIL="${OWNER_EMAIL:-owner@silentrave.ng}"
OWNER_PASSWORD="${OWNER_PASSWORD:-silentrave-dev-owner}"
OWNER_NAME="${OWNER_NAME:-Owner}"

# ── 0. node_modules sanity (sandbox wipes can remove it entirely) ────────────
if [ ! -x "${PG_BIN}/initdb" ]; then
  echo "▸ node_modules missing — running bun install first"
  bun install
fi

# ── 1. stop any running instance & free the port ─────────────────────────────
if "${PG_BIN}/pg_ctl" -D "${PGDATA}" status >/dev/null 2>&1; then
  echo "▸ stopping existing postgres cluster"
  "${PG_BIN}/pg_ctl" -D "${PGDATA}" stop -m fast >/dev/null 2>&1 || true
fi
STALE_PID="$(ss -ltnp 2>/dev/null | grep ":${PGPORT} " | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2 || true)"
if [ -n "${STALE_PID}" ]; then
  echo "▸ killing stale listener on port ${PGPORT} (pid ${STALE_PID})"
  kill "${STALE_PID}" 2>/dev/null || true
  sleep 1
fi

# ── 2. wipe + initdb ─────────────────────────────────────────────────────────
echo "▸ wiping ${PGDATA} and re-running initdb"
rm -rf "${PGDATA}"
mkdir -p /home/z/.pgdata "${PGSOCK}"
"${PG_BIN}/initdb" -D "${PGDATA}" -U postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null

# ── 3. create database (single-user mode — the embedded bundle ships no psql) ─
echo "▸ creating database silentrave"
echo "CREATE DATABASE silentrave;" | "${PG_BIN}/postgres" --single -D "${PGDATA}" postgres >/dev/null 2>&1

# ── 4. start daemonized, detached from this script's process group ───────────
echo "▸ starting postgres on 127.0.0.1:${PGPORT} (loopback only)"
(setsid "${PG_BIN}/pg_ctl" -D "${PGDATA}" -o "-p ${PGPORT} -h 127.0.0.1 -k ${PGSOCK}" -l /home/z/.pgdata/silentrave.log start >/dev/null 2>&1 </dev/null &)

# ── 5. wait for readiness (TCP connect probe, max ~30s) ──────────────────────
echo "▸ waiting for postgres readiness"
READY=0
for _ in $(seq 1 30); do
  if bun -e "const n=require('node:net');const s=n.connect(${PGPORT},'127.0.0.1');s.on('connect',()=>process.exit(0));s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),500);" 2>/dev/null; then
    READY=1
    break
  fi
  sleep 1
done
if [ "${READY}" != "1" ]; then
  echo "✖ postgres did not become ready on 127.0.0.1:${PGPORT} — check /home/z/.pgdata/silentrave.log" >&2
  exit 1
fi

# ── 6. regenerate .env (fresh dev secrets; old DB is gone anyway) ────────────
echo "▸ regenerating .env for the dev fixture"
STATUS_TOKEN_SECRET="$(bun -e 'console.log(require("node:crypto").randomBytes(32).toString("base64url"))')"
STORAGE_SIGNING_SECRET="$(bun -e 'console.log(require("node:crypto").randomBytes(32).toString("base64url"))')"
CRON_SECRET="$(bun -e 'console.log(require("node:crypto").randomBytes(24).toString("base64url"))')"
readarray -t KEYGEN_LINES < <(bun scripts/keygen-ed25519.ts)
TICKET_PRIVATE_KEY="$(echo "${KEYGEN_LINES[0]}" | cut -d= -f2-)"
TICKET_KID="$(echo "${KEYGEN_LINES[1]}" | cut -d= -f2-)"

cat > .env << EOF
# ─────────────────────────────────────────────────────────────────────────────
# Silent Rave — LOCAL DEV FIXTURE environment (sandbox embedded PostgreSQL 18)
#
# ⚠ This file is REGENERATED by \`bun run db:fixture\` (scripts/rebuild-fixture.sh)
#    after every fixture rebuild — sandbox resets clobber it back to the
#    platform's sqlite placeholder. If your .env suddenly says
#    \`DATABASE_URL=file:...custom.db\`, just run \`bun run db:fixture\` again.
#
# DEV FIXTURE ONLY. Production values live in real deployment secrets
# (.env.example documents them). Nothing here is a production credential.
#
# Fixture properties (all properties of THIS URL only, not of the app):
#   • embedded Postgres 18, loopback-only (127.0.0.1:54329), trust auth
#   • data dir /home/z/.pgdata/silentrave, socket /tmp/pg-sock-silentrave
#   • log /home/z/.pgdata/silentrave.log
#
# Platform quirk: tool shells carry a STALE exported DATABASE_URL (sqlite) that
# overrides Next's .env loading — ALWAYS prefix DB-touching commands:
#   env DATABASE_URL="postgresql://postgres@127.0.0.1:54329/silentrave" bun …
#
# Full restore after a sandbox reset (one command):
#   bun run db:fixture
#   (setsid env DATABASE_URL="postgresql://postgres@127.0.0.1:54329/silentrave" \\
#      ALLOW_DEV_ORIGIN=1 bun run dev >/dev/null 2>&1 </dev/null &)
#
# NOTE on Origin checks: STRICT by default (06) — admin API calls must carry
# Origin http://admin.localhost:3000. To browse/login through the sandbox
# preview gateway (external hostname), start the dev server with
# ALLOW_DEV_ORIGIN=1 (dev-only relaxation; the app refuses to start when that
# flag is set together with NODE_ENV=production).
# ─────────────────────────────────────────────────────────────────────────────

DATABASE_URL=${DB_URL_POOL}
DIRECT_URL=${DB_URL}

ROOT_DOMAIN=localhost

# Derived buyer status-link tokens (02-database-schema.md v2.1):
#   base64url(HMAC-SHA256(STATUS_TOKEN_SECRET, order_id ":" status_token_version))
STATUS_TOKEN_SECRET=${STATUS_TOKEN_SECRET}

# Ed25519 ticket QR signing (05) — seed + key id from \`bun run keygen:ed25519\`
TICKET_SIGNING_PRIVATE_KEY=${TICKET_PRIVATE_KEY}
TICKET_SIGNING_KID=${TICKET_KID}

# Private object storage (dev driver) — HMAC for short-lived owner-only proof URLs
STORAGE_DRIVER=local
STORAGE_SIGNING_SECRET=${STORAGE_SIGNING_SECRET}

# POST /api/internal/expire-holds guard (x-cron-secret header)
CRON_SECRET=${CRON_SECRET}

# Per-IP checkout initialize rate limit (default 10/hour) — overridable for tests
INITIALIZE_IP_RATE_LIMIT_PER_HOUR=10
EOF
echo "✔ .env regenerated (fresh secrets — DB was wiped, so nothing signed by old keys survives)"

# ── 7. generate client + apply all migrations + seed ─────────────────────────
echo "▸ prisma generate"
env DATABASE_URL="${DB_URL}" DIRECT_URL="${DB_URL}" bunx prisma generate >/dev/null

echo "▸ prisma migrate deploy"
env DATABASE_URL="${DB_URL}" DIRECT_URL="${DB_URL}" bunx prisma migrate deploy

echo "▸ seeding OWNER (${OWNER_EMAIL})"
env DATABASE_URL="${DB_URL}" DIRECT_URL="${DB_URL}" OWNER_EMAIL="${OWNER_EMAIL}" OWNER_PASSWORD="${OWNER_PASSWORD}" OWNER_NAME="${OWNER_NAME}" bun run db:seed-owner

echo "▸ seeding dev test event + active payment account"
env DATABASE_URL="${DB_URL}" DIRECT_URL="${DB_URL}" bun prisma/seed-dev-event.ts

echo ""
echo "✔ Fixture rebuilt. Start the dev server with:"
echo "    env DATABASE_URL=\"${DB_URL}\" bun run dev"
echo "  (restart it if it was already running — old connections/secrets are now dead)"
