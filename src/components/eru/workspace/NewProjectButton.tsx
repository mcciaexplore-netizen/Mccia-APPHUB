"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { createProjectAction } from "@/lib/eru/actions/workspace";
import { PRIORITIES, PRIORITY_LABEL } from "@/lib/eru/eru.manifest";

type Option = { id: string; name: string };

/** "New Project": a short form in a dialog. The new project opens once it is made. Admins may also assign people from the team. */
export function NewProjectButton({ domains, domainId, team, admin }: { domains: (Option & { key: string })[]; domainId?: string; team: Option[]; admin: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [assigned, setAssigned] = useState<string[]>([]);
  const router = useRouter();
  const toast = useToast();

  async function submit(form: FormData) {
    setBusy(true);
    const r = await createProjectAction({
      title: String(form.get("title") ?? ""),
      description: String(form.get("description") ?? ""),
      domainId: String(form.get("domainId") ?? ""),
      priority: String(form.get("priority") ?? "normal"),
      status: form.get("draft") ? "draft" : "active",
      dueDate: String(form.get("dueDate") ?? "") || null,
      tags: String(form.get("tags") ?? "").split(","),
      referenceLinks: String(form.get("links") ?? "").split(/\s+/),
      assignedTo: assigned,
    });
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(`${r.data.number} created`);
    setOpen(false);
    router.push(`/eru/projects/${r.data.id}`);
  }

  return (
    <>
      <button type="button" className="btn eru-btn-navy" onClick={() => setOpen(true)}>
        <Plus size={16} aria-hidden /> New Project
      </button>
      {open && (
        <Modal title="New project" onClose={() => setOpen(false)}>
          <form action={submit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
              Title
              <input name="title" required minLength={3} maxLength={200} className="input" placeholder="e.g. Pune MSME credit survey 2026" autoFocus />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
              Domain
              <select name="domainId" className="input" defaultValue={domainId ?? domains[0]?.id} required>
                {domains.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
              Description
              <textarea name="description" rows={4} maxLength={10000} className="input" placeholder="What the project is for, scope, deliverables" />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
                Priority
                <select name="priority" className="input" defaultValue="normal">
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABEL[p]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
                Due date
                <input name="dueDate" type="date" className="input" />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
              Tags <span className="text-xs font-normal eru-muted">separated by commas</span>
              <input name="tags" className="input" placeholder="MSME, credit, survey" />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
              Reference links <span className="text-xs font-normal eru-muted">one per line, starting with https://</span>
              <textarea name="links" rows={2} className="input" placeholder="https://" />
            </label>
            {admin && team.length > 0 && (
              <fieldset className="flex flex-col gap-1">
                <legend className="text-sm font-semibold text-ink">Assign to (you are assigned anyway)</legend>
                <div className="flex max-h-36 flex-col gap-1 overflow-y-auto rounded-lg border border-[var(--eru-line)] p-2">
                  {team.map((t) => (
                    <label key={t.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={assigned.includes(t.id)} onChange={(e) => setAssigned((a) => (e.target.checked ? [...a, t.id] : a.filter((x) => x !== t.id)))} />
                      {t.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="draft" /> Save as a draft (not active yet)
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn eru-btn-navy" disabled={busy}>
                {busy ? "Creating…" : "Create project"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
