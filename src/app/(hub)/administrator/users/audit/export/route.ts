import { NextResponse, type NextRequest } from "next/server";
import { listAudit } from "@/lib/audit";
import { toCsv } from "@/lib/csv";
import { formatIST } from "@/lib/format";
import { assertArea } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/** The audit log as a CSV file, with the page's filters. Head admin with Administrator unlocked, checked here as well as in the proxy. */
export async function GET(req: NextRequest) {
  try {
    await assertArea("audit");
  } catch {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const q = req.nextUrl.searchParams;
  const { rows } = await listAudit({ q: q.get("q") || undefined, action: q.get("action") || undefined, from: q.get("from") || undefined, to: q.get("to") || undefined, page: 1 }, 20000);
  const csv = toCsv([
    ["Time (IST)", "By", "Action", "About", "Details"],
    ...rows.map((r) => [formatIST(r.at), r.actorName, r.action, r.targetLabel, JSON.stringify(r.details)]),
  ]);
  return new NextResponse(`﻿${csv}`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "private, no-store" },
  });
}
