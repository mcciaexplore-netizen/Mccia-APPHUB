import { NextResponse } from "next/server";
import { HttpError, assertTeam } from "@/lib/aistudio/dal";
import { activity } from "@/lib/aistudio/queries";

// Never run at build time: every request reads the database (and who is asking).
export const dynamic = "force-dynamic";

// The dashboard's activity feed, polled every 15 seconds: the AI Studio team only.
export async function GET() {
  try {
    await assertTeam();
    return NextResponse.json({ items: await activity() }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof HttpError) return new NextResponse(e.message, { status: e.status });
    return new NextResponse("Error", { status: 500 });
  }
}
