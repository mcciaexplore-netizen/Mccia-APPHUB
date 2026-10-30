import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Keep-warm ping, called once a day by Vercel Cron (vercel.json) so a server instance is ready when someone opens the hub. Open to
 * anyone (the proxy lets it through without a sign-in) and touches nothing: no database, no session, nothing secret in the answer.
 */
export function GET() {
  return NextResponse.json({ ok: true, time: new Date().toISOString() });
}
