"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Download, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { checkApp, checkAllApps, createApp, deleteApp, setAppStatus } from "@/actions/apps";
import { AppForm } from "../departments/forms";
import { toCsv } from "@/lib/csv";
import { formatIST } from "@/lib/format";

type Check = { ok: boolean; detail: string; httpStatus: number | null; durationMs: number | null; at: string };
type Row = { id: string; name: string; description: string | null; url: string; department: string; status: "active" | "testing" | "unavailable"; visible: boolean; builtIn: boolean; people: number; check: Check | null };

const DAY = 86400000;
/** "Link verified" only when the newest check passed and is recent. It never claims the application's own features were tested. */
function verification(r: Row): { label: string; cls: string } {
  if (r.builtIn) return { label: "Built into the hub", cls: "badge badge-neutral" };
  if (!r.check) return { label: "Not checked", cls: "badge badge-neutral" };
  if (!r.check.ok) return { label: "Check failed", cls: "badge badge-red" };
  return Date.now() - new Date(r.check.at).getTime() > 30 * DAY ? { label: "Check is out of date", cls: "badge badge-purple" } : { label: "Link verified", cls: "badge badge-green" };
}

/** Every application the hub lists: what it is, where it points, who can open it, and the result of the last real check. */
export function InventoryView({ rows, departments }: { rows: Row[]; departments: { id: string; name: string }[] }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  const counts = {
    total: rows.length, verified: rows.filter((r) => verification(r).label === "Link verified").length,
    failed: rows.filter((r) => r.check && !r.check.ok).length, unchecked: rows.filter((r) => !r.builtIn && !r.check).length,
    testing: rows.filter((r) => r.status === "testing").length, unavailable: rows.filter((r) => r.status === "unavailable").length,
  };

  const one = (id: string) => start(async () => {
    setBusyId(id);
    const r = await checkApp(id);
    setBusyId(null);
    if (!r.ok) return toast.error(r.error);
    (r.data.ok ? toast.success : toast.error)(`${r.data.name}: ${r.data.detail}`);
    router.refresh();
  });
  const all = () => start(async () => {
    const r = await checkAllApps();
    if (!r.ok) return toast.error(r.error);
    toast.success(`Checked ${r.data.length}: ${r.data.filter((x) => x.ok).length} passed, ${r.data.filter((x) => !x.ok).length} failed.`);
    router.refresh();
  });
  const exportCsv = () => {
    const text = toCsv([
      ["Application", "Identifier", "Department", "Description", "Address", "Status", "Shown in hub", "People with access", "Sign-in", "Link check", "Check detail", "Checked at"],
      ...rows.map((r) => [r.name, r.id, r.department, r.description ?? "", r.url, r.status, r.visible ? "yes" : "no", r.people, r.builtIn ? "Hub sign-in" : "Hub sign-in to launch; the application's own sign-in is separate", verification(r).label, r.check?.detail ?? "", r.check ? formatIST(r.check.at) : ""]),
    ]);
    const url = URL.createObjectURL(new Blob([`﻿${text}`], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "application-inventory.csv"; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted">
          Every application in the hub. <b>Link verified</b> means its address answered over a secure connection in the last 30 days. It does not mean the application&apos;s own features were tested:
          the hub controls who can launch an application, while the application itself controls what happens after.
        </p>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary btn-sm" disabled={pending} onClick={() => setAdding(true)}><Plus size={14} /> Add application</button>
          <button className="btn btn-ghost btn-sm" disabled={pending} onClick={all}><RefreshCw size={14} className={pending && !busyId ? "animate-spin" : ""} /> Check all</button>
          <button className="btn btn-ghost btn-sm" onClick={exportCsv}><Download size={14} /> Export CSV</button>
        </div>
      </div>
      <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm" aria-live="polite">
        <span><b>{counts.total}</b> applications</span><span><b>{counts.verified}</b> link verified</span><span><b>{counts.failed}</b> check failed</span>
        <span><b>{counts.unchecked}</b> not checked</span><span><b>{counts.testing}</b> under testing</span><span><b>{counts.unavailable}</b> unavailable</span>
      </p>
      <div className="table-wrap"><table>
        <thead><tr><th>Application</th><th>Department</th><th>Address</th><th>Label</th><th>Who can open it</th><th>Last check</th><th className="text-right">Actions</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const v = verification(r);
            return (
              <tr key={r.id} className={r.visible ? "" : "opacity-60"}>
                <td><b>{r.name}</b>{!r.visible && <span className="badge badge-red ml-2">Hidden</span>}
                  {r.description && <span className="block text-xs text-muted">{r.description}</span>}
                  <span className="block font-mono text-[0.65rem] text-subtle" title="Application identifier">{r.id}</span></td>
                <td>{r.department}</td>
                <td className="max-w-[14rem] truncate text-xs text-muted" title={r.url}>{r.url}</td>
                <td>
                  <select className="input !w-auto !py-1 text-xs" value={r.status} disabled={pending} aria-label={`Label for ${r.name}`}
                    onChange={(e) => start(async () => { const x = await setAppStatus(r.id, e.target.value as Row["status"]); if (x.ok) { toast.success("Label saved"); router.refresh(); } else toast.error(x.error); })}>
                    <option value="active">Active</option><option value="testing">Under testing</option><option value="unavailable">Unavailable</option>
                  </select></td>
                <td className="text-xs"><b>{r.people}</b> {r.people === 1 ? "person" : "people"} assigned, plus the Support Admin and Super Admin<span className="block text-muted">Hub sign-in required</span></td>
                <td className="text-xs"><span className={v.cls}>{v.label}</span>
                  {r.check && <span className="mt-1 block text-muted">{r.check.detail} {r.check.durationMs != null && `(${r.check.durationMs} ms)`}<span className="block text-subtle">{formatIST(r.check.at)}</span></span>}</td>
                <td><div className="flex justify-end gap-1.5">
                  {!r.builtIn && <button className="chip !p-1.5 text-muted" aria-label={`Check ${r.name}`} title="Check the address now" disabled={pending} onClick={() => one(r.id)}><RefreshCw size={14} className={busyId === r.id ? "animate-spin" : ""} /></button>}
                  <Link className="chip !p-1.5 text-muted" aria-label={`Who can open ${r.name}`} title="Who can open it" href={`/administrator/access/app/${r.id}`}><ShieldCheck size={14} /></Link>
                  <button className="chip !p-1.5 text-brand-red" aria-label={`Delete ${r.name}`} title="Delete" disabled={pending}
                    onClick={async () => {
                      if (!(await confirm({ title: "Delete this application?", confirmLabel: "Delete", danger: true,
                        message: `“${r.name}” will be removed for good. ${r.people === 0 ? "Nobody has been given it, so nobody loses access." : `${r.people} ${r.people === 1 ? "person loses" : "people lose"} access to it straight away.`} Any access template drops it. Launches already logged stay in the activity log as a deleted application. To keep it but stop people opening it, set its label to Unavailable instead.` }))) return;
                      start(async () => { const x = await deleteApp(r.id); if (x.ok) { toast.success("Application deleted"); router.refresh(); } else toast.error(x.error); });
                    }}><Trash2 size={14} /></button>
                </div></td>
              </tr>
            );
          })}
          {rows.length === 0 && <tr><td colSpan={7} className="text-subtle">No applications yet. Add some under Departments.</td></tr>}
        </tbody>
      </table></div>
      {adding && (
        <Modal title="Add application" onClose={() => setAdding(false)}>
          <AppForm departments={departments} initial={{ departmentId: departments[0]?.id }} submitLabel="Add application" pending={pending}
            onSubmit={(v) => start(async () => { const x = await createApp(v); if (x.ok) { toast.success("Application added"); setAdding(false); router.refresh(); } else toast.error(x.error); })} />
        </Modal>
      )}
    </div>
  );
}
