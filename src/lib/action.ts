import "server-only";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { assertArea, assertHeadAdmin, assertStaff } from "@/lib/permissions";
import type { AdminArea } from "@/lib/rbac";
import { UserError } from "@/lib/user-error";
import type { User } from "@/db/schema";
import { logError } from "@/lib/log-error";

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export { UserError };

function pgCode(e: unknown): string | undefined {
  const x = e as { code?: string; cause?: { code?: string } };
  return x?.code ?? x?.cause?.code;
}

async function guarded<T>(who: () => Promise<User>, fn: (actor: User) => Promise<T>): Promise<Result<T>> {
  try {
    const actor = await who();
    const data = await fn(actor);
    revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    if (e instanceof ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input" };
    if (pgCode(e) === "23505") return { ok: false, error: "That name or email already exists." };
    if (pgCode(e) === "23503") return { ok: false, error: "This item is still referenced elsewhere." };
    if (e instanceof Error && e.message === "Not allowed") return { ok: false, error: "Not allowed." };
    logError("[hub] action failed", e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/**
 * Runs an administrator mutation with uniform auth, validation and error handling. With an area, an Admin who has been given that area
 * may run it as well as the two top roles; without one, only the Support Admin and the Super Admin can. Anything finer (whose account it
 * touches, what may be changed) is decided by the function it calls, using src/lib/rbac.ts.
 */
export function adminAction<T = undefined>(fn: (admin: User) => Promise<T>): Promise<Result<T>>;
export function adminAction<T = undefined>(area: AdminArea, fn: (admin: User) => Promise<T>): Promise<Result<T>>;
export function adminAction<T = undefined>(a: AdminArea | ((admin: User) => Promise<T>), fn?: (admin: User) => Promise<T>): Promise<Result<T>> {
  return typeof a === "function" ? guarded(assertHeadAdmin, a) : guarded(() => assertArea(a), fn!);
}

/**
 * Runs a mutation that team managers may also use (an administrator with Users & access, unlocked, or a team manager). It only proves who is asking:
 * what that person may touch is decided by the functions it calls, using src/lib/rbac.ts.
 */
export const staffAction = <T = undefined>(fn: (actor: User) => Promise<T>) => guarded(assertStaff, fn);
