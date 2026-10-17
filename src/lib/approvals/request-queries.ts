import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  aprApprovalEvents, aprApproverRules, aprAttachments, aprBranches, aprCategories, aprExpenditureDetails, aprHrCategories, aprHrDetails, aprPublicationTypes,
  aprPublications, aprRequestSteps, aprRequests, type AprRequestStatus, type AprRequestType,
} from "@/db/approvals-schema";
import { decisionMode, type DecisionMode } from "./calc";
import { ensureRulesSeeded } from "./env-rules";
import { REVIEW_KEYS, isDgOnly, type ReviewItem } from "./approvals.manifest";
import { hasAnyRole, type ApprovalsUser } from "./host-adapter";
import type { SortKey } from "./list-params";

/** Who may see every request: viewers, Approvals admins and the DG. (An admin can also change masters, but never decides.) */
const sees = {
  all: (u: ApprovalsUser) => hasAnyRole(u, ["viewer", "approvals_admin", "dg"]),
};

/**
 * Who may see a request: the people who oversee everything, the person who raised it, and anyone who is (or was) one of its
 * approvers. Everyone else gets nothing back, as if it did not exist. Drafts are never visible.
 */
function visibility(user: ApprovalsUser): SQL | undefined {
  const notDraft = ne(aprRequests.status, "draft");
  if (sees.all(user)) return notDraft;
  return and(
    notDraft,
    or(
      eq(aprRequests.requesterUserId, user.id),
      sql`exists (select 1 from ${aprRequestSteps} s where s.request_id = ${aprRequests.id} and s.approver_user_id = ${user.id})`,
    ),
  );
}

/* ---------------------------------------------------------------- lists */

