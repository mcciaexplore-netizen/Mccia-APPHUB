import "server-only";
import { notFound, redirect } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { SECTION_ROLE, type CabSection } from "./cabs.manifest";
import { CabsError } from "./errors";
import { cabsEnabled } from "./flags";
import { hasAnyRole, hasRole, needsOwnPassword, resolveAccess, type CabRole, type CabUser } from "./host-adapter";
import { idSchema } from "./validation";
import { logError } from "@/lib/log-error";

/** Role protection for the Cab Booking module, the same shape as Inventory's (src/lib/inventory/guard.ts). */

/**
 * For pages and layouts of one section. Off looks like a page that does not exist; not signed in goes to the hub's sign-in; signed in
 * without that section's role goes back to the hub's home (it is a separate application there).
 */
async function requireSection(section: CabSection): Promise<CabUser> {
  if (!cabsEnabled()) notFound();
  const a = await resolveAccess();
  if (a.status === "anonymous") redirect("/login");
  if (await needsOwnPassword()) redirect("/change-password");
  if (!hasRole(a.user, SECTION_ROLE[section])) redirect("/");
  return a.user;
}
export const requireCabsPage = () => requireSection("staff");
export const requireDriverPage = () => requireSection("driver");
export const requireAdminPage = () => requireSection("admin");

/** The bare /cabs wrapper: only the switch. Each section's own layout checks who may open it. */
export function requireCabsEnabled() {
  if (!cabsEnabled()) notFound();
}

type Ctx<P> = { req: NextRequest; user: CabUser; params: P };

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
 */
export function route<P extends Record<string, string> = Record<never, never>>(opts: { roles: CabRole[] }, fn: (c: Ctx<P>) => Promise<Response>) {
  return async (req: NextRequest, ctx: { params: Promise<P> }): Promise<Response> => {
    if (!cabsEnabled()) return new NextResponse("Not found", { status: 404 });
    try {
      const a = await resolveAccess();
      if (a.status === "anonymous") return fail("Please sign in.", 401);
      if (await needsOwnPassword()) return fail("Choose your own password first: you are still using the temporary one.", 403);
      if (!hasAnyRole(a.user, opts.roles)) return fail("Not allowed.", 403);
      const write = !["GET", "HEAD", "OPTIONS"].includes(req.method);
      if (write && !sameOrigin(req)) return fail("Not allowed.", 403);
      return await fn({ req, user: a.user, params: await ctx.params });
    } catch (e) {
      if (e instanceof CabsError) return fail(e.message, e.status);
      if (e instanceof ZodError) return fail(e.issues[0]?.message ?? "Invalid input", 400, { issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
      if (pgCode(e) === "23505") return fail("That already exists.", 409);
      if (pgCode(e) === "23503") return fail("This is still in use.", 409);
      logError("[cabs] request failed", e);
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
    throw new CabsError("The request body must be JSON.");
  }
  return schema.parse(body);
}

export const ok = (data: object = {}, status = 200) => NextResponse.json({ ok: true, ...data }, { status });

/** A URL id that does not parse is a missing page, not a bad request. */
export const idParam = (raw: string) => {
  const id = idSchema.safeParse(raw);
  if (!id.success) throw new CabsError("Not found.", 404);
  return id.data;
};
