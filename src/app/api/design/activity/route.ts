import { NextResponse, type NextRequest } from "next/server";
import { HttpError, assertTeam } from "@/lib/design/dal";
import { activity } from "@/lib/design/detail";

// Polled every 15 seconds by the activity feeds, for the creative team (who see every ticket); ?scope=mine keeps it to the person's own.
export async function GET(req: NextRequest) {
  try {
    const u = await assertTeam();
    const all = req.nextUrl.searchParams.get("scope") !== "mine";
    return NextResponse.json({ items: await activity(all ? null : u.id) }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof HttpError) return new NextResponse(e.message, { status: e.status });
    return new NextResponse("Error", { status: 500 });
  }
}
