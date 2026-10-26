import Link from "next/link";
import { count, desc } from "drizzle-orm";
import { Activity, AppWindow, Bell, ClipboardCheck, ClipboardList, Layers, Network, ShieldCheck, Upload, UserPlus, Users } from "lucide-react";
import { db } from "@/db";
import { appChecks, apps, userAppAccess } from "@/db/schema";
import { CountUp } from "@/components/CountUp";
import { listAudit } from "@/lib/audit";
import { formatIST } from "@/lib/format";
import { approvalsEnabled } from "@/lib/approvals/flags";
import { approvalsOverview } from "@/lib/approvals/admin-overview";
import { noticeFeed } from "@/lib/notice-feed";
import { adminSummary } from "@/lib/people";
import { requireAdministrator } from "@/lib/permissions";
import { hasArea, isSuper } from "@/lib/rbac";

export const metadata = { title: "Administrator · MCCIA App Hub" };

function Card({ label, value, href, tone }: { label: string; value: number; href?: string; tone?: "warn" }) {
  const body = (
    <>
      <CountUp value={value} className={`big-number ${tone === "warn" && value > 0 ? "!text-brand-red" : ""}`} />
      <p className="label-xs mt-2">{label}</p>
    </>
  );
  const cls = "glass glass-hover !rounded-md block p-5 text-center";
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

/** A single bar split by status, with a legend of counts; each part opens the matching filtered list. Real counts only. */
function StatusBars({ title, total, bars }: { title: string; total: number; bars: { label: string; n: number; color: string; href: string }[] }) {
  return (
    <section className="glass !rounded-md space-y-3 p-5" aria-label={title}>
      <div className="flex items-baseline justify-between"><h2 className="text-lg">{title}</h2><span className="text-sm text-muted">{total} in all</span></div>
      <div className="flex h-3 overflow-hidden rounded-pill bg-alt" role="img" aria-label={bars.map((b) => `${b.label} ${b.n}`).join(", ")}>
        {total > 0 && bars.filter((b) => b.n > 0).map((b) => <span key={b.label} style={{ width: `${(b.n / total) * 100}%`, background: b.color }} />)}
      </div>
      <ul className="grid grid-cols-2 gap-2 text-sm">
        {bars.map((b) => (
          <li key={b.label}><Link href={b.href} className="flex items-center gap-2 hover:text-primary">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: b.color }} aria-hidden />
            <span className="flex-1 text-muted">{b.label}</span><b className="text-ink">{b.n}</b>
            <span className="w-10 text-right text-xs text-subtle">{total ? Math.round((b.n / total) * 100) : 0}%</span>
          </Link></li>
        ))}
      </ul>
    </section>
  );
}

