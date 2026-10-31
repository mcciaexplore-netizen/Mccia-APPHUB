"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assignLeads } from "@/lib/ivr/assign";
import { HttpError, assertAdmin } from "@/lib/ivr/dal";

const input = z.object({
  leadIds: z.array(z.uuid()).min(1, "Select at least one lead.").max(5000, "Assign at most 5,000 leads at a time."),
  mode: z.enum(["one", "split", "balanced"]),
  agentIds: z.array(z.uuid()).min(1, "Pick at least one agent.").max(100),
  reason: z.string().trim().max(300).optional(),
});

export type AssignActionResult =
  | { ok: true; count: number; perAgent: { name: string; count: number }[] }
  | { ok: false; error: string };

export async function assignLeadsAction(raw: z.input<typeof input>): Promise<AssignActionResult> {
  try {
    const admin = await assertAdmin();
    const parsed = input.safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
    const res = await assignLeads({ ...parsed.data, byUserId: admin.id });
    for (const p of ["/ivr/admin/members", "/ivr/admin", "/ivr", "/ivr/pipeline"]) revalidatePath(p);
    return { ok: true, count: res.count, perAgent: res.perAgent.map((a) => ({ name: a.name, count: a.count })) };
  } catch (e) {
    if (e instanceof HttpError) return { ok: false, error: e.status === 403 ? "Only admins can assign leads." : "Sign in again to continue." };
    return { ok: false, error: e instanceof Error ? e.message : "Could not assign the leads." };
  }
}
