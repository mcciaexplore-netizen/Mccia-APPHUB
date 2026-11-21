import "server-only";
import { cache } from "react";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { aprCategories, aprWatchers, type AprRequestType, type AprWatcherForm } from "@/db/approvals-schema";
import { recordAudit } from "./audit";
import { ApprovalsError } from "./errors";
import { getDirectoryUsers, type ApprovalsUser } from "./host-adapter";
import { WATCH_FORM_TITLE, formHasCategories, formOfType, rulesMatch, type WatchRule } from "./watching";

/**
 * Watching rules, stored in apr_watchers (migrations 0042 and 0043): which approval types, and which expense categories, a person watches.
 * Set by the Support Admin on the person's page in Administrator > Users. What a watcher may then see is decided where every request's
 * visibility is (request-queries.ts), from the rules in watching.ts.
 */
export type WatchRuleRow = WatchRule & { id: string; categoryName: string | null };

/** The table or its category column is missing: migrations 0042/0043 have not been run here. Until then nobody watches anything. */
const notMigrated = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string } };
  return ["42P01", "42703"].includes(x?.code ?? "") || ["42P01", "42703"].includes(x?.cause?.code ?? "");
};
const notYet = () => new ApprovalsError("Watching cannot be set yet: the database update for watchers (apply-0043) has not been run. Ask the Support Admin.", 503);

/** This person's rules (asked once per page). */
export const watchRules = cache(async (userId: string): Promise<WatchRule[]> => {
  try {
    return (await db.select({ form: aprWatchers.formType, categoryId: aprWatchers.category }).from(aprWatchers).where(eq(aprWatchers.userId, userId)));
  } catch (e) {
    if (notMigrated(e)) return [];
    throw e;
  }
});

/** The people whose rules match a new request (its type, and an expenditure's category). */
export async function watcherIdsFor(type: AprRequestType, categoryId: string | null): Promise<string[]> {
  const form = formOfType(type);
  let rows: { userId: string; categoryId: string | null }[];
  try {
    rows = await db.select({ userId: aprWatchers.userId, categoryId: aprWatchers.category }).from(aprWatchers).where(eq(aprWatchers.formType, form));
  } catch (e) {
    if (notMigrated(e)) return [];
    throw e;
  }
  return [...new Set(rows.filter((r) => rulesMatch([{ form, categoryId: r.categoryId }], type, categoryId)).map((r) => r.userId))];
}

/** A person's rules with the names of their categories, for their page in Administrator > Users (HR first, then Expenditure, then Budget). */
export async function listRulesOf(userId: string): Promise<WatchRuleRow[] | null> {
  let rows: { id: string; form: AprWatcherForm; categoryId: string | null }[];
  try {
    rows = await db.select({ id: aprWatchers.id, form: aprWatchers.formType, categoryId: aprWatchers.category }).from(aprWatchers).where(eq(aprWatchers.userId, userId)).orderBy(asc(aprWatchers.createdAt));
  } catch (e) {
    if (notMigrated(e)) return null; // the page then says watching cannot be set yet
    throw e;
  }
  const ids = rows.flatMap((r) => (r.categoryId ? [r.categoryId] : []));
  const names = new Map(ids.length ? (await db.select({ id: aprCategories.id, name: aprCategories.name }).from(aprCategories).where(inArray(aprCategories.id, ids))).map((c) => [c.id, c.name]) : []);
  const order = { hr: 0, expenditure: 1, budget: 2 } as const;
  return rows
    .map((r) => ({ ...r, categoryName: r.categoryId ? names.get(r.categoryId) ?? "Removed category" : null }))
    .sort((a, b) => order[a.form] - order[b.form] || (a.categoryName ?? "").localeCompare(b.categoryName ?? ""));
}

/** The expense categories an Expenditure rule can name. */
export async function watchableCategories(): Promise<{ id: string; name: string }[]> {
  return db.select({ id: aprCategories.id, name: aprCategories.name }).from(aprCategories).where(eq(aprCategories.active, true)).orderBy(asc(aprCategories.name));
}

const ruleText = (form: AprWatcherForm, categoryName: string | null) => `${WATCH_FORM_TITLE[form]} (${categoryName ?? "All"})`;

/**
 * Adds a rule for a hub user. HR and Budget rules are always "All"; an Expenditure rule names an active expense category or none (all). The
 * same rule twice changes nothing.
 */
export async function addRule(userId: string, form: AprWatcherForm, categoryId: string | null, actor: ApprovalsUser): Promise<void> {
  const [person] = await getDirectoryUsers([userId]);
  if (!person?.active) throw new ApprovalsError("That person is not an active hub user.", 422);
  const category = formHasCategories(form) ? categoryId : null;
  let categoryName: string | null = null;
  if (category) {
    const [c] = await db.select({ name: aprCategories.name, active: aprCategories.active }).from(aprCategories).where(eq(aprCategories.id, category));
    if (!c?.active) throw new ApprovalsError("Pick an expense category from the list.", 422);
    categoryName = c.name;
  }
  try {
    const added = await db.insert(aprWatchers).values({ formType: form, userId, category, addedById: actor.id }).onConflictDoNothing().returning({ id: aprWatchers.id });
    if (added.length) await recordAudit(actor, "watcher", added[0].id, "grant", `${person.name} now watches ${ruleText(form, categoryName)}`, null, { userId, form, category, categoryName });
  } catch (e) {
    if (notMigrated(e)) throw notYet();
    throw e;
  }
}

/** Removes one of a person's rules. */
export async function removeRule(userId: string, id: string, actor: ApprovalsUser): Promise<void> {
  let gone: (typeof aprWatchers.$inferSelect)[];
  try {
    gone = await db.delete(aprWatchers).where(and(eq(aprWatchers.id, id), eq(aprWatchers.userId, userId))).returning();
  } catch (e) {
    if (notMigrated(e)) throw notYet();
    throw e;
  }
  const rule = gone[0];
  if (!rule) return;
  const [[person], cat] = await Promise.all([
    getDirectoryUsers([userId]),
    rule.category ? db.select({ name: aprCategories.name }).from(aprCategories).where(eq(aprCategories.id, rule.category)).then((r) => r[0]?.name ?? null) : null,
  ]);
  await recordAudit(actor, "watcher", id, "revoke", `${person?.name ?? "A user"} no longer watches ${ruleText(rule.formType, cat)}`, { userId, form: rule.formType, category: rule.category }, null);
}
