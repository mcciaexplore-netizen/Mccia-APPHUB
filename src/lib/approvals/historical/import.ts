import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { aprApprovalEvents, aprCategories, aprHistoricalRecords, aprHrCategories, aprImportBatches } from "@/db/approvals-schema";
import { recordAudit } from "../audit";
import { formatRequestNo } from "../calc";
import { ApprovalsError } from "../errors";
import { getDirectoryUsersByEmail, type ApprovalsUser } from "../host-adapter";
import { nextSerial } from "../requests";
import { UNLINKED_REQUESTER_ID, adapterByKey, categoryKey, readSource, sameName, type HistoricalRecord, type SourceAdapter } from "./rules";

/**
 * Historical import, the database side (the rules are in rules.ts). Three steps, all for the Approval System's administrators:
 *   preview  reads the file and checks every record against the hub (already imported? requester a hub user? category known?). Writes nothing.
 *   import   does the preview again on the server (nothing the browser says about a record is trusted), applies the category decisions, and
 *            saves each record as an archived ticket: status "historical", no steps, no approver, no events, no notifications.
 *   undo     removes the tickets of one import, while nobody has acted on them.
 * Each record is saved in one statement (request, its HR or expense details and its historical record together), so a record is either all
 * there or not at all; a record that fails is reported and the others go on. Every record of the file ends up imported, skipped or failed.
 *
 * Numbers: a record with a date of request is numbered like a live one of its form and financial year (HR-2025-26-0007, EXP-...), taking the
 * next free number of that year's counter, so it can never collide with a live request. A record without a date (some HR records) gets no
 * financial year and is numbered in its own series, HR-UNDATED-0001, ...: no year is made up for it.
 */

