import Link from "next/link";
import { ApprovalFormCards } from "@/components/ApprovalFormCards";
import { requirePage } from "@/lib/approvals/guard";
import { hasAnyRole } from "@/lib/approvals/host-adapter";
import { waitingCount } from "@/lib/approvals/request-queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approval System · MCCIA App Hub" };

/**
 * The Approval System's own page, reached from the hub's sidebar: the two forms for raising a request, as cards, for everyone who signs in.
 * An approver with something waiting for them is told so here, with a link to where it is.
 */
export default async function Page() {
  const user = await requirePage();
  const waiting = await waitingCount(user);
  const queue = hasAnyRole(user, ["dg"]) ? "/approvals/inbox" : "/approvals/my/pending";
  return (
    <>
      <h1 className="text-2xl text-ink sm:text-3xl">Approval System</h1>
      <p className="mt-1 text-sm text-subtle">Raise a request with one of the forms below.</p>
      {waiting > 0 && (
        <p className="apr-notice mt-4" role="status">
          {waiting} {waiting === 1 ? "request is" : "requests are"} waiting for your decision. <Link href={queue} className="apr-link">Open {queue === "/approvals/inbox" ? "the Recommended Queue" : "Pending Approvals"}</Link>
        </p>
      )}
      <div className="mt-8"><ApprovalFormCards /></div>
    </>
  );
}
