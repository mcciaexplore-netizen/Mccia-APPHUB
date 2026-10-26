import Link from "next/link";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { ClickableRow } from "@/components/approvals/ClickableRow";
import { OverBudgetBadge } from "@/components/approvals/Badges";
import { ListFilters } from "@/components/approvals/ListFilters";
import { PageHeader } from "@/components/approvals/PageHeader";
import { QuickDecide } from "@/components/approvals/QuickDecide";
import { EmptyState, StatusPill } from "@/components/approvals/shared-ui";
import { appForType } from "@/lib/approvals/approvals.manifest";
import { formatDate, formatDateTime, formatINR, isoToDisplay } from "@/lib/approvals/format";
import { toQueryString, type ListParams, type SortKey } from "@/lib/approvals/list-params";
import { listMasterCached } from "@/lib/approvals/masters";
import { listRequests } from "@/lib/approvals/request-queries";
import { PAGE_SIZE, type ListScreen } from "@/lib/approvals/screens";
import { hasRole, type ApprovalsUser } from "@/lib/approvals/host-adapter";
import type { AprRequestStatus } from "@/db/approvals-schema";
import { decisionMode } from "@/lib/approvals/calc";

const TYPE_SHORT = { hr: "HR", expenditure_large: "Expenditure", expenditure_small: "Expense" } as const;

