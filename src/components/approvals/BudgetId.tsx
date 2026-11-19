import { budgetIdView } from "@/lib/approvals/budget";
import type { AprRequestStatus } from "@/db/approvals-schema";

/**
 * A budget's ID: the permanent BUD-2627-0001 in navy and bold once approved; before that "Pending approval" (or a revision's number with
 * "(Pending)"), and "Not assigned" after a rejection, in grey italics.
 */
export function BudgetId({ requestNo, status, testId }: { requestNo: string | null; status: AprRequestStatus; testId?: string }) {
  const v = budgetIdView({ requestNo, status });
  return (
    <span data-testid={testId} data-kind={v.kind} className={v.kind === "assigned" ? "font-bold text-[#003F8A]" : "font-normal italic text-[var(--z-muted)]"}>
      {v.text}
    </span>
  );
}
