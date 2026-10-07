# Silent Rave client design preview

The client's `references/Rave.html` and `references/Rave.css` are the foundation.
The latest user-authorized blend retains their mint ticker, uncropped poster,
purple calendar dropdown, mint ticket rows, purchase popup and mobile event order,
while bringing back the earlier dark/mint/lilac theme, brand and bold typography.
The latest user correction replaces mobile top links with a hamburger menu.
All six links remain available inside it; PCs keep visible top links. Buy tickets
stays directly accessible. PCs use an 1180px shell and a
poster/content split from 960px; the earlier 600px-only constraint is superseded.
`src/app/reference-rave.css` scopes the shared styling to the public site. Mobile
styles come first, with touch targets, keyboard focus, reduced motion and
short-screen modal scrolling. Original references and previous evidence remain.
The shared PublicTheme component defaults to dark, offers light/dark switching,
and remembers the preference under sr-color-theme when storage is available.
Light surfaces use readable green/purple text while retaining mint actions and
the lilac masthead. The control is inside the mobile menu and beside desktop links.

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
in `reports/polished-design/` and `reports/client-preview-build.json`. Acceptance
renders a script-free, network-free copy of the original reference for screenshots
and compares its poster/card/accent styling with the app, then checks the wider
desktop layout and mobile order. It also checks 320–1920px layouts, all six top
links, Buy tickets including busy/error/retry feedback, the popup, ten-ticket
limit, calendar, 200 percent zoom, hover/pressed states, light-theme contrast,
preference persistence/storage denial and disabled forms.
Evidence includes the exact tested bundle/style hashes; packaging rejects stale
browser acceptance.

After browser acceptance passes, run `python scripts/package-client-preview.py`
once to create the Desktop `Silent Rave - Polished Preview v1` folder, matching ZIP
and `Silent Rave - Polished preview v1 upload steps.md`. Packaging verifies
the output allowlist, build hashes, browser result, ZIP contents and bytes. It
refuses to overwrite existing Desktop deliverables. The earlier `Client Preview`,
`Reference Preview` and `Blended Preview` packages are preserved. Upload steps are in
[UPLOAD_STEPS.md](UPLOAD_STEPS.md).

This is a design preview, not a production release. Event/date/price/content are
samples; no orders, receipts, payments or messages are processed. Actual hosted
Netlify behavior can be confirmed only after the user uploads the package and
supplies its URL. Batch B and production rollout remain separate scopes.
