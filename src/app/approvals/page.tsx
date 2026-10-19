import { ApprovalFormCards } from "@/components/ApprovalFormCards";
import { BackLink } from "@/components/BackLink";
import { requirePage } from "@/lib/approvals/guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approval Forms · MCCIA App Hub" };

/** "Approval Forms", the first line of the Approval System sidebar: the forms to raise a request, for everyone. */
export default async function Page() {
  await requirePage();
  return (
    <div className="page-enter">
      <BackLink href="/" label="Home" />
      <h1 className="mt-1 text-2xl text-ink sm:text-3xl">Approval Forms</h1>
      <p className="mt-1 text-sm text-subtle">Raise a request with one of the forms below.</p>
      <div className="mt-8"><ApprovalFormCards /></div>
    </div>
  );
}
