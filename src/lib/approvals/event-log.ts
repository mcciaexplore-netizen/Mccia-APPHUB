import "server-only";
import { and, asc, count, desc, eq, gte, ilike, lt, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { aprApprovalEvents, aprEventAction, aprRequests } from "@/db/approvals-schema";

/** Every recorded step of every request, newest first: for the Approvals tab of the Activity Log. Viewing a request is not listed. */
export type ApprovalEventFilters = { q?: string; action?: string; from?: string; to?: string; dir: "asc" | "desc"; page: number };
export const APPROVAL_LOG_ACTIONS = aprEventAction.enumValues.filter((a) => a !== "viewed");
const PAGE = 50;

/** "2026-10-14" as the start of that day in Indian time. */
const dayStart = (d: string) => new Date(`${d}T00:00:00+05:30`);

export async function listApprovalEvents(f: ApprovalEventFilters) {
  const like = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const action = APPROVAL_LOG_ACTIONS.find((a) => a === f.action);
  const where = and(
    action ? eq(aprApprovalEvents.action, action) : or(...APPROVAL_LOG_ACTIONS.map((a) => eq(aprApprovalEvents.action, a))),
    f.q ? or(ilike(aprApprovalEvents.actorName, like(f.q)), ilike(aprRequests.requestNo, like(f.q)), ilike(aprRequests.requesterName, like(f.q))) : undefined,
    f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from) ? gte(aprApprovalEvents.createdAt, dayStart(f.from)) : undefined,
    f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to) ? lt(aprApprovalEvents.createdAt, new Date(dayStart(f.to).getTime() + 86_400_000)) : undefined,
  ) as SQL | undefined;
  const base = db.select({
    id: aprApprovalEvents.id, at: aprApprovalEvents.createdAt, actorName: aprApprovalEvents.actorName, action: aprApprovalEvents.action,
    stepNo: aprApprovalEvents.stepNo, toStatus: aprApprovalEvents.toStatus, comment: aprApprovalEvents.comment,
    requestId: aprRequests.id, requestNo: aprRequests.requestNo, requester: aprRequests.requesterName, type: aprRequests.type,
  }).from(aprApprovalEvents).innerJoin(aprRequests, eq(aprRequests.id, aprApprovalEvents.requestId));
  const [rows, [{ n }]] = await Promise.all([
    base.where(where).orderBy(f.dir === "asc" ? asc(aprApprovalEvents.createdAt) : desc(aprApprovalEvents.createdAt), desc(aprApprovalEvents.id)).limit(PAGE).offset((f.page - 1) * PAGE),
    db.select({ n: count() }).from(aprApprovalEvents).innerJoin(aprRequests, eq(aprRequests.id, aprApprovalEvents.requestId)).where(where),
  ]);
  return { rows, total: n, pages: Math.max(1, Math.ceil(n / PAGE)) };
}
