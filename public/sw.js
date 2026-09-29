/* Lovely Step admin notifications. Deliberately no fetch cache: an admin must never see
   stale orders or stock because a service worker cached a private page. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let message = {};
  try { message = event.data ? event.data.json() : {}; } catch { message = { body: event.data?.text() || "" }; }
  const title = message.title || "Lovely Step";
  event.waitUntil(self.registration.showNotification(title, {
    body: message.body || "Une nouvelle commande vous attend.",
    icon: "/favicon.png",
    badge: "/favicon.png",
    tag: message.tag || "lovelystep-admin",
    renotify: true,
    requireInteraction: true,
    data: { url: message.url || "/admin?tab=orders" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/admin?tab=orders", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) return existing.navigate(target).then((client) => client?.focus());
    return self.clients.openWindow(target);
  }));
});
