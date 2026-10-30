import { NextResponse } from "next/server";
import { toCsv } from "@/lib/csv";
import { route } from "@/lib/cabs/guard";
import { formatIST } from "@/lib/format";
import { paiseToRupees } from "@/lib/cabs/money";
import { listCostedRides } from "@/lib/cabs/payments";

export const dynamic = "force-dynamic";

/** Completed rides and their costs as CSV, with the same filters as the page. Cabs admins only. */
export const GET = route({ roles: ["cab_admin"] }, async ({ req }) => {
  const sp = req.nextUrl.searchParams;
  const one = (k: string) => sp.get(k) ?? "";
  const rows = await listCostedRides({ from: one("from"), to: one("to"), branch: one("branch") }, 20_000);
  const table = [
    ["Completed", "Rider", "Branch", "Pickup", "Drop-off", "Driver", "Cost (Rs)", "Distance (km)", "Cost notes", "Recorded by", "Invoice", "Invoice status"],
    ...rows.map((r) => [r.completedAt ? formatIST(r.completedAt) : "", r.requestedByName, r.branch ?? "", r.pickup, r.dropoff, r.driverName ?? "", paiseToRupees(r.farePaise),
      r.distanceKm == null ? "" : String(r.distanceKm), r.costNotes ?? "", r.recordedByName ?? "", r.invoiceNumber ?? "", r.invoiceStatus ?? ""]),
  ];
  return new NextResponse(`\uFEFF${toCsv(table)}`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="cabs-payments.csv"', "Cache-Control": "private, no-store" },
  });
});
