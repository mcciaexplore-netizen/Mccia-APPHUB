"use client";

import { useState } from "react";
import { GitMerge, Pencil } from "lucide-react";
import { Modal } from "@/components/Modal";
import { api, useAction } from "@/components/approvals/api";
import { ActiveToggle, Field, SearchBox } from "@/components/approvals/shared-ui";
import type { MasterRow } from "@/lib/approvals/masters";
import type { MasterKind } from "@/lib/approvals/validation";

type Props = {
  kind: MasterKind;
  /** Singular, lower case: "category", "branch". Used in buttons and messages. */
  noun: string;
  items: MasterRow[];
  /** For publications: the publication types to pick from. */
  parents?: { id: string; name: string }[];
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One editor for every simple list: expense categories, HR categories, branches, publication types and publications. */
export function MasterManager({ kind, noun, items, parents }: Props) {
  const { run, pending } = useAction();
  const isCategory = kind === "categories";
  const isPublication = kind === "publications";
  const url = `/api/approvals/masters/${kind}`;

  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState(parents?.[0]?.id ?? "");
  const [edit, setEdit] = useState<MasterRow | null>(null);
  const [merge, setMerge] = useState<MasterRow | null>(null);

  const byId = new Map(items.map((i) => [i.id, i]));
  const parentName = (id?: string) => parents?.find((p) => p.id === id)?.name ?? "";
  const needle = q.trim().toLowerCase();
  const shown = items.filter((i) => !needle || i.name.toLowerCase().includes(needle) || i.aliases?.some((a) => a.toLowerCase().includes(needle)));
  const duplicates = items.filter((i) => i.duplicateGroup && i.active).length;

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    run(() => api("POST", url, { name, ...(isPublication ? { publicationTypeId: parentId } : {}) }), `${cap(noun)} added`, () => setName(""));
  };

  return (
    <div className="space-y-5">
      <form onSubmit={add} className="flex flex-wrap items-end gap-3">
        {isPublication && (
          <Field label="Type of publication">
            <select aria-label="Type of publication" className="input min-w-48" value={parentId} onChange={(e) => setParentId(e.target.value)} required>
              {parents?.length === 0 && <option value="">Add a publication type first</option>}
              {parents?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        )}
        <div className="min-w-56 flex-1 sm:max-w-sm">
          <Field label={`New ${noun}`}>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
          </Field>
        </div>
        <button className="btn btn-primary btn-sm" disabled={pending || (isPublication && !parentId)}>Add {noun}</button>
      </form>

      {isCategory && duplicates > 0 && (
        <p className="apr-notice">
          {duplicates} categories are flagged as possible duplicates. Use Merge to fold one into the other: requests and old names move across.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchBox value={q} onChange={setQ} placeholder={`Search ${noun}`} />
        <span className="text-xs text-subtle">{shown.length} of {items.length}</span>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              {isPublication && <th>Type</th>}
              {!isPublication && <th className="w-20">Order</th>}
              <th className="w-28">Status</th>
              <th className="w-40 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-sm text-subtle">Nothing here yet.</td></tr>}
            {shown.map((i) => (
              <tr key={i.id} className={i.active ? "" : "opacity-60"}>
                <td>
                  <span className="font-medium">{i.name}</span>
                  {i.duplicateGroup && i.active && <span className="badge badge-amber ml-2">Possible duplicate</span>}
                  {i.mergedIntoId && <span className="ml-2 text-xs text-subtle">merged into {byId.get(i.mergedIntoId)?.name ?? "another category"}</span>}
                  {!!i.aliases?.length && <span className="mt-0.5 block text-xs text-subtle">Also: {i.aliases.join(", ")}</span>}
                </td>
                {isPublication && <td>{parentName(i.publicationTypeId)}</td>}
                {!isPublication && <td className="text-subtle">{i.sort}</td>}
                <td>
                  <ActiveToggle
                    active={i.active} disabled={pending || !!i.mergedIntoId}
                    onToggle={() => run(() => api("PATCH", `${url}/${i.id}`, { active: !i.active }), `${cap(noun)} ${i.active ? "deactivated" : "activated"}`)}
                  />
                </td>
                <td>
                  <div className="flex justify-end gap-2">
                    {isCategory && i.duplicateGroup && i.active && (
                      <button className="chip flex items-center gap-1 text-muted" onClick={() => setMerge(i)}><GitMerge size={13} /> Merge</button>
                    )}
                    <button className="chip flex items-center gap-1 text-muted" onClick={() => setEdit(i)}><Pencil size={13} /> Edit</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edit && (
        <EditDialog
          row={edit} noun={noun} isCategory={isCategory} hasOrder={!isPublication} pending={pending} onClose={() => setEdit(null)}
          onSave={(patch) => run(() => api("PATCH", `${url}/${edit.id}`, patch), `${cap(noun)} saved`, () => setEdit(null))}
        />
      )}
      {merge && (
        <MergeDialog
          source={merge} options={items.filter((i) => i.active && !i.mergedIntoId && i.id !== merge.id)} pending={pending} onClose={() => setMerge(null)}
          onMerge={(targetId) => run(() => api("POST", "/api/approvals/category-merge", { sourceId: merge.id, targetId }), "Categories merged", () => setMerge(null))}
        />
      )}
    </div>
  );
}

function EditDialog({ row, noun, isCategory, hasOrder, pending, onClose, onSave }: {
  row: MasterRow; noun: string; isCategory: boolean; hasOrder: boolean; pending: boolean; onClose: () => void;
  onSave: (patch: { name: string; sort?: number; aliases?: string[] }) => void;
}) {
  const [name, setName] = useState(row.name);
  const [sort, setSort] = useState(String(row.sort));
  const [aliases, setAliases] = useState((row.aliases ?? []).join("\n"));
  return (
    <Modal title={`Edit ${noun}`} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            name,
            ...(hasOrder ? { sort: Math.max(0, Math.trunc(Number(sort) || 0)) } : {}),
            ...(isCategory ? { aliases: aliases.split("\n").map((a) => a.trim()).filter(Boolean) } : {}),
          });
        }}
      >
        <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required /></Field>
        {hasOrder && <Field label="Order in dropdowns" hint="Lower numbers come first; the same number sorts by name."><input className="input" type="number" min={0} value={sort} onChange={(e) => setSort(e.target.value)} /></Field>}
        {isCategory && (
          <Field label="Other names (one per line)" hint="Old spellings, so imported records land on this category.">
            <textarea className="input min-h-24" value={aliases} onChange={(e) => setAliases(e.target.value)} />
          </Field>
        )}
        <div className="flex justify-end gap-3">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" disabled={pending}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

function MergeDialog({ source, options, pending, onClose, onMerge }: {
  source: MasterRow; options: MasterRow[]; pending: boolean; onClose: () => void; onMerge: (targetId: string) => void;
}) {
  // Start on a category from the same duplicate group, which is almost always the one meant.
  const likely = options.find((o) => o.duplicateGroup && o.duplicateGroup === source.duplicateGroup) ?? options[0];
  const [target, setTarget] = useState(likely?.id ?? "");
  return (
    <Modal title="Merge categories" onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (target) onMerge(target); }}>
        <p className="text-sm text-muted">
          Merge <b>{source.name}</b> into the category below. Its requests move there, its name becomes an alias, and it becomes inactive.
          This cannot be undone.
        </p>
        <Field label="Keep this one">
          <select aria-label="Category to keep" className="input" value={target} onChange={(e) => setTarget(e.target.value)} required>
            {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </Field>
        <div className="flex justify-end gap-3">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" disabled={pending || !target}>Merge</button>
        </div>
      </form>
    </Modal>
  );
}
