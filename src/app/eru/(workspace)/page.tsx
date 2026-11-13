import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { DomainIcon, PageHeader } from "@/components/eru/ui";
import { requireMember } from "@/lib/eru/dal";
import { colorOf } from "@/lib/eru/eru.manifest";
import { domainCards } from "@/lib/eru/queries";

export const metadata = { title: "ERU Workspace · MCCIA App Hub" };

/** The workspace's home: one card per domain (its projects and how many are active); a card opens the domain's projects. */
export default async function EruHome() {
  await requireMember();
  const domains = await domainCards();
  return (
    <div>
      <PageHeader title="ERU Workspace" subtitle="Economic Research Unit" />
      <div className="grid gap-4 md:grid-cols-2">
        {domains.map((d) => {
          const c = colorOf(d.color);
          return (
            <Link
              key={d.id}
              href={`/eru/domains/${d.key}`}
              className="eru-card eru-card-hover eru-domain flex gap-4 p-5"
              style={{ ["--eru-accent" as string]: c.accent }}
              data-testid={`eru-domain-${d.key}`}
            >
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl" style={{ background: c.tint, color: c.text }}>
                <DomainIcon icon={d.icon} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-start justify-between gap-2">
                  <span className="text-[1.05rem] font-bold leading-snug text-ink">{d.name}</span>
                  <span className="eru-badge shrink-0" style={{ background: c.tint, color: c.text }} aria-label={`${d.projects} projects`}>
                    {d.projects} {d.projects === 1 ? "project" : "projects"}
                  </span>
                </span>
                <span className="text-[0.85rem] eru-muted">{d.description}</span>
                <span className="mt-2 flex items-center justify-between text-xs font-semibold" style={{ color: c.text }}>
                  <span>{d.active} active</span>
                  <ArrowRight size={15} aria-hidden />
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
