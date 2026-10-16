import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { aprApproverRules, type AprRequestType } from "@/db/approvals-schema";
import { recordAudit } from "./audit";
import { ApprovalsError } from "./errors";
import { getDirectoryUsers, type ApprovalsUser } from "./host-adapter";

/**
 * Who approves what. One person per step. Changing a rule only affects requests submitted afterwards: a request keeps the steps it
 * was given when it was submitted. A step with nobody named is skipped, so clearing "Reviewer" makes the DG the only approver.
 * The first approver and the Director General must be different people: nobody can be named on step 1 of one rule and on a later step
 * of another, and nobody on two steps of the same kind of request.
 */

export type RuleRow = {
  id: string;
  requestType: AprRequestType;
  stepNo: number;
  stepLabel: string;
  minAmountPaise: number;
  maxAmountPaise: number | null;
  approverUserId: string | null;
  approverName: string | null;
  active: boolean;
};

export async function listRules(): Promise<RuleRow[]> {
  const rules = await db.select().from(aprApproverRules).orderBy(asc(aprApproverRules.requestType), asc(aprApproverRules.stepNo));
  const people = new Map((await getDirectoryUsers(rules.flatMap((r) => r.approverUserIds))).map((u) => [u.id, u]));
  return rules.map((r) => {
    const id = r.approverUserIds[0] ?? null;
    return {
      id: r.id, requestType: r.requestType, stepNo: r.stepNo, stepLabel: r.stepLabel, minAmountPaise: r.minAmountPaise, maxAmountPaise: r.maxAmountPaise,
      approverUserId: id, approverName: id ? people.get(id)?.name ?? "(removed user)" : null, active: r.active,
    };
  });
}

const describe = (r: RuleRow) => `${r.requestType} step ${r.stepNo} (${r.stepLabel})`;

/** The rule that would clash with naming this person on this rule, or undefined. Rules that are switched off do not count. */
function clashingRule(rules: RuleRow[], rule: RuleRow, personId: string): RuleRow | undefined {
  return rules.find((o) => o.id !== rule.id && o.active && o.approverUserId === personId && ((o.stepNo === 1) !== (rule.stepNo === 1) || (o.requestType === rule.requestType && o.stepNo !== rule.stepNo)));
}

export async function updateRule(id: string, patch: { approverUserId?: string | null; active?: boolean }, actor: ApprovalsUser): Promise<RuleRow> {
  const all = await listRules();
  const before = all.find((r) => r.id === id);
  if (!before) throw new ApprovalsError("That rule no longer exists.", 404);
  const person = patch.approverUserId !== undefined ? patch.approverUserId : before.approverUserId;
  if (person && (patch.active ?? before.active)) {
    const clash = clashingRule(all, before, person);
    if (clash) {
      throw new ApprovalsError(
        `${clash.approverName ?? "That person"} is already named on ${describe(clash)}. The first approver and the Director General must be different people, so they cannot hold both.`, 409,
      );
    }
  }

  const set: { approverUserIds?: string[]; active?: boolean } = {};
  if (patch.approverUserId !== undefined) {
    if (patch.approverUserId) {
      const [chosen] = await getDirectoryUsers([patch.approverUserId]);
      if (!chosen?.active) throw new ApprovalsError("Pick an active user of the hub.");
    }
    set.approverUserIds = patch.approverUserId ? [patch.approverUserId] : [];
  }
  if (patch.active !== undefined) set.active = patch.active;
  if (Object.keys(set).length === 0) throw new ApprovalsError("Nothing to change.");

  await db.update(aprApproverRules).set(set).where(eq(aprApproverRules.id, id));
  const after = (await listRules()).find((r) => r.id === id)!;
  const parts: string[] = [];
  if (before.approverUserId !== after.approverUserId) parts.push(`approver ${before.approverName ?? "nobody"} → ${after.approverName ?? "nobody"}`);
  if (before.active !== after.active) parts.push(after.active ? "turned on" : "turned off");
  if (parts.length) await recordAudit(actor, "approver_rule", id, "update", `Changed ${describe(after)}: ${parts.join(", ")}`, before, after);
  return after;
}
