"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";
import type { LibraryItemDto } from "@/lib/design/library";
import { addVersionAction, createItemAction, updateItemAction } from "@/lib/design/actions/library";
import { MAX_CDR_MB } from "@/lib/design/form";
import { FileDrop } from "../file-drop";
import { useAct } from "../ticket/use-act";

/** Add an item to a folder (with its first file), or edit an existing item's details. */
export function ItemForm({ folderId, item, onClose }: { folderId: string; item?: LibraryItemDto; onClose: () => void }) {
  const { act, pending } = useAct();
  const [name, setName] = useState(item?.name ?? "");
  const [tags, setTags] = useState(item?.tags.join(", ") ?? "");
  const [final, setFinal] = useState(item?.isApprovedFinal ?? false);
  const [expiry, setExpiry] = useState(item?.expiryDate ?? "");
  const [rights, setRights] = useState(item?.usageRightsNote ?? "");
  const [fileId, setFileId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = { name, tags, isApprovedFinal: final, expiryDate: expiry || null, usageRightsNote: rights || null };

  return (
    <Modal title={item ? `Edit ${item.name}` : "Add to the library"} onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = item ? await act(() => updateItemAction(item.id, input)) : await act(() => createItemAction(folderId, fileId!, input));
          if (r.ok) onClose();
        }}
      >
        {!item && <FileDrop purpose="library" maxFiles={1} maxMb={MAX_CDR_MB} multiple={false} onChange={(ids) => setFileId(ids[0] ?? null)} onBusy={setBusy} hint={`One file, up to ${MAX_CDR_MB} MB`} />}
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
          <button className="btn btn-sm ds-btn-navy" disabled={pending || busy || !name.trim() || (!item && !fileId)}>
            {item ? "Save" : "Add"}
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