/** The number series of records with no date of request: HR-UNDATED-0001. */
export const UNDATED_SERIES = "UNDATED";
/** A Postgres error's code, also when the driver wraps the error. */
const pgCode = (e: unknown): string | undefined => (e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;

export type RowState = "ready" | "review" | "duplicate" | "error";
export type PreviewRow = {
  index: number;
  legacyId: string;
  requestedAt: string | null;
  requesterName: string;
  requesterEmail: string;
  categoryName: string;
  amountPaise: number | null;
  sourceStatus: string;
  state: RowState;
  /** Errors (for "error"), else the notes and the requester link's outcome. */
  messages: string[];
  linkedName: string | null;
};
export type HubCategory = { id: string; name: string; active: boolean };
export type CategoryChoice = {
  /** The source's category name, trimmed: the key of the administrator's decision. */
  source: string;
  count: number;
  sourceIds: string[];
  /** The hub category it matches by name or alias, if any. */
  match: HubCategory | null;
};
export type Preview = {
  fileName: string;
  sha256: string;
  sourceKey: string;
  sourceLabel: string;
  systemLabel: string;
  /** Which form the records become: HR requests or expenditures. */
  form: "hr" | "expenditure";
  total: number;
  ready: number;
  review: number;
  duplicates: number;
  errors: number;
  statuses: { status: string; count: number }[];
  /** Records with no date of request, no amount, no requester email, and the files the source names (names only). */
  missingDates: number;
  missingAmounts: number;
  missingEmails: number;
  attachmentRefs: number;
  unmatchedRequesters: { name: string; email: string; count: number; reason: string }[];
  categories: CategoryChoice[];
  hubCategories: HubCategory[];
  rows: PreviewRow[];
};
/** For each source category: file it under an existing hub category, or add it as a new, inactive one (never offered on the live forms). */
export type CategoryDecision = { categoryId: string } | { create: true };

type Link = { userId: string | null; linkedName: string | null; note: string | null };

/** Links each requester to a hub user only when the email AND the name agree; otherwise says why not. Nobody is attributed by guess. */
async function linkRequesters(records: HistoricalRecord[]): Promise<Map<string, Link>> {
  const people = await getDirectoryUsersByEmail(records.map((r) => r.requesterEmail));
  const byEmail = new Map(people.map((p) => [p.email, p]));
  const out = new Map<string, Link>();
  for (const r of records) {
    const key = `${r.requesterEmail}\n${r.requesterName}`;
    if (out.has(key)) continue;
    const u = r.requesterEmail ? byEmail.get(r.requesterEmail) : undefined;
    if (!r.requesterEmail) out.set(key, { userId: null, linkedName: null, note: "No email in the source, so the record is linked to nobody in the hub (kept under the source's name)." });
    else if (!u) out.set(key, { userId: null, linkedName: null, note: `No hub user has the email ${r.requesterEmail}: kept under the source's name and email, linked to nobody.` });
    else if (!sameName(u.name, r.requesterName)) {
      out.set(key, { userId: null, linkedName: null, note: `The email ${r.requesterEmail} belongs to ${u.name} in the hub, but the record names ${r.requesterName}: not linked, so it is not attributed to the wrong person.` });
    } else out.set(key, { userId: u.id, linkedName: u.name, note: null });
  }
  return out;
}
const linkOf = (links: Map<string, Link>, r: HistoricalRecord) => links.get(`${r.requesterEmail}\n${r.requesterName}`)!;

type HubCat = HubCategory & { aliases: string[]; mergedIntoId: string | null };

/** The hub's categories of the form the records become: HR request types (no aliases or merging) or expense categories. */
async function hubCategories(form: SourceAdapter["form"]): Promise<HubCat[]> {
  if (form === "hr") {
    const rows = await db.select({ id: aprHrCategories.id, name: aprHrCategories.name, active: aprHrCategories.active }).from(aprHrCategories);
    return rows.map((r) => ({ ...r, aliases: [], mergedIntoId: null }));
  }
  return db.select({ id: aprCategories.id, name: aprCategories.name, active: aprCategories.active, aliases: aprCategories.aliases, mergedIntoId: aprCategories.mergedIntoId }).from(aprCategories);
}

/** The hub category a source name matches by name or alias (a merged category leads to the one it was merged into). */
function matchCategory(cats: HubCat[], source: string): HubCategory | null {
  const k = categoryKey(source);
  const hit = cats.find((c) => categoryKey(c.name) === k) ?? cats.find((c) => c.aliases.some((a) => categoryKey(a) === k));
  if (!hit) return null;
  const target = hit.mergedIntoId ? cats.find((c) => c.id === hit.mergedIntoId) ?? hit : hit;
  return { id: target.id, name: target.name, active: target.active };
}

type Analysed = { adapter: SourceAdapter; data: unknown; records: HistoricalRecord[]; preview: Preview; links: Map<string, Link>; cats: HubCat[] };

async function analyse(fileName: string, text: string): Promise<Analysed> {
  const read = readSource(text);
  if (!read.ok) throw new ApprovalsError(read.error, 400);
  const { adapter, records } = read;
  const [links, cats, existing] = await Promise.all([
    linkRequesters(records),
    hubCategories(adapter.form),
    db.select({ legacyId: aprHistoricalRecords.legacyId }).from(aprHistoricalRecords)
      .where(and(eq(aprHistoricalRecords.sourceSystem, adapter.system), inArray(aprHistoricalRecords.legacyId, records.map((r) => r.legacyId).filter(Boolean).concat(["-"])))),
  ]);
  const imported = new Set(existing.map((e) => e.legacyId));

  const rows: PreviewRow[] = records.map((r) => {
    const link = linkOf(links, r);
    const base = { index: r.index, legacyId: r.legacyId, requestedAt: r.requestedAt, requesterName: r.requesterName, requesterEmail: r.requesterEmail, categoryName: r.categoryName, amountPaise: r.amountPaise, sourceStatus: r.sourceStatus, linkedName: link.linkedName };
    if (r.errors.length) return { ...base, state: "error", messages: r.errors };
    if (imported.has(r.legacyId)) return { ...base, state: "duplicate", messages: ["Already imported from this system: skipped, the existing ticket is left as it is."] };
    const messages = [...(link.note ? [link.note] : []), ...r.notes];
    return { ...base, state: messages.length ? "review" : "ready", messages };
  });

  const byCategory = new Map<string, CategoryChoice>();
  for (const r of records) {
    if (!r.categoryName) continue;
    const source = r.categoryName.replace(/\s+/g, " ").trim();
    const c = byCategory.get(categoryKey(source)) ?? { source, count: 0, sourceIds: [], match: matchCategory(cats, source) };
    c.count++;
    if (r.categorySourceId && !c.sourceIds.includes(r.categorySourceId)) c.sourceIds.push(r.categorySourceId);
    byCategory.set(categoryKey(source), c);
  }
  const statuses = new Map<string, number>();
  for (const r of records) statuses.set(r.sourceStatus || "(none)", (statuses.get(r.sourceStatus || "(none)") ?? 0) + 1);
  const unmatched = new Map<string, { name: string; email: string; count: number; reason: string }>();
  for (const r of records) {
    const link = linkOf(links, r);
    if (link.userId) continue;
    const key = `${r.requesterEmail}\n${r.requesterName}`;
    const u = unmatched.get(key) ?? { name: r.requesterName, email: r.requesterEmail, count: 0, reason: link.note ?? "" };
    u.count++;
    unmatched.set(key, u);
  }

  const preview: Preview = {
    fileName, sha256: createHash("sha256").update(text).digest("hex"), sourceKey: adapter.key, sourceLabel: adapter.label, systemLabel: adapter.systemLabel,
    form: adapter.form, total: rows.length, ready: rows.filter((r) => r.state === "ready").length, review: rows.filter((r) => r.state === "review").length,
    duplicates: rows.filter((r) => r.state === "duplicate").length, errors: rows.filter((r) => r.state === "error").length,
    statuses: [...statuses].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    missingDates: records.filter((r) => !r.requestedAt).length,
    missingAmounts: records.filter((r) => r.amountPaise === null).length,
    missingEmails: records.filter((r) => !r.requesterEmail).length,
    attachmentRefs: records.reduce((n, r) => n + r.extra.filter((x) => x.kind === "attachment").length, 0),
    unmatchedRequesters: [...unmatched.values()].sort((a, b) => b.count - a.count),
    categories: [...byCategory.values()].sort((a, b) => b.count - a.count),
    hubCategories: cats.filter((c) => !c.mergedIntoId).map((c) => ({ id: c.id, name: c.name, active: c.active })).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)),
    rows,
  };
  return { adapter, data: read.data, records, preview, links, cats };
}

