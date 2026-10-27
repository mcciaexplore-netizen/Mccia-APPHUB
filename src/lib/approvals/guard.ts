import "server-only";
import { notFound, redirect } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { ApprovalsError } from "./errors";
import { approvalsEnabled } from "./flags";
import { administratorUnlocked, hasAnyRole, needsOwnPassword, resolveAccess, type ApprovalsRole, type ApprovalsUser } from "./host-adapter";
import { idSchema, kindSchema } from "./validation";
import { logError } from "@/lib/log-error";

/** For pages and layouts. Off, or not allowed for this role, looks like a page that does not exist; not signed in goes to the hub's sign-in. */
export async function requirePage(...anyOf: ApprovalsRole[]): Promise<ApprovalsUser> {
  if (!approvalsEnabled()) notFound();
  const a = await resolveAccess();
  if (a.status === "anonymous") redirect("/login");
  if (anyOf.length && !hasAnyRole(a.user, anyOf)) notFound();
  return a.user;
}

type Ctx<P> = { req: NextRequest; user: ApprovalsUser; params: P };

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
export function route<P extends Record<string, string> = Record<never, never>>(
  opts: { roles?: ApprovalsRole[] },
  fn: (c: Ctx<P>) => Promise<Response>,
) {
  return async (req: NextRequest, ctx: { params: Promise<P> }): Promise<Response> => {
    if (!approvalsEnabled()) return new NextResponse("Not found", { status: 404 });
    try {
      const a = await resolveAccess();
      if (a.status === "anonymous") return fail("Please sign in.", 401);
      if (await needsOwnPassword()) return fail("Choose your own password first: you are still using the temporary one.", 403);
      if (opts.roles?.length && !hasAnyRole(a.user, opts.roles)) return fail("Not allowed.", 403);
      const write = !["GET", "HEAD", "OPTIONS"].includes(req.method);
      if (write && !sameOrigin(req)) return fail("Not allowed.", 403);
      // The Support Admin's changes to the module (forms, categories, settings, access) need Administrator unlocked, like Administrator's own.
      if (write && opts.roles?.includes("approvals_admin") && !(await administratorUnlocked())) return fail("Administrator has locked. Open Administrator and enter your password again, then try once more.", 403);
      return await fn({ req, user: a.user, params: await ctx.params });
    } catch (e) {
      if (e instanceof ApprovalsError) return fail(e.message, e.status);
      if (e instanceof ZodError) return fail(e.issues[0]?.message ?? "Invalid input", 400, { issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
      if (pgCode(e) === "23505") return fail("That already exists.", 409);
      if (pgCode(e) === "23503") return fail("This item is still in use.", 409);
      logError("[approvals] request failed", e);
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
    throw new ApprovalsError("The request body must be JSON.");
  }
  return schema.parse(body);
}

export const ok = (data: object = {}, status = 200) => NextResponse.json({ ok: true, ...data }, { status });

/** URL segments that do not parse are a missing page, not a bad request. */
export const kindParam = (raw: string) => {
  const k = kindSchema.safeParse(raw);
  if (!k.success) throw new ApprovalsError("Unknown list.", 404);
  return k.data;
};
export const idParam = (raw: string) => {
  const id = idSchema.safeParse(raw);
  if (!id.success) throw new ApprovalsError("Not found.", 404);
  return id.data;
};
