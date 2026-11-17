import { NextResponse, type NextRequest } from "next/server";
import { HttpError, assertUser, isAdminRole } from "@/lib/ivr/dal";
import { callsChangedAt } from "@/lib/ivr/live-changes";

// Never run at build time: every request reads the database (and who is asking).
export const dynamic = "force-dynamic";

// Asked every few seconds by each open Membership CRM page: when a call the person can see last changed. One small indexed query and
// no Smartflo request; the page refreshes itself when the answer moves (a webhook just saved a finished call). ?scope=team (the admin
// pages) is honoured only for IVR admins; anyone else gets their own calls.
export async function GET(req: NextRequest) {
  try {
    const user = await assertUser();
    const team = req.nextUrl.searchParams.get("scope") === "team" && isAdminRole(user.role);
    return NextResponse.json({ changedAt: await callsChangedAt(user.id, team) }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof HttpError) return new NextResponse(e.message, { status: e.status });
    return new NextResponse("Error", { status: 500 });
  }
}
