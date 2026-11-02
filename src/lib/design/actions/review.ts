"use server";

import { run, type ActionResult } from "../dal";
import { decideByToken } from "../approvals";
import { designEnabled } from "../flags";

/** The public review page's decision. No sign-in: the link's token is the key (rate-limited by its own unguessability and single use). */
export async function decideReview(token: string, decision: "approve" | "request_changes", comment: string): Promise<ActionResult<{ status: string; newNumber: string | null }>> {
  return run(async () => {
    if (!designEnabled()) throw new Error("Not found");
    return decideByToken(token, { decision, comment });
  });
}
