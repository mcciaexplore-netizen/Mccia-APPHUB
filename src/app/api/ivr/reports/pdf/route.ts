import { NextResponse, type NextRequest } from "next/server";
import { namesOf } from "@/lib/ivr/host-adapter";
import { isUuid } from "@/lib/ivr/analytics";
import { audit } from "@/lib/ivr/audit";
import { HttpError, assertAdmin } from "@/lib/ivr/dal";
import { REPORT_SECTIONS, buildReport, renderReportPdf, type ReportSection } from "@/lib/ivr/report";
import { addDays, istDayStart, parseIstDate, toIstDateString } from "@/lib/ivr/time";

export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_SECTIONS: ReportSection[] = ["summary", "agents", "charts", "assignments"];

export async function GET(req: NextRequest) {
  try {
    const user = await assertAdmin();
    const sp = req.nextUrl.searchParams;

    const today = istDayStart();
    const fromDay = parseIstDate(sp.get("from")) ?? addDays(today, -6);
    const toDay = parseIstDate(sp.get("to")) ?? today;
    if (toDay < fromDay) return new NextResponse("`to` must not be before `from`.", { status: 400 });
    if ((toDay.getTime() - fromDay.getTime()) / 86_400_000 > 366) {
      return new NextResponse("A report can cover at most 366 days.", { status: 400 });
    }
    const fromStr = toIstDateString(fromDay);
    const toStr = toIstDateString(toDay);

    const scopeParam = (sp.get("scope") ?? "all").trim();
    const ids = scopeParam === "all" ? [] : scopeParam.split(",").map((s) => s.trim()).filter(isUuid);
    if (scopeParam !== "all" && !ids.length) return new NextResponse("No valid agents in `scope`.", { status: 400 });
    let scopeLabel = "All agents";
    if (ids.length) {
      scopeLabel = [...(await namesOf(ids)).values()].sort().join(", ") || "Selected agents";
    }

    const requested = (sp.get("sections") ?? "").split(",").map((s) => s.trim());
    const sections = REPORT_SECTIONS.filter((s) => requested.includes(s));
    const chosen = sections.length ? sections : DEFAULT_SECTIONS;

    const data = await buildReport({
      from: fromDay,
      to: addDays(toDay, 1),
      userIds: ids.length ? ids : undefined,
      sections: chosen,
      fromLabel: fromStr,
      toLabel: toStr,
      scopeLabel,
      generatedBy: user.name,
    });
    const pdf = await renderReportPdf(data);
    await audit(user.id, "report.pdf", undefined, { from: fromStr, to: toStr, scope: ids.length ? ids : "all", sections: chosen });

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="membership-report-${fromStr}_to_${toStr}.pdf"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof HttpError) return new NextResponse(e.message, { status: e.status });
    return new NextResponse("Could not build the report.", { status: 500 });
  }
}
