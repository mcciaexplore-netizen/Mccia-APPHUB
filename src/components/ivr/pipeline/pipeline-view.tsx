import { cx as clsx } from "@/lib/ivr/cx";
import { LeadFilters } from "@/components/ivr/leads/filters";
import { LeadPanel } from "@/components/ivr/leads/lead-panel";
import { KanbanBoard, type BoardData, type CardDTO } from "@/components/ivr/pipeline/kanban-board";
import { PageHeader } from "@/components/ivr/ui";
import { listCategories } from "@/lib/ivr/categories";
import type { SessionUser } from "@/lib/ivr/dal";
import { parseLeadQuery, qs } from "@/lib/ivr/lead-params";
import { listAgentUsers, listLeads, type LeadRow } from "@/lib/ivr/leads";
import { OUTCOMES } from "@/lib/ivr/outcome";
import { formatPhone } from "@/lib/ivr/phone";
import { STAGE_ORDER } from "@/lib/ivr/stage";

type Sp = Record<string, string | string[] | undefined>;

const card = (r: LeadRow): CardDTO => ({
  id: r.id,
  name: r.name,
  phone: formatPhone(r.phone),
  company: r.company,
  category: r.categoryLabel,
  attempts: r.attempts,
  lastOutcome: r.lastOutcome ? OUTCOMES[r.lastOutcome].label : null,
  ownerName: r.ownerName,
});

/**
 * Members by stage. `team`: every member, with an owner filter (IVR-CRM Admin → Pipeline); otherwise only the person's own members
 * (IVR-CRM → Pipeline). `base` is the page's own address.
 */
export async function PipelineView({ user, sp, base, team }: { user: SessionUser; sp: Sp; base: string; team: boolean }) {
  const admin = team;
  const q = parseLeadQuery(sp);
  const ownerId = team ? q.owner : user.id;

  const [lists, agents, categories] = await Promise.all([
    Promise.all(STAGE_ORDER.map((stage) => listLeads({ stage, q: q.q, ownerId, categoryId: q.cat, pageSize: 100 }))),
    admin ? listAgentUsers() : Promise.resolve([]),
    listCategories({ activeOnly: true }),
  ]);
  const board = Object.fromEntries(
    STAGE_ORDER.map((st, i) => [st, { cards: lists[i].rows.map((r) => card(r)), total: lists[i].total }]),
  ) as BoardData;

  return (
    <div className="grid gap-5">
      <PageHeader title="Pipeline" subtitle={`Where ${team ? "every" : "each of your"} member${team ? "" : "s"} stand${team ? "s" : ""}. Stages follow the calls: a call moves a member along by itself.`} />
      <LeadFilters showWhen={false} owners={admin ? agents : undefined} categories={categories.map((c) => ({ id: c.id, label: c.label }))} />
      <div className={clsx("grid items-start gap-5", q.lead && "xl:grid-cols-2")}>
        <div className="min-w-0">
          <KanbanBoard initial={board} showOwner={admin} />
        </div>
        {q.lead && <LeadPanel leadId={q.lead} viewer={user} closeHref={`${base}${qs(sp, { lead: null })}`} />}
      </div>
    </div>
  );
}
