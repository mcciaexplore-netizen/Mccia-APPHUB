import "server-only";
import { db } from "@/db";
import { aprAdminAudit } from "@/db/approvals-schema";
import type { ApprovalsUser } from "./host-adapter";

export type AuditEntity = "category" | "hr_category" | "branch" | "publication_type" | "publication" | "budget" | "setting" | "role" | "approver_rule";

/** Every admin change to masters, rules, roles and settings leaves a row here. Request history is in apr_approval_events instead. */
export async function recordAudit(
  actor: Pick<ApprovalsUser, "id" | "name">,
  entity: AuditEntity,
  entityId: string | null,
  action: "create" | "update" | "delete" | "merge" | "grant" | "revoke",
  summary: string,
  before?: unknown,
  after?: unknown,
) {
  await db.insert(aprAdminAudit).values({
    actorUserId: actor.id, actorName: actor.name, entity, entityId, action, summary,
    before: before === undefined ? null : before, after: after === undefined ? null : after,
  });
}
