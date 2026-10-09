# Hosted scanner and owner routing fixes

9 October 2026. Branch `fix/hosted-scanner-owner-routing`, based on merged
PR #12 / main `0d360fea9744df671aa2fbf600e9047580386b28`.

## Confirmed hosted problems

The scanner URL already belongs to `staff.silentrave.space`. On the first
production deployment, `scanner.html` and JavaScript returned 200, but staff
`scanner.css` and `scanner.webmanifest` redirected to `/login`. The subdomain
rewrite treated these public shell files as protected staff pages. The scanner
could therefore look unstyled and cache a login page in place of its shell files.

Owner login returned a relative `/admin` destination. Login through the root
website left the owner on the root website. Bank mutations correctly accept only
the admin origin, so that navigation produced `Origin not allowed`.
Until this patch is deployed, use `https://admin.silentrave.space/login` with the
website password before entering bank details. No bank records were changed by
the hosted investigation.

A bounded sample of the existing deployment measured first-byte times of about
0.9 seconds for cached events and 2.4 seconds for the home page. Staff CSS and
manifest redirects took about 2.8 seconds. These samples are observations, not a
performance guarantee or a measurement of the new code.

## Resulting behavior

- An exact list of first-party scanner files retains its original staff path.
  Lookalike filenames, protected pages, ticket data and scan APIs remain guarded.
- Root owner/staff page visits redirect to the configured subdomain. Root or
  admin scanner navigation redirects to the staff scanner. Queries are retained;
  API requests and mutation origins are not rewritten or relaxed.
- Hosted login and password-change responses select the appropriate full admin
  or staff URL, including the mandatory first-password-change journey. Local
  disposable fixtures retain their established relative navigation.
- Requests without a session cookie reject or redirect immediately instead of
  making a remote authentication-broker request. Requests with cookies still
  require the broker, database authorization and independent route guards.
- The scanner sign-in link uses `/login` on its staff host. Its shell change
  updates the generated service-worker cache revision. Pending scans in
  IndexedDB are preserved. Public pages already have a loading screen.

## Verification

Local focused configuration/policy tests: 18 passed, 0 failed, 163 assertions.
Scanner generation and application/tooling type checks passed. The first type
check detected an incorrectly typed test fetch mock; its cast was corrected and
the complete type check then passed.

Local HTTP regression: 6 passed, including the scanner MIME/path regression;
1 existing sliding-renewal test hit its unchanged 90-second timeout. The app and
database were cleaned up. This run is a failure, not a suite pass. Its assertions
and timeout remain unchanged; clean CI must verify session renewal before review.

Owned Chrome static-shell acceptance: 16 passed, including computed dark styling,
all eight shell files, sign-in feedback, mobile/landscape/enlarged-text layouts,
no JavaScript errors and a styled offline reload. The APIs were mocked to reject
unauthenticated requests. This is not hosted authentication, camera or ticket
admission evidence. The first browser attempt expected the wrong error wording;
the harness was corrected to assert the actual authentication response.
See `reports/scanner-routing/style-acceptance.json` and its mobile image.

Lint passed. Exact-head Windows/Linux CI results are recorded in the current
Desktop hosted routing fixes handoff. Do not interpret pending or failed runs as
passes.

Generated-runtime acceptance covers the exact scanner transfer paths and
canonical redirects, cookie-free rejection without a broker request, real
production login destinations, a password-confirmed inactive bank record in
disposable PostgreSQL, rejection of the root bank origin, and first-login
password navigation. All acceptance mutations use owned disposable fixture data.

## Deployment and next boundary

These changes do not update the live site until separately approved and deployed.
The currently published deploy is `6ac92823a8b7388685d7a67c` on the existing
`silentrave-app` site `1417352f-ff82-431f-b084-3c1a44ae9b57`.
The older `silentrave.netlify.app` preview is preserved.

After approval, merge only this reviewed PR, verify the merged source and deploy
that source through the established Netlify cloud build. Recheck scanner MIME
types, canonical navigation, authentication protections and page timing. A real
phone camera, authenticated hosted ticket admission, purchase/email and storage
privacy still need their own acceptance evidence. Email processing, scheduler
and the Resend webhook remain disabled; Backblaze remains deferred.
`readyForLaunch=false`. Preserve all branches and PR #11.
