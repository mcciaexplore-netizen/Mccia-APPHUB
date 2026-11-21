import { CalendarCheck, Clock, History, Wallet } from "lucide-react";
import { Card, PageHeader } from "@/components/attendance/ui";
import { requireAdmin } from "@/lib/attendance/dal";
import { addDays, istDay } from "@/lib/attendance/time";

export const metadata = { title: "Reports · Attendance Admin" };

/** The four CSV reports. Each form downloads a file. */
export default async function AdminReportsPage() {
  await requireAdmin();
  const today = istDay();
  const month = today.slice(0, 7);
  const year = today.slice(0, 4);
  const box = "grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end";
  const lbl = "flex flex-col gap-1 text-xs font-semibold att-muted";
  return (
    <>
      <PageHeader title="Reports" subtitle="Download as CSV (opens in Excel or Google Sheets). Days after today are not counted." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Monthly attendance" icon={CalendarCheck} iconTone="green">
          <p className="mb-3 text-sm att-muted">Per person: working days, present, absent, late, early out, leave, WFH, extra-work days and hours.</p>
          <form action="/api/attendance/export" method="get" className={box}>
            <input type="hidden" name="report" value="monthly" />
            <label className={lbl}>
              Month
              <input type="month" name="month" defaultValue={month} className="input" required />
            </label>
            <span />
            <button type="submit" className="btn btn-primary">Download</button>
          </form>
        </Card>
        <Card title="Leave balances" icon={Wallet} iconTone="blue">
          <p className="mb-3 text-sm att-muted">Per person and type: entitled, carried, adjusted, booked, pending and balance.</p>
          <form action="/api/attendance/export" method="get" className={box}>
            <input type="hidden" name="report" value="balance" />
            <label className={lbl}>
              Year
              <input type="number" name="year" min={2020} max={2100} defaultValue={year} className="input" required />
            </label>
            <span />
            <button type="submit" className="btn btn-primary">Download</button>
          </form>
        </Card>
        <Card title="Leave history" icon={History} iconTone="purple">
          <p className="mb-3 text-sm att-muted">Every leave request in the range, with status, reason and decision.</p>
          <form action="/api/attendance/export" method="get" className={box}>
            <input type="hidden" name="report" value="history" />
            <label className={lbl}>
              From
              <input type="date" name="from" defaultValue={`${year}-01-01`} className="input" required />
            </label>
            <label className={lbl}>
              To
              <input type="date" name="to" defaultValue={today} className="input" required />
            </label>
            <button type="submit" className="btn btn-primary">Download</button>
          </form>
        </Card>
        <Card title="Time by project" icon={Clock} iconTone="orange">
          <p className="mb-3 text-sm att-muted">Hours logged per project and person in the range.</p>
          <form action="/api/attendance/export" method="get" className={box}>
            <input type="hidden" name="report" value="time" />
            <label className={lbl}>
              From
              <input type="date" name="from" defaultValue={addDays(today, -30)} className="input" required />
            </label>
            <label className={lbl}>
              To
              <input type="date" name="to" defaultValue={today} className="input" required />
            </label>
            <button type="submit" className="btn btn-primary">Download</button>
          </form>
        </Card>
      </div>
    </>
  );
}
