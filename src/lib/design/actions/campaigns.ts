"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { assertRequester, run, type ActionResult } from "../dal";
import { deleteCampaign, deletePost, saveCampaign, savePost, type campaignInput, type postInput } from "../campaigns";

/** Campaigns (design leads) and social posts (anyone signed in; their own, or any for a lead). */

const act = <T>(fn: (u: Awaited<ReturnType<typeof assertRequester>>) => Promise<T>, message?: string) =>
  run(async () => {
    const u = await assertRequester();
    const r = await fn(u);
    revalidatePath("/design/campaigns");
    return r;
  }, message);

export async function saveCampaignAction(id: string | null, input: z.input<typeof campaignInput>): Promise<ActionResult<string>> {
  return act((u) => saveCampaign(u, id, input), "Campaign saved");
}
export async function deleteCampaignAction(id: string): Promise<ActionResult> {
  return act((u) => deleteCampaign(u, id), "Campaign deleted");
}
export async function savePostAction(id: string | null, input: z.input<typeof postInput>): Promise<ActionResult<string>> {
  return act((u) => savePost(u, id, input), "Post saved");
}
export async function deletePostAction(id: string): Promise<ActionResult> {
  return act((u) => deletePost(u, id), "Post deleted");
}
