import Link from "next/link";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { TicketTable } from "@/components/design/tickets/TicketTable";
import { Card, Empty, PageHeader } from "@/components/design/ui";
import { ticketListPage } from "@/lib/design/admin-queries";
import { listTypes } from "@/lib/design/config";
import { requireTeam } from "@/lib/design/dal";
import { listAssignable } from "@/lib/design/host-adapter";
import { PRIORITIES, PRIORITY_LABEL } from "@/lib/design/rules";
import { LIST_TABS, PAGE_SIZE, listHref, readListQuery, type ListTab } from "@/lib/design/ticket-list";

export const metadata = { title: "All tickets · Design Admin" };

/**
 * Every ticket as a list (a lead every ticket, a designer only the ones assigned to them): status tabs with counts, search by number,
 * title or requester, filters by designer, design type, priority and the day it was asked for, sortable columns and 25 to a page. All of
 * it lives in the address (?filter=active ...), so the dashboard's number cards can link straight to a tab.
 */
export default async function AllTicketsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requireTeam();
  const query = readListQuery(await searchParams);
  const [{ rows, total, counts }, types, people] = await Promise.all([ticketListPage(u, query), listTypes(true), u.lead ? listAssignable() : Promise.resolve([])]);
  const tabs = (Object.keys(LIST_TABS) as ListTab[]).filter((t) => u.lead || t !== "pending");
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const first = total ? (query.page - 1) * PAGE_SIZE + 1 : 0;
  const filtered = !!(query.q || query.designer || query.type || query.priority || query.from || query.to);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={u.lead ? "All tickets" : "My tickets"} subtitle={u.lead ? "Every request, as a list. Click a row to open it." : "The tickets assigned to you, as a list. Click a row to open it."} />

      <div className="ds-tabs self-start overflow-x-auto" role="tablist" aria-label="Show tickets">
        {tabs.map((t) => (
          <Link key={t} href={listHref(query, { tab: t, page: 1 })} role="tab" aria-selected={query.tab === t} className="ds-tab whitespace-nowrap">
            {LIST_TABS[t].label} <span className="ds-muted tabular-nums">{counts[t]}</span>
          </Link>
        ))}
      </div>

      <form method="get" action="/design/admin/tickets" className="ds-card flex flex-wrap items-end gap-3 px-4 py-3" role="search">
        {query.tab !== "all" && <input type="hidden" name="filter" value={query.tab} />}
        {(query.sort !== "created" || query.dir !== "desc") && (
          <>
            <input type="hidden" name="sort" value={query.sort} />
            <input type="hidden" name="dir" value={query.dir} />
          </>
        )}
        <label className="relative min-w-[14rem] flex-1">
          <span className="sr-only">Search by ticket number, title or requester</span>
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
          <input className="input pl-9" name="q" defaultValue={query.q} placeholder="Ticket number, title or requester" />
        </label>
        {u.lead && (
          <label className="ds-label flex flex-col gap-1">
            Designer
            <select className="input" name="designer" defaultValue={query.designer}>
              <option value="">Anyone</option>
              <option value="unassigned">Not assigned</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="ds-label flex flex-col gap-1">
          Design type
          <select className="input" name="type" defaultValue={query.type}>
            <option value="">Any</option>
            {types.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ds-label flex flex-col gap-1">
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
        <label className="ds-label flex flex-col gap-1">
          Created from
          <input className="input" type="date" name="from" defaultValue={query.from} />
        </label>
        <label className="ds-label flex flex-col gap-1">
          to
          <input className="input" type="date" name="to" defaultValue={query.to} />
        </label>
        <button className="btn btn-sm ds-btn-navy">Apply</button>
        {filtered && (
          <Link href={listHref({ ...query, q: "", designer: "", type: "", priority: "", from: "", to: "" }, { page: 1 })} className="btn btn-ghost btn-sm">
            Clear
          </Link>
        )}
      </form>

      <Card pad={false}>
        {rows.length === 0 ? (
          <Empty title="No tickets here">{filtered ? "Try another search or fewer filters." : "Nothing is in this group right now."}</Empty>
        ) : (
          <TicketTable rows={rows} query={query} />
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ds-line)] px-5 py-3 text-sm">
          <span className="ds-muted">
            {total ? `Showing ${first}–${first + rows.length - 1} of ${total} ticket${total === 1 ? "" : "s"}` : "0 tickets"}
          </span>
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
            <span className="tabular-nums ds-muted">
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
    </div>
  );
}
