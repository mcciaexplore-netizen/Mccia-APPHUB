import { LibraryView, type LibraryMode } from "@/components/design/library/library-view";
import { PageHeader } from "@/components/design/ui";
import { requireTeam } from "@/lib/design/dal";
import type { FileKind } from "@/lib/design/file-types";
import { LIBRARY_SECTIONS, ensureLibrary, folderAndBelow, listFolders, listItems } from "@/lib/design/library";

export const metadata = { title: "Library · Design Admin" };

const KINDS: FileKind[] = ["image", "pdf", "vector"];

/**
 * The brand asset library. With no folder or section: the sections as folder cards (Brand Assets first). ?section=brand|templates|past:
 * that section's folders and every file in it; ?section=all every file; ?folder=<id> one folder. Search (?q), approved finals only
 * (?approved=1) and the kind of file (?kind=image|pdf|vector) narrow the files anywhere. Leads change it; designers look and download.
 */
export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ folder?: string; section?: string; q?: string; approved?: string; kind?: string }> }) {
  const u = await requireTeam();
  await ensureLibrary();
  const sp = await searchParams;
  const folders = await listFolders();
  const filters = { q: (sp.q ?? "").slice(0, 100), approved: sp.approved === "1", kind: KINDS.includes(sp.kind as FileKind) ? (sp.kind as FileKind) : null };
  const filtered = !!(filters.q || filters.approved || filters.kind);
  const current = folders.find((f) => f.id === sp.folder) ?? null;
  const section = LIBRARY_SECTIONS.find((x) => x.key === sp.section) ?? null;

  let mode: LibraryMode;
  let folderIds: string[] | null = null;
  if (current) {
    mode = { kind: "folder", folderId: current.id };
    folderIds = [current.id];
  } else if (section) {
    mode = { kind: "section", section: section.key };
    folderIds = folderAndBelow(folders, section.id);
  } else if (sp.section === "all" || filtered) mode = { kind: "all" };
  else mode = { kind: "overview" };
  const items = mode.kind === "overview" ? [] : await listItems({ folderIds, search: filters.q, approvedOnly: filters.approved, kind: filters.kind });

  return (
    <div>
      <PageHeader title="Library" subtitle="The brand asset library: logos, colours, fonts, templates and past designs. Replacing a file keeps the earlier versions." />
      <LibraryView lead={u.lead} folders={folders} mode={mode} items={items} filters={filters} />
    </div>
  );
}
