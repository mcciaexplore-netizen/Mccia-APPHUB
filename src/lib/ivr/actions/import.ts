"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/ivr/db";
import { importBatches, leads } from "@/db/ivr-schema";
import { applyAssignments } from "@/lib/ivr/assign";
import { audit } from "@/lib/ivr/audit";
import { HttpError, assertAdmin } from "@/lib/ivr/dal";
import { FIELDS, detectColumns, sanitizeMapping, type Confidence, type Mapping } from "@/lib/ivr/import/detect";
import { ImportError, parseSpreadsheet, type ParsedSheet } from "@/lib/ivr/import/parse";
import {
  allocOptionsFrom,
  allocate,
  analyze,
  withAllocation,
  mappingFromJson,
  type AllocSource,
  type AnalyzedRow,
  type Summary,
} from "@/lib/ivr/import/pipeline";

export type PreviewRow = {
  rowNumber: number;
  name: string;
  phone: string | null;
  rawPhone: string;
  email: string | null;
  agentText: string;
  status: "matched" | "ambiguous" | "unmatched";
  method: string | null;
  matchedUserId: string | null;
  matchedName: string | null;
  allocUserId: string | null;
  allocName: string | null;
  allocSource: AllocSource | null;
  category: string | null;
  memberCode: string | null;
  candidates: { userId: string; name: string }[];
  note: string | null;
  duplicate: { ownerName: string | null; hasOwner: boolean } | null;
  repeatOf: number | null;
  problem: string | null;
};

export type PreviewResult =
  | {
      ok: true;
      fileName: string;
      columns: string[];
      sample: string[][];
      mapping: Mapping;
      confidence: Confidence;
      summary: Summary;
      rows: PreviewRow[];
      rowsShown: number;
      agents: { id: string; name: string }[];
      categories: { id: string; label: string }[];
    }
  | { ok: false; error: string };

export type CommitResult =
  | {
      ok: true;
      batchId: string;
      created: number;
      updated: number;
      skippedDuplicates: number;
      skippedUnmatched: number;
      invalid: number;
      assigned: number;
      pooled: number;
      bySource: Partial<Record<AllocSource, number>>;
    }
  | { ok: false; error: string };

const chunk = <T,>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

async function readFile(formData: FormData): Promise<{ file: File; sheet: ParsedSheet }> {
  const file = formData.get("file");
  if (!(file instanceof File) || !file.name) throw new ImportError("Choose a file to import.");
  return { file, sheet: await parseSpreadsheet(file) };
}

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof ImportError) return { ok: false, error: e.message };
  if (e instanceof HttpError) return { ok: false, error: e.status === 403 ? "Only admins can import leads." : "Sign in again to continue." };
  return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." };
}

function toPreviewRow(r: AnalyzedRow, names: Map<string, string>, alloc: { userId: string | null; source: AllocSource | null } | undefined): PreviewRow {
  return {
    rowNumber: r.rowNumber,
    name: r.name,
    phone: r.phone,
    rawPhone: r.rawPhone,
    email: r.email,
    agentText: r.agentText,
    status: r.match.status,
    method: r.match.method,
    matchedUserId: r.match.userId,
    matchedName: r.match.userId ? (names.get(r.match.userId) ?? null) : null,
    allocUserId: alloc?.userId ?? null,
    allocName: alloc?.userId ? (names.get(alloc.userId) ?? null) : null,
    allocSource: alloc?.source ?? null,
    category: r.category?.label ?? null,
    memberCode: r.memberCode,
    candidates: r.match.candidates,
    note: r.match.note ?? null,
    duplicate: r.existing ? { ownerName: r.existing.ownerName, hasOwner: !!r.existing.ownerId } : null,
    repeatOf: r.repeatOf,
    problem: r.problem,
  };
}

