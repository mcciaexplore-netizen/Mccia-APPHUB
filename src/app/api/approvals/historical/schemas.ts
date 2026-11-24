import { z } from "zod";
import { MAX_IMPORT_BYTES } from "@/lib/approvals/historical/rules";

/** An uploaded file, sent as text with its name. Its size is checked again when it is read. */
export const fileInput = z.object({
  fileName: z.string().trim().min(1).max(200).transform((s) => s.replace(/[\u0000-\u001f\u007f"\\/]/g, "")),
  text: z.string().min(2, "The file is empty").max(MAX_IMPORT_BYTES, "The file is larger than 4 MB. Split it into smaller files."),
});

/** For each source category (by its normalised name): file it under a hub category, or add it as a new inactive one. */
export const importInput = fileInput.extend({
  decisions: z.record(
    z.string().max(200),
    z.union([z.object({ categoryId: z.string().uuid() }).strict(), z.object({ create: z.literal(true) }).strict()]),
  ).default({}),
});

/** A recovered copy of a file the source names: the upload's id, and the file name the source gave (which reference it recovers). */
export const recoveredInput = z.object({ fileId: z.string().uuid(), reference: z.string().min(1).max(500) });
