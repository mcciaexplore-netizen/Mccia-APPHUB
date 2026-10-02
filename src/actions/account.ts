"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/permissions";
import { hashPassword, passwordSchema, verifyPassword } from "@/lib/passwords";

type Result = { ok: true } | { ok: false; error: string };

/** Any signed-in user changing their own password. Also clears the first-login "must change" flag. */
export async function changePassword(input: unknown): Promise<Result> {
  try {
    const me = await getCurrentUser();
    if (!me) return { ok: false, error: "Please sign in again." };
    const v = z
      .object({ current: z.string().min(1, "Enter your current password"), next: passwordSchema })
      .parse(input);
    if (!me.passwordHash || !(await verifyPassword(v.current, me.passwordHash))) {
      return { ok: false, error: "Current password is incorrect." };
    }
    if (v.current === v.next) return { ok: false, error: "Choose a password different from the current one." };
    await db.update(users).set({ passwordHash: await hashPassword(v.next), mustChangePassword: false }).where(eq(users.id, me.id));
    return { ok: true };
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input" };
    console.error(e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