export type ListFilter = {
  types?: AprRequestType[];
  statuses?: AprRequestStatus[];
  q?: string;
  /** Inclusive dates, "2026-10-14", read as Indian time. */
  from?: string;
  to?: string;
  categoryId?: string;
  branchId?: string;
  /** Only requests this person raised. */
  mine?: boolean;
  /** Only requests currently waiting for this person. */
  waitingForMe?: boolean;
  /** Only requests this person has already approved or rejected. */
  decidedByMe?: boolean;
  /** Only requests this person recommended onward (their step approved, and the request has a later step). */
  recommendedByMe?: boolean;
  /** Only requests this person rejected. */
  rejectedByMe?: boolean;
  /** Only requests this person approved at some step. */
  approvedByMe?: boolean;
  /** Only requests that have reached this person's step (waiting for them, or already decided by them). */
  reachedMe?: boolean;
  sort?: SortKey;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

export type RequestRow = {
  id: string;
  requestNo: string | null;
  type: AprRequestType;
  status: AprRequestStatus;
  name: string;
  categoryName: string | null;
  branchName: string | null;
  amountPaise: number | null;
  requestedAt: Date;
  decidedAt: Date | null;
  approverName: string | null;
  overBudget: boolean;
  vendorName: string | null;
  taxInvoiceDate: string | null;
  /** Which step it is at, of how many: a decision before the last one is a recommendation. */
  currentStep: number;
  totalSteps: number;
  /** Waiting for the person asking, so Approve and Reject can be shown on the row. */
  mineToDecide: boolean;
};

const categoryName = sql<string | null>`coalesce(${aprHrCategories.name}, ${aprCategories.name})`;
/** The person who decided, or while it is pending the one it is waiting for. */
const approverName = sql<string | null>`coalesce(
  (select s.approver_name from ${aprRequestSteps} s where s.request_id = ${aprRequests.id} and s.status in ('approved', 'rejected', 'returned') order by s.step_no desc limit 1),
  (select s.approver_name from ${aprRequestSteps} s where s.request_id = ${aprRequests.id} and s.status = 'pending' limit 1))`;

const SORT_SQL: Record<SortKey, SQL> = {
  requestNo: sql`${aprRequests.requestNo}`,
  name: sql`lower(${aprRequests.requesterName})`,
  category: sql`lower(${categoryName})`,
  branch: sql`lower(${aprBranches.name})`,
  amount: sql`${aprRequests.amountPaise}`,
  requestedAt: sql`${aprRequests.requestedAt}`,
  status: sql`${aprRequests.status}`,
  approver: sql`lower(${approverName})`,
  decidedAt: sql`${aprRequests.decidedAt}`,
};

const istStart = (d: string) => new Date(`${d}T00:00:00+05:30`);
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function conditions(user: ApprovalsUser, f: ListFilter): SQL | undefined {
  const needle = f.q?.trim();
  const toExclusive = f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to) ? new Date(istStart(f.to).getTime() + 86400000) : undefined;
  return and(
    visibility(user),
    f.types?.length ? inArray(aprRequests.type, f.types) : undefined,
    f.statuses?.length ? inArray(aprRequests.status, f.statuses) : undefined,
    f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from) ? gte(aprRequests.requestedAt, istStart(f.from)) : undefined,
    toExclusive ? lt(aprRequests.requestedAt, toExclusive) : undefined,
    f.categoryId ? or(eq(aprExpenditureDetails.categoryId, f.categoryId), eq(aprHrDetails.hrCategoryId, f.categoryId)) : undefined,
    f.branchId ? or(eq(aprExpenditureDetails.branchId, f.branchId), eq(aprHrDetails.branchId, f.branchId)) : undefined,
    f.mine ? eq(aprRequests.requesterUserId, user.id) : undefined,
    f.waitingForMe ? and(eq(aprRequests.status, "pending"), eq(aprRequests.currentApproverUserId, user.id)) : undefined,
    f.decidedByMe
      ? sql`exists (select 1 from ${aprRequestSteps} s where s.request_id = ${aprRequests.id} and s.approver_user_id = ${user.id} and s.status in ('approved', 'rejected'))`
      : undefined,
    f.recommendedByMe
      ? sql`exists (select 1 from ${aprRequestSteps} s where s.request_id = ${aprRequests.id} and s.approver_user_id = ${user.id} and s.status = 'approved' and s.step_no < ${aprRequests.totalSteps})`
      : undefined,
    f.rejectedByMe
      ? sql`exists (select 1 from ${aprRequestSteps} s where s.request_id = ${aprRequests.id} and s.approver_user_id = ${user.id} and s.status = 'rejected')`
      : undefined,
    f.reachedMe
      ? sql`exists (select 1 from ${aprRequestSteps} s where s.request_id = ${aprRequests.id} and s.approver_user_id = ${user.id} and s.status in ('pending', 'approved', 'rejected', 'returned'))`
      : undefined,
    f.approvedByMe
      ? sql`exists (select 1 from ${aprRequestSteps} s where s.request_id = ${aprRequests.id} and s.approver_user_id = ${user.id} and s.status = 'approved')`
      : undefined,
    needle
      ? or(
          ilike(aprRequests.requestNo, `%${likeEscape(needle)}%`),
          ilike(aprRequests.requesterName, `%${likeEscape(needle)}%`),
          ilike(aprExpenditureDetails.vendorName, `%${likeEscape(needle)}%`),
          ilike(aprCategories.name, `%${likeEscape(needle)}%`),
          ilike(aprHrCategories.name, `%${likeEscape(needle)}%`),
          ilike(aprBranches.name, `%${likeEscape(needle)}%`),
        )
      : undefined,
  );
}

