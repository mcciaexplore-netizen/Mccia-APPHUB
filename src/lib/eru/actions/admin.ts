"use server";

import { revalidatePath } from "next/cache";
import { assertAdmin, assertSuperAdmin, run, type ActionResult } from "../dal";
import * as A from "../admin";
import { checkStorage } from "../storage";
import { searchHubUsers, type Person } from "../host-adapter";

/** What ERU admins do in ERU Admin: the team, domains and settings; and the Support Admin's "Delete all data". */

const refresh = () => revalidatePath("/eru", "layout");

export async function searchUsersAction(q: string): Promise<ActionResult<Person[]>> {
  return run(async () => {
    await assertAdmin();
    return searchHubUsers(String(q ?? ""));
  });
}

export async function setMemberRoleAction(userId: string, role: "admin" | "member"): Promise<ActionResult<string>> {
  return run(async () => {
    const name = await A.setMemberRole(await assertAdmin(), userId, role);
    refresh();
    return name;
  });
}

export async function removeMemberAction(userId: string): Promise<ActionResult<string>> {
  return run(async () => {
    const name = await A.removeMember(await assertAdmin(), userId);
    refresh();
    return name;
  });
}

export async function updateDomainAction(id: string, patch: A.DomainPatch): Promise<ActionResult> {
  return run(async () => {
    await A.updateDomain(await assertAdmin(), id, patch);
    refresh();
  }, "Domain saved");
}

export async function saveGeneralAction(input: { trackChangesDefault: boolean }): Promise<ActionResult> {
  return run(async () => {
    await A.saveGeneral(await assertAdmin(), input);
    refresh();
  }, "Settings saved");
}

export async function checkStorageAction(): Promise<ActionResult<{ ok: boolean; message: string }>> {
  return run(async () => {
    await assertAdmin();
    return checkStorage();
  });
}

export async function deleteAllAction(confirm: string): Promise<ActionResult<{ projects: number }>> {
  return run(async () => {
    const r = await A.deleteAllData(await assertSuperAdmin(), confirm);
    refresh();
    return r;
  });
}
