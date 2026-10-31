"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { cabsApi } from "./api";

export type DriverView = { id: string; name: string; email: string | null; phone: string; isAvailable: boolean; upcoming: number };
export type PersonOption = { id: string; name: string; email: string; phone: string | null };
type NewDriver = { name: string; email: string; phone: string };
const EMPTY: NewDriver = { name: "", email: "", phone: "" };
type LoginOtp = { driverId: string; name: string; otp: string; expiresAt: string };

/** "5:30 PM" in India time. */
const istTime = (iso: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso)).toUpperCase();

/** The code just made, to read out or send to the driver: shown once, in large digits, with a Copy button. */
function LoginOtpDialog({ code, pending, onAgain, onClose }: { code: LoginOtp; pending: boolean; onAgain: () => void; onClose: () => void }) {
  const toast = useToast();
  const copy = async () => {
    try { await navigator.clipboard.writeText(code.otp); toast.success("OTP copied"); } catch { toast.error("Couldn't copy. Read the digits out instead."); }
  };
  return (
    <Modal title="Driver login OTP" onClose={onClose}>
      <div className="space-y-4" data-login-otp>
        <p className="text-sm text-muted">Share with <b className="text-ink">{code.name}</b>:</p>
        <div className="flex items-center gap-3">
          <span className="font-mono text-4xl font-extrabold tracking-[0.3em] text-ink" data-otp-digits>{code.otp}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={copy}><Copy size={14} /> Copy</button>
        </div>
        <p className="text-sm text-muted" data-otp-valid>Valid for 24 hours (until {istTime(code.expiresAt)} tomorrow). It works once; making a new one cancels this one.</p>
        <p className="text-xs text-muted">The driver opens <b>/cabs/driver-login</b>, enters their phone number and this OTP. Only you see these digits: they are not saved.</p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={onAgain}>New OTP</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>Done</button>
        </div>
      </div>
    </Modal>
  );
}

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
 * The drivers: add one (name and phone; optionally an email; the hub's people can fill these in), mark them available or not, make their
 * sign-in code for Cabs Driver ("Get Login OTP"), remove them. Drivers have no car of their own: the car is chosen for each ride.
 */
export function DriversView({ drivers, people }: { drivers: DriverView[]; people: PersonOption[] }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<NewDriver>(EMPTY);
  const [code, setCode] = useState<LoginOtp | null>(null);
  const already = useMemo(() => new Set(drivers.flatMap((d) => (d.email ? [d.email.toLowerCase()] : []))), [drivers]);
  const run = (fn: () => Promise<unknown>, done: string, after?: () => void) => start(async () => {
    try { await fn(); toast.success(done); after?.(); router.refresh(); } catch (e) { toast.error((e as Error).message); }
  });
  const loginOtp = (d: Pick<DriverView, "id" | "name">) => start(async () => {
    try {
      const r = await cabsApi<{ otp: string; expires_at: string; name: string }>(`/api/cabs/drivers/${d.id}/otp`, "POST");
      setCode({ driverId: d.id, name: r.name, otp: r.otp, expiresAt: r.expires_at });
    } catch (e) { toast.error((e as Error).message); }
  });
  const remove = async (d: DriverView) => {
    if (!(await confirm({ title: `Remove ${d.name}?`, message: "They will no longer be a driver. Their past rides keep their name.", confirmLabel: "Remove", danger: true }))) return;
    run(() => cabsApi(`/api/cabs/drivers/${d.id}`, "DELETE"), "Driver removed");
  };
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button className="btn btn-primary btn-sm" onClick={() => { setForm(EMPTY); setAdding(true); }}><Plus size={14} /> Add driver</button></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Name</th><th>Phone</th><th>Availability</th><th className="text-right">Rides on</th><th className="text-right">Actions</th></tr></thead>
        <tbody>
          {drivers.map((d) => (
            <tr key={d.id} data-driver={d.id}>
              <td><b>{d.name}</b>{d.email && <span className="block text-xs text-muted">{d.email}</span>}</td>
              <td className="whitespace-nowrap">{d.phone}</td>
              <td>
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" checked={d.isAvailable} disabled={pending} aria-label={`${d.name} available`}
                    onChange={(e) => run(() => cabsApi(`/api/cabs/drivers/${d.id}/availability`, "POST", { available: e.target.checked }), e.target.checked ? "Marked available" : "Marked unavailable")} />
                  {d.isAvailable ? "Available" : <span className="text-subtle">Unavailable</span>}
                </label>
              </td>
              <td className="text-right">{d.upcoming}</td>
              <td><div className="flex justify-end gap-1">
                <button className="btn btn-ghost btn-sm" disabled={pending} onClick={() => loginOtp(d)} data-get-otp><KeyRound size={14} /> Get Login OTP</button>
                <button className="btn btn-ghost btn-sm text-brand-red" disabled={pending} onClick={() => remove(d)}><Trash2 size={14} /> Remove</button>
              </div></td>
            </tr>
          ))}
          {drivers.length === 0 && <tr><td colSpan={5} className="text-subtle">No drivers yet.</td></tr>}
        </tbody>
      </table></div>
      {code && <LoginOtpDialog code={code} pending={pending} onAgain={() => loginOtp({ id: code.driverId, name: code.name })} onClose={() => setCode(null)} />}
      {adding && (
        <Modal title="Add driver" onClose={() => setAdding(false)}>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => cabsApi("/api/cabs/drivers", "POST", form), `${form.name.trim()} added as a driver`, () => setAdding(false)); }}>
            <PersonPicker people={people} excludeEmails={already} onPick={(p) => setForm({ ...form, name: p.name, email: p.email, phone: p.phone ?? form.phone })} />
            <label className="block"><span className="label-xs mb-1.5 block">Name</span>
              <input className="input" name="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={100} required /></label>
            <label className="block"><span className="label-xs mb-1.5 block">Phone</span>
              <input className="input" name="phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} maxLength={20} required placeholder="98765 43210" /></label>
            <label className="block"><span className="label-xs mb-1.5 block">Email (optional)</span>
              <input className="input" name="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} maxLength={254} placeholder="Only if they sign in to the hub" /></label>
            <p className="text-xs text-muted">The driver signs in to the driver app with this phone number and a login OTP you give them (Get Login OTP). The email is only for a driver who also signs in to the hub. The car is chosen for each ride when you assign it.</p>
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
