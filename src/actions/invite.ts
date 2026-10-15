"use server";

import { z } from "zod";
import { completeInvite } from "@/lib/invites";
import { passwordSchema } from "@/lib/passwords";

/** The one public action besides sign-in: a person with a valid one-time link chooses their own password. */
export async function finishSetup(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const v = z.object({ token: z.string().max(200), password: passwordSchema, again: z.string().max(200) }).parse(input);
    if (v.password !== v.again) return { ok: false, error: "The two passwords do not match." };
    if (!(await completeInvite(v.token, v.password))) return { ok: false, error: "This link has expired or was already used. Ask your administrator to send a new one." };
    return { ok: true };
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input" };
    console.error("finishSetup failed", e instanceof Error ? e.message : "unknown");
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
