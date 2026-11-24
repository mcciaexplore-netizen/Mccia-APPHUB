import type { HistoricalField, HistoricalTimelineEntry } from "@/db/approvals-schema";
import { financialYearOf, formatINR } from "../format";

/**
 * Historical import: old approval records from another system brought into the Approval System as archived tickets. This file is the pure
 * part (no database, no server code), so the unit tests and the preview share it: reading a source file, checking each record, and turning
 * it into the Approval System's shape. src/lib/approvals/historical/import.ts does the database work.
 *
 * A source is read by an adapter that knows its file format, recognised by the file's structure (never by its name). Today there are two,
 * Zoho Creator's "All Expenditures" and "All Hr" JSON exports; another system (or a CSV or Excel sheet) is one more adapter that returns
 * the same HistoricalRecord.
 *
 * Rules that hold for every source:
 *   - Nothing is invented. A value the source does not have stays empty and is noted; no approver is ever guessed from a timestamp.
 *   - The source's own status is kept exactly. In the Approval System the ticket's status is "historical": it never enters a queue.
 *   - Dates are read as Indian time (the source systems were used in India and show no time zone); the text as written is kept beside them.
 */

/** The requester of a record that could not be linked to a hub user: no hub user has this id, so the record belongs to nobody's "My requests". */
export const UNLINKED_REQUESTER_ID = "00000000-0000-0000-0000-000000000000";
/** An upload's size limit (the hub's request body limit is about 4.5 MB). */
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;
export const MAX_IMPORT_RECORDS = 5000;
/** Below this, an expense goes to the Expense Admin alone in the hub today (₹10,000), used only for a note. */
export const DG_THRESHOLD_PAISE = 1_000_000;

export type HistoricalRecord = {
  /** The record's position in the file, from 1, for messages. */
  index: number;
  legacyId: string;
  sourceStatus: string;
  requesterName: string;
  requesterEmail: string;
  /** ISO instant, read as Indian time. Null when the source has no request date (allowed for HR records only). */
  requestedAt: string | null;
  /**
   * The time the ticket is sorted and filtered by: the request date, or when the source has none, the earliest action time it records
   * (kept as a "listed_by" field, so it is never shown as the request date). Null when the source records no time at all.
   */
  listedAt: string | null;
  /** Only from a real request date: a record without one has no financial year. */
  financialYear: string | null;
  type: "expenditure_large" | "hr";
  /** The category for matching with the hub's (trimmed). */
  categoryName: string;
  /** The category exactly as the source wrote it (a trailing space included), kept for the record. */
  categorySourceName: string;
  categorySourceId: string | null;
  amountPaise: number | null;
  description: string;
  /** The final decision's time, only when the source shows a final status (Approved or Rejected) with a DG action time. */
  decidedAt: string | null;
  sourceDates: HistoricalField[];
  timeline: HistoricalTimelineEntry[];
  extra: HistoricalField[];
  /** Things to know, not stopping the import. */
  notes: string[];
  /** Problems that stop this record from being imported. */
  errors: string[];
  source: Record<string, unknown>;
};

export type SourceAdapter = {
  key: string;
  /** The system the records come from, stored with each record ("zoho_creator") and shown ("Zoho Creator"). */
  system: string;
  systemLabel: string;
  /** What the file holds, in words. */
  label: string;
  /** Which of the hub's forms the records become: HR requests (HR categories) or expenditures (expense categories). */
  form: "hr" | "expenditure";
  /** The hub's request number prefix for that form (HR, EXP). */
  requestPrefix: string;
  /** The prefix of the legacy id kept on the request ("zoho:192778000002062013"), unique across sources. */
  legacyPrefix: string;
  detect(data: unknown): boolean;
  records(data: unknown): unknown[];
  read(raw: unknown, index: number): HistoricalRecord;
};

