import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { aprApproverRules, aprBranches, aprCategories, aprHrCategories } from "@/db/approvals-schema";

export type SetupItem = { label: string; detail: string; done: boolean; href: string };

const countOf = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;

/** What an admin still has to fill in before staff can use the forms, shown on the module's home screen. */
export async function setupChecklist(): Promise<SetupItem[]> {
  const [categories, hrCategories, branches, steps] = await Promise.all([
    countOf(db.select({ n: sql<number>`count(*)::int` }).from(aprCategories).where(eq(aprCategories.active, true))),
    countOf(db.select({ n: sql<number>`count(*)::int` }).from(aprHrCategories).where(eq(aprHrCategories.active, true))),
    countOf(db.select({ n: sql<number>`count(*)::int` }).from(aprBranches).where(eq(aprBranches.active, true))),
    // A kind of request can be routed once at least one of its steps has a person named (an empty Reviewer step is simply skipped).
    db
      .select({ type: aprApproverRules.requestType, staffed: sql<number>`(count(*) filter (where cardinality(${aprApproverRules.approverUserIds}) > 0))::int` })
      .from(aprApproverRules)
      .where(eq(aprApproverRules.active, true))
      .groupBy(aprApproverRules.requestType)
      .then((rows) => ({ total: rows.length, staffed: rows.filter((r) => r.staffed > 0).length })),
  ]);
  return [
    { label: "Expense categories", detail: `${categories} active`, done: categories > 0, href: "/approvals/admin/categories" },
    { label: "HR categories", detail: `${hrCategories} active`, done: hrCategories > 0, href: "/approvals/admin/hr-categories" },
    { label: "Branches", detail: branches ? `${branches} active` : "None yet: the Expenses forms need at least one", done: branches > 0, href: "/approvals/admin/branches" },
    {
      label: "Approvers on the routing rules",
      detail: steps.total === 0 ? "No routing rules yet (run the approvals seed)" : `${steps.staffed} of ${steps.total} kinds of request have an approver`,
      done: steps.total > 0 && steps.staffed === steps.total,
      href: "/approvals/admin/rules",
    },
  ];
}
