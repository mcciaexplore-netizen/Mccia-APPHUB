import { NextResponse, type NextRequest } from "next/server";
import { HttpError, assertRequester } from "@/lib/aistudio/dal";
import { fileById, fileLink } from "@/lib/aistudio/files";
import { canOpenFile } from "@/lib/aistudio/requests";
import { StorageError } from "@/lib/aistudio/storage";

// A stored file, for someone allowed to see it (see canOpenFile): a redirect to a signed link that works for 60 seconds. ?inline=1 shows
// an image or PDF in the page instead of downloading it.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const u = await assertRequester();
    const { id } = await params;
    const f = /^[0-9a-f-]{36}$/i.test(id) ? await fileById(id) : null;
    if (!f || !(await canOpenFile(u, id))) return new NextResponse("Not found", { status: 404 });
    const url = await fileLink(f, req.nextUrl.searchParams.get("inline") === "1");
    return NextResponse.redirect(url, { status: 302, headers: { "cache-control": "private, no-store" } });
  } catch (e) {
    if (e instanceof HttpError) return new NextResponse(e.message, { status: e.status });
    if (e instanceof StorageError) return new NextResponse(e.message, { status: 502 });
    return new NextResponse("Error", { status: 500 });
  }
}
