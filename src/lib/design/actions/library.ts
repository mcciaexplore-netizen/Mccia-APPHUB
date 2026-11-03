"use server";

import { revalidatePath } from "next/cache";
import { assertTeam, run, type ActionResult } from "../dal";
import { addVersion, createFolder, createItem, deleteFolder, deleteItem, renameFolder, updateItem, type ItemInput } from "../library";

/** The library, for everyone on the design team (Design Team or Design Team Admin). */

const team = <T>(fn: (u: Awaited<ReturnType<typeof assertTeam>>) => Promise<T>, message?: string) =>
  run(async () => {
    const u = await assertTeam();
    const r = await fn(u);
    revalidatePath("/design/admin/library");
    return r;
  }, message);

export async function createFolderAction(name: string, parentId: string | null): Promise<ActionResult<string>> {
  return team((u) => createFolder(u, name, parentId), "Folder added");
}
export async function renameFolderAction(id: string, name: string): Promise<ActionResult> {
  return team(() => renameFolder(id, name), "Renamed");
}
export async function deleteFolderAction(id: string): Promise<ActionResult> {
  return team(() => deleteFolder(id), "Folder deleted");
}
export async function createItemAction(folderId: string, fileId: string, input: ItemInput): Promise<ActionResult<string>> {
  return team((u) => createItem(u, folderId, fileId, input), "Added to the library");
}
export async function updateItemAction(id: string, input: ItemInput): Promise<ActionResult> {
  return team(() => updateItem(id, input), "Saved");
}
export async function addVersionAction(itemId: string, fileId: string, note: string): Promise<ActionResult> {
  return team((u) => addVersion(u, itemId, fileId, note), "New version added");
}
export async function deleteItemAction(id: string): Promise<ActionResult> {
  return team(() => deleteItem(id), "Deleted");
}
