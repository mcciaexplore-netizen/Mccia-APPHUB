import { NextResponse, type NextRequest } from "next/server";
import { HttpError, assertUser, isAdminRole } from "@/lib/ivr/dal";
import { getKpis } from "@/lib/ivr/stats";
import { resolveRange } from "@/lib/ivr/time";

// Polled by the KPI strip. Agents only ever see their own numbers.
export async function GET(req: NextRequest) {
  try {
    const user = await assertUser();
    const sp = req.nextUrl.searchParams;
    const range = resolveRange({ range: sp.get("range") ?? undefined, from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined });
    const requested = sp.get("user") ?? undefined;
    const userId = isAdminRole(user.role) ? requested : user.id;
    const kpis = await getKpis({ userId, from: range.from, to: range.to });
    return NextResponse.json({ kpis });
  } catch (e) {
    if (e instanceof HttpError) return new NextResponse(e.message, { status: e.status });
    return new NextResponse("Error", { status: 500 });
  }
}
