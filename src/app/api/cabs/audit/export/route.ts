import { NextResponse } from "next/server";
import { toCsv } from "@/lib/csv";
import { formatIST } from "@/lib/format";
import { AUDIT_ACTIONS, detailsText, exportCabAudit, isAuditAction, subjectOf } from "@/lib/cabs/audit";
import { route } from "@/lib/cabs/guard";

export const dynamic = "force-dynamic";

/** The Cab Booking audit log as CSV, with the same filters as the page (action, from, to, who, ride). Cabs admins only. */
export const GET = route({ roles: ["cab_admin"] }, async ({ req }) => {
  const sp = req.nextUrl.searchParams;
  const rows = await exportCabAudit({ action: sp.get("action") ?? "", from: sp.get("from") ?? "", to: sp.get("to") ?? "", actor: sp.get("actor") ?? "", ride: sp.get("ride") ?? "" });
  const csv = `﻿${toCsv([
    ["Time", "Who", "Action", "About", "Ride", "Details"],
    ...rows.map((r) => [formatIST(r.createdAt), r.actorName, isAuditAction(r.action) ? AUDIT_ACTIONS[r.action] : r.action, subjectOf(r.details), r.rideId ?? "", detailsText(r.details)]),
  ])}`;
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="cabs-audit-log.csv"', "Cache-Control": "private, no-store" },
  });
});
