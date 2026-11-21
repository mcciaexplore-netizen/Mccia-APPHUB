import { Users } from "lucide-react";
import { Card, PageHeader } from "@/components/attendance/ui";
import { requireMember } from "@/lib/attendance/dal";
import { profileOf } from "@/lib/attendance/config";
import { listMembers } from "@/lib/attendance/host-adapter";
import { approverName } from "@/lib/attendance/people";
import { EMPLOYMENT_LABEL } from "@/lib/attendance/att.manifest";
import { formatDay, formatHours } from "@/lib/attendance/time";

export const metadata = { title: "Profile · Attendance" };

/** What Attendance knows about the person. HR change it in Attendance Admin → People. */
export default async function ProfilePage() {
  const user = await requireMember();
  const [p, members, approver] = await Promise.all([profileOf(user.id), listMembers(), approverName(user.id)]);
  const me = members.find((m) => m.id === user.id);
  const reports = members.filter((m) => m.managerId === user.id);
  const rows: [string, string][] = [
    ["Name", user.name],
    ["Email", user.email],
    ["Designation", me?.designation ?? "—"],
    ["Team", me?.teamName ?? "—"],
    ["Branch", me?.branchName ?? "—"],
    ["Requests go to", approver],
    ["Employment type", EMPLOYMENT_LABEL[p.employmentType]],
    ["Shift", `${p.shift.name}: ${p.shift.startTime}–${p.shift.endTime}, grace ${p.shift.graceMinutes} min, full day ${formatHours(p.shift.fullDayHours)}, half day ${formatHours(p.shift.halfDayHours)}`],
    ["Date of joining", p.dateOfJoining ? formatDay(p.dateOfJoining) : "—"],
    ["Date of birth", p.dateOfBirth ? formatDay(p.dateOfBirth) : "—"],
  ];
  return (
    <>
      <PageHeader title="Profile" subtitle="If anything here is wrong, ask HR to correct it." />
      <div className="flex flex-col gap-5">
        <Card pad={false}>
          <dl className="divide-y divide-[var(--att-line)]">
            {rows.map(([k, v]) => (
              <div key={k} className="grid gap-1 px-5 py-3 sm:grid-cols-[12rem_1fr]">
                <dt className="text-sm att-muted">{k}</dt>
                <dd className="text-sm font-semibold text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
        {reports.length > 0 && (
          <Card title={`People who report to you (${reports.length})`} icon={Users} iconTone="green">
            <ul className="flex flex-wrap gap-2">
              {reports.map((r) => (
                <li key={r.id} className="att-badge att-tone-primary">
                  {r.name}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
