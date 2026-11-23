import { NextResponse } from "next/server";
import { HttpError, assertMember } from "@/lib/attendance/dal";
import { latestNotice } from "@/lib/attendance/host-adapter";

// Never run at build time: every request reads who is asking.
export const dynamic = "force-dynamic";

// What a phone notification shows. A push carries no message (src/lib/attendance/push.ts): the service worker wakes up and asks here, with
// the person's own sign-in, for their newest Attendance notice.
export async function GET() {
  try {
    const u = await assertMember();
    const n = await latestNotice(u.id);
    return NextResponse.json(
      n ? { title: n.title, body: n.body ?? "", link: n.link ?? "/attendance", at: n.createdAt } : { title: "MCCIA People", body: "Open Attendance for the latest.", link: "/attendance", at: null },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (e) {
    if (e instanceof HttpError) return new NextResponse(e.message, { status: e.status });
    return new NextResponse("Error", { status: 500 });
  }
}
