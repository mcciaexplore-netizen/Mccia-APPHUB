import { NextResponse } from "next/server";
import { HttpError, assertMember } from "@/lib/attendance/dal";
import { getSettings } from "@/lib/attendance/config";
import { requestIpDetails } from "@/lib/attendance/host-adapter";
import { ipAllowed, normalizeIp } from "@/lib/attendance/checkin-rules";

// Never run at build time: every request reads who is asking and their address.
export const dynamic = "force-dynamic";

// For checking office-network check-in: the address the server sees for this request (the same one check-in uses), the headers it comes
// from, and whether it is one of the office IPs. Anyone in Attendance sees their own address and the answer; HR also see the list itself.
export async function GET() {
  try {
    const u = await assertMember();
    const [{ ip, headers }, s] = await Promise.all([requestIpDetails(), getSettings()]);
    return NextResponse.json(
      {
        ip,
        normalized: normalizeIp(ip),
        matchesOfficeIp: ipAllowed(ip, s.officeIps),
        officeIpCount: s.officeIps.length,
        ...(u.admin ? { officeIps: s.officeIps, office: s.office } : {}),
        headers,
        note: s.officeIps.length ? undefined : "No office IPs are set: only phone location (GPS) check-in can work.",
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (e) {
    if (e instanceof HttpError) return new NextResponse(e.message, { status: e.status });
    return new NextResponse("Error", { status: 500 });
  }
}
