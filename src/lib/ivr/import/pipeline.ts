import "server-only";
import { count, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/ivr/db";
import { allocationRules, leads, smartfloAgents, type CallCategory } from "@/db/ivr-schema";
import { hubUsers as users, listIvrAgents } from "@/lib/ivr/host-adapter";
import { listCategories, matchCategoryText } from "@/lib/ivr/categories";
import { normalizePhone } from "@/lib/ivr/phone";
import { extraColumns, type Mapping } from "./detect";
import { buildAgentIndex, matchAgent, type AgentIndex, type MatchResult } from "./match";
import type { ParsedSheet } from "./parse";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ExistingLead = {
  id: string;
  ownerId: string | null;
  ownerName: string | null;
  name: string;
  email: string | null;
  company: string | null;
  query: string | null;
  source: string | null;
  memberCode: string | null;
  categoryId: string | null;
  extra: Record<string, string>;
};

export type AnalyzedRow = {
  rowNumber: number; // spreadsheet row, header is row 1
  name: string;
  phone: string | null;
  rawPhone: string;
  email: string | null;
  company: string | null;
  query: string | null;
  source: string | null;
  memberCode: string | null;
  categoryText: string;
  category: CallCategory | null;
  extra: Record<string, string>;
  agentText: string;
  match: MatchResult;
  existing: ExistingLead | null;
  repeatOf: number | null;
  problem: string | null;
};

export type Summary = {
  total: number;
  matched: number;
  ambiguous: number;
  unmatched: number;
  duplicates: number;
  invalid: number;
};

export async function loadIndex(): Promise<AgentIndex> {
  const [us, sf] = await Promise.all([
    listIvrAgents(),
    db.select().from(smartfloAgents),
  ]);
  return buildAgentIndex(us, sf);
}

const cell = (row: string[], col: number | null) => (col === null ? "" : (row[col] ?? "").trim());

/** Parse every row with the given column mapping, find agents and existing leads. Pure of side effects. */
export async function analyze(sheet: ParsedSheet, mapping: Mapping, opts: { defaultCategoryId?: string | null } = {}) {
  const [index, categories] = await Promise.all([loadIndex(), listCategories({ activeOnly: true })]);
  const defaultCategory = categories.find((c) => c.id === opts.defaultCategoryId) ?? null;
  const extraCols = extraColumns(sheet.headers, mapping);
  const rows: AnalyzedRow[] = sheet.rows.map((r, i) => {
    const rawPhone = cell(r, mapping.phone);
    const phone = normalizePhone(rawPhone);
    const email = cell(r, mapping.email).toLowerCase();
    const agentRef = cell(r, mapping.agentRef);
    const agentPhone = cell(r, mapping.agentPhone);
    const agentEmail = cell(r, mapping.agentEmail);
    const agentName = cell(r, mapping.agentName);
    const extra: Record<string, string> = {};
    for (const c of extraCols) {
      const v = (r[c] ?? "").trim();
      if (v) extra[sheet.headers[c]] = v.slice(0, 500);
    }
    const categoryText = cell(r, mapping.category);
    const name = cell(r, mapping.name) || (email && email.split("@")[0]) || (phone ? `Lead ${phone.slice(-4)}` : "Unknown");
    return {
      rowNumber: i + 2,
      name: name.slice(0, 200),
      phone,
      rawPhone,
      email: EMAIL_RE.test(email) ? email : null,
      company: cell(r, mapping.company) || null,
      query: cell(r, mapping.query) || null,
      source: cell(r, mapping.source) || null,
      memberCode: cell(r, mapping.memberCode).slice(0, 100) || null,
      categoryText,
      category: matchCategoryText(categories, categoryText) ?? defaultCategory,
      extra,
      agentText: [agentName, agentEmail, agentPhone, agentRef].filter(Boolean).join(" · "),
      match: matchAgent(index, { agentRef, agentPhone, agentEmail, agentName }),
      existing: null,
      repeatOf: null,
      problem: phone ? null : rawPhone ? `"${rawPhone}" is not a usable phone number` : "No phone number",
    };
  });

  // repeats inside the file: the first row with a phone wins
  const firstSeen = new Map<string, number>();
  for (const r of rows) {
    if (!r.phone) continue;
    const seen = firstSeen.get(r.phone);
    if (seen) {
      r.repeatOf = seen;
      r.problem = `Same phone as row ${seen}`;
    } else firstSeen.set(r.phone, r.rowNumber);
  }

  // existing leads
  const phones = [...firstSeen.keys()];
  const existing = new Map<string, ExistingLead>();
  for (let i = 0; i < phones.length; i += 500) {
    const part = phones.slice(i, i + 500);
    const found = await db
      .select({
        phone: leads.phone,
        id: leads.id,
        ownerId: leads.ownerId,
        ownerName: users.name,
        name: leads.name,
        email: leads.email,
        company: leads.company,
        query: leads.query,
        source: leads.source,
        memberCode: leads.memberCode,
        categoryId: leads.categoryId,
        extra: leads.extra,
      })
      .from(leads)
      .leftJoin(users, eq(leads.ownerId, users.id))
      .where(inArray(leads.phone, part));
    for (const f of found) existing.set(f.phone, f);
  }
  for (const r of rows) if (r.phone && !r.repeatOf) r.existing = existing.get(r.phone) ?? null;

  const summary: Summary = { total: rows.length, matched: 0, ambiguous: 0, unmatched: 0, duplicates: 0, invalid: 0 };
  for (const r of rows) {
    if (!r.phone) {
      summary.invalid++;
      continue;
    }
    if (r.existing || r.repeatOf) summary.duplicates++;
    summary[r.match.status]++;
  }
  return { rows, summary, index, categories };
}

export type AllocSource = "file" | "choice" | "existing_owner" | "category_rule" | "round_robin";
export type Allocation = { userId: string | null; source: AllocSource | null };
export type AllocOptions = { roundRobin: boolean; roundRobinAgentIds: string[] };

/** Open (new or attempted) members per agent, so automatic allocation balances the workload. */
async function loadOpenLoad(): Promise<Map<string, number>> {
  const rows = await db
    .select({ ownerId: leads.ownerId, n: count() })
    .from(leads)
    .where(inArray(leads.stage, ["new", "attempted"]))
    .groupBy(leads.ownerId);
  return new Map(rows.filter((r) => r.ownerId).map((r) => [r.ownerId!, r.n]));
}

/**
 * Decide who gets each row. Order: the agent named in the file, then the member's existing owner,
 * then the category rule, then (optionally) round-robin across chosen agents, else nobody (unassigned pool).
 * Rows that name an agent we could not settle are left for a person to choose: they never fall back silently.
 */
export async function allocate(
  rows: AnalyzedRow[],
  validUsers: Set<string>,
  opts: AllocOptions,
  choices: Record<string, string> = {},
): Promise<Map<number, Allocation>> {
  const [ruleRows, load] = await Promise.all([db.select().from(allocationRules), loadOpenLoad()]);
  const rules = new Map<string, string[]>();
  for (const r of ruleRows) {
    if (!validUsers.has(r.userId)) continue;
    if (!rules.has(r.categoryId)) rules.set(r.categoryId, []);
    rules.get(r.categoryId)!.push(r.userId);
  }
  const rrAgents = opts.roundRobinAgentIds.filter((id) => validUsers.has(id));
  const pickLeastLoaded = (ids: string[]) => {
    let best = ids[0];
    for (const id of ids) if ((load.get(id) ?? 0) < (load.get(best) ?? 0)) best = id;
    load.set(best, (load.get(best) ?? 0) + 1);
    return best;
  };

  const out = new Map<number, Allocation>();
  for (const r of rows) {
    if (!r.phone || r.repeatOf) continue;
    const choice = choices[String(r.rowNumber)];
    if (choice && validUsers.has(choice)) {
      out.set(r.rowNumber, { userId: choice, source: "choice" });
    } else if (r.match.status === "matched" && r.match.userId) {
      out.set(r.rowNumber, { userId: r.match.userId, source: "file" });
    } else if (r.match.status === "unmatched" && !r.agentText) {
      if (r.existing?.ownerId) out.set(r.rowNumber, { userId: r.existing.ownerId, source: "existing_owner" });
      else {
        const ruleAgents = r.category ? rules.get(r.category.id) : undefined;
        if (ruleAgents?.length) out.set(r.rowNumber, { userId: pickLeastLoaded(ruleAgents), source: "category_rule" });
        else if (opts.roundRobin && rrAgents.length) out.set(r.rowNumber, { userId: pickLeastLoaded(rrAgents), source: "round_robin" });
      }
    }
  }
  return out;
}

/** Recount matched, ambiguous and unmatched once allocation rules have run: a row placed by a rule counts as matched. */
export function withAllocation(summary: Summary, rows: AnalyzedRow[], allocation: Map<number, Allocation>): Summary {
  const out: Summary = { ...summary, matched: 0, ambiguous: 0, unmatched: 0 };
  for (const r of rows) {
    if (!r.phone) continue;
    if (allocation.get(r.rowNumber)?.userId) out.matched++;
    else out[r.match.status === "matched" ? "matched" : r.match.status]++;
  }
  return out;
}

export function allocOptionsFrom(form: FormData): { opts: AllocOptions; defaultCategoryId: string | null } {
  let ids: string[] = [];
  try {
    const parsed = JSON.parse(String(form.get("rrAgents") ?? "[]"));
    if (Array.isArray(parsed)) ids = parsed.filter((x): x is string => typeof x === "string");
  } catch {
    /* none chosen */
  }
  const cat = String(form.get("defaultCategory") ?? "");
  return {
    opts: { roundRobin: form.get("roundRobin") === "1", roundRobinAgentIds: ids },
    defaultCategoryId: /^[0-9a-f-]{36}$/i.test(cat) ? cat : null,
  };
}

export function mappingFromJson(json: unknown): unknown {
  if (typeof json !== "string" || !json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}
