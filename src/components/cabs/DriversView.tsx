"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { cabsApi } from "./api";
import type { VehicleOption } from "./AssignDialog";

export type DriverView = { id: string; name: string; email: string | null; phone: string; isAvailable: boolean; vehicleId: string | null; vehiclePlate: string | null; upcoming: number };
export type PersonOption = { id: string; name: string; email: string; phone: string | null };
type NewDriver = { name: string; email: string; phone: string; vehicleId: string };
const EMPTY: NewDriver = { name: "", email: "", phone: "", vehicleId: "" };

/** Fill in a driver's details from one of the hub's people, searching name or email (the same search as the App Admins picker). Optional. */
function PersonPicker({ people, excludeEmails, onPick }: { people: PersonOption[]; excludeEmails: Set<string>; onPick: (p: PersonOption) => void }) {
  const [q, setQ] = useState("");
  const t = q.trim().toLowerCase();
  const matches = t ? people.filter((p) => !excludeEmails.has(p.email.toLowerCase()) && `${p.name} ${p.email}`.toLowerCase().includes(t)).slice(0, 8) : [];
  return (
    <div>
      <input className="input" type="search" placeholder="Fill in from the hub's people (optional)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the hub's people" />
      {matches.length > 0 && (
        <ul className="mt-1 max-h-48 overflow-auto rounded-md border border-line">
          {matches.map((p) => <li key={p.id}><button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--c-primary)]/10" onClick={() => { onPick(p); setQ(""); }}><b>{p.name}</b> <span className="text-xs text-muted">{p.email}</span></button></li>)}
        </ul>
      )}
      {t && matches.length === 0 && <p className="mt-1 text-xs text-subtle">Nobody else matches.</p>}
    </div>
  );
}

/**
 * The drivers: add one (name and phone; an email only for a driver who will use the driver app; the hub's people can fill these in), give
 * them a vehicle, mark them available or not, remove them. A driver without the app is marked: a Cabs admin starts and completes their rides
 * on All Rides.
 */
export function DriversView({ drivers, people, vehicles }: { drivers: DriverView[]; people: PersonOption[]; vehicles: VehicleOption[] }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<NewDriver>(EMPTY);
  const already = useMemo(() => new Set(drivers.flatMap((d) => (d.email ? [d.email.toLowerCase()] : []))), [drivers]);
  const hubEmails = useMemo(() => new Set(people.map((p) => p.email.toLowerCase())), [people]);
  const run = (fn: () => Promise<unknown>, done: string, after?: () => void) => start(async () => {
    try { await fn(); toast.success(done); after?.(); router.refresh(); } catch (e) { toast.error((e as Error).message); }
  });
  const remove = async (d: DriverView) => {
    if (!(await confirm({ title: `Remove ${d.name}?`, message: "They will no longer be a driver. Their past rides keep their name.", confirmLabel: "Remove", danger: true }))) return;
    run(() => cabsApi(`/api/cabs/drivers/${d.id}`, "DELETE"), "Driver removed");
  };
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button className="btn btn-primary btn-sm" onClick={() => { setForm(EMPTY); setAdding(true); }}><Plus size={14} /> Add driver</button></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Name</th><th>Phone</th><th>Vehicle</th><th>Available</th><th className="text-right">Rides on</th><th className="text-right">Actions</th></tr></thead>
        <tbody>
          {drivers.map((d) => (
            <tr key={d.id} data-driver={d.id}>
              <td><b>{d.name}</b>{d.email && <span className="block text-xs text-muted">{d.email}</span>}
                {(!d.email || !hubEmails.has(d.email.toLowerCase())) && <span className="block text-xs text-[#b45309]" data-no-app>No driver app: an admin starts and completes their rides</span>}</td>
              <td className="whitespace-nowrap">{d.phone}</td>
              <td>
                <select className="input !w-auto" aria-label={`Vehicle for ${d.name}`} value={d.vehicleId ?? ""} disabled={pending}
                  onChange={(e) => run(() => cabsApi(`/api/cabs/drivers/${d.id}`, "PATCH", { vehicleId: e.target.value || null }), "Vehicle updated")}>
                  <option value="">No vehicle</option>
                  {d.vehicleId && !vehicles.some((v) => v.id === d.vehicleId) && <option value={d.vehicleId}>{d.vehiclePlate} (inactive)</option>}
                  {vehicles.map((v) => <option key={v.id} value={v.id}>{v.numberPlate} · {v.model}</option>)}
                </select>
              </td>
              <td>
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" checked={d.isAvailable} disabled={pending} aria-label={`${d.name} available`}
                    onChange={(e) => run(() => cabsApi(`/api/cabs/drivers/${d.id}/availability`, "POST", { available: e.target.checked }), e.target.checked ? "Marked available" : "Marked unavailable")} />
                  {d.isAvailable ? "Available" : <span className="text-subtle">Unavailable</span>}
                </label>
              </td>
              <td className="text-right">{d.upcoming}</td>
              <td><div className="flex justify-end"><button className="btn btn-ghost btn-sm text-brand-red" disabled={pending} onClick={() => remove(d)}><Trash2 size={14} /> Remove</button></div></td>
            </tr>
          ))}
          {drivers.length === 0 && <tr><td colSpan={6} className="text-subtle">No drivers yet.</td></tr>}
        </tbody>
      </table></div>
      {adding && (
        <Modal title="Add driver" onClose={() => setAdding(false)}>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => cabsApi("/api/cabs/drivers", "POST", { ...form, vehicleId: form.vehicleId || null }), `${form.name.trim()} added as a driver`, () => setAdding(false)); }}>
            <PersonPicker people={people} excludeEmails={already} onPick={(p) => setForm({ ...form, name: p.name, email: p.email, phone: p.phone ?? form.phone })} />
            <label className="block"><span className="label-xs mb-1.5 block">Name</span>
              <input className="input" name="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={100} required /></label>
            <label className="block"><span className="label-xs mb-1.5 block">Phone</span>
              <input className="input" name="phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} maxLength={20} required placeholder="98765 43210" /></label>
            <label className="block"><span className="label-xs mb-1.5 block">Email (optional)</span>
              <input className="input" name="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} maxLength={254} placeholder="Only for a driver who will use the driver app" /></label>
            <label className="block"><span className="label-xs mb-1.5 block">Vehicle (optional)</span>
              <select className="input" name="vehicleId" value={form.vehicleId} onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}>
                <option value="">No vehicle yet</option>
                {vehicles.map((v) => <option key={v.id} value={v.id}>{v.numberPlate} · {v.model}</option>)}
              </select></label>
            <p className="text-xs text-muted">With an email, the driver can use the driver app: they sign in to the hub with that email and need the Cabs Driver application there. Without one, you start and complete their rides on All Rides.</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>Close</button>
              <button className="btn btn-primary btn-sm" disabled={pending}>Add driver</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
