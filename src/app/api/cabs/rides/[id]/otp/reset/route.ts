import { idParam, ok, route } from "@/lib/cabs/guard";
import { resetOtp } from "@/lib/cabs/otp";

export const dynamic = "force-dynamic";

/** A Cabs admin makes a new OTP for an assigned ride (after three wrong tries, or once it expired). The rider sees it on My Rides; it is not sent back here. */
export const POST = route<{ id: string }>({ roles: ["cab_admin"] }, async ({ user, params }) => {
  await resetOtp(idParam(params.id), user);
  return ok();
});
