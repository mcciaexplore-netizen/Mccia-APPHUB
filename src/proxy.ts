import { NextResponse, type NextRequest } from "next/server";
import { isAdminPath } from "@/lib/admin-paths";
import { ADMIN_COOKIE, ADMIN_IDLE, SESSION_COOKIE, cookieOptions, sign, verify } from "@/lib/session";

/**
 * The gate in front of the whole site. It only reads signed cookies (no database), so it is fast:
 *   - nobody gets past /login without a valid sign-in;
 *   - /administrator needs a recent password check on top of that, kept alive while it is in use;
 *   - loading any page outside /administrator (a full page load) locks it again; moving around inside the app is handled by
 *     the page frame (HubShell), which calls lockAdmin() when you really leave Administrator (background prefetches must not count).
 * Every server action and page still checks for itself (src/lib/permissions.ts); this is the first line, not the only one.
 *
 * Cab Booking's drivers can sign in to Cabs Driver with their phone instead of a hub account (src/lib/cabs/driver-session.ts). Without a
 * hub sign-in, only the driver pages and the few routes the driver app calls go through (DRIVER_PATH), and each of those checks the
 * driver's own sign-in itself, sending anyone without one to /cabs/driver-login. Someone signed in to the hub is handled as before.
 */
const DRIVER_PATH = /^\/(?:cabs\/driver(?:\/.*)?|cabs\/driver-login|api\/cabs\/(?:driver-access|driver-login|driver-logout|driver-me|driver\/availability|location|rides\/[^/]+\/(?:otp\/verify|start|complete)))$/;

export function proxy(req: NextRequest) {
  const { pathname, search, protocol } = req.nextUrl;
  const secure = protocol === "https:";
  const to = (path: string) => NextResponse.redirect(new URL(path, req.url));
  const here = encodeURIComponent(pathname + search);

  // The sign-in page sends signed-in people on by itself. /set-password is where a new person opens their one-time link, before they have a password.
  if (pathname === "/login" || pathname === "/set-password") return NextResponse.next();

  const session = verify(req.cookies.get(SESSION_COOKIE)?.value, "session");
  if (!session) return DRIVER_PATH.test(pathname) ? NextResponse.next() : to(`/login?next=${here}`);

  const unlock = verify(req.cookies.get(ADMIN_COOKIE)?.value, "admin");
  const unlocked = !!unlock && unlock.u === session.u;
  const inAdmin = isAdminPath(pathname); // Administrator, and the Approval System's admin pages

  if (inAdmin) {
    if (!unlocked) return to(`/unlock?next=${here}`);
    const res = NextResponse.next();
    res.cookies.set(ADMIN_COOKIE, sign(session.u, "", "admin", ADMIN_IDLE), cookieOptions(undefined, secure)); // idle timer restarts; a session cookie, so closing the browser locks it
    return res;
  }

  // A real page load (typing an address, a bookmark, a reload) outside Administrator locks it. The router's background fetches are not page loads.
  const res = NextResponse.next();
  if (req.cookies.has(ADMIN_COOKIE) && req.headers.get("sec-fetch-dest") === "document" && pathname !== "/unlock") res.cookies.delete(ADMIN_COOKIE);
  return res;
}

// /api/cron/ is called by Vercel Cron, which has no sign-in: that route checks CRON_SECRET itself. /api/ping (the keep-warm ping, also
// Vercel Cron) is open to anyone and answers only "ok" and the time. /api/ivr/webhooks/ is where Tata Smartflo posts IVR-CRM's call
// events; Smartflo cannot sign in, so the route checks the secret in its own address itself (and answers 404 to anything else).
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|api/cron/|api/ivr/webhooks/|api/ping$|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|map|txt|woff2?)$).*)"],
};
