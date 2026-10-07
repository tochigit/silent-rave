# Upload the Silent Rave design preview

This package is already built. It shows the existing website design with sample event content. Reservations, payments, uploads, messages and order-recovery emails are disabled.

1. Find `Silent Rave - Client Preview.zip` on your Desktop. Right-click it and choose **Extract All**. Open the extracted folder. The upload folder must contain `index.html`, `assets`, `events`, `event`, `about`, `contact`, `cart`, `checkout`, `lookup`, `_headers` and `robots.txt`.
2. Sign in to your Netlify account, then open https://app.netlify.com/drop. Select the team where you want to keep this preview.
3. Drag the extracted `Silent Rave - Client Preview` folder into the upload area. Upload only that prepared folder. It needs no build command, database, environment variables or connection to the GitHub repository.
4. Wait for Netlify to finish and open the generated `https://...netlify.app` address.
5. Open the link in an Incognito/InPrivate window. If Netlify asks for your team login, select **Make public** in the project overview, or change **Project configuration → General → Visitor access → Project visibility** to **Public**, then test again. Share only after the link opens for a visitor who is not signed in to your team.
6. Check the homepage and click **Buy tickets**. Select a sample ticket, add it to the cart and open checkout. The reservation button is disabled by design. Check the same link on your phone, then send the link to the client.

Suggested message: "Here is the Silent Rave website design preview. You can browse it on your phone or laptop. The event details are examples, and payments are disabled while you review the design."

Keep this as a separate preview project using the generated `netlify.app` address. No domain or DNS change is needed. To replace this preview later, open its project dashboard and drag the newly prepared output folder into its manual deploy area. Deleting or changing the production project is unnecessary.

If the upload page shows a 404, check that the folder you uploaded contains `index.html` directly inside it. If you see an extra outer folder after extracting the ZIP, upload the inner folder that contains `index.html`.

References checked on 2026-10-07:
- Netlify Drop: https://docs.netlify.com/start/quickstarts/netlify-drop-quickstart/
- Project visibility: https://docs.netlify.com/manage/security/secure-access-to-sites/project-visibility/
