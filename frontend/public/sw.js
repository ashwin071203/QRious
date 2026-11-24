/* QRious service worker: web push notifications only (no offline caching of private data). */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "QRious", body: event.data ? event.data.text() : "" }; }
  const title = data.title || "QRious";
  const url = typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/";
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    // Open tabs refresh their notification counts and lists right away (real-time without reloading).
    for (const w of windows) w.postMessage({ type: "qrious:notification", category: data.category || null, id: data.id || null });
    // Every push shows a notification (browsers require it). The tag makes a newer push for the same thing (e.g. the
    // same conversation) replace the older one instead of stacking, on every device.
    await self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag || data.id || undefined,
      renotify: !!data.tag,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      data: { url, id: data.id || null },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of windows) {
      if (new URL(w.url).origin === self.location.origin && "focus" in w) {
        await w.focus();
        if ("navigate" in w) { try { await w.navigate(url); } catch { w.postMessage({ type: "qrious:navigate", url }); } }
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});

self.addEventListener("pushsubscriptionchange", (event) => {
  // The browser rotated the subscription: ask open tabs to register the new one with the server.
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((ws) => ws.forEach((w) => w.postMessage({ type: "qrious:resubscribe" }))));
});
