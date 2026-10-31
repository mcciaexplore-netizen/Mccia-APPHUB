import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { activityLog } from "@/db/schema";
import { getCurrentUser } from "@/lib/permissions";
import { getLaunchTarget } from "@/lib/access";
import { isSuper } from "@/lib/rbac";
import { clientIp } from "@/lib/ip";
import { sitePath } from "@/lib/site-url";

export const dynamic = "force-dynamic";

const NO_ACCESS = "You do not have access to this application, or it does not exist. If you think you should have access, ask your administrator.";
const UNAVAILABLE = "This application is unavailable right now. Please try again later or ask your administrator.";
const text = (body: string, status: number, extra: Record<string, string> = {}) =>
  new NextResponse(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...extra } });

/**
 * The checks every launch goes through, in order: a real id, someone signed in who has chosen their own password, an application they may
 * open, and one that is not marked unavailable (the head admin still can, to test it). Either the application, or the answer to give.
 */
async function resolve(req: NextRequest, appId: string) {
  if (!z.string().uuid().safeParse(appId).success) return { stop: new NextResponse("Not found", { status: 404 }) };
  const user = await getCurrentUser();
  if (!user) return { stop: NextResponse.redirect(new URL("/login", req.url), 302) };
  // Someone still on a temporary password chooses their own first.
  if (user.mustChangePassword) return { stop: NextResponse.redirect(new URL("/change-password", req.url), 302) };
  const target = await getLaunchTarget(user, appId);
  // Unknown, inactive, and "not yours" all get the same answer, so nobody learns which applications exist.
  if (!target) return { stop: text(NO_ACCESS, 404) };
  return { user, target };
}

const logLaunch = (req: NextRequest, userId: string, target: { id: string; departmentId: string }) =>
  db.insert(activityLog).values({ userId, appId: target.id, departmentId: target.departmentId, action: "launch", ipAddress: clientIp(req.headers) });

/** Resolves the app on the server, logs the launch, then redirects. Unknown or inactive apps get a plain 404. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ appId: string }> }) {
  const r = await resolve(req, (await params).appId);
  if (r.stop) return r.stop;
  const { user, target } = r;
  // An application with single sign-on is opened through /launch/<slug>, which checks everything again, logs the launch and signs the person in.
  if (target.ssoEnabled && target.ssoSlug) return NextResponse.redirect(new URL(`/launch/${target.ssoSlug}`, req.url), 302);
  // An application marked unavailable cannot be opened. Nothing is logged: nothing was opened.
  if (target.status === "unavailable" && !isSuper(user)) return text(UNAVAILABLE, 503, { "Retry-After": "600" });
  await logLaunch(req, user.id, target);
  // A built-in app is stored as a path on this site (for example /approvals); redirect() needs a full address.
  return NextResponse.redirect(new URL(target.url, req.url), 302);
}

/**
 * Records the launch of an application built into the hub, whose card opens its page directly instead of coming here (see LaunchLink).
 * The same checks as GET; only this site's own pages may send it, and only for an application that really is a page of this site.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ appId: string }> }) {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return new NextResponse(null, { status: 403 });
  const r = await resolve(req, (await params).appId);
  if (r.stop) return r.stop.status >= 300 && r.stop.status < 400 ? new NextResponse(null, { status: 401 }) : new NextResponse(null, { status: r.stop.status });
  const { user, target } = r;
  if (!sitePath(target.url) || (target.ssoEnabled && target.ssoSlug)) return new NextResponse(null, { status: 404 });
  if (target.status === "unavailable" && !isSuper(user)) return new NextResponse(null, { status: 503 });
  await logLaunch(req, user.id, target);
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
