import { notFound } from "next/navigation";
import { BackLink } from "@/components/BackLink";
import { ProjectCard } from "@/components/eru/workspace/ProjectCard";
import { NewProjectButton } from "@/components/eru/workspace/NewProjectButton";
import { DomainIcon, Empty, PageHeader } from "@/components/eru/ui";
import { requireMember } from "@/lib/eru/dal";
import { colorOf } from "@/lib/eru/eru.manifest";
import { listTeam } from "@/lib/eru/host-adapter";
import { activeDomains, domainByKey, domainProjects } from "@/lib/eru/queries";

/** One domain's projects, as cards, with "New Project". */
export default async function DomainPage({ params }: { params: Promise<{ key: string }> }) {
  const u = await requireMember();
  const { key } = await params;
  const d = await domainByKey(key);
  if (!d) notFound();
  const [projects, domains, team] = await Promise.all([domainProjects(d.id), activeDomains(), u.admin ? listTeam() : Promise.resolve([])]);
  const c = colorOf(d.color);
  return (
    <div>
      <BackLink href="/eru" label="All domains" />
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl" style={{ background: c.tint, color: c.text }}>
              <DomainIcon icon={d.icon} size={20} />
            </span>
            {d.name}
          </span>
        }
        subtitle={d.description}
        actions={<NewProjectButton domains={domains} domainId={d.id} team={team.map((t) => ({ id: t.id, name: t.name }))} admin={u.admin} />}
      />
      {projects.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard key={p.id} p={p} />
          ))}
        </div>
      ) : (
        <section className="eru-card">
          <Empty title="No projects in this domain yet">Start one with New Project.</Empty>
        </section>
      )}
    </div>
  );
}
