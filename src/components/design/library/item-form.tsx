"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";
import type { FolderDto, LibraryItemDto } from "@/lib/design/library";
import { addVersionAction, createFolderAction, createItemAction, updateItemAction } from "@/lib/design/actions/library";
import { MAX_CDR_MB } from "@/lib/design/form";
import { FileDrop } from "../file-drop";
import { useAct } from "../ticket/use-act";

/** A folder's place in the library, for pickers: "Brand Assets / Logos". */
export function folderPath(folders: FolderDto[], id: string): string {
  const names: string[] = [];
  for (let f = folders.find((x) => x.id === id); f && names.length < 20; f = f.parentId ? folders.find((x) => x.id === f!.parentId) : undefined) names.unshift(f.name);
  return names.join(" / ");
}

const NEW = "__new";

/**
 * Upload to the library (leads): the file, the folder it goes in (or a new folder, made inside the one picked), tags, approved final,
 * usage rights and an expiry date. With `item`, edits an existing item's details instead (its folder stays).
 */
export function ItemForm({ folders, folderId, item, onClose }: { folders: FolderDto[]; folderId: string | null; item?: LibraryItemDto; onClose: () => void }) {
  const { act, pending } = useAct();
  const [folder, setFolder] = useState<string>(item?.folderId ?? folderId ?? folders.find((f) => f.system)?.id ?? NEW);
  const [newParent, setNewParent] = useState<string>(folderId ?? "");
  const [newName, setNewName] = useState("");
  const [name, setName] = useState(item?.name ?? "");
  const [tags, setTags] = useState(item?.tags.join(", ") ?? "");
  const [final, setFinal] = useState(item?.isApprovedFinal ?? false);
  const [expiry, setExpiry] = useState(item?.expiryDate ?? "");
  const [rights, setRights] = useState(item?.usageRightsNote ?? "");
  const [fileId, setFileId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = { name, tags, isApprovedFinal: final, expiryDate: expiry || null, usageRightsNote: rights || null };

  return (
    <Modal title={item ? `Edit ${item.name}` : "Upload to the library"} onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (item) {
            if ((await act(() => updateItemAction(item.id, input))).ok) onClose();
            return;
          }
          let target = folder;
          if (folder === NEW) {
            const made = await act(() => createFolderAction(newName, newParent || null));
            if (!made.ok || typeof made.data !== "string") return;
            target = made.data;
            setFolder(target);
          }
          if ((await act(() => createItemAction(target, fileId!, input))).ok) onClose();
        }}
      >
        {!item && <FileDrop purpose="library" maxFiles={1} maxMb={MAX_CDR_MB} multiple={false} onChange={(ids) => setFileId(ids[0] ?? null)} onBusy={setBusy} hint={`One file, up to ${MAX_CDR_MB} MB`} />}
        {!item && (
          <label className="ds-label flex flex-col gap-1">
            Folder
            <select className="input" value={folder} onChange={(e) => setFolder(e.target.value)}>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {folderPath(folders, f.id)}
                </option>
              ))}
              <option value={NEW}>New folder…</option>
            </select>
          </label>
        )}
        {!item && folder === NEW && (
          <div className="grid gap-3 rounded-lg border border-[var(--ds-line)] p-3 sm:grid-cols-2">
            <label className="ds-label flex flex-col gap-1">
              Name of the new folder
              <input className="input" required maxLength={120} value={newName} onChange={(e) => setNewName(e.target.value)} />
            </label>
            <label className="ds-label flex flex-col gap-1">
              Inside
              <select className="input" value={newParent} onChange={(e) => setNewParent(e.target.value)}>
                <option value="">The library (Other folders)</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {folderPath(folders, f.id)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <label className="ds-label flex flex-col gap-1">
          Name
          <input className="input" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="ds-label flex flex-col gap-1">
          Tags (separated by commas)
          <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="logo, blue, 2026" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="ds-label flex flex-col gap-1">
            Expires on (optional)
            <input className="input" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </label>
          <label className="mt-5 flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={final} onChange={(e) => setFinal(e.target.checked)} className="h-4 w-4 accent-[#003F8A]" />
            Approved final
          </label>
        </div>
        <label className="ds-label flex flex-col gap-1">
          Usage rights (optional)
          <textarea className="input min-h-16" maxLength={1000} value={rights} onChange={(e) => setRights(e.target.value)} />
        </label>
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-sm ds-btn-navy" disabled={pending || busy || !name.trim() || (!item && (!fileId || (folder === NEW && !newName.trim())))}>
            {item ? "Save" : "Upload"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** A new file for an item, which becomes its current version. */
export function VersionForm({ item, onClose }: { item: LibraryItemDto; onClose: () => void }) {
  const { act, pending } = useAct();
  const [fileId, setFileId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  return (
    <Modal title={`New version of ${item.name}`} onClose={onClose}>
      <FileDrop purpose="library" maxFiles={1} maxMb={MAX_CDR_MB} multiple={false} onChange={(ids) => setFileId(ids[0] ?? null)} onBusy={setBusy} hint={`One file, up to ${MAX_CDR_MB} MB`} />
      <label className="ds-label mt-3 flex flex-col gap-1">
        What changed (optional)
        <input className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-sm ds-btn-navy"
          disabled={pending || busy || !fileId}
          onClick={async () => {
            const r = await act(() => addVersionAction(item.id, fileId!, note));
            if (r.ok) onClose();
          }}
        >
          Upload version {(item.current?.version ?? 0) + 1}
        </button>
      </div>
    </Modal>
  );
}