export async function previewImport(formData: FormData): Promise<PreviewResult> {
  try {
    await assertAdmin();
    const { file, sheet } = await readFile(formData);
    const override = mappingFromJson(formData.get("mapping"));
    const detected = detectColumns(sheet.headers, sheet.rows);
    const mapping = override ? sanitizeMapping(override, sheet.headers.length) : detected.mapping;
    const confidence = override
      ? (Object.fromEntries(FIELDS.map((f) => [f, mapping[f] === detected.mapping[f] ? detected.confidence[f] : 1])) as Confidence)
      : detected.confidence;

    const { opts, defaultCategoryId } = allocOptionsFrom(formData);
    const analysed = await analyze(sheet, mapping, { defaultCategoryId });
    const { rows, index, categories } = analysed;
    const names = new Map(index.agents.map((a) => [a.userId, a.name]));
    const allocation = await allocate(rows, new Set(index.agents.map((a) => a.userId)), opts);
    const summary = withAllocation(analysed.summary, rows, allocation);

    // Everything that needs attention is shown; clean rows are only a sample.
    const attention = rows.filter((r) => (r.match.status !== "matched" && !allocation.get(r.rowNumber)) || r.existing || r.repeatOf || r.problem);
    const clean = rows.filter((r) => !attention.includes(r)).slice(0, 100);
    const shown = [...attention.slice(0, 800), ...clean].sort((a, b) => a.rowNumber - b.rowNumber);

    return {
      ok: true,
      fileName: file.name,
      columns: sheet.headers,
      sample: sheet.rows.slice(0, 3),
      mapping,
      confidence,
      summary,
      rows: shown.map((r) => toPreviewRow(r, names, allocation.get(r.rowNumber))),
      rowsShown: shown.length,
      agents: index.agents.map((a) => ({ id: a.userId, name: a.name })).sort((a, b) => a.name.localeCompare(b.name)),
      categories: categories.map((c) => ({ id: c.id, label: c.label })),
    };
  } catch (e) {
    return fail(e);
  }
}

const PLACEHOLDER_NAMES = new Set(["unknown caller", "outbound contact", "unknown"]);

