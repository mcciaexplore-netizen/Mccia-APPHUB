"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Folder, FolderPlus, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { Modal } from "@/components/Modal";
import type { FolderDto, LibraryItemDto } from "@/lib/design/library";
import { createFolderAction, deleteFolderAction, renameFolderAction } from "@/lib/design/actions/library";
import { useAct } from "../ticket/use-act";
import { Card, Empty } from "../ui";
import { ItemCard } from "./item-card";
import { ItemForm } from "./item-form";

/** Folders on the left (nested, with counts), the selected folder's items on the right, and a search across everything. */
export function LibraryView({ folders, folderId, q, items }: { folders: FolderDto[]; folderId: string | null; q: string; items: LibraryItemDto[] }) {
  const router = useRouter();
  const confirm = useConfirm();
  const { act, pending } = useAct();
  const [search, setSearch] = useState(q);
  const [folderModal, setFolderModal] = useState<{ id: string | null; name: string; parentId: string | null } | null>(null);
  const [adding, setAdding] = useState(false);
  const current = folders.find((f) => f.id === folderId) ?? null;

  const tree = (parentId: string | null, depth: number): React.ReactNode[] =>
    folders
      .filter((f) => f.parentId === parentId)
      .flatMap((f) => [
        <li key={f.id}>
          <Link
            href={`/design/admin/library?folder=${f.id}`}
            aria-current={f.id === folderId ? "page" : undefined}
            className={`flex items-center gap-2 rounded-lg py-1.5 pr-2 text-sm ${f.id === folderId ? "bg-[var(--ds-navy-tint)] font-semibold text-[var(--ds-navy)]" : "text-ink hover:bg-[var(--ds-grey-tint)]"}`}
            style={{ paddingLeft: `${0.5 + depth * 0.9}rem` }}
          >
            <Folder size={15} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{f.name}</span>
            <span className="text-xs ds-muted">{f.items}</span>
          </Link>
        </li>,
        ...tree(f.id, depth + 1),
      ]);

  return (
    <div className="grid gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <Card
        title="Folders"
        actions={
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFolderModal({ id: null, name: "", parentId: null })}>
            <FolderPlus size={14} /> New
          </button>
        }
      >
        {folders.length === 0 ? <p className="text-sm ds-muted">No folders yet. Make one to start.</p> : <ul className="flex flex-col gap-0.5">{tree(null, 0)}</ul>}
      </Card>

      <div className="flex flex-col gap-4">
        <form
          className="flex gap-2"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            const p = new URLSearchParams();
            if (folderId) p.set("folder", folderId);
            if (search.trim()) p.set("q", search.trim());
            router.push(`/design/admin/library${p.size ? `?${p}` : ""}`);
          }}
        >
          <label className="relative flex-1">
            <span className="sr-only">Search the library</span>
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
            <input className="input pl-9" placeholder={current ? `Search in ${current.name}` : "Search names and tags in every folder"} value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <button className="btn btn-sm ds-btn-navy">Search</button>
        </form>

        {current && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-ink">{current.name}</h2>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-sm ds-btn-navy" onClick={() => setAdding(true)}>
                <Plus size={14} /> Add item
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFolderModal({ id: null, name: "", parentId: current.id })}>
                <FolderPlus size={14} /> Subfolder
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFolderModal({ id: current.id, name: current.name, parentId: current.parentId })}>
                <Pencil size={14} /> Rename
              </button>
              <button
                type="button"
                className="btn btn-sm ds-btn-outline-red"
                disabled={pending}
                onClick={async () => {
                  if (!(await confirm({ title: `Delete ${current.name}?`, message: "The folder, its subfolders and their items are removed from the library.", confirmLabel: "Delete", danger: true }))) return;
                  const r = await act(() => deleteFolderAction(current.id));
                  if (r.ok) router.push("/design/admin/library");
                }}
              >
                <Trash2 size={14} /> Delete
              </button>
            </div>
          </div>
        )}

        {!current && !q ? (
          <Card>
            <Empty title="Choose a folder">Pick a folder on the left, or search names and tags across the whole library.</Empty>
          </Card>
        ) : items.length === 0 ? (
          <Card>
            <Empty title={q ? "Nothing matches" : "This folder is empty"}>{q ? "Try another word." : "Add the first item with “Add item”."}</Empty>
          </Card>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
            {items.map((i) => (
              <ItemCard key={i.id} item={i} folderName={folders.find((f) => f.id === i.folderId)?.name ?? null} showFolder={!current} />
            ))}
          </ul>
        )}
      </div>

      {folderModal && (
        <Modal title={folderModal.id ? "Rename folder" : folderModal.parentId ? "New subfolder" : "New folder"} onClose={() => setFolderModal(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const r = folderModal.id ? await act(() => renameFolderAction(folderModal.id!, folderModal.name)) : await act(() => createFolderAction(folderModal.name, folderModal.parentId));
              if (r.ok) {
                setFolderModal(null);
                if (!folderModal.id && typeof r.data === "string") router.push(`/design/admin/library?folder=${r.data}`);
              }
            }}
          >
            <label className="ds-label flex flex-col gap-1">
              Name
              <input className="input" autoFocus maxLength={120} value={folderModal.name} onChange={(e) => setFolderModal({ ...folderModal, name: e.target.value })} />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFolderModal(null)}>
                Cancel
              </button>
              <button className="btn btn-sm ds-btn-navy" disabled={pending || !folderModal.name.trim()}>
                Save
              </button>
            </div>
          </form>
        </Modal>
      )}
      {adding && current && <ItemForm folderId={current.id} onClose={() => setAdding(false)} />}
    </div>
  );
}
