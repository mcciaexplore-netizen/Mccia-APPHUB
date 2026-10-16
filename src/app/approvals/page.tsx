import Link from "next/link";
import { ApprovalFormCards } from "@/components/ApprovalFormCards";
import { REVIEW_LABEL } from "@/lib/approvals/approvals.manifest";
import { requirePage } from "@/lib/approvals/guard";
import { reviewItemsFor } from "@/lib/approvals/request-queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approval System · MCCIA App Hub" };

/**
 * The Approval System's own page, reached from the hub's sidebar: the two forms for raising a request, as cards, for everyone who signs in.
 * An approver with something waiting for them is told so here, with a link to where it is.
 */
export default async function Page() {
  const user = await requirePage();
  const waiting = (await reviewItemsFor(user)).filter((r) => r.waiting > 0);
  const total = waiting.reduce((n, r) => n + r.waiting, 0);
  return (
    <>
      <h1 className="text-2xl text-ink sm:text-3xl">Approval System</h1>
      <p className="mt-1 text-sm text-subtle">Raise a request with one of the forms below.</p>
      {total > 0 && (
        <p className="apr-notice mt-4" role="status">
          {total} {total === 1 ? "request is" : "requests are"} waiting for your decision:{" "}
          {waiting.map((r, i) => (
            <span key={r.key}>{i > 0 && ", "}<Link href={`/approvals/review/${r.key}/pending`} className="apr-link">{REVIEW_LABEL[r.key]} ({r.waiting})</Link></span>
          ))}
        </p>
      )}
      <div className="mt-8"><ApprovalFormCards /></div>
    </>
  );
}