export async function commitImport(formData: FormData): Promise<CommitResult> {
  try {
    const admin = await assertAdmin();
    const { file, sheet } = await readFile(formData);
    const mapping = sanitizeMapping(mappingFromJson(formData.get("mapping")), sheet.headers.length);
    if (mapping.phone === null) return { ok: false, error: "Choose which column holds the lead's phone number." };

    const unmatchedMode = formData.get("unmatched") === "skip" ? "skip" : "pool";
    const duplicatesMode = formData.get("duplicates") === "skip" ? "skip" : "update";
    const reassignDuplicates = formData.get("reassign") === "1";
    let choices: Record<string, string> = {};
    try {
      const parsed = JSON.parse(String(formData.get("choices") ?? "{}"));
      if (parsed && typeof parsed === "object") choices = parsed as Record<string, string>;
    } catch {
      /* no choices */
    }

    // Always re-analyse from the file. Nothing the browser computed is trusted.
    const { opts, defaultCategoryId } = allocOptionsFrom(formData);
    const analysed = await analyze(sheet, mapping, { defaultCategoryId });
    const { rows, index } = analysed;
    const validUsers = new Set(index.agents.map((a) => a.userId));
    const allocation = await allocate(rows, validUsers, opts, choices);
    const summary = withAllocation(analysed.summary, rows, allocation);

    const [batch] = await db
      .insert(importBatches)
      .values({
        fileName: file.name.slice(0, 200),
        uploadedBy: admin.id,
        totalRows: summary.total,
        matched: summary.matched,
        ambiguous: summary.ambiguous,
        unmatched: summary.unmatched,
        duplicates: summary.duplicates,
        status: "saving",
        columnMap: Object.fromEntries(FIELDS.map((f) => [f, mapping[f] === null ? "" : sheet.headers[mapping[f]!]])),
      })
      .returning({ id: importBatches.id });

    const bySource: Partial<Record<AllocSource, number>> = {};
    let invalid = 0;
    let skippedUnmatched = 0;
    let skippedDuplicates = 0;
    const toInsert: { row: AnalyzedRow; owner: string | null }[] = [];
    const toUpdate: { row: AnalyzedRow; owner: string | null }[] = [];

    for (const r of rows) {
      if (!r.phone) {
        invalid++;
        continue;
      }
      if (r.repeatOf) {
        skippedDuplicates++;
        continue;
      }
      const alloc = allocation.get(r.rowNumber);
      const owner: string | null = alloc?.userId ?? null;
      if (!owner && unmatchedMode === "skip" && !r.existing) {
        skippedUnmatched++;
        continue;
      }
      if (alloc?.source && owner) bySource[alloc.source] = (bySource[alloc.source] ?? 0) + 1;
      if (r.existing) {
        if (duplicatesMode === "skip") skippedDuplicates++;
        else toUpdate.push({ row: r, owner });
      } else toInsert.push({ row: r, owner });
    }

    // New leads
    const reason = `Import: ${file.name.slice(0, 120)}`;
    const createdIds: { id: string; owner: string | null }[] = [];
    for (const part of chunk(toInsert, 200)) {
      const inserted = await db
        .insert(leads)
        .values(
          part.map(({ row }) => ({
            name: row.name,
            phone: row.phone!,
            email: row.email,
            company: row.company,
            query: row.query,
            source: row.source ?? "Import",
            memberCode: row.memberCode,
            categoryId: row.category?.id ?? null,
            stage: "new" as const,
            ownerId: null, // ownership is written through lead_assignments below so the history is complete
            importBatchId: batch.id,
            extra: row.extra,
          })),
        )
        .onConflictDoNothing({ target: leads.phone })
        .returning({ id: leads.id, phone: leads.phone });
      const ownerByPhone = new Map(part.map((p) => [p.row.phone!, p.owner]));
      for (const i of inserted) createdIds.push({ id: i.id, owner: ownerByPhone.get(i.phone) ?? null });
      skippedDuplicates += part.length - inserted.length; // created by someone else in the meantime
    }

    // Existing leads: fill blanks, never overwrite what an agent has already edited
    const assignPairs: { leadId: string; ownerId: string | null }[] = createdIds.filter((c) => c.owner).map((c) => ({ leadId: c.id, ownerId: c.owner }));
    let updated = 0;
    for (const part of chunk(toUpdate, 20)) {
      await Promise.all(
        part.map(async ({ row, owner }) => {
          const ex = row.existing!;
          const patch: Partial<typeof leads.$inferInsert> = {};
          if (row.name && !row.name.startsWith("Lead ") && (!ex.name || PLACEHOLDER_NAMES.has(ex.name.toLowerCase()))) patch.name = row.name;
          if (!ex.email && row.email) patch.email = row.email;
          if (!ex.company && row.company) patch.company = row.company;
          if (!ex.query && row.query) patch.query = row.query;
          if (!ex.source && row.source) patch.source = row.source;
          if (!ex.memberCode && row.memberCode) patch.memberCode = row.memberCode;
          if (!ex.categoryId && row.category) patch.categoryId = row.category.id;
          const extra = { ...row.extra, ...ex.extra };
          if (Object.keys(extra).length !== Object.keys(ex.extra).length) patch.extra = extra;
          if (Object.keys(patch).length) {
            patch.updatedAt = new Date();
            await db.update(leads).set(patch).where(eq(leads.id, ex.id));
          }
          if (owner && (!ex.ownerId || (reassignDuplicates && ex.ownerId !== owner))) assignPairs.push({ leadId: ex.id, ownerId: owner });
          updated++;
        }),
      );
    }

    await applyAssignments(assignPairs, admin.id, reason);

    await db.update(importBatches).set({ status: "saved" }).where(eq(importBatches.id, batch.id));
    const assigned = assignPairs.length;
    const result = {
      ok: true as const,
      batchId: batch.id,
      created: createdIds.length,
      updated,
      skippedDuplicates,
      skippedUnmatched,
      invalid,
      assigned,
      pooled: createdIds.filter((c) => !c.owner).length,
      bySource,
    };
    await audit(admin.id, "leads.import", batch.id, { file: file.name, ...result });
    for (const p of ["/ivr/admin/members", "/ivr/admin", "/ivr/admin/import", "/ivr", "/ivr/pipeline"]) revalidatePath(p);
    return result;
  } catch (e) {
    return fail(e);
  }
}
