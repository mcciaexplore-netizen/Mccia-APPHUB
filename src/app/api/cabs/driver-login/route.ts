import { DRIVER_SESSION_COOKIE, driverLoginInput } from "@/lib/cabs/driver-login-rules";
import { loginWithOtp, sessionCookie } from "@/lib/cabs/driver-session";
import { ok, publicRoute, readJson } from "@/lib/cabs/guard";

export const dynamic = "force-dynamic";

/**
 * A driver signs in to Cabs Driver with their phone and the 6-digit OTP an admin gave them (open to anyone: it is the way in). Right: a
 * 12-hour session in an httpOnly cookie. Wrong, used, expired or an unknown phone: 401 "Invalid phone or OTP"; the fifth wrong try locks
 * the code: 429.
 */
export const POST = publicRoute(async ({ req }) => {
  const { phone, otp } = await readJson(req, driverLoginInput);
  const { token } = await loginWithOtp(phone, otp);
  const res = ok();
  res.cookies.set(DRIVER_SESSION_COOKIE, token, sessionCookie(req.nextUrl.protocol === "https:"));
  return res;
});
