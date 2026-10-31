import { DRIVER_SESSION_COOKIE } from "@/lib/cabs/driver-login-rules";
import { endSession, sessionCookie } from "@/lib/cabs/driver-session";
import { ok, publicRoute } from "@/lib/cabs/guard";

export const dynamic = "force-dynamic";

/** A driver signed in by phone signs out: the session ends and the cookie is cleared. Answers ok even with no session. */
export const POST = publicRoute(async ({ req }) => {
  await endSession(req.cookies.get(DRIVER_SESSION_COOKIE)?.value);
  const res = ok();
  res.cookies.set(DRIVER_SESSION_COOKIE, "", { ...sessionCookie(req.nextUrl.protocol === "https:"), maxAge: 0 });
  return res;
});
