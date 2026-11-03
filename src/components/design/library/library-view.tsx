"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronRight, Folder, FolderPlus, Pencil, Search, Trash2, Upload } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { Modal } from "@/components/Modal";
import type { FileKind } from "@/lib/design/file-types";
import type { FolderDto, LibraryItemDto } from "@/lib/design/library";
import { LIBRARY_SECTIONS, type LibrarySection } from "@/lib/design/library-sections";
import { createFolderAction, deleteFolderAction, renameFolderAction } from "@/lib/design/actions/library";
import { useAct } from "../ticket/use-act";
import { Card, Empty, formatDay } from "../ui";
import { ItemCard } from "./item-card";
import { ItemForm, folderPath } from "./item-form";

export type LibraryMode = { kind: "overview" } | { kind: "all" } | { kind: "section"; section: LibrarySection } | { kind: "folder"; folderId: string };
type Filters = { q: string; approved: boolean; kind: FileKind | null };

const BASE = "/design/admin/library";
const SEEDED = LIBRARY_SECTIONS.flatMap((x) => x.folders.map((f) => f.id));
const KIND_LABEL: Record<FileKind, string> = { image: "Images", pdf: "PDFs", vector: "Vector and source files", other: "Other" };

/** A folder as a card: its name, how many files it holds and when one last changed. Opens the folder. */
function FolderCard({ f, below }: { f: FolderDto; below: number }) {
  return (
    <li>
      <Link href={`${BASE}?folder=${f.id}`} className="ds-card ds-card-hover flex items-center gap-3 px-4 py-3.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[var(--ds-navy-tint)] text-[var(--ds-navy)]">
          <Folder size={19} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-ink">{f.name}</span>
          <span className="block text-xs ds-muted" suppressHydrationWarning>
            {f.items} file{f.items === 1 ? "" : "s"}
            {below > 0 ? ` · ${below} folder${below === 1 ? "" : "s"}` : ""} · Updated {formatDay(f.updatedAt)}
          </span>
        </span>
        <ChevronRight size={16} className="shrink-0 text-subtle" />
      </Link>
    </li>
  );
}

/**
 * The library page: the sections as folder cards (Brand Assets first), a section or folder with its folders and files, or every file;
 * search, approved finals only and the kind of file narrow the files. Leads upload, make folders, rename and delete; designers look and
 * download.
 */
