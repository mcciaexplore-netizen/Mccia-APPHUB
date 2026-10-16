import Link from "next/link";
import { desc } from "drizzle-orm";
import { Building2, ClipboardList, Network, ShieldCheck, Upload, Users } from "lucide-react";
import { db } from "@/db";
import { appChecks, apps } from "@/db/schema";
import { CountUp } from "@/components/CountUp";
import { listAudit } from "@/lib/audit";
import { formatIST } from "@/lib/format";
import { adminSummary } from "@/lib/people";
import { requireAdministrator } from "@/lib/permissions";

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

/** The administrator's home: real counts only, what needs attention, and the latest changes. Nothing here is estimated. */
export default async function Page() {
  await requireAdministrator();
  const [s, recent, latest, list] = await Promise.all([
    adminSummary(),
    listAudit({ page: 1 }, 8),
    db.selectDistinctOn([appChecks.appId], { appId: appChecks.appId, ok: appChecks.ok }).from(appChecks).orderBy(appChecks.appId, desc(appChecks.checkedAt)),
    db.select({ id: apps.id, url: apps.url }).from(apps),
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

  return (
    <div className="space-y-8">
      <section aria-label="People" className="space-y-3">
        <h2 className="text-xl">People</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card label="Total users" value={s.users.total} href="/administrator/users" />
          <Card label="Active users" value={s.users.active} href="/administrator/users?status=active" />
          <Card label="Pending invitations" value={s.users.pending} href="/administrator/users?status=pending" />
          <Card label="Inactive users" value={s.users.inactive} href="/administrator/users?status=inactive" />
        </div>
      </section>
      <section aria-label="Applications" className="space-y-3">
        <h2 className="text-xl">Applications</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Card label="Registered" value={s.apps.total} href="/administrator/inventory" />
          <Card label="Active" value={s.apps.live} href="/administrator/inventory" />
          <Card label="Under testing" value={s.apps.testing} href="/administrator/inventory" />
          <Card label="Unavailable" value={s.apps.unavailable} href="/administrator/inventory" tone="warn" />
          <Card label="Hidden from the hub" value={s.apps.hidden} href="/administrator/inventory" />
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
            <Link href="/administrator/users" className="btn btn-ghost btn-sm"><Users size={14} /> Users &amp; Access</Link>
            <Link href="/administrator/departments" className="btn btn-ghost btn-sm"><Building2 size={14} /> Departments</Link>
            <Link href="/administrator/users/org" className="btn btn-ghost btn-sm"><Network size={14} /> Branches &amp; teams ({s.branches} · {s.teams})</Link>
            <Link href="/administrator/inventory" className="btn btn-ghost btn-sm"><ClipboardList size={14} /> Application inventory</Link>
          </div>
        </section>
        <section className="glass !rounded-md space-y-3 p-5 sm:p-6" aria-label="Recent changes">
          <div className="flex items-center justify-between"><h2 className="text-xl">Recent changes</h2><Link href="/administrator/users/audit" className="text-sm text-primary hover:underline"><ShieldCheck size={14} className="mr-1 inline" />Audit log</Link></div>
          {recent.rows.length === 0 ? <p className="text-sm text-muted">No changes recorded yet.</p> : (
            <ul className="divide-y divide-line text-sm">{recent.rows.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2"><span><b>{r.actorName}</b> <span className="text-muted">{r.action}</span>{r.targetLabel && <> · {r.targetLabel}</>}</span><span className="text-xs text-muted">{formatIST(r.at)}</span></li>
            ))}</ul>
          )}
        </section>
      </div>
    </div>
  );
}
