import { NextResponse, type NextRequest } from "next/server";
import { HttpError, assertUser } from "@/lib/ivr/dal";
import { buildConsentUrl, zohoConfigured } from "@/lib/ivr/zoho";

export async function GET(req: NextRequest) {
  try {
    const user = await assertUser();
    if (!zohoConfigured()) return NextResponse.redirect(new URL("/ivr/connections?zoho=not-configured", req.url));
    return NextResponse.redirect(buildConsentUrl(user.id));
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) return NextResponse.redirect(new URL("/login", req.url));
    return NextResponse.redirect(new URL("/ivr/connections?zoho=error&reason=Could+not+start+Zoho+sign-in", req.url));
  }
}
