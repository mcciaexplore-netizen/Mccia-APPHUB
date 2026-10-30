import { NextResponse } from "next/server";
import { toCsv } from "@/lib/csv";
import { formatIST } from "@/lib/format";
import { AUDIT_ACTIONS, detailsText, exportInventoryAudit, isAuditAction } from "@/lib/inventory/audit";
import { route } from "@/lib/inventory/guard";

export const dynamic = "force-dynamic";

/** The Inventory audit log as CSV, with the same filters as the page (branch, action, from, to). Inventory admin only. */
export const GET = route({ roles: ["inventory_admin"] }, async ({ req }) => {
  const sp = req.nextUrl.searchParams;
  const rows = await exportInventoryAudit({ branchId: sp.get("branch") ?? "", action: sp.get("action") ?? "", from: sp.get("from") ?? "", to: sp.get("to") ?? "" });
  const csv = `﻿${toCsv([
    ["Time", "Who", "Action", "Item / Target", "Branch", "Details"],
    ...rows.map((r) => [formatIST(r.createdAt), r.actorName, isAuditAction(r.action) ? AUDIT_ACTIONS[r.action] : r.action, r.targetLabel, r.branchName ?? "", detailsText(r.details)]),
  ])}`;
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="inventory-audit-log.csv"', "Cache-Control": "private, no-store" },
  });
});
