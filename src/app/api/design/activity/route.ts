import { NextResponse, type NextRequest } from "next/server";
import { HttpError, assertTeam } from "@/lib/design/dal";
import { activity } from "@/lib/design/detail";

// Polled every 15 seconds by the activity feeds, for the creative team: a lead sees every ticket's events (?scope=mine keeps it to their
// own); a designer only ever the events of the tickets assigned to them.
export async function GET(req: NextRequest) {
  try {
    const u = await assertTeam();
    const all = u.lead && req.nextUrl.searchParams.get("scope") !== "mine";
    return NextResponse.json({ items: await activity(all ? null : u.id) }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof HttpError) return new NextResponse(e.message, { status: e.status });
    return new NextResponse("Error", { status: 500 });
  }
}
