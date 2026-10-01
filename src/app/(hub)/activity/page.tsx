import { Inbox } from "lucide-react";
import { requireActivityViewer } from "@/lib/permissions";
import { parseFilters } from "@/lib/activity";
import { ActivityView } from "@/components/ActivityView";

export const metadata = { title: "Activity · MCCIA App Hub" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireActivityViewer();
  const sp = await searchParams;
  const scope = user.role === "dept_lead" ? user.homeDepartmentId : undefined;
  return (
    <div>
      <h1 className="mb-8 text-3xl sm:text-4xl">Department activity</h1>
      {user.role === "dept_lead" && !scope ? (
        <div className="alert"><Inbox size={18} className="mt-0.5 shrink-0" /><span>No home department is set for your account. Contact the head admin.</span></div>
      ) : (
        <ActivityView filters={parseFilters(sp)} basePath="/activity" scopeDeptId={scope ?? undefined} isAdmin={false} searchParams={sp} />
      )}
    </div>
  );
}
