import Link from "next/link";
import { Download } from "lucide-react";
import { auditActions, listAudit, type AuditFilters } from "@/lib/audit";
import { formatIST } from "@/lib/format";

type SP = Record<string, string | string[] | undefined>;
const g = (sp: SP, k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");

/** A sentence for what an entry changed, from its recorded details. Nothing secret is ever recorded, so nothing secret can show. */
function detail(action: string, d: unknown): string {
  const x = (d ?? {}) as { added?: string[]; removed?: string[]; before?: string[]; after?: string[]; changes?: Record<string, { from: unknown; to: unknown }>; applications?: string[]; delivery?: string; created?: number; updated?: number; skipped?: number; invalid?: number; failed?: number; source?: string; from?: string; to?: string; application?: string };
  if (action === "access.change") return [x.added?.length ? `Added: ${x.added.join(", ")}` : "", x.removed?.length ? `Removed: ${x.removed.join(", ")}` : "", x.after ? `Now has: ${x.after.join(", ") || "nothing"}` : ""].filter(Boolean).join(" · ");
  if (action === "access.role") return `${x.application ? `${x.application}: ` : ""}${x.from ?? ""} → ${x.to ?? ""}`;
  if (action === "user.update" && x.changes) return Object.entries(x.changes).map(([k, v]) => `${k}: ${v.from ?? "none"} → ${v.to ?? "none"}`).join(" · ");
  if (action === "import.batch") return `Created ${x.created ?? 0}, updated ${x.updated ?? 0}, skipped ${x.skipped ?? 0}, invalid ${x.invalid ?? 0}, failed ${x.failed ?? 0}`;
  if (action === "user.invite") return `Setup link ${x.delivery ?? ""}`;
  if (action.startsWith("template.")) return (x.applications ?? x.after ?? []).join(", ");
  if (x.from || x.to) return `${x.from ?? ""} → ${x.to ?? ""}`;
  return x.source ? `via ${x.source}` : "";
}

/** The Admin changes tab of the Activity Log: every change to people, access and applications. The page checks who may see it. */
export async function AuditLog({ sp }: { sp: SP }) {
  const f: AuditFilters = { q: g(sp, "q") || undefined, action: g(sp, "action") || undefined, from: g(sp, "from") || undefined, to: g(sp, "to") || undefined, page: Math.max(1, Number(g(sp, "page")) || 1) };
  const [data, actions] = await Promise.all([listAudit(f), auditActions()]);
  const qs = (over: Record<string, string | number>) => {
    const p = new URLSearchParams({ tab: "changes" });
    for (const [k, v] of Object.entries({ q: f.q, action: f.action, from: f.from, to: f.to, ...over })) if (v) p.set(k, String(v));
    return p.toString();
  };
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">Every change to people, access, applications, branches and teams: who made it, what it was, and when. Passwords and setup links are never recorded.</p>
      <form method="get" className="glass !rounded-md grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5" action="/administrator/activity">
        <input type="hidden" name="tab" value="changes" />
        <label className="lg:col-span-2"><span className="label-xs mb-1 block">Search</span><input name="q" className="input !py-2" defaultValue={f.q} placeholder="Person, administrator or action" /></label>
        <label><span className="label-xs mb-1 block">Action</span>
          <select name="action" className="input !py-2" defaultValue={f.action ?? ""}><option value="">All actions</option>{actions.map((a) => <option key={a} value={a}>{a}</option>)}</select></label>
        <label><span className="label-xs mb-1 block">From</span><input name="from" type="date" className="input !py-2" defaultValue={f.from} /></label>
        <label><span className="label-xs mb-1 block">To</span><input name="to" type="date" className="input !py-2" defaultValue={f.to} /></label>
        <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-5">
          <button className="btn btn-primary btn-sm">Apply</button>
          <Link className="btn btn-ghost btn-sm" href="/administrator/activity?tab=changes">Clear</Link>
          <Link className="btn btn-ghost btn-sm ml-auto" href={`/administrator/users/audit/export?${qs({})}`}><Download size={14} /> Export CSV</Link>
        </div>
      </form>
      <div className="table-wrap"><table>
        <thead><tr><th>When</th><th>By</th><th>Action</th><th>About</th><th>What changed</th></tr></thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap text-xs text-muted">{formatIST(r.at)}</td><td>{r.actorName}</td>
              <td><span className="badge badge-neutral">{r.action}</span></td>
              <td>{r.targetLabel || <span className="text-subtle">—</span>}</td>
              <td className="max-w-md text-xs text-muted">{detail(r.action, r.details)}</td>
            </tr>
          ))}
          {data.rows.length === 0 && <tr><td colSpan={5} className="text-subtle">No entries match.</td></tr>}
        </tbody>
      </table></div>
      <nav className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted" aria-label="Pages">
        <span>{data.total} {data.total === 1 ? "entry" : "entries"}</span>
        <span className="flex items-center gap-2">
          {f.page > 1 ? <Link className="btn btn-ghost btn-sm" href={`/administrator/activity?${qs({ page: f.page - 1 })}`}>Previous</Link> : <span className="btn btn-ghost btn-sm opacity-50">Previous</span>}
          <span>Page {Math.min(f.page, data.pages)} of {data.pages}</span>
          {f.page < data.pages ? <Link className="btn btn-ghost btn-sm" href={`/administrator/activity?${qs({ page: f.page + 1 })}`}>Next</Link> : <span className="btn btn-ghost btn-sm opacity-50">Next</span>}
        </span>
      </nav>
    </div>
  );
}
