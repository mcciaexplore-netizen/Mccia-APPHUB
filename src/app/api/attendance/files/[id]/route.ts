import { NextResponse, type NextRequest } from "next/server";
import { HttpError, assertMember } from "@/lib/attendance/dal";
import { leaveAttachmentFor } from "@/lib/attendance/approvals";
import { signedDownloadUrl, StorageError } from "@/lib/attendance/storage";

// Never run at build time: every request reads the database (and who is asking).
export const dynamic = "force-dynamic";

// A leave request's supporting document, for its owner, the person it was sent to, or HR: a redirect to a signed link that works for 60
// seconds (shown in the page, not downloaded). The id is the leave request's.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const u = await assertMember();
    const { id } = await params;
    const f = await leaveAttachmentFor({ id: u.id, hr: u.admin }, id);
    if (!f) return new NextResponse("Not found", { status: 404 });
    const url = await signedDownloadUrl(f.key, f.name, true);
    return NextResponse.redirect(url, { status: 302, headers: { "cache-control": "private, no-store" } });
  } catch (e) {
    if (e instanceof HttpError) return new NextResponse(e.message, { status: e.status });
    if (e instanceof StorageError) return new NextResponse(e.message, { status: 502 });
    return new NextResponse("Error", { status: 500 });
  }
}
