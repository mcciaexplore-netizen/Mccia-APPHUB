import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/ivr/crypto";
import { env } from "@/lib/ivr/env";
import { ivrEnabled } from "@/lib/ivr/flags";
import { runIncrementalSync, runSync } from "@/lib/ivr/smartflo/sync";
import { logError } from "@/lib/log-error";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Two callers, both with `Authorization: Bearer $CRON_SECRET`:
//  - Vercel Cron, once a day, with ?hours=48: a full reconcile that repairs anything a webhook or a tick missed.
//  - An optional external scheduler (cron-job.org etc.) every few minutes with no parameters: a cheap incremental sync.
//    Add ?force=1 to ignore the working-hours window.
// With no CRON_SECRET set the route refuses everyone, as the hub's other cron does, so it can never be run by a visitor. While IVR-CRM is
// switched off it does nothing (and says so), so the daily cron does not fail.
export async function GET(req: NextRequest) {
  const secret = env.cronSecret;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || !safeEqual(given, secret)) return new NextResponse("Unauthorized", { status: 401 });
  if (!ivrEnabled()) return NextResponse.json({ ok: true, skipped: "Membership CRM is switched off (IVR_ENABLED)." });
  const hours = Number(req.nextUrl.searchParams.get("hours"));
  try {
    if (hours > 0) {
      const result = await runSync({ hours: Math.min(hours, 24 * 90) });
      console.log(`[cron] ivr full sync (${Math.min(hours, 24 * 90)}h): ${result.ok ? "ok" : "failed"}`);
      return NextResponse.json(result, { status: result.ok ? 200 : 502 });
    }
    const result = await runIncrementalSync({ force: req.nextUrl.searchParams.get("force") === "1" });
    if (result.ran) console.log(`[cron] ivr incremental sync: ${result.ok ? "ok" : "failed"}`);
    return NextResponse.json(result, { status: result.ran && !result.ok ? 502 : 200 });
  } catch (e) {
    logError("[cron] ivr sync failed", e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
