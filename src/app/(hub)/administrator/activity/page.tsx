import Link from "next/link";
import { redirect } from "next/navigation";
import { ActivityView } from "@/components/ActivityView";
import { parseFilters } from "@/lib/activity";
import { APPROVAL_LOG_ACTIONS, listApprovalEvents } from "@/lib/approvals/event-log";
import { approvalsEnabled } from "@/lib/approvals/flags";
import { formatIST } from "@/lib/format";
import { requireAdministrator } from "@/lib/permissions";
import { hasArea, isSuper } from "@/lib/rbac";
import { listSignIns } from "@/lib/sign-ins";
import { AuditLog } from "../AuditLog";

export const metadata = { title: "Activity Log · MCCIA App Hub" };

type SP = Record<string, string | string[] | undefined>;
const g = (sp: SP, k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
type Tab = "opens" | "changes" | "approvals" | "signins";

const ACTION_WORD: Record<string, string> = {
  submitted: "Submitted", assigned: "Assigned", approved: "Approved", rejected: "Rejected", withdrawn: "Withdrawn", resubmitted: "Resubmitted",
  reassigned: "Reassigned", comment: "Commented", returned: "Returned for corrections",
};

/** A filter bar shared by the Approvals and Sign-ins tabs: search, an extra choice, dates, newest or oldest first. */
function Filters({ tab, sp, placeholder, choice }: { tab: Tab; sp: SP; placeholder: string; choice: { name: string; label: string; options: [string, string][] } }) {
  return (
    <form method="get" action="/administrator/activity" className="glass !rounded-md grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
      <input type="hidden" name="tab" value={tab} />
      <label className="lg:col-span-2"><span className="label-xs mb-1 block">Search</span><input name="q" className="input !py-2" defaultValue={g(sp, "q")} placeholder={placeholder} /></label>
      <label><span className="label-xs mb-1 block">{choice.label}</span>
        <select name={choice.name} className="input !py-2" defaultValue={g(sp, choice.name)}>{choice.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label><span className="label-xs mb-1 block">From</span><input name="from" type="date" className="input !py-2" defaultValue={g(sp, "from")} /></label>
      <label><span className="label-xs mb-1 block">To</span><input name="to" type="date" className="input !py-2" defaultValue={g(sp, "to")} /></label>
      <label><span className="label-xs mb-1 block">Order</span>
        <select name="dir" className="input !py-2" defaultValue={g(sp, "dir") || "desc"}><option value="desc">Newest first</option><option value="asc">Oldest first</option></select></label>
      <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-6">
        <button className="btn btn-primary btn-sm">Apply</button>
        <Link className="btn btn-ghost btn-sm" href={`/administrator/activity?tab=${tab}`}>Clear</Link>
      </div>
    </form>
  );
}

function Pager({ tab, sp, page, pages, total, noun }: { tab: Tab; sp: SP; page: number; pages: number; total: number; noun: string }) {
  const href = (n: number) => {
    const p = new URLSearchParams({ tab });
    for (const k of ["q", "action", "outcome", "from", "to", "dir"]) if (g(sp, k)) p.set(k, g(sp, k));
    p.set("page", String(n));
    return `/administrator/activity?${p}`;
  };
  return (
    <nav className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted" aria-label="Pages">
      <span>{total} {total === 1 ? noun : `${noun}s`}</span>
      <span className="flex items-center gap-2">
        {page > 1 ? <Link className="btn btn-ghost btn-sm" href={href(page - 1)}>Previous</Link> : <span className="btn btn-ghost btn-sm opacity-50">Previous</span>}
        <span>Page {Math.min(page, pages)} of {pages}</span>
        {page < pages ? <Link className="btn btn-ghost btn-sm" href={href(page + 1)}>Next</Link> : <span className="btn btn-ghost btn-sm opacity-50">Next</span>}
      </span>
    </nav>
  );
}

async function Approvals({ sp }: { sp: SP }) {
  const page = Math.max(1, Number(g(sp, "page")) || 1);
  const data = await listApprovalEvents({ q: g(sp, "q") || undefined, action: g(sp, "action") || undefined, from: g(sp, "from") || undefined, to: g(sp, "to") || undefined, dir: g(sp, "dir") === "asc" ? "asc" : "desc", page });
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">Every step of every HR and expense request: who submitted, recommended, approved, rejected, returned or withdrew it, and what it became.</p>
      <Filters tab="approvals" sp={sp} placeholder="Request number, person or approver" choice={{ name: "action", label: "Action", options: [["", "All actions"], ...APPROVAL_LOG_ACTIONS.map((a): [string, string] => [a, ACTION_WORD[a] ?? a])] }} />
      <div className="table-wrap"><table>
        <thead><tr><th>When</th><th>By</th><th>Action</th><th>Request</th><th>Outcome</th><th>Comment</th></tr></thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap text-xs text-muted">{formatIST(r.at)}</td><td>{r.actorName}</td>
              <td><span className="badge badge-neutral">{ACTION_WORD[r.action] ?? r.action}</span></td>
              <td><Link className="text-primary hover:underline" href={`/approvals/requests/${r.requestId}`}>{r.requestNo ?? "Request"}</Link><span className="block text-xs text-muted">{r.requester}</span></td>
              <td className="text-xs">{r.toStatus ?? "—"}</td>
              <td className="max-w-xs text-xs text-muted">{r.comment ?? ""}</td>
            </tr>
          ))}
          {data.rows.length === 0 && <tr><td colSpan={6} className="text-subtle">No entries match.</td></tr>}
        </tbody>
      </table></div>
      <Pager tab="approvals" sp={sp} page={page} pages={data.pages} total={data.total} noun="entry" />
    </div>
  );
}

