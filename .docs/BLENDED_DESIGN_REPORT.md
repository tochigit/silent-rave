# Blended Silent Rave design

2026-10-07, Africa/Lagos. Existing branch fix/reference-design-mobile-first,
PR #9. The latest user instruction authorizes blending the earlier lively theme
with the client's references, visible top navigation and a better PC layout.
The request to merge the designs is visual direction, not Git merge approval.

The shared application and static preview now use the earlier dark background,
mint and lilac palette, brand wordmark and bold typography. The client's original
poster remains uncropped, with the mint ticker, authored description, purple
calendar dropdown, ticket rows and purchase popup. A solid lilac event masthead
gives the event more presence. No generated artwork, external fonts or gradients
were added. All original reference files are preserved.

Home, Events, About, Contact, Find order and Cart remain visible at the top on
phones and PCs, with 44px controls and an active-page indicator. Buy tickets
finds the next event through the existing API and focuses its ticket section.
The PC shell is 1180px wide; at 960px and above, the original poster sits beside
the description/calendar/tickets. Phones retain the original event section order.
The same palette improves event listings, forms, cart, checkout and information
pages. Details/Organizer/Venue have colored section rules and readable surfaces.

Real reservation, bank transfer, receipt upload and owner approval semantics remain
unchanged. The reference's EmailJS/instant approval scripts are not used. Preview
reads resolve in memory; submissions are disabled and CSP blocks HTTP connections.

Verification:
- Full local Bun ESLint and supported Node24 application/tooling types passed.
- Static preview build passed: 8 routes, 216669 JS bytes.
- Owned Chrome passed 37 meaningful checks at
  320/360/375/390/768/812/960/1024/1440/1920px. Compared source colors/cards/poster to the
  authored reference, then checked the authorized wider desktop design, mobile
  section order, all six top links at every width, active navigation and the
  Buy tickets jump. Also checked keyboard/focus, calendar, purchase popup, 44px
  targets, short landscape scrolling, quantity cap, optional names, persistence,
  filters, month/day calendar and disabled forms. No horizontal overflow,
  JavaScript errors, HTTP API/POST or external requests. Screenshots inspected.
- The first new URL assertion expected a trailing slash that the valid Buy
  tickets URL does not add. That test expectation was corrected; its failed
  attempt is preserved in initial-url-expectation-failure.json. It is not a pass.
- In-app browser discovery returned no available browser. The existing isolated
  owned Chrome harness was used and cleans up only its own process/profile.
- Browser and packaging evidence matches the exact built bundle/styles. Package
  allowlist, ZIP integrity and every archived byte passed: 14
  files, 229155 bytes, SHA256 f535f3bd2283100a4692167704ea79373e17d9aa1a182d75da5f421b50cf80ee.

New Desktop deliverables: Silent Rave - Blended Preview folder/ZIP and
Silent Rave - Blended preview upload steps.md. Both earlier Desktop packages and
reports/reference-design evidence remain preserved. The user can replace the
existing preview by dropping the new folder into its manual Deploys area.

Current exact publication head and CI are recorded after publication in the
Desktop Silent Rave - Blended design continuation.md. No Git merge, hosted
deployment/verification, production configuration, hosted data change, real
send or Batch B is implied. readyForLaunch=false remains.
