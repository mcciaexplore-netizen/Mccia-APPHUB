import { requireRequester } from "@/lib/design/dal";
import { allRequests } from "@/lib/design/tickets";
import { PageHeader } from "@/components/design/ui";
import { RequestsBoard } from "@/components/design/requests/requests-board";

/** Every accepted design request and where it stands, for everyone in the hub: titles, designs, status and dates (no briefs or names). */
export default async function AllRequestsPage() {
  await requireRequester();
  const rows = await allRequests();
  return (
    <div>
      <PageHeader title="All requests" subtitle="Every design request the team has accepted, grouped by department. Finished ones stay here for 90 days." />
      <RequestsBoard
        rows={rows.map((r) => ({ id: r.id, number: r.number, title: r.title, status: r.status, designs: r.designs, department: r.department, dueAt: r.dueAt, createdAt: r.createdAt, deliveredAt: r.deliveredAt }))}
      />
    </div>
  );
}
