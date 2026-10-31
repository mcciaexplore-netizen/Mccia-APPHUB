import { NextResponse } from "next/server";
import { noticeUnread } from "@/lib/notice-feed";
import { getCurrentUser } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/** How many notifications the signed-in person has not read (the hub's and the Approval System's), for the bell to keep itself current. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ ok: true, unread: await noticeUnread(user.id) }, { headers: { "Cache-Control": "no-store" } });
}
