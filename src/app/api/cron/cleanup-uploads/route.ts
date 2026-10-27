import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { deleteOrphanUploads } from "@/lib/approvals/cleanup";

export const dynamic = "force-dynamic";

const digest = (v: string) => createHash("sha256").update(v).digest();

/**
 * Daily clean-up of abandoned uploads, called by Vercel Cron (vercel.json). Vercel sends "Authorization: Bearer <CRON_SECRET>"; anything
 * else is refused, and with no CRON_SECRET set the route refuses everyone, so it can never be run by a visitor.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const given = req.headers.get("authorization") ?? "";
  if (!secret || !timingSafeEqual(digest(given), digest(`Bearer ${secret}`))) return new NextResponse("Unauthorized", { status: 401 });
  try {
    const removed = await deleteOrphanUploads();
    console.log(`[cron] removed ${removed.files} abandoned upload(s), ${removed.bytes} bytes`);
    return NextResponse.json({ ok: true, ...removed });
  } catch (e) {
    console.error("[cron] upload clean-up failed:", e instanceof Error ? e.message : "unknown error");
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
