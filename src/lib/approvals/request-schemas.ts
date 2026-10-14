import { z } from "zod";
import { idSchema } from "./validation";

/** What a person may attach: PDF, JPG, PNG, Word and Excel files, up to 10 MB each. Shared by the upload route and the forms. */
export const ALLOWED_EXTENSIONS = ["pdf", "jpg", "jpeg", "png", "doc", "docx", "xls", "xlsx"] as const;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** One upload request carries at most this much, so it stays under the host's request body limit (about 4.5 MB). */
export const CHUNK_BYTES = 3 * 1024 * 1024;
export const ACCEPT_ATTRIBUTE = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(",");

export const extensionOf = (name: string) => (/\.([A-Za-z0-9]+)$/.exec(name.trim())?.[1] ?? "").toLowerCase();
export const isAllowedFileName = (name: string) => (ALLOWED_EXTENSIONS as readonly string[]).includes(extensionOf(name));

const MIME_BY_EXTENSION: Record<(typeof ALLOWED_EXTENSIONS)[number], string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
/** The type is decided from the extension, never from what the browser claims, so a file cannot pose as something else when served. */
export const mimeFor = (name: string) => MIME_BY_EXTENSION[extensionOf(name) as keyof typeof MIME_BY_EXTENSION] ?? "application/octet-stream";

/** Characters that could break a header or a path are dropped; the visible name stays readable. */
export const safeFileName = (name: string) => name.replace(/[\u0000-\u001f\u007f"\\/]/g, "").replace(/\s+/g, " ").trim().slice(0, 150) || "file";

export const fileUploadStart = z.object({
  fileName: z.string().transform(safeFileName),
  size: z.number().int().min(1, "The file is empty").max(MAX_FILE_BYTES, "Files can be at most 10 MB"),
}).refine((v) => isAllowedFileName(v.fileName), "Only PDF, JPG, PNG, DOC, DOCX, XLS and XLSX files are allowed");

/* ---------------------------------------------------------------- request inputs */

const text = (max: number) => z.string().transform((s) => s.trim()).pipe(z.string().max(max, `Keep this under ${max} characters`));
const optionalText = (max: number) => text(max).optional().transform((s) => s || null);
const requiredText = (label: string, max: number) => text(max).pipe(z.string().min(1, `${label} is required`));

/** A valid address, or nothing. */
const optionalEmail = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.union([z.literal(""), z.string().email("Enter a valid email address").max(200)]))
  .optional()
  .transform((s) => s || null);
const requiredEmail = z.string().transform((s) => s.trim()).pipe(z.string().min(1, "Email is required").email("Enter a valid email address").max(200));

const amountPaise = z.number().int("Amount can have at most 2 decimals").positive("Amount must be more than 0").max(1_000_000_000_000_00);

/** Date and time the request is raised: defaults to now on the form, and may be edited. Decides the financial year. */
const requestedAt = z
  .string()
  .datetime({ offset: true, message: "Enter a valid date and time" })
  .optional()
  .transform((s) => (s ? new Date(s) : new Date()))
  .refine((d) => d.getTime() <= Date.now() + 24 * 3600 * 1000, "The date of request cannot be in the future")
  .refine((d) => d.getFullYear() >= 2020, "The date of request is too far back");

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date");
const optionalDate = dateOnly.optional().or(z.literal("")).transform((s) => s || null);

/** Pointing at a file the person already uploaded. */
export const fileRef = z.object({ fileId: idSchema });
const optionalFile = fileRef.nullish().transform((f) => f ?? null);

export const hrRequestInput = z.object({
  firstName: requiredText("First name", 60),
  lastName: requiredText("Last name", 60),
  email: optionalEmail,
  hrCategoryId: idSchema,
  requestedAt,
  amountPaise: amountPaise.nullish().transform((v) => v ?? null),
  description: optionalText(4000),
  fileUpload: optionalFile,
  fileUpload2: optionalFile,
});
export type HrRequestInput = z.output<typeof hrRequestInput>;

const common = {
  // The person the request is for, picked from the hub's people. Defaults to whoever is signed in.
  employeeUserId: idSchema,
  requestedAt,
  categoryId: idSchema,
  natureOfExpenditure: optionalText(2000),
  branchId: idSchema,
  amountPaise,
  vendorName: optionalText(500),
};

/** Expenditure of the threshold and above: approved by the DG. */
export const largeExpenditureInput = z.object({
  ...common,
  email: optionalEmail,
  supportingDocs: optionalFile,
  quotation: optionalFile,
});
export type LargeExpenditureInput = z.output<typeof largeExpenditureInput>;

/** Expenditure below the threshold. Vendor name and email are required here, as in the Zoho form. */
export const smallExpenditureInput = z.object({
  ...common,
  email: requiredEmail,
  vendorName: requiredText("Vendor name", 500),
  fileUpload: optionalFile,
  expenseDate: optionalDate,
  publicationTypeId: idSchema.nullish().transform((v) => v ?? null),
  publicationId: idSchema.nullish().transform((v) => v ?? null),
  taxInvoice: optionalFile,
  quotation: optionalFile,
  taxInvoiceDate: optionalDate,
});
export type SmallExpenditureInput = z.output<typeof smallExpenditureInput>;

export const decisionInput = z.object({
  action: z.enum(["approve", "reject"]),
  comment: text(2000).optional().transform((s) => s || null),
});

export const withdrawInput = z.object({ comment: text(2000).optional().transform((s) => s || null) });
