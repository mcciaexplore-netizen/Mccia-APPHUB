import { ProjectCard } from "@/components/eru/workspace/ProjectCard";
import { Empty, PageHeader } from "@/components/eru/ui";
import { requireMember } from "@/lib/eru/dal";
import { myProjects } from "@/lib/eru/queries";

export const metadata = { title: "My projects · ERU · MCCIA App Hub" };

/** The projects the person is assigned to, across every domain (open ones first). */
export default async function MyProjects() {
  const u = await requireMember();
  const projects = await myProjects(u.id);
  return (
    <div>
      <PageHeader title="My projects" subtitle="Projects you are assigned to, across every domain." />
      {projects.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard key={p.id} p={p} showDomain />
          ))}
        </div>
      ) : (
        <section className="eru-card">
          <Empty title="You are not assigned to any project yet">Projects you create, or are assigned to, show here.</Empty>
        </section>
      )}
    </div>
  );
}
