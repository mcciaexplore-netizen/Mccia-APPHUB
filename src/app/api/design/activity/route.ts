import { NextResponse, type NextRequest } from "next/server";
import { HttpError, assertTeam } from "@/lib/design/dal";
import { activity } from "@/lib/design/detail";

// Polled every 15 seconds by the activity feeds. A designer only ever gets their own tickets; ?scope=all is for leads (the team overview).
export async function GET(req: NextRequest) {
  try {
    const u = await assertTeam();
    const all = req.nextUrl.searchParams.get("scope") === "all" && u.lead;
    return NextResponse.json({ items: await activity(all ? null : u.id) }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof HttpError) return new NextResponse(e.message, { status: e.status });
    return new NextResponse("Error", { status: 500 });
  }
}
