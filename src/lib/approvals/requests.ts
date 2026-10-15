import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  aprApprovalEvents, aprApproverRules, aprAttachmentSlot, aprAttachments, aprBranches, aprCategories, aprCounters, aprExpenditureDetails,
  aprHrCategories, aprHrDetails, aprPublications, aprRequestSteps, aprRequests, type AprRequestStatus, type AprRequestType,
} from "@/db/approvals-schema";
import { ApprovalsError } from "./errors";
import { appForType } from "./approvals.manifest";
import { assessBudget, commentRequired, formatRequestNo, planProblemMessage, planSteps, REQUEST_PREFIX, TYPE_LABEL, wrongFormMessage, type ExpenditureForm } from "./calc";
import { budgetPosition } from "./budget-position";
import { attachFiles, checkFilesReady } from "./files";
import { financialYearOf, formatINR, todayIST } from "./format";
import { getDirectoryUsers, listUsers, type ApprovalsUser } from "./host-adapter";
import { notify } from "./notify";
import type { HrRequestInput, LargeExpenditureInput, SmallExpenditureInput } from "./request-schemas";
import { getSettings } from "./settings";

/**
 * Submitting, deciding and withdrawing requests. The database driver has no multi-statement transactions, so each flow is ordered to
 * stay safe on its own:
 *  - A new request is written as a "draft" that nobody can see, and only becomes "pending" in its last write. If anything before that
 *    fails the draft is deleted, so a half-saved request never shows up.
 *  - A decision is claimed by one conditional update on the approver's step. Only the first of two people clicking at the same moment
 *    gets it; the other is told the request was already decided.
 * Every action writes a row to apr_approval_events (the request's history) and tells the people concerned.
 */

type Slot = (typeof aprAttachmentSlot.enumValues)[number];
type Prepared = {
  type: AprRequestType;
  requesterName: string;
  requesterEmail: string;
  requestedAt: Date;
  amountPaise: number | null;
  overBudget: boolean;
  files: { slot: Slot; fileId: string }[];
  insertDetails: (requestId: string) => Promise<void>;
};

const link = (id: string, type: AprRequestType) => `/approvals/requests/${id}?app=${appForType(type)}`;
const moneyOf = (paise: number | null) => (paise == null ? "" : ` (${formatINR(paise, { symbol: true })})`);

async function addEvent(e: typeof aprApprovalEvents.$inferInsert) {
  await db.insert(aprApprovalEvents).values(e);
}

/** The next serial number for a prefix in a financial year. One atomic statement, so two submissions never get the same number. */
async function nextSerial(prefix: string, financialYear: string): Promise<number> {
  const [row] = await db
    .insert(aprCounters)
    .values({ key: `${prefix}-${financialYear}`, lastValue: 1 })
    .onConflictDoUpdate({ target: aprCounters.key, set: { lastValue: sql`${aprCounters.lastValue} + 1` } })
    .returning({ n: aprCounters.lastValue });
  return row?.n ?? 1;
}

