import "server-only";
import { cache } from "react";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { aprCategories, aprWatchers, type AprRequestType, type AprWatcherForm } from "@/db/approvals-schema";
import { recordAudit } from "./audit";
import { ApprovalsError } from "./errors";
import { getDirectoryUsers, type ApprovalsUser } from "./host-adapter";
import { WATCH_FORM_TITLE, formHasCategories, formOfType, rulesMatch, type WatchRule } from "./watching";

/**
 * Watching rules, stored in apr_watchers (migrations 0042, 0043 and 0047): which approval types (and expense categories) a person watches,
 * and whose requests they watch (every type that person submits). Set by the Support Admin on the person's page in Administrator > Users.
 * What a watcher may then see is decided where every request's visibility is (request-queries.ts), from the rules in watching.ts.
 */
export type WatchRuleRow = { id: string; form: AprWatcherForm; categoryId: string | null; categoryName: string | null };
/** A "watch everything this person submits" rule, with the person's name. */
export type WatchedUserRow = { id: string; userId: string; name: string; email: string; active: boolean };

/**
 * The table or one of its columns is missing: migrations 0042/0043/0047 have not been run here. Until then nobody watches anything (or, with
 * only 0047 missing, rules by type still work: see watchRules).
 */
const notMigrated = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string } };
  return ["42P01", "42703"].includes(x?.code ?? "") || ["42P01", "42703"].includes(x?.cause?.code ?? "");
};
const notYet = () => new ApprovalsError("Watching cannot be set yet: the database update for watchers (apply-0043 / apply-0047) has not been run. Ask the Support Admin.", 503);

/** This person's rules (asked once per page). */
export const watchRules = cache(async (userId: string): Promise<WatchRule[]> => {
  try {
    return await db.select({ form: aprWatchers.formType, categoryId: aprWatchers.category, watchedUserId: aprWatchers.watchedUserId }).from(aprWatchers).where(eq(aprWatchers.userId, userId));
  } catch (e) {
    if (!notMigrated(e)) throw e;
  }
  // Without 0047 (no watched_user_id column yet): the rules by type, as before.
  try {
    return await db.select({ form: aprWatchers.formType, categoryId: aprWatchers.category }).from(aprWatchers).where(eq(aprWatchers.userId, userId));
  } catch (e) {
    if (notMigrated(e)) return [];
    throw e;
  }
});

/** The people whose rules match a new request: by its type (and an expenditure's category), or by who submitted it. */
export async function watcherIdsFor(type: AprRequestType, categoryId: string | null, requesterId: string): Promise<string[]> {
  const form = formOfType(type);
  let rows: { userId: string; categoryId: string | null }[];
  try {
    rows = await db.select({ userId: aprWatchers.userId, categoryId: aprWatchers.category }).from(aprWatchers).where(eq(aprWatchers.formType, form));
  } catch (e) {
    if (notMigrated(e)) return [];
    throw e;
  }
  const byType = rows.filter((r) => rulesMatch([{ form, categoryId: r.categoryId }], type, categoryId)).map((r) => r.userId);
  let byUser: string[] = [];
  try {
    byUser = (await db.select({ userId: aprWatchers.userId }).from(aprWatchers).where(eq(aprWatchers.watchedUserId, requesterId))).map((r) => r.userId);
  } catch (e) {
    if (!notMigrated(e)) throw e; // 0047 not run yet: nobody watches by user
  }
  return [...new Set([...byType, ...byUser])];
}

/**
 * A person's rules for their page in Administrator > Users: by approval type, with the names of their categories (HR first, then Expenditure,
 * then Budget), and by user, with the watched people's names. Null: watching is not set up here yet (0042/0043 not run). `users` is null
 * when only 0047 is missing (rules by type work; by user cannot be set yet).
 */
