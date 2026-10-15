import Link from "next/link";
import { OverBudgetBadge, StatusBadge } from "@/components/approvals/Badges";
import { PageHeader } from "@/components/approvals/PageHeader";
import { Timeline } from "@/components/approvals/Timeline";
import type { AprRequestType } from "@/db/approvals-schema";
import { appForType } from "@/lib/approvals/approvals.manifest";
import { formatDate } from "@/lib/approvals/format";
import type { ApprovalsUser } from "@/lib/approvals/host-adapter";
import { getRequestDetail, listRequests } from "@/lib/approvals/request-queries";
import { idSchema } from "@/lib/approvals/validation";

/** Pick a request on the left, see its history (who did what, when, with what comment) on the right. */
export async function TimelineScreen({
  title, intro, types, search, user, path,
}: { title: string; intro: string; types?: AprRequestType[]; search: Record<string, string | string[] | undefined>; user: ApprovalsUser; path: string }) {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const q = one(search.q).slice(0, 100);
  const id = idSchema.safeParse(one(search.id)).success ? one(search.id) : "";
  const [{ rows }, picked] = await Promise.all([listRequests(user, { types, q, pageSize: 30 }), id ? getRequestDetail(id, user) : Promise.resolve(null)]);
  const href = (rid: string) => `${path}?id=${rid}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <>
      <PageHeader title={title} intro={intro} />
      <div className="grid gap-8 lg:grid-cols-[22rem_1fr]">
        <div>
          <form method="get" className="mb-3 flex gap-2">
            {id && <input type="hidden" name="id" value={id} />}
            <input className="input flex-1" type="search" name="q" defaultValue={q} placeholder="Search request, name or category" aria-label="Search requests" />
            <button className="btn btn-primary btn-sm">Search</button>
          </form>
          <ul className="max-h-[32rem] divide-y divide-[var(--z-line)] overflow-y-auto rounded-sm border border-[var(--z-line)]">
            {rows.length === 0 && <li className="px-3 py-4 text-[var(--z-muted)]">No requests found.</li>}
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={href(r.id)} aria-current={r.id === id ? "true" : undefined} className={`block px-3 py-2 hover:bg-[#f7f8f9] ${r.id === id ? "bg-[var(--z-teal-tint)]" : ""}`}>
                  <span className="flex items-center justify-between gap-2"><b>{r.requestNo}</b><span className="flex gap-1"><StatusBadge status={r.status} />{r.overBudget && <OverBudgetBadge />}</span></span>
                  <span className="block truncate text-sm text-[var(--z-muted)]">{r.name} · {r.categoryName} · {formatDate(r.requestedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          {!picked ? (
            <p className="text-[var(--z-muted)]">{id ? "That request could not be found." : "Choose a request to see its timeline."}</p>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <h2 className="!text-lg">{picked.requestNo}</h2><StatusBadge status={picked.status} />{picked.overBudget && <OverBudgetBadge />}
                <Link href={`/approvals/requests/${picked.id}?app=${appForType(picked.type)}`} className="apr-link ml-auto text-sm">Open the request</Link>
              </div>
              <Timeline events={picked.events} />
            </>
          )}
        </div>
      </div>
    </>
  );
}
