import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { aprApproverRules } from "@/db/approvals-schema";

/**
 * What each person is responsible for in the Approval System, worked out from the Approver Rules: nobody is named here by hand, so the
 * profile and the rules can never disagree. A person named on step 1 reviews first; on a later step they are the final approver.
 */
const LABEL: Record<string, string> = { hr: "HR requests", expenditure_large: "Expenditure of ₹10,000 and above", expenditure_small: "Expenses below ₹10,000" };

export async function responsibilitiesFor(userIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (userIds.length === 0) return out;
  const wanted = new Set(userIds);
  const rules = await db.select({ type: aprApproverRules.requestType, stepNo: aprApproverRules.stepNo, ids: aprApproverRules.approverUserIds }).from(aprApproverRules).where(eq(aprApproverRules.active, true));
  for (const r of rules) {
    for (const id of r.ids) {
      if (!wanted.has(id)) continue;
      const line = `${r.stepNo === 1 ? "Reviews" : "Final approver of"} ${LABEL[r.type] ?? r.type}`;
      out.set(id, [...(out.get(id) ?? []), line]);
    }
  }
  return out;
}