export async function listRulesOf(userId: string): Promise<{ types: WatchRuleRow[]; users: WatchedUserRow[] | null } | null> {
  let rows: { id: string; form: AprWatcherForm | null; categoryId: string | null }[];
  try {
    rows = await db.select({ id: aprWatchers.id, form: aprWatchers.formType, categoryId: aprWatchers.category }).from(aprWatchers).where(eq(aprWatchers.userId, userId)).orderBy(asc(aprWatchers.createdAt));
  } catch (e) {
    if (notMigrated(e)) return null; // the page then says watching cannot be set yet
    throw e;
  }
  const typeRows = rows.filter((r): r is { id: string; form: AprWatcherForm; categoryId: string | null } => !!r.form);
  const ids = typeRows.flatMap((r) => (r.categoryId ? [r.categoryId] : []));
  const names = new Map(ids.length ? (await db.select({ id: aprCategories.id, name: aprCategories.name }).from(aprCategories).where(inArray(aprCategories.id, ids))).map((c) => [c.id, c.name]) : []);
  const order = { hr: 0, expenditure: 1, budget: 2 } as const;
  const types = typeRows
    .map((r) => ({ ...r, categoryName: r.categoryId ? names.get(r.categoryId) ?? "Removed category" : null }))
    .sort((a, b) => order[a.form] - order[b.form] || (a.categoryName ?? "").localeCompare(b.categoryName ?? ""));

  let userRows: { id: string; watchedUserId: string | null }[] | null;
  try {
    userRows = await db.select({ id: aprWatchers.id, watchedUserId: aprWatchers.watchedUserId }).from(aprWatchers).where(and(eq(aprWatchers.userId, userId), isNotNull(aprWatchers.watchedUserId))).orderBy(asc(aprWatchers.createdAt));
  } catch (e) {
    if (!notMigrated(e)) throw e;
    userRows = null;
  }
  if (!userRows) return { types, users: null };
  const people = new Map((await getDirectoryUsers(userRows.map((r) => r.watchedUserId!))).map((p) => [p.id, p]));
  const users = userRows
    .map((r) => {
      const p = people.get(r.watchedUserId!);
      return { id: r.id, userId: r.watchedUserId!, name: p?.name ?? "Former user", email: p?.email ?? "", active: !!p?.active };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return { types, users };
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

/** Adds a "watch every request this person submits" rule. The same person twice changes nothing; nobody watches themself. */
export async function addUserRule(userId: string, watchedUserId: string, actor: ApprovalsUser): Promise<void> {
  if (userId === watchedUserId) throw new ApprovalsError("Someone cannot watch their own requests: they see them already.", 422);
  const [person, watched] = await getDirectoryUsers([userId, watchedUserId]).then((rows) => [rows.find((r) => r.id === userId), rows.find((r) => r.id === watchedUserId)]);
  if (!person?.active) throw new ApprovalsError("That person is not an active hub user.", 422);
  if (!watched?.active) throw new ApprovalsError("Pick an active hub user to watch.", 422);
  try {
    const added = await db.insert(aprWatchers).values({ formType: null, userId, category: null, watchedUserId, addedById: actor.id }).onConflictDoNothing().returning({ id: aprWatchers.id });
    if (added.length) await recordAudit(actor, "watcher", added[0].id, "grant", `${person.name} now watches all approvals from ${watched.name}`, null, { userId, watchedUserId, watchedName: watched.name });
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
  if (rule.watchedUserId) {
    const people = await getDirectoryUsers([userId, rule.watchedUserId]);
    const name = (id: string) => people.find((p) => p.id === id)?.name;
    await recordAudit(actor, "watcher", id, "revoke", `${name(userId) ?? "A user"} no longer watches all approvals from ${name(rule.watchedUserId) ?? "a former user"}`, { userId, watchedUserId: rule.watchedUserId }, null);
    return;
  }
  const [[person], cat] = await Promise.all([
    getDirectoryUsers([userId]),
    rule.category ? db.select({ name: aprCategories.name }).from(aprCategories).where(eq(aprCategories.id, rule.category)).then((r) => r[0]?.name ?? null) : null,
  ]);
  await recordAudit(actor, "watcher", id, "revoke", `${person?.name ?? "A user"} no longer watches ${ruleText(rule.formType!, cat)}`, { userId, form: rule.formType, category: rule.category }, null);
}