/* ---------------------------------------------------------------- shared helpers */

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** "28-Oct-2026 14:49:47" (Zoho's format, Indian time) to an ISO instant, or null when it is not a real date and time. */
export function parseSourceDateTime(text: string): string | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?: (\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text.trim());
  if (!m) return null;
  const [day, mon, year, hh = "0", mm = "0", ss = "0"] = [Number(m[1]), MONTHS[m[2].toLowerCase()], Number(m[3]), m[4], m[5], m[6]];
  if (!mon || year < 2000 || year > 2100 || Number(hh) > 23 || Number(mm) > 59 || Number(ss) > 59) return null;
  const utc = Date.UTC(year, mon - 1, day, Number(hh), Number(mm), Number(ss)) - 330 * 60_000;
  const back = new Date(utc + 330 * 60_000);
  if (back.getUTCDate() !== day || back.getUTCMonth() !== mon - 1) return null; // 31-Feb and the like
  return new Date(utc).toISOString();
}

/** "18000.00" or "2339508.12" to paise; "" to null; anything else (a ₹ sign, commas, letters, more than 2 decimals) is invalid. */
export function parseSourceAmount(text: string): { ok: true; paise: number | null } | { ok: false } {
  const t = text.trim();
  if (t === "") return { ok: true, paise: null };
  const m = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return { ok: false };
  return { ok: true, paise: Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0")) };
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : v == null ? "" : null);

/** The time-ordered timeline, entries with no time last (in the order given); the submission stays first even when its time is unknown. */
const byTime = (entries: HistoricalTimelineEntry[]) => {
  const first = entries.filter((e) => e.key === "submitted" && !e.at);
  const rest = entries.filter((e) => !first.includes(e));
  return [...first, ...rest.map((e, i) => ({ e, i })).sort((a, b) => (a.e.at && b.e.at ? a.e.at.localeCompare(b.e.at) : a.e.at ? -1 : b.e.at ? 1 : a.i - b.i) || a.i - b.i).map((x) => x.e)];
};

/** Reads a record's fields as text, each within its length limit; anything else (an object, a list) is an error, never coerced. */
function readFields(rec: Record<string, unknown>, fields: readonly string[], limits: Record<string, number>, errors: string[]): Record<string, string> {
  const v: Record<string, string> = {};
  for (const f of fields) {
    const s = str(rec[f]);
    if (s === null) errors.push(`${f} is not text.`);
    else if (s.length > (limits[f] ?? 1000)) errors.push(`${f} is too long (${s.length} characters).`);
    v[f] = (s ?? "").replace(/\r\n/g, "\n");
  }
  return v;
}

/** The source's fields the hub has no place for, kept as label and value. */
const extraFields = (rec: Record<string, unknown>, known: readonly string[]): HistoricalField[] =>
  Object.entries(rec)
    .filter(([k]) => !known.includes(k))
    .map(([k, val]) => ({ label: k.replace(/_/g, " ").slice(0, 100), value: (typeof val === "string" ? val : JSON.stringify(val) ?? "").slice(0, 4000) }));

const ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

/* ---------------------------------------------------------------- Zoho Creator: All Expenditures */

const ZOHO_FIELDS = ["ID", "Name", "Email", "Date_of_Request", "Status", "Category", "Category.ID", "Nature_of_Expenditure", "Amount", "Recommended", "DG"] as const;
const ZOHO_STATUSES = ["Approved", "Recommend", "Pending", "Rejected"];
const LIMITS: Record<string, number> = { ID: 40, Name: 200, Email: 320, Category: 200, "Category.ID": 40, Nature_of_Expenditure: 10_000, Amount: 20, Status: 60, Date_of_Request: 40, Recommended: 40, DG: 40 };

export const zohoExpenditures: SourceAdapter = {
  key: "zoho_expenditures",
  system: "zoho_creator",
  systemLabel: "Zoho Creator",
  label: "Zoho Creator expenditure approvals (All Expenditures)",
  form: "expenditure",
  requestPrefix: "EXP",
  legacyPrefix: "zoho",
  detect: (data) => !!data && typeof data === "object" && !Array.isArray(data) && Array.isArray((data as Record<string, unknown>).All_Expenditures),
  records: (data) => (data as { All_Expenditures: unknown[] }).All_Expenditures,
  read(raw, index) {
    const errors: string[] = [];
    const notes: string[] = [];
    const rec = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
    const blank: HistoricalRecord = {
      index, legacyId: "", sourceStatus: "", requesterName: "", requesterEmail: "", requestedAt: null, listedAt: null, financialYear: null, type: "expenditure_large",
      categoryName: "", categorySourceName: "", categorySourceId: null, amountPaise: null, description: "", decidedAt: null, sourceDates: [], timeline: [], extra: [], notes, errors, source: rec ?? {},
    };
    if (!rec) {
      errors.push("This entry is not a record (expected an object with ID, Name, Status...).");
      return blank;
    }
    // Every value must be text (or a number): anything else is reported, never coerced.
    const v: Record<string, string> = {};
    for (const f of ZOHO_FIELDS) {
      const s = str(rec[f]);
      if (s === null) errors.push(`${f} is not text.`);
      else if (s.length > (LIMITS[f] ?? 1000)) errors.push(`${f} is too long (${s.length} characters).`);
      v[f] = (s ?? "").replace(/\r\n/g, "\n");
    }
    const id = v.ID.trim();
    if (!id) errors.push("No ID: the record cannot be told apart from others.");
    else if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) errors.push("The ID has characters an ID cannot have.");
    const name = v.Name.trim();
    if (!name) errors.push("No requester name.");
    const email = v.Email.trim();
    if (!email) notes.push("No email in the source record.");
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) notes.push(`The email "${email}" does not look like an email address.`);
    const status = v.Status.trim();
    if (!status) errors.push("No status.");
    else if (!ZOHO_STATUSES.includes(status)) notes.push(`"${status}" is not one of Zoho's usual statuses; it is kept as it is.`);
    const category = v.Category.trim();
    if (!category) errors.push("No category.");
    const requestedAt = v.Date_of_Request.trim() ? parseSourceDateTime(v.Date_of_Request) : null;
    if (!v.Date_of_Request.trim()) errors.push("No date of request.");
    else if (!requestedAt) errors.push(`The date of request "${v.Date_of_Request}" is not a date and time (expected like 28-Oct-2026 14:49:47).`);
    const recommendedAt = v.Recommended.trim() ? parseSourceDateTime(v.Recommended) : null;
    if (v.Recommended.trim() && !recommendedAt) errors.push(`The recommendation time "${v.Recommended}" is not a date and time.`);
    const dgAt = v.DG.trim() ? parseSourceDateTime(v.DG) : null;
    if (v.DG.trim() && !dgAt) errors.push(`The DG action time "${v.DG}" is not a date and time.`);
    const amount = parseSourceAmount(v.Amount);
    if (!amount.ok) errors.push(`The amount "${v.Amount}" is not a number (expected like 18000.00).`);
    const paise = amount.ok ? amount.paise : null;
    if (amount.ok && paise === null) notes.push("No amount in the source record.");
    if (paise !== null && paise < DG_THRESHOLD_PAISE) {
      notes.push(`${formatINR(paise, { symbol: true })} is below ₹10,000, but it was raised on Zoho's DG expenditure form, so it is kept as an Expenditure (EXP) with that form's history.`);
    }
    if (!v.Nature_of_Expenditure.trim()) notes.push("No nature of expenditure in the source record.");

    // What the source shows about the approval. Zoho's Recommended and DG fields are times only: who acted is not recorded, and is never guessed.
    if (status === "Approved" && !dgAt) notes.push("Approved in Zoho, but no DG action time is recorded.");
    if (status === "Rejected" && !dgAt && !recommendedAt) notes.push("Rejected in Zoho, but no time of the rejection is recorded.");
    if (status === "Recommend" && !recommendedAt) notes.push("Marked Recommend in Zoho, but no recommendation time is recorded.");
    if (status === "Pending" && (recommendedAt || dgAt)) notes.push("Pending in Zoho, yet a recommendation or DG time is recorded.");
    if (status === "Recommend" && !dgAt) notes.push("Recommended in Zoho; no final DG decision is recorded. Archived as it was, not sent to anyone's queue.");
    if (status === "Pending") notes.push("Still pending in Zoho. Archived as it was, not sent to anyone's queue.");
    if (requestedAt && recommendedAt && recommendedAt < requestedAt) notes.push("The recommendation time is before the date of request.");
    if (recommendedAt && dgAt && dgAt < recommendedAt) notes.push("The DG action time is before the recommendation time.");

    const timeline: HistoricalTimelineEntry[] = [
      { key: "submitted", label: "Request submitted", at: requestedAt, sourceText: v.Date_of_Request.trim() || null, actor: name || null, note: null },
    ];
    if (v.Recommended.trim()) {
      timeline.push({
        key: "recommended", label: "Recommendation recorded (first approval step)", at: recommendedAt, sourceText: v.Recommended.trim(), actor: null,
        note: "Zoho records when it was recommended, not who recommended it.",
      });
    }
    if (v.DG.trim()) {
      timeline.push({
        key: "dg", label: "DG action recorded", at: dgAt, sourceText: v.DG.trim(), actor: null,
        note: `Zoho records when the DG acted, not who acted or what was decided at that time. The record's status in Zoho is ${status || "not given"}.`,
      });
    }

    const known = new Set<string>(ZOHO_FIELDS);
    const extra: HistoricalField[] = Object.entries(rec)
      .filter(([k]) => !known.has(k))
      .map(([k, val]) => ({ label: k.replace(/_/g, " ").slice(0, 100), value: (typeof val === "string" ? val : JSON.stringify(val) ?? "").slice(0, 4000) }));

    return {
      ...blank,
      legacyId: id, sourceStatus: status, requesterName: name, requesterEmail: email.toLowerCase(), requestedAt, listedAt: requestedAt,
      financialYear: requestedAt ? financialYearOf(new Date(requestedAt)) : null,
      categoryName: category, categorySourceName: v.Category, categorySourceId: v["Category.ID"].trim() || null, amountPaise: paise, description: v.Nature_of_Expenditure.trim(),
      decidedAt: (status === "Approved" || status === "Rejected") && dgAt ? dgAt : null,
      sourceDates: [
        { label: "Date of Request", value: v.Date_of_Request.trim() },
        { label: "Recommended", value: v.Recommended.trim() },
        { label: "DG", value: v.DG.trim() },
        { label: "Amount", value: v.Amount.trim() },
      ],
      timeline: byTime(timeline),
      extra,
    };
  },
};