/** The administrator's home: real counts only, what needs attention, and the latest changes. Nothing here is estimated. */
export default async function Page() {
  const me = await requireAdministrator();
  // Approvals cover HR and expenditure together, so only the two top roles see their numbers. The audit log needs its own area.
  const showApprovals = isSuper(me) && approvalsEnabled();
  const [s, recent, latest, list, approvals, notices, assignments] = await Promise.all([
    adminSummary(),
    hasArea(me, "audit") ? listAudit({ page: 1 }, 8) : Promise.resolve(null),
    db.selectDistinctOn([appChecks.appId], { appId: appChecks.appId, ok: appChecks.ok }).from(appChecks).orderBy(appChecks.appId, desc(appChecks.checkedAt)),
    db.select({ id: apps.id, url: apps.url }).from(apps),
    showApprovals ? approvalsOverview() : Promise.resolve(null),
    noticeFeed(me.id),
    db.select({ n: count() }).from(userAppAccess).then((r) => r[0]?.n ?? 0),
  ]);
  const external = list.filter((a) => !a.url.startsWith("/"));
  const checked = new Map(latest.map((c) => [c.appId, c.ok]));
  const failing = external.filter((a) => checked.get(a.id) === false).length;
  const never = external.filter((a) => !checked.has(a.id)).length;
  const attention: { text: string; href: string }[] = [];
  if (s.users.pending > 0) attention.push({ text: `${s.users.pending} ${s.users.pending === 1 ? "person has" : "people have"} not set a password yet`, href: "/administrator/users?status=pending" });
  if (failing > 0) attention.push({ text: `${failing} application${failing === 1 ? "" : "s"} failed the last link check`, href: "/administrator/inventory" });
  if (s.apps.unavailable > 0) attention.push({ text: `${s.apps.unavailable} application${s.apps.unavailable === 1 ? " is" : "s are"} marked unavailable`, href: "/administrator/inventory" });
  if (never > 0) attention.push({ text: `${never} application${never === 1 ? " has" : "s have"} never been checked`, href: "/administrator/inventory" });

  const pendingApprovals = approvals ? approvals.hr.pending + approvals.large.pending + approvals.small.pending : 0;
  const userBars = [
    { label: "Active", n: s.users.active, color: "#15803d", href: "/administrator/users?status=active" },
    { label: "Pending invitation", n: s.users.pending, color: "#b45309", href: "/administrator/users?status=pending" },
    { label: "Inactive", n: s.users.inactive, color: "#94a3b8", href: "/administrator/users?status=inactive" },
  ];
  const appBars = [
    { label: "Active", n: s.apps.live, color: "#2a6b7c", href: "/administrator/inventory" },
    { label: "Under testing", n: s.apps.testing, color: "#b45309", href: "/administrator/inventory" },
    { label: "Unavailable", n: s.apps.unavailable, color: "#b91c1c", href: "/administrator/inventory" },
    { label: "Hidden", n: s.apps.hidden, color: "#94a3b8", href: "/administrator/inventory" },
  ];

  return (
    <div className="space-y-6">
      <section aria-label="Summary" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Card label="Total users" value={s.users.total} href="/administrator/users" />
        <Card label="Active users" value={s.users.active} href="/administrator/users?status=active" />
        <Card label="Inactive users" value={s.users.inactive} href="/administrator/users?status=inactive" />
        <Card label="Applications" value={s.apps.total} href="/administrator/inventory" />
        {approvals && <Card label="Pending approvals" value={pendingApprovals} href="/approvals/review/hr/pending" tone="warn" />}
        <Card label="Access assignments" value={assignments} href="/administrator/users" />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <StatusBars title="User status" total={s.users.total} bars={userBars} />
        <StatusBars title="Application status" total={s.apps.total} bars={appBars} />
      </div>

      <section className="glass !rounded-md p-5" aria-label="Quick actions">
        <h2 className="mb-3 text-lg">Quick actions</h2>
        <div className="flex flex-wrap gap-2">
          {hasArea(me, "people") && <Link href="/administrator/users" className="btn btn-primary btn-sm"><UserPlus size={14} /> Add user</Link>}
          {hasArea(me, "apps") && <Link href="/administrator/inventory" className="btn btn-ghost btn-sm"><AppWindow size={14} /> Add application</Link>}
          {approvals && <Link href="/approvals/review/hr/pending" className="btn btn-ghost btn-sm"><ClipboardCheck size={14} /> Review approvals{pendingApprovals ? ` (${pendingApprovals})` : ""}</Link>}
          {(hasArea(me, "activity") || hasArea(me, "audit")) && <Link href={hasArea(me, "activity") ? "/administrator/activity" : "/administrator/activity?tab=changes"} className="btn btn-ghost btn-sm"><Activity size={14} /> View activity log</Link>}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="glass !rounded-md space-y-3 p-5 sm:p-6" aria-label="Needs attention">
          <h2 className="text-xl">Needs attention</h2>
          {attention.length === 0 ? <p className="text-sm text-muted">Nothing needs attention right now.</p> : (
            <ul className="space-y-2 text-sm">{attention.map((a) => <li key={a.text}><Link href={a.href} className="text-primary hover:underline">{a.text}</Link></li>)}</ul>
          )}
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            <Link href="/administrator/users/import" className="btn btn-primary btn-sm"><Upload size={14} /> Bulk add users</Link>
            <Link href="/administrator/users" className="btn btn-ghost btn-sm"><Users size={14} /> Users</Link>
            <Link href="/administrator/departments" className="btn btn-ghost btn-sm"><Layers size={14} /> Application categories</Link>
            <Link href="/administrator/users/org" className="btn btn-ghost btn-sm"><Network size={14} /> Branches &amp; teams ({s.branches} · {s.teams})</Link>
            <Link href="/administrator/inventory" className="btn btn-ghost btn-sm"><ClipboardList size={14} /> Application inventory</Link>
          </div>
        </section>
        {recent && (
          <section className="glass !rounded-md space-y-3 p-5 sm:p-6" aria-label="Recent changes">
            <div className="flex items-center justify-between"><h2 className="text-xl">Recent changes</h2><Link href="/administrator/activity?tab=changes" className="text-sm text-primary hover:underline"><ShieldCheck size={14} className="mr-1 inline" />Audit log</Link></div>
            {recent.rows.length === 0 ? <p className="text-sm text-muted">No changes recorded yet.</p> : (
              <ul className="divide-y divide-line text-sm">{recent.rows.map((r) => (
                <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2"><span><b>{r.actorName}</b> <span className="text-muted">{r.action}</span>{r.targetLabel && <> · {r.targetLabel}</>}</span><span className="text-xs text-muted">{formatIST(r.at)}</span></li>
              ))}</ul>
            )}
          </section>
        )}
        <section className="glass !rounded-md space-y-3 p-5 sm:p-6" aria-label="Your notifications">
          <div className="flex items-center justify-between"><h2 className="text-xl">Your notifications</h2><Link href="/administrator/notifications" className="text-sm text-primary hover:underline"><Bell size={14} className="mr-1 inline" />All notifications</Link></div>
          {notices.length === 0 ? <p className="text-sm text-muted">No notifications yet.</p> : (
            <ul className="divide-y divide-line text-sm">{notices.slice(0, 5).map((n) => (
              <li key={n.key} className="flex flex-wrap justify-between gap-2 py-2"><span className={n.read ? "text-muted" : "font-bold"}>{n.title}</span><span className="text-xs text-muted">{formatIST(new Date(n.at))}</span></li>
            ))}</ul>
          )}
        </section>
      </div>
    </div>
  );
}
