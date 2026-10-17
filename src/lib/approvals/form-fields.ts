/**
 * The fields of the three request forms, and how the Support Admin's settings change them. Pure: nothing here touches the database, so the
 * forms (in the browser), the server and the tests all use the same rules.
 *
 * Every form has built-in fields. For those the Support Admin can rename them, move them, and hide the optional ones; the ones the request
 * cannot do without (the person, the category, the branch, the amount, ...) cannot be hidden. The Support Admin can also add extra fields
 * of their own (text, long text, number, date or a dropdown), which can be required, and can remove them again.
 */
export type FormKey = "hr" | "large" | "small";
export const FORM_KEYS: readonly FormKey[] = ["hr", "large", "small"];
export const FORM_TITLE: Record<FormKey, string> = {
  hr: "HR form",
  small: "Expenses form (below ₹10,000)",
  large: "Expenditure form (₹10,000 and above)",
};

export type BuiltinDef = { key: string; label: string; hideable: boolean };

/** In the order they appear by default. A field that stands for a group of rows (Amount with its budget rows) moves as one. */
export const BUILTIN: Record<FormKey, readonly BuiltinDef[]> = {
  hr: [
    { key: "name", label: "Name", hideable: false },
    { key: "email", label: "Email", hideable: true },
    { key: "category", label: "Category", hideable: false },
    { key: "date", label: "Date of Request", hideable: true },
    { key: "amount", label: "Amount", hideable: true },
    { key: "description", label: "Description", hideable: true },
    { key: "file1", label: "File upload", hideable: true },
    { key: "file2", label: "File upload", hideable: true },
  ],
  large: [
    { key: "name", label: "Name", hideable: false },
    { key: "email", label: "Email", hideable: true },
    { key: "date", label: "Date of Request", hideable: true },
    { key: "difference", label: "Difference", hideable: true },
    { key: "category", label: "Category", hideable: false },
    { key: "nature", label: "Nature of Expenditure", hideable: true },
    { key: "branch", label: "Branch Name", hideable: false },
    { key: "allocated", label: "Budget Allocated", hideable: false },
    { key: "used", label: "Budget Used", hideable: false },
    { key: "remaining", label: "Budget Remaining", hideable: true },
    { key: "amount", label: "Amount", hideable: false },
    { key: "vendor", label: "Vendor Name", hideable: true },
    { key: "supporting", label: "Tax Invoice/Supporting Documents", hideable: true },
    { key: "quotation", label: "Quotation", hideable: true },
  ],
  small: [
    { key: "name", label: "Name", hideable: false },
    { key: "email", label: "Email", hideable: false },
    { key: "date", label: "Date", hideable: true },
    { key: "category", label: "Category", hideable: false },
    { key: "nature", label: "Nature of Expenditure", hideable: true },
    { key: "branch", label: "Branch Name", hideable: false },
    { key: "allocated", label: "Budget Allocated", hideable: false },
    { key: "used", label: "Budget Used", hideable: false },
    { key: "available", label: "Available budget", hideable: true },
    { key: "file", label: "File upload", hideable: true },
    { key: "remaining", label: "Budget Remaining", hideable: true },
    { key: "expenseDate", label: "Date", hideable: true },
    { key: "publication", label: "Type of Publication", hideable: true },
    { key: "vendor", label: "Vendor Name", hideable: false },
    { key: "invoice", label: "Tax Invoice", hideable: true },
    { key: "quotation", label: "Quotation", hideable: true },
    { key: "invoiceDate", label: "Date of Tax Invoice", hideable: true },
    { key: "amount", label: "Amount", hideable: false },
  ],
};

export const CUSTOM_KINDS = ["text", "textarea", "number", "date", "select"] as const;
export type CustomKind = (typeof CUSTOM_KINDS)[number];
export const KIND_LABEL: Record<CustomKind, string> = { text: "Short text", textarea: "Long text", number: "Number", date: "Date", select: "Dropdown" };

export const MAX_FIELDS_PER_FORM = 40;
export const MAX_LABEL = 80;
export const MAX_OPTIONS = 50;
const MAX_VALUE: Record<CustomKind, number> = { text: 300, textarea: 4000, number: 40, date: 10, select: 200 };

/** What one field of a form looks like once the settings are applied. */
export type FormField = {
  key: string;
  label: string;
  builtin: boolean;
  /** Built-in fields only: whether the Support Admin may hide it. */
  hideable: boolean;
  hidden: boolean;
  /** Extra fields only. */
  kind: CustomKind | null;
  required: boolean;
  options: string[];
  sortOrder: number;
};

/** A stored row, as it comes from apr_form_fields. */
export type FormFieldRow = { form: string; key: string; label: string; builtin: boolean; kind: string; required: boolean; hidden: boolean; sortOrder: number; options: string[] };

const isKind = (k: string): k is CustomKind => (CUSTOM_KINDS as readonly string[]).includes(k);

/** The fields of a form in the order they are shown: the built-in ones as set, then the extra ones, sorted by their place. */
export function mergeFields(form: FormKey, rows: readonly FormFieldRow[]): FormField[] {
  const mine = rows.filter((r) => r.form === form);
  const byKey = new Map(mine.map((r) => [r.key, r]));
  const built = BUILTIN[form].map((d, i): FormField => {
    const r = byKey.get(d.key);
    return {
      key: d.key, label: r?.label.trim() ? r.label.trim() : d.label, builtin: true, hideable: d.hideable, hidden: d.hideable && !!r?.hidden,
      kind: null, required: false, options: [], sortOrder: r && r.builtin ? r.sortOrder : (i + 1) * 10,
    };
  });
  const extra = mine.filter((r) => !r.builtin && isKind(r.kind)).map((r): FormField => ({
    key: r.key, label: r.label, builtin: false, hideable: false, hidden: r.hidden, kind: r.kind as CustomKind, required: r.required, options: r.options, sortOrder: r.sortOrder,
  }));
  return [...built, ...extra].sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
}

/** One answer to an extra field, kept with the name the field had when it was answered. A request keeps them in the order of the form. */
type CustomAnswer = { key: string; label: string; value: string };
export type CustomAnswers = CustomAnswer[];

/**
 * Checks the answers to the extra fields against the fields as they are now. Only fields that are shown count; a required one must be
 * answered; a number, a date or a dropdown choice must be of that kind. Returns what to keep with the request (each answer with its
 * label, so a later rename never changes what an old request says) or the first problem in plain words.
 */
export function checkCustomAnswers(fields: readonly FormField[], given: Readonly<Record<string, string>>): { ok: true; values: CustomAnswers } | { ok: false; error: string } {
  const values: CustomAnswers = [];
  for (const f of fields) {
    if (f.builtin || f.hidden || !f.kind) continue;
    const v = (given[f.key] ?? "").trim();
    if (!v) {
      if (f.required) return { ok: false, error: `"${f.label}" is required.` };
      continue;
    }
    if (v.length > MAX_VALUE[f.kind]) return { ok: false, error: `Keep "${f.label}" under ${MAX_VALUE[f.kind]} characters.` };
    if (f.kind === "number" && !/^-?\d+(\.\d+)?$/.test(v)) return { ok: false, error: `"${f.label}" must be a number.` };
    if (f.kind === "date" && !(/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)))) return { ok: false, error: `"${f.label}" must be a date.` };
    if (f.kind === "select" && !f.options.includes(v)) return { ok: false, error: `Choose one of the options for "${f.label}".` };
    values.push({ key: f.key, label: f.label, value: v });
  }
  return { ok: true, values };
}
