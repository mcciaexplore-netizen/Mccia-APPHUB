import { Announcements } from "@/components/attendance/admin/Announcements";
import { TodayBoardView } from "@/components/attendance/TodayBoardView";
import { Kpi, PageHeader } from "@/components/attendance/ui";
import { requireAdmin } from "@/lib/attendance/dal";
import { todayBoard } from "@/lib/attendance/overview";
import { teamsAndBranches } from "@/lib/attendance/host-adapter";
import { listAnnouncements } from "@/lib/attendance/admin";
import { isUuid } from "@/lib/attendance/att.manifest";
import { formatDayShort } from "@/lib/attendance/time";

export const metadata = { title: "Today · Attendance Admin" };

/** Today: who is not in yet, in office, WFH and on leave, filterable by team and branch; announcements. */
export default async function AdminTodayPage({ searchParams }: PageProps<"/attendance/admin">) {
  await requireAdmin();
  const sp = await searchParams;
  const teamId = isUuid(sp.team) ? sp.team : null;
  const branchId = isUuid(sp.branch) ? sp.branch : null;
  const [board, tb, ann] = await Promise.all([todayBoard({ teamId, branchId }), teamsAndBranches(), listAnnouncements()]);
  return (
    <>
      <PageHeader
        title="Today"
        subtitle={formatDayShort(board.day)}
        actions={
          <form className="flex flex-wrap gap-2" method="get">
            <select name="team" defaultValue={teamId ?? ""} className="input w-auto" aria-label="Team">
              <option value="">All teams</option>
              {tb.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <select name="branch" defaultValue={branchId ?? ""} className="input w-auto" aria-label="Branch">
              <option value="">All branches</option>
              {tb.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <button type="submit" className="btn btn-ghost btn-sm">
              Filter
            </button>
          </form>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Not in yet" value={board.notIn.length} tone="red" />
        <Kpi label="In office" value={board.inOffice.length} tone="green" />
        <Kpi label="WFH" value={board.wfh.length} tone="teal" />
        <Kpi label="On leave" value={board.onLeave.length} tone="blue" />
      </div>
      <TodayBoardView board={board} />
      <div className="mt-5">
        <Announcements items={ann} />
      </div>
    </>
  );
}
