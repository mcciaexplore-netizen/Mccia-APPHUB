import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { activityLog } from "@/db/schema";
import { getCurrentUser } from "@/lib/permissions";
import { getLaunchTarget } from "@/lib/access";
import { isSuper } from "@/lib/rbac";
import { clientIp } from "@/lib/ip";

export const dynamic = "force-dynamic";

/** Resolves the app on the server, logs the launch, then redirects. Unknown or inactive apps get a plain 404. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  if (!z.string().uuid().safeParse(appId).success) return new NextResponse("Not found", { status: 404 });

  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url), 302);

  const target = await getLaunchTarget(user, appId);
  // Unknown, inactive, and "not yours" all get the same answer, so nobody learns which applications exist.
  if (!target) return new NextResponse("You do not have access to this application, or it does not exist. If you think you should have access, ask your administrator.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  // An application marked unavailable cannot be opened (the head admin still can, to test it). Nothing is logged: nothing was opened.
  if (target.status === "unavailable" && !isSuper(user)) {
    return new NextResponse("This application is unavailable right now. Please try again later or ask your administrator.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "600" } });
  }

  await db.insert(activityLog).values({
    userId: user.id,
    appId: target.id,
    departmentId: target.departmentId,
    action: "launch",
    ipAddress: clientIp(req.headers),
  });
  // A built-in app is stored as a path on this site (for example /approvals); redirect() needs a full address.
  return NextResponse.redirect(new URL(target.url, req.url), 302);
}
