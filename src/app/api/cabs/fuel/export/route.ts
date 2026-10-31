import { NextResponse } from "next/server";
import { toCsv } from "@/lib/csv";
import { listFuel } from "@/lib/cabs/fuel";
import { route } from "@/lib/cabs/guard";
import { paiseToRupees } from "@/lib/cabs/money";
import { formatIST } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Fuel costs as CSV, newest first, with the same filters as the page. Cabs admins only. */
export const GET = route({ roles: ["cab_admin"] }, async ({ req }) => {
  const sp = req.nextUrl.searchParams;
  const one = (k: string) => sp.get(k) ?? "";
  const rows = await listFuel({ vehicleId: one("fuelVehicle"), from: one("fuelFrom"), to: one("fuelTo") }, 20_000);
  const table = [
    ["Date", "Vehicle", "Litres", "Cost (Rs)", "Petrol station", "Added by"],
    ...rows.map((r) => [formatIST(r.fuelledAt), r.vehiclePlate, r.litres, paiseToRupees(r.costPaise), r.stationName ?? "", r.recordedByName]),
  ];
  return new NextResponse(`﻿${toCsv(table)}`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="cabs-fuel-costs.csv"', "Cache-Control": "private, no-store" },
  });
});
