# Upload the blended Silent Rave design preview

This package blends the client's `Rave.html` / `Rave.css` poster, ticker and ticket styling with the earlier dark, mint and purple theme. It has visible top navigation, bolder typography and a wider PC layout, while keeping the mobile event order. Event details are examples. Reservations, payments, uploads, messages and order-recovery emails are disabled. Use the new **Blended Preview** package; both older packages are preserved for comparison.

1. Open the prepared `Silent Rave - Blended Preview` folder on your Desktop. If using the ZIP, find `Silent Rave - Blended Preview.zip`, right-click it and choose **Extract All**. The upload folder must contain `index.html`, `assets`, `events`, `event`, `about`, `contact`, `cart`, `checkout`, `lookup`, `_headers` and `robots.txt`.
2. Sign in to your Netlify account, then open https://app.netlify.com/drop. Select the team where you want to keep this preview.
3. Drag the `Silent Rave - Blended Preview` folder into the upload area. Upload only that prepared folder. If you already uploaded the previous demo, open that preview project's **Deploys** page and drop the new folder into its manual deploy area to update the same URL. It needs no build command, database, environment variables or connection to the GitHub repository.
4. Wait for Netlify to finish and open the generated `https://...netlify.app` address.
5. Open the link in an Incognito/InPrivate window. If Netlify asks for your team login, select **Make public** in the project overview, or change **Project configuration → General → Visitor access → Project visibility** to **Public**, then test again. Share only after the link opens for a visitor who is not signed in to your team.
6. Check the NUSA Evangel homepage, poster and calendar dropdown on your phone and PC. Events, About, Contact, Find order and Cart appear at the top. Click **Buy tickets** to jump to the event's ticket section, then click a ticket's mint **Buy** button, change its quantity in the popup, add it to the cart and open checkout. The reservation button is disabled by design. Send the resulting link back for verification before sharing it with the client.

Suggested message: "Here is the Silent Rave website design preview. You can browse it on your phone or laptop. The event details are examples, and payments are disabled while you review the design."

Keep this as a separate preview project using the generated `netlify.app` address. No domain or DNS change is needed. To replace this preview later, open its project dashboard and drag the newly prepared output folder into its manual deploy area. Deleting or changing the production project is unnecessary.

If the upload page shows a 404, check that the folder you uploaded contains `index.html` directly inside it. If you see an extra outer folder after extracting the ZIP, upload the inner folder that contains `index.html`.

References checked on 2026-10-07:
- Netlify Drop: https://docs.netlify.com/start/quickstarts/netlify-drop-quickstart/
- Project visibility: https://docs.netlify.com/manage/security/secure-access-to-sites/project-visibility/