/* ---------------------------------------------------------------- Zoho Creator: All Hr */

const ZOHO_HR_FIELDS = ["ID", "Name", "Date_of_Request", "Status", "Category", "Amount", "Satavisha_Natu", "DG", "File_upload"] as const;
const HR_LIMITS: Record<string, number> = { ID: 40, Name: 200, Date_of_Request: 40, Status: 60, Category: 200, Amount: 20, Satavisha_Natu: 40, DG: 40, File_upload: 500 };

/**
 * Zoho's HR approvals. The export has no email and no employee: Name is the person who raised the request in Zoho, and is never taken as
 * the employee a letter or certificate was for. Satavisha_Natu is Zoho's HR-stage field and DG its DG-stage field; both hold a time only,
 * so neither names who acted (the field's name is not taken as the approver) nor what was decided at that step. Many records have no date
 * of request: they are kept without one (no financial year, numbered in their own series), and sorted by the earliest time they do record.
 */
export const zohoHr: SourceAdapter = {
  key: "zoho_hr",
  system: "zoho_creator_hr",
  systemLabel: "Zoho Creator",
  label: "Zoho Creator HR approvals (All Hr)",
  form: "hr",
  requestPrefix: "HR",
  legacyPrefix: "zoho-hr",
  detect: (data) => !!data && typeof data === "object" && !Array.isArray(data) && Array.isArray((data as Record<string, unknown>).All_Hr),
  records: (data) => (data as { All_Hr: unknown[] }).All_Hr,
  read(raw, index) {
    const errors: string[] = [];
    const notes: string[] = [];
    const rec = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
    const blank: HistoricalRecord = {
      index, legacyId: "", sourceStatus: "", requesterName: "", requesterEmail: "", requestedAt: null, listedAt: null, financialYear: null, type: "hr",
      categoryName: "", categorySourceName: "", categorySourceId: null, amountPaise: null, description: "", decidedAt: null, sourceDates: [], timeline: [], extra: [], notes, errors, source: rec ?? {},
    };
    if (!rec) {
      errors.push("This entry is not a record (expected an object with ID, Name, Status...).");
      return blank;
    }
    const v = readFields(rec, ZOHO_HR_FIELDS, HR_LIMITS, errors);
    const id = v.ID.trim();
    if (!id) errors.push("No ID: the record cannot be told apart from others.");
    else if (!ID_PATTERN.test(id)) errors.push("The ID has characters an ID cannot have.");
    const name = v.Name.trim();
    if (!name) errors.push("No requester name.");
    const status = v.Status.trim();
    if (!status) errors.push("No status.");
    else if (!ZOHO_STATUSES.includes(status)) notes.push(`"${status}" is not one of Zoho's usual statuses; it is kept as it is.`);
    const category = v.Category.trim();
    if (!category) errors.push("No category.");

    const dateText = v.Date_of_Request.trim();
    const requestedAt = dateText ? parseSourceDateTime(dateText) : null;
    if (dateText && !requestedAt) errors.push(`The date of request "${dateText}" is not a date and time (expected like 28-Oct-2026 14:49:47).`);
    const hrText = v.Satavisha_Natu.trim();
    const hrAt = hrText ? parseSourceDateTime(hrText) : null;
    if (hrText && !hrAt) errors.push(`The HR-stage time "${hrText}" is not a date and time.`);
    const dgText = v.DG.trim();
    const dgAt = dgText ? parseSourceDateTime(dgText) : null;
    if (dgText && !dgAt) errors.push(`The DG-stage time "${dgText}" is not a date and time.`);

    const amount = parseSourceAmount(v.Amount);
    if (!amount.ok) errors.push(`The amount "${v.Amount}" is not a number (expected like 25000.00).`);
    const paise = amount.ok ? amount.paise : null;
    if (amount.ok && paise === null) notes.push("No amount in the source record.");
    const file = v.File_upload.trim();

    // With no request date, the earliest time the record does have decides only where the ticket is listed; it is never shown or used as
    // the request date, and gives no financial year.
    const earliest = [hrAt && { at: hrAt, text: hrText, from: "the HR-stage time" }, dgAt && { at: dgAt, text: dgText, from: "the DG-stage time" }]
      .filter((x): x is { at: string; text: string; from: string } => !!x)
      .sort((a, b) => a.at.localeCompare(b.at))[0];
    if (!dateText) {
      notes.push(earliest
        ? `No date of request in Zoho. The ticket is listed by ${earliest.from} (${earliest.text}), which is not the request date; it has no financial year and is numbered in the undated series.`
        : "No date of request in Zoho, and no other time either: the ticket is listed by the time of the import, has no financial year and is numbered in the undated series.");
    }
    if (status === "Approved" && !dgAt) notes.push("Approved in Zoho, but no DG-stage time is recorded.");
    if (status === "Approved" && !hrAt) notes.push("Approved in Zoho, but no HR-stage time is recorded.");
    if (status === "Rejected" && !dgAt && !hrAt) notes.push("Rejected in Zoho, but no time of the rejection is recorded.");
    if (status === "Rejected") notes.push("Zoho does not record at which stage it was rejected.");
    if (status === "Pending") notes.push("Still pending in Zoho. Archived as it was, not sent to anyone's queue.");
    if (requestedAt && hrAt && hrAt < requestedAt) notes.push("The HR-stage time is before the date of request.");
    if (hrAt && dgAt && dgAt < hrAt) notes.push("The DG-stage time is before the HR-stage time.");
    if (file) notes.push(`Zoho names an attached file (${file}), but the export has only its name: the file itself is not in the hub until a recovered copy is attached.`);

    const stageNote = (field: string) => `Zoho records only a time in its ${field} field: not who acted, and not what was decided at that step. The record's final status in Zoho is ${status || "not given"}.`;
    const timeline: HistoricalTimelineEntry[] = [
      { key: "submitted", label: "Request submitted", at: requestedAt, sourceText: dateText || null, actor: name || null, note: dateText ? null : "Zoho has no date of request for this record." },
    ];
    if (hrText) timeline.push({ key: "hr_stage", label: "HR-stage action recorded", at: hrAt, sourceText: hrText, actor: null, note: stageNote('HR-stage ("Satavisha_Natu")') });
    if (dgText) timeline.push({ key: "dg", label: "DG-stage action recorded", at: dgAt, sourceText: dgText, actor: null, note: stageNote("DG") });

    const sourceDates: HistoricalField[] = [
      { label: "Date of Request", value: dateText },
      { label: "HR stage, Satavisha_Natu field", value: hrText },
      { label: "DG stage", value: dgText },
      { label: "Amount", value: v.Amount.trim() },
    ];
    if (!dateText) {
      sourceDates.push(earliest
        ? { label: "Listed by", value: earliest.text, kind: "listed_by", note: `No date of request in Zoho: listed by ${earliest.from}, which is not the request date.` }
        : { label: "Listed by", value: "", kind: "listed_by", note: "No time at all in Zoho: listed by the time of the import." });
    }

    return {
      ...blank,
      legacyId: id, sourceStatus: status, requesterName: name, requesterEmail: "", requestedAt, listedAt: requestedAt ?? earliest?.at ?? null,
      financialYear: requestedAt ? financialYearOf(new Date(requestedAt)) : null,
      categoryName: category, categorySourceName: v.Category, amountPaise: paise,
      // Approval needs the DG, the last stage, so an approved record's decision time is its DG-stage time. A rejection's stage is not
      // recorded, so its time is left unknown rather than read from a timestamp.
      decidedAt: status === "Approved" && dgAt ? dgAt : null,
      sourceDates,
      timeline: byTime(timeline),
      extra: [...(file ? [{ label: "File upload", value: file, kind: "attachment" as const, attachmentId: null }] : []), ...extraFields(rec, ZOHO_HR_FIELDS)],
    };
  },
};

