# Netlify runtime configuration

The hosted Prisma connection needs Supabase's public CA at a path available inside
the function. The previous operator-side Windows path cannot exist on Netlify.
The new adapter bundles the official Root 2021 certificate, verifies its pinned
DER fingerprint and writes only that public certificate into serverless temporary
storage. It adds the resulting absolute `sslcert` path to the runtime connection.
No credential or customer file is written there.

Select `HOST_PLATFORM=netlify` and `DATABASE_CA_PROVIDER=supabase`. The database
URL must use a restricted login, `sslmode=require`, `sslaccept=strict` and
`connection_limit=1`; transaction pooling on port 6543 also needs
`pgbouncer=true`. Privileged logins, duplicate security parameters, alternate hosts
and supplied certificate/socket overrides fail with a fixed diagnostic. Local
adapters retain their existing URL. Packaged acceptance permits only its explicit
isolated loopback fixture, database `silentrave_test`, login `fixture_runtime`;
that exception cannot reach a hosted database. The launch inspector rejects all
fixture flags. There are no migration changes.

The certificate comes from the [official Supabase public certificate](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt).
DER SHA256: `807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa`.
Prisma 6.19.2's [PostgreSQL connector](https://www.prisma.io/docs/orm/v6/overview/databases/postgresql)
requires an explicit strict certificate policy.

Netlify provides `DEPLOY_ID` during builds but does not automatically supply it
to Node functions. The build wrapper now preserves only validated public
`DEPLOY_ID`/`SITE_NAME` as `SR_NETLIFY_DEPLOY_ID`/`SR_NETLIFY_SITE_NAME`.
The wrapper temporarily fills `src/lib/hosting/build-identity.json`; its ordinary
JSON import compiles these two public values into Node and Edge output. The
original empty source template is restored after the build, including failures.
Provider, runtime, owner and fixture secrets remain excluded from the app build.
The authentication broker derives `https://DEPLOY_ID--SITE_NAME.netlify.app` from
that compiled identity. Partial metadata, conflicting runtime identity and
alternate explicit broker origins fail closed. The public root/admin/staff
origin policy is retained.

This follows [Netlify's Node environment contract](https://docs.netlify.com/build/functions/environment-variables/).
The captured identifiers survive nested wrappers; the pinned adapter's serialized
Next configuration is not used as identity storage. Only these public identifiers
enter the generated module. Runtime keys never enter generated source or a Next
`env` map. Build-subprocess SR_NETLIFY_* values are not site runtime settings.
Use the real provider build identity for deployment; local fixture artifacts must
never be uploaded as production artifacts.

The provider setup applies 29 variables to the new app site's production context.
Netlify Free uses the provider's default all scopes. This does not claim paid
Secrets Controller or restricted per-variable scopes; application secrets have
no `NEXT_PUBLIC_` aliases and are not embedded by the application build.
Migration/operator credentials and owner-provisioning values stay outside runtime.
Resend uses the actual provider webhook signing secret; its delivered/bounced
callback is registered disabled until a deployed endpoint is verified.

Validation and publication status are recorded below and in the Desktop normal
setup continuation. `readyForLaunch=false`: local checks and saved provider values
do not prove a hosted app, TLS issuance, storage access, real email, device behavior
or recovery. Backblaze is deferred by the owner. No launch, deployment, scheduler,
real delivery, owner seed/reset, PR merge or branch deletion occurs in this step.

## Validation

- Runtime configuration/policy: 13 tests passed in clean CI, including capture
  preservation across nested wrappers.
- Offline launch inspector: 8 tests passed, 68 assertions; readiness stays false.
- Complete 29-field configuration syntax and encrypted readback passed.
- Real restricted Supabase Prisma connection passed in a read-only transaction
  using the new bundled CA; this is local Node, not hosted runtime acceptance.
- Corrected implementation head `314b4fae813034c9658ec91e8e02dfd87255e3ff`
  passed the full Windows/Linux workflow and GitGuardian in
  [CI 37937929996](https://github.com/tochigit/silent-rave/actions/runs/37937929996).
  Both systems passed lint/types, the offline build, secret/native trace checks,
  generated Edge execution and isolated final Node ZIP acceptance, plus the
  required baseline suite. Linux browser checks also passed. Acceptance handlers
  receive no deployment ID, SR_NETLIFY_* or explicit broker URL override.
  Final publication head and exact-head CI are recorded in the Desktop
  continuation and [PR #12](https://github.com/tochigit/silent-rave/pull/12).
- The first live bootstrap probe failed without a detailed category; its
  diagnostic retry passed. The initial offline build rejected a dotenv-containing
  checkout as designed. A subsequent Node 26 CLI attempt stalled and was stopped;
  it is not a pass. The private verifier restores preserved local dotenv files.
- The Node 24 package attempt reached the build command, then stalled inside
  the locked dependency installation and was stopped. Bun reported a slow
  filesystem. Final local lint could not load `ajv` from the incomplete local
  dependency tree. The first locked npm repair failed ECONNRESET. A cached retry
  with bounded network concurrency restored 622 locked packages; Prisma generation,
  final local lint and both typechecks passed. Local package attempts are not
  passes; clean CI provides the final package evidence.
- Staged files passed an exact private scan against runtime and operator secrets;
  no credential values were printed or added to Git.
- Earlier CI 37933907524 failed generated Edge acceptance; CI 37936318624 exposed
  that the adapter's serialized configuration does not retain the env property
  used by the diagnostic. Those failures are preserved. The public compiled
  module replaces that assumption; all authorization assertions remain.
