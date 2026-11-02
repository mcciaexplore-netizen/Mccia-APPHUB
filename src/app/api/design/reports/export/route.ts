import { NextResponse, type NextRequest } from "next/server";
import { toCsv } from "@/lib/csv";
import { HttpError, assertLead } from "@/lib/design/dal";
import { report, reportRows } from "@/lib/design/reports";
import { renderReportPdf } from "@/lib/design/report-pdf";
import { daysBetween, istDate, addDays } from "@/lib/design/rules";

export const runtime = "nodejs";
export const maxDuration = 60;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// The reports page's period as a CSV (one row per ticket made in it) or a PDF (the totals and tables). Design leads only.
export async function GET(req: NextRequest) {
  try {
    const u = await assertLead();
    const sp = req.nextUrl.searchParams;
    const to = DAY.test(sp.get("to") ?? "") ? sp.get("to")! : istDate();
    const from = DAY.test(sp.get("from") ?? "") ? sp.get("from")! : addDays(to, -29);
    if (to < from) return new NextResponse("The end date is before the start date.", { status: 400 });
    if (daysBetween(from, to) > 366) return new NextResponse("A report can cover at most 366 days.", { status: 400 });
    const name = `designdesk-${from}-to-${to}`;
    if (sp.get("format") === "pdf") {
      const pdf = await renderReportPdf(await report(from, to), u.name);
      return new NextResponse(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${name}.pdf"`, "cache-control": "no-store" } });
    }
    const rows = await reportRows(from, to);
    const cols = rows.length ? Object.keys(rows[0]) : ["Ticket"];
    const csv = toCsv([cols, ...rows.map((r) => cols.map((c) => (r as Record<string, unknown>)[c]))]);
    return new NextResponse(`﻿${csv}`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof HttpError) return new NextResponse(e.message, { status: e.status });
    return new NextResponse("Error", { status: 500 });
  }
}
