import Link from "next/link";
import { Plus } from "lucide-react";
import { Suspense } from "react";
import { MyRequestsList } from "@/components/approvals/MyApprovalsViews";
import { PageHeader } from "@/components/approvals/PageHeader";
import { TableSkeleton } from "@/components/approvals/Skeletons";
import { requirePage } from "@/lib/approvals/guard";
import { parseListParams } from "@/lib/approvals/list-params";
import { idSchema } from "@/lib/approvals/validation";

export const metadata = { title: "My Pending Approvals · MCCIA Approvals" };

/** This person's own open requests (pending or returned for correction), HR and Expenditure together, newest first. Open to everyone signed in; the forms send people here. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage();
  const sp = await searchParams;
  const { page } = parseListParams(sp);
  const submitted = typeof sp.submitted === "string" && idSchema.safeParse(sp.submitted).success ? sp.submitted : undefined;
  return (
    <div className="page-enter">
      <PageHeader
        title="My Pending Approvals" intro="Your requests still waiting for a decision, or returned to you for correction, the most recent first."
        actions={<Link href="/approvals" className="btn btn-primary btn-sm"><Plus size={14} /> New request</Link>}
      />
      <Suspense fallback={<TableSkeleton />}>
        <MyRequestsList user={user} page={page} path="/approvals/my-requests" submitted={submitted} />
      </Suspense>
    </div>
  );
}
