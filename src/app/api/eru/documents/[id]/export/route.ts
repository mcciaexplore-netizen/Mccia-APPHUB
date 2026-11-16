import { NextResponse } from "next/server";
import { HttpError, assertMember } from "@/lib/eru/dal";
import { docxFileName, exportDocx } from "@/lib/eru/docx-export";
import { logError } from "@/lib/eru/host-adapter";
import { documentContent } from "@/lib/eru/queries";

// Never run at build time: every request reads the database (and who is asking).
export const dynamic = "force-dynamic";

// A document as a Word file, as last saved (pending tracked changes as if accepted, no comments), for anyone in the ERU team.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertMember();
    const { id } = await params;
    const d = await documentContent(id);
    if (!d) return new NextResponse("Not found", { status: 404 });
    const body = await exportDocx(d.title, d.content);
    const name = docxFileName(d.title);
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "content-disposition": `attachment; filename="${name.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof HttpError) return new NextResponse(e.message, { status: e.status });
    logError("[eru] export failed", e);
    return new NextResponse("The document could not be exported.", { status: 500 });
  }
}
