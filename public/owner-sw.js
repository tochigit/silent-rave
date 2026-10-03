/* The owner service worker caches no financial pages, API responses or proofs. */
self.addEventListener("push", event => {
  let data; try { data = event.data.json(); } catch { return; }
  const url = typeof data.url === "string" && /^\/admin\/orders\/[0-9a-f-]{36}$/.test(data.url) ? data.url : "/admin";
  event.waitUntil(self.registration.showNotification("Payment proof received", { body: typeof data.order_code === "string" ? data.order_code.slice(0, 20) : "Open your review queue", data: { url }, tag: "silent-rave-proof" }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close(); event.waitUntil(clients.openWindow(new URL(event.notification.data?.url || "/admin", self.location.origin).href));
});
