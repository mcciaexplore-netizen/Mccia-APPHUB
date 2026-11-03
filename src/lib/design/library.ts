import "server-only";
import { and, asc, desc, eq, inArray, max, sql } from "drizzle-orm";
import { db } from "./db";
import { folders, libraryItems, libraryVersions } from "@/db/design-schema";
import { addProof, proofsFor } from "./approvals";
import { DesignError, type SessionUser } from "./dal";
import { claimFiles, copyFile, filesByIds } from "./files";
import { fileKind, type FileKind } from "./file-types";
import { peopleByIds } from "./host-adapter";
import { FINISHED_STATUSES } from "./rules";
import { LIBRARY_SECTIONS, isSectionFolder, type LibrarySection } from "./library-sections";
import { getTicket } from "./tickets";

/**
 * The design library: the brand asset library of the creative team. Three sections, each a folder that is always there: Brand Assets
 * (logos, colours, fonts ...), Templates and Past Designs (delivered designs a lead keeps), with folders inside them; folders made
 * elsewhere show under All Files. An item is one asset with its versions (the newest is the current file).
 *
 * Who: the design leads add, edit, replace (as a new version), move into folders and delete; designers (Design Admin's App Staff) view and
 * download, and can use a library file as a proof on their ticket; requesters cannot see it. Deleting hides the folder or item; its files
 * stay until "Delete all past data".
 */

export { LIBRARY_SECTIONS, isSectionFolder, type LibrarySection };

/**
 * Makes sure the sections and their starting folders exist: one insert that skips the ones already there, so it is safe from every page
 * load at once. A starting folder a lead deleted stays deleted (its row is still there); after "Delete all past data" they come back.
 */
export async function ensureLibrary(): Promise<void> {
  await db
    .insert(folders)
    .values(LIBRARY_SECTIONS.flatMap((x) => [{ id: x.id, name: x.name, parentId: null }, ...x.folders.map((f) => ({ id: f.id, name: f.name, parentId: x.id }))]))
    .onConflictDoNothing({ target: folders.id });
}

export type FolderDto = { id: string; name: string; parentId: string | null; items: number; updatedAt: string; section: LibrarySection | null; system: boolean };
export type LibraryItemDto = {
  id: string;
  folderId: string;
  name: string;
  tags: string[];
  isApprovedFinal: boolean;
  expiryDate: string | null;
  usageRightsNote: string | null;
  createdAt: string;
  current: { versionId: string; version: number; fileId: string; fileName: string; mime: string; size: number; at: string; by: string | null } | null;
  versions: { versionId: string; version: number; fileId: string; fileName: string; size: number; note: string | null; at: string; by: string | null }[];
};

const cleanTags = (raw: string[] | string) =>
  [
    ...new Map(
      (Array.isArray(raw) ? raw : raw.split(","))
        .map((t) => String(t).replace(/\s+/g, " ").trim().slice(0, 40))
        .filter(Boolean)
        .map((t) => [t.toLowerCase(), t] as const),
    ).values(),
  ].slice(0, 20);

const cleanName = (name: string, what: string) => {
  const v = name.replace(/\s+/g, " ").trim().slice(0, 120);
  if (!v) throw new DesignError(`Give the ${what} a name.`);
  return v;
};

/** Every folder, with how many items it holds (itself, not its subfolders), when a file in it last changed, and its section. */
export async function listFolders(): Promise<FolderDto[]> {
  const [rows, counts] = await Promise.all([
    db.select().from(folders).where(eq(folders.isDeleted, false)).orderBy(asc(folders.name)),
    db
      .select({ folderId: libraryItems.folderId, n: sql<number>`count(distinct ${libraryItems.id})::int`, last: max(libraryVersions.createdAt) })
      .from(libraryItems)
      .leftJoin(libraryVersions, eq(libraryVersions.itemId, libraryItems.id))
      .where(eq(libraryItems.isDeleted, false))
      .groupBy(libraryItems.folderId),
  ]);
  const c = new Map(counts.map((x) => [x.folderId, x]));
  const byId = new Map(rows.map((f) => [f.id, f]));
  const sectionOf = (id: string): LibrarySection | null => {
    for (let f = byId.get(id), hops = 0; f && hops < 50; f = f.parentId ? byId.get(f.parentId) : undefined, hops++) {
      const hit = LIBRARY_SECTIONS.find((x) => x.id === f!.id);
      if (hit) return hit.key;
    }
    return null;
  };
  return rows.map((f) => {
    const own = c.get(f.id);
    return {
      id: f.id, name: f.name, parentId: f.parentId, items: own?.n ?? 0, updatedAt: (own?.last ?? f.createdAt).toISOString(),
      section: sectionOf(f.id), system: isSectionFolder(f.id),
    };
  });
}

/** A folder and every folder inside it. */
export function folderAndBelow(all: FolderDto[], id: string): string[] {
  const out = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const f of all)
      if (f.parentId && out.has(f.parentId) && !out.has(f.id)) {
        out.add(f.id);
        grew = true;
      }
  }
  return [...out];
}

