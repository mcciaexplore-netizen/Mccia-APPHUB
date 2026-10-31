import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/ivr/crypto";
import { env } from "@/lib/ivr/env";
import { ivrEnabled } from "@/lib/ivr/flags";
import { processWebhook } from "@/lib/ivr/smartflo/sync";

// Smartflo does not sign webhooks, so the URL itself carries a secret. Configure it in API Connect > Webhook. Smartflo cannot sign in, so
// src/proxy.ts lets /api/ivr/webhooks/ through without a hub session; this secret is the only gate.
async function handle(req: NextRequest, ctx: RouteContext<"/api/ivr/webhooks/smartflo/[secret]">) {
  if (!ivrEnabled()) return new NextResponse("Not found", { status: 404 });
  const { secret } = await ctx.params;
  const expected = env.webhookSecret;
  if (!expected || !safeEqual(secret, expected)) return new NextResponse("Not found", { status: 404 });

  let payload: Record<string, unknown> = {};
  if (req.method === "GET") {
    payload = Object.fromEntries(req.nextUrl.searchParams.entries());
  } else {
    const type = req.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      const body = await req.json().catch(() => ({}));
      payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    } else {
      const form = await req.formData().catch(() => null);
      if (form) payload = Object.fromEntries(form.entries());
    }
  }
  if (!Object.keys(payload).length) return NextResponse.json({ ok: true, ignored: true });

  try {
    await processWebhook(payload);
  } catch {
    // Stored in call_events with the error; the scheduled sync will repair the call. Answer 200 so Smartflo does not retry into a failing handler.
  }
  return NextResponse.json({ ok: true });
}

export const GET = handle;
export const POST = handle;
