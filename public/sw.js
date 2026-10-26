// The service worker that makes the hub installable as an app. It caches nothing: every page and sign-in check still comes from the
// server, so nobody ever sees an old or someone else's page. The empty fetch handler is what browsers look for before offering "Install".
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