async function createRequest(actor: ApprovalsUser, p: Prepared): Promise<{ id: string; requestNo: string }> {
  const settings = await getSettings();

  const fileIds = p.files.map((f) => f.fileId);
  if (new Set(fileIds).size !== fileIds.length) throw new ApprovalsError("The same file cannot be attached twice. Please attach each file separately.");
  const stored = await checkFilesReady(actor, fileIds);

  const rules = await db.select().from(aprApproverRules).where(eq(aprApproverRules.requestType, p.type));
  const plan = planSteps(rules.map((r) => ({ ...r, approverUserIds: r.approverUserIds })), actor.id, p.amountPaise ?? 0);
  if (plan.problem) throw new ApprovalsError(planProblemMessage(plan.problem), 409);
  const approvers = new Map((await getDirectoryUsers(plan.steps.map((s) => s.approverUserId))).map((u) => [u.id, u]));
  for (const s of plan.steps) {
    const a = approvers.get(s.approverUserId);
    if (!a?.active) throw new ApprovalsError(`${s.stepLabel} is not an active user any more. Ask an Approvals admin to update the Approver Rules.`, 409);
  }

  const fy = financialYearOf(p.requestedAt);
  const [draft] = await db
    .insert(aprRequests)
    .values({
      type: p.type, status: "draft", requesterUserId: actor.id, requesterName: p.requesterName, requesterEmail: p.requesterEmail,
      requestedAt: p.requestedAt, financialYear: fy, currentStep: 0, totalSteps: plan.steps.length, amountPaise: p.amountPaise, overBudget: p.overBudget,
    })
    .returning({ id: aprRequests.id });

  const first = plan.steps[0];
  let requestNo: string;
  try {
    await p.insertDetails(draft.id);
    await db.insert(aprRequestSteps).values(plan.steps.map((s, i) => ({
      requestId: draft.id, stepNo: s.stepNo, stepLabel: s.stepLabel, approverUserId: s.approverUserId,
      approverName: approvers.get(s.approverUserId)!.name, status: i === 0 ? ("pending" as const) : ("waiting" as const), assignedAt: i === 0 ? new Date() : null,
    })));
    if (p.files.length) {
      await db.insert(aprAttachments).values(p.files.map((f) => {
        const meta = stored.get(f.fileId)!;
        return { requestId: draft.id, slot: f.slot, fileName: meta.fileName, mime: meta.mime, size: meta.size, storageKey: meta.id, uploadedBy: actor.id };
      }));
    }
    requestNo = formatRequestNo(REQUEST_PREFIX[p.type], fy, await nextSerial(REQUEST_PREFIX[p.type], fy));
    // The last write: from here on the request is visible and waiting for the first approver.
    const flipped = await db
      .update(aprRequests)
      .set({ status: "pending", requestNo, currentStep: 1, currentApproverUserId: first.approverUserId, updatedAt: new Date() })
      .where(and(eq(aprRequests.id, draft.id), eq(aprRequests.status, "draft")))
      .returning({ id: aprRequests.id });
    if (flipped.length === 0) throw new ApprovalsError("Something went wrong while saving the request. Please try again.", 500);
  } catch (e) {
    await db.delete(aprRequests).where(and(eq(aprRequests.id, draft.id), eq(aprRequests.status, "draft"))).catch(() => {});
    throw e;
  }

  await attachFiles(fileIds);
  const firstName = approvers.get(first.approverUserId)!.name;
  await addEvent({ requestId: draft.id, action: "submitted", actorUserId: actor.id, actorName: actor.name, fromStatus: null, toStatus: "pending" });
  await addEvent({ requestId: draft.id, action: "assigned", stepNo: 1, actorUserId: actor.id, actorName: actor.name, fromStatus: "pending", toStatus: "pending", comment: `Sent to ${firstName} (${first.stepLabel})` });
  await notify({
    userId: first.approverUserId, requestId: draft.id, link: link(draft.id, p.type), email: settings.notifyApproverOnAssignment,
    title: `${TYPE_LABEL[p.type]} ${requestNo} is waiting for your approval`,
    body: `${p.requesterName}${moneyOf(p.amountPaise)}${p.overBudget ? " · over budget" : ""}`,
  });
  return { id: draft.id, requestNo };
}

/* ---------------------------------------------------------------- submit */

export async function submitHrRequest(input: HrRequestInput, actor: ApprovalsUser) {
  const [category] = await db.select().from(aprHrCategories).where(eq(aprHrCategories.id, input.hrCategoryId));
  if (!category?.active) throw new ApprovalsError("Pick an active category.");
  const name = `${input.firstName} ${input.lastName}`;
  return createRequest(actor, {
    type: "hr", requesterName: name, requesterEmail: input.email ?? actor.email, requestedAt: input.requestedAt, amountPaise: input.amountPaise, overBudget: false,
    files: [
      ...(input.fileUpload ? [{ slot: "file_upload" as const, fileId: input.fileUpload.fileId }] : []),
      ...(input.fileUpload2 ? [{ slot: "file_upload_2" as const, fileId: input.fileUpload2.fileId }] : []),
    ],
    insertDetails: async (requestId) => {
      await db.insert(aprHrDetails).values({ requestId, firstName: input.firstName, lastName: input.lastName, hrCategoryId: input.hrCategoryId, description: input.description });
    },
  });
}

