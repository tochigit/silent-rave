# Upload the polished Silent Rave design preview v1

This package polishes the client's poster, ticker and ticket design with the lively mint and purple theme. Typography, desktop balance, ticket prices, page spacing and button feedback have been refined. Phones and tablets use a hamburger menu; PCs show the top links. Buy tickets stays directly accessible. You can switch between dark and light themes; the device remembers your choice. Event details are examples. Reservations, payments, uploads, messages and order-recovery emails are disabled. Use **Polished Preview v1**; all earlier packages remain available for comparison.

1. Open the prepared `Silent Rave - Polished Preview v1` folder on your Desktop. If using the ZIP, find `Silent Rave - Polished Preview v1.zip`, right-click it and choose **Extract All**. The upload folder must contain `index.html`, `assets`, `events`, `event`, `about`, `contact`, `cart`, `checkout`, `lookup`, `_headers` and `robots.txt`.
2. Sign in to your Netlify account, then open https://app.netlify.com/drop. Select the team where you want to keep this preview.
3. Drag the `Silent Rave - Polished Preview v1` folder into the upload area. Upload only that prepared folder. To update the same preview URL, open that preview project's overview or **Deploys** page and drop the folder into the **Production deploys** upload area. It needs no build command, database, environment variables or connection to the GitHub repository. These manual update steps follow [Netlify's Drop guide](https://docs.netlify.com/start/quickstarts/netlify-drop-quickstart/).
4. Wait for Netlify to finish and open the generated `https://...netlify.app` address.
5. Open the link in an Incognito/InPrivate window. If Netlify asks for your team login, select **Make public** in the project overview, or change **Project configuration → General → Visitor access → Project visibility** to **Public**, then test again. Share only after the link opens for a visitor who is not signed in to your team. See [Netlify's visibility guide](https://docs.netlify.com/manage/security/secure-access-to-sites/project-visibility/).
6. Check the NUSA Evangel homepage, poster and calendar dropdown on your phone and PC. On your phone, tap the hamburger beside **Buy tickets** to open Events, About, Contact, Find order and Cart. Use **Appearance** in that menu to switch light/dark themes. On PCs, the theme icon sits beside the visible top links. Click **Buy tickets** to jump to the event's ticket section, then click a ticket's mint **Buy** button, change its quantity in the popup, add it to the cart and open checkout. The reservation button is disabled by design. Send the resulting link back for verification before sharing it with the client.

Suggested message: "Here is the Silent Rave website design preview. You can browse it on your phone or laptop. The event details are examples, and payments are disabled while you review the design."

Keep this as a separate preview project using the generated `netlify.app` address. No domain or DNS change is needed. To replace this preview later, open its project dashboard and drag the newly prepared output folder into its manual deploy area. Deleting or changing the production project is unnecessary.

If the upload page shows a 404, check that the folder you uploaded contains `index.html` directly inside it. If you see an extra outer folder after extracting the ZIP, upload the inner folder that contains `index.html`.

References checked on 2026-10-07:
- Netlify Drop: https://docs.netlify.com/start/quickstarts/netlify-drop-quickstart/
- Project visibility: https://docs.netlify.com/manage/security/secure-access-to-sites/project-visibility/
