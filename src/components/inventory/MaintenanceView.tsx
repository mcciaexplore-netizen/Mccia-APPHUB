"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ImageIcon, Plus, Wrench } from "lucide-react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { formatIST } from "@/lib/format";
import { MAX_PHOTO_BYTES, PHOTO_TYPES } from "@/lib/inventory/photos";
import { inventoryApi } from "./api";

export type TicketView = {
  id: string; title: string; note: string | null; location: string | null; status: Status; hasPhoto: boolean; raisedByName: string; raisedAt: string;
  resolvedByName: string | null; resolvedAt: string | null; resolutionNote: string | null; hasResolutionPhoto: boolean;
};
type Status = "open" | "in_progress" | "resolved";

const BADGE: Record<Status, { label: string; cls: string }> = {
  open: { label: "Open", cls: "badge badge-red" },
  in_progress: { label: "In progress", cls: "badge badge-purple" },
  resolved: { label: "Resolved", cls: "badge badge-green" },
};

/** A chosen file as a data URL, after the same checks the server makes (JPEG or PNG, at most 2 MB). */
async function readPhoto(file: File): Promise<string> {
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) throw new Error("Only JPEG or PNG photos can be attached.");
  if (file.size > MAX_PHOTO_BYTES) throw new Error("The photo is larger than 2 MB. Choose a smaller one.");
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("The photo could not be read."));
    r.readAsDataURL(file);
  });
}

function PhotoField({ label, onChange }: { label: string; onChange: (dataUrl: string) => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  return (
    <label className="block"><span className="label-xs mb-1.5 block">{label}</span>
      <input type="file" accept="image/jpeg,image/png" className="input !py-1.5" aria-label={label}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) { onChange(""); setName(""); return; }
          try { onChange(await readPhoto(f)); setName(f.name); } catch (err) { e.target.value = ""; onChange(""); setName(""); toast.error((err as Error).message); }
        }} />
      <span className="mt-1 block text-xs text-subtle">{name ? `Attached: ${name}` : "Optional. JPEG or PNG, at most 2 MB."}</span>
    </label>
  );
}

const photoUrl = (id: string, which: "report" | "resolution") => `/api/inventory/maintenance/${id}/photo?which=${which}`;

