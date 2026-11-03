import { LibraryView } from "@/components/design/library/library-view";
import { PageHeader } from "@/components/design/ui";
import { requireTeam } from "@/lib/design/dal";
import { listFolders, listItems } from "@/lib/design/library";

export const metadata = { title: "Library · Design Admin" };

/** The team's shared folders of logos, brand assets, templates and finished designs, with versions. */
export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ folder?: string; q?: string }> }) {
  await requireTeam();
  const sp = await searchParams;
  const folders = await listFolders();
  const folderId = folders.some((f) => f.id === sp.folder) ? sp.folder! : null;
  const q = (sp.q ?? "").slice(0, 100);
  const items = folderId || q ? await listItems(folderId, q) : [];
  return (
    <div>
      <PageHeader title="Library" subtitle="Logos, brand assets, templates and finished designs. Replacing a file keeps the earlier versions." />
      <LibraryView folders={folders} folderId={folderId} q={q} items={items} />
    </div>
  );
}
