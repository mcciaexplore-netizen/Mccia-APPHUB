import { ok, readJson, route } from "@/lib/approvals/guard";
import { previewImport } from "@/lib/approvals/historical/import";
import { fileInput } from "../schemas";

export const dynamic = "force-dynamic";

/** Reads an uploaded file of old approval records and reports what an import would do. Writes nothing. Approvals admins only. */
export const POST = route({ roles: ["approvals_admin"] }, async ({ req }) => {
  const { fileName, text } = await readJson(req, fileInput);
  return ok({ preview: await previewImport(fileName, text) });
});
