import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { folders, libraryItems, libraryVersions } from "@/db/design-schema";
import { DesignError, type SessionUser } from "./dal";
import { claimFiles, filesByIds } from "./files";
import { peopleByIds } from "./host-adapter";

/**
 * The design library: the team's shared folders of logos, brand assets, templates and finished designs. Everyone with Design Team or Design
 * Team Admin can see, add, edit, replace (as a new version) and delete; requesters cannot see it. An item is one asset with its versions
 * (the newest is the current file). Deleting hides the folder or item; its files stay until "Delete all past data".
 */

export type FolderDto = { id: string; name: string; parentId: string | null; items: number };
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

export async function listFolders(): Promise<FolderDto[]> {
  const rows = await db.select().from(folders).where(eq(folders.isDeleted, false)).orderBy(asc(folders.name));
  const counts = await db
    .select({ folderId: libraryItems.folderId, n: sql<number>`count(*)::int` })
    .from(libraryItems)
    .where(eq(libraryItems.isDeleted, false))
    .groupBy(libraryItems.folderId);
  const c = new Map(counts.map((x) => [x.folderId, x.n]));
  return rows.map((f) => ({ id: f.id, name: f.name, parentId: f.parentId, items: c.get(f.id) ?? 0 }));
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
  await db.update(folders).set({ name: cleanName(name, "folder") }).where(eq(folders.id, id));
}

/** Hides a folder, the folders inside it and their items. */
export async function deleteFolder(id: string): Promise<void> {
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

export async function listItems(folderId: string | null, search = ""): Promise<LibraryItemDto[]> {
  const where = [eq(libraryItems.isDeleted, false)];
  if (folderId) where.push(eq(libraryItems.folderId, folderId));
  if (search.trim()) {
    const like = `%${search.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(sql`(${libraryItems.name} ilike ${like} or ${libraryItems.tags}::text ilike ${like})`);
  }
  const items = await db.select().from(libraryItems).where(and(...where)).orderBy(desc(libraryItems.createdAt)).limit(300);
  if (!items.length) return [];
  const versions = await db.select().from(libraryVersions).where(inArray(libraryVersions.itemId, items.map((i) => i.id))).orderBy(desc(libraryVersions.version));
  const [fs, people] = await Promise.all([filesByIds(versions.map((v) => v.fileId)), peopleByIds(versions.map((v) => v.uploadedBy))]);
  return items.map((i) => {
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
