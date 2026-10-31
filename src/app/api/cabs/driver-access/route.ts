import { driverAccessInput } from "@/lib/cabs/driver-login-rules";
import { requestAccess } from "@/lib/cabs/driver-session";
import { ok, publicRoute, readJson } from "@/lib/cabs/guard";

export const dynamic = "force-dynamic";

/**
 * Step 1 of a driver's sign-in (open to anyone: it is the way in): their name and phone. A driver's phone: the Cabs admins are asked to
 * make a login OTP, and the page shows the OTP box. Any other phone: 404 "Phone number not found…".
 */
export const POST = publicRoute(async ({ req }) => {
  const { name, phone } = await readJson(req, driverAccessInput);
  return ok(await requestAccess(name, phone));
});