export async function previewImport(fileName: string, text: string): Promise<Preview> {
  return (await analyse(fileName, text)).preview;
}

export type ImportOutcome = { legacyId: string; index: number; outcome: "imported" | "skipped" | "failed"; message: string; requestId?: string; requestNo?: string };
export type ImportResult = { batchId: string; total: number; imported: number; skipped: number; failed: number; rows: ImportOutcome[] };

/** Saves the importable records of a file as archived tickets, in date order (so their numbers follow the dates within each year; undated ones by the time they are listed by). */
export async function runImport(actor: ApprovalsUser, fileName: string, text: string, decisions: Record<string, CategoryDecision>): Promise<ImportResult> {
  const { adapter, data, records, preview, links, cats } = await analyse(fileName, text);
  const importable = new Set(preview.rows.filter((r) => r.state === "ready" || r.state === "review").map((r) => r.index));
  if (importable.size === 0) throw new ApprovalsError("Nothing in this file can be imported: every record is already imported or has an error.", 400);

  // Every category the importable records use must be decided: matched, mapped to a hub category, or added as a new inactive one.
  const needed = new Set(records.filter((r) => importable.has(r.index)).map((r) => categoryKey(r.categoryName)));
  const undecided = preview.categories.filter((c) => needed.has(categoryKey(c.source)) && !c.match && !decisions[categoryKey(c.source)]);
  if (undecided.length) throw new ApprovalsError(`Choose what to do with these categories first: ${undecided.map((c) => c.source).join(", ")}.`, 400);
  for (const [key, d] of Object.entries(decisions)) {
    if ("categoryId" in d && !cats.some((c) => c.id === d.categoryId && !c.mergedIntoId)) throw new ApprovalsError(`The hub category chosen for "${key}" does not exist any more. Reload and choose again.`, 409);
  }

  const [batch] = await db.insert(aprImportBatches).values({
    sourceKey: adapter.key, sourceSystem: adapter.system, fileName: fileName.slice(0, 200), fileSha256: preview.sha256, recordCount: records.length,
    raw: data as object, importedById: actor.id, importedByName: actor.name,
  }).returning({ id: aprImportBatches.id });

  // Apply the category decisions. A new category is added inactive, so the live forms never offer it. For expense categories, a mapping
  // adds the source's name as an alias of the chosen category, so the next import of the same system matches it by itself; HR request
  // types have no aliases, so the mapping is kept with the import (and on each ticket) only.
  const hr = adapter.form === "hr";
  const table = hr ? aprHrCategories : aprCategories;
  const resolved = new Map<string, { id: string; name: string }>();
  const applied: Record<string, unknown> = {};
  let sort = Math.max(0, ...(await db.select({ s: sql<number>`coalesce(max(${table.sort}), 0)::int` }).from(table)).map((r) => r.s));
  for (const c of preview.categories) {
    const key = categoryKey(c.source);
    if (!needed.has(key)) continue;
    const d = decisions[key];
    if (d && "create" in d) {
      sort += 10;
      const [made] = await db.insert(table).values({ name: c.source, active: false, sort }).onConflictDoNothing().returning({ id: table.id, name: table.name });
      const row = made ?? matchCategory(await hubCategories(adapter.form), c.source);
      if (!row) throw new ApprovalsError(`The category "${c.source}" could not be added.`, 409);
      if (made) {
        await recordAudit(actor, hr ? "hr_category" : "category", made.id, "create",
          `Added the historical ${hr ? "HR request type" : "category"} "${c.source}" (inactive, not offered on the forms) for a historical import`, null, { name: c.source, active: false, batchId: batch.id });
      }
      resolved.set(key, row);
      applied[c.source] = { created: row.id, name: row.name };
    } else if (d && "categoryId" in d) {
      const target = cats.find((x) => x.id === d.categoryId)!;
      if (!hr && categoryKey(target.name) !== key && !target.aliases.some((a) => categoryKey(a) === key)) {
        await db.update(aprCategories).set({ aliases: sql`array_append(${aprCategories.aliases}, ${c.source})` }).where(eq(aprCategories.id, target.id));
        await recordAudit(actor, "category", target.id, "update", `Added "${c.source}" as an old spelling of "${target.name}" (historical import)`, { aliases: target.aliases }, { aliases: [...target.aliases, c.source] });
      }
      resolved.set(key, { id: target.id, name: target.name });
      applied[c.source] = { categoryId: target.id, name: target.name };
    } else if (c.match) {
      resolved.set(key, { id: c.match.id, name: c.match.name });
      applied[c.source] = { matched: c.match.id, name: c.match.name };
    }
  }

  const outcomes: ImportOutcome[] = [];
  for (const row of preview.rows) {
    if (row.state === "error") outcomes.push({ legacyId: row.legacyId, index: row.index, outcome: "failed", message: row.messages.join(" ") });
    else if (row.state === "duplicate") outcomes.push({ legacyId: row.legacyId, index: row.index, outcome: "skipped", message: row.messages.join(" ") });
  }
  const toSave = records
    .filter((r) => importable.has(r.index))
    .sort((a, b) => (a.listedAt ?? "").localeCompare(b.listedAt ?? "") || a.index - b.index);
  const importedAt = new Date().toISOString();

  for (const r of toSave) {
    const link = linkOf(links, r);
    const cat = resolved.get(categoryKey(r.categoryName))!;
    const notes = [...(link.note ? [link.note] : []), ...r.notes];
    try {
      const series = r.financialYear ?? UNDATED_SERIES;
      const no = formatRequestNo(adapter.requestPrefix, series, await nextSerial(adapter.requestPrefix, series));
      // No employee is named in the source, so the HR form's first and last name stay empty (never made up from the requester's name).
      const details = hr
        ? sql`insert into apr_hr_details (request_id, first_name, last_name, hr_category_id, description)
            select id, '', '', ${cat.id}::uuid, ${r.description || null} from req returning request_id`
        : sql`insert into apr_expenditure_details (request_id, category_id, nature_of_expenditure)
            select id, ${cat.id}::uuid, ${r.description || null} from req returning request_id`;
      const res = (await db.execute(sql`
        with req as (
          insert into apr_requests (request_no, type, status, requester_user_id, requester_name, requester_email, requested_at, financial_year,
            current_step, total_steps, current_approver_user_id, decided_at, amount_paise, legacy_id, created_at, updated_at)
          values (${no}, ${r.type}::apr_request_type, 'historical'::apr_request_status, ${link.userId ?? UNLINKED_REQUESTER_ID}::uuid, ${r.requesterName},
            ${r.requesterEmail}, ${r.requestedAt ?? r.listedAt ?? importedAt}::timestamptz, ${r.financialYear}, 0, 0, null, ${r.decidedAt}::timestamptz, ${r.amountPaise},
            ${`${adapter.legacyPrefix}:${r.legacyId}`}, now(), now())
          returning id
        ), det as (${details})
        insert into apr_historical_records (request_id, batch_id, source_system, legacy_id, source_status, requester, category, source_dates, timeline, notes, extra, source_record)
        select det.request_id, ${batch.id}::uuid, ${adapter.system}, ${r.legacyId}, ${r.sourceStatus},
          ${JSON.stringify({ name: r.requesterName, email: r.requesterEmail, linkedUserId: link.userId, linkedName: link.linkedName, note: link.note })}::jsonb,
          ${JSON.stringify({ name: r.categorySourceName, sourceId: r.categorySourceId, hubCategoryId: cat.id, hubName: cat.name })}::jsonb,
          ${JSON.stringify(r.sourceDates)}::jsonb, ${JSON.stringify(r.timeline)}::jsonb,
          array(select jsonb_array_elements_text(${JSON.stringify(notes)}::jsonb)), ${JSON.stringify(r.extra)}::jsonb, ${JSON.stringify(r.source)}::jsonb
        from det
        returning request_id`)) as unknown as { rows: { request_id: string }[] };
      const id = res.rows[0]?.request_id;
      outcomes.push({ legacyId: r.legacyId, index: r.index, outcome: "imported", message: notes.length ? `Imported with ${notes.length} note${notes.length === 1 ? "" : "s"}.` : "Imported.", requestId: id, requestNo: no });
    } catch (e) {
      const dup = pgCode(e) === "23505";
      outcomes.push({
        legacyId: r.legacyId, index: r.index, outcome: dup ? "skipped" : "failed",
        message: dup ? "Already imported (by another import at the same moment): skipped." : `Could not be saved: ${e instanceof Error ? e.message.slice(0, 200) : "unknown error"}`,
      });
    }
  }
  outcomes.sort((a, b) => a.index - b.index);
  const count = (o: ImportOutcome["outcome"]) => outcomes.filter((x) => x.outcome === o).length;
  const result: ImportResult = { batchId: batch.id, total: records.length, imported: count("imported"), skipped: count("skipped"), failed: count("failed"), rows: outcomes };
  if (result.imported + result.skipped + result.failed !== result.total) throw new ApprovalsError("The import's count does not add up. Nothing more was done; check the import history.", 500);
  await db.update(aprImportBatches).set({ mapping: applied, summary: result }).where(eq(aprImportBatches.id, batch.id));
  await recordAudit(actor, "historical_import", batch.id, "create",
    `Historical import of ${fileName}: ${result.imported} imported, ${result.skipped} skipped, ${result.failed} failed (${adapter.systemLabel})`, null,
    { imported: result.imported, skipped: result.skipped, failed: result.failed, total: result.total, sha256: preview.sha256 });
  return result;
}

