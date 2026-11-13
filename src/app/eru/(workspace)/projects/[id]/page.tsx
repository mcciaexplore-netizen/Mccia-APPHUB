import { notFound } from "next/navigation";
import { BackLink } from "@/components/BackLink";
import { ProjectView } from "@/components/eru/project/ProjectView";
import { requireMember } from "@/lib/eru/dal";
import { listTeam } from "@/lib/eru/host-adapter";
import { activeDomains, projectDetail } from "@/lib/eru/queries";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const d = await projectDetail((await params).id);
  return { title: d ? `${d.project.number} · ERU · MCCIA App Hub` : "ERU · MCCIA App Hub" };
}

/** One project: Overview (documents, details, files, activity) and Members. */
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireMember();
  const { id } = await params;
  const [d, domains, team] = await Promise.all([projectDetail(id), activeDomains(), listTeam()]);
  if (!d) notFound();
  return (
    <div className="flex flex-col gap-3">
      <BackLink href={`/eru/domains/${d.domain.key}`} label={d.domain.name} />
      <ProjectView
        project={{
          id: d.project.id,
          number: d.project.number,
          title: d.project.title,
          description: d.project.description,
          status: d.project.status,
          priority: d.project.priority,
          dueDate: d.project.dueDate,
          tags: d.project.tags,
          referenceLinks: d.project.referenceLinks,
          createdByName: d.project.createdByName,
          createdAt: d.project.createdAt,
        }}
        domain={{ id: d.domain.id, key: d.domain.key, name: d.domain.name, color: d.domain.color }}
        domains={domains}
        assigned={d.assigned}
        documents={d.documents}
        files={d.files}
        activity={d.activity}
        team={team.map((t) => ({ id: t.id, name: t.name }))}
        me={{ id: u.id, admin: u.admin }}
      />
    </div>
  );
}
