import { requireRequester } from "@/lib/design/dal";
import { listCampaigns } from "@/lib/design/campaigns";
import { istDate } from "@/lib/design/rules";
import { PageHeader } from "@/components/design/ui";
import { CampaignsView } from "@/components/design/campaigns/campaigns-view";

/** Campaigns and social posts, for everyone in the hub. Design leads manage campaigns; anyone can add posts. */
export default async function CampaignsPage() {
  const user = await requireRequester();
  const data = await listCampaigns();
  return (
    <div>
      <PageHeader title="Campaigns" subtitle="Marketing campaigns and the social posts made or planned for them." />
      <CampaignsView campaigns={data.campaigns} posts={data.posts} lead={user.lead} userId={user.id} today={istDate()} />
    </div>
  );
}
