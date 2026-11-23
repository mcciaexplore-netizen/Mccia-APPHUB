// The service worker of "MCCIA People" (Attendance, /attendance). Its offline page follows dark mode too. Registered with scope /attendance by the Attendance pages, so it never
// handles a hub page (those keep the hub's own /sw.js, which caches nothing).
//
//   Pages (/attendance…): network first; a good copy is kept, so with no connection the last copy is shown (the page then says it is offline).
//   Built files (/_next/static/…): cache first: their names change with every deploy.
//   Anything else (server actions, API calls, sign-in): straight to the network, never cached.
//   A different person signing in on the same device: the kept pages are thrown away first (the page tells this worker who is signed in).
//   Push: a push carries no message; the worker asks /api/attendance/push/latest (with the person's own sign-in) and shows that notice.
const VERSION = "att-v1";
const PAGES = `${VERSION}-pages`;
const ASSETS = `${VERSION}-assets`;
const META = `${VERSION}-meta`;
const USER_KEY = "/__attendance-user";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith("att-") && !key.startsWith(VERSION)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "user" || typeof data.id !== "string") return;
  event.waitUntil(
    (async () => {
      const meta = await caches.open(META);
      const prev = await meta.match(USER_KEY);
      const prevId = prev ? await prev.text() : null;
      if (prevId !== data.id) {
        await caches.delete(PAGES);
        await meta.put(USER_KEY, new Response(data.id));
      }
    })(),
  );
});

const offlinePage = () =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Offline · MCCIA People</title>` +
      // Light or dark like the app: the person's choice on this device (localStorage "att-theme"), else the device's setting.
      `<style>body{font-family:system-ui,sans-serif;background:#f8f9fa;color:#111827;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}p{color:#6b7280}` +
      `@media (prefers-color-scheme:dark){body:not(.light){background:#111827;color:#f9fafb}body:not(.light) p{color:#9ca3af}}body.dark{background:#111827;color:#f9fafb}body.dark p{color:#9ca3af}</style>` +
      `<body><script>try{var t=localStorage.getItem("att-theme");if(t)document.body.className=t}catch(e){}</script>` +
      `<div><div style="font-size:40px">📶</div><h1 style="font-size:20px;margin:12px 0 6px">You are offline</h1>` +
      `<p style="margin:0 0 16px">This page has not been opened on this device yet. Connect to the internet and try again.</p>` +
      `<button onclick="location.reload()" style="background:#16a34a;color:#fff;border:0;border-radius:12px;padding:12px 20px;font-size:16px;font-weight:700">Try again</button></div>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate" && (url.pathname === "/attendance" || url.pathname.startsWith("/attendance/"))) {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          // Only real pages are kept: never a redirect to sign-in or an error page.
          if (res.ok && !res.redirected && res.type === "basic") {
            const copy = res.clone();
            event.waitUntil(caches.open(PAGES).then((c) => c.put(req, copy)));
          }
          return res;
        } catch {
          const pages = await caches.open(PAGES);
          return (await pages.match(req)) || (await pages.match(new Request(url.origin + url.pathname))) || (await pages.match(url.origin + "/attendance")) || offlinePage();
        }
      })(),
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      (async () => {
        const assets = await caches.open(ASSETS);
        const hit = await assets.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) event.waitUntil(assets.put(req, res.clone()));
        return res;
      })(),
    );
  }
});

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let n = null;
      try {
        const res = await fetch("/api/attendance/push/latest", { credentials: "include", cache: "no-store" });
        if (res.ok) n = await res.json();
      } catch {
        // offline or signed out: a general notice instead
      }
      await self.registration.showNotification((n && n.title) || "MCCIA People", {
        body: (n && n.body) || "Open Attendance for the latest.",
        icon: "/icons/attendance-192.png",
        badge: "/icons/attendance-192.png",
        tag: "attendance",
        renotify: true,
        data: { link: (n && n.link) || "/attendance" },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/attendance";
  const target = new URL(link, self.location.origin).href;
  event.waitUntil(
    (async () => {
      for (const c of await self.clients.matchAll({ type: "window", includeUncontrolled: true })) {
        if (c.url.startsWith(self.location.origin) && "focus" in c) {
          await c.focus();
          if ("navigate" in c) await c.navigate(target).catch(() => {});
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
