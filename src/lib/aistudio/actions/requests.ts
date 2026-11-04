"use server";

import { revalidatePath } from "next/cache";
import type { FilePurpose } from "@/db/aistudio-schema";
import { assertRequester, assertTeam, run, type ActionResult } from "../dal";
import { startUpload } from "../files";
import { createRequest } from "../requests";
import type { RequestInput } from "../aistudio.manifest";

/** What a requester can do: upload files for a request and submit it. The team may also upload deliverables. */

/** A signed link to upload one file to. Request files: anyone with AI Studio; deliverables: the AI Studio team. */
export async function beginUpload(purpose: FilePurpose, fileName: string, size: number): Promise<ActionResult<{ fileId: string; uploadUrl: string; mime: string }>> {
  return run(async () => {
    const u = purpose === "attachment" ? await assertRequester() : await assertTeam();
    return startUpload(u.id, { purpose, fileName, size });
  });
}

export async function submitRequest(input: RequestInput): Promise<ActionResult<{ id: string; number: string }>> {
  return run(async () => {
    const r = await createRequest(await assertRequester(), input);
    revalidatePath("/aistudio", "layout");
    return r;
  });
}