async function SignIns({ sp }: { sp: SP }) {
  const page = Math.max(1, Number(g(sp, "page")) || 1);
  const outcome = g(sp, "outcome");
  const data = await listSignIns({ q: g(sp, "q") || undefined, outcome: outcome === "ok" || outcome === "failed" ? outcome : undefined, from: g(sp, "from") || undefined, to: g(sp, "to") || undefined, dir: g(sp, "dir") === "asc" ? "asc" : "desc", page });
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">Every sign-in attempt, successful or not. Passwords are never recorded.</p>
      <Filters tab="signins" sp={sp} placeholder="Email address" choice={{ name: "outcome", label: "Outcome", options: [["", "All"], ["ok", "Signed in"], ["failed", "Failed"]] }} />
      <div className="table-wrap"><table>
        <thead><tr><th>When</th><th>Email</th><th>Outcome</th><th>From (IP address)</th></tr></thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap text-xs text-muted">{formatIST(r.at)}</td><td>{r.email}</td>
              <td>{r.success ? <span className="badge badge-green">Signed in</span> : <span className="badge badge-red">Failed</span>}</td>
              <td className="text-xs text-muted">{r.ip ?? "—"}</td>
            </tr>
          ))}
          {data.rows.length === 0 && <tr><td colSpan={4} className="text-subtle">No entries match.</td></tr>}
        </tbody>
      </table></div>
      <Pager tab="signins" sp={sp} page={page} pages={data.pages} total={data.total} noun="attempt" />
    </div>
  );
}

/**
 * The Activity Log: one place for what happened, in tabs, each shown only to those allowed to see it. Application opens need the Activity
 * log area; changes and sign-ins the Audit log area; approval actions are for the Support Admin (who runs the Approval System).
 */
export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requireAdministrator();
  const sp = await searchParams;
  const tabs = ([
    hasArea(me, "activity") && { id: "opens", label: "Application opens" },
    hasArea(me, "audit") && { id: "changes", label: "Admin changes" },
    isSuper(me) && approvalsEnabled() && { id: "approvals", label: "Approvals" },
    hasArea(me, "audit") && { id: "signins", label: "Sign-ins" },
  ].filter(Boolean)) as { id: Tab; label: string }[];
  if (tabs.length === 0) redirect("/administrator");
  const tab = tabs.find((t) => t.id === g(sp, "tab"))?.id ?? tabs[0].id;
  return (
    <div className="space-y-6">
      <nav aria-label="Activity Log" className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Link key={t.id} href={t.id === "opens" ? "/administrator/activity" : `/administrator/activity?tab=${t.id}`} aria-current={t.id === tab ? "page" : undefined}
            className={`btn btn-sm ${t.id === tab ? "btn-primary" : "btn-ghost"}`}>{t.label}</Link>
        ))}
      </nav>
      {tab === "opens" && <ActivityView filters={parseFilters(sp)} basePath="/administrator/activity" isAdmin searchParams={sp} />}
      {tab === "changes" && <AuditLog sp={sp} />}
      {tab === "approvals" && <Approvals sp={sp} />}
      {tab === "signins" && <SignIns sp={sp} />}
    </div>
  );
}
