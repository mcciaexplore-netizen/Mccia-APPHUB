import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import { files, projects } from "@/db/eru-schema";
import { EruError, type SessionUser } from "./dal";
import { can, isUuid, MAX_CONTENT_BYTES } from "./eru.manifest";
import { eruSchema, plainContent } from "./editor/extensions";
import { convertedName, fileActions, fileKind } from "./file-types";
import { storeGenerated } from "./files";
import { exportDocx } from "./docx-export";
import { exportPdf } from "./pdf-export";
import { audit } from "./audit";

/**
 * "Convert to PDF" (a Word file or a PowerPoint) and "Convert to Word" (a PDF). The browser reads the stored original into editor content
 * (convert.ts, mammoth), as it does for "Edit in editor"; the server writes that content as the new file (pdf-export.tsx, docx-export.ts)
 * and stores it in the project beside the original, which is never changed or removed.
 */
export async function convertProjectFile(u: SessionUser, fileId: string, to: "pdf" | "docx", content: unknown): Promise<{ fileId: string; fileName: string }> {
  if (!can.editDocument(u.roles)) throw new EruError("ERU team members only.");
  if (!isUuid(fileId)) throw new EruError("That file no longer exists.");
  const [f] = await db.select().from(files).where(and(eq(files.id, fileId), eq(files.attached, true), isNull(files.documentId))).limit(1);
  if (!f?.projectId) throw new EruError("That file no longer exists.");
  const want = to === "pdf" ? "toPdf" : "toWord";
  if (!fileActions(f.fileName).includes(want)) throw new EruError(`"${f.fileName}" cannot be converted to ${to === "pdf" ? "PDF" : "Word"}.`);
  if (JSON.stringify(content ?? null).length > MAX_CONTENT_BYTES) throw new EruError("This file is too large to convert.");
  let json: Record<string, unknown>;
  try {
    json = plainContent(eruSchema().nodeFromJSON(plainContent(content)).toJSON()) as Record<string, unknown>;
  } catch {
    throw new EruError(`"${f.fileName}" could not be converted.`);
  }
  const title = f.fileName.replace(/\.[^.]+$/, "") || "Converted";
  const bytes = to === "pdf" ? await exportPdf(title, json, { slides: fileKind(f.fileName) === "pptx" }) : await exportDocx(title, json);
  const made = await storeGenerated(u.id, f.projectId, convertedName(f.fileName, to), new Uint8Array(bytes));
  await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, f.projectId));
  await audit(f.projectId, u.id, "file.convert", { fileName: f.fileName, to: made.fileName });
  return { fileId: made.id, fileName: made.fileName };
}
