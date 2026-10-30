import Link from "next/link";
import { ClickableRow } from "@/components/approvals/ClickableRow";
import { EmptyState, StatusPill } from "@/components/approvals/shared-ui";
import { appForType } from "@/lib/approvals/approvals.manifest";
import { formatDate, formatDateTime, formatINR } from "@/lib/approvals/format";
import { listMyDecisions, listRequests } from "@/lib/approvals/request-queries";
import { PAGE_SIZE } from "@/lib/approvals/screens";
import type { ApprovalsUser } from "@/lib/approvals/host-adapter";
import type { AprRequestType } from "@/db/approvals-schema";

/**
 * The person's own lists in the sidebar: My Requests (everyone), and for people who decide, what waits for them and what they decided.
 * Each row opens its request.
 */

const typeLabel = (t: AprRequestType) => (t === "hr" ? "HR" : "Expenditure");
const requestHref = (r: { id: string; type: AprRequestType }) => `/approvals/requests/${r.id}?app=${appForType(r.type)}`;

/** "Showing 1–25 of 40" and plain Previous / Next links, as on the other lists. */
function Pager({ path, page, total }: { path: string; page: number; total: number }) {
  if (total === 0) return null;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (n: number) => (n === 1 ? path : `${path}?page=${n}`);
  return (
    <>
      <p className="mt-3 text-sm text-[var(--z-muted)]">Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}</p>
      {total > PAGE_SIZE && (
        <nav className="mt-2 flex items-center justify-center gap-6 text-sm text-[var(--z-muted)]" aria-label="Pages">
          {page > 1 ? <a href={href(page - 1)} className="hover:text-[var(--z-accent)]">← Previous</a> : <span className="invisible">← Previous</span>}
          <span>Page <b className="text-ink">{page}</b> of {pages}</span>
          {page < pages ? <a href={href(page + 1)} className="hover:text-[var(--z-accent)]">Next →</a> : <span className="invisible">Next →</span>}
        </nav>
      )}
    </>
  );
}

/**
 * Every request this person raised, newest first, with where it stands (pending amber, approved green, rejected red). Right after
 * submitting, `submitted` is the new request's id: a confirmation with its number stays on top of the list.
 */
export async function MyRequestsList({ user, page, path, submitted }: { user: ApprovalsUser; page: number; path: string; submitted?: string }) {
  const { rows, total } = await listRequests(user, { mine: true, sort: "requestedAt", dir: "desc", page, pageSize: PAGE_SIZE });
  const justSent = submitted ? rows.find((r) => r.id === submitted) : undefined;
  return (
    <>
      {justSent && (
        <div role="status" className="mb-6 rounded-md border border-line bg-green-tint px-4 py-3 text-sm text-ink">
          <b>Request submitted: {justSent.requestNo}.</b> Keep this number. When it is approved or rejected you will get a notification on the bell above.
        </div>
      )}
      {rows.length === 0 ? <EmptyState kind="mine" /> : (
        <div className="table-wrap">
          <table className="apr-table">
            <thead>
              <tr>
                <th>Request No.</th>
                <th className="hidden md:table-cell">Type</th>
                <th className="hidden md:table-cell">Category</th>
                <th className="text-right">Amount (₹)</th>
                <th className="hidden md:table-cell">Date Submitted</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const href = requestHref(r);
                return (
                  <ClickableRow key={r.id} href={href}>
                    <td className="whitespace-nowrap font-bold"><Link href={href} className="text-[var(--z-accent)] hover:underline">{r.requestNo ?? "—"}</Link></td>
                    <td className="hidden md:table-cell">{typeLabel(r.type)}</td>
                    <td className="hidden md:table-cell">{r.categoryName ?? ""}</td>
                    <td className="whitespace-nowrap text-right">{r.amountPaise == null ? "" : formatINR(r.amountPaise)}</td>
                    <td className="hidden md:table-cell whitespace-nowrap">{formatDate(r.requestedAt)}</td>
                    <td className="whitespace-nowrap"><StatusPill status={r.status} /></td>
                  </ClickableRow>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager path={path} page={page} total={total} />
    </>
  );
}

/** Requests waiting for this person's decision, oldest first: the one waiting longest is the most urgent. */
export async function MyPendingApprovalsList({ user, page, path }: { user: ApprovalsUser; page: number; path: string }) {
  const { rows, total } = await listRequests(user, { statuses: ["pending"], waitingForMe: true, sort: "requestedAt", dir: "asc", page, pageSize: PAGE_SIZE });
  if (rows.length === 0) return <EmptyState kind="waiting" />;
  return (
    <>
      <div className="table-wrap">
        <table className="apr-table">
          <thead>
            <tr>
              <th>Request No.</th>
              <th>Requester</th>
              <th className="hidden md:table-cell">Type</th>
              <th className="hidden md:table-cell">Date Submitted</th>
              <th className="text-right">Amount / Category</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const href = requestHref(r);
              return (
                <ClickableRow key={r.id} href={href}>
                  <td className="whitespace-nowrap font-bold"><Link href={href} className="text-[var(--z-accent)] hover:underline">{r.requestNo ?? "—"}</Link></td>
                  <td>{r.name}</td>
                  <td className="hidden md:table-cell">{typeLabel(r.type)}</td>
                  <td className="hidden md:table-cell whitespace-nowrap">{formatDate(r.requestedAt)}</td>
                  <td className="whitespace-nowrap text-right">{r.type === "hr" ? (r.categoryName ?? "") : r.amountPaise == null ? "" : formatINR(r.amountPaise)}</td>
                  <td className="whitespace-nowrap"><Link href={href} className="btn btn-primary btn-sm">Review</Link></td>
                </ClickableRow>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager path={path} page={page} total={total} />
    </>
  );
}

/** Requests this person approved or rejected, newest decision first, each with how they decided. */
export async function MyDecisionsList({ user, page, path }: { user: ApprovalsUser; page: number; path: string }) {
  const { rows, total } = await listMyDecisions(user, page, PAGE_SIZE);
  if (rows.length === 0) return <EmptyState kind="decided" />;
  return (
    <>
      <div className="table-wrap">
        <table className="apr-table">
          <thead>
            <tr>
              <th>Request No.</th>
              <th>Requester</th>
              <th className="hidden md:table-cell">Type</th>
              <th className="hidden md:table-cell">Date Actioned</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const href = requestHref(r);
              return (
                <ClickableRow key={r.id} href={href}>
                  <td className="whitespace-nowrap font-bold"><Link href={href} className="text-[var(--z-accent)] hover:underline">{r.requestNo ?? "—"}</Link></td>
                  <td>{r.name}</td>
                  <td className="hidden md:table-cell">{typeLabel(r.type)}</td>
                  <td className="hidden md:table-cell whitespace-nowrap">{r.actedAt ? formatDateTime(r.actedAt) : ""}</td>
                  <td className="whitespace-nowrap">
                    <span className={`apr-pill apr-pill-${r.action}`}>{r.action === "approved" ? "Approved" : "Rejected"}</span>
                  </td>
                </ClickableRow>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager path={path} page={page} total={total} />
    </>
  );
}