/** One request-sized page of the list, plus the total for the pager. All filtering, sorting and paging happens in the database. */
export async function listRequests(user: ApprovalsUser, f: ListFilter = {}): Promise<{ rows: RequestRow[]; total: number; page: number; pageSize: number }> {
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 200);
  const page = Math.max(f.page ?? 1, 1);
  const where = conditions(user, f);
  const order = SORT_SQL[f.sort ?? "requestedAt"];
  const direction = (f.dir ?? "desc") === "asc" ? asc : desc;

  const [rows, [{ n: total }]] = await Promise.all([
    db
      .select({
        id: aprRequests.id, requestNo: aprRequests.requestNo, type: aprRequests.type, status: aprRequests.status, name: aprRequests.requesterName,
        categoryName, branchName: aprBranches.name, amountPaise: aprRequests.amountPaise, requestedAt: aprRequests.requestedAt, decidedAt: aprRequests.decidedAt,
        approverName, overBudget: aprRequests.overBudget, vendorName: aprExpenditureDetails.vendorName, taxInvoiceDate: aprExpenditureDetails.taxInvoiceDate,
        currentStep: aprRequests.currentStep, totalSteps: aprRequests.totalSteps,
        mineToDecide: sql<boolean>`(${aprRequests.status} = 'pending' and ${aprRequests.currentApproverUserId} = ${user.id})`,
      })
      .from(aprRequests)
      .leftJoin(aprHrDetails, eq(aprHrDetails.requestId, aprRequests.id))
      .leftJoin(aprHrCategories, eq(aprHrCategories.id, aprHrDetails.hrCategoryId))
      .leftJoin(aprExpenditureDetails, eq(aprExpenditureDetails.requestId, aprRequests.id))
      .leftJoin(aprCategories, eq(aprCategories.id, aprExpenditureDetails.categoryId))
      .leftJoin(aprBranches, eq(aprBranches.id, aprExpenditureDetails.branchId))
      .where(where)
      .orderBy(direction(order), desc(aprRequests.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(aprRequests)
      .leftJoin(aprHrDetails, eq(aprHrDetails.requestId, aprRequests.id))
      .leftJoin(aprHrCategories, eq(aprHrCategories.id, aprHrDetails.hrCategoryId))
      .leftJoin(aprExpenditureDetails, eq(aprExpenditureDetails.requestId, aprRequests.id))
      .leftJoin(aprCategories, eq(aprCategories.id, aprExpenditureDetails.categoryId))
      .leftJoin(aprBranches, eq(aprBranches.id, aprExpenditureDetails.branchId))
      .where(where),
  ]);
  return { rows, total, page, pageSize };
}

/**
 * The places an approver works under Approval System, with how many requests wait for them in each. HR for someone named on an HR step,
 * Expenditure for someone named on an expenditure step (either size); people who oversee everything (viewers, the Approvals admin) get both.
 * A person who approves nothing and oversees nothing gets none, and the sidebar shows no dropdown.
 * The Approver Rules are filled from the HR, Expenditure and Super Admin accounts first (once, and only if they are still empty), so those
 * accounts have their place from their first sign-in, without anyone having to open the Approver Rules screen or send a request first.
 */
export async function reviewItemsFor(user: ApprovalsUser): Promise<ReviewItem[]> {
  await ensureRulesSeeded();
  const oversees = hasAnyRole(user, ["viewer", "approvals_admin"]);
  const [steps, waiting] = await Promise.all([
    oversees ? Promise.resolve([] as { type: AprRequestType }[]) : db.select({ type: aprApproverRules.requestType }).from(aprApproverRules).where(and(eq(aprApproverRules.active, true), sql`${user.id}::uuid = any(${aprApproverRules.approverUserIds})`)),
    db.select({ type: aprRequests.type, n: sql<number>`count(*)::int` }).from(aprRequests).where(and(eq(aprRequests.status, "pending"), eq(aprRequests.currentApproverUserId, user.id))).groupBy(aprRequests.type),
  ]);
  const named = new Set(steps.map((s) => (s.type === "hr" ? "hr" : "expenditure")));
  const count = (k: "hr" | "expenditure") => waiting.filter((w) => (w.type === "hr") === (k === "hr")).reduce((a, w) => a + w.n, 0);
  // The Director General has one place, what was recommended to them, with a tab each for HR and Expenditure.
  if (isDgOnly(user.roles)) {
    const counts = { hr: count("hr"), expenditure: count("expenditure") };
    return [{ key: "recommendation", waiting: counts.hr + counts.expenditure, counts }];
  }
  return REVIEW_KEYS.filter((k) => oversees || named.has(k) || count(k) > 0).map((key) => ({ key, waiting: count(key) }));
}

/** How many requests are waiting for this person; for the badge on the inbox link. */
export async function waitingCount(user: ApprovalsUser): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(aprRequests)
    .where(and(eq(aprRequests.status, "pending"), eq(aprRequests.currentApproverUserId, user.id)));
  return row?.n ?? 0;
}

