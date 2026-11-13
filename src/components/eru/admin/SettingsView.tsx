"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import type { Domain } from "@/db/eru-schema";
import { checkStorageAction, deleteAllAction, saveGeneralAction, updateDomainAction } from "@/lib/eru/actions/admin";
import { colorOf, DOMAIN_COLORS, DOMAIN_ICONS } from "@/lib/eru/eru.manifest";
import { Card, DomainIcon } from "../ui";
import { useAct } from "../use-act";

/** Settings: each domain's name, description, colour, icon, order and whether it shows; general settings; storage check; delete all (Support Admin). */
export function SettingsView({ domains, trackChangesDefault, superAdmin }: { domains: Domain[]; trackChangesDefault: boolean; superAdmin: boolean }) {
  return (
    <div className="flex flex-col gap-6">
      <Card title="Domains" pad={false}>
        <ul className="divide-y divide-[var(--eru-line)]">
          {domains.map((d) => (
            <DomainRow key={d.id} d={d} />
          ))}
        </ul>
      </Card>
      <General trackChangesDefault={trackChangesDefault} />
      {superAdmin && <DeleteAll />}
    </div>
  );
}

function DomainRow({ d }: { d: Domain }) {
  const { act, pending } = useAct();
  const [color, setColor] = useState(d.color);
  const [icon, setIcon] = useState(d.icon);
  const c = colorOf(color);
  return (
    <li className="px-5 py-4">
      <form
        className="grid gap-3 md:grid-cols-[auto_minmax(0,1fr)]"
        action={async (f) => {
          await act(() =>
            updateDomainAction(d.id, {
              name: String(f.get("name") ?? ""),
              description: String(f.get("description") ?? ""),
              color,
              icon,
              sortOrder: Number(f.get("sortOrder") ?? 0),
              isActive: f.get("isActive") === "on",
            }),
          );
        }}
      >
        <span className="grid h-12 w-12 place-items-center rounded-xl" style={{ background: c.tint, color: c.text }} aria-hidden>
          <DomainIcon icon={icon} />
        </span>
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_6rem]">
            <label className="flex flex-col gap-1 text-xs font-semibold eru-muted">
              Name <span className="font-mono text-[0.65rem]">{d.key}</span>
              <input name="name" className="input" defaultValue={d.name} maxLength={80} required />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold eru-muted">
              Order
              <input name="sortOrder" type="number" min={0} max={999} className="input" defaultValue={d.sortOrder} />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs font-semibold eru-muted">
            Description
            <textarea name="description" className="input" rows={2} defaultValue={d.description} maxLength={400} />
          </label>
          <div className="flex flex-wrap items-center gap-4">
            <fieldset className="flex flex-wrap items-center gap-1.5">
              <legend className="sr-only">Colour</legend>
              {DOMAIN_COLORS.map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-label={k}
                  aria-pressed={color === k}
                  className={`h-6 w-6 rounded-full border-2 ${color === k ? "border-ink" : "border-white"}`}
                  style={{ background: colorOf(k).accent, boxShadow: "0 0 0 1px #e5e7eb" }}
                  onClick={() => setColor(k)}
                />
              ))}
            </fieldset>
            <label className="flex items-center gap-2 text-xs font-semibold eru-muted">
              Icon
              <select className="input py-1 text-sm" value={icon} onChange={(e) => setIcon(e.target.value)}>
                {DOMAIN_ICONS.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="isActive" defaultChecked={d.isActive} /> Shown in the workspace
            </label>
            <button type="submit" className="btn eru-btn-navy btn-sm ml-auto" disabled={pending}>
              Save
            </button>
          </div>
        </div>
      </form>
    </li>
  );
}

function General({ trackChangesDefault }: { trackChangesDefault: boolean }) {
  const { act, pending } = useAct();
  const [storage, setStorage] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <Card title="General">
      <div className="flex flex-col gap-5">
        <form className="flex flex-wrap items-center gap-3" action={async (f) => {
            await act(() => saveGeneralAction({ trackChangesDefault: f.get("track") === "on" }));
          }}>
          <label className="flex flex-1 items-start gap-2 text-sm text-ink">
            <input type="checkbox" name="track" defaultChecked={trackChangesDefault} className="mt-1" />
            <span>
              New documents start with track changes on
              <span className="block text-xs eru-muted">Every edit to a new document is then tracked for review from the start. Only an ERU admin can switch it off.</span>
            </span>
          </label>
          <button type="submit" className="btn eru-btn-navy btn-sm" disabled={pending}>
            Save
          </button>
        </form>
        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--eru-line)] pt-4">
          <span className="flex-1 text-sm text-ink">
            File storage (Supabase bucket <span className="font-mono">eru-files</span>)
            {storage && <span className={`block text-xs ${storage.ok ? "text-[#15803d]" : "text-[var(--eru-red)]"}`}>{storage.message}</span>}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={pending}
            onClick={async () => {
              const r = await act(() => checkStorageAction(), { quiet: true, noRefresh: true });
              if (r.ok) setStorage(r.data);
            }}
          >
            Check storage
          </button>
        </div>
      </div>
    </Card>
  );
}

function DeleteAll() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const router = useRouter();
  return (
    <Card title="Delete all ERU data">
      <p className="text-sm eru-muted">Deletes every project, document, comment, tracked change, file and history line. The five domains and the team stay. This cannot be undone.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input className="input min-w-[16rem] flex-1" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type DELETE ALL ERU DATA" aria-label="Confirmation" />
        <button
          type="button"
          className="btn eru-btn-red"
          disabled={busy || text !== "DELETE ALL ERU DATA"}
          onClick={async () => {
            setBusy(true);
            const r = await deleteAllAction(text);
            setBusy(false);
            if (!r.ok) return toast.error(r.error);
            toast.success(`Deleted ${r.data.projects} project${r.data.projects === 1 ? "" : "s"} and everything in them.`);
            setText("");
            router.refresh();
          }}
        >
          Delete everything
        </button>
      </div>
    </Card>
  );
}
