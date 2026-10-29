import "server-only";
import { notFound, redirect } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { InventoryError } from "./errors";
import { inventoryEnabled } from "./flags";
import { administratorUnlocked, hasAnyRole, needsOwnPassword, resolveAccess, type InventoryRole, type InventoryUser } from "./host-adapter";
import { logError } from "@/lib/log-error";

/**
 * Role protection for the Inventory module, the same shape as the Approval System's (src/lib/approvals/guard.ts): requirePage for pages
 * and layouts, route for API handlers.
 */

/** For pages and layouts. Off, or not allowed for this role, looks like a page that does not exist; not signed in goes to the hub's sign-in. */
export async function requirePage(...anyOf: InventoryRole[]): Promise<InventoryUser> {
  if (!inventoryEnabled()) notFound();
  const a = await resolveAccess();
  if (a.status === "anonymous") redirect("/login");
  if (await needsOwnPassword()) redirect("/change-password");
  if (anyOf.length && !hasAnyRole(a.user, anyOf)) notFound();
  return a.user;
}

type Ctx<P> = { req: NextRequest; user: InventoryUser; params: P };

const pgCode = (e: unknown): string | undefined => {
  const x = e as { code?: string; cause?: { code?: string } };
  return x?.code ?? x?.cause?.code;
};
const fail = (error: string, status: number, extra?: object) => NextResponse.json({ error, ...extra }, { status });

/** A write that did not come from this site (a form on another origin riding the person's cookie) is refused. */
function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // not a browser cross-site request
  try {
    return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
  } catch {
    return false;
  }
}

/**
 * Wraps every route handler: 404 when the module is off, 401/403 for people who may not be here, a same-origin check on writes, and one
 * place that turns validation and database errors into clean JSON. `roles` lists the roles that may call it (any one is enough).
 * An inventory_admin-only write also needs Administrator unlocked, like the hub's own admin changes.
 */
export function route<P extends Record<string, string> = Record<never, never>>(
  opts: { roles?: InventoryRole[] },
  fn: (c: Ctx<P>) => Promise<Response>,
) {
  return async (req: NextRequest, ctx: { params: Promise<P> }): Promise<Response> => {
    if (!inventoryEnabled()) return new NextResponse("Not found", { status: 404 });
    try {
      const a = await resolveAccess();
      if (a.status === "anonymous") return fail("Please sign in.", 401);
      if (await needsOwnPassword()) return fail("Choose your own password first: you are still using the temporary one.", 403);
      if (opts.roles?.length && !hasAnyRole(a.user, opts.roles)) return fail("Not allowed.", 403);
      const write = !["GET", "HEAD", "OPTIONS"].includes(req.method);
      if (write && !sameOrigin(req)) return fail("Not allowed.", 403);
      const adminOnly = !!opts.roles?.length && opts.roles.every((r) => r === "inventory_admin");
      if (write && adminOnly && !(await administratorUnlocked())) return fail("Administrator has locked. Open Administrator and enter your password again, then try once more.", 403);
      return await fn({ req, user: a.user, params: await ctx.params });
    } catch (e) {
      if (e instanceof InventoryError) return fail(e.message, e.status);
      if (e instanceof ZodError) return fail(e.issues[0]?.message ?? "Invalid input", 400, { issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
      if (pgCode(e) === "23505") return fail("That already exists.", 409);
      if (pgCode(e) === "23503") return fail("This item is still in use.", 409);
      logError("[inventory] request failed", e);
      return fail("Something went wrong. Please try again.", 500);
    }
  };
}

/** Reads and validates a JSON body. Throws a 400 the wrapper above turns into a clean error. */
export async function readJson<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new InventoryError("The request body must be JSON.");
  }
  return schema.parse(body);
}

export const ok = (data: object = {}, status = 200) => NextResponse.json({ ok: true, ...data }, { status });
