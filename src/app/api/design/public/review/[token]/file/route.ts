import { NextResponse, type NextRequest } from "next/server";
import { designEnabled } from "@/lib/design/flags";
import { reviewFileByToken } from "@/lib/design/approvals";
import { fileLink } from "@/lib/design/files";
import { StorageError } from "@/lib/design/storage";

// The design behind a review link (no sign-in: the link itself is the key). Works while the review is open, and for 7 days after a
// decision so the requester can still download what they approved. A redirect to a 60-second signed link.
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!designEnabled()) return new NextResponse("Not found", { status: 404 });
  try {
    const { token } = await params;
    const f = await reviewFileByToken(token);
    if (!f) return new NextResponse("This link has expired or is not valid.", { status: 410 });
    const url = await fileLink(f, req.nextUrl.searchParams.get("download") !== "1");
    return NextResponse.redirect(url, { status: 302, headers: { "cache-control": "private, no-store", "referrer-policy": "no-referrer" } });
  } catch (e) {
    if (e instanceof StorageError) return new NextResponse(e.message, { status: 502 });
    return new NextResponse("Error", { status: 500 });
  }
}
