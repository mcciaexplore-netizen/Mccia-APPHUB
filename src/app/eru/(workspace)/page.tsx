import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { DomainIcon, PageHeader } from "@/components/eru/ui";
import { requireMember } from "@/lib/eru/dal";
import { colorOf } from "@/lib/eru/eru.manifest";
import { domainCards } from "@/lib/eru/queries";

export const metadata = { title: "ERU Workspace · MCCIA App Hub" };

/** The workspace's home: one square tile per domain (its projects and how many are active); a card opens the domain's projects. */
export default async function EruHome() {
  await requireMember();
  const domains = await domainCards();
  return (
    <div>
      <PageHeader title="ERU Workspace" subtitle="Economic Research Unit" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        {domains.map((d) => {
          const c = colorOf(d.color);
          return (
            <Link
              key={d.id}
              href={`/eru/domains/${d.key}`}
              className="eru-card eru-card-hover eru-domain flex flex-col gap-3 p-5 sm:aspect-square"
              style={{ ["--eru-accent" as string]: c.accent }}
              data-testid={`eru-domain-${d.key}`}
            >
              <span className="flex items-start justify-between gap-2">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl" style={{ background: c.tint, color: c.text }}>
                  <DomainIcon icon={d.icon} />
                </span>
                <span className="eru-badge shrink-0" style={{ background: c.tint, color: c.text }} aria-label={`${d.projects} projects`}>
                  {d.projects} {d.projects === 1 ? "project" : "projects"}
                </span>
              </span>
              <span className="mt-1 text-[1.05rem] font-bold leading-snug text-ink">{d.name}</span>
              <span className="line-clamp-4 text-[0.85rem] eru-muted">{d.description}</span>
              <span className="mt-auto flex items-center justify-between border-t border-[var(--eru-line)] pt-3 text-xs font-semibold" style={{ color: c.text }}>
                <span>{d.active} active</span>
                <ArrowRight size={15} aria-hidden />
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
