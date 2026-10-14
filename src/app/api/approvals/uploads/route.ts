import { startUpload } from "@/lib/approvals/files";
import { ok, readJson, route } from "@/lib/approvals/guard";
import { rateLimit } from "@/lib/approvals/ratelimit";
import { fileUploadStart } from "@/lib/approvals/request-schemas";

export const dynamic = "force-dynamic";

/** Step 1 of an upload: say which file is coming. The answer says how many parts to send and how big each may be. */
export const POST = route({}, async ({ req, user }) => {
  await rateLimit("upload-start", user.id, 60, 600);
  return ok(await startUpload(user, await readJson(req, fileUploadStart)), 201);
});