/** Both expenditure forms. The amount must match the form: 10,000 and above is "large" (DG), anything lower is "small". */
export async function submitExpenditure(form: ExpenditureForm, input: LargeExpenditureInput | SmallExpenditureInput, actor: ApprovalsUser) {
  const settings = await getSettings();
  const wrong = wrongFormMessage(form, input.amountPaise, settings.thresholdPaise);
  if (wrong) throw new ApprovalsError(wrong, 422);

  const [[category], [branch], people] = await Promise.all([
    db.select().from(aprCategories).where(eq(aprCategories.id, input.categoryId)),
    db.select().from(aprBranches).where(eq(aprBranches.id, input.branchId)),
    listUsers(),
  ]);
  if (!category?.active) throw new ApprovalsError("Pick an active category.");
  if (!branch?.active) throw new ApprovalsError("Pick an active branch.");
  const employee = people.find((u) => u.id === input.employeeUserId);
  if (!employee) throw new ApprovalsError("Pick a person from the Name list.");

  const small = form === "small" ? (input as SmallExpenditureInput) : null;
  if (small) {
    if (small.taxInvoiceDate && small.taxInvoiceDate > todayIST()) throw new ApprovalsError("The date of the tax invoice cannot be in the future.");
    if (small.publicationId && !small.publicationTypeId) throw new ApprovalsError("Pick the type of publication first.");
    if (small.publicationId) {
      const [pub] = await db.select().from(aprPublications).where(eq(aprPublications.id, small.publicationId));
      if (!pub || pub.publicationTypeId !== small.publicationTypeId) throw new ApprovalsError("That publication does not belong to the chosen type.");
    }
  }

  const fy = financialYearOf(input.requestedAt);
  const assessment = assessBudget(await budgetPosition(fy, input.branchId, input.categoryId), input.amountPaise);
  const large = form === "large" ? (input as LargeExpenditureInput) : null;

  return createRequest(actor, {
    type: form === "large" ? "expenditure_large" : "expenditure_small",
    requesterName: employee.name, requesterEmail: input.email ?? employee.email, requestedAt: input.requestedAt,
    amountPaise: input.amountPaise, overBudget: assessment.overBudget,
    files: form === "large"
      ? [
          ...(large!.supportingDocs ? [{ slot: "supporting" as const, fileId: large!.supportingDocs.fileId }] : []),
          ...(large!.quotation ? [{ slot: "quotation" as const, fileId: large!.quotation.fileId }] : []),
        ]
      : [
          ...(small!.fileUpload ? [{ slot: "file_upload" as const, fileId: small!.fileUpload.fileId }] : []),
          ...(small!.taxInvoice ? [{ slot: "tax_invoice" as const, fileId: small!.taxInvoice.fileId }] : []),
          ...(small!.quotation ? [{ slot: "quotation" as const, fileId: small!.quotation.fileId }] : []),
        ],
    insertDetails: async (requestId) => {
      await db.insert(aprExpenditureDetails).values({
        requestId, categoryId: input.categoryId, branchId: input.branchId, natureOfExpenditure: input.natureOfExpenditure, vendorName: input.vendorName,
        budgetAllocatedPaise: assessment.allocatedPaise, budgetAvailablePaise: assessment.availablePaise, budgetRemainingPaise: assessment.afterPaise, differencePaise: assessment.afterPaise,
        taxInvoiceDate: small?.taxInvoiceDate ?? null, expenseDate: small?.expenseDate ?? null,
        publicationTypeId: small?.publicationTypeId ?? null, publicationId: small?.publicationId ?? null,
      });
    },
  });
}

/* ---------------------------------------------------------------- decide */

const outcomeLabel = { approved: "approved", rejected: "rejected", withdrawn: "withdrawn" } as const;

