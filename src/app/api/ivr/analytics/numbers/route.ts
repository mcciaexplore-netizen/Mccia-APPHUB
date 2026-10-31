import { NextResponse, type NextRequest } from "next/server";
import { isUuid, numberStats, type Direction } from "@/lib/ivr/analytics";
import { HttpError, assertAdmin } from "@/lib/ivr/dal";
import { resolveRange } from "@/lib/ivr/time";

const q = (s: string | number | null) => {
  const v = s === null ? "" : String(s);
  // Stop spreadsheet apps treating a cell as a formula
  const safe = /^[=+\-@]/.test(v) && !/^\+?\d[\d\s-]*$/.test(v) ? `'${v}` : v;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

// Answer rate per phone number, for the range and filters on the analytics page. Admins only.
export async function GET(req: NextRequest) {
  try {
    await assertAdmin();
    const sp = req.nextUrl.searchParams;
    const range = resolveRange({ range: sp.get("range") ?? undefined, from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined });
    const scope = sp.get("scope");
    const category = sp.get("category");
    const dir = sp.get("direction");
    const direction: Direction | undefined = dir === "inbound" || dir === "outbound" ? dir : undefined;
    const { rows, truncated } = await numberStats(
      {
        from: range.from,
        to: range.to,
        userIds: isUuid(scope) ? [scope] : undefined,
        categoryId: isUuid(category) ? category : undefined,
        direction,
      },
      { limit: 20000, neverAnswered: sp.get("never") === "1" },
    );
    const header = ["Number", "Member", "Calls", "Outbound", "Inbound", "Answered", "Answer rate %", "Avg talk (sec)", "Best hour (IST)", "Last call (IST)"];
    const lines = [
      header.join(","),
      ...rows.map((r) =>
        [r.number, r.member, r.attempts, r.outbound, r.inbound, r.answered, r.rate, r.avgTalkSec, r.bestHour === null ? "" : `${String(r.bestHour).padStart(2, "0")}:00`, r.lastAt]
          .map(q)
          .join(","),
      ),
    ];
    if (truncated) lines.push(q("Only the first 20,000 numbers are included."));
    return new NextResponse(lines.join("\r\n") + "\r\n", {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="answer-rate-by-number-${range.fromStr}-to-${range.toStr}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof HttpError) return new NextResponse(e.message, { status: e.status });
    return new NextResponse("Error", { status: 500 });
  }
}
