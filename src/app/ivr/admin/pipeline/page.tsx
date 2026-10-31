import { PipelineView } from "@/components/ivr/pipeline/pipeline-view";
import { requireAdmin } from "@/lib/ivr/dal";

export const metadata = { title: "Pipeline" };

/** Every member by stage, team-wide, with an owner filter. */
export default async function TeamPipelinePage({ searchParams }: PageProps<"/ivr/admin/pipeline">) {
  const user = await requireAdmin();
  return <PipelineView user={user} sp={await searchParams} base="/ivr/admin/pipeline" team />;
}