export async function decideRequest(requestId: string, input: { action: "approve" | "reject"; comment: string | null }, actor: ApprovalsUser): Promise<{ status: AprRequestStatus }> {
  const [req] = await db.select().from(aprRequests).where(eq(aprRequests.id, requestId));
  if (!req || req.status === "draft") throw new ApprovalsError("That request does not exist.", 404);
  if (req.status !== "pending") throw new ApprovalsError(`This request has already been ${outcomeLabel[req.status as keyof typeof outcomeLabel] ?? req.status}, so it cannot be decided again.`, 409);
  if (req.requesterUserId === actor.id) throw new ApprovalsError("You cannot approve or reject your own request.", 403);

  const [step] = await db.select().from(aprRequestSteps).where(and(eq(aprRequestSteps.requestId, requestId), eq(aprRequestSteps.stepNo, req.currentStep)));
  if (!step || step.approverUserId !== actor.id) throw new ApprovalsError("This request is not waiting for you.", 403);
  // It was this person's step but someone got there first (two clicks at the same moment): say so, rather than "not yours".
  if (step.status !== "pending") throw new ApprovalsError("Someone has already decided this request.", 409);

  // Over budget is judged again now, as well as when it was submitted: the budget may have changed since.
  let overBudget = req.overBudget;
  if (req.type !== "hr" && !overBudget) {
    const [d] = await db.select().from(aprExpenditureDetails).where(eq(aprExpenditureDetails.requestId, requestId));
    if (d && req.financialYear && req.amountPaise != null) overBudget = assessBudget(await budgetPosition(req.financialYear, d.branchId, d.categoryId), req.amountPaise).overBudget;
  }
  if (commentRequired(input.action, overBudget) && !input.comment) {
    throw new ApprovalsError(input.action === "reject" ? "Please write a comment explaining why you are rejecting this request." : "This request is over budget, so a comment is required to approve it.", 422);
  }

  // The claim: only one caller can move the step out of "pending".
  const decision = input.action === "approve" ? ("approved" as const) : ("rejected" as const);
  const claimed = await db
    .update(aprRequestSteps)
    .set({ status: decision, comment: input.comment, decidedAt: new Date() })
    .where(and(eq(aprRequestSteps.id, step.id), eq(aprRequestSteps.status, "pending")))
    .returning({ id: aprRequestSteps.id });
  if (claimed.length === 0) throw new ApprovalsError("Someone has already decided this request.", 409);

  const settings = await getSettings();
  const now = new Date();
  const tell = (userId: string, title: string, body?: string) =>
    notify({ userId, requestId, link: link(requestId, req.type), title, body, email: settings.notifyRequesterOnOutcome });
  const no = req.requestNo ?? "";

  if (decision === "rejected") {
    await db.update(aprRequestSteps).set({ status: "skipped" }).where(and(eq(aprRequestSteps.requestId, requestId), eq(aprRequestSteps.status, "waiting")));
    await db.update(aprRequests).set({ status: "rejected", decidedAt: now, decisionComment: input.comment, currentApproverUserId: null, updatedAt: now }).where(eq(aprRequests.id, requestId));
    await addEvent({ requestId, action: "rejected", stepNo: step.stepNo, actorUserId: actor.id, actorName: actor.name, fromStatus: "pending", toStatus: "rejected", comment: input.comment });
    await tell(req.requesterUserId, `Your ${TYPE_LABEL[req.type]} ${no} was rejected`, input.comment ?? undefined);
    return { status: "rejected" };
  }

  const [next] = await db.select().from(aprRequestSteps).where(and(eq(aprRequestSteps.requestId, requestId), eq(aprRequestSteps.stepNo, step.stepNo + 1)));
  if (next) {
    await db.update(aprRequestSteps).set({ status: "pending", assignedAt: now }).where(and(eq(aprRequestSteps.id, next.id), eq(aprRequestSteps.status, "waiting")));
    await db.update(aprRequests).set({ currentStep: next.stepNo, currentApproverUserId: next.approverUserId, updatedAt: now }).where(eq(aprRequests.id, requestId));
    await addEvent({ requestId, action: "approved", stepNo: step.stepNo, actorUserId: actor.id, actorName: actor.name, fromStatus: "pending", toStatus: "pending", comment: input.comment });
    await addEvent({ requestId, action: "assigned", stepNo: next.stepNo, actorUserId: actor.id, actorName: actor.name, fromStatus: "pending", toStatus: "pending", comment: `Sent to ${next.approverName} (${next.stepLabel})` });
    await notify({
      userId: next.approverUserId, requestId, link: link(requestId, req.type), email: settings.notifyApproverOnAssignment,
      title: `${TYPE_LABEL[req.type]} ${no} is waiting for your approval`, body: `${req.requesterName}${moneyOf(req.amountPaise)}${overBudget ? " · over budget" : ""}`,
    });
    return { status: "pending" };
  }

  await db.update(aprRequests).set({ status: "approved", decidedAt: now, decisionComment: input.comment, currentApproverUserId: null, updatedAt: now }).where(eq(aprRequests.id, requestId));
  await addEvent({ requestId, action: "approved", stepNo: step.stepNo, actorUserId: actor.id, actorName: actor.name, fromStatus: "pending", toStatus: "approved", comment: input.comment });
  await tell(req.requesterUserId, `Your ${TYPE_LABEL[req.type]} ${no} was approved`, input.comment ?? undefined);
  return { status: "approved" };
}

