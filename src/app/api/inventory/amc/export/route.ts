import { NextResponse } from "next/server";
import { toCsv } from "@/lib/csv";
import { amcFiltersFrom, amcYearsInUse, listAmc } from "@/lib/inventory/amc";
import { AMC_GROUP_ORDER, AMC_TYPE_LABEL, amcTotals, fyLabel, pickFy } from "@/lib/inventory/amc-shared";
import { route } from "@/lib/inventory/guard";
import { paiseToInput } from "@/lib/inventory/format";

export const dynamic = "force-dynamic";

/**
 * The contracts the page is showing (the same branch, category, financial year and vendor filters) as CSV, which Excel opens, with a Total
 * row. Amounts are plain rupee numbers so they can be summed. Inventory admin only.
 */
export const GET = route({ roles: ["inventory_admin"] }, async ({ req }) => {
  const sp = req.nextUrl.searchParams;
  const f = amcFiltersFrom((k) => sp.get(k));
  const fy = pickFy(f.fy ?? null, await amcYearsInUse(f.branchId));
  // In the order the branch page shows them: by branch, then type, then as added (the sort keeps the order within a type).
  const rows = (await listAmc({ ...f, fy })).sort((x, y) => x.branchName.localeCompare(y.branchName) || AMC_GROUP_ORDER.indexOf(x.amcType) - AMC_GROUP_ORDER.indexOf(y.amcType));
  const t = amcTotals(rows);
  const csv = `﻿${toCsv([
    ["Sr. No.", "Branch", "Equipment/Service", "Vendor Recommended", "AMC Type", "AMC Start Date", "AMC End Date", `AMC Amount FY ${fyLabel(fy)} (₹)`, `AMC Amount FY ${fyLabel(fy + 1)} (₹)`, "Notes"],
    ...rows.map((r, i) => [i + 1, r.branchName, r.equipmentService, r.vendorName, AMC_TYPE_LABEL[r.amcType], r.startDate ?? "", r.endDate ?? "", paiseToInput(r.amountCurrentFy), paiseToInput(r.amountNextFy), r.notes ?? ""]),
    ["", "", "Total", "", "", "", "", paiseToInput(t.current) || "0", paiseToInput(t.next) || "0", ""],
  ])}`;
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="inventory-amc-${fyLabel(fy)}.csv"`, "Cache-Control": "private, no-store" },
  });
});
