# Silent Rave local design review

This is the first Nitro-inspired redesign for owner review. No deployment is
authorized. The live website still uses the previous design.

To view it on this development computer:

1. Open a terminal in `C:\Users\Tochi\Desktop\Silent Rave`.
2. Run `bun --no-env-file run preview:build`.
3. Run `bun --no-env-file run preview:serve` and leave that terminal open.
4. Open http://127.0.0.1:4173 in your browser.
5. Press Ctrl+C in the terminal to stop the preview when finished.

Start with the homepage, then click **Get tickets** to see the event page.
Try the phone layout, ticket selector, cart and checkout. Contact, order recovery,
reservations and payments are disabled in this sample preview. It sends no email
and connects to no database. Dates and ticket prices are examples.

The build shares the app's public components and stylesheet. Preview controls
substitute sample data and remove submission handlers; the app's existing real
payment, email, order and authentication code remains unchanged.

The Desktop folder `Silent Rave - Nitro Redesign Preview v1` and ZIP
`Silent Rave - Nitro Redesign Preview v1.zip` contain the static build, not the
repository or credentials. These files need a local static HTTP server; opening
index.html directly will not run the routed preview. Do not upload them to
Netlify while deployments are on hold.

For a remote owner, share the screenshots in the Desktop folder
`Silent Rave - Nitro Redesign Screenshots v1`. Their device cannot open this
computer's 127.0.0.1 address. Collect their comments on the layout, typography,
colours and ticket presentation; we will revise locally before any deployment.
