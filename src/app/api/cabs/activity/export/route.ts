import { NextResponse } from "next/server";
import { toCsv } from "@/lib/csv";
import { route } from "@/lib/cabs/guard";
import { formatIST } from "@/lib/format";
import { userActivity } from "@/lib/cabs/activity";

export const dynamic = "force-dynamic";

/** User activity as CSV, with the same filters as the page. Cabs admins only. */
export const GET = route({ roles: ["cab_admin"] }, async ({ req }) => {
  const sp = req.nextUrl.searchParams;
  const one = (k: string) => sp.get(k) ?? "";
  const rows = await userActivity({ branch: one("branch"), from: one("from"), to: one("to"), sort: one("sort") === "name" ? "name" : "total" });
  const table = [
    ["User", "Branch", "Total rides", "This month", "This week", "Last ride", "Most common pickup"],
    ...rows.map((r) => [r.name, r.branch ?? "", String(r.total), String(r.month), String(r.week), r.lastRide ? formatIST(r.lastRide) : "", r.commonPickup ?? ""]),
  ];
  return new NextResponse(`\uFEFF${toCsv(table)}`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="cabs-user-activity.csv"', "Cache-Control": "private, no-store" },
  });
});
