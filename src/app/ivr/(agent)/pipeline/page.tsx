import { PipelineView } from "@/components/ivr/pipeline/pipeline-view";
import { requireUser } from "@/lib/ivr/dal";

export const metadata = { title: "Pipeline" };

/** The signed-in agent's own members by stage. */
export default async function PipelinePage({ searchParams }: PageProps<"/ivr/pipeline">) {
  const user = await requireUser();
  return <PipelineView user={user} sp={await searchParams} base="/ivr/pipeline" team={false} />;
}
