import { NextResponse } from "next/server";
import { FULL_ACCESS_ROLES, isDgOnly } from "@/lib/approvals/approvals.manifest";
import { route } from "@/lib/approvals/guard";
import { hasAnyRole } from "@/lib/approvals/host-adapter";
import { toCsv } from "@/lib/csv";
import { formatDateTime, formatINR } from "@/lib/approvals/format";
import { parseListParams } from "@/lib/approvals/list-params";
import { listRequests, type RequestRow } from "@/lib/approvals/request-queries";
import { resolveScreen } from "@/lib/approvals/screens";
import { STATUS_LABEL, TYPE_LABEL } from "@/lib/approvals/calc";

export const dynamic = "force-dynamic";

const HEADER = ["Request No.", "Type", "Name", "Category", "Branch", "Vendor", "Amount (INR)", "Date of Request", "Status", "Approver", "Decision Date"];
const line = (r: RequestRow) => [
  r.requestNo ?? "", TYPE_LABEL[r.type], r.name, r.categoryName ?? "", r.branchName ?? "", r.vendorName ?? "",
  r.amountPaise == null ? "" : formatINR(r.amountPaise), formatDateTime(r.requestedAt), STATUS_LABEL[r.status],
  r.approverName ?? "", formatDateTime(r.decidedAt),
];

/**
 * The list as a CSV file (opens in Excel): the same screen and filters as on the page, every page of it, up to 5,000 rows. Only for people
 * with full access, like the lists it comes from.
 */
export const GET = route({ roles: [...FULL_ACCESS_ROLES] }, async ({ req, user }) => {
  if (isDgOnly(user.roles)) return NextResponse.json({ error: "Not allowed." }, { status: 403 }); // the Director General works from the Recommended Queue
  const q = req.nextUrl.searchParams;
  const screen = resolveScreen((q.get("screen") ?? "").split("/").filter(Boolean), hasAnyRole(user, ["approver", "dg"]));
  if (!screen) return NextResponse.json({ error: "Unknown list." }, { status: 404 });
  const p = parseListParams(Object.fromEntries(q.entries()));

  const rows: RequestRow[] = [];
  for (let page = 1; page <= 25; page++) {
    const r = await listRequests(user, {
      types: screen.types, statuses: p.status ? [p.status as never] : screen.statuses, mine: screen.mine, waitingForMe: screen.waitingForMe, decidedByMe: screen.decidedByMe, recommendedByMe: screen.recommendedByMe, rejectedByMe: screen.rejectedByMe, approvedByMe: screen.approvedByMe, reachedMe: screen.reachedMe,
      q: p.q, from: p.from, to: p.to, categoryId: p.categoryId, branchId: p.branchId, sort: p.sort, dir: p.dir, page, pageSize: 200,
    });
    rows.push(...r.rows);
    if (rows.length >= r.total) break;
  }
  const csv = `﻿${toCsv([HEADER, ...rows.map(line)])}`;
  const name = `${screen.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.csv`;
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" },
  });
});
