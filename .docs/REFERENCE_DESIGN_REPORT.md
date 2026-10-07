# Reference design correction

Historical restoration report. The subsequent user-authorized blend, visible
top navigation and wider PC layout are described in [BLENDED_DESIGN_REPORT.md](BLENDED_DESIGN_REPORT.md).
Its current delivery is **Silent Rave - Blended Preview**; the 600px-only rule below
is superseded. Original reference files and earlier evidence remain preserved.

2026-10-07, Africa/Lagos. Branch `fix/reference-design-mobile-first`, base
`5d566efd2529c2bf1bd8634f5013578d853df450`. The user rejected the prior preview's
invented hero/layout and explicitly authorized restoring the client's references
with mobile-first responsiveness and further improvements within that design.

The source of truth is `references/Rave.html` and `references/Rave.css`. Those
original files and the poster are preserved. Shared application UI and the static
client preview now use the same adaptation in `src/app/reference-rave.css`:
the light exterior, 600px dark card, Arial/uppercase centered event heading, mint
marquee, uncropped full-width poster, original description ordering, purple
calendar dropdown, mint ticket rows, purchase popup, Details/Organizer and Venue.
The invented frequency-ring hero and desktop split event layout are removed.

Enhancements preserve that visual identity: responsive single-column defaults,
small navigation menu, legible ticket text, 44px controls, 16px form inputs,
keyboard skip/focus/escape/return, reduced-motion ticker, scrollable short-screen
dialog, quantity limit and optional holder names. Purple is slightly darkened for
white-label contrast above 4.5:1. Event dates agree across header/details and use
Africa/Lagos. The demo uses NUSA Evangel/title/venue/description and two ticket
examples from the source; these examples do not modify hosted event data.

Checkout, cart, events/calendar, About, Contact and recovery share the restored
styles. Actual reservation/bank/proof/owner-approval rules remain intact. The
reference's EmailJS/instant-pass script is never used. Real map/calendar links
remain data-driven; the static demo's map placeholder performs no external fetch.

Verification:
- Local full Bun lint and supported Node24 app/tooling TypeScript checks passed.
  An earlier Node24 ESLint attempt stalled and was stopped; it is incomplete,
  separate from the successful Bun lint. Global Node26 was not changed.
- Static preview build passed: 8 pages, 215521 JS bytes.
- Owned Chrome passed 30 meaningful browser checks at
  320/360/375/390/768/812/1440px. It rendered a script-free/network-free copy of
  the client's original HTML/CSS and compared card/poster widths, title styling,
  core colors and vertical section order with the shared site UI. It also checked
  contrast, keyboard/menu/calendar, ticket popup at phone/short landscape sizes,
  ten-ticket limit, optional names, cart persistence, filters/calendar and forms.
  No horizontal overflow, JavaScript errors, HTTP API/POST or external requests.
  The final accepted bundle and style hashes are recorded in acceptance.json.
  Original/corrected desktop/mobile and popup/checkout screenshots were inspected.
- First comparison attempt used a selector that also matched Organizer instead
  of Venue. That test failure is preserved as initial-section-selector-failure.json;
  it was fixed before the accepted runs. It is not a pass.
- ZIP allowlist/hash/integrity/byte checks passed; 14 files,
  228256 bytes, SHA256 1c1d6f5ced956fda4c44d88f70950ebb98a567c374eff05fc4c14232d575ce4e.
  Packaging requires browser evidence for exactly the built bundle/styles.
- In-app browser discovery reported no available browsers; isolated owned Chrome
  was used, with its own profile and process cleanup. No user profile was attached.

Corrected Desktop deliverables:
`Silent Rave - Reference Preview` folder, matching ZIP, and
`Silent Rave - Reference preview upload steps.md`. Older Client Preview artifacts
and their acceptance evidence remain preserved, but are superseded for design
review. The user can drop the new folder into the existing preview's manual
Deploys area to update that demo URL, or use Netlify Drop for a separate preview.

Exact publication head, PR and final CI status are recorded in the Desktop
`Silent Rave - Reference design continuation.md` after publication. No merge,
provider upload, hosted mutation, real send, Batch B or production rollout was
performed by this correction. readyForLaunch=false remains.
