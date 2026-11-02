import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { designEnabled } from "@/lib/design/flags";
import { runJobs } from "@/lib/design/jobs";

export const maxDuration = 300;

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Vercel Cron, once a day, with `Authorization: Bearer $CRON_SECRET`: DesignDesk's scheduled jobs (edit windows, deadline warnings, review
// reminders and expiry, unused uploads). Between runs the jobs also run off normal traffic (src/lib/design/jobs.ts runIfDue). With no
// CRON_SECRET the route refuses everyone; while DesignDesk is switched off it does nothing, so the cron does not fail.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || !same(given, secret)) return new NextResponse("Unauthorized", { status: 401 });
  if (!designEnabled()) return NextResponse.json({ ok: true, skipped: "DesignDesk is switched off (DESIGN_ENABLED)." });
  return NextResponse.json({ ok: true, ...(await runJobs()) });
}