export const ADAPTERS: SourceAdapter[] = [zohoExpenditures, zohoHr];
export const adapterByKey = (key: string) => ADAPTERS.find((a) => a.key === key) ?? null;

export type ReadResult = { ok: true; adapter: SourceAdapter; data: unknown; records: HistoricalRecord[] } | { ok: false; error: string };

/** Reads an uploaded file: JSON, recognised by one of the adapters, every record checked. Duplicate IDs inside the file are errors. */
export function readSource(text: string): ReadResult {
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) return { ok: false, error: "The file is larger than 4 MB. Split it into smaller files." };
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return { ok: false, error: "The file is not valid JSON." };
  }
  const adapter = ADAPTERS.find((a) => a.detect(data));
  if (!adapter) return { ok: false, error: "This file's layout is not recognised. Supported: " + ADAPTERS.map((a) => a.label).join("; ") + "." };
  const raw = adapter.records(data);
  if (raw.length === 0) return { ok: false, error: "The file has no records." };
  if (raw.length > MAX_IMPORT_RECORDS) return { ok: false, error: `The file has ${raw.length} records; at most ${MAX_IMPORT_RECORDS} can be imported at once.` };
  const records = raw.map((r, i) => adapter.read(r, i + 1));
  const seen = new Map<string, number>();
  for (const r of records) {
    if (!r.legacyId) continue;
    const first = seen.get(r.legacyId);
    if (first) r.errors.push(`The same ID is also record ${first} in this file.`);
    else seen.set(r.legacyId, r.index);
  }
  return { ok: true, adapter, data, records };
}

/** Whether a hub user is the same person as the source's requester: same email, and the same name (ignoring case and spaces). */
export const sameName = (a: string, b: string) => a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();

/** How a source category name is compared with the hub's names and aliases. */
export const categoryKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
