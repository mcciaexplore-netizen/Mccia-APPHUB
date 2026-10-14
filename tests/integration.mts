/**
 * Integration test of the Approvals server code against a real Postgres: submitting, routing, deciding, budgets, files, visibility,
 * lists and reports, calling the module's own functions directly (no browser, no web server).
 *
 * It WRITES to the database, so point it at a scratch database, never the live one:
 *   INTEGRATION_DB_CONFIRM=yes INTEGRATION_DATABASE_URL=postgres://postgres@127.0.0.1:5432/scratch npm run test:integration
 * The scratch database needs every migration applied first (npx drizzle-kit migrate, with DATABASE_URL pointing at it). A Neon branch of
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
const B = await import("../src/lib/approvals/budget-position");
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
  await db.delete(T.aprBudgets).where(sql`${T.aprBudgets.branchId} in (select id from apr_branches where name like 'ZZ%')`);
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
  const [catNo] = await db.insert(T.aprCategories).values({ name: "ZZ Int No Budget" }).returning();
  const [hrCat] = await db.insert(T.aprHrCategories).values({ name: "ZZ Int HR" }).returning();
  const [pubType] = await db.insert(T.aprPublicationTypes).values({ name: "ZZ Int Type" }).returning();
  const [pub] = await db.insert(T.aprPublications).values({ name: "ZZ Int Pub", publicationTypeId: pubType.id }).returning();
  await db.insert(T.aprBudgets).values({ financialYear: FY, branchId: branch.id, categoryId: cat.id, allocatedPaise: 5_000_000 });
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
  const large = (amountPaise: number, extra: object = {}) => S.largeExpenditureInput.parse({ employeeUserId: req.id, categoryId: cat.id, branchId: branch.id, amountPaise, vendorName: "V", ...extra });
  const smallIn = (amountPaise: number, extra: object = {}) => S.smallExpenditureInput.parse({ employeeUserId: req.id, email: req.email, categoryId: cat.id, branchId: branch.id, amountPaise, vendorName: "Vendor", ...extra });
  const row = async (id: string) => (await db.select().from(T.aprRequests).where(eq(T.aprRequests.id, id)))[0];
  const position = () => B.budgetPosition(FY, branch.id, cat.id);

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
  check("the DG has a notification", (await N.recentNotifications(dg.id)).some((n) => n.link === `/approvals/requests/${hrMade.id}`));
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
  check("someone who is not the approver cannot decide it", (await refused(() => R.decideRequest(hrMade.id, { action: "approve", comment: null }, small)))?.status === 403);
  check("rejecting needs a comment", (await refused(() => R.decideRequest(hrMade.id, { action: "reject", comment: null }, dg)))?.status === 422);
  check("the DG approves", (await R.decideRequest(hrMade.id, { action: "approve", comment: null }, dg)).status === "approved");
  const hrDone = await row(hrMade.id);
  check("it is approved with a decision time and nobody waiting", hrDone.status === "approved" && !!hrDone.decidedAt && hrDone.currentApproverUserId === null);
  check("deciding again is a clear 409", (await refused(() => R.decideRequest(hrMade.id, { action: "reject", comment: "x" }, dg)))?.status === 409);
  check("the requester was told", (await N.recentNotifications(req.id)).some((n) => /was approved/.test(n.title)));
  const actions = (await db.select().from(T.aprApprovalEvents).where(eq(T.aprApprovalEvents.requestId, hrMade.id)).orderBy(T.aprApprovalEvents.id)).map((e) => e.action);
  check("the history reads submitted, assigned, viewed, approved", JSON.stringify(actions) === JSON.stringify(["submitted", "assigned", "viewed", "approved"]), actions);
  check("it can no longer be withdrawn", (await refused(() => R.withdrawRequest(hrMade.id, null, req)))?.status === 409);

  /* ------------------------------------------------------------------ the 10,000 rule and budgets */
  check("10,000 on the below-10k form is refused", (await refused(() => R.submitExpenditure("small", smallIn(1_000_000), req)))?.status === 422);
  check("9,999.99 on the DG form is refused", (await refused(() => R.submitExpenditure("large", large(999_999), req)))?.status === 422);
  check("nothing was saved by the refused ones", (await db.select().from(T.aprRequests).where(eq(T.aprRequests.type, "expenditure_small"))).length === 0);

  let p = await position();
  check("budget starts at 50,000 with nothing spent", p.allocatedPaise === 5_000_000 && p.spentPaise === 0 && p.pendingPaise === 0);
  const big = await R.submitExpenditure("large", large(1_500_000, { natureOfExpenditure: "ZZ nature" }), req);
  const bigRow = await row(big.id);
  const [bigD] = await db.select().from(T.aprExpenditureDetails).where(eq(T.aprExpenditureDetails.requestId, big.id));
  check("a 15,000 request is pending with an EXP number and not over budget", bigRow.status === "pending" && big.requestNo === `EXP-${FY}-0001` && !bigRow.overBudget, big.requestNo);
  check("the budget picture at submission is stored", Number(bigD.budgetAllocatedPaise) === 5_000_000 && Number(bigD.budgetAvailablePaise) === 5_000_000 && Number(bigD.budgetRemainingPaise) === 3_500_000);
  p = await position();
  check("pending counts as pending, not spent", p.spentPaise === 0 && p.pendingPaise === 1_500_000);
  check("approving uses it up", (await R.decideRequest(big.id, { action: "approve", comment: null }, dg)).status === "approved" && (await position()).spentPaise === 1_500_000);

  const over = await R.submitExpenditure("large", large(4_000_000), req);
  check("40,000 against 35,000 left is accepted but flagged", (await row(over.id)).overBudget === true);
  const overDetail = await Q.getRequestDetail(over.id, dg);
  check("the approver is told a comment is needed", overDetail?.can.commentToApprove === true && overDetail.expenditure?.now.overBudget === true && overDetail.expenditure.now.excessPaise === 500_000, JSON.stringify(overDetail?.expenditure?.now));
  check("approving over budget without a comment is refused", (await refused(() => R.decideRequest(over.id, { action: "approve", comment: null }, dg)))?.status === 422);
  check("with a comment it goes through", (await R.decideRequest(over.id, { action: "approve", comment: "one-off" }, dg)).status === "approved");
  p = await position();
  check("spent is now 55,000, past the 50,000 allocated", p.spentPaise === 5_500_000);

  const noBudget = await R.submitExpenditure("large", large(1_200_000, { categoryId: catNo.id }), req);
  check("a request with no budget at all is accepted and flagged", (await row(noBudget.id)).overBudget === true && (await db.select().from(T.aprExpenditureDetails).where(eq(T.aprExpenditureDetails.requestId, noBudget.id)))[0].budgetAllocatedPaise === null);
  await R.decideRequest(noBudget.id, { action: "reject", comment: "no budget" }, dg);

  const rej = await R.submitExpenditure("large", large(1_200_000), req);
  await R.decideRequest(rej.id, { action: "reject", comment: "not needed" }, dg);
  const rejRow = await row(rej.id);
  check("a rejected request records the comment and leaves the budget alone", rejRow.status === "rejected" && rejRow.decisionComment === "not needed" && (await position()).spentPaise === 5_500_000);
  check("its remaining steps are marked skipped, not left waiting", (await db.select().from(T.aprRequestSteps).where(eq(T.aprRequestSteps.requestId, rej.id))).every((s) => s.status !== "waiting" && s.status !== "pending"));

  /* ------------------------------------------------------------------ expenses below 10,000 */
  const sm = await R.submitExpenditure("small", smallIn(500_000, { expenseDate: "2026-04-10", taxInvoiceDate: "2026-04-09", publicationTypeId: pubType.id, publicationId: pub.id }), req);
  const smRow = await row(sm.id);
  check("a 5,000 expense gets an EXB number and goes to the below-10k approver", sm.requestNo === `EXB-${FY}-0001` && smRow.currentApproverUserId === small.id, sm.requestNo);
  check("the DG cannot decide it", (await refused(() => R.decideRequest(sm.id, { action: "approve", comment: null }, dg)))?.status === 403);
  check("the category is already overspent, so this expense is flagged and its approver needs a comment", smRow.overBudget === true && (await refused(() => R.decideRequest(sm.id, { action: "approve", comment: null }, small)))?.status === 422);
  check("with a comment its approver can approve it", (await R.decideRequest(sm.id, { action: "approve", comment: "within the group's overall budget" }, small)).status === "approved");
  check("approved expenses count against the same budget (60,000 spent)", (await position()).spentPaise === 6_000_000);
  check("a publication from another type is refused", (await refused(async () => {
    const [t2] = await db.insert(T.aprPublicationTypes).values({ name: "ZZ Int Type Two" }).returning();
    return R.submitExpenditure("small", smallIn(100_000, { publicationTypeId: t2.id, publicationId: pub.id }), req);
  }))?.status === 400);
  check("a tax invoice dated in the future is refused", (await refused(() => R.submitExpenditure("small", smallIn(100_000, { taxInvoiceDate: "2099-01-01" }), req)))?.status === 400);
  check("a person not in the hub list is refused", (await refused(() => R.submitExpenditure("small", smallIn(100_000, { employeeUserId: randomUUID() }), req)))?.status === 400);

  /* ------------------------------------------------------------------ routing edge cases */
  check("the DG raising an HR request while being its only approver is stopped with the reason", /nobody can approve their own request/.test((await refused(() => R.submitHrRequest(hr(), dg)))?.message ?? ""));
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
  check("withdrawn requests use no budget", (await position()).spentPaise === 6_000_000);

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
  const util = (await B.utilisation(FY)).find((r) => r.branchId === branch.id && r.categoryId === cat.id);
  check("budget utilisation: allocated, spent, pending, remaining, percent", util?.allocatedPaise === 5_000_000 && util.spentPaise === 6_000_000 && util.remainingPaise === -1_000_000 && util.percent === 120, JSON.stringify(util));
  await R.submitExpenditure("large", large(1_100_000, { categoryId: catNo.id }), req);
  const utilNo = (await B.utilisation(FY)).find((r) => r.categoryId === catNo.id);
  check("a category with a waiting request but no budget still appears, with no percent", utilNo?.allocatedPaise === null && utilNo.percent === null && utilNo.pendingPaise === 1_100_000 && utilNo.remainingPaise === null, JSON.stringify(utilNo));
  const hrr = await Rep.hrReport({});
  const zz = hrr.byCategory.find((c) => c.name === "ZZ Int HR");
  check("HR report counts by category and outcome (5 requests: 3 decided, 1 waiting, 1 withdrawn)", !!zz && zz.total === 5 && zz.approved >= 2 && zz.approved + zz.rejected === 3 && zz.pending === 1, JSON.stringify(zz));
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
} catch (e) {
  bad++;
  console.log("FAIL the suite ran to the end without an unexpected error\n", e);
} finally {
  await cleanup().catch((e) => console.error("CLEANUP FAILED:", e));
  console.log(`\n${ok}/${ok + bad} integration checks passed`);
  process.exit(bad ? 1 : 0);
}
