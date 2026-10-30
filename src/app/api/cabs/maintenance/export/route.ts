import { NextResponse } from "next/server";
import { toCsv } from "@/lib/csv";
import { route } from "@/lib/cabs/guard";
import { formatIST } from "@/lib/format";
import { MAINTENANCE_LABEL } from "@/lib/cabs/cabs.manifest";
import { listMaintenance } from "@/lib/cabs/maintenance";
import { paiseToRupees } from "@/lib/cabs/money";

export const dynamic = "force-dynamic";

/** Maintenance records as CSV, with the same filters as the page. Cabs admins only. */
export const GET = route({ roles: ["cab_admin"] }, async ({ req }) => {
  const sp = req.nextUrl.searchParams;
  const one = (k: string) => sp.get(k) ?? "";
  const rows = await listMaintenance({ vehicleId: one("vehicle"), type: one("type"), from: one("from"), to: one("to") }, 20_000);
  const table = [
    ["Vehicle", "Type", "Description", "Cost (Rs)", "Done", "Done by", "Next due", "Notes", "Recorded by"],
    ...rows.map((r) => [r.vehiclePlate, MAINTENANCE_LABEL[r.type] ?? r.type, r.description, paiseToRupees(r.costPaise), formatIST(r.doneAt), r.doneBy, r.nextDueAt ? formatIST(r.nextDueAt) : "", r.notes ?? "", r.recordedByName]),
  ];
  return new NextResponse(`\uFEFF${toCsv(table)}`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="cabs-maintenance.csv"', "Cache-Control": "private, no-store" },
  });
});
