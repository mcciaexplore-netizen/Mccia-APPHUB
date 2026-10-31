import { NextResponse } from "next/server";
import { getDriverSession } from "@/lib/cabs/driver-session";
import { ok, publicRoute } from "@/lib/cabs/guard";

export const dynamic = "force-dynamic";

/** The driver signed in by phone on this browser (name, phone, online or not), or 401. */
export const GET = publicRoute(async () => {
  const d = await getDriverSession();
  if (!d) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  return ok({ driver: { id: d.driverId, name: d.name, phone: d.phone, isAvailable: d.isAvailable } });
});
