/* Only for system notifications ("a shop answered") while the person is in another app. It has no fetch
   handler on purpose: nothing is cached and every request goes to the network as before. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true })
      .then((cs) => (cs.length ? cs[0].focus() : self.clients.openWindow("/")))
  );
});
