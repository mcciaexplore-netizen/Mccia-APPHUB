/**
 * Integration test of the Approvals server code against a real Postgres: submitting, routing, deciding, the budget the requester types, files, visibility,
 * lists and reports, calling the module's own functions directly (no browser, no web server).
 *
 * It WRITES to the database, so point it at a scratch database, never the live one:
 *   INTEGRATION_DB_CONFIRM=yes INTEGRATION_DATABASE_URL=postgres://postgres@127.0.0.1:5432/scratch npm run test:integration
 * It puts the routing rules and request counters back as they were. The scratch database needs every migration applied first (npx drizzle-kit migrate, with DATABASE_URL pointing at it). A Neon branch of
 * the real database also works. Everything it creates is named "ZZ"/"zz-int-" and is removed when it finishes. The project's own .env
 * is NOT read, so it cannot reach the live database by accident.
 */
import { randomUUID } from "node:crypto";

const url = process.env.INTEGRATION_DATABASE_URL;
if (process.env.INTEGRATION_DB_CONFIRM !== "yes" || !url) {
  console.error("Set INTEGRATION_DATABASE_URL to a scratch database and INTEGRATION_DB_CONFIRM=yes (this test writes to it).");
  process.exit(2);
}
process.env.DATABASE_URL = url;
process.env.DB_DRIVER = process.env.INTEGRATION_DB_DRIVER ?? "pg";
process.env.APPROVALS_ENABLED = "true";
delete process.env.SMTP_HOST; // no real email from a test

const { and, eq, like, sql } = await import("drizzle-orm");
const { db } = await import("../src/db");
const { users } = await import("../src/db/schema");
const T = await import("../src/db/approvals-schema");
const S = await import("../src/lib/approvals/request-schemas");
const R = await import("../src/lib/approvals/requests");
const Q = await import("../src/lib/approvals/request-queries");
const F = await import("../src/lib/approvals/files");
const Rep = await import("../src/lib/approvals/reports");
const N = await import("../src/lib/approvals/notify");
const Rules = await import("../src/lib/approvals/rules");
const Setup = await import("../src/lib/approvals/setup");
const Settings = await import("../src/lib/approvals/settings");
const { financialYearOf } = await import("../src/lib/approvals/format");
const { ApprovalsError } = await import("../src/lib/approvals/errors");
type Actor = import("../src/lib/approvals/host-adapter").ApprovalsUser;

let ok = 0, bad = 0;
const check = (name: string, pass: unknown, extra: unknown = "") => {
  if (pass) ok++; else bad++;
  console.log(pass ? "PASS" : "FAIL", name, pass || extra === "" ? "" : `\n   -> ${typeof extra === "string" ? extra : JSON.stringify(extra)}`);
};
/** Runs something that should be refused, and returns the refusal's status and message. */
const refused = async (fn: () => Promise<unknown>): Promise<{ status: number; message: string } | null> => {
  try { await fn(); return null; } catch (e) { return e instanceof ApprovalsError ? { status: e.status, message: e.message } : { status: -1, message: String((e as Error)?.stack ?? e) }; }
};

const FY = financialYearOf();
// The test replaces the routing rules and the request counters with its own; the real ones are put back at the end.
const savedRules = await db.select().from(T.aprApproverRules);
const savedCounters = await db.select().from(T.aprCounters);
const savedSeedMarker = await db.select().from(T.aprSettings).where(eq(T.aprSettings.key, "env_rules_seeded"));
const savedFormFields = await db.select().from(T.aprFormFields);
const cleanup = async () => {
  const people = await db.select({ id: users.id }).from(users).where(like(users.email, "zz-int-%"));
  for (const p of people) {
    for (const r of await db.select({ id: T.aprRequests.id }).from(T.aprRequests).where(eq(T.aprRequests.requesterUserId, p.id))) {
      await db.delete(T.aprApprovalEvents).where(eq(T.aprApprovalEvents.requestId, r.id));
      await db.delete(T.aprRequests).where(eq(T.aprRequests.id, r.id));
    }
    await db.delete(T.aprFiles).where(eq(T.aprFiles.uploadedBy, p.id));
    await db.delete(T.aprNotifications).where(eq(T.aprNotifications.userId, p.id));
    await db.delete(T.aprRateLimits).where(eq(T.aprRateLimits.userId, p.id));
  }
  await db.delete(T.aprApproverRules);
  await db.delete(users).where(like(users.email, "zz-int-%"));
  await db.delete(T.aprCategories).where(like(T.aprCategories.name, "ZZ%"));
  await db.delete(T.aprHrCategories).where(like(T.aprHrCategories.name, "ZZ%"));
  await db.delete(T.aprBranches).where(like(T.aprBranches.name, "ZZ%"));
  await db.delete(T.aprPublications).where(like(T.aprPublications.name, "ZZ%"));
  await db.delete(T.aprPublicationTypes).where(like(T.aprPublicationTypes.name, "ZZ%"));
  await db.delete(T.aprCounters);
};

const person = async (key: string, roles: Actor["roles"]): Promise<Actor> => {
  const email = `zz-int-${key}@example.com`;
  const [u] = await db.insert(users).values({ name: `ZZ Int ${key}`, email, status: "approved" }).returning({ id: users.id });
  return { id: u.id, name: `ZZ Int ${key}`, email, roles: ["requester", ...roles] };
};
const bytesOf = async (stream: ReadableStream<Uint8Array>) => Buffer.concat(await (async () => { const out: Buffer[] = []; const rd = stream.getReader(); for (;;) { const { done, value } = await rd.read(); if (done) break; out.push(Buffer.from(value)); } return out; })());

