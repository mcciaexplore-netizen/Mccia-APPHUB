import { PageHeader } from "@/components/attendance/ui";
import { OrgChart } from "@/components/attendance/OrgChart";
import { requireMember } from "@/lib/attendance/dal";
import { orgNodes } from "@/lib/attendance/people";

export const metadata = { title: "Org chart · Attendance" };

export default async function OrgChartPage() {
  const user = await requireMember();
  const nodes = await orgNodes();
  return (
    <>
      <PageHeader title="Org chart" subtitle="Who reports to whom. Drag to move, scroll or pinch to zoom. People with no manager are under HR." />
      <OrgChart nodes={nodes} me={user.id} />
    </>
  );
}
