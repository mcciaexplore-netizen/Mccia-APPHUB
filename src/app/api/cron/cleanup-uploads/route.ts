import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { deleteOrphanUploads } from "@/lib/approvals/cleanup";
import { deleteOldLocations } from "@/lib/cabs/tracking";

export const dynamic = "force-dynamic";

const digest = (v: string) => createHash("sha256").update(v).digest();

/**
 * Daily clean-up, called by Vercel Cron (vercel.json): abandoned uploads, and Cab Booking drivers' positions older than 24 hours. Vercel sends "Authorization: Bearer <CRON_SECRET>"; anything
 * else is refused, and with no CRON_SECRET set the route refuses everyone, so it can never be run by a visitor.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const given = req.headers.get("authorization") ?? "";
  if (!secret || !timingSafeEqual(digest(given), digest(`Bearer ${secret}`))) return new NextResponse("Unauthorized", { status: 401 });
  // Each clean-up on its own, so one failing (Cab Booking's tables not created yet, say) never stops the other.
  let locations: number | null = null;
  try {
    locations = await deleteOldLocations();
    console.log(`[cron] removed ${locations} driver position(s) older than 24 hours`);
  } catch (e) {
    console.error("[cron] driver position clean-up failed:", e instanceof Error ? e.message : "unknown error");
  }
  try {
    const removed = await deleteOrphanUploads();
    console.log(`[cron] removed ${removed.files} abandoned upload(s), ${removed.bytes} bytes`);
    return NextResponse.json({ ok: true, ...removed, locations });
  } catch (e) {
    console.error("[cron] upload clean-up failed:", e instanceof Error ? e.message : "unknown error");
    return NextResponse.json({ ok: false, locations }, { status: 500 });
  }
}