/** Maintenance tickets. Everyone reports problems and follows their own; store staff see all of them and resolve them. */
export function MaintenanceView({ rows, canManage, status, counts }: { rows: TicketView[]; canManage: boolean; status: Status | ""; counts?: Record<Status, number> }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [raising, setRaising] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", location: "", photo: "" });
  const [updating, setUpdating] = useState<TicketView | null>(null);
  const [upd, setUpd] = useState({ status: "open" as Status, resolutionNote: "", resolutionPhoto: "" });

  const run = (fn: () => Promise<unknown>, done: string, after?: () => void) => start(async () => {
    try { await fn(); toast.success(done); after?.(); router.refresh(); } catch (e) { toast.error((e as Error).message); }
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">{canManage ? "Maintenance" : "My maintenance tickets"}</h1>
          <p className="text-sm text-muted">{canManage ? "Problems people have reported. Move each one on and record how it was fixed." : "Report something broken, with a photo, and see when it is fixed."}</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => { setForm({ title: "", description: "", location: "", photo: "" }); setRaising(true); }}><Plus size={14} /> Report a problem</button>
      </div>

      {canManage && counts && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Show tickets">
          {(["", "open", "in_progress", "resolved"] as const).map((s) => (
            <button key={s || "all"} role="tab" aria-selected={status === s} onClick={() => router.replace(`/inventory/maintenance${s ? `?status=${s}` : ""}`)}
              className={`chip ${status === s ? "!border-[#2a6b7c] !bg-[#f0f7f9] text-primary" : "text-muted"}`}>
              {s ? BADGE[s].label : "All"}{s && <span className="ml-1.5 font-semibold">{counts[s]}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {rows.map((r) => (
          <article key={r.id} className="glass !rounded-md space-y-3 p-5" aria-label={r.title}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="flex flex-wrap items-center gap-2 text-lg"><Wrench size={16} className="text-primary" />{r.title}<span className={BADGE[r.status].cls}>{BADGE[r.status].label}</span></h2>
                <p className="text-xs text-muted">{r.location ? `${r.location} · ` : ""}{canManage ? `${r.raisedByName} · ` : ""}{formatIST(r.raisedAt)}</p>
              </div>
              {canManage && <button className="btn btn-ghost btn-sm" disabled={pending} aria-label={`Update ${r.title}`}
                onClick={() => { setUpd({ status: r.status, resolutionNote: r.resolutionNote ?? "", resolutionPhoto: "" }); setUpdating(r); }}>Update</button>}
            </div>
            {r.note && <p className="whitespace-pre-line text-sm">{r.note}</p>}
            {r.hasPhoto && <a href={photoUrl(r.id, "report")} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"><ImageIcon size={14} /> Photo of the problem</a>}
            {(r.resolutionNote || r.hasResolutionPhoto || r.status === "resolved") && (
              <div className="rounded-md border border-line bg-alt p-3 text-sm">
                <p className="label-xs">{r.status === "resolved" ? `Resolved${r.resolvedByName ? ` by ${r.resolvedByName}` : ""}${r.resolvedAt ? ` · ${formatIST(r.resolvedAt)}` : ""}` : "Work note"}</p>
                {r.resolutionNote && <p className="mt-1 whitespace-pre-line">{r.resolutionNote}</p>}
                {r.hasResolutionPhoto && <a href={photoUrl(r.id, "resolution")} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1.5 text-primary hover:underline"><ImageIcon size={14} /> Photo after the fix</a>}
              </div>
            )}
          </article>
        ))}
        {rows.length === 0 && <p className="text-sm text-subtle">{status ? "No tickets with this status." : canManage ? "No problems reported yet." : "You haven't reported anything yet."}</p>}
      </div>

      {raising && (
        <Modal title="Report a problem" onClose={() => setRaising(false)}>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => inventoryApi("/api/inventory/maintenance", "POST", form), "Problem reported", () => setRaising(false)); }}>
            <label className="block"><span className="label-xs mb-1.5 block">What is wrong</span>
              <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={120} required autoFocus placeholder="e.g. Projector in Hall 2 not turning on" /></label>
            <label className="block"><span className="label-xs mb-1.5 block">Where</span>
              <input className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} maxLength={120} placeholder="Room, floor, building" /></label>
            <label className="block"><span className="label-xs mb-1.5 block">Details (optional)</span>
              <textarea className="input min-h-20" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={2000} /></label>
            <PhotoField label="Photo" onChange={(photo) => setForm((f) => ({ ...f, photo }))} />
            <button className="btn btn-primary btn-sm" disabled={pending}>Send report</button>
          </form>
        </Modal>
      )}
      {updating && (
        <Modal title={`Update: ${updating.title}`} onClose={() => setUpdating(null)}>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => inventoryApi(`/api/inventory/maintenance/${updating.id}`, "PATCH", upd), upd.status === "resolved" ? "Ticket resolved" : "Ticket updated", () => setUpdating(null)); }}>
            <label className="block"><span className="label-xs mb-1.5 block">Status</span>
              <select className="input" value={upd.status} onChange={(e) => setUpd({ ...upd, status: e.target.value as Status })}>
                <option value="open">Open</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option>
              </select></label>
            <label className="block"><span className="label-xs mb-1.5 block">Resolution note</span>
              <textarea className="input min-h-20" value={upd.resolutionNote} onChange={(e) => setUpd({ ...upd, resolutionNote: e.target.value })} maxLength={2000} placeholder="What was done" /></label>
            <PhotoField label={updating.hasResolutionPhoto ? "Replace the photo after the fix" : "Photo after the fix"} onChange={(resolutionPhoto) => setUpd((u) => ({ ...u, resolutionPhoto }))} />
            <button className="btn btn-primary btn-sm" disabled={pending}>Save</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
