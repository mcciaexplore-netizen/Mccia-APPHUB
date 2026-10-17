import { STATUS_LABEL } from "@/lib/approvals/calc";
import type { AprRequestStatus } from "@/db/approvals-schema";

const TONE: Record<AprRequestStatus, string> = {
  draft: "badge-neutral", pending: "badge-amber", approved: "badge-green", rejected: "badge-red", withdrawn: "badge-neutral", returned: "badge-amber",
};

/** Pending and Returned are amber, Approved green, Rejected red. */
export function StatusBadge({ status }: { status: AprRequestStatus }) {
  return <span className={`badge ${TONE[status]}`}>{STATUS_LABEL[status]}</span>;
}

/** A red outline badge, shown on a request that is over budget (or has no budget) in every list and on its page. */
export function OverBudgetBadge() {
  return <span className="badge badge-over" title="The amount is more than the budget left (the budget allocated minus the budget used, as the requester typed them)">Over budget</span>;
}
