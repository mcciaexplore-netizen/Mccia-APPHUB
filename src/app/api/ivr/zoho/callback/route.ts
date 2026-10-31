import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/ivr/audit";
import { HttpError, assertUser } from "@/lib/ivr/dal";
import { ZohoError, completeConnection, verifyState } from "@/lib/ivr/zoho";

function back(req: NextRequest, params: Record<string, string>) {
  const url = new URL("/ivr/connections", req.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  try {
    const user = await assertUser();
    const sp = req.nextUrl.searchParams;
    if (sp.get("error")) {
      return back(req, { zoho: "error", reason: sp.get("error") === "access_denied" ? "Access was not granted in Zoho." : "Zoho returned an error." });
    }
    if (!verifyState(sp.get("state"), user.id)) {
      return back(req, { zoho: "error", reason: "The sign-in link expired or did not match your session. Try again." });
    }
    const code = sp.get("code");
    if (!code) return back(req, { zoho: "error", reason: "Zoho did not send a sign-in code." });
    const from = await completeConnection(user.id, code);
    await audit(user.id, "zoho.connect", user.id, { from });
    return back(req, { zoho: "connected" });
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) return NextResponse.redirect(new URL("/login", req.url));
    const reason = e instanceof ZohoError ? e.message : "Could not connect Zoho Mail.";
    return back(req, { zoho: "error", reason });
  }
}
