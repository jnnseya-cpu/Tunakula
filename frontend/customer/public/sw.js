/* Tunakula service worker: shows pushed order notifications and focuses the app when one is tapped. */
self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_) { payload = { body: event.data && event.data.text ? event.data.text() : "" }; }
  const title = payload.title || "Tunakula";
  const body = payload.body || "";
  const data = payload.data || {};
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/brand/tunakula-logo.jpg",
      badge: "/brand/tunakula-logo.jpg",
      tag: data.event || "tunakula",
      data,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.order_id ? `/track/?id=${event.notification.data.order_id}` : "/orders/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ("focus" in c) { c.navigate(url); return c.focus(); } }
      return self.clients.openWindow(url);
    }),
  );
});
