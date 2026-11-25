import { ClipboardList } from "lucide-react";
import { Card, PageHeader } from "@/components/attendance/ui";
import { RequestList } from "@/components/attendance/requests/RequestForms";
import { RegularizationView } from "@/components/attendance/requests/Regularization";
import { requireMember } from "@/lib/attendance/dal";
import { myRegularizations, pastDayCards, planCards } from "@/lib/attendance/requests";
import { getSettings } from "@/lib/attendance/config";
import { approverName } from "@/lib/attendance/people";
import { PLAN_AHEAD_DAYS } from "@/lib/attendance/regularization";
import { formatDayShort } from "@/lib/attendance/time";

export const metadata = { title: "Regularization · Attendance" };

export default async function RegularizationPage() {
  const user = await requireMember();
  const [past, plans, rows, approver, settings] = await Promise.all([pastDayCards(user.id), planCards(user.id), myRegularizations(user.id), approverName(user.id), getSettings()]);
  return (
    <>
      <PageHeader title="Regularization" subtitle="Correct a check-in or check-out you genuinely missed, or plan your hours for a working day ahead." />
      <div className="flex flex-col gap-5">
        <RegularizationView past={past} plans={plans} approver={approver} windowDays={settings.regularizationWindowDays} aheadDays={PLAN_AHEAD_DAYS} />
        <Card title="My requests" icon={ClipboardList} iconTone="grey" pad={false}>
          <RequestList
            kind="regularization"
            rows={rows.map((r) => ({
              id: r.id,
              when: formatDayShort(r.date),
              detail: r.isFuture
                ? [`Planned ${r.plannedCheckin?.slice(0, 5)} – ${r.plannedCheckout?.slice(0, 5)}`, r.reason].filter(Boolean).join(" · ")
                : [r.requestedCheckin ? `In ${r.requestedCheckin.slice(0, 5)}` : null, r.requestedCheckout ? `Out ${r.requestedCheckout.slice(0, 5)}` : null, r.reason].filter(Boolean).join(" · "),
              status: r.status,
              remark: r.approverRemark,
            }))}
          />
        </Card>
      </div>
    </>
  );
}
