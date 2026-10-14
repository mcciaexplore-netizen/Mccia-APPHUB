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

export async function updateRule(id: string, patch: { approverUserId?: string | null; active?: boolean }, actor: ApprovalsUser): Promise<RuleRow> {
  const before = (await listRules()).find((r) => r.id === id);
  if (!before) throw new ApprovalsError("That rule no longer exists.", 404);

  const set: { approverUserIds?: string[]; active?: boolean } = {};
  if (patch.approverUserId !== undefined) {
    if (patch.approverUserId) {
      const [person] = await getDirectoryUsers([patch.approverUserId]);
      if (!person?.active) throw new ApprovalsError("Pick an active user of the hub.");
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
