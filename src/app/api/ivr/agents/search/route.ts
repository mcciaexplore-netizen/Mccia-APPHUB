import { NextResponse, type NextRequest } from "next/server";
import { HttpError, assertAdmin } from "@/lib/ivr/dal";
import { searchUnlinkedAgents } from "@/lib/ivr/host-adapter";

// "Add an agent" on Integrations: active hub users (IVR-CRM or not) not linked to a Smartflo agent yet, whose name or email contains `q`.
// IVR admins only. At most 8; one character is enough.
export async function GET(req: NextRequest) {
  try {
    await assertAdmin();
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
    const rows = q ? await searchUnlinkedAgents(q, 8) : [];
    return NextResponse.json(rows, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof HttpError) return new NextResponse(e.message, { status: e.status });
    return new NextResponse("Error", { status: 500 });
  }
}
