import Link from "next/link";
import { cx as clsx } from "@/lib/ivr/cx";
import { LeadFilters } from "@/components/ivr/leads/filters";
import { LeadPanel } from "@/components/ivr/leads/lead-panel";
import { LeadsTable } from "@/components/ivr/leads/leads-table";
import { Pagination } from "@/components/ivr/leads/pagination";
import { PageHeader } from "@/components/ivr/ui";
import { requireAdmin } from "@/lib/ivr/dal";
import { toRowDTO } from "@/lib/ivr/lead-dto";
import { parseLeadQuery, qs } from "@/lib/ivr/lead-params";
import { listAgentWorkload, listLeads } from "@/lib/ivr/leads";
import { STAGES, STAGE_ORDER, type StageKey } from "@/lib/ivr/stage";
import { listCategories } from "@/lib/ivr/categories";
import { getStageCounts } from "@/lib/ivr/stats";
import { db } from "@/lib/ivr/db";
import { leads } from "@/db/ivr-schema";
import { count, isNull } from "drizzle-orm";

export const metadata = { title: "Members and assignment" };

const PAGE_SIZE = 50;
const TABS: (StageKey | "all")[] = ["all", ...STAGE_ORDER];

export default async function AdminLeadsPage({ searchParams }: PageProps<"/ivr/admin/members">) {
  const user = await requireAdmin();
  const sp = await searchParams;
  const q = parseLeadQuery(sp);
  const [list, workload, counts, unassigned, categories] = await Promise.all([
    listLeads({ stage: q.stage, categoryId: q.cat, q: q.q, ownerId: q.owner, unassigned: q.unassigned, from: q.from, to: q.to, page: q.page, pageSize: PAGE_SIZE }),
    listAgentWorkload(),
    getStageCounts(q.owner),
    db.select({ n: count() }).from(leads).where(isNull(leads.ownerId)),
    listCategories({ activeOnly: true }),
  ]);
  const total = counts.new + counts.attempted + counts.connected + counts.closed;
  const active = q.stage ?? "all";

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Members and assignment"
        subtitle="Tick members, then assign or reassign them to one agent or several. Reassigning keeps the history."
        actions={
          <Link className="btn btn-primary" href="/ivr/admin/import">
            Import from Excel or CSV
          </Link>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <Link
            key={t}
            href={`/ivr/admin/members${qs(sp, { stage: t === "all" ? "all" : t, lead: null })}`}
            className={clsx(
              "ivr-chip rounded-full! px-3.5 py-1.5 text-[0.8rem]!",
              active === t && "ivr-chip-on",
            )}
          >
            {t === "all" ? "All" : STAGES[t].label}{" "}
            <span className="tabular-nums opacity-80">{t === "all" ? total : counts[t]}</span>
          </Link>
        ))}
        <Link
          href={`/ivr/admin/members${qs(sp, { unassigned: q.unassigned ? null : "1", owner: null, lead: null })}`}
          className={clsx(
            "ivr-chip rounded-full! px-3.5 py-1.5 text-[0.8rem]!",
            q.unassigned ? "border-brand-purple! bg-[color-mix(in_srgb,var(--ivr-incoming)_10%,transparent)]! font-semibold text-brand-purple!" : "text-brand-purple!",
          )}
        >
          Unassigned <span className="tabular-nums">{unassigned[0].n}</span>
        </Link>
      </div>

      <div className={clsx("grid items-start gap-5", q.lead && "lg:grid-cols-2")}>
        <section className="ivr-card min-w-0 overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <LeadFilters owners={workload.map((w) => ({ id: w.id, name: w.name }))} categories={categories.map((c) => ({ id: c.id, label: c.label }))} />
          </div>
          <LeadsTable
            rows={list.rows.map((r) => toRowDTO(r))}
            selectedId={q.lead}
            selectable
            showOwner
            agents={workload}
            emptyHint="No members match. Import a file or change the filters."
          />
          <Pagination total={list.total} page={q.page} pageSize={PAGE_SIZE} />
        </section>
        {q.lead && <LeadPanel leadId={q.lead} viewer={user} closeHref={`/ivr/admin/members${qs(sp, { lead: null })}`} />}
      </div>
    </div>
  );
}
