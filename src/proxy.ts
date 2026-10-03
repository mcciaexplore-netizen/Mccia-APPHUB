import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, ADMIN_IDLE, SESSION_COOKIE, cookieOptions, sign, verify } from "@/lib/session";

/**
 * The gate in front of the whole site. It only reads signed cookies (no database), so it is fast:
 *   - nobody gets past /login without a valid sign-in;
 *   - /administrator needs a recent password check on top of that, kept alive while it is in use;
 *   - loading any page outside /administrator (a full page load) locks it again; moving around inside the app is handled by
 *     the sidebar, which calls lockAdmin() when you really leave Administrator (background prefetches must not count).
 * Every server action and page still checks for itself (src/lib/permissions.ts); this is the first line, not the only one.
 */
export function proxy(req: NextRequest) {
  const { pathname, search, protocol } = req.nextUrl;
  const secure = protocol === "https:";
  const to = (path: string) => NextResponse.redirect(new URL(path, req.url));
  const here = encodeURIComponent(pathname + search);

  if (pathname === "/login") return NextResponse.next(); // the page itself sends signed-in people on

  const session = verify(req.cookies.get(SESSION_COOKIE)?.value, "session");
  if (!session) return to(`/login?next=${here}`);

  const unlock = verify(req.cookies.get(ADMIN_COOKIE)?.value, "admin");
  const unlocked = !!unlock && unlock.u === session.u;
  const inAdmin = pathname === "/administrator" || pathname.startsWith("/administrator/");

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

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|map|txt|woff2?)$).*)"],
};