export async function createFolder(u: SessionUser, name: string, parentId: string | null): Promise<string> {
  if (parentId) {
    const [p] = await db.select({ id: folders.id }).from(folders).where(and(eq(folders.id, parentId), eq(folders.isDeleted, false))).limit(1);
    if (!p) throw new DesignError("That folder was not found.");
  }
  const [f] = await db.insert(folders).values({ name: cleanName(name, "folder"), parentId, createdBy: u.id }).returning({ id: folders.id });
  return f.id;
}

export async function renameFolder(id: string, name: string): Promise<void> {
  if (isSectionFolder(id)) throw new DesignError("The library's sections keep their names.");
  await db.update(folders).set({ name: cleanName(name, "folder") }).where(eq(folders.id, id));
}

/** Hides a folder, the folders inside it and their items. */
export async function deleteFolder(id: string): Promise<void> {
  if (isSectionFolder(id)) throw new DesignError("The library's sections cannot be deleted.");
  const all = await db.select({ id: folders.id, parentId: folders.parentId }).from(folders).where(eq(folders.isDeleted, false));
  const gone = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const f of all)
      if (f.parentId && gone.has(f.parentId) && !gone.has(f.id)) {
        gone.add(f.id);
        grew = true;
      }
  }
  await db.update(folders).set({ isDeleted: true }).where(inArray(folders.id, [...gone]));
  await db.update(libraryItems).set({ isDeleted: true }).where(inArray(libraryItems.folderId, [...gone]));
}

export type ItemFilter = { folderIds?: string[] | null; search?: string; approvedOnly?: boolean; kind?: FileKind | null };