export type BatchRow = {
  id: string; fileName: string; systemLabel: string; recordCount: number; imported: number; skipped: number; failed: number;
  importedByName: string; createdAt: Date; undoneAt: Date | null; undoneByName: string | null; tickets: number;
};

export async function listBatches(): Promise<BatchRow[]> {
  const rows = await db
    .select({
      id: aprImportBatches.id, sourceKey: aprImportBatches.sourceKey, fileName: aprImportBatches.fileName, recordCount: aprImportBatches.recordCount, summary: aprImportBatches.summary,
      importedByName: aprImportBatches.importedByName, createdAt: aprImportBatches.createdAt, undoneAt: aprImportBatches.undoneAt, undoneByName: aprImportBatches.undoneByName,
      tickets: sql<number>`(select count(*)::int from ${aprHistoricalRecords} h where h.batch_id = ${aprImportBatches.id})`,
    })
    .from(aprImportBatches)
    .orderBy(desc(aprImportBatches.createdAt))
    .limit(50);
  return rows.map((r) => {
    const s = (r.summary ?? {}) as Partial<ImportResult>;
    return {
      id: r.id, fileName: r.fileName, systemLabel: adapterByKey(r.sourceKey)?.systemLabel ?? r.sourceKey, recordCount: r.recordCount,
      imported: s.imported ?? 0, skipped: s.skipped ?? 0, failed: s.failed ?? 0, importedByName: r.importedByName, createdAt: r.createdAt,
      undoneAt: r.undoneAt, undoneByName: r.undoneByName, tickets: r.tickets,
    };
  });
}

