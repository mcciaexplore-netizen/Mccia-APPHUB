import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { aprFormFields } from "@/db/approvals-schema";
import { recordAudit } from "./audit";
import { ApprovalsError } from "./errors";
import {
  BUILTIN, CUSTOM_KINDS, FORM_KEYS, FORM_TITLE, MAX_FIELDS_PER_FORM, MAX_LABEL, MAX_OPTIONS, checkCustomAnswers, mergeFields,
  type CustomAnswers, type FormField, type FormKey,
} from "./form-fields";
import type { ApprovalsUser } from "./host-adapter";

/** The fields of a form as the Support Admin has set them (the defaults where nothing was changed). */
export async function getFormFields(form: FormKey): Promise<FormField[]> {
  return mergeFields(form, await db.select().from(aprFormFields).where(eq(aprFormFields.form, form)));
}

/** All three forms at once, for the editor. */
export async function getAllFormFields(): Promise<Record<FormKey, FormField[]>> {
  const rows = await db.select().from(aprFormFields);
  return Object.fromEntries(FORM_KEYS.map((f) => [f, mergeFields(f, rows)])) as Record<FormKey, FormField[]>;
}

/** The answers to the extra fields of a form, checked against the fields as they are now. A problem is a refusal in plain words. */
export async function resolveCustomAnswers(form: FormKey, given: Readonly<Record<string, string>>): Promise<CustomAnswers> {
  const checked = checkCustomAnswers(await getFormFields(form), given);
  if (!checked.ok) throw new ApprovalsError(checked.error, 422);
  return checked.values;
}

export const formKeyInput = z.enum(["hr", "large", "small"]);

const trimmed = z.string().transform((s) => s.trim().replace(/\s+/g, " "));
const fieldInput = z.object({
  /** A built-in field's key, or the key of an extra field that already exists; empty for a new extra field. */
  key: z.string().max(40).nullish(),
  label: trimmed.pipe(z.string().min(1, "Every field needs a name").max(MAX_LABEL, `Keep a field name under ${MAX_LABEL} characters`)),
  hidden: z.boolean().default(false),
  kind: z.enum(CUSTOM_KINDS).optional(),
  required: z.boolean().default(false),
  options: z.array(trimmed.pipe(z.string().min(1).max(200))).max(MAX_OPTIONS).default([]),
});
/** The whole form, top to bottom, as the editor shows it. */
export const saveFieldsInput = z.object({ fields: z.array(fieldInput).max(BUILTIN.small.length + MAX_FIELDS_PER_FORM) });

const CUSTOM_KEY = /^c_[a-z0-9]{8}$/;
const newKey = () => `c_${randomBytes(4).toString("hex")}`;

/**
 * Saves a form's layout: the built-in fields renamed, moved or hidden, and the extra fields added, changed or taken away. Every built-in field
 * must be in the list exactly once; only the ones that may be hidden can be; two fields cannot share a name. Extra fields taken out of the list
 * are deleted, and requests that already have an answer keep it (with the name it had), so nothing already submitted changes.
 */
export async function saveFormFields(form: FormKey, input: z.output<typeof saveFieldsInput>, actor: ApprovalsUser): Promise<FormField[]> {
  const existing = await db.select().from(aprFormFields).where(eq(aprFormFields.form, form));
  const existingCustom = new Set(existing.filter((r) => !r.builtin).map((r) => r.key));
  const defs = new Map(BUILTIN[form].map((d) => [d.key, d]));

  const seen = new Set<string>();
  const builtinNames = new Set<string>();
  const customNames = new Set<string>();
  const rows: (typeof aprFormFields.$inferInsert)[] = [];
  let customCount = 0;
  input.fields.forEach((f, i) => {
    const def = f.key ? defs.get(f.key) : undefined;
    const name = f.label.toLowerCase();
    // Two of the form's own fields may share a name (the form has two "File upload" lines); an extra field may not share one with any other.
    const clash = customNames.has(name) || (!def && builtinNames.has(name));
    if (clash) throw new ApprovalsError(`Two fields are called "${f.label}". Give each field its own name.`, 422);
    (def ? builtinNames : customNames).add(name);
    if (def) {
      if (seen.has(def.key)) throw new ApprovalsError("A field is listed twice.", 422);
      seen.add(def.key);
      if (f.hidden && !def.hideable) throw new ApprovalsError(`"${def.label}" cannot be hidden: the request cannot be sent without it.`, 422);
      rows.push({ form, key: def.key, label: f.label, builtin: true, kind: "text", required: false, hidden: f.hidden, sortOrder: (i + 1) * 10, options: [] });
      return;
    }
    if (f.key && !CUSTOM_KEY.test(f.key)) throw new ApprovalsError("Unknown field in the list. Reload the page and try again.", 422);
    if (f.key && !existingCustom.has(f.key)) throw new ApprovalsError("A field in the list no longer exists. Reload the page and try again.", 422);
    if (!f.kind) throw new ApprovalsError(`Choose what kind of field "${f.label}" is.`, 422);
    const options = f.kind === "select" ? [...new Set(f.options)] : [];
    if (f.kind === "select" && options.length === 0) throw new ApprovalsError(`Give "${f.label}" at least one choice.`, 422);
    customCount++;
    const key = f.key ?? newKey();
    if (seen.has(key)) throw new ApprovalsError("A field is listed twice.", 422);
    seen.add(key);
    rows.push({ form, key, label: f.label, builtin: false, kind: f.kind, required: f.required, hidden: f.hidden, sortOrder: (i + 1) * 10, options });
  });
  const missing = [...defs.keys()].filter((k) => !seen.has(k));
  if (missing.length) throw new ApprovalsError("The list is missing some of the form's own fields. Reload the page and try again.", 422);
  if (customCount > MAX_FIELDS_PER_FORM) throw new ApprovalsError(`A form can have at most ${MAX_FIELDS_PER_FORM} extra fields.`, 422);

  for (const r of rows) {
    await db.insert(aprFormFields).values(r).onConflictDoUpdate({
      target: [aprFormFields.form, aprFormFields.key],
      set: { label: r.label, builtin: r.builtin, kind: r.kind, required: r.required, hidden: r.hidden, sortOrder: r.sortOrder, options: r.options },
    });
  }
  const keep = rows.filter((r) => !r.builtin).map((r) => r.key);
  const gone = [...existingCustom].filter((k) => !keep.includes(k));
  if (gone.length) await db.delete(aprFormFields).where(and(eq(aprFormFields.form, form), inArray(aprFormFields.key, gone)));

  const after = await getFormFields(form);
  await recordAudit(actor, "form_fields", form, "update", `Changed the ${FORM_TITLE[form]}: ${after.length} fields, ${after.filter((f) => !f.builtin).length} added by hand`, existing.length ? { fields: existing.map((r) => r.label) } : undefined, { fields: after.map((f) => f.label) });
  return after;
}
