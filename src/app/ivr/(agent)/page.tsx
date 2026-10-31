import Link from "next/link";
import { cx as clsx } from "@/lib/ivr/cx";
import { CallButton } from "@/components/ivr/call-button";
import { KpiStrip } from "@/components/ivr/kpi-strip";
import { LeadFilters } from "@/components/ivr/leads/filters";
import { LeadPanel } from "@/components/ivr/leads/lead-panel";
import { LeadsTable } from "@/components/ivr/leads/leads-table";
import { Pagination } from "@/components/ivr/leads/pagination";
import { PageHeader } from "@/components/ivr/ui";
import { listCategories } from "@/lib/ivr/categories";
import { requireUser } from "@/lib/ivr/dal";
import { toRowDTO } from "@/lib/ivr/lead-dto";
import { parseLeadQuery, qs } from "@/lib/ivr/lead-params";
import { listQueue, nextInQueue, queueCounts, type QueueFilter } from "@/lib/ivr/leads";
import { getKpis, todayRange } from "@/lib/ivr/stats";

export const metadata = { title: "Call queue" };

const PAGE_SIZE = 25;
const FILTERS: { key: QueueFilter; label: string; hint: string }[] = [
  { key: "ready", label: "Ready to call", hint: "Never called, or due for another try" },
  { key: "waiting", label: "Waiting", hint: "Tried recently; the minimum gap has not passed" },
  { key: "exhausted", label: "Out of tries", hint: "Reached the maximum number of attempts" },
  { key: "all", label: "All open", hint: "Everything not yet connected or closed" },
];

export default async function QueuePage({ searchParams }: PageProps<"/ivr">) {
  const user = await requireUser();
  const sp = await searchParams;
  const q = parseLeadQuery(sp);
  const raw = Array.isArray(sp.show) ? sp.show[0] : sp.show;
  const filter: QueueFilter = FILTERS.some((f) => f.key === raw) ? (raw as QueueFilter) : "ready";
  const day = todayRange();

  const [kpis, counts, list, nextId, categories] = await Promise.all([
    getKpis({ userId: user.id, ...day, live: false }),
    queueCounts(user.id),
    listQueue({ ownerId: user.id, filter, q: q.q, categoryId: q.cat, page: q.page, pageSize: PAGE_SIZE }),
    nextInQueue(user.id),
    listCategories({ activeOnly: true }),
  ]);
  const closeHref = `/ivr${qs(sp, { lead: null })}`;
  const active = FILTERS.find((f) => f.key === filter)!;

  return (
    <div className="grid gap-5">
      <PageHeader
        title={`Hello, ${user.name.split(" ")[0]}`}
        subtitle="Your call queue for today. Press Call and Smartflo rings your phone first, then connects the member."
        actions={nextId ? <CallButton leadId={nextId} label="Call next member" size="md" /> : undefined}
      />
      <KpiStrip initial={kpis} query={`range=today&user=${user.id}`} variant="agent" />

      <div className="ivr-stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {FILTERS.map((f) => {
          const on = filter === f.key;
          return (
            <Link
              key={f.key}
              href={`/ivr${qs(sp, { show: f.key, lead: null })}`}
              aria-current={on ? "page" : undefined}
              className={clsx("ivr-card card-lift flex items-center justify-between gap-3 border-t-4 px-6 py-4", on && "ring-1")}
              style={{
                borderTopColor: "var(--ivr-accent)",
                ...(on ? { background: "color-mix(in srgb, var(--ivr-accent) 8%, var(--ivr-surface))", ["--tw-ring-color" as string]: "var(--ivr-accent)" } : {}),
              }}
            >
              <span>
                <span className="block font-heading font-bold">{f.label}</span>
                <span className="text-[0.78rem] text-muted">{f.hint}</span>
              </span>
              <span className="ivr-stat-number">{counts[f.key]}</span>
            </Link>
          );
        })}
      </div>

      <div className={clsx("grid items-start gap-5", q.lead && "lg:grid-cols-2")}>
        <section className="ivr-card min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <LeadFilters showWhen={false} categories={categories.map((c) => ({ id: c.id, label: c.label }))} />
            <p className="text-[12px] text-muted">
              Retry rule: up to {list.rule.maxAttempts} tries, at least {list.rule.minGapHours}h apart
            </p>
          </div>
          <LeadsTable
            rows={list.rows.map((r) => toRowDTO(r))}
            selectedId={q.lead}
            emptyHint={
              filter === "ready"
                ? "Nobody is waiting for a call. Members your admin allocates to you appear here."
                : `No members in "${active.label}".`
            }
          />
          <Pagination total={list.total} page={q.page} pageSize={PAGE_SIZE} />
        </section>

        {q.lead && <LeadPanel leadId={q.lead} viewer={user} closeHref={closeHref} />}
      </div>
    </div>
  );
}
