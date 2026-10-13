"use client";

import { useState } from "react";
import { api, useAction } from "@/components/approvals/api";
import { SearchBox } from "@/components/approvals/ui";
import type { RoleRow } from "@/lib/approvals/roles";

function Switch({ on, locked, label, onChange }: { on: boolean; locked?: boolean; label: string; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button" role="switch" aria-checked={on} aria-label={label} disabled={locked} onClick={() => onChange(!on)}
      className={`relative h-6 w-11 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${on ? "bg-brand-green-text" : "bg-line"}`}
    >
      <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : ""}`} />
    </button>
  );
}

/** Who may oversee requests (viewer) or manage the module (Approvals admin). Approver and DG are not set here: they follow the routing rules. */
export function AccessManager({ rows }: { rows: RoleRow[] }) {
  const { run, pending } = useAction();
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => !needle || r.name.toLowerCase().includes(needle) || r.email.toLowerCase().includes(needle));
  const set = (r: RoleRow, role: "viewer" | "approvals_admin", granted: boolean) =>
    run(() => api("PUT", "/api/approvals/roles", { userId: r.userId, role, granted }), granted ? "Access granted" : "Access removed");

  return (
    <div className="space-y-5">
      <SearchBox value={q} onChange={setQ} placeholder="Search people" />
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Person</th><th>Approvals admin</th><th>Viewer</th><th>Approver</th><th>DG</th></tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-sm text-subtle">No one matches.</td></tr>}
            {shown.map((r) => {
              const admin = r.headAdmin || r.admin;
              return (
                <tr key={r.userId}>
                  <td><span className="font-medium">{r.name}</span><span className="block text-xs text-subtle">{r.email}</span></td>
                  <td>
                    {r.headAdmin
                      ? <span className="badge">Head admin</span>
                      : <Switch on={r.admin} locked={pending} label={`${r.name} is an Approvals admin`} onChange={(v) => set(r, "approvals_admin", v)} />}
                  </td>
                  <td>
                    {admin
                      ? <span className="badge badge-neutral">Included</span>
                      : <Switch on={r.viewer} locked={pending} label={`${r.name} is a viewer`} onChange={(v) => set(r, "viewer", v)} />}
                  </td>
                  <td>{r.approver ? <span className="badge badge-green">Step 1</span> : <span className="text-subtle">-</span>}</td>
                  <td>{r.dg ? <span className="badge badge-green">Final step</span> : <span className="text-subtle">-</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
