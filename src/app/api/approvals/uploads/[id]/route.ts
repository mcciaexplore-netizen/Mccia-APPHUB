import { ApprovalsError } from "@/lib/approvals/errors";
import { putChunk } from "@/lib/approvals/files";
import { idParam, ok, route } from "@/lib/approvals/guard";
import { rateLimit } from "@/lib/approvals/ratelimit";
import { CHUNK_BYTES } from "@/lib/approvals/request-schemas";

export const dynamic = "force-dynamic";

/** Step 2 of an upload: one part of the file as the raw request body, with its position in ?i= (starting at 0). */
export const PUT = route<{ id: string }>({}, async ({ req, user, params }) => {
  const id = idParam(params.id);
  if (Number(req.headers.get("content-length") ?? 0) > CHUNK_BYTES + 1024) throw new ApprovalsError("That part of the file is too large.", 413);
  await rateLimit("upload-chunk", user.id, 400, 600);
  const index = Number(req.nextUrl.searchParams.get("i"));
  await putChunk(user, id, index, Buffer.from(await req.arrayBuffer()));
  return ok();
});
