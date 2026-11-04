import Link from "next/link";
import { ChevronLeft, ChevronRight, LayoutGrid, List, Search } from "lucide-react";
import { RequestTable } from "@/components/aistudio/admin/RequestTable";
import { Card, Empty, PageHeader, PriorityBadge, StatusBadge, TypeBadge, formatDay } from "@/components/aistudio/ui";
import { PRIORITIES, PRIORITY_LABEL, REQUEST_TYPES, STATUS_LABEL, TYPE_LABEL } from "@/lib/aistudio/aistudio.manifest";
import { requireTeam } from "@/lib/aistudio/dal";
import { listTeam } from "@/lib/aistudio/host-adapter";
import { LIST_TABS, PAGE_SIZE, listHref, readListQuery, type ListTab } from "@/lib/aistudio/list-query";
import { cardGroups, istToday, listPage, type RequestCard } from "@/lib/aistudio/queries";

export const metadata = { title: "All Requests · AI Studio Admin" };

function CardItem({ r }: { r: RequestCard }) {
  return (
    <li>
      <Link href={`/aistudio/admin/requests/${r.id}`} className="ai-card ai-card-hover flex h-full flex-col gap-2 p-4">
        <span className="text-sm font-bold text-[var(--ai-navy)]">{r.number}</span>
        <span className="line-clamp-2 font-semibold text-ink">{r.title}</span>
        <span>
          <TypeBadge type={r.requestType} />
        </span>
        <span className="text-xs ai-muted">From {r.requesterName ?? "–"}</span>
        <span className="text-xs ai-muted">Assigned to {r.assigneeName ?? "nobody yet"}</span>
        <span className="mt-auto flex flex-wrap items-center gap-2 pt-1 text-xs">
          <span className="ai-muted">Due: {r.deadline ? formatDay(r.deadline) : "–"}</span>
          <PriorityBadge priority={r.priority} />
          <StatusBadge status={r.status} />
        </span>
      </Link>
    </li>
  );
}

/**
 * Every request, as cards grouped by status or as a sortable list (25 to a page), with status tabs, search (number, title, requester) and
 * filters (type, priority, assignee). Everything is in the address, so a view can be shared as a link.
 */
export default async function AllRequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireTeam();
  const query = readListQuery(await searchParams);
  const team = await listTeam();
  const tabs = Object.keys(LIST_TABS) as ListTab[];
  const filtered = !!(query.q || query.type || query.priority || query.assignee);
  const list = query.view === "list" ? await listPage(query) : null;
  const cards = query.view === "cards" ? await cardGroups(query) : null;
  const counts = (list ?? cards)!.counts;
  const total = list?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const first = total ? (query.page - 1) * PAGE_SIZE + 1 : 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="All Requests"
        subtitle="Every request to AI Studio. Click one to open it."
        actions={
          <div className="ai-tabs" role="tablist" aria-label="View">
            <Link href={listHref(query, { view: "cards", page: 1 })} role="tab" aria-selected={query.view === "cards"} className="ai-tab inline-flex items-center gap-1.5">
              <LayoutGrid size={14} aria-hidden /> Cards
            </Link>
            <Link href={listHref(query, { view: "list", page: 1 })} role="tab" aria-selected={query.view === "list"} className="ai-tab inline-flex items-center gap-1.5">
              <List size={14} aria-hidden /> List
            </Link>
          </div>
        }
      />

      <div className="ai-tabs self-start overflow-x-auto" role="tablist" aria-label="Show requests">
        {tabs.map((t) => (
          <Link key={t} href={listHref(query, { tab: t, page: 1 })} role="tab" aria-selected={query.tab === t} className="ai-tab whitespace-nowrap">
            {LIST_TABS[t].label} <span className="opacity-70 tabular-nums">{counts[t]}</span>
          </Link>
        ))}
      </div>

      <form method="get" action="/aistudio/admin/requests" className="ai-card flex flex-wrap items-end gap-3 px-4 py-3" role="search">
        {query.view === "list" && <input type="hidden" name="view" value="list" />}
        {query.tab !== "all" && <input type="hidden" name="filter" value={query.tab} />}
        {(query.sort !== "submitted" || query.dir !== "desc") && (
          <>
            <input type="hidden" name="sort" value={query.sort} />
            <input type="hidden" name="dir" value={query.dir} />
          </>
        )}
        <label className="relative min-w-[14rem] flex-1">
          <span className="sr-only">Search by number, title or requester</span>
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
          <input className="input pl-9" name="q" defaultValue={query.q} placeholder="Number, title or requester" />
        </label>
        <label className="ai-label flex flex-col gap-1">
          Type
          <select className="input" name="type" defaultValue={query.type}>
            <option value="">Any</option>
            {REQUEST_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="ai-label flex flex-col gap-1">
          Priority
          <select className="input" name="priority" defaultValue={query.priority}>
            <option value="">Any</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="ai-label flex flex-col gap-1">
          Assigned to
          <select className="input" name="assignee" defaultValue={query.assignee}>
            <option value="">Anyone</option>
            <option value="unassigned">Not assigned</option>
            {team.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-sm ai-btn-navy">Apply</button>
        {filtered && (
          <Link href={listHref({ ...query, q: "", type: "", priority: "", assignee: "" }, { page: 1 })} className="btn btn-ghost btn-sm">
            Clear
          </Link>
        )}
      </form>

      {cards &&
        (cards.groups.length === 0 ? (
          <Card>
            <Empty title="No requests here">{filtered ? "Try another search or fewer filters." : "Nothing is in this group right now."}</Empty>
          </Card>
        ) : (
          cards.groups.map((g) => (
            <section key={g.status} aria-labelledby={`grp-${g.status}`} className="flex flex-col gap-3">
              <h2 id={`grp-${g.status}`} className="flex items-center gap-2 text-base font-bold text-ink">
                {STATUS_LABEL[g.status]} <span className="rounded-full bg-[var(--ai-grey-tint)] px-2 py-0.5 text-xs font-bold text-[var(--ai-grey)]">{g.cards.length}</span>
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {g.cards.map((r) => (
                  <CardItem key={r.id} r={r} />
                ))}
              </ul>
            </section>
          ))
        ))}

      {list && (
        <Card pad={false}>
          {list.rows.length === 0 ? <Empty title="No requests here">{filtered ? "Try another search or fewer filters." : "Nothing is in this group right now."}</Empty> : <RequestTable rows={list.rows} query={query} today={istToday()} />}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ai-line)] px-5 py-3 text-sm">
            <span className="ai-muted">{total ? `Showing ${first}–${first + list.rows.length - 1} of ${total} request${total === 1 ? "" : "s"}` : "0 requests"}</span>
            <span className="flex items-center gap-2">
              {query.page > 1 ? (
                <Link href={listHref(query, { page: query.page - 1 })} className="btn btn-ghost btn-sm">
                  <ChevronLeft size={14} /> Previous
                </Link>
              ) : (
                <span className="btn btn-ghost btn-sm pointer-events-none opacity-40" aria-disabled>
                  <ChevronLeft size={14} /> Previous
                </span>
              )}
              <span className="tabular-nums ai-muted">
                Page {Math.min(query.page, pages)} of {pages}
              </span>
              {query.page < pages ? (
                <Link href={listHref(query, { page: query.page + 1 })} className="btn btn-ghost btn-sm">
                  Next <ChevronRight size={14} />
                </Link>
              ) : (
                <span className="btn btn-ghost btn-sm pointer-events-none opacity-40" aria-disabled>
                  Next <ChevronRight size={14} />
                </span>
              )}
            </span>
          </div>
        </Card>
      )}
    </div>
  );
}