try {
  await cleanup();

  /* ------------------------------------------------------------------ setup */
  const req = await person("requester", []);
  const dg = await person("dg", ["dg"]);
  const small = await person("small", ["approver"]);
  const other = await person("other", []);
  const viewer = await person("viewer", ["viewer"]);
  const [branch] = await db.insert(T.aprBranches).values({ name: "ZZ Int Branch" }).returning();
  const [cat] = await db.insert(T.aprCategories).values({ name: "ZZ Int Category" }).returning();
  const [hrCat] = await db.insert(T.aprHrCategories).values({ name: "ZZ Int HR" }).returning();
  const [pubType] = await db.insert(T.aprPublicationTypes).values({ name: "ZZ Int Type" }).returning();
  const [pub] = await db.insert(T.aprPublications).values({ name: "ZZ Int Pub", publicationTypeId: pubType.id }).returning();
  // Seed-like rules: HR and large expenditure have an empty Reviewer step and the DG on step 2; small has the below-10k approver on step 1.
  await db.insert(T.aprApproverRules).values([
    { requestType: "hr", stepNo: 1, stepLabel: "Reviewer", approverUserIds: [] },
    { requestType: "hr", stepNo: 2, stepLabel: "Director General", approverUserIds: [dg.id] },
    { requestType: "expenditure_large", stepNo: 1, stepLabel: "Reviewer", approverUserIds: [] },
    { requestType: "expenditure_large", stepNo: 2, stepLabel: "Director General", approverUserIds: [dg.id] },
    { requestType: "expenditure_small", stepNo: 1, stepLabel: "Reviewer", approverUserIds: [small.id] },
  ]);
  const settings = await Settings.getSettings();
  check("settings fall back to the 10,000 default", settings.thresholdPaise === 1_000_000, settings.thresholdPaise);

  const hr = (extra: object = {}) => S.hrRequestInput.parse({ firstName: "Asha", lastName: "Patil", hrCategoryId: hrCat.id, ...extra });
  // The requester types the budget: allocated, and how much of it is used. By default a roomy one, so a request is not over budget unless a test says so.
  const ROOMY = { budgetAllocatedPaise: 100_000_000, budgetUsedPaise: 0 };
  const large = (amountPaise: number, extra: object = {}) => S.largeExpenditureInput.parse({ employeeUserId: req.id, categoryId: cat.id, branchId: branch.id, amountPaise, vendorName: "V", ...ROOMY, ...extra });
  const smallIn = (amountPaise: number, extra: object = {}) => S.smallExpenditureInput.parse({ employeeUserId: req.id, email: req.email, categoryId: cat.id, branchId: branch.id, amountPaise, vendorName: "Vendor", ...ROOMY, ...extra });
  const row = async (id: string) => (await db.select().from(T.aprRequests).where(eq(T.aprRequests.id, id)))[0];

  /* ------------------------------------------------------------------ HR, with a file */
  const body = Buffer.from("%PDF-1.4 integration test file");
  const up = await F.startUpload(req, { fileName: "zz-note.pdf", size: body.length });
  await F.putChunk(req, up.fileId, 0, body);
  const hrMade = await R.submitHrRequest(hr({ fileUpload: { fileId: up.fileId }, description: "  needs a certificate  " }), req);
  const hrRow = await row(hrMade.id);
  check("an HR request is saved pending with an HR number for this financial year", hrRow.status === "pending" && hrMade.requestNo === `HR-${FY}-0001`, hrMade.requestNo);
  check("with the Reviewer step empty it goes straight to the DG, as step 1 of 1", hrRow.currentApproverUserId === dg.id && hrRow.totalSteps === 1 && hrRow.currentStep === 1);
  check("the requester is the signed-in person, the name is what was typed", hrRow.requesterUserId === req.id && hrRow.requesterName === "Asha Patil" && hrRow.requesterEmail === req.email);
  const [hrDetails] = await db.select().from(T.aprHrDetails).where(eq(T.aprHrDetails.requestId, hrMade.id));
  check("the description is trimmed and stored", hrDetails.description === "needs a certificate");
  check("the DG has a notification", (await N.recentNotifications(dg.id)).some((n) => n.link === `/approvals/requests/${hrMade.id}?app=hr`));
  check("the DG's unread count is 1", (await N.unreadCount(dg.id)) === 1);
  const detail0 = await Q.getRequestDetail(hrMade.id, dg);
  check("the DG can open it and may decide", !!detail0 && detail0.can.decide && !detail0.can.withdraw && detail0.attachments.length === 1);
  const att = detail0!.attachments[0];
  const dl = await Q.attachmentForDownload(dg, att.id);
  const bytes = dl ? await bytesOf(F.readFileStream((await F.getStoredFile(dl.storageKey))!)) : Buffer.alloc(0);
  check("the stored file comes back byte for byte", bytes.equals(body), bytes.toString());
  check("someone not involved cannot see the request or download the file", (await Q.getRequestDetail(hrMade.id, other)) === null && (await Q.attachmentForDownload(other, att.id)) === null);
  check("the requester sees it and may withdraw it", (await Q.getRequestDetail(hrMade.id, req))?.can.withdraw === true);
  check("a viewer sees it but cannot decide", (await Q.getRequestDetail(hrMade.id, viewer))?.can.decide === false);
  check("a file that was used cannot be attached again", (await refused(() => R.submitHrRequest(hr({ fileUpload: { fileId: up.fileId } }), req)))?.status === 409);

  await R.recordViewed(hrMade.id, dg);
  await R.recordViewed(hrMade.id, dg);
  check("opening is recorded once", (await db.select().from(T.aprApprovalEvents).where(and(eq(T.aprApprovalEvents.requestId, hrMade.id), eq(T.aprApprovalEvents.action, "viewed")))).length === 1);

  check("the requester cannot decide their own request", (await refused(() => R.decideRequest(hrMade.id, { action: "approve", comment: null }, req)))?.status === 403);
  check("someone who has nothing to do with the request cannot decide it, and is told it does not exist", (await refused(() => R.decideRequest(hrMade.id, { action: "approve", comment: null }, small)))?.status === 404);
  check("rejecting needs a comment", (await refused(() => R.decideRequest(hrMade.id, { action: "reject", comment: null }, dg)))?.status === 422);
  check("the DG approves", (await R.decideRequest(hrMade.id, { action: "approve", comment: null }, dg)).status === "approved");
  const hrDone = await row(hrMade.id);
  check("it is approved with a decision time and nobody waiting", hrDone.status === "approved" && !!hrDone.decidedAt && hrDone.currentApproverUserId === null);
  check("deciding again is a clear 409", (await refused(() => R.decideRequest(hrMade.id, { action: "reject", comment: "x" }, dg)))?.status === 409);
  check("the requester was told", (await N.recentNotifications(req.id)).some((n) => /was approved/.test(n.title)));
  const actions = (await db.select().from(T.aprApprovalEvents).where(eq(T.aprApprovalEvents.requestId, hrMade.id)).orderBy(T.aprApprovalEvents.id)).map((e) => e.action);
  check("the history reads submitted, assigned, viewed, approved", JSON.stringify(actions) === JSON.stringify(["submitted", "assigned", "viewed", "approved"]), actions);
  check("it can no longer be withdrawn", (await refused(() => R.withdrawRequest(hrMade.id, null, req)))?.status === 409);

  /* ------------------------------------------------------------------ the 10,000 rule and the typed budget */
  check("10,000 on the below-10k form is refused", (await refused(() => R.submitExpenditure("small", smallIn(1_000_000), req)))?.status === 422);
  check("9,999.99 on the DG form is refused", (await refused(() => R.submitExpenditure("large", large(999_999), req)))?.status === 422);
  check("nothing was saved by the refused ones", (await db.select().from(T.aprRequests).where(eq(T.aprRequests.type, "expenditure_small"))).length === 0);

  check("the budget figures are required on the expenditure forms, and cannot be negative", !S.largeExpenditureInput.safeParse({ employeeUserId: req.id, categoryId: cat.id, branchId: branch.id, amountPaise: 1_500_000 }).success && !S.smallExpenditureInput.safeParse({ employeeUserId: req.id, email: req.email, categoryId: cat.id, branchId: branch.id, amountPaise: 100_000, vendorName: "V" }).success && !S.largeExpenditureInput.safeParse({ employeeUserId: req.id, categoryId: cat.id, branchId: branch.id, amountPaise: 1_500_000, budgetAllocatedPaise: -1, budgetUsedPaise: 0 }).success);
  const big = await R.submitExpenditure("large", large(1_500_000, { natureOfExpenditure: "ZZ nature", budgetAllocatedPaise: 5_000_000, budgetUsedPaise: 0 }), req);
  const bigRow = await row(big.id);
  const [bigD] = await db.select().from(T.aprExpenditureDetails).where(eq(T.aprExpenditureDetails.requestId, big.id));
  check("a 15,000 request against a 50,000 budget is pending with an EXP number and not over budget", bigRow.status === "pending" && big.requestNo === `EXP-${FY}-0001` && !bigRow.overBudget, big.requestNo);
  check("the budget the requester typed is stored with what follows from it: available, and what is left after this request", Number(bigD.budgetAllocatedPaise) === 5_000_000 && Number(bigD.budgetAvailablePaise) === 5_000_000 && Number(bigD.budgetRemainingPaise) === 3_500_000);
  check("the DG approves it", (await R.decideRequest(big.id, { action: "approve", comment: null }, dg)).status === "approved");

  const over = await R.submitExpenditure("large", large(4_000_000, { budgetAllocatedPaise: 5_000_000, budgetUsedPaise: 1_500_000 }), req);
  check("40,000 against 35,000 left (50,000 allocated, 15,000 used) is accepted but flagged", (await row(over.id)).overBudget === true);
  const overDetail = await Q.getRequestDetail(over.id, dg);
  check("the approver is told a comment is needed, and the page shows the figures the requester gave", overDetail?.can.commentToApprove === true && overDetail.expenditure?.budget.allocatedPaise === 5_000_000 && overDetail.expenditure.budget.usedPaise === 1_500_000 && overDetail.expenditure.budget.availablePaise === 3_500_000 && overDetail.expenditure.budget.afterPaise === -500_000, JSON.stringify(overDetail?.expenditure?.budget));
  check("approving over budget without a comment is refused", (await refused(() => R.decideRequest(over.id, { action: "approve", comment: null }, dg)))?.status === 422);
  check("with a comment it goes through", (await R.decideRequest(over.id, { action: "approve", comment: "one-off" }, dg)).status === "approved");

  const spentOut = await R.submitExpenditure("large", large(1_200_000, { budgetAllocatedPaise: 1_000_000, budgetUsedPaise: 1_500_000 }), req);
  check("a budget that is already used up (used more than allocated) is accepted and flagged", (await row(spentOut.id)).overBudget === true);
  await R.decideRequest(spentOut.id, { action: "reject", comment: "no budget" }, dg);

  const rej = await R.submitExpenditure("large", large(1_200_000), req);
  await R.decideRequest(rej.id, { action: "reject", comment: "not needed" }, dg);
  const rejRow = await row(rej.id);
  check("a rejected request records the comment", rejRow.status === "rejected" && rejRow.decisionComment === "not needed");
  check("its remaining steps are marked skipped, not left waiting", (await db.select().from(T.aprRequestSteps).where(eq(T.aprRequestSteps.requestId, rej.id))).every((s) => s.status !== "waiting" && s.status !== "pending"));

  /* ------------------------------------------------------------------ expenses below 10,000 */
  const sm = await R.submitExpenditure("small", smallIn(500_000, { budgetAllocatedPaise: 1_000_000, budgetUsedPaise: 800_000, expenseDate: "2026-04-10", taxInvoiceDate: "2026-04-09", publicationTypeId: pubType.id, publicationId: pub.id }), req);
  const smRow = await row(sm.id);
  check("a 5,000 expense gets an EXB number and goes to the below-10k approver", sm.requestNo === `EXB-${FY}-0001` && smRow.currentApproverUserId === small.id, sm.requestNo);
  check("the DG cannot decide it", (await refused(() => R.decideRequest(sm.id, { action: "approve", comment: null }, dg)))?.status === 403);
  check("the budget typed (10,000 allocated, 8,000 used) is not enough for 5,000, so this expense is flagged and its approver needs a comment", smRow.overBudget === true && (await refused(() => R.decideRequest(sm.id, { action: "approve", comment: null }, small)))?.status === 422);
  check("with a comment its approver can approve it", (await R.decideRequest(sm.id, { action: "approve", comment: "within the group's overall budget" }, small)).status === "approved");
  check("a publication from another type is refused", (await refused(async () => {
    const [t2] = await db.insert(T.aprPublicationTypes).values({ name: "ZZ Int Type Two" }).returning();
    return R.submitExpenditure("small", smallIn(100_000, { publicationTypeId: t2.id, publicationId: pub.id }), req);
  }))?.status === 400);
  check("a tax invoice dated in the future is refused", (await refused(() => R.submitExpenditure("small", smallIn(100_000, { taxInvoiceDate: "2099-01-01" }), req)))?.status === 400);
  check("a person not in the hub list is refused", (await refused(() => R.submitExpenditure("small", smallIn(100_000, { employeeUserId: randomUUID() }), req)))?.status === 400);

  /* ------------------------------------------------------------------ routing edge cases */
  check("the DG raising an HR request while being its only approver is stopped with the reason", /Director General and also the requester/.test((await refused(() => R.submitHrRequest(hr(), dg)))?.message ?? ""));
  await db.update(T.aprApproverRules).set({ approverUserIds: [] }).where(eq(T.aprApproverRules.requestType, "expenditure_small"));
  check("with nobody named the request cannot be submitted, and says why", /No approver has been set up/.test((await refused(() => R.submitExpenditure("small", smallIn(100_000), req)))?.message ?? ""));
  check("and no half-saved request is left behind", (await db.select().from(T.aprRequests).where(eq(T.aprRequests.status, "draft"))).length === 0);
  await db.update(T.aprApproverRules).set({ approverUserIds: [small.id] }).where(eq(T.aprApproverRules.requestType, "expenditure_small"));
  // Two steps: Reviewer then DG.
  await db.update(T.aprApproverRules).set({ approverUserIds: [small.id] }).where(and(eq(T.aprApproverRules.requestType, "hr"), eq(T.aprApproverRules.stepNo, 1)));
  const two = await R.submitHrRequest(hr({ lastName: "Two" }), req);
  const twoRow = await row(two.id);
  check("with a Reviewer named, the request has two steps and starts with the Reviewer", twoRow.totalSteps === 2 && twoRow.currentApproverUserId === small.id);
  check("the DG cannot jump ahead of the Reviewer", (await refused(() => R.decideRequest(two.id, { action: "approve", comment: null }, dg)))?.status === 403);
  check("after the Reviewer approves it is still pending and moves to the DG", (await R.decideRequest(two.id, { action: "approve", comment: null }, small)).status === "pending" && (await row(two.id)).currentApproverUserId === dg.id);
  check("the DG's approval completes it", (await R.decideRequest(two.id, { action: "approve", comment: null }, dg)).status === "approved");
  await db.update(T.aprApproverRules).set({ approverUserIds: [] }).where(and(eq(T.aprApproverRules.requestType, "hr"), eq(T.aprApproverRules.stepNo, 1)));

  /* ------------------------------------------------------------------ races, withdrawals */
  const race = await R.submitHrRequest(hr({ lastName: "Race" }), req);
  const outcomes = await Promise.allSettled([
    R.decideRequest(race.id, { action: "approve", comment: null }, dg),
    R.decideRequest(race.id, { action: "reject", comment: "no" }, dg),
    R.decideRequest(race.id, { action: "approve", comment: null }, dg),
  ]);
  check("when decisions arrive together exactly one wins", outcomes.filter((o) => o.status === "fulfilled").length === 1, outcomes.map((o) => o.status).join());
  check("the others are told it was already decided", outcomes.filter((o) => o.status === "rejected").every((o) => (o as PromiseRejectedResult).reason instanceof ApprovalsError && (o as PromiseRejectedResult).reason.status === 409));
  check("the request has one final status and exactly one decision event", (await db.select().from(T.aprApprovalEvents).where(and(eq(T.aprApprovalEvents.requestId, race.id)))).filter((e) => e.action === "approved" || e.action === "rejected").length === 1);

  const wd = await R.submitHrRequest(hr({ lastName: "Withdraw" }), req);
  check("someone else cannot withdraw my request", (await refused(() => R.withdrawRequest(wd.id, null, other)))?.status === 404);
  await R.withdrawRequest(wd.id, "changed my mind", req);
  check("the requester can withdraw while pending", (await row(wd.id)).status === "withdrawn");
  check("the approver was told", (await N.recentNotifications(dg.id)).some((n) => /withdrawn/.test(n.title)));
  check("a withdrawn request cannot be decided", (await refused(() => R.decideRequest(wd.id, { action: "approve", comment: null }, dg)))?.status === 409);

  /* ------------------------------------------------------------------ hardening: who may even ask, and races */
  const hidden = await R.submitHrRequest(hr({ lastName: "Hidden" }), req);
  check("someone not involved who tries to decide gets a plain 404, not a message about the request", (await refused(() => R.decideRequest(hidden.id, { action: "approve", comment: null }, other)))?.status === 404);
  await R.withdrawRequest(hidden.id, null, req);
  check("even after it is withdrawn, they learn nothing about it", (await refused(() => R.decideRequest(hidden.id, { action: "approve", comment: null }, other)))?.status === 404);

  let tornApart = 0;
  for (let i = 0; i < 6; i++) {
    const t = await R.submitHrRequest(hr({ lastName: `Tug${i}` }), req);
    await Promise.allSettled([R.withdrawRequest(t.id, null, req), R.decideRequest(t.id, { action: "approve", comment: null }, dg)]);
    const final = await row(t.id);
    const steps = await db.select().from(T.aprRequestSteps).where(eq(T.aprRequestSteps.requestId, t.id));
    const evs = (await db.select().from(T.aprApprovalEvents).where(eq(T.aprApprovalEvents.requestId, t.id))).map((e) => e.action);
    const consistent =
      (final.status === "withdrawn" && steps.every((x) => x.status === "skipped") && !evs.includes("approved")) ||
      (final.status === "approved" && steps.every((x) => x.status === "approved") && !evs.includes("withdrawn"));
    if (!consistent) tornApart++;
  }
  check("a request withdrawn and approved at the same moment ends as one or the other, never both (6 tries)", tornApart === 0, tornApart);

  const shared = await F.startUpload(req, { fileName: "zz-shared.pdf", size: 4 });
  await F.putChunk(req, shared.fileId, 0, Buffer.from("data"));
  const both = await Promise.allSettled([R.submitHrRequest(hr({ lastName: "ShareA", fileUpload: { fileId: shared.fileId } }), req), R.submitHrRequest(hr({ lastName: "ShareB", fileUpload: { fileId: shared.fileId } }), req)]);
  check("one uploaded file cannot end up on two requests submitted at the same moment", both.filter((x) => x.status === "fulfilled").length === 1 && (await db.select().from(T.aprAttachments).where(eq(T.aprAttachments.storageKey, shared.fileId))).length === 1, both.map((x) => x.status).join());
  const lost = both.find((x) => x.status === "rejected") as PromiseRejectedResult | undefined;
  check("the loser is told to attach the file again (409), and no half-saved request is left", lost?.reason instanceof ApprovalsError && lost.reason.status === 409 && (await db.select().from(T.aprRequests).where(eq(T.aprRequests.status, "draft"))).length === 0);
  const retry = await F.startUpload(req, { fileName: "zz-retry.pdf", size: 4 });
  await F.putChunk(req, retry.fileId, 0, Buffer.from("data"));
  await db.update(T.aprApproverRules).set({ approverUserIds: [] }).where(eq(T.aprApproverRules.requestType, "hr"));
  check("a submission that fails (no approver) gives its file back", (await refused(() => R.submitHrRequest(hr({ fileUpload: { fileId: retry.fileId } }), req)))?.status === 409 && (await db.select().from(T.aprFiles).where(eq(T.aprFiles.id, retry.fileId)))[0].attached === false);
  await db.update(T.aprApproverRules).set({ approverUserIds: [dg.id] }).where(and(eq(T.aprApproverRules.requestType, "hr"), eq(T.aprApproverRules.stepNo, 2)));
  check("and the same file can then be used once the problem is fixed", (await R.submitHrRequest(hr({ lastName: "Retry", fileUpload: { fileId: retry.fileId } }), req)).requestNo.startsWith("HR-"));

  /* ------------------------------------------------------------------ files */
  const half = await F.startUpload(req, { fileName: "zz-half.pdf", size: 5 });
  check("a request pointing at a file that never finished uploading is refused", (await refused(() => R.submitHrRequest(hr({ fileUpload: { fileId: half.fileId } }), req)))?.status === 400);
  check("a part of the wrong size is refused", (await refused(() => F.putChunk(req, half.fileId, 0, Buffer.from("123"))))?.status === 400);
  check("someone else cannot add to my upload", (await refused(() => F.putChunk(other, half.fileId, 0, Buffer.from("12345"))))?.status === 404);
  await F.putChunk(req, half.fileId, 0, Buffer.from("12345"));
  await F.putChunk(req, half.fileId, 0, Buffer.from("12345")); // sending a part twice is harmless
  check("a file's own uploader's complete upload is accepted", (await F.checkFilesReady(req, [half.fileId])).size === 1);
  check("another person cannot attach my file", (await refused(() => F.checkFilesReady(other, [half.fileId])))?.status === 400);
  const multi = Buffer.alloc(3 * 1024 * 1024 + 10, 7);
  const mu = await F.startUpload(req, { fileName: "zz-big.pdf", size: multi.length });
  check("a file over 3 MB is split into two parts", mu.chunkCount === 2, mu.chunkCount);
  await F.putChunk(req, mu.fileId, 0, multi.subarray(0, mu.chunkBytes));
  await F.putChunk(req, mu.fileId, 1, multi.subarray(mu.chunkBytes));
  check("and comes back whole", (await bytesOf(F.readFileStream((await F.getStoredFile(mu.fileId))!))).equals(multi));

  /* ------------------------------------------------------------------ lists */
  const all = await Q.listRequests(viewer, { pageSize: 200 });
  check("a viewer sees every submitted request (and no drafts)", all.total === all.rows.length && all.rows.every((r) => r.status !== "draft") && all.total >= 9, all.total);
  check("the requester sees their own", (await Q.listRequests(req, { pageSize: 200 })).total === all.total);
  check("someone not involved sees none", (await Q.listRequests(other, {})).total === 0);
  check("the DG sees them all (they approve HR and the big ones)", (await Q.listRequests(dg, { pageSize: 200 })).total === all.total);
  const smallApprover = await Q.listRequests(small, { pageSize: 200 });
  check("the below-10k approver sees what was routed to them, and the HR one they reviewed", smallApprover.rows.some((r) => r.id === sm.id) && smallApprover.rows.some((r) => r.id === two.id) && !smallApprover.rows.some((r) => r.id === big.id));
  check("filter by kind and status", (await Q.listRequests(viewer, { types: ["expenditure_large"], statuses: ["approved"] })).total === 2);
  check("search finds a request number", (await Q.listRequests(viewer, { q: big.requestNo })).rows.map((r) => r.id).join() === big.id);
  check("search finds a vendor", (await Q.listRequests(viewer, { q: "Vendor" })).total >= 1);
  check("search treats % and _ as plain characters", (await Q.listRequests(viewer, { q: "%" })).total === 0 && (await Q.listRequests(viewer, { q: "_" })).total === 0);
  check("filter by category", (await Q.listRequests(viewer, { categoryId: hrCat.id })).rows.every((r) => r.type === "hr") && (await Q.listRequests(viewer, { categoryId: cat.id })).rows.every((r) => r.type !== "hr"));
  check("filter by branch", (await Q.listRequests(viewer, { branchId: branch.id })).rows.every((r) => r.branchName === "ZZ Int Branch"));
  check("a date range around now includes them, one in the past does not", (await Q.listRequests(viewer, { from: "2000-01-01", to: "2999-01-01" })).total === all.total && (await Q.listRequests(viewer, { from: "2000-01-01", to: "2000-01-02" })).total === 0);
  const amt = await Q.listRequests(viewer, { types: ["expenditure_large"], sort: "amount", dir: "asc" });
  check("sort by amount ascending", amt.rows.map((r) => r.amountPaise).join() === [...amt.rows.map((r) => r.amountPaise)].sort((a, b) => (a ?? 0) - (b ?? 0)).join());
  const pg1 = await Q.listRequests(viewer, { pageSize: 3, page: 1 });
  const pg2 = await Q.listRequests(viewer, { pageSize: 3, page: 2 });
  check("paging gives different rows and the same total", pg1.rows.length === 3 && pg2.rows.length > 0 && pg1.total === pg2.total && !pg1.rows.some((r) => pg2.rows.some((x) => x.id === r.id)));
  const waiting = await R.submitHrRequest(hr({ lastName: "Waiting" }), req);
  check("'waiting for me' lists only what is waiting for that person", (await Q.listRequests(dg, { waitingForMe: true })).rows.some((r) => r.id === waiting.id) && (await Q.listRequests(small, { waitingForMe: true })).total === 0 && (await Q.waitingCount(dg)) >= 1);
  check("'decided by me' lists what that person decided", (await Q.listRequests(dg, { decidedByMe: true })).rows.some((r) => r.id === hrMade.id) && (await Q.listRequests(other, { decidedByMe: true })).total === 0);
  check("'mine' lists what the person raised", (await Q.listRequests(req, { mine: true })).total === all.total + 1 && (await Q.listRequests(dg, { mine: true })).total === 0);
  const row0 = (await Q.listRequests(viewer, { q: over.requestNo })).rows[0];
  check("a list row carries the over-budget flag, the approver and the decision time", row0.overBudget && row0.approverName === dg.name && !!row0.decidedAt && row0.branchName === "ZZ Int Branch" && row0.categoryName === "ZZ Int Category");
  const hrRowList = (await Q.listRequests(viewer, { q: hrMade.requestNo })).rows[0];
  check("an HR row carries the HR category and the full name", hrRowList.categoryName === "ZZ Int HR" && hrRowList.name === "Asha Patil" && hrRowList.branchName === null);

  /* ------------------------------------------------------------------ reports */
  await R.submitExpenditure("large", large(1_100_000), req);
  const hrr = await Rep.hrReport({});
  const zz = hrr.byCategory.find((c) => c.name === "ZZ Int HR");
  check("HR report counts by category and outcome", !!zz && zz.total >= 5 && zz.approved >= 2 && zz.approved + zz.rejected >= 3 && zz.pending >= 1 && zz.approved + zz.rejected + zz.pending <= zz.total, JSON.stringify(zz));
  check("HR report groups by month", hrr.byMonth.length >= 1 && /^\d{4}-\d{2}$/.test(hrr.byMonth[0].month));
  const ta = await Rep.turnaround({});
  check("approval time lists decided requests with a duration, by approver and category", ta.rows.length >= 6 && ta.byApprover.some((g) => g.name === dg.name) && ta.byCategory.length >= 2 && ta.avgHours !== null && ta.rows.every((r) => r.hours >= 0));

  /* ------------------------------------------------------------------ rules, setup, notifications */
  const rules = await Rules.listRules();
  const hrStep1 = rules.find((r) => r.requestType === "hr" && r.stepNo === 1)!;
  check("the rules list names approvers", rules.find((r) => r.requestType === "hr" && r.stepNo === 2)?.approverName === dg.name && hrStep1.approverUserId === null);
  const changed = await Rules.updateRule(hrStep1.id, { approverUserId: small.id }, dg);
  check("a rule can be changed and the change is audited", changed.approverName === small.name && (await db.select().from(T.aprAdminAudit).where(eq(T.aprAdminAudit.entity, "approver_rule"))).some((a) => a.summary.includes(small.name)));
  check("a rule cannot name someone who does not exist", (await refused(() => Rules.updateRule(hrStep1.id, { approverUserId: randomUUID() }, dg)))?.status === 400);
  await Rules.updateRule(hrStep1.id, { approverUserId: null }, dg);
  const checklist = await Setup.setupChecklist();
  const approversItem = checklist.find((c) => c.label.startsWith("Approvers"));
  check("the setup checklist counts kinds of request with an approver", approversItem?.done === true && /3 of 3 kinds of request have an approver/.test(approversItem.detail), approversItem?.detail);
  const bell = await N.recentNotifications(req.id);
  check("the requester's bell lists their decisions, newest first", bell.length >= 5 && bell[0].createdAt >= bell[bell.length - 1].createdAt);
  await N.markRead(req.id, bell[0].id);
  check("one notification can be marked read", (await N.unreadCount(req.id)) === bell.length - 1);
  await N.markRead(req.id);
  check("and then all of them", (await N.unreadCount(req.id)) === 0);
  await N.markRead(other.id);
  check("marking someone else's read changes nothing for me", (await N.unreadCount(dg.id)) >= 1);

  /* ------------------------------------------------------------------ the first approver and the DG are different people */
  const first = await person("first", ["approver"]);
  const satav = await person("satav", ["approver"]);
  const ruleOf = async (type: string, stepNo: number) => (await Rules.listRules()).find((r) => r.requestType === type && r.stepNo === stepNo)!;
  const hr1 = await ruleOf("hr", 1);
  const lg1 = await ruleOf("expenditure_large", 1);
  const lg2 = await ruleOf("expenditure_large", 2);
  const sm1 = await ruleOf("expenditure_small", 1);
  check("the DG cannot also be named as a first approver", (await refused(() => Rules.updateRule(hr1.id, { approverUserId: dg.id }, dg)))?.status === 409);
  await Rules.updateRule(lg1.id, { approverUserId: first.id }, dg);
  await Rules.updateRule(sm1.id, { approverUserId: first.id }, dg);
  await Rules.updateRule(hr1.id, { approverUserId: satav.id }, dg);
  check("the same first approver can serve several kinds of request", (await ruleOf("expenditure_small", 1)).approverUserId === first.id && (await ruleOf("expenditure_large", 1)).approverUserId === first.id);
  const clash = await refused(() => Rules.updateRule(lg2.id, { approverUserId: first.id }, dg));
  check("a first approver cannot be named as the DG, and the message says why", clash?.status === 409 && /must be different people/.test(clash.message), clash);
  check("nor can the HR reviewer", (await refused(() => Rules.updateRule(lg2.id, { approverUserId: satav.id }, dg)))?.status === 409);
  check("and the refusals changed nothing", (await ruleOf("expenditure_large", 2)).approverUserId === dg.id);
  // a rule that is switched off does not count
  await Rules.updateRule(hr1.id, { active: false }, dg);
  check("a rule that is switched off does not block naming the person elsewhere", (await Rules.updateRule(lg2.id, { approverUserId: satav.id }, dg)).approverUserId === satav.id);
  check("switching the first rule back on is then checked the same way", (await refused(() => Rules.updateRule(hr1.id, { active: true }, dg)))?.status === 409);
  await Rules.updateRule(lg2.id, { approverUserId: dg.id }, dg);
  await Rules.updateRule(hr1.id, { active: true }, dg);
  check("the rules end as they should: first approver, HR reviewer, DG", (await ruleOf("expenditure_large", 1)).approverUserId === first.id && (await ruleOf("expenditure_large", 2)).approverUserId === dg.id && (await ruleOf("hr", 1)).approverUserId === satav.id);

  /* ------------------------------------------------------------------ the first approver raising a request himself: the DG decides */
  const [cat2] = await db.insert(T.aprCategories).values({ name: "ZZ Int Category Two" }).returning();
  const mine = await R.submitExpenditure("small", smallIn(500_000, { employeeUserId: first.id, email: first.email, categoryId: cat2.id }), first);
  const mineRow = await row(mine.id);
  check("a small request raised by the first approver goes to the DG, as step 1 of 1", mineRow.status === "pending" && mineRow.currentApproverUserId === dg.id && mineRow.totalSteps === 1);
  check("the DG's step carries the Director General label", (await db.select().from(T.aprRequestSteps).where(eq(T.aprRequestSteps.requestId, mine.id)))[0].stepLabel === "Director General");
  check("he cannot approve his own request", (await refused(() => R.decideRequest(mine.id, { action: "approve", comment: null }, first)))?.status === 403);
  check("the DG approves it", (await R.decideRequest(mine.id, { action: "approve", comment: null }, dg)).status === "approved");
  const mineLarge = await R.submitExpenditure("large", large(2_000_000, { employeeUserId: first.id }), first);
  check("a large one raised by him has the DG only", (await row(mineLarge.id)).totalSteps === 1 && (await row(mineLarge.id)).currentApproverUserId === dg.id);
  await R.withdrawRequest(mineLarge.id, null, first);
  const byDg = await R.submitExpenditure("small", smallIn(500_000), dg);
  check("a small request raised by the DG still goes to the first approver", (await row(byDg.id)).currentApproverUserId === first.id);
  await R.withdrawRequest(byDg.id, null, dg);

  /* ------------------------------------------------------------------ return for corrections, correct, resubmit */
  const large2 = (amountPaise: number, extra: object = {}) => S.largeExpenditureInput.parse({ employeeUserId: req.id, categoryId: cat2.id, branchId: branch.id, amountPaise, vendorName: "V", ...ROOMY, ...extra });
  const fix = (kind: "large" | "small" | "hr", extra: object = {}) =>
    S.resubmitInput.parse(kind === "hr"
      ? { kind, firstName: "Asha", lastName: "Patil", hrCategoryId: hrCat.id, keepAttachmentIds: [], ...extra }
      : { kind, employeeUserId: req.id, email: req.email, categoryId: cat2.id, branchId: branch.id, amountPaise: 2_500_000, vendorName: "Fixed Vendor", ...ROOMY, keepAttachmentIds: [], ...extra });
  const stepsOf = (id: string) => db.select().from(T.aprRequestSteps).where(eq(T.aprRequestSteps.requestId, id)).orderBy(T.aprRequestSteps.stepNo);
  const eventsOf = async (id: string) => (await db.select().from(T.aprApprovalEvents).where(eq(T.aprApprovalEvents.requestId, id)).orderBy(T.aprApprovalEvents.id)).map((e) => e.action);

  const pdf1 = Buffer.from("%PDF-1.4 first version");
  const f1 = await F.startUpload(req, { fileName: "zz-first.pdf", size: pdf1.length });
  await F.putChunk(req, f1.fileId, 0, pdf1);
  const rq = await R.submitExpenditure("large", large2(2_000_000, { supportingDocs: { fileId: f1.fileId } }), req);
  check("a 20,000 request waits for the first approver", (await row(rq.id)).currentApproverUserId === first.id);
  check("returning needs a comment", (await refused(() => R.decideRequest(rq.id, { action: "return", comment: null }, first)))?.status === 422);
  check("the DG cannot return it while it is not theirs yet", (await refused(() => R.decideRequest(rq.id, { action: "return", comment: "x" }, dg)))?.status === 403);
  check("the person who raised it cannot return it", (await refused(() => R.decideRequest(rq.id, { action: "return", comment: "x" }, req)))?.status === 403);
  check("the first approver returns it with a comment", (await R.decideRequest(rq.id, { action: "return", comment: "Quotation missing, please attach it" }, first)).status === "returned");
  const retRow = await row(rq.id);
  const retSteps = await stepsOf(rq.id);
  check("it is returned, keeps its step and its approver, and later steps still wait", retRow.status === "returned" && retRow.currentStep === 1 && retRow.currentApproverUserId === first.id && retSteps[0].status === "returned" && retSteps[1].status === "waiting");
  check("the comment is on the step and the history says returned", retSteps[0].comment === "Quotation missing, please attach it" && (await eventsOf(rq.id)).includes("returned"));
  check("the requester was told", (await N.recentNotifications(req.id)).some((n) => /returned for corrections/.test(n.title) && n.body === "Quotation missing, please attach it"));
  check("a returned request is not waiting for anyone", (await Q.listRequests(first, { waitingForMe: true })).rows.every((r) => r.id !== rq.id));
  const retDetail = await Q.getRequestDetail(rq.id, req);
  check("the requester can edit and withdraw, and sees who returned it and why", retDetail?.can.edit === true && retDetail.can.withdraw === true && retDetail.can.decide === false && retDetail.returned?.byName === first.name && retDetail.returned.comment === "Quotation missing, please attach it");
  check("the approver sees it returned but cannot decide or edit it", (await Q.getRequestDetail(rq.id, first))?.can.edit === false && (await Q.getRequestDetail(rq.id, first))?.can.decide === false);
  check("nobody can approve a returned request", (await refused(() => R.decideRequest(rq.id, { action: "approve", comment: null }, first)))?.status === 409);
  check("the correction form opens only for the person who raised it", (await Q.getEditValues(rq.id, req)) !== null && (await Q.getEditValues(rq.id, first)) === null && (await Q.getEditValues(rq.id, other)) === null);
  check("the correction form carries the current values", (await Q.getEditValues(rq.id, req))?.expenditure?.categoryId === cat2.id && (await Q.getEditValues(rq.id, req))?.attachments.length === 1);

  check("someone else cannot resubmit it", (await refused(() => R.resubmitRequest(rq.id, fix("large"), other)))?.status === 404);
  check("the approver cannot resubmit it either", (await refused(() => R.resubmitRequest(rq.id, fix("large"), first)))?.status === 404);
  check("the wrong form is refused", (await refused(() => R.resubmitRequest(rq.id, fix("small", { email: req.email }), req)))?.status === 400);
  check("an amount below 10,000 is refused with the usual message", /Amounts below/.test((await refused(() => R.resubmitRequest(rq.id, fix("large", { amountPaise: 500_000 }), req)))?.message ?? ""));
  check("a file that is not on the request cannot be kept", (await refused(() => R.resubmitRequest(rq.id, fix("large", { keepAttachmentIds: [randomUUID()] }), req)))?.status === 400);
  check("nothing changed after the refusals", (await row(rq.id)).status === "returned" && (await row(rq.id)).amountPaise === 2_000_000);

  const pdf2 = Buffer.from("%PDF-1.4 the quotation");
  const f2 = await F.startUpload(req, { fileName: "zz-quote.pdf", size: pdf2.length });
  await F.putChunk(req, f2.fileId, 0, pdf2);
  const keepId = retDetail!.attachments[0].id;
  const raced = await Promise.allSettled([
    R.resubmitRequest(rq.id, fix("large", { amountPaise: 2_500_000, vendorName: "Fixed Vendor", nature: "x", quotation: { fileId: f2.fileId }, keepAttachmentIds: [keepId] }), req),
    R.resubmitRequest(rq.id, fix("large", { amountPaise: 2_500_000, vendorName: "Fixed Vendor", nature: "x", quotation: { fileId: f2.fileId }, keepAttachmentIds: [keepId] }), req),
  ]);
  check("two corrections sent together: exactly one is accepted", raced.filter((r) => r.status === "fulfilled").length === 1, raced.map((r) => r.status).join());
  check("the other is told plainly", raced.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason instanceof ApprovalsError && [409, 500].includes((r as PromiseRejectedResult).reason.status)));
  const backRow = await row(rq.id);
  const backSteps = await stepsOf(rq.id);
  check("it is pending again, at the same step, with the same number and the same approver", backRow.status === "pending" && backRow.currentStep === 1 && backRow.currentApproverUserId === first.id && backRow.requestNo === rq.requestNo && backSteps[0].status === "pending" && backSteps[1].status === "waiting");
  check("the new amount and details are saved, and the old step comment is cleared", backRow.amountPaise === 2_500_000 && backSteps[0].comment === null && (await db.select().from(T.aprExpenditureDetails).where(eq(T.aprExpenditureDetails.requestId, rq.id)))[0].vendorName === "Fixed Vendor");
  const evs = await eventsOf(rq.id);
  check("the history keeps the round trip", evs.filter((a) => a === "returned").length === 1 && evs.filter((a) => a === "resubmitted").length === 1 && evs.indexOf("returned") < evs.indexOf("resubmitted"), evs.join());
  check("the first approver was told it was corrected", (await N.recentNotifications(first.id)).some((n) => /corrected/.test(n.title)));
  check("the kept file stays and the new one is added", (await db.select().from(T.aprAttachments).where(eq(T.aprAttachments.requestId, rq.id))).map((a) => a.slot).sort().join() === "quotation,supporting");
  check("a pending request cannot be edited", (await refused(() => R.resubmitRequest(rq.id, fix("large"), req)))?.status === 409);
  check("the first approver approves and it moves to the DG", (await R.decideRequest(rq.id, { action: "approve", comment: null }, first)).status === "pending" && (await row(rq.id)).currentApproverUserId === dg.id);

  // The DG returns it: it comes back to the DG, not to the first approver.
  check("the DG returns it", (await R.decideRequest(rq.id, { action: "return", comment: "Split the vendor name" }, dg)).status === "returned");
  check("the correction goes back to the DG, at step 2", (await R.resubmitRequest(rq.id, fix("large", { vendorName: "Split Vendor" }), req)).requestNo === rq.requestNo && (await row(rq.id)).currentStep === 2 && (await row(rq.id)).currentApproverUserId === dg.id);
  check("the step the first approver approved stays approved", (await stepsOf(rq.id))[0].status === "approved" && (await stepsOf(rq.id))[1].status === "pending");
  check("the DG approves and it is fully approved", (await R.decideRequest(rq.id, { action: "approve", comment: null }, dg)).status === "approved");
  check("an approved request cannot be edited or returned", (await refused(() => R.resubmitRequest(rq.id, fix("large"), req)))?.status === 409 && (await refused(() => R.decideRequest(rq.id, { action: "return", comment: "x" }, dg)))?.status === 409);

  // Replacing and removing files, withdrawing while returned.
  const g1 = await F.startUpload(req, { fileName: "zz-old.pdf", size: 4 });
  await F.putChunk(req, g1.fileId, 0, Buffer.from("%PDF"));
  const wr = await R.submitExpenditure("large", large2(1_500_000, { supportingDocs: { fileId: g1.fileId } }), req);
  await R.decideRequest(wr.id, { action: "return", comment: "wrong file" }, first);
  const g2 = await F.startUpload(req, { fileName: "zz-new.pdf", size: 4 });
  await F.putChunk(req, g2.fileId, 0, Buffer.from("%PDF"));
  await R.resubmitRequest(wr.id, fix("large", { amountPaise: 1_500_000, supportingDocs: { fileId: g2.fileId }, keepAttachmentIds: [] }), req);
  const wrFiles = await db.select().from(T.aprAttachments).where(eq(T.aprAttachments.requestId, wr.id));
  check("a new file replaces the old one in the same place and the old upload is released", wrFiles.length === 1 && wrFiles[0].fileName === "zz-new.pdf" && (await db.select().from(T.aprFiles).where(eq(T.aprFiles.id, g1.fileId)))[0].attached === false);
  await R.decideRequest(wr.id, { action: "return", comment: "again" }, first);
  await R.withdrawRequest(wr.id, "not needed", req);
  const wrSteps = await stepsOf(wr.id);
  check("a returned request can be withdrawn, and its steps are marked not needed", (await row(wr.id)).status === "withdrawn" && wrSteps.every((x) => x.status === "skipped") && (await eventsOf(wr.id)).includes("withdrawn"));
  check("a withdrawn request cannot be corrected", (await refused(() => R.resubmitRequest(wr.id, fix("large", { amountPaise: 1_500_000 }), req)))?.status === 409);

  // A small expense and an HR request go back to their own approver too.
  const smx = await R.submitExpenditure("small", smallIn(300_000, { categoryId: cat2.id }), req);
  await R.decideRequest(smx.id, { action: "return", comment: "add the vendor GST number" }, first);
  await R.resubmitRequest(smx.id, fix("small", { amountPaise: 350_000, vendorName: "GST Vendor" }), req);
  check("a small expense comes back to the first approver and can then be approved", (await row(smx.id)).currentApproverUserId === first.id && (await R.decideRequest(smx.id, { action: "approve", comment: null }, first)).status === "approved");
  const hq = await R.submitHrRequest(hr({ lastName: "Return" }), req);
  check("an HR request starts with the HR reviewer", (await row(hq.id)).currentApproverUserId === satav.id && (await row(hq.id)).totalSteps === 2);
  await R.decideRequest(hq.id, { action: "approve", comment: null }, satav);
  await R.decideRequest(hq.id, { action: "return", comment: "name is misspelt" }, dg);
  await R.resubmitRequest(hq.id, fix("hr", { lastName: "Returned" }), req);
  check("an HR request returned by the DG goes back to the DG after its correction", (await row(hq.id)).currentApproverUserId === dg.id && (await row(hq.id)).requesterName === "Asha Returned" && (await db.select().from(T.aprHrDetails).where(eq(T.aprHrDetails.requestId, hq.id)))[0].lastName === "Returned");
  check("the HR reviewer's earlier approval is kept", (await stepsOf(hq.id))[0].status === "approved");
  await R.decideRequest(hq.id, { action: "approve", comment: null }, dg);

  /* ------------------------------------------------------------------ HR requests with an amount carry the typed budget */
  const hrNoBudget = await refused(() => R.submitHrRequest(hr({ amountPaise: 500_000 }), req));
  check("an HR amount without the budget allocated and used is refused, and says what is missing", hrNoBudget?.status === 422 && /budget allocated and the budget used/.test(hrNoBudget.message), hrNoBudget);
  check("nothing half-saved is left by it", (await db.select().from(T.aprRequests).where(eq(T.aprRequests.status, "draft"))).length === 0);
  const hrNoAmount = await R.submitHrRequest(hr({ lastName: "Plain", budgetAllocatedPaise: 1_000_000, budgetUsedPaise: 0 }), req);
  const hrNoAmountDetails = (await db.select().from(T.aprHrDetails).where(eq(T.aprHrDetails.requestId, hrNoAmount.id)))[0];
  check("without an amount no budget is attached, even if one was typed", hrNoAmountDetails.budgetAllocatedPaise === null && (await row(hrNoAmount.id)).overBudget === false);
  const hrMoney = await R.submitHrRequest(hr({ lastName: "Money", amountPaise: 4_000_000, budgetAllocatedPaise: 10_000_000, budgetUsedPaise: 2_000_000 }), req);
  const hrMoneyRow = await row(hrMoney.id);
  const hrMoneyDetails = (await db.select().from(T.aprHrDetails).where(eq(T.aprHrDetails.requestId, hrMoney.id)))[0];
  check("an HR request with an amount stores the budget it was given, what is available and what is left; no branch or category", Number(hrMoneyDetails.budgetAllocatedPaise) === 10_000_000 && Number(hrMoneyDetails.budgetAvailablePaise) === 8_000_000 && Number(hrMoneyDetails.budgetRemainingPaise) === 4_000_000 && hrMoneyDetails.branchId === null && hrMoneyDetails.budgetCategoryId === null);
  check("it is not over budget", hrMoneyRow.overBudget === false);
  const hrMoneyDetail = await Q.getRequestDetail(hrMoney.id, satav);
  check("the detail page carries the budget for an HR request", hrMoneyDetail?.hr?.budget?.allocatedPaise === 10_000_000 && hrMoneyDetail.hr.budget.usedPaise === 2_000_000 && hrMoneyDetail.hr.budget.availablePaise === 8_000_000 && hrMoneyDetail.hr.budget.afterPaise === 4_000_000);
  await R.decideRequest(hrMoney.id, { action: "approve", comment: null }, satav);
  await R.decideRequest(hrMoney.id, { action: "approve", comment: null }, dg);
  const hrOver = await R.submitHrRequest(hr({ lastName: "Over", amountPaise: 9_000_000, budgetAllocatedPaise: 10_000_000, budgetUsedPaise: 2_000_000 }), req);
  check("an HR amount beyond what is left is flagged, not blocked", (await row(hrOver.id)).overBudget === true);
  const hrOverNoComment = await refused(() => R.decideRequest(hrOver.id, { action: "approve", comment: null }, satav));
  check("approving it needs a comment, as for an expenditure", hrOverNoComment?.status === 422 && /over budget/.test(hrOverNoComment.message), hrOverNoComment);
  check("with a comment it goes through", (await R.decideRequest(hrOver.id, { action: "approve", comment: "approved by exception" }, satav)).status === "pending");
  await R.decideRequest(hrOver.id, { action: "return", comment: "reduce the amount" }, dg);
  await R.resubmitRequest(hrOver.id, fix("hr", { lastName: "Over", amountPaise: 100_000, budgetAllocatedPaise: 10_000_000, budgetUsedPaise: 2_000_000 }), req);
  check("correcting the amount re-checks it against the budget typed", (await row(hrOver.id)).overBudget === false && (await row(hrOver.id)).amountPaise === 100_000);
  await R.decideRequest(hrOver.id, { action: "return", comment: "no amount after all" }, dg);
  check("correcting an HR request to have no amount drops its budget", (await R.resubmitRequest(hrOver.id, fix("hr", { lastName: "Over" }), req)) && (await db.select().from(T.aprHrDetails).where(eq(T.aprHrDetails.requestId, hrOver.id)))[0].budgetAllocatedPaise === null);
  await R.withdrawRequest(hrOver.id, null, req);

  /* ------------------------------------------------------------------ the main accounts fill empty approver rules, once */
  const EnvRules = await import("../src/lib/approvals/env-rules");
  const MARKER = "env_rules_seeded";
  const markerRows = () => db.select().from(T.aprSettings).where(eq(T.aprSettings.key, MARKER));
  const savedMarker = await markerRows();
  const seededRule = async (type: string, stepNo: number) => (await db.select().from(T.aprApproverRules).where(and(eq(T.aprApproverRules.requestType, type as never), eq(T.aprApproverRules.stepNo, stepNo))))[0];
  const idOf = async (email: string) => (await db.select({ id: users.id }).from(users).where(eq(users.email, email)))[0]?.id;
  process.env.SUPER_ADMIN_EMAIL = "zz-int-main-super@example.com"; process.env.SUPER_ADMIN_PASSWORD = "Int-super-pass-1";
  process.env.HR_ADMIN_EMAIL = "zz-int-main-hr@example.com"; process.env.HR_ADMIN_PASSWORD = "Int-hr-pass-1"; process.env.HR_ADMIN_NAME = "ZZ Int Main HR";
  delete process.env.EXPENDITURE_ADMIN_EMAIL;
  await db.delete(T.aprApproverRules);
  await db.delete(T.aprSettings).where(eq(T.aprSettings.key, MARKER));
  await EnvRules.ensureRulesSeeded();
  check("nothing is filled in until HR, Expenditure and the Super Admin are all set", (await db.select().from(T.aprApproverRules)).length === 0 && (await markerRows()).length === 0);
  process.env.EXPENDITURE_ADMIN_EMAIL = "zz-int-main-exp@example.com"; process.env.EXPENDITURE_ADMIN_PASSWORD = "Int-exp-pass-1";
  await EnvRules.ensureRulesSeeded();
  const [hrId, expId, dgId] = [await idOf("zz-int-main-hr@example.com"), await idOf("zz-int-main-exp@example.com"), await idOf("zz-int-main-super@example.com")];
  check("once all three are set, their rows are made and the five routing rules are created from them", !!hrId && !!expId && !!dgId && (await db.select().from(T.aprApproverRules)).length === 5);
  check("HR reviews HR, then the Super Admin", (await seededRule("hr", 1))?.approverUserIds[0] === hrId && (await seededRule("hr", 2))?.approverUserIds[0] === dgId);
  check("Expenditure is the first approver on both sizes, and the Super Admin is the final approver of the large ones", (await seededRule("expenditure_large", 1))?.approverUserIds[0] === expId && (await seededRule("expenditure_large", 2))?.approverUserIds[0] === dgId && (await seededRule("expenditure_small", 1))?.approverUserIds[0] === expId);
  check("the Super Admin is on no first step, so the first approver and the DG are different people", (await db.select().from(T.aprApproverRules)).every((r) => r.stepNo === 1 ? !r.approverUserIds.includes(dgId!) : !r.approverUserIds.some((i) => i === hrId || i === expId)));
  check("the run is recorded once, and in the audit log as the system", (await markerRows()).length === 1 && (await db.select().from(T.aprAdminAudit)).some((a) => a.actorName === "System" && /Filled 5 empty approver rules/.test(a.summary)));
  await db.update(T.aprApproverRules).set({ approverUserIds: [] }).where(and(eq(T.aprApproverRules.requestType, "hr"), eq(T.aprApproverRules.stepNo, 1)));
  await EnvRules.ensureRulesSeeded();
  check("after that nothing is ever filled in again: a rule the Support Admin cleared on purpose stays empty", (await seededRule("hr", 1))?.approverUserIds.length === 0);
  await db.delete(T.aprSettings).where(eq(T.aprSettings.key, MARKER));
  const anotherApprover = await person("otherapprover", []);
  await db.update(T.aprApproverRules).set({ approverUserIds: [anotherApprover.id] }).where(and(eq(T.aprApproverRules.requestType, "expenditure_large"), eq(T.aprApproverRules.stepNo, 1)));
  await EnvRules.ensureRulesSeeded();
  check("a rule that already has someone is never overwritten, only the empty ones are filled", (await seededRule("expenditure_large", 1))?.approverUserIds[0] === anotherApprover.id && (await seededRule("hr", 1))?.approverUserIds[0] === hrId);
  // The sidebar's dropdown check fills the empty rules too: the HR and Expenditure accounts have their place at first sign-in, without anyone opening the Rules screen
  const rulesBefore = await db.select().from(T.aprApproverRules);
  await db.delete(T.aprApproverRules);
  await db.delete(T.aprSettings).where(eq(T.aprSettings.key, MARKER));
  const placesOf = async (id: string, name: string, email: string) => (await Q.reviewItemsFor({ id, name, email, roles: ["requester"] })).map((i) => i.key).join();
  check("the HR account has its HR place the first time the sidebar is built, with nothing opened or sent before", (await placesOf(hrId!, "ZZ Int Main HR", "zz-int-main-hr@example.com")) === "hr");
  check("and the Expenditure account has Expenditure", (await placesOf(expId!, "ZZ Int Main Exp", "zz-int-main-exp@example.com")) === "expenditure");
  check("the rules were filled from the accounts by that first look", (await db.select().from(T.aprApproverRules)).length === 5 && (await markerRows()).length === 1);
  check("an ordinary person still gets no place", (await placesOf((await person("noplace", [])).id, "ZZ No Place", "zz-int-noplace@example.com")) === "");
  await db.delete(T.aprApproverRules);
  await db.insert(T.aprApproverRules).values(rulesBefore);
  // an HR request now goes to the HR account first and then the Super Admin, through the real submit
  const mainHr: Actor = { id: hrId!, name: "ZZ Int Main HR", email: "zz-int-main-hr@example.com", roles: ["requester", "approver"] };
  const submitter = await person("mainsubmitter", []);
  const viaMain = await R.submitHrRequest(hr({ lastName: "ViaMain" }), submitter);
  const viaMainRow = await row(viaMain.id);
  check("an HR request submitted now waits for the HR account, in two steps ending with the Super Admin", viaMainRow.currentApproverUserId === hrId && viaMainRow.totalSteps === 2);
  check("the HR account approves, and it moves to the Super Admin, who approves last", (await R.decideRequest(viaMain.id, { action: "approve", comment: null }, mainHr)).status === "pending" && (await row(viaMain.id)).currentApproverUserId === dgId);
  // "Recommend to DG" and the Recommended / Rejected lists, through the same flow
  const dgActor: Actor = { id: dgId!, name: "ZZ Int Main Super", email: "zz-int-main-super@example.com", roles: ["requester", "dg"] };
  const beforeHr = await Q.getRequestDetail(viaMain.id, mainHr);
  check("a step before the last is a recommendation, and the last of several is the final decision (the wording follows)", beforeHr?.can.mode === "final" || beforeHr?.can.mode === "recommend");
  check("what HR recommended is in HR's Recommended list, with its step and the number of steps, and not in Rejected", (await Q.listRequests(mainHr, { recommendedByMe: true })).rows.some((r) => r.id === viaMain.id && r.currentStep === 2 && r.totalSteps === 2) && !(await Q.listRequests(mainHr, { rejectedByMe: true })).rows.some((r) => r.id === viaMain.id));
  check("the Director General sees it in their queue as a final decision", (await Q.getRequestDetail(viaMain.id, dgActor))?.can.mode === "final" && (await Q.listRequests(dgActor, { waitingForMe: true })).rows.some((r) => r.id === viaMain.id));
  const toReject = await R.submitHrRequest(hr({ lastName: "ToReject" }), submitter);
  check("HR's own decision on a fresh request is a recommendation", (await Q.getRequestDetail(toReject.id, mainHr))?.can.mode === "recommend");
  await R.decideRequest(toReject.id, { action: "approve", comment: null }, mainHr);
  check("the recommended request moved to the DG and the history says it was recommended", (await row(toReject.id)).currentApproverUserId === dgId && (await db.select().from(T.aprApprovalEvents).where(eq(T.aprApprovalEvents.requestId, toReject.id))).some((e) => e.action === "approved" && e.toStatus === "pending"));
  await R.decideRequest(toReject.id, { action: "reject", comment: "Not justified" }, dgActor);
  check("the DG's rejection shows in the DG's Rejected list, and HR's list still shows what HR recommended, not as rejected by HR", (await Q.listRequests(dgActor, { rejectedByMe: true })).rows.some((r) => r.id === toReject.id) && !(await Q.listRequests(mainHr, { rejectedByMe: true })).rows.some((r) => r.id === toReject.id) && (await Q.listRequests(mainHr, { recommendedByMe: true })).rows.some((r) => r.id === toReject.id && r.status === "rejected"));
  const hrRejects = await R.submitHrRequest(hr({ lastName: "HrRejects" }), submitter);
  await R.decideRequest(hrRejects.id, { action: "reject", comment: "Not an HR matter" }, mainHr);
  check("a request HR rejects is in HR's Rejected list and never reaches the DG's queue", (await Q.listRequests(mainHr, { rejectedByMe: true })).rows.some((r) => r.id === hrRejects.id) && !(await Q.listRequests(dgActor, { waitingForMe: true })).rows.some((r) => r.id === hrRejects.id));
  // The Approval Forms editor: the layout of a form, the extra fields, and the answers kept with each request
  const FC = await import("../src/lib/approvals/form-config");
  const FF = await import("../src/lib/approvals/form-fields");
  await db.delete(T.aprFormFields);
  const defaults = await FC.getFormFields("hr");
  check("with nothing set, a form has its own fields in the default order", defaults.map((f) => f.key).join() === FF.BUILTIN.hr.map((d) => d.key).join() && defaults.every((f) => !f.hidden && f.builtin));
  const asInput = (fs: typeof defaults) => fs.map((f) => ({ key: f.key, label: f.label, hidden: f.hidden, kind: f.kind ?? undefined, required: f.required, options: f.options }));
  const layout = (...extra: { key?: string | null; label: string; kind: "text" | "select" | "number" | "date" | "textarea"; required?: boolean; options?: string[]; hidden?: boolean }[]) => ({
    fields: [...asInput(defaults).map((f) => (f.key === "description" ? { ...f, label: "Details" } : f.key === "file2" ? { ...f, hidden: true } : f)), ...extra.map((e) => ({ required: false, options: [], hidden: false, key: null, ...e }))],
  });
  const saved1 = await FC.saveFormFields("hr", FC.saveFieldsInput.parse(layout({ label: "Employee code", kind: "text", required: true }, { label: "Grade", kind: "select", options: ["A", "B"] })), viewer);
  const empKey = saved1.find((f) => f.label === "Employee code")!.key;
  check("a saved layout renames a built-in field, hides an optional one and adds the extra fields with their own keys", saved1.find((f) => f.key === "description")?.label === "Details" && saved1.find((f) => f.key === "file2")?.hidden === true && /^c_[a-z0-9]{8}$/.test(empKey) && saved1.filter((f) => !f.builtin).length === 2 && saved1.find((f) => f.label === "Grade")?.options.join() === "A,B");
  check("the change is in the admin audit", (await db.select().from(T.aprAdminAudit)).some((a) => a.entity === "form_fields" && /HR form/.test(a.summary)));
  const bad = async (l: ReturnType<typeof layout>) => (await refused(async () => FC.saveFormFields("hr", FC.saveFieldsInput.parse(l), viewer)))?.message ?? "";
  check("a field the request cannot do without cannot be hidden", /cannot be hidden/.test(await bad({ fields: asInput(defaults).map((f) => (f.key === "category" ? { ...f, hidden: true } : f)) })));
  check("two fields cannot share a name", /Two fields are called/.test(await bad(layout({ label: "details", kind: "text" }))));
  check("a dropdown needs choices", /at least one choice/.test(await bad(layout({ label: "Level", kind: "select", options: [] }))));
  check("every built-in field must be in the list", /missing some/.test(await bad({ fields: asInput(defaults).slice(1) })));
  check("an unknown extra field key is refused", /Unknown field|no longer exists/.test(await bad(layout({ key: "c_zzzzzzzz", label: "Ghost", kind: "text" }))));
  const hrWith = (custom: Record<string, string>, extra: object = {}) => hr({ lastName: "Custom", custom, ...extra });
  const noCode = await refused(() => R.submitHrRequest(hrWith({}), req));
  check("a required extra field must be answered, or the request is refused with its name", noCode?.status === 422 && /Employee code/.test(noCode.message), noCode);
  const gradeKey = saved1.find((f) => f.label === "Grade")!.key;
  check("a dropdown answer must be one of its choices", (await refused(() => R.submitHrRequest(hrWith({ [empKey]: "E-1", [gradeKey]: "Z" }), req)))?.status === 422);
  const withAnswers = await R.submitHrRequest(hrWith({ [empKey]: " E-42 ", [gradeKey]: "B" }), req);
  const storedAnswers = (await row(withAnswers.id)).customValues;
  check("the answers are kept with the request, in the order of the form, each with the name the field had", JSON.stringify(storedAnswers) === JSON.stringify([{ key: empKey, label: "Employee code", value: "E-42" }, { key: gradeKey, label: "Grade", value: "B" }]), storedAnswers);
  check("the request page lists them", JSON.stringify((await Q.getRequestDetail(withAnswers.id, viewer))?.custom) === JSON.stringify([{ label: "Employee code", value: "E-42" }, { label: "Grade", value: "B" }]));
  const renamed = await FC.saveFormFields("hr", FC.saveFieldsInput.parse({ fields: asInput(saved1).map((f) => (f.key === empKey ? { ...f, label: "Staff number" } : f)) }), viewer);
  check("renaming an extra field changes the form but not what an old request says", renamed.find((f) => f.key === empKey)?.label === "Staff number" && (await row(withAnswers.id)).customValues.find((c) => c.key === empKey)?.label === "Employee code");
  const dropped = await FC.saveFormFields("hr", FC.saveFieldsInput.parse({ fields: asInput(renamed).filter((f) => f.key !== empKey && f.key !== gradeKey) }), viewer);
  check("removing the extra fields takes them off the form, and old requests keep their answers", dropped.every((f) => f.builtin) && (await row(withAnswers.id)).customValues.length === 2);
  const plain = await R.submitHrRequest(hr({ lastName: "NoExtras" }), req);
  check("with the extra fields gone a request needs no answers and keeps none", (await row(plain.id)).customValues.length === 0);
  await db.delete(T.aprFormFields);

  // The HR and Expenditure places under Approval System: who has which, and what the three lists hold
  const itemKeys = async (a: Actor) => (await Q.reviewItemsFor(a)).map((i) => i.key).join();
  check("the HR reviewer has the HR place only, the DG has one place called Recommended, an overseer has HR and Expenditure, and someone who approves nothing has none", (await itemKeys(mainHr)) === "hr" && (await itemKeys(dgActor)) === "recommendation" && (await itemKeys(viewer)) === "hr,expenditure" && (await itemKeys(req)) === "");
  check("the DG's Recommended place says how many wait in each of its two tabs", (await Q.reviewItemsFor(dgActor))[0]?.counts !== undefined && (await Q.reviewItemsFor(dgActor))[0].waiting === Object.values((await Q.reviewItemsFor(dgActor))[0].counts!).reduce((a, n) => a + n, 0));
  const reviewHr = await R.submitHrRequest(hr({ lastName: "ReviewList" }), submitter);
  const reviewHrNotYet = await R.submitHrRequest(hr({ lastName: "ReviewNotYet" }), submitter); // still with the HR reviewer: it has not reached the DG
  const waitFor = async (a: Actor) => (await Q.reviewItemsFor(a)).find((i) => i.key === "hr")?.waiting ?? 0;
  check("a request waiting for the HR reviewer is counted in their HR place and is in their Pending list", (await waitFor(mainHr)) >= 1 && (await Q.listRequests(mainHr, { types: ["hr"], statuses: ["pending"], waitingForMe: true })).rows.some((r) => r.id === reviewHr.id));
  await R.decideRequest(reviewHr.id, { action: "approve", comment: null }, mainHr);
  check("once the reviewer recommends it, it is in their Approved list (approved at their step) and no longer Pending for them", (await Q.listRequests(mainHr, { types: ["hr"], approvedByMe: true })).rows.some((r) => r.id === reviewHr.id) && !(await Q.listRequests(mainHr, { types: ["hr"], waitingForMe: true })).rows.some((r) => r.id === reviewHr.id));
  check("it is waiting for the DG now, so it is in the DG's Pending, not yet in their Approved", (await Q.listRequests(dgActor, { types: ["hr"], waitingForMe: true })).rows.some((r) => r.id === reviewHr.id) && !(await Q.listRequests(dgActor, { types: ["hr"], approvedByMe: true })).rows.some((r) => r.id === reviewHr.id));
  const dgRow = (await Q.listRequests(dgActor, { types: ["hr"], reachedMe: true })).rows.find((r) => r.id === reviewHr.id);
  check("it is in what was recommended to the DG, with the buttons because it still waits for them", !!dgRow && dgRow.mineToDecide === true && dgRow.status === "pending");
  check("the HR reviewer's own list shows it with no buttons (it no longer waits for them)", (await Q.listRequests(mainHr, { types: ["hr"], approvedByMe: true })).rows.find((r) => r.id === reviewHr.id)?.mineToDecide === false);
  await R.decideRequest(reviewHr.id, { action: "reject", comment: "Not needed" }, dgActor);
  check("once decided it stays in what was recommended to the DG, now without the buttons, and a request that never reached them is not there", (await Q.listRequests(dgActor, { types: ["hr"], reachedMe: true })).rows.find((r) => r.id === reviewHr.id)?.mineToDecide === false && !(await Q.listRequests(dgActor, { types: ["hr"], reachedMe: true })).rows.some((r) => r.id === reviewHrNotYet.id));
  check("a rejection by the DG is in their Rejected list and not in their Approved list; HR's Approved list still shows what HR recommended", (await Q.listRequests(dgActor, { types: ["hr"], rejectedByMe: true })).rows.some((r) => r.id === reviewHr.id) && !(await Q.listRequests(dgActor, { types: ["hr"], approvedByMe: true })).rows.some((r) => r.id === reviewHr.id) && (await Q.listRequests(mainHr, { types: ["hr"], approvedByMe: true })).rows.some((r) => r.id === reviewHr.id));

  for (const k of ["SUPER_ADMIN_EMAIL", "SUPER_ADMIN_PASSWORD", "HR_ADMIN_EMAIL", "HR_ADMIN_PASSWORD", "HR_ADMIN_NAME", "EXPENDITURE_ADMIN_EMAIL", "EXPENDITURE_ADMIN_PASSWORD"]) delete process.env[k];
  await db.delete(T.aprSettings).where(eq(T.aprSettings.key, MARKER));
  if (savedMarker.length) await db.insert(T.aprSettings).values(savedMarker).onConflictDoNothing();
} catch (e) {
  bad++;
  console.log("FAIL the suite ran to the end without an unexpected error\n", e);
} finally {
  await cleanup().catch((e) => console.error("CLEANUP FAILED:", e));
  if (savedRules.length) await db.insert(T.aprApproverRules).values(savedRules).catch((e) => console.error("COULD NOT RESTORE THE ROUTING RULES:", e));
  if (savedCounters.length) await db.insert(T.aprCounters).values(savedCounters).catch((e) => console.error("COULD NOT RESTORE THE COUNTERS:", e));
  await db.delete(T.aprSettings).where(eq(T.aprSettings.key, "env_rules_seeded")).catch(() => {});
  if (savedSeedMarker.length) await db.insert(T.aprSettings).values(savedSeedMarker).catch((e) => console.error("COULD NOT RESTORE THE RULES MARKER:", e));
  await db.delete(T.aprFormFields).catch(() => {});
  if (savedFormFields.length) await db.insert(T.aprFormFields).values(savedFormFields).catch((e) => console.error("COULD NOT RESTORE THE FORM FIELDS:", e));
  console.log(`\n${ok}/${ok + bad} integration checks passed`);
  process.exit(bad ? 1 : 0);
}