/** Items, newest first: in some folders (or all), matching a word in the name or a tag, approved finals only, of one kind of file. */
export async function listItems({ folderIds = null, search = "", approvedOnly = false, kind = null }: ItemFilter = {}): Promise<LibraryItemDto[]> {
  const where = [eq(libraryItems.isDeleted, false)];
  if (folderIds) {
    if (!folderIds.length) return [];
    where.push(inArray(libraryItems.folderId, folderIds));
  }
  if (approvedOnly) where.push(eq(libraryItems.isApprovedFinal, true));
  if (search.trim()) {
    const like = `%${search.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(sql`(${libraryItems.name} ilike ${like} or ${libraryItems.tags}::text ilike ${like})`);
  }
  const items = await db.select().from(libraryItems).where(and(...where)).orderBy(desc(libraryItems.createdAt)).limit(300);
  if (!items.length) return [];
  const versions = await db.select().from(libraryVersions).where(inArray(libraryVersions.itemId, items.map((i) => i.id))).orderBy(desc(libraryVersions.version));
  const [fs, people] = await Promise.all([filesByIds(versions.map((v) => v.fileId)), peopleByIds(versions.map((v) => v.uploadedBy))]);
  const out = items.map((i) => {
    const vs = versions
      .filter((v) => v.itemId === i.id && fs.has(v.fileId))
      .map((v) => {
        const f = fs.get(v.fileId)!;
        return { versionId: v.id, version: v.version, fileId: f.id, fileName: f.fileName, mime: f.mime, size: f.size, note: v.note, at: v.createdAt.toISOString(), by: people.get(v.uploadedBy)?.name ?? null };
      });
    const cur = vs[0];
    return {
      id: i.id,
      folderId: i.folderId,
      name: i.name,
      tags: i.tags,
      isApprovedFinal: i.isApprovedFinal,
      expiryDate: i.expiryDate,
      usageRightsNote: i.usageRightsNote,
      createdAt: i.createdAt.toISOString(),
      current: cur ? { versionId: cur.versionId, version: cur.version, fileId: cur.fileId, fileName: cur.fileName, mime: cur.mime, size: cur.size, at: cur.at, by: cur.by } : null,
      versions: vs.map((v) => ({ versionId: v.versionId, version: v.version, fileId: v.fileId, fileName: v.fileName, size: v.size, note: v.note, at: v.at, by: v.by })),
    };
  });
  return kind ? out.filter((i) => i.current && fileKind(i.current.mime) === kind) : out;
}

export type ItemInput = { name: string; tags: string[] | string; isApprovedFinal: boolean; expiryDate: string | null; usageRightsNote: string | null };

const itemFields = (p: ItemInput) => {
  if (p.expiryDate && !/^\d{4}-\d{2}-\d{2}$/.test(p.expiryDate)) throw new DesignError("Choose a valid expiry date.");
  return { name: cleanName(p.name, "item"), tags: cleanTags(p.tags), isApprovedFinal: !!p.isApprovedFinal, expiryDate: p.expiryDate || null, usageRightsNote: p.usageRightsNote?.trim().slice(0, 1000) || null };
};

export async function createItem(u: SessionUser, folderId: string, fileId: string, p: ItemInput): Promise<string> {
  const [folder] = await db.select({ id: folders.id }).from(folders).where(and(eq(folders.id, folderId), eq(folders.isDeleted, false))).limit(1);
  if (!folder) throw new DesignError("That folder was not found.");
  const fields = itemFields(p);
  const [f] = await claimFiles(u.id, [fileId], "library");
  const [item] = await db.insert(libraryItems).values({ folderId, ...fields, createdBy: u.id }).returning({ id: libraryItems.id });
  await db.insert(libraryVersions).values({ itemId: item.id, version: 1, fileId: f.id, uploadedBy: u.id, note: "First version" });
  return item.id;
}

export async function updateItem(id: string, p: ItemInput): Promise<void> {
  await db.update(libraryItems).set(itemFields(p)).where(eq(libraryItems.id, id));
}

/** A new file for an item: it becomes the current version; earlier ones stay downloadable. */
export async function addVersion(u: SessionUser, itemId: string, fileId: string, note: string): Promise<void> {
  const [item] = await db.select({ id: libraryItems.id }).from(libraryItems).where(and(eq(libraryItems.id, itemId), eq(libraryItems.isDeleted, false))).limit(1);
  if (!item) throw new DesignError("That item was not found.");
  const [f] = await claimFiles(u.id, [fileId], "library");
  const [last] = await db.select({ v: libraryVersions.version }).from(libraryVersions).where(eq(libraryVersions.itemId, itemId)).orderBy(desc(libraryVersions.version)).limit(1);
  await db.insert(libraryVersions).values({ itemId, version: (last?.v ?? 0) + 1, fileId: f.id, uploadedBy: u.id, note: note.trim().slice(0, 500) || null });
}

export async function deleteItem(id: string): Promise<void> {
  await db.update(libraryItems).set({ isDeleted: true }).where(eq(libraryItems.id, id));
}

/** Whether a stored file belongs to a library version (so the team may download it). */
export async function isLibraryFile(fileId: string): Promise<boolean> {
  const [v] = await db.select({ id: libraryVersions.id }).from(libraryVersions).where(eq(libraryVersions.fileId, fileId)).limit(1);
  return !!v;
}

// ── The library and tickets ──────────────────────────────────────────────────

/**
 * A designer uses a library file as the next proof on their ticket instead of uploading it again: a copy of the file becomes the proof
 * (see copyFile), then it goes on exactly like an upload (addProof checks the ticket is theirs).
 */
export async function proofFromLibrary(u: SessionUser, ticketId: string, libraryFileId: string, note: string, send: boolean) {
  const [v] = await db
    .select({ id: libraryVersions.id })
    .from(libraryVersions)
    .innerJoin(libraryItems, eq(libraryItems.id, libraryVersions.itemId))
    .where(and(eq(libraryVersions.fileId, libraryFileId), eq(libraryItems.isDeleted, false)))
    .limit(1);
  if (!v) throw new DesignError("That library file was not found.");
  return addProof(u, ticketId, await copyFile(u.id, libraryFileId, "proof"), note, send);
}

/** Whether a ticket's design is already kept in Past Designs. */
export async function inPastDesigns(ticketId: string): Promise<boolean> {
  const [i] = await db.select({ id: libraryItems.id }).from(libraryItems).where(and(eq(libraryItems.ticketId, ticketId), eq(libraryItems.isDeleted, false))).limit(1);
  return !!i;
}

/** A lead keeps a delivered ticket's design in Past Designs: the approved proof (else the newest), as an approved final, tagged with its number. */
export async function addPastDesign(u: SessionUser, ticketId: string): Promise<void> {
  if (!u.lead) throw new DesignError("Only a design lead can add to the library.");
  const t = await getTicket(ticketId);
  if (!t) throw new DesignError("That ticket was not found.");
  if (!FINISHED_STATUSES.includes(t.status)) throw new DesignError("Only a delivered design can go into Past Designs.");
  if (await inPastDesigns(ticketId)) throw new DesignError("This design is already in Past Designs.");
  const proofs = await proofsFor(ticketId);
  const pick = proofs.find((p) => p.requests.some((r) => r.status === "approved")) ?? proofs[0];
  if (!pick) throw new DesignError("This ticket has no design to keep.");
  await ensureLibrary();
  const [f] = await claimFiles(u.id, [await copyFile(u.id, pick.file.id, "library")], "library");
  const past = LIBRARY_SECTIONS.find((x) => x.key === "past")!;
  const [item] = await db
    .insert(libraryItems)
    .values({ folderId: past.id, name: `${t.number} — ${t.title}`.slice(0, 120), ticketId, tags: cleanTags([t.number, ...(t.department ? [t.department] : [])]), isApprovedFinal: true, createdBy: u.id })
    .returning({ id: libraryItems.id });
  await db.insert(libraryVersions).values({ itemId: item.id, version: 1, fileId: f.id, uploadedBy: u.id, note: `Delivered design of ${t.number} (V${pick.version})` });
}
