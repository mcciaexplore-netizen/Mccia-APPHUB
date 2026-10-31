import { issueLoginOtp } from "@/lib/cabs/driver-session";
import { idParam, ok, route } from "@/lib/cabs/guard";

export const dynamic = "force-dynamic";

/**
 * A Cabs admin makes a driver's sign-in code ("Get Login OTP"): 6 random digits, valid for 24 hours, replacing the driver's unused ones.
 * The digits are in this answer only, for the admin to give the driver; they are not stored.
 */
export const POST = route<{ id: string }>({ roles: ["cab_admin"] }, async ({ user, params }) => {
  const { otp, expiresAt, name } = await issueLoginOtp(idParam(params.id), user);
  const res = ok({ otp, expires_at: expiresAt.toISOString(), name });
  res.headers.set("Cache-Control", "no-store");
  return res;
});