/* ---------------------------------------------------------------- one request */

export type StepRow = { stepNo: number; stepLabel: string; approverName: string; status: "waiting" | "pending" | "approved" | "rejected" | "skipped" | "returned"; comment: string | null; decidedAt: Date | null };
/** The budget a request was raised with: the two figures the requester typed (allocated and used), and what follows from them. */
type BudgetView = { allocatedPaise: number | null; usedPaise: number | null; availablePaise: number | null; afterPaise: number | null };
const budgetOf = (d: { budgetAllocatedPaise: number | null; budgetAvailablePaise: number | null; budgetRemainingPaise: number | null }): BudgetView => ({
  allocatedPaise: d.budgetAllocatedPaise,
  usedPaise: d.budgetAllocatedPaise != null && d.budgetAvailablePaise != null ? d.budgetAllocatedPaise - d.budgetAvailablePaise : null,
  availablePaise: d.budgetAvailablePaise, afterPaise: d.budgetRemainingPaise,
});
export type EventRow = { id: number; action: string; stepNo: number | null; actorName: string; comment: string | null; fromStatus: string | null; toStatus: string | null; createdAt: Date };
export type AttachmentRow = { id: string; slot: string; fileName: string; size: number; mime: string };

export type RequestDetail = {
  id: string;
  requestNo: string | null;
  type: AprRequestType;
  status: AprRequestStatus;
  requesterUserId: string;
  requesterName: string;
  requesterEmail: string;
  requestedAt: Date;
  financialYear: string | null;
  amountPaise: number | null;
  overBudget: boolean;
  decidedAt: Date | null;
  decisionComment: string | null;
  currentApproverUserId: string | null;
  /** The answers to the extra fields the Support Admin added to the form, with the name each had when it was answered. */
  custom: { label: string; value: string }[];
  hr: { firstName: string; lastName: string; categoryName: string; description: string | null; budget: BudgetView | null } | null;
  expenditure: {
    categoryName: string;
    branchName: string;
    nature: string | null;
    vendorName: string | null;
    expenseDate: string | null;
    taxInvoiceDate: string | null;
    publicationType: string | null;
    publication: string | null;
    budget: BudgetView;
  } | null;
  steps: StepRow[];
  events: EventRow[];
  attachments: AttachmentRow[];
  /** While the request is returned: who sent it back and what they asked to be corrected. */
  returned: { byName: string; comment: string | null; at: Date | null } | null;
  can: {
    decide: boolean;
    withdraw: boolean;
    /** The person who raised a returned request may correct it and send it back. */
    edit: boolean;
    /** The approver must write a comment before approving: the request is over budget. */
    commentToApprove: boolean;
    /** What this person's "approve" means: recommend it to the next approver, give the final decision after someone recommended it, or approve a one-step request. */
    mode: DecisionMode;
  };
};

export const canSeeRequest = async (user: ApprovalsUser, requestId: string): Promise<boolean> => {
  const [row] = await db.select({ id: aprRequests.id }).from(aprRequests).where(and(eq(aprRequests.id, requestId), visibility(user))).limit(1);
  return !!row;
};