/** One list screen: filters on top, a sortable table, a pager. Which rows appear is decided by the server, never by the filter alone. */
export async function ListScreenView({ slug, screen, params, user }: { slug: string; screen: ListScreen; params: ListParams; user: ApprovalsUser }) {
  const path = `/approvals/${slug}`;
  const [{ rows, total, page, pageSize }, hrCats, expCats, branches] = await Promise.all([
    listRequests(user, {
      types: screen.types, statuses: params.status ? [params.status as AprRequestStatus] : screen.statuses, mine: screen.mine, waitingForMe: screen.waitingForMe, decidedByMe: screen.decidedByMe, recommendedByMe: screen.recommendedByMe, rejectedByMe: screen.rejectedByMe, approvedByMe: screen.approvedByMe, reachedMe: screen.reachedMe,
      q: params.q, from: params.from, to: params.to, categoryId: params.categoryId, branchId: params.branchId, sort: params.sort, dir: params.dir, page: params.page, pageSize: PAGE_SIZE,
    }),
    screen.categories !== "expense" ? listMasterCached("hr-categories", true) : Promise.resolve([]),
    screen.categories !== "hr" ? listMasterCached("categories", true) : Promise.resolve([]),
    screen.branch ? listMasterCached("branches", true) : Promise.resolve([]),
  ]);
  const categories = [...hrCats, ...expCats].map((c) => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name));
  const mixed = !screen.types || screen.types.length > 1;

  const sortHref = (key: SortKey) => `${path}${toQueryString({ ...params, sort: key, dir: params.sort === key && params.dir === "desc" ? "asc" : "desc", page: 1 })}`;
  const pageHref = (n: number) => `${path}${toQueryString({ ...params, page: n })}`;
  const th = (label: string, key: SortKey, cls = "") => (
    <th className={cls} aria-sort={params.sort === key ? (params.dir === "asc" ? "ascending" : "descending") : "none"}>
      <Link href={sortHref(key)} className="zth-sort">
        {label}
        {params.sort === key && (params.dir === "asc" ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden />)}
      </Link>
    </th>
  );

  const exportQuery = toQueryString({ ...params, page: 1 });
  const exportHref = `/api/approvals/requests/export${exportQuery ? `${exportQuery}&` : "?"}screen=${encodeURIComponent(slug)}`;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const filtered = !!(params.q || params.from || params.to || params.categoryId || params.branchId || params.status);
  // An empty list says why: nothing waits for you, nothing was recommended to you, you raised nothing, or nothing matches.
  const empty = filtered ? "none" : screen.reachedMe || slug === "inbox" ? "queue" : screen.waitingForMe ? "waiting" : screen.mine ? "mine" : "none";

  return (
    <>
      <PageHeader
        title={screen.title} intro={screen.intro}
        actions={screen.newHref ? <Link href={screen.newHref} className="btn btn-primary btn-sm"><Plus size={14} /> New request</Link> : undefined}
      />
      <ListFilters params={params} categories={categories} branches={branches.map((b) => ({ id: b.id, name: b.name }))} showStatus={!screen.statuses} showBranch={!!screen.branch} exportHref={exportHref}
        addCategory={hasRole(user, "approvals_admin") ? (screen.categories === "hr" ? { kind: "hr-categories", noun: "HR request type" } : { kind: "categories", noun: "expense type" }) : undefined} />

      {rows.length === 0 ? <EmptyState kind={empty} /> : (
      <div className="table-wrap">
        <table className="apr-table">
          <thead>
            <tr>
              {th("Request No.", "requestNo")}
              {mixed && <th className="hidden md:table-cell">Type</th>}
              {th("Name", "name")}
              {th("Category", "category", "hidden md:table-cell")}
              {screen.branch && th("Branch", "branch")}
              {screen.vendor && <th className="hidden md:table-cell">Vendor</th>}
              {screen.vendor && <th className="hidden md:table-cell">Tax invoice date</th>}
              {th("Amount (₹)", "amount", "text-right")}
              {th("Date of Request", "requestedAt", "hidden md:table-cell")}
              {th("Status", "status")}
              {th("Approver", "approver", "hidden md:table-cell")}
              {th("Decision Date", "decidedAt", "hidden md:table-cell")}
              {screen.quickDecide && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const href = `/approvals/requests/${r.id}?app=${appForType(r.type)}`;
              return (
                <ClickableRow key={r.id} href={href}>
                  <td className="whitespace-nowrap font-bold"><Link href={href} className="text-[var(--z-accent)] hover:underline">{r.requestNo ?? "—"}</Link></td>
                  {mixed && <td className="hidden md:table-cell">{TYPE_SHORT[r.type]}</td>}
                  <td>{r.name}</td>
                  <td className="hidden md:table-cell">{r.categoryName ?? ""}</td>
                  {screen.branch && <td>{r.branchName ?? ""}</td>}
                  {screen.vendor && <td className="hidden md:table-cell max-w-48 truncate" title={r.vendorName ?? ""}>{r.vendorName ?? ""}</td>}
                  {screen.vendor && <td className="hidden md:table-cell whitespace-nowrap">{isoToDisplay(r.taxInvoiceDate)}</td>}
                  <td className="whitespace-nowrap text-right">{r.amountPaise == null ? "" : formatINR(r.amountPaise)}</td>
                  <td className="hidden md:table-cell whitespace-nowrap">{formatDate(r.requestedAt)}</td>
                  <td className="whitespace-nowrap"><span className="inline-flex flex-wrap items-center gap-1"><StatusPill status={r.status} currentStepNo={r.currentStep} />{r.overBudget && <OverBudgetBadge />}</span></td>
                  <td className="hidden md:table-cell">{r.approverName ?? ""}</td>
                  <td className="hidden md:table-cell whitespace-nowrap">{r.decidedAt ? formatDateTime(r.decidedAt) : ""}</td>
                  {screen.quickDecide && <td className="whitespace-nowrap">{r.mineToDecide && <QuickDecide id={r.id} label={r.requestNo ?? "request"} overBudget={r.overBudget && decisionMode(r.currentStep, r.totalSteps) !== "final"} kind={decisionMode(r.currentStep, r.totalSteps)} />}</td>}
                </ClickableRow>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      {total > 0 && <p className="mt-3 text-sm text-[var(--z-muted)]">Showing {from}–{Math.min(page * pageSize, total)} of {total}</p>}
      {/* Plain links, so paging needs no script; the filters and sort stay in the address. */}
      {total > PAGE_SIZE && (
        <nav className="mt-2 flex items-center justify-center gap-6 text-sm text-[var(--z-muted)]" aria-label="Pages">
          {page > 1 ? <a href={pageHref(page - 1)} className="hover:text-[var(--z-accent)]">← Previous</a> : <span className="invisible">← Previous</span>}
          <span>Page <b className="text-ink">{page}</b> of {pages}</span>
          {page < pages ? <a href={pageHref(page + 1)} className="hover:text-[var(--z-accent)]">Next →</a> : <span className="invisible">Next →</span>}
        </nav>
      )}
    </>
  );
}
