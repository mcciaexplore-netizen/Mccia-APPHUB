// The service worker of "MCCIA Driver" (Cabs Driver installed as its own app, scope /cabs/driver). Like the hub's /sw.js it caches
// nothing: every page and sign-in check still comes from the server. The empty fetch handler is what browsers look for before offering
// "Install".
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
