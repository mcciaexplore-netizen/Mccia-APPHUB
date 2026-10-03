import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { activityLog } from "@/db/schema";
import { getCurrentUser } from "@/lib/permissions";
import { getLaunchTarget } from "@/lib/access";
import { clientIp } from "@/lib/ip";

export const dynamic = "force-dynamic";

/** Resolves the app on the server, logs the launch, then redirects. Unknown or inactive apps get a plain 404. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  if (!z.string().uuid().safeParse(appId).success) return new NextResponse("Not found", { status: 404 });

  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url), 302);

  const target = await getLaunchTarget(user, appId);
  if (!target) return new NextResponse("Not found", { status: 404 });

  await db.insert(activityLog).values({
    userId: user.id,
    appId: target.id,
    departmentId: target.departmentId,
    action: "launch",
    ipAddress: clientIp(req.headers),
  });
  return NextResponse.redirect(target.url, 302);
}
