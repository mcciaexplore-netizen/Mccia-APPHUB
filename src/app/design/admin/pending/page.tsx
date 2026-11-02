import { PendingList } from "@/components/design/admin/PendingList";
import { Card, PageHeader } from "@/components/design/ui";
import { pendingItems } from "@/lib/design/admin-queries";
import { requireLead } from "@/lib/design/dal";

/** Every request waiting for a lead, oldest first. */
export default async function PendingPage() {
  await requireLead();
  const items = await pendingItems();
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Pending review" subtitle="Accept each request (and choose who does it), decline it with a reason, or ask the requester a question." />
      <Card pad={false} title={`${items.length} waiting`}>
        <PendingList items={items} />
      </Card>
    </div>
  );
}