/** Everything the detail page shows, or null when the request does not exist or this person may not see it. */
export async function getRequestDetail(requestId: string, user: ApprovalsUser): Promise<RequestDetail | null> {
  const [req] = await db.select().from(aprRequests).where(and(eq(aprRequests.id, requestId), visibility(user)));
  if (!req) return null;

  const [hrRow, exp, steps, events, attachments] = await Promise.all([
    db
      .select({ d: aprHrDetails, categoryName: aprHrCategories.name })
      .from(aprHrDetails).innerJoin(aprHrCategories, eq(aprHrCategories.id, aprHrDetails.hrCategoryId)).where(eq(aprHrDetails.requestId, requestId)).then((r) => r[0] ?? null),
    db
      .select({ d: aprExpenditureDetails, categoryName: aprCategories.name, branchName: aprBranches.name })
      .from(aprExpenditureDetails)
      .innerJoin(aprCategories, eq(aprCategories.id, aprExpenditureDetails.categoryId))
      .innerJoin(aprBranches, eq(aprBranches.id, aprExpenditureDetails.branchId))
      .where(eq(aprExpenditureDetails.requestId, requestId)).then((r) => r[0] ?? null),
    db.select().from(aprRequestSteps).where(eq(aprRequestSteps.requestId, requestId)).orderBy(asc(aprRequestSteps.stepNo)),
    db.select().from(aprApprovalEvents).where(eq(aprApprovalEvents.requestId, requestId)).orderBy(asc(aprApprovalEvents.createdAt), asc(aprApprovalEvents.id)),
    db.select().from(aprAttachments).where(eq(aprAttachments.requestId, requestId)).orderBy(asc(aprAttachments.uploadedAt)),
  ]);

  let expenditure: RequestDetail["expenditure"] = null;
  if (exp) {
    const [type, pub] = await Promise.all([
      exp.d.publicationTypeId ? db.select({ name: aprPublicationTypes.name }).from(aprPublicationTypes).where(eq(aprPublicationTypes.id, exp.d.publicationTypeId)).then((r) => r[0]?.name ?? null) : null,
      exp.d.publicationId ? db.select({ name: aprPublications.name }).from(aprPublications).where(eq(aprPublications.id, exp.d.publicationId)).then((r) => r[0]?.name ?? null) : null,
    ]);
    expenditure = {
      categoryName: exp.categoryName, branchName: exp.branchName, nature: exp.d.natureOfExpenditure, vendorName: exp.d.vendorName,
      expenseDate: exp.d.expenseDate, taxInvoiceDate: exp.d.taxInvoiceDate, publicationType: type, publication: pub,
      budget: budgetOf(exp.d),
    };
  }

  // An HR request that carries an amount has a budget too, shown the same way.
  let hr: RequestDetail["hr"] = null;
  if (hrRow) {
    const d = hrRow.d;
    hr = { firstName: d.firstName, lastName: d.lastName, categoryName: hrRow.categoryName, description: d.description, budget: d.budgetAllocatedPaise != null ? budgetOf(d) : null };
  }

  const pending = req.status === "pending";
  const returnedStep = req.status === "returned" ? steps.find((x) => x.stepNo === req.currentStep && x.status === "returned") : undefined;
  const mine = pending && req.currentApproverUserId === user.id && req.requesterUserId !== user.id;
  return {
    id: req.id, requestNo: req.requestNo, type: req.type, status: req.status, requesterUserId: req.requesterUserId, requesterName: req.requesterName,
    requesterEmail: req.requesterEmail, requestedAt: req.requestedAt, financialYear: req.financialYear, amountPaise: req.amountPaise, overBudget: req.overBudget,
    decidedAt: req.decidedAt, decisionComment: req.decisionComment, currentApproverUserId: req.currentApproverUserId,
    custom: (req.customValues ?? []).map((c) => ({ label: c.label, value: c.value })),
    hr, expenditure, steps, events, attachments,
    returned: returnedStep ? { byName: returnedStep.approverName, comment: returnedStep.comment, at: returnedStep.decidedAt } : null,
    can: {
      decide: mine,
      withdraw: (pending || req.status === "returned") && req.requesterUserId === user.id,
      edit: req.status === "returned" && req.requesterUserId === user.id,
      commentToApprove: mine && req.overBudget,
      mode: decisionMode(req.currentStep, req.totalSteps),
    },
  };
}

