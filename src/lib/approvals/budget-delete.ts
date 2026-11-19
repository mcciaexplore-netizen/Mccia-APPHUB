import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { aprApprovalEvents, aprAttachments, aprFiles, aprNotifications, aprRequests, aprSettings } from "@/db/approvals-schema";
import { recordAudit } from "./audit";
import { budgetIdOf, deleteConfirmed, deleteConfirmText, type RetiredBudget } from "./budget";
import { ApprovalsError } from "./errors";
import { formatINR } from "./format";
import { hasAnyRole, type ApprovalsUser } from "./host-adapter";

/**
 * Deleting a budget, for the Support Admin and the Super Admin only. Everything of it goes: the original, every revision, their history,
 * approval steps, notifications and files. Its Budget ID is retired (kept in apr_settings under RETIRED_KEY, as a JSON list) so that it is
 * never given to another budget, and the deletion is in the admin audit.
 */
const RETIRED_KEY = "retired_budget_ids";

/** Who may delete budgets: the Support Admin (approvals_admin) and the Super Admin (dg). */
export const canDeleteBudgets = (user: ApprovalsUser): boolean => hasAnyRole(user, ["approvals_admin", "dg"]);

/** The retired Budget IDs, newest first. */
export async function listRetiredBudgets(): Promise<RetiredBudget[]> {
  const [row] = await db.select({ value: aprSettings.value }).from(aprSettings).where(eq(aprSettings.key, RETIRED_KEY));
  if (!row) return [];
  try {
    const list = JSON.parse(row.value) as RetiredBudget[];
    return Array.isArray(list) ? [...list].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt)) : [];
  } catch {
    return [];
  }
}

/** The retired IDs alone, for numbering (see nextBudgetSerial). */
export const retiredBudgetIds = async (): Promise<string[]> => (await listRetiredBudgets()).map((r) => r.budgetId);

/** Adds an ID to the retired list in one statement, so two deletions at the same moment both stay on it. */
async function retire(entry: RetiredBudget): Promise<void> {
  await db
    .insert(aprSettings)
    .values({ key: RETIRED_KEY, value: JSON.stringify([entry]) })
    .onConflictDoUpdate({ target: aprSettings.key, set: { value: sql`(apr_settings.value::jsonb || excluded.value::jsonb)::text`, updatedAt: new Date() } });
}

/**
 * Deletes a budget (opened from the original or any revision) with all its versions. `confirm` must be the Budget ID, typed exactly (or, for
 * a budget never approved and so without an ID, its event name). The ID is retired first, so even if a later step fails it is never reused;
 * the rest is ordered so a failure part-way leaves nothing that points at a missing request.
 */
export async function deleteBudget(requestId: string, confirm: string, actor: ApprovalsUser): Promise<{ budgetId: string | null; eventName: string }> {
  if (!canDeleteBudgets(actor)) throw new ApprovalsError("Only the Support Admin or the Super Admin can delete a budget.", 403);
  const [asked] = await db.select().from(aprRequests).where(eq(aprRequests.id, requestId));
  if (!asked || asked.type !== "budget" || asked.status === "draft") throw new ApprovalsError("That budget does not exist.", 404);
  const originalId = asked.parentRequestId ?? asked.id;
  const versions = await db
    .select({ id: aprRequests.id, revisionNo: aprRequests.revisionNo, requestNo: aprRequests.requestNo, amountPaise: aprRequests.amountPaise, details: aprRequests.budgetDetails })
    .from(aprRequests)
    .where(sql`${aprRequests.id} = ${originalId} or ${aprRequests.parentRequestId} = ${originalId}`);
  const original = versions.find((v) => v.id === originalId);
  if (!original) throw new ApprovalsError("That budget does not exist.", 404);
  const budgetId = original.requestNo ? budgetIdOf(original.requestNo) : null;
  const eventName = original.details?.eventName ?? "this budget";
  if (!deleteConfirmed(confirm, budgetId, eventName)) {
    throw new ApprovalsError(`Type ${budgetId ? "the Budget ID" : "the event name"} exactly to confirm: ${deleteConfirmText(budgetId, eventName)}`, 422);
  }

  const ids = versions.map((v) => v.id);
  if (budgetId) {
    await retire({ budgetId, eventName, amountPaise: original.amountPaise, versions: versions.length, deletedAt: new Date().toISOString(), deletedById: actor.id, deletedByName: actor.name });
  }
  const files = await db.select({ key: aprAttachments.storageKey }).from(aprAttachments).where(inArray(aprAttachments.requestId, ids));
  // The history rows hold the requests back (on delete restrict), so they go first; steps, details and attachment rows go with the requests.
  await db.delete(aprApprovalEvents).where(inArray(aprApprovalEvents.requestId, ids));
  await db.delete(aprNotifications).where(inArray(aprNotifications.requestId, ids));
  await db.delete(aprRequests).where(inArray(aprRequests.id, ids));
  if (files.length) await db.delete(aprFiles).where(inArray(aprFiles.id, files.map((f) => f.key)));

  const amount = original.amountPaise == null ? "" : `, ${formatINR(original.amountPaise, { symbol: true })}`;
  await recordAudit(
    actor, "budget", originalId, "delete",
    `Deleted budget ${budgetId ?? "(no Budget ID yet)"} "${eventName}"${amount}, with ${versions.length - 1} revision${versions.length === 2 ? "" : "s"}${budgetId ? `; ${budgetId} is retired` : ""}`,
    { budgetId, eventName, amountPaise: original.amountPaise, versions: versions.map((v) => ({ id: v.id, revisionNo: v.revisionNo, amountPaise: v.amountPaise })) },
    null,
  );
  return { budgetId, eventName };
}
