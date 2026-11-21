import { Card, PageHeader } from "@/components/attendance/ui";
import { RegularizationForm, RequestList } from "@/components/attendance/requests/RequestForms";
import { requireMember } from "@/lib/attendance/dal";
import { myRegularizations, regularizableDays } from "@/lib/attendance/requests";
import { getSettings } from "@/lib/attendance/config";
import { approverName } from "@/lib/attendance/people";
import { formatDayShort } from "@/lib/attendance/time";

export const metadata = { title: "Regularization · Attendance" };

export default async function RegularizationPage() {
  const user = await requireMember();
  const [days, rows, approver, settings] = await Promise.all([regularizableDays(user.id), myRegularizations(user.id), approverName(user.id), getSettings()]);
  return (
    <>
      <PageHeader title="Regularization" subtitle="Correct a check-in or check-out you genuinely missed." />
      <div className="flex flex-col gap-5">
        <RegularizationForm days={days} approver={approver} windowDays={settings.regularizationWindowDays} />
        <Card title="My requests" pad={false}>
          <RequestList
            kind="regularization"
            rows={rows.map((r) => ({
              id: r.id,
              when: formatDayShort(r.date),
              detail: [r.requestedCheckin ? `In ${r.requestedCheckin.slice(0, 5)}` : null, r.requestedCheckout ? `Out ${r.requestedCheckout.slice(0, 5)}` : null, r.reason].filter(Boolean).join(" · "),
              status: r.status,
              remark: r.approverRemark,
            }))}
          />
        </Card>
      </div>
    </>
  );
}
