import { NextResponse } from "next/server";
import { getStoredFile, readFileStream } from "@/lib/approvals/files";
import { idParam, route } from "@/lib/approvals/guard";
import { attachmentForDownload } from "@/lib/approvals/request-queries";

export const dynamic = "force-dynamic";

const INLINE = new Set(["application/pdf", "image/png", "image/jpeg"]);

/**
 * Downloads an attachment (by attachment id). Only people who may see the request get it: the person who raised it, its approvers,
 * the DG, viewers and admins. Everyone else gets the same "not found" as for a file that does not exist. ?download=1 forces a save.
 */
export const GET = route<{ id: string }>({}, async ({ req, user, params }) => {
  const a = await attachmentForDownload(user, idParam(params.id));
  const file = a ? await getStoredFile(a.storageKey) : null;
  if (!a || !file) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const inline = INLINE.has(a.mime) && req.nextUrl.searchParams.get("download") !== "1";
  const encoded = encodeURIComponent(a.fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return new NextResponse(readFileStream(file), {
    headers: {
      "Content-Type": a.mime,
      "Content-Length": String(file.size),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${a.fileName.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encoded}`,
      "Cache-Control": "private, no-store",
    },
  });
});
