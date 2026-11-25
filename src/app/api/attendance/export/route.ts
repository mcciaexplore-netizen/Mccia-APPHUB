import { NextResponse, type NextRequest } from "next/server";
import { toCsv } from "@/lib/csv";
import { HttpError, assertAdmin, assertMember } from "@/lib/attendance/dal";
import { dailyReport, leaveBalanceRows, leaveHistoryRows, monthRows, monthlyReport, personMonthRows, reportFileName, timeByProjectRows } from "@/lib/attendance/reports";
import { dailyFileName, dailyRows } from "@/lib/attendance/daily";
import { listMembers, logError } from "@/lib/attendance/host-adapter";
import { isUuid } from "@/lib/attendance/att.manifest";
import { daysBetween, isDay, isMonth, istDay, monthRange } from "@/lib/attendance/time";

// Never run at build time: every request reads the database (and who is asking).
export const dynamic = "force-dynamic";

// The CSV downloads. ?report=
//   mine     &month=YYYY-MM          anyone in Attendance: their own month, day by day
//   person   &user=&from=&to=        HR: one person's days
//   daily    &date=YYYY-MM-DD        HR: everyone who checked in that day
//   monthly  &month=YYYY-MM          HR: the monthly attendance report
//   balance  &year=YYYY              HR: leave balances
//   history  &from=&to=              HR: leave history
//   time     &from=&to=              HR: time by project
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const report = q.get("report") ?? "";
  try {
    let rows: unknown[][];
    let name: string;
    const range = () => {
      const from = q.get("from") ?? "";
      const to = q.get("to") ?? "";
      if (!isDay(from) || !isDay(to) || to < from || daysBetween(from, to) > 400) throw new HttpError(400, "Choose a valid date range (at most about a year).");
      return { from, to };
    };
    if (report === "mine") {
      const u = await assertMember();
      const month = isMonth(q.get("month")) ? q.get("month")! : istDay().slice(0, 7);
      const { from, to } = monthRange(month);
      rows = await personMonthRows(u.id, from, to);
      name = reportFileName("my-days", month);
    } else {
      await assertAdmin();
      if (report === "person") {
        const user = q.get("user");
        if (!isUuid(user) || !(await listMembers()).some((m) => m.id === user)) throw new HttpError(400, "Choose a person.");
        const { from, to } = range();
        rows = await personMonthRows(user, from, to);
        name = reportFileName("person", from, to);
      } else if (report === "daily") {
        const date = q.get("date");
        if (!isDay(date) || date > istDay()) throw new HttpError(400, "Choose a day (today or earlier).");
        rows = dailyRows(await dailyReport(date));
        name = dailyFileName(date);
      } else if (report === "monthly") {
        const month = q.get("month");
        if (!isMonth(month)) throw new HttpError(400, "Choose a month.");
        rows = monthRows(await monthlyReport(month));
        name = reportFileName("monthly", month);
      } else if (report === "balance") {
        const year = Number(q.get("year"));
        if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new HttpError(400, "Choose a year.");
        rows = await leaveBalanceRows(year);
        name = reportFileName("leave-balances", String(year));
      } else if (report === "history") {
        const { from, to } = range();
        rows = await leaveHistoryRows(from, to);
        name = reportFileName("leave-history", from, to);
      } else if (report === "time") {
        const { from, to } = range();
        rows = await timeByProjectRows(from, to);
        name = reportFileName("time-by-project", from, to);
      } else throw new HttpError(404, "No such report.");
    }
    // A byte-order mark so Excel reads the names' accents correctly.
    return new NextResponse(`﻿${toCsv(rows)}`, {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "private, no-store" },
    });
  } catch (e) {
    if (e instanceof HttpError) return new NextResponse(e.message, { status: e.status });
    logError("[attendance] export failed", e);
    return new NextResponse("Error", { status: 500 });
  }
}