/** One import's per-record report (what was imported as which number, what was skipped or failed and why). */
export async function batchReport(batchId: string): Promise<ImportResult | null> {
  const [b] = await db.select({ summary: aprImportBatches.summary }).from(aprImportBatches).where(eq(aprImportBatches.id, batchId));
  return b ? (b.summary as ImportResult) : null;
}

/**
 * Removes the tickets of one import. Only archived tickets with no activity at all are removed (they are read-only, so none should have
 * any). The batch stays, marked undone, with the file it came from. Numbers already given are not reused.
 */
export async function undoImport(actor: ApprovalsUser, batchId: string): Promise<{ removed: number }> {
  const [b] = await db.select().from(aprImportBatches).where(eq(aprImportBatches.id, batchId));
  if (!b) throw new ApprovalsError("That import was not found.", 404);
  if (b.undoneAt) throw new ApprovalsError("That import was already undone.", 409);
  const removed = (await db.execute(sql`
    delete from apr_requests r
    using apr_historical_records h
    where h.request_id = r.id and h.batch_id = ${batchId}::uuid and r.status = 'historical'
      and not exists (select 1 from ${aprApprovalEvents} e where e.request_id = r.id)
    returning r.id`)) as unknown as { rows: unknown[] };
  const [left] = await db.select({ n: sql<number>`count(*)::int` }).from(aprHistoricalRecords).where(eq(aprHistoricalRecords.batchId, batchId));
  if (left.n > 0) throw new ApprovalsError(`${removed.rows.length} tickets were removed, but ${left.n} could not be (they have activity). The import is not marked undone.`, 409);
  await db.update(aprImportBatches).set({ undoneAt: new Date(), undoneByName: actor.name }).where(eq(aprImportBatches.id, batchId));
  await recordAudit(actor, "historical_import", batchId, "delete", `Undid the historical import of ${b.fileName}: ${removed.rows.length} tickets removed`, { tickets: removed.rows.length }, null);
  return { removed: removed.rows.length };
}
