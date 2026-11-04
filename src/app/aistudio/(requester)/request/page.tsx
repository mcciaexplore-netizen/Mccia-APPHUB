import { RequestForm } from "@/components/aistudio/request/request-form";
import { PageHeader } from "@/components/aistudio/ui";
import { requireRequester } from "@/lib/aistudio/dal";
import { listDepartmentNames } from "@/lib/aistudio/host-adapter";

export const metadata = { title: "Request from AI Studio · MCCIA App Hub" };

/** Ask the AI Studio team for something: open to everyone given AI Studio. The request lands in Pending Review for a lead. */
export default async function RequestPage() {
  const user = await requireRequester();
  const departments = await listDepartmentNames();
  return (
    <div className="ai-request-page">
      <PageHeader title="Request from AI Studio" subtitle="Tell us what you need and we'll get back to you." />
      <RequestForm departments={departments} defaultDepartment={user.department ?? ""} />
    </div>
  );
}
