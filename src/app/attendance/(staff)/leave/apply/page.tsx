import Link from "next/link";
import { ApplyLeaveForm } from "@/components/attendance/leave/ApplyLeaveForm";
import { PageHeader } from "@/components/attendance/ui";
import { requireMember } from "@/lib/attendance/dal";
import { approverIdFor, balancesFor } from "@/lib/attendance/leave";
import { peopleByIds } from "@/lib/attendance/host-adapter";
import { istDay } from "@/lib/attendance/time";

export const metadata = { title: "Apply leave · Attendance" };

export default async function ApplyLeavePage() {
  const user = await requireMember();
  const today = istDay();
  const [balances, approverId] = await Promise.all([balancesFor(user.id, Number(today.slice(0, 4))), approverIdFor(user.id)]);
  const approver = approverId ? ((await peopleByIds([approverId])).get(approverId)?.name ?? "your manager") : "HR";
  return (
    <>
      <PageHeader title="Apply leave" subtitle="Balances are for this year." actions={<Link href="/attendance/leave" className="btn btn-ghost">Back to Leave</Link>} />
      <ApplyLeaveForm
        today={today}
        approver={approverId ? `${approver} (your manager)` : "HR (you have no reporting manager set)"}
        types={balances.map((b) => ({
          id: b.type.id,
          name: b.type.name,
          color: b.type.color,
          balance: b.balance,
          allowHalfDay: b.type.allowHalfDay,
          halfDayFirst: b.type.halfDayFirst,
          halfDaySecond: b.type.halfDaySecond,
          requiresReason: b.type.requiresReason,
          requiresDocumentAfterDays: b.type.requiresDocumentAfterDays,
          noticePeriodDays: b.type.noticePeriodDays,
          maxConsecutiveDays: b.type.maxConsecutiveDays,
          isCompoff: b.type.isCompoff,
        }))}
      />
    </>
  );
}
