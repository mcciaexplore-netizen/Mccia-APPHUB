import { NextResponse } from "next/server";
import { idParam, route } from "@/lib/inventory/guard";
import { hasAnyRole } from "@/lib/inventory/host-adapter";
import { STAFF_ROLES } from "@/lib/inventory/inventory.manifest";
import { getTicketPhoto } from "@/lib/inventory/maintenance";
import { checkPhoto } from "@/lib/inventory/photos";

export const dynamic = "force-dynamic";

/**
 * One photo of a ticket (?which=report or resolution), as the image itself. Only the person who raised the ticket and store staff may
 * see it; anyone else gets the same "not found" as for a ticket that does not exist. Never cached outside the browser.
 */
export const GET = route<{ id: string }>({}, async ({ req, user, params }) => {
  const which = req.nextUrl.searchParams.get("which") === "resolution" ? "resolution" : "report";
  const photo = await getTicketPhoto(idParam(params.id), which);
  const allowed = !!photo && (photo.raisedByUserId === user.id || hasAnyRole(user, STAFF_ROLES));
  const p = allowed ? checkPhoto(photo.dataUrl) : null;
  if (!p?.ok) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return new NextResponse(new Uint8Array(p.bytes), {
    headers: { "Content-Type": p.type, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'", "Content-Disposition": "inline" },
  });
});