/** Who may download an attachment: the same people who may see its request. Returns the stored file's id, or null. */
export async function attachmentForDownload(user: ApprovalsUser, attachmentId: string): Promise<{ storageKey: string; fileName: string; mime: string } | null> {
  const [a] = await db.select().from(aprAttachments).where(eq(aprAttachments.id, attachmentId));
  if (!a || !(await canSeeRequest(user, a.requestId))) return null;
  return { storageKey: a.storageKey, fileName: a.fileName, mime: a.mime };
}

/** The values a returned request's correction form opens with: the raw choices (ids) behind what the detail page shows in words. */
export type EditValues = {
  type: AprRequestType;
  requestNo: string | null;
  requesterName: string;
  requesterEmail: string;
  requestedAt: Date;
  amountPaise: number | null;
  hr: { firstName: string; lastName: string; hrCategoryId: string; description: string | null; budget: BudgetView | null } | null;
  expenditure: {
    categoryId: string; branchId: string; nature: string | null; vendorName: string | null; expenseDate: string | null; taxInvoiceDate: string | null;
    publicationTypeId: string | null; publicationId: string | null; budget: BudgetView;
  } | null;
  attachments: AttachmentRow[];
  /** The answers to the extra fields, by field key. */
  custom: Record<string, string>;
  returnedBy: string | null;
  returnComment: string | null;
};

/** Null unless the request is returned and this person is the one who raised it: nobody else may open the correction form. */
export async function getEditValues(requestId: string, user: ApprovalsUser): Promise<EditValues | null> {
  const [req] = await db.select().from(aprRequests).where(and(eq(aprRequests.id, requestId), eq(aprRequests.requesterUserId, user.id), eq(aprRequests.status, "returned")));
  if (!req) return null;
  const [[hr], [exp], steps, attachments] = await Promise.all([
    db.select().from(aprHrDetails).where(eq(aprHrDetails.requestId, requestId)),
    db.select().from(aprExpenditureDetails).where(eq(aprExpenditureDetails.requestId, requestId)),
    db.select().from(aprRequestSteps).where(and(eq(aprRequestSteps.requestId, requestId), eq(aprRequestSteps.stepNo, req.currentStep))),
    db.select().from(aprAttachments).where(eq(aprAttachments.requestId, requestId)).orderBy(asc(aprAttachments.uploadedAt)),
  ]);
  const step = steps[0];
  return {
    type: req.type, requestNo: req.requestNo, requesterName: req.requesterName, requesterEmail: req.requesterEmail, requestedAt: req.requestedAt, amountPaise: req.amountPaise,
    hr: hr ? { firstName: hr.firstName, lastName: hr.lastName, hrCategoryId: hr.hrCategoryId, description: hr.description, budget: hr.budgetAllocatedPaise != null ? budgetOf(hr) : null } : null,
    expenditure: exp
      ? {
          categoryId: exp.categoryId, branchId: exp.branchId, nature: exp.natureOfExpenditure, vendorName: exp.vendorName, expenseDate: exp.expenseDate, taxInvoiceDate: exp.taxInvoiceDate,
          publicationTypeId: exp.publicationTypeId, publicationId: exp.publicationId, budget: budgetOf(exp),
        }
      : null,
    attachments: attachments.map((a) => ({ id: a.id, slot: a.slot, fileName: a.fileName, size: a.size, mime: a.mime })),
    custom: Object.fromEntries((req.customValues ?? []).map((c) => [c.key, c.value])),
    returnedBy: step?.approverName ?? null,
    returnComment: step?.comment ?? null,
  };
}
