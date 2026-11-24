import { ok, readJson, route } from "@/lib/approvals/guard";
import { runImport } from "@/lib/approvals/historical/import";
import { importInput } from "../schemas";

export const dynamic = "force-dynamic";
// A large file is saved record by record.
export const maxDuration = 300;

/** Imports the file's records as archived tickets (the preview is worked out again here). Approvals admins only. */
export const POST = route({ roles: ["approvals_admin"] }, async ({ req, user }) => {
  const { fileName, text, decisions } = await readJson(req, importInput);
  return ok({ result: await runImport(user, fileName, text, decisions) });
});
