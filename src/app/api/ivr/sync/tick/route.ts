import { NextResponse } from "next/server";
import { HttpError, assertUser } from "@/lib/ivr/dal";
import { runIncrementalSync } from "@/lib/ivr/smartflo/sync";

export const maxDuration = 60;

// Called by the heartbeat in every open IVR-CRM tab (and by the "Sync now" chip). Anyone holding an IVR-CRM role may trigger it: it is throttled
// and single-flight on the server, so many tabs cost one Smartflo request per minute in total.
async function allowed(): Promise<Response | null> {
  try {
    await assertUser();
    return null;
  } catch (e) {
    return new NextResponse(e instanceof HttpError ? e.message : "Error", { status: e instanceof HttpError ? e.status : 500 });
  }
}

export async function POST() {
  const refused = await allowed();
  if (refused) return refused;
  const result = await runIncrementalSync();
  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
}

/** The "Sync now" button: same work, but skips the freshness and working-hours checks. */
export async function PUT() {
  const refused = await allowed();
  if (refused) return refused;
  const result = await runIncrementalSync({ force: true });
  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
}
