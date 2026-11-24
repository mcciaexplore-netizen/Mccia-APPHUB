import "server-only";
import { desc, eq, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { aprRequests, type AprRequestStatus } from "@/db/approvals-schema";

/**
 * Real counts of the Approval System's requests, for the Administrator's dashboard and Approvals page. Only the two top roles are shown
 * these (the pages check), because they cover HR and expenditure together. Historical tickets (imported from an older system) are not
 * counted: these are the live workflow's figures.
 */
export type StatusCounts = { pending: number; approved: number; rejected: number; returned: number; withdrawn: number; total: number };
const empty = (): StatusCounts => ({ pending: 0, approved: 0, rejected: 0, returned: 0, withdrawn: 0, total: 0 });

type WaitingRow = { id: string; requestNo: string | null; kind: "hr" | "expenditure_large" | "expenditure_small" | "budget"; requester: string; amountPaise: number | null; requestedAt: Date; waitingFor: string | null };

export async function approvalsOverview(): Promise<{ hr: StatusCounts; large: StatusCounts; small: StatusCounts; waiting: WaitingRow[] }> {
  const [rows, waiting] = await Promise.all([
    db.select({ type: aprRequests.type, status: aprRequests.status, n: sql<number>`count(*)::int` }).from(aprRequests).where(notInArray(aprRequests.status, ["draft", "historical"])).groupBy(aprRequests.type, aprRequests.status),
    db
      .select({
        id: aprRequests.id, requestNo: aprRequests.requestNo, kind: aprRequests.type, requester: aprRequests.requesterName, amountPaise: aprRequests.amountPaise, requestedAt: aprRequests.requestedAt,
        waitingFor: sql<string | null>`(select s.approver_name from apr_request_steps s where s.request_id = ${aprRequests.id} and s.status = 'pending' limit 1)`,
      })
      .from(aprRequests)
      .where(eq(aprRequests.status, "pending"))
      .orderBy(desc(aprRequests.requestedAt))
      .limit(10),
  ]);
  const out = { hr: empty(), large: empty(), small: empty() };
  for (const r of rows) {
    if (r.type === "budget") continue; // the overview covers HR and expenditure; budgets have their own lists
    const bucket = r.type === "hr" ? out.hr : r.type === "expenditure_large" ? out.large : out.small;
    bucket[r.status as Exclude<AprRequestStatus, "draft" | "historical">] += r.n;
    bucket.total += r.n;
  }
  return { ...out, waiting: waiting.map((w) => ({ ...w, kind: w.kind as WaitingRow["kind"] })) };
}
