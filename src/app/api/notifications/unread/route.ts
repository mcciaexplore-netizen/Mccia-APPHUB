import { NextResponse } from "next/server";
import { noticeUnread } from "@/lib/notice-feed";
import { getCurrentUser } from "@/lib/permissions";
import { logError } from "@/lib/log-error";

export const dynamic = "force-dynamic";

/** How many notifications the signed-in person has not read (the hub's and the Approval System's), for the bell to keep itself current. */
// Called every few minutes by every open page: a database hiccup answers 503 (the bell keeps its last count and asks again later) instead
// of an unhandled error with a stack trace in the log each time.
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ ok: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ ok: true, unread: await noticeUnread(user.id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    logError("[hub] unread count failed", e);
    return NextResponse.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" } });
  }
}
