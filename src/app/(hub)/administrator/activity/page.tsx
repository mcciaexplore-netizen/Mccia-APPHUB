import { requireHeadAdmin } from "@/lib/permissions";
import { parseFilters } from "@/lib/activity";
import { ActivityView } from "@/components/ActivityView";

export const metadata = { title: "Activity log · MCCIA App Hub" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireHeadAdmin();
  const sp = await searchParams;
  return <ActivityView filters={parseFilters(sp)} basePath="/administrator/activity" isAdmin searchParams={sp} />;
}
