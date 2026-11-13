import Link from "next/link";
import { Search } from "lucide-react";
import { Avatars, Card, DomainBadge, Empty, formatDateTime, formatDay, isOverdue, PageHeader, PriorityBadge, StatusBadge } from "@/components/eru/ui";
import { requireAdmin } from "@/lib/eru/dal";
import { PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL } from "@/lib/eru/eru.manifest";
import { activeDomains, allProjects, PAGE_SIZE, readFilters, type ProjectFilters } from "@/lib/eru/queries";

export const metadata = { title: "All Projects · ERU Admin · MCCIA App Hub" };

const href = (f: ProjectFilters, page: number) => {
  const q = new URLSearchParams();
  if (f.q) q.set("q", f.q);
  if (f.domain) q.set("domain", f.domain);
  if (f.status) q.set("status", f.status);
  if (f.priority) q.set("priority", f.priority);
  if (page > 1) q.set("page", String(page));
  const s = q.toString();
  return `/eru/admin/projects${s ? `?${s}` : ""}`;
};

/** Every project across every domain, as a table: filter by domain, status and priority; search by number or title. */
export default async function AllProjects({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const f = readFilters(await searchParams);
  const [{ rows, total }, domains] = await Promise.all([allProjects(f), activeDomains()]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="All Projects" subtitle={`${total} project${total === 1 ? "" : "s"}${f.q || f.domain || f.status || f.priority ? " matching" : ""}.`} />
      <form className="eru-card flex flex-wrap items-end gap-3 p-4" method="get" role="search">
        <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-xs font-semibold eru-muted">
          Search
          <span className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 eru-muted" aria-hidden />
            <input name="q" defaultValue={f.q} className="input w-full pl-8" placeholder="ERU-0001 or title" />
          </span>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold eru-muted">
          Domain
          <select name="domain" defaultValue={f.domain} className="input">
            <option value="">All domains</option>
            {domains.map((d) => (
              <option key={d.id} value={d.key}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold eru-muted">
          Status
          <select name="status" defaultValue={f.status} className="input">
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold eru-muted">
          Priority
          <select name="priority" defaultValue={f.priority} className="input">
            <option value="">Any priority</option>
            {PRIORITIES.map((s) => (
              <option key={s} value={s}>
                {PRIORITY_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn eru-btn-navy">
          Filter
        </button>
        {(f.q || f.domain || f.status || f.priority) && (
          <Link href="/eru/admin/projects" className="btn btn-ghost">
            Clear
          </Link>
        )}
      </form>
      <Card pad={false}>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-sm">
              <thead>
                <tr className="text-left eru-label">
                  {["Number", "Title", "Domain", "Status", "Priority", "Assigned", "Due", "Updated"].map((h) => (
                    <th key={h} className="px-4 py-3 font-bold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="border-t border-[var(--eru-line)] hover:bg-[var(--eru-navy-tint)]">
                    <td className="px-4 py-3 font-mono text-xs font-bold">
                      <Link href={`/eru/projects/${p.id}`} className="text-[var(--eru-navy)] hover:underline">
                        {p.number}
                      </Link>
                    </td>
                    <td className="max-w-[18rem] px-4 py-3">
                      <Link href={`/eru/projects/${p.id}`} className="line-clamp-2 font-semibold text-ink hover:underline">
                        {p.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <DomainBadge name={p.domain.name} color={p.domain.color} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="px-4 py-3">
                      <PriorityBadge priority={p.priority} />
                    </td>
                    <td className="px-4 py-3">
                      <Avatars people={p.assigned} max={3} size={24} />
                    </td>
                    <td className={`whitespace-nowrap px-4 py-3 ${isOverdue(p.dueDate) && p.status !== "completed" && p.status !== "archived" ? "font-bold text-[var(--eru-red)]" : ""}`}>{p.dueDate ? formatDay(p.dueDate) : "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs eru-muted">{formatDateTime(p.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No projects match">Try other filters, or clear them.</Empty>
        )}
      </Card>
      {pages > 1 && (
        <nav className="flex items-center justify-center gap-3 text-sm" aria-label="Pages">
          {f.page > 1 && (
            <Link className="btn btn-ghost btn-sm" href={href(f, f.page - 1)}>
              Previous
            </Link>
          )}
          <span className="eru-muted">
            Page {f.page} of {pages}
          </span>
          {f.page < pages && (
            <Link className="btn btn-ghost btn-sm" href={href(f, f.page + 1)}>
              Next
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
