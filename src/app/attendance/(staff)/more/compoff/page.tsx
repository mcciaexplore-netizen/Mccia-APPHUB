import { ClipboardList } from "lucide-react";
import { Card, PageHeader } from "@/components/attendance/ui";
import { CompoffForm, RequestList } from "@/components/attendance/requests/RequestForms";
import { requireMember } from "@/lib/attendance/dal";
import { claimableCompoffDays, myCompoffs } from "@/lib/attendance/requests";
import { compoffSummary } from "@/lib/attendance/leave";
import { getSettings } from "@/lib/attendance/config";
import { approverName } from "@/lib/attendance/people";
import { formatDay, formatDayShort } from "@/lib/attendance/time";

export const metadata = { title: "Comp-off · Attendance" };

export default async function CompoffPage() {
  const user = await requireMember();
  const [days, rows, approver, settings, co] = await Promise.all([claimableCompoffDays(user.id), myCompoffs(user.id), approverName(user.id), getSettings(), compoffSummary(user.id)]);
  const state = new Map(co.states.map((s) => [s.id, s]));
  return (
    <>
      <PageHeader title="Comp-off" subtitle={`Balance: ${co.balance} day${co.balance === 1 ? "" : "s"}. Take it as "Comp-off" leave on the Leave page; the oldest is used first.`} />
      <div className="flex flex-col gap-5">
        <CompoffForm days={days} approver={approver} expiryDays={settings.compoffExpiryDays} />
        <Card title="My comp-offs" icon={ClipboardList} iconTone="grey" pad={false}>
          <RequestList
            kind="compoff"
            rows={rows.map((r) => {
              const s = state.get(r.id);
              const status = r.status === "approved" && s ? (s.expired ? "expired" : s.remaining <= 0 ? "used" : "approved") : r.status;
              return {
                id: r.id,
                when: formatDayShort(r.workedDate),
                detail: `${r.compoffType === "half" ? "Half" : "Full"} day${r.expiryDate ? ` · expires ${formatDay(r.expiryDate)}` : ""}${s && s.used > 0 ? ` · ${s.used} used` : ""}`,
                status,
                remark: r.approverRemark,
              };
            })}
          />
        </Card>
      </div>
    </>
  );
}
