import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { attEnabled } from "@/lib/attendance/flags";
import { sendReminders } from "@/lib/attendance/jobs";

export const maxDuration = 300;

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Vercel Cron, every 15 minutes in office hours (vercel.json), with `Authorization: Bearer $CRON_SECRET`: Attendance's check-in and
// check-out reminders (src/lib/attendance/jobs.ts; each person gets each reminder at most once a day). With no CRON_SECRET the route refuses
// everyone; while Attendance is switched off it does nothing, so the cron does not fail.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || !same(given, secret)) return new NextResponse("Unauthorized", { status: 401 });
  if (!attEnabled()) return NextResponse.json({ ok: true, skipped: "Attendance is switched off (ATT_ENABLED)." });
  return NextResponse.json({ ok: true, ...(await sendReminders()) });
}
