import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { MonthGrid } from "@/components/design/calendar/month-grid";
import { PageHeader } from "@/components/design/ui";
import { requireTeam } from "@/lib/design/dal";
import { listTickets } from "@/lib/design/tickets";
import { FINISHED_STATUSES, addDays, istDate } from "@/lib/design/rules";

export const metadata = { title: "Calendar · Design Team Admin" };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Every ticket (or, with ?mine=1, the person's own) on its deadline day, a month at a time. */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string; done?: string; mine?: string }> }) {
  const u = await requireTeam();
  const sp = await searchParams;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? "") ? sp.month! : istDate().slice(0, 7);
  const showDone = sp.done === "1";
  const mine = sp.mine === "1";
  const all = await listTickets({ assigneeId: mine ? u.id : undefined, excludeStatuses: ["pending_review", "declined", "superseded"] });
  const tickets = showDone ? all : all.filter((t) => !FINISHED_STATUSES.includes(t.status));
  const prev = addDays(`${month}-01`, -1).slice(0, 7);
  const next = addDays(`${month}-01`, 32).slice(0, 7);
  const href = (m: string, done = showDone, onlyMine = mine) => `/design/admin/calendar?month=${m}${done ? "&done=1" : ""}${onlyMine ? "&mine=1" : ""}`;
  const [y, m] = month.split("-").map(Number);

  return (
    <div>
      <PageHeader title="Calendar" subtitle={mine ? "Your tickets on the day they are due." : "Every ticket on the day it is due."} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={href(prev)} className="btn btn-ghost btn-sm" aria-label="Previous month">
            <ChevronLeft size={16} />
          </Link>
          <h2 className="min-w-40 text-center text-lg font-bold text-ink">
            {MONTHS[m - 1]} {y}
          </h2>
          <Link href={href(next)} className="btn btn-ghost btn-sm" aria-label="Next month">
            <ChevronRight size={16} />
          </Link>
          <Link href={href(istDate().slice(0, 7))} className="btn btn-ghost btn-sm">
            Today
          </Link>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={href(month, showDone, !mine)} className="btn btn-ghost btn-sm" aria-pressed={mine}>
            {mine ? "Show everyone's" : "Mine only"}
          </Link>
          <Link href={href(month, !showDone)} className="btn btn-ghost btn-sm" aria-pressed={showDone}>
            {showDone ? "Hide delivered" : "Show delivered"}
          </Link>
        </div>
      </div>
      <MonthGrid month={month} tickets={tickets} />
    </div>
  );
}
