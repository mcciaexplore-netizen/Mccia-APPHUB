import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { activityLog } from "@/db/schema";
import { getSsoTarget } from "@/lib/access";
import { clientIp } from "@/lib/ip";
import { logError } from "@/lib/log-error";
import { getCurrentUser } from "@/lib/permissions";
import { isSuper } from "@/lib/rbac";
import { SsoConfigError, buildClaims, loadSigningKey, signSsoToken } from "@/lib/sso";
import { autoPostHtml, launchHeaders, messageHeaders, messageHtml, newNonce } from "@/lib/sso-page";
import { callbackProblem, slugProblem, ssoTokenRole } from "@/lib/sso-rules";

export const dynamic = "force-dynamic";

const text = (body: string, status: number, extra: Record<string, string> = {}) =>
  new NextResponse(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...extra } });
const page = (title: string, message: string, status: number, backToHub = false) =>
  new NextResponse(messageHtml(title, message, backToHub), { status, headers: messageHeaders() });
const notSetUp = (code: string) => {
  // Only a short code is logged: never the key, the token or the callback address.
  console.error(`[sso] launch failed: ${code}`);
  return page("Single sign-on", "Single sign-on is not set up. Tell your administrator.", 500);
};

/**
 * Opens a single sign-on application: checks who is asking and that they may open it, records the launch, then answers with a page that
 * posts a short-lived signed token to the application's callback address (see src/lib/sso.ts). Signing in to the hub first is enforced by
 * src/proxy.ts, which sends anyone without a session to /login?next=/launch/<slug>; this checks again, because a session can outlive its person.
 * The token is only ever in the body of this one response, never in a URL or a log.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // A slug can only ever look like this (see slugProblem), so anything else is not worth a database read, and never goes into a sign-in address.
  if (slugProblem(slug)) return text("Not found", 404);
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(`/launch/${slug}`)}`, req.url), 302);
    // Someone still on a temporary password chooses their own first (the same as /go).
    if (user.mustChangePassword) return NextResponse.redirect(new URL("/change-password", req.url), 302);

    const target = await getSsoTarget(user, slug);
    // Unknown, not a single sign-on application, switched off, inactive: all the same plain answer.
    if (!target) return text("Not found", 404);
    // Nothing is issued and nothing is logged for someone who may not open it.
    if (!target.hasAccess) return page("No access", "You don't have access to this app. Ask your administrator.", 403, true);
    // Unavailable applications cannot be opened (the head admin still can, to test it). Nothing is logged: nothing was opened.
    if (target.status === "unavailable" && !isSuper(user)) {
      return text("This application is unavailable right now. Please try again later or ask your administrator.", 503, { "Retry-After": "600" });
    }

    // The same rules as when it was saved, again now: what is stored could have been changed behind the form's back.
    if (!target.callbackUrl || callbackProblem(target.callbackUrl, target.url)) return notSetUp("callback_invalid");
    const callback = new URL(target.callbackUrl);

    let token: string;
    try {
      const key = await loadSigningKey();
      token = await signSsoToken(key, buildClaims({ slug, user, role: ssoTokenRole(target.isAppAdmin) }));
    } catch (e) {
      return notSetUp(e instanceof SsoConfigError ? e.code : "sign_failed");
    }

    await db.insert(activityLog).values({ userId: user.id, appId: target.id, departmentId: target.departmentId, action: "launch", ipAddress: clientIp(req.headers) });

    const nonce = newNonce();
    return new NextResponse(autoPostHtml({ callback: callback.href, token, appName: target.name, nonce }), { status: 200, headers: launchHeaders(callback.origin, nonce) });
  } catch (e) {
    logError("[sso] launch failed", e);
    return page("Single sign-on", "Something went wrong. Please try again.", 500);
  }
}
