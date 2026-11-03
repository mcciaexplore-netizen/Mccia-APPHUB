"use server";

import { revalidatePath } from "next/cache";
import { assertLead, assertTeam, run, type ActionResult } from "../dal";
import { addPastDesign, addVersion, createFolder, createItem, deleteFolder, deleteItem, listItems, proofFromLibrary, renameFolder, updateItem, type ItemInput, type LibraryItemDto } from "../library";

/** The library: the design leads change it; the whole creative team (leads and designers) may look and use a file as a proof. */

const lead = <T>(fn: (u: Awaited<ReturnType<typeof assertLead>>) => Promise<T>, message?: string) =>
  run(async () => {
    const u = await assertLead();
    const r = await fn(u);
    revalidatePath("/design/admin/library");
    return r;
  }, message);

export async function createFolderAction(name: string, parentId: string | null): Promise<ActionResult<string>> {
  return lead((u) => createFolder(u, name, parentId), "Folder added");
}
export async function renameFolderAction(id: string, name: string): Promise<ActionResult> {
  return lead(() => renameFolder(id, name), "Renamed");
}
export async function deleteFolderAction(id: string): Promise<ActionResult> {
  return lead(() => deleteFolder(id), "Folder deleted");
}
export async function createItemAction(folderId: string, fileId: string, input: ItemInput): Promise<ActionResult<string>> {
  return lead((u) => createItem(u, folderId, fileId, input), "Added to the library");
}
export async function updateItemAction(id: string, input: ItemInput): Promise<ActionResult> {
  return lead(() => updateItem(id, input), "Saved");
}
export async function addVersionAction(itemId: string, fileId: string, note: string): Promise<ActionResult> {
  return lead((u) => addVersion(u, itemId, fileId, note), "New version added");
}
export async function deleteItemAction(id: string): Promise<ActionResult> {
  return lead(() => deleteItem(id), "Deleted");
}
export async function addPastDesignAction(ticketId: string): Promise<ActionResult> {
  return run(async () => {
    await addPastDesign(await assertLead(), ticketId);
    revalidatePath("/design", "layout");
  }, "Added to Past Designs");
}

/** For "Pick from library" on a ticket's proofs: the newest items matching a word, for anyone in the creative team. */
export async function libraryPickerAction(search: string): Promise<ActionResult<LibraryItemDto[]>> {
  return run(async () => {
    await assertTeam();
    return (await listItems({ search: search.slice(0, 100) })).slice(0, 60);
  });
}
export async function proofFromLibraryAction(ticketId: string, libraryFileId: string, note: string, send: boolean): Promise<ActionResult<{ version: number; link: string | null; emailedTo: string | null }>> {
  return run(async () => {
    const r = await proofFromLibrary(await assertTeam(), ticketId, libraryFileId, note, send);
    revalidatePath("/design", "layout");
    return r;
  });
}
