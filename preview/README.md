# Silent Rave client design preview

The client's `references/Rave.html` and `references/Rave.css` define the design.
The shared public components now preserve their single-column 600px event card,
light outer background, Arial, mint ticker, centered title, uncropped poster,
purple calendar dropdown, mint ticket rows, purchase popup and details/venue order.
`src/app/reference-rave.css` scopes that adaptation to the public site. Mobile
styles come first; touch targets, keyboard focus, reduced motion, short-screen
modal scrolling and legible text improve the original without changing its theme.

The standalone static preview reuses the current customer shell, homepage JSX,
event cards/list/calendar/detail, cart, checkout, content and recovery components,
plus the public CSS and existing poster. Illustrative event and About/Contact copy
is confined to `fixtures.ts`. The demo uses the client's NUSA Evangel examples;
dates and prices remain illustrative. Application UI uses the same adaptation;
existing payment/approval rules and launch settings are preserved.

Build from the repository root with `bun --no-env-file run preview:build`. Upload
only the generated `out/client-preview` directory. It needs no provider keys,
database, server functions, install or build step at Netlify.

The build adapter replaces server reads with local fixtures, removes submission
handlers, disables form buttons and gives the cart a separate session key. Its
source contracts fail the build if the existing component structure changes.
Server-module imports are denied and the final bundle is checked for submission
endpoints and secret identifiers. All preview component fetches resolve in memory;
CSP also blocks network connections. The folder contains only an explicit public
file list. API/admin/staff/scanner functionality is excluded.

Verify with supported Node 24: `node scripts/browser-client-preview.mjs`. It uses
the existing pinned Playwright client under ignored `.test-runtime/browser-check`,
starts a loopback static server and its own headless Chrome/profile, and cleans up
its processes. Set `BROWSER_EXECUTABLE` when Chrome is not at the Windows default.
CI installs that client and checks the preview in owned Linux Chrome. Evidence is
in `reports/reference-design/` and `reports/client-preview-build.json`. Acceptance
renders a script-free, network-free copy of the original reference for screenshots
and compares desktop geometry/colors/type with the app. It also checks 320–1440px
layouts, the ticket popup, ten-ticket limit, calendar/navigation and disabled forms.
Evidence includes the exact tested bundle/style hashes; packaging rejects stale
browser acceptance.

After browser acceptance passes, run `python scripts/package-client-preview.py`
once to create the Desktop `Silent Rave - Reference Preview` folder, matching ZIP
and `Silent Rave - Reference preview upload steps.md`. Packaging verifies
the output allowlist, build hashes, browser result, ZIP contents and bytes. It
refuses to overwrite existing Desktop deliverables. The earlier `Client Preview`
package is preserved and superseded for client design review. The upload steps are in
[UPLOAD_STEPS.md](UPLOAD_STEPS.md).

This is a design preview, not a production release. Event/date/price/content are
samples; no orders, receipts, payments or messages are processed. Actual hosted
Netlify behavior can be confirmed only after the user uploads the package and
supplies its URL. Batch B and production rollout remain separate scopes.