export function LibraryView({ lead, folders, mode, items, filters }: { lead: boolean; folders: FolderDto[]; mode: LibraryMode; items: LibraryItemDto[]; filters: Filters }) {
  const router = useRouter();
  const confirm = useConfirm();
  const { act, pending } = useAct();
  const [q, setQ] = useState(filters.q);
  const [folderModal, setFolderModal] = useState<{ id: string | null; name: string; parentId: string | null } | null>(null);
  const [uploading, setUploading] = useState(false);

  const current = mode.kind === "folder" ? (folders.find((f) => f.id === mode.folderId) ?? null) : null;
  const section = mode.kind === "section" ? LIBRARY_SECTIONS.find((x) => x.key === mode.section)! : null;
  // The folder new things go into: the open folder, else the open section's own folder.
  const here = current?.id ?? section?.id ?? null;
  // The starting folders in their own order (Logos first), then any others by name.
  const rank = (id: string) => { const i = SEEDED.indexOf(id); return i < 0 ? SEEDED.length : i; };
  const childrenOf = (id: string | null) => folders.filter((f) => f.parentId === id).sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
  const countBelow = (id: string) => childrenOf(id).length;
  const others = childrenOf(null).filter((f) => !f.system);

  const go = (next: Partial<Filters> & { folder?: string | null }) => {
    const p = new URLSearchParams();
    const folder = next.folder !== undefined ? next.folder : current?.id;
    if (folder) p.set("folder", folder);
    else if (section) p.set("section", section.key);
    else if (mode.kind === "all") p.set("section", "all");
    const f = { ...filters, q, ...next };
    if (f.q.trim()) p.set("q", f.q.trim());
    if (f.approved) p.set("approved", "1");
    if (f.kind) p.set("kind", f.kind);
    router.push(`${BASE}${p.size ? `?${p}` : ""}`);
  };

  const crumbs: { label: string; href?: string }[] = [{ label: "Library", href: BASE }];
  if (section) crumbs.push({ label: section.name });
  if (mode.kind === "all") crumbs.push({ label: "All Files" });
  if (current) {
    const chain: FolderDto[] = [];
    for (let f: FolderDto | undefined = current; f && chain.length < 20; f = f.parentId ? folders.find((x) => x.id === f!.parentId) : undefined) chain.unshift(f);
    for (const f of chain) crumbs.push(f.id === current.id ? { label: f.name } : { label: f.name, href: f.system ? `${BASE}?section=${f.section}` : `${BASE}?folder=${f.id}` });
  }
  const subfolders = current ? childrenOf(current.id) : section ? childrenOf(section.id) : [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Where you are" className="flex flex-wrap items-center gap-1 text-sm">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size={14} className="text-subtle" />}
              {c.href ? <Link href={c.href} className="font-semibold text-[var(--ds-navy)] hover:underline">{c.label}</Link> : <span className="font-bold text-ink">{c.label}</span>}
            </span>
          ))}
        </nav>
        {lead && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-sm ds-btn-navy" onClick={() => setUploading(true)}>
              <Upload size={14} /> Upload to library
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFolderModal({ id: null, name: "", parentId: here })}>
              <FolderPlus size={14} /> New folder
            </button>
            {current && !current.system && (
              <>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFolderModal({ id: current.id, name: current.name, parentId: current.parentId })}>
                  <Pencil size={14} /> Rename
                </button>
                <button
                  type="button"
                  className="btn btn-sm ds-btn-outline-red"
                  disabled={pending}
                  onClick={async () => {
                    if (!(await confirm({ title: `Delete ${current.name}?`, message: "The folder, its subfolders and their files are removed from the library.", confirmLabel: "Delete", danger: true }))) return;
                    const r = await act(() => deleteFolderAction(current.id));
                    if (r.ok) router.push(current.section ? `${BASE}?section=${current.section}` : BASE);
                  }}
                >
                  <Trash2 size={14} /> Delete
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <form
        className="ds-card flex flex-wrap items-end gap-3 px-4 py-3"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          go({});
        }}
      >
        <label className="relative min-w-[14rem] flex-1">
          <span className="sr-only">Search by name or tag</span>
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
          <input className="input pl-9" placeholder={current ? `Search in ${current.name}` : section ? `Search in ${section.name}` : "Search names and tags"} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label className="ds-label flex flex-col gap-1">
          Folder
          <select className="input" value={current?.id ?? ""} onChange={(e) => go({ folder: e.target.value || null })} aria-label="Filter by folder">
            <option value="">{section ? `All of ${section.name}` : "Every folder"}</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {folderPath(folders, f.id)}
              </option>
            ))}
          </select>
        </label>
        <label className="ds-label flex flex-col gap-1">
          Type
          <select className="input" value={filters.kind ?? ""} onChange={(e) => go({ kind: (e.target.value || null) as FileKind | null })} aria-label="Filter by type of file">
            <option value="">All types</option>
            {(["image", "pdf", "vector"] as FileKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-10 items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={filters.approved} onChange={(e) => go({ approved: e.target.checked })} className="h-4 w-4 accent-[#003F8A]" />
          Approved finals only
        </label>
        <button className="btn btn-sm ds-btn-navy">Search</button>
      </form>

      {mode.kind === "overview" ? (
        <div className="flex flex-col gap-6">
          {LIBRARY_SECTIONS.map((x) => {
            const root = folders.find((f) => f.id === x.id);
            const inside = childrenOf(x.id);
            return (
              <section key={x.key} aria-labelledby={`lib-${x.key}`} className="flex flex-col gap-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <h2 id={`lib-${x.key}`} className="text-lg font-bold text-ink">{x.name}</h2>
                    <p className="text-xs ds-muted">{x.hint}{root && root.items > 0 ? ` · ${root.items} file${root.items === 1 ? "" : "s"} directly in it` : ""}</p>
                  </div>
                  <Link href={`${BASE}?section=${x.key}`} className="text-sm font-semibold text-[var(--ds-navy)] hover:underline">
                    Open {x.name} →
                  </Link>
                </div>
                {inside.length > 0 && (
                  <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {inside.map((f) => <FolderCard key={f.id} f={f} below={countBelow(f.id)} />)}
                  </ul>
                )}
              </section>
            );
          })}
          {others.length > 0 && (
            <section aria-labelledby="lib-other" className="flex flex-col gap-3">
              <h2 id="lib-other" className="text-lg font-bold text-ink">Other folders</h2>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {others.map((f) => <FolderCard key={f.id} f={f} below={countBelow(f.id)} />)}
              </ul>
            </section>
          )}
        </div>
      ) : (
        <>
          {subfolders.length > 0 && (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {subfolders.map((f) => <FolderCard key={f.id} f={f} below={countBelow(f.id)} />)}
            </ul>
          )}
          {items.length === 0 ? (
            <Card>
              <Empty title={filters.q || filters.approved || filters.kind ? "Nothing matches" : "No files here yet"}>
                {filters.q || filters.approved || filters.kind ? "Try another word or fewer filters." : lead ? "Add the first one with “Upload to library”." : "A design lead adds files here."}
              </Empty>
            </Card>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {items.map((i) => (
                <ItemCard key={i.id} item={i} lead={lead} folders={folders} folderName={i.folderId !== current?.id ? folderPath(folders, i.folderId) : null} />
              ))}
            </ul>
          )}
        </>
      )}

      {folderModal && (
        <Modal title={folderModal.id ? "Rename folder" : "New folder"} onClose={() => setFolderModal(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const r = folderModal.id ? await act(() => renameFolderAction(folderModal.id!, folderModal.name)) : await act(() => createFolderAction(folderModal.name, folderModal.parentId));
              if (r.ok) {
                setFolderModal(null);
                if (!folderModal.id && typeof r.data === "string") router.push(`${BASE}?folder=${r.data}`);
              }
            }}
          >
            {!folderModal.id && <p className="mb-3 text-sm ds-muted">Inside {folderModal.parentId ? folderPath(folders, folderModal.parentId) : "the library (under Other folders)"}.</p>}
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
      {uploading && <ItemForm folders={folders} folderId={here} onClose={() => setUploading(false)} />}
    </div>
  );
}