/* ---------------------------------------------------------------- withdraw, view */

/** The person who raised a request may take it back while it is still pending. */
export async function withdrawRequest(requestId: string, comment: string | null, actor: ApprovalsUser): Promise<void> {
  const [req] = await db.select().from(aprRequests).where(eq(aprRequests.id, requestId));
  if (!req || req.status === "draft" || req.requesterUserId !== actor.id) throw new ApprovalsError("That request does not exist.", 404);
  const now = new Date();
  const done = await db
    .update(aprRequests)
    .set({ status: "withdrawn", decidedAt: now, currentApproverUserId: null, updatedAt: now })
    .where(and(eq(aprRequests.id, requestId), eq(aprRequests.status, "pending")))
    .returning({ id: aprRequests.id });
  if (done.length === 0) throw new ApprovalsError(`This request is already ${req.status}, so it cannot be withdrawn.`, 409);
  await db.update(aprRequestSteps).set({ status: "skipped" }).where(and(eq(aprRequestSteps.requestId, requestId), inArray(aprRequestSteps.status, ["pending", "waiting"])));
  await addEvent({ requestId, action: "withdrawn", actorUserId: actor.id, actorName: actor.name, fromStatus: "pending", toStatus: "withdrawn", comment });
  if (req.currentApproverUserId) {
    await notify({ userId: req.currentApproverUserId, requestId, link: link(requestId, req.type), title: `${TYPE_LABEL[req.type]} ${req.requestNo ?? ""} was withdrawn`, body: `${req.requesterName} took it back.` });
  }
}

/** Notes, once, that the approver the request is waiting for has opened it. */
export async function recordViewed(requestId: string, actor: ApprovalsUser): Promise<void> {
  const [req] = await db.select({ status: aprRequests.status, approver: aprRequests.currentApproverUserId, step: aprRequests.currentStep }).from(aprRequests).where(eq(aprRequests.id, requestId));
  if (!req || req.status !== "pending" || req.approver !== actor.id) return;
  const [seen] = await db
    .select({ id: aprApprovalEvents.id })
    .from(aprApprovalEvents)
    .where(and(eq(aprApprovalEvents.requestId, requestId), eq(aprApprovalEvents.action, "viewed"), eq(aprApprovalEvents.actorUserId, actor.id), eq(aprApprovalEvents.stepNo, req.step)))
    .limit(1);
  if (seen) return;
  await addEvent({ requestId, action: "viewed", stepNo: req.step, actorUserId: actor.id, actorName: actor.name, fromStatus: "pending", toStatus: "pending" });
}
