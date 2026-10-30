import { idParam, ok, readJson, route } from "@/lib/cabs/guard";
import { verifyOtp } from "@/lib/cabs/otp";
import { otpInput } from "@/lib/cabs/validation";

export const dynamic = "force-dynamic";

/**
 * The ride's own driver enters the rider's OTP at the pickup. Right: the ride is in progress and the answer carries the Google Maps link
 * (mapsUrl). Wrong: 409 saying how many tries are left; three wrong lock it until a Cabs admin makes a new one.
 */
export const POST = route<{ id: string }>({ roles: ["cab_driver"] }, async ({ req, user, params }) => {
  const { otp } = await readJson(req, otpInput);
  return ok(await verifyOtp(idParam(params.id), otp, user));
});
