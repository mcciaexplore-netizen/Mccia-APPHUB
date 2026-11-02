"use server";

import { revalidatePath } from "next/cache";
import type { FilePurpose } from "@/db/design-schema";
import { assertRequester, assertTeam, run, type ActionResult } from "../dal";
import { startUpload } from "../files";
import { createRequest } from "../tickets";
import { decideAsRequester } from "../approvals";
import { cdrDownloadLink, requestCdr } from "../cdr";
import type { RequestInput } from "../form";

/** What any signed-in hub user can do: upload files, submit a request, decide on a design, ask for and download source files. */

const refresh = () => revalidatePath("/design", "layout");

/** A signed link to upload one file to. Request files and post images: anyone; proofs, source files and library files: the team. */
export async function beginUpload(purpose: FilePurpose, fileName: string, size: number): Promise<ActionResult<{ fileId: string; uploadUrl: string; mime: string }>> {
  return run(async () => {
    const u = purpose === "attachment" || purpose === "post_image" ? await assertRequester() : await assertTeam();
    return startUpload(u.id, { purpose, fileName, size });
  });
}

export async function submitRequest(input: RequestInput): Promise<ActionResult<{ id: string; number: string; trackingUrl: string }>> {
  return run(async () => {
    const u = await assertRequester();
    const r = await createRequest(u, input);
    refresh();
    return r;
  });
}

export async function decideMyRequest(ticketId: string, decision: "approve" | "request_changes", comment: string): Promise<ActionResult<{ status: string; newNumber: string | null }>> {
  return run(async () => {
    const u = await assertRequester();
    const r = await decideAsRequester(u, ticketId, { decision, comment });
    refresh();
    return r;
  });
}

export async function requestSourceFiles(ticketId: string): Promise<ActionResult> {
  return run(async () => {
    const u = await assertRequester();
    await requestCdr(u, ticketId, true);
    refresh();
    return undefined;
  }, "Asked for the source files. You will be told when they are ready.");
}

export async function sourceFileLink(requestId: string): Promise<ActionResult<string>> {
  return run(async () => cdrDownloadLink(await assertRequester(), requestId));
}
