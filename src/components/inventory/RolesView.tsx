"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useConfirm } from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toast";
import type { GrantedRole } from "@/lib/inventory/inventory.manifest";
import { inventoryApi } from "./api";

type Row = { userId: string; name: string; email: string; supportAdmin: boolean; role: GrantedRole | null };
type Choice = GrantedRole | "none";

const CHOICE_LABEL: Record<Choice, string> = { inventory_admin: "Admin", inventory_staff: "Staff", none: "None" };

/**
 * Who runs the store. Admin: everything, including this screen. Staff: items, stock, requests and purchases. None: they can still look
 * at the catalogue and ask for items, like everyone signed in to the hub. Same idea as the Approval System's access screen.
 */
export function RolesView({ rows, meId }: { rows: Row[]; meId: string }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  const [only, setOnly] = useState(false);
  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => (!needle || `${r.name} ${r.email}`.toLowerCase().includes(needle)) && (!only || r.role));
  const counts = { admin: rows.filter((r) => r.role === "inventory_admin").length, staff: rows.filter((r) => r.role === "inventory_staff").length };

  // Asked before the transition starts: a dialog opened inside one never shows.
  const change = async (r: Row, choice: Choice) => {
    const role = choice === "none" ? null : choice;
    if (role === r.role) return;
    if (r.role === "inventory_admin" && !(await confirm({ title: "Remove admin role?", confirmLabel: "Remove", danger: true,
      message: `${r.name} will no longer be able to change items, categories or who runs the store.${role ? ` They will be ${CHOICE_LABEL[role]}.` : ""}` }))) return;
    start(async () => {
      try {
        await inventoryApi("/api/inventory/roles", "PUT", { userId: r.userId, role });
        toast.success(role ? `${r.name} is now ${CHOICE_LABEL[role]}` : `${r.name} has no Inventory role now`);
        router.refresh();
      } catch (e) { toast.error((e as Error).message); }
    });
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl">Settings</h1>
        <p className="text-sm text-muted">Who runs the store. <b>Admin</b>: everything, including this screen. <b>Staff</b>: items, stock, requests and purchases. <b>None</b>: they can still browse the catalogue and ask for items, like everyone in the hub.</p>
        <p className="mt-1 text-sm text-muted">{counts.admin} admin{counts.admin === 1 ? "" : "s"} · {counts.staff} staff · every change is recorded in the Activity Log.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <input className="input !w-full sm:!w-64" placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
        <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" className="h-4 w-4" checked={only} onChange={(e) => setOnly(e.target.checked)} /> Only people with a role</label>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>Person</th><th className="w-48">Inventory role</th></tr></thead>
        <tbody>
          {shown.map((r) => {
            const self = r.userId === meId;
            return (
              <tr key={r.userId}>
                <td><b>{r.name}</b>{self && <span className="badge badge-neutral ml-2">You</span>}<span className="block text-xs text-muted">{r.email}</span></td>
                <td>{r.supportAdmin ? <span className="badge" title="The Support Admin is always an Inventory admin">Admin (Support Admin)</span> : (
                  <select className="input !h-9 !py-0" aria-label={`Inventory role of ${r.name}`} value={r.role ?? "none"} disabled={pending}
                    onChange={(e) => change(r, e.target.value as Choice)}>
                    {(["inventory_admin", "inventory_staff", "none"] as Choice[]).map((c) => (
                      // Nobody removes their own admin role: an admin sees only Admin for themselves.
                      <option key={c} value={c} disabled={self && r.role === "inventory_admin" && c !== "inventory_admin"}>{CHOICE_LABEL[c]}</option>
                    ))}
                  </select>
                )}</td>
              </tr>
            );
          })}
          {shown.length === 0 && <tr><td colSpan={2} className="text-subtle">No one matches.</td></tr>}
        </tbody>
      </table></div>
    </div>
  );
}
