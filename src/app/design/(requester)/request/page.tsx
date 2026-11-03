import { requireRequester } from "@/lib/design/dal";
import { listTypes } from "@/lib/design/config";
import { RETIRED_TYPE_KEYS } from "@/lib/design/form";
import { listDepartmentNames } from "@/lib/design/host-adapter";
import { addDays, istDate } from "@/lib/design/rules";
import { PageHeader } from "@/components/design/ui";
import { RequestForm } from "@/components/design/request/request-form";

/** Request a design: open to every signed-in hub user. The request lands in Pending Review for a design lead. */
export default async function RequestPage() {
  const user = await requireRequester();
  const [types, departments] = await Promise.all([listTypes(), listDepartmentNames()]);
  return (
    <div className="ds-request-page mx-auto max-w-[860px]">
      <PageHeader title="Request a Design" subtitle="Fill in the details and our design team will get back to you." />
      <RequestForm
        types={types.filter((t) => !RETIRED_TYPE_KEYS.includes(t.key)).map((t) => ({ key: t.key, name: t.name, questions: t.questions }))}
        departments={departments}
        defaultDepartment={user.department ?? ""}
        minDelivery={addDays(istDate(), 1)}
        today={istDate()}
      />
    </div>
  );
}
