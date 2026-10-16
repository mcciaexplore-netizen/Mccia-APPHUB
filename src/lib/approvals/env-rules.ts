import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { aprAdminAudit, aprApproverRules, aprSettings, type AprRequestType } from "@/db/approvals-schema";
import { mainApprovers } from "./host-adapter";

/**
 * The first time all three approving accounts are set in the environment (HR, Expenditure and the Super Admin), the routing rules that
 * have nobody named are filled from them, once:
 *   HR request                step 1 HR                  step 2 Super Admin (the DG)
 *   Expenditure, ₹10,000+     step 1 Expenditure         step 2 Super Admin
 *   Expense below ₹10,000     step 1 Expenditure
 * Missing rules are created. A rule that already has someone is never touched, and after the one run nothing is ever filled in again, so
 * whatever the Support Admin then changes (or clears on purpose) on the Approver Rules screen stays exactly as they left it.
 */
const MARKER = "env_rules_seeded";

const PLAN: { type: AprRequestType; stepNo: number; label: string; who: "hr" | "expenditure" | "dg" }[] = [
  { type: "hr", stepNo: 1, label: "Reviewer", who: "hr" },
  { type: "hr", stepNo: 2, label: "Director General", who: "dg" },
  { type: "expenditure_large", stepNo: 1, label: "Reviewer", who: "expenditure" },
  { type: "expenditure_large", stepNo: 2, label: "Director General", who: "dg" },
  { type: "expenditure_small", stepNo: 1, label: "Reviewer", who: "expenditure" },
];

export async function ensureRulesSeeded(): Promise<void> {
  try {
    const [done] = await db.select({ key: aprSettings.key }).from(aprSettings).where(eq(aprSettings.key, MARKER));
    if (done) return;
    const people = await mainApprovers();
    if (!people.hr || !people.expenditure || !people.dg) return; // wait until all three are set up
    let filled = 0;
    for (const r of PLAN) {
      const person = people[r.who]!;
      await db.insert(aprApproverRules).values({ requestType: r.type, stepNo: r.stepNo, stepLabel: r.label, approverUserIds: [] }).onConflictDoNothing();
      const set = await db
        .update(aprApproverRules)
        .set({ approverUserIds: [person.id] })
        .where(and(eq(aprApproverRules.requestType, r.type), eq(aprApproverRules.stepNo, r.stepNo), sql`cardinality(${aprApproverRules.approverUserIds}) = 0`))
        .returning({ id: aprApproverRules.id });
      filled += set.length;
    }
    await db.insert(aprSettings).values({ key: MARKER, value: new Date().toISOString() }).onConflictDoNothing();
    if (filled > 0) {
      await db.insert(aprAdminAudit).values({
        actorUserId: null, actorName: "System", entity: "approver_rule", entityId: null, action: "update",
        summary: `Filled ${filled} empty approver rule${filled === 1 ? "" : "s"} from the main accounts: HR ${people.hr.name}, Expenditure ${people.expenditure.name}, Director General ${people.dg.name}`,
      });
    }
  } catch (e) {
    // Never stop a request or a screen because this could not run: it simply tries again next time.
    console.error("[approvals] could not fill the routing rules from the main accounts", e);
  }
}
