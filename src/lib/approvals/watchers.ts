import "server-only";
import { cache } from "react";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { aprWatchers, type AprWatcherForm } from "@/db/approvals-schema";
import { recordAudit } from "./audit";
import { ApprovalsError } from "./errors";
import { getDirectoryUsers, type ApprovalsUser } from "./host-adapter";
import { WATCH_FORM_LABEL } from "./watching";

/**
 * Watchers, stored in apr_watchers (migration 0042): who watches which form. Managed by the Support Admin in Administrator > Approval Forms;
 * what a watcher may then see is decided where every request's visibility is (request-queries.ts), with the rules in watching.ts.
 */
export type WatcherRow = { id: string; formType: AprWatcherForm; userId: string; name: string; email: string; active: boolean; addedAt: Date };

/** The table is missing: migration 0042 has not been run on this database. Until then nobody watches anything. */
const tableMissing = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string } };
  return x?.code === "42P01" || x?.cause?.code === "42P01";
};

/** The forms this person watches (asked once per page). */
export const watchedForms = cache(async (userId: string): Promise<AprWatcherForm[]> => {
  try {
    return (await db.select({ form: aprWatchers.formType }).from(aprWatchers).where(eq(aprWatchers.userId, userId))).map((r) => r.form);
  } catch (e) {
    if (tableMissing(e)) return [];
    throw e;
  }
});

/** The people watching a form, by id (for notices). */
export async function watcherIdsOf(form: AprWatcherForm): Promise<string[]> {
  try {
    return (await db.select({ userId: aprWatchers.userId }).from(aprWatchers).where(eq(aprWatchers.formType, form))).map((r) => r.userId);
  } catch (e) {
    if (tableMissing(e)) return [];
    throw e;
  }
}

/** Every watcher of every form, with their names, for Administrator > Approval Forms. */
export async function listWatchers(): Promise<WatcherRow[]> {
  let rows: (typeof aprWatchers.$inferSelect)[];
  try {
    rows = await db.select().from(aprWatchers).orderBy(asc(aprWatchers.createdAt));
  } catch (e) {
    if (tableMissing(e)) return [];
    throw e;
  }
  const people = new Map((await getDirectoryUsers([...new Set(rows.map((r) => r.userId))])).map((u) => [u.id, u]));
  return rows
    .map((r) => {
      const p = people.get(r.userId);
      return { id: r.id, formType: r.formType, userId: r.userId, name: p?.name ?? "Removed user", email: p?.email ?? "", active: !!p?.active, addedAt: r.createdAt };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

const notYet = () => new ApprovalsError("Watchers cannot be added yet: the database update for watchers (apply-0042) has not been run. Ask the Support Admin.", 503);

/** Adds a hub user as a watcher of a form. Adding someone who already watches it changes nothing. */
export async function addWatcher(form: AprWatcherForm, userId: string, actor: ApprovalsUser): Promise<void> {
  const [person] = await getDirectoryUsers([userId]);
  if (!person?.active) throw new ApprovalsError("Pick an active hub user.", 422);
  try {
    const added = await db.insert(aprWatchers).values({ formType: form, userId, addedById: actor.id }).onConflictDoNothing().returning({ id: aprWatchers.id });
    if (added.length) await recordAudit(actor, "watcher", added[0].id, "grant", `${person.name} now watches the ${WATCH_FORM_LABEL[form]} form`, null, { form, userId, name: person.name });
  } catch (e) {
    if (tableMissing(e)) throw notYet();
    throw e;
  }
}

/** Removes one watcher (by the row's id) from the form given. */
export async function removeWatcher(form: AprWatcherForm, id: string, actor: ApprovalsUser): Promise<void> {
  let gone: (typeof aprWatchers.$inferSelect)[];
  try {
    gone = await db.delete(aprWatchers).where(and(eq(aprWatchers.id, id), eq(aprWatchers.formType, form))).returning();
  } catch (e) {
    if (tableMissing(e)) throw notYet();
    throw e;
  }
  if (!gone.length) return;
  const [person] = await getDirectoryUsers([gone[0].userId]);
  await recordAudit(actor, "watcher", id, "revoke", `${person?.name ?? "A user"} no longer watches the ${WATCH_FORM_LABEL[form]} form`, { form, userId: gone[0].userId, name: person?.name ?? null }, null);
}
