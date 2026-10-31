"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/ivr/db";
import { allocationRules, callCategories } from "@/db/ivr-schema";
import { audit } from "@/lib/ivr/audit";
import { assertAdmin } from "@/lib/ivr/dal";
import { saveRetryRule } from "@/lib/ivr/settings";
import type { ActionResult } from "./leads";

const fail = (e: unknown): ActionResult => ({ ok: false, error: e instanceof Error ? e.message : "Something went wrong" });

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);

const categorySchema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().trim().min(2, "Enter a category name").max(80),
  appliesTo: z.enum(["inbound", "outbound", "both"]),
  ivrKey: z.string().trim().max(1, "The IVR key is a single digit or character").optional(),
  active: z.boolean(),
});

export async function saveCategory(input: z.input<typeof categorySchema>): Promise<ActionResult> {
  try {
    const me = await assertAdmin();
    const p = categorySchema.safeParse(input);
    if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check the form" };
    const ivrKey = p.data.ivrKey || null;
    if (ivrKey && p.data.appliesTo === "outbound") return { ok: false, error: "An IVR key only makes sense for inbound or both." };
    if (p.data.id) {
      await db
        .update(callCategories)
        .set({ label: p.data.label, appliesTo: p.data.appliesTo, ivrKey, active: p.data.active })
        .where(eq(callCategories.id, p.data.id));
      await audit(me.id, "category.update", p.data.id);
    } else {
      const key = slug(p.data.label);
      if (!key) return { ok: false, error: "Use letters or numbers in the name." };
      const [dupe] = await db.select({ id: callCategories.id }).from(callCategories).where(eq(callCategories.key, key)).limit(1);
      if (dupe) return { ok: false, error: "A category with that name already exists." };
      const all = await db.select({ sort: callCategories.sort }).from(callCategories);
      const [row] = await db
        .insert(callCategories)
        .values({ key, label: p.data.label, appliesTo: p.data.appliesTo, ivrKey, active: p.data.active, sort: all.length })
        .returning({ id: callCategories.id });
      await audit(me.id, "category.create", row.id);
    }
    revalidatePath("/ivr/admin/categories");
    return { ok: true, message: "Saved" };
  } catch (e) {
    return fail(e);
  }
}

/** Agents who receive members of this category when an import row names no agent. Empty list removes the rule. */
export async function saveAllocationRule(categoryId: string, userIds: string[]): Promise<ActionResult> {
  try {
    const me = await assertAdmin();
    const id = z.string().uuid().safeParse(categoryId);
    const ids = z.array(z.string().uuid()).max(100).safeParse(userIds);
    if (!id.success || !ids.success) return { ok: false, error: "Check the selection." };
    await db.delete(allocationRules).where(eq(allocationRules.categoryId, id.data));
    if (ids.data.length) {
      await db.insert(allocationRules).values([...new Set(ids.data)].map((userId) => ({ categoryId: id.data, userId })));
    }
    await audit(me.id, "category.allocation", id.data, { agents: ids.data.length });
    revalidatePath("/ivr/admin/categories");
    return { ok: true, message: "Allocation saved" };
  } catch (e) {
    return fail(e);
  }
}

const retrySchema = z.object({
  maxAttempts: z.number().int().min(1).max(20),
  minGapHours: z.number().int().min(0).max(168),
});

export async function saveRetry(input: z.input<typeof retrySchema>): Promise<ActionResult> {
  try {
    const me = await assertAdmin();
    const p = retrySchema.safeParse(input);
    if (!p.success) return { ok: false, error: "Tries must be 1 to 20 and the gap 0 to 168 hours." };
    await saveRetryRule(p.data);
    await audit(me.id, "settings.retry", undefined, p.data);
    revalidatePath("/ivr/admin/categories");
    revalidatePath("/ivr");
    return { ok: true, message: "Retry rule saved" };
  } catch (e) {
    return fail(e);
  }
}
