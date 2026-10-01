import "server-only";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { assertHeadAdmin } from "@/lib/permissions";
import type { User } from "@/db/schema";

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

/** Expected, user-facing failure. Anything else is logged and shown generically. */
export class UserError extends Error {}

function pgCode(e: unknown): string | undefined {
  const x = e as { code?: string; cause?: { code?: string } };
  return x?.code ?? x?.cause?.code;
}

/** Runs a head-admin-only mutation with uniform auth, validation and error handling. */
export async function adminAction<T = undefined>(fn: (admin: User) => Promise<T>): Promise<Result<T>> {
  try {
    const admin = await assertHeadAdmin();
    const data = await fn(admin);
    revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    if (e instanceof ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input" };
    if (pgCode(e) === "23505") return { ok: false, error: "That name or email already exists." };
    if (pgCode(e) === "23503") return { ok: false, error: "This item is still referenced elsewhere." };
    if (e instanceof Error && e.message === "Not allowed") return { ok: false, error: "Not allowed." };
    console.error(e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

