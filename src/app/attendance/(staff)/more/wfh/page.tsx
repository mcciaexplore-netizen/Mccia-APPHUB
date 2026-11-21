import { ClipboardList } from "lucide-react";
import { Card, PageHeader } from "@/components/attendance/ui";
import { RequestList, WfhForm } from "@/components/attendance/requests/RequestForms";
import { requireMember } from "@/lib/attendance/dal";
import { myWfh } from "@/lib/attendance/requests";
import { approverName } from "@/lib/attendance/people";
import { formatDayShort, istDay } from "@/lib/attendance/time";

export const metadata = { title: "Work from home · Attendance" };

export default async function WfhPage() {
  const user = await requireMember();
  const [rows, approver] = await Promise.all([myWfh(user.id), approverName(user.id)]);
  return (
    <>
      <PageHeader title="Work from home" subtitle="Ask for a day at home. Once approved you can check in from anywhere that day." />
      <div className="flex flex-col gap-5">
        <WfhForm today={istDay()} approver={approver} />
        <Card title="My requests" icon={ClipboardList} iconTone="grey" pad={false}>
          <RequestList kind="wfh" rows={rows.map((r) => ({ id: r.id, when: formatDayShort(r.date), detail: r.reason, status: r.status, remark: r.approverRemark }))} />
        </Card>
      </div>
    </>
  );
}
