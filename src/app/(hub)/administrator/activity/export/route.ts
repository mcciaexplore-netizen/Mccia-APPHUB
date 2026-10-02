import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/permissions";
import { listRows, parseFilters } from "@/lib/activity";
import { formatIST } from "@/lib/format";
import { toCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Forbidden", { status: 403 });
  const f = parseFilters(Object.fromEntries(req.nextUrl.searchParams));
  const rows = await listRows(f, undefined, 100000, 0);
  const csv = toCsv([["User", "Email", "Action", "Application", "Department", "IP address", "Time (IST)"], ...rows.map((r) => [r.user ?? "Unknown", r.email ?? "", r.action, r.action === "login" ? "" : (r.app ?? "Deleted application"), r.department ?? "", r.ip ?? "", formatIST(r.openedAt)])]);
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="activity-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
}
