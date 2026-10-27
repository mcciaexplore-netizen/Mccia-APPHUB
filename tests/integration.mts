/**
 * Integration test of the Approvals server code against a real Postgres: submitting, routing by role (HR Admin, Expense Admin, Super
 * Admin), deciding, returning and correcting, files, visibility, lists and reports, the HR and Expenditure places, and the form editor.
 * It calls the module's own functions directly (no browser, no web server).
 *
 * It WRITES to the database, so point it at a scratch database, never the live one:
 *   INTEGRATION_DB_CONFIRM=yes INTEGRATION_DATABASE_URL=postgres://postgres@127.0.0.1:5432/scratch npm run test:integration
 * Every migration must be applied first. Everything it creates is named "ZZ"/"zz-int-" and is removed when it finishes, and the request
 * counters and form layouts are put back. The project's own .env is NOT read, so it cannot reach the live database by accident. Because
 * the Super Admin, HR Admin and Expense Admin are one person each, it refuses a database where real people hold those roles.
 */
import { randomUUID } from "node:crypto";

const url = process.env.INTEGRATION_DATABASE_URL;
if (process.env.INTEGRATION_DB_CONFIRM !== "yes" || !url) {
  console.error("Set INTEGRATION_DATABASE_URL to a scratch database and INTEGRATION_DB_CONFIRM=yes (this test writes to it).");
  process.exit(2);
}
if (/neon\.tech/i.test(url) && process.env.INTEGRATION_ALLOW_NEON !== "yes") {
  console.error("That looks like a Neon address. Use a scratch database (or a Neon branch with INTEGRATION_ALLOW_NEON=yes).");
  process.exit(2);
}
process.env.DATABASE_URL = url;
process.env.DB_DRIVER = process.env.INTEGRATION_DB_DRIVER ?? "pg";
process.env.APPROVALS_ENABLED = "true";
process.env.APP_BASE_URL = "http://localhost:3999";
delete process.env.SMTP_HOST; // no real email from a test

const { and, eq, inArray, like, sql } = await import("drizzle-orm");
const { db } = await import("../src/db");
const { users } = await import("../src/db/schema");
const T = await import("../src/db/approvals-schema");
const S = await import("../src/lib/approvals/request-schemas");
const R = await import("../src/lib/approvals/requests");
const Q = await import("../src/lib/approvals/request-queries");
const F = await import("../src/lib/approvals/files");
const Rep = await import("../src/lib/approvals/reports");
const N = await import("../src/lib/approvals/notify");
const Settings = await import("../src/lib/approvals/settings");
const { roleApprovers } = await import("../src/lib/approvals/host-adapter");
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

const holders = await db.select({ email: users.email }).from(users).where(and(inArray(users.role, ["super_admin", "hr_admin", "expense_admin"]), sql`${users.email} not like 'zz-int-%'`));
if (holders.length) {
  console.error(`This database already has a Super Admin, HR Admin or Expense Admin (${holders.length}). Use a scratch database.`);
  process.exit(2);
}

const FY = financialYearOf();
// The test numbers its own requests from 0001 and edits the forms; the real counters and layouts are put back at the end.
const savedCounters = await db.select().from(T.aprCounters);
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
  await db.delete(users).where(like(users.email, "zz-int-%"));
  await db.delete(T.aprCategories).where(like(T.aprCategories.name, "ZZ%"));
  await db.delete(T.aprHrCategories).where(like(T.aprHrCategories.name, "ZZ%"));
  await db.delete(T.aprBranches).where(like(T.aprBranches.name, "ZZ%"));
  await db.delete(T.aprPublications).where(like(T.aprPublications.name, "ZZ%"));
  await db.delete(T.aprPublicationTypes).where(like(T.aprPublicationTypes.name, "ZZ%"));
  await db.delete(T.aprCounters);
};

/** A person in the hub with a role, as the module sees them (src/lib/approvals/host-adapter.ts gives these roles and places). */
const person = async (key: string, role: "member" | "super_admin" | "hr_admin" | "expense_admin" | "head_admin" = "member"): Promise<Actor> => {
  const email = `zz-int-${key}@example.com`;
  const [u] = await db.insert(users).values({ name: `ZZ Int ${key}`, email, status: "approved", role }).returning({ id: users.id });
  const roles: Actor["roles"] = ["requester"];
  if (role === "super_admin") roles.push("dg");
  if (role === "hr_admin" || role === "expense_admin") roles.push("approver");
  if (role === "head_admin") roles.push("approvals_admin", "viewer");
  return { id: u.id, name: `ZZ Int ${key}`, email, roles, place: role === "hr_admin" ? "hr" : role === "expense_admin" ? "expenditure" : null };
};
const bytesOf = async (stream: ReadableStream<Uint8Array>) => Buffer.concat(await (async () => { const out: Buffer[] = []; const rd = stream.getReader(); for (;;) { const { done, value } = await rd.read(); if (done) break; out.push(Buffer.from(value)); } return out; })());

try {
  await cleanup();

  /* ------------------------------------------------------------------ setup */
  const req = await person("requester");
  const other = await person("other");
  const support = await person("support", "head_admin"); // oversees everything in the module
  const [branch] = await db.insert(T.aprBranches).values({ name: "ZZ Int Branch" }).returning();
  const [cat] = await db.insert(T.aprCategories).values({ name: "ZZ Int Category" }).returning();
  const [cat2] = await db.insert(T.aprCategories).values({ name: "ZZ Int Category Two" }).returning();
  const [hrCat] = await db.insert(T.aprHrCategories).values({ name: "ZZ Int HR" }).returning();
  const [pubType] = await db.insert(T.aprPublicationTypes).values({ name: "ZZ Int Type" }).returning();
  const [pub] = await db.insert(T.aprPublications).values({ name: "ZZ Int Pub", publicationTypeId: pubType.id }).returning();
  const settings = await Settings.getSettings();
  check("settings fall back to the 10,000 default", settings.thresholdPaise === 1_000_000, settings.thresholdPaise);

  const hr = (extra: object = {}) => S.hrRequestInput.parse({ firstName: "Asha", lastName: "Patil", hrCategoryId: hrCat.id, ...extra });
  const exp = (amountPaise: number, extra: object = {}) => ({ employeeUserId: req.id, email: req.email, categoryId: cat.id, amountPaise, vendorName: "Vendor", ...extra });
  const large = (amountPaise: number, extra: object = {}) => S.largeExpenditureInput.parse(exp(amountPaise, extra));
  const smallIn = (amountPaise: number, extra: object = {}) => S.smallExpenditureInput.parse(exp(amountPaise, extra));
  const row = async (id: string) => (await db.select().from(T.aprRequests).where(eq(T.aprRequests.id, id)))[0];
  const stepsOf = (id: string) => db.select().from(T.aprRequestSteps).where(eq(T.aprRequestSteps.requestId, id)).orderBy(T.aprRequestSteps.stepNo);
  const eventsOf = async (id: string) => (await db.select().from(T.aprApprovalEvents).where(eq(T.aprApprovalEvents.requestId, id)).orderBy(T.aprApprovalEvents.id)).map((e) => e.action);
  const noDrafts = async () => (await db.select().from(T.aprRequests).where(eq(T.aprRequests.status, "draft"))).length === 0;

  /* ------------------------------------------------------------------ nobody holds a role yet */
  console.log("\n== 1. With no HR Admin, Expense Admin or Super Admin, nothing can be routed ==");
  const none = await refused(() => R.submitHrRequest(hr(), req));
  check("an HR request is refused with a message saying who must be given a role", none?.status === 409 && /Support Admin to give someone/.test(none.message), none);
  check("so is an expense", (await refused(() => R.submitExpenditure("small", smallIn(100_000), req)))?.status === 409);
  check("and nothing half-saved is left", await noDrafts());

  const dg = await person("dg", "super_admin");
  const hrA = await person("hradmin", "hr_admin");
  const expA = await person("expadmin", "expense_admin");
  const ra = await roleApprovers();
  check("the approvers are whoever holds each role", ra.superAdmin?.id === dg.id && ra.hr?.id === hrA.id && ra.expense?.id === expA.id);

  /* ------------------------------------------------------------------ HR, with a file */
  console.log("\n== 2. An HR request: HR Admin, then the Super Admin ==");
  const body = Buffer.from("%PDF-1.4 integration test file");
  const up = await F.startUpload(req, { fileName: "zz-note.pdf", size: body.length });
  await F.putChunk(req, up.fileId, 0, body);
  const hrMade = await R.submitHrRequest(hr({ fileUpload: { fileId: up.fileId }, description: "  needs a certificate  " }), req);
  const hrRow = await row(hrMade.id);
  const hrSteps = await stepsOf(hrMade.id);
  check("an HR request is saved pending with an HR number for this financial year", hrRow.status === "pending" && hrMade.requestNo === `HR-${FY}-0001`, hrMade.requestNo);
  check("it has two steps: the HR Admin first, then the Super Admin", hrRow.totalSteps === 2 && hrRow.currentStep === 1 && hrRow.currentApproverUserId === hrA.id && hrSteps.map((s) => `${s.stepLabel}:${s.approverUserId === hrA.id ? "hr" : s.approverUserId === dg.id ? "dg" : "?"}:${s.status}`).join() === "HR Admin:hr:pending,Super Admin:dg:waiting");
  check("the requester is the signed-in person, the name is what was typed", hrRow.requesterUserId === req.id && hrRow.requesterName === "Asha Patil" && hrRow.requesterEmail === req.email);
  check("no request is ever flagged over budget (there are no budgets)", hrRow.overBudget === false);
  const [hrDetails] = await db.select().from(T.aprHrDetails).where(eq(T.aprHrDetails.requestId, hrMade.id));
  check("the description is trimmed and stored", hrDetails.description === "needs a certificate");
  check("the HR Admin has a notification, the Super Admin not yet", (await N.recentNotifications(hrA.id)).some((n) => n.link === `/approvals/requests/${hrMade.id}?app=hr`) && (await N.unreadCount(dg.id)) === 0);
  const detail0 = await Q.getRequestDetail(hrMade.id, hrA);
  check("the HR Admin can open it and may decide, as a recommendation", !!detail0 && detail0.can.decide && detail0.can.mode === "recommend" && !detail0.can.withdraw && detail0.attachments.length === 1);
  const att = detail0!.attachments[0];
  const dl = await Q.attachmentForDownload(hrA, att.id);
  const bytes = dl ? await bytesOf(F.readFileStream((await F.getStoredFile(dl.storageKey))!)) : Buffer.alloc(0);
  check("the stored file comes back byte for byte", bytes.equals(body), bytes.toString());
  check("someone not involved cannot see the request or download the file", (await Q.getRequestDetail(hrMade.id, other)) === null && (await Q.attachmentForDownload(other, att.id)) === null);
  check("the Expense Admin, who has no step on it, cannot see it either", (await Q.getRequestDetail(hrMade.id, expA)) === null);
  check("the requester sees it and may withdraw it", (await Q.getRequestDetail(hrMade.id, req))?.can.withdraw === true);
  check("the Support Admin sees it but cannot decide", (await Q.getRequestDetail(hrMade.id, support))?.can.decide === false);
  check("a file that was used cannot be attached again", (await refused(() => R.submitHrRequest(hr({ fileUpload: { fileId: up.fileId } }), req)))?.status === 409);

  await R.recordViewed(hrMade.id, hrA);
  await R.recordViewed(hrMade.id, hrA);
  check("opening is recorded once", (await db.select().from(T.aprApprovalEvents).where(and(eq(T.aprApprovalEvents.requestId, hrMade.id), eq(T.aprApprovalEvents.action, "viewed")))).length === 1);
  check("the requester cannot decide their own request", (await refused(() => R.decideRequest(hrMade.id, { action: "approve", comment: null }, req)))?.status === 403);
  check("the Super Admin cannot jump ahead of the HR Admin", (await refused(() => R.decideRequest(hrMade.id, { action: "approve", comment: null }, dg)))?.status === 403);
  check("someone not involved is told it does not exist", (await refused(() => R.decideRequest(hrMade.id, { action: "approve", comment: null }, other)))?.status === 404);
  check("rejecting needs a comment", (await refused(() => R.decideRequest(hrMade.id, { action: "reject", comment: null }, hrA)))?.status === 422);
  check("approving needs no comment: the HR Admin recommends it and it moves to the Super Admin", (await R.decideRequest(hrMade.id, { action: "approve", comment: null }, hrA)).status === "pending" && (await row(hrMade.id)).currentApproverUserId === dg.id);
  check("the Super Admin was told, and decides it as the final decision", (await N.recentNotifications(dg.id)).some((n) => n.link?.includes(hrMade.id)) && (await Q.getRequestDetail(hrMade.id, dg))?.can.mode === "final");
  check("the Super Admin approves without a comment", (await R.decideRequest(hrMade.id, { action: "approve", comment: null }, dg)).status === "approved");
  const hrDone = await row(hrMade.id);
  check("it is approved with a decision time and nobody waiting", hrDone.status === "approved" && !!hrDone.decidedAt && hrDone.currentApproverUserId === null);
  check("deciding again is a clear 409", (await refused(() => R.decideRequest(hrMade.id, { action: "reject", comment: "x" }, dg)))?.status === 409);
  check("the requester was told", (await N.recentNotifications(req.id)).some((n) => /was approved/.test(n.title)));
  const actions = await eventsOf(hrMade.id);
  check("the history holds the submission, the viewing and both approvals, in order", actions[0] === "submitted" && actions.includes("viewed") && actions.filter((a) => a === "approved").length === 2, actions);
  check("it can no longer be withdrawn", (await refused(() => R.withdrawRequest(hrMade.id, null, req)))?.status === 409);
  const hrMoney = await R.submitHrRequest(hr({ lastName: "Money", amountPaise: 4_000_000 }), req);
  check("an HR request may carry an amount, with no budget figures", (await row(hrMoney.id)).amountPaise === 4_000_000 && (await row(hrMoney.id)).overBudget === false);

  /* ------------------------------------------------------------------ expenses */
  console.log("\n== 3. Expenses: the Expense Admin alone below 10,000, then the Super Admin from 10,000 ==");
  check("10,000 sent as a small expense is refused", (await refused(() => R.submitExpenditure("small", smallIn(1_000_000), req)))?.status === 422);
  check("9,999.99 sent as a large one is refused", (await refused(() => R.submitExpenditure("large", large(999_999), req)))?.status === 422);
  check("nothing was saved by the refused ones", (await db.select().from(T.aprRequests).where(eq(T.aprRequests.type, "expenditure_small"))).length === 0);
  check("one form for every amount: from 10,000 the same fields are required (vendor and email)", !S.largeExpenditureInput.safeParse({ ...exp(1_500_000), vendorName: "" }).success && !S.largeExpenditureInput.safeParse({ ...exp(1_500_000), email: "" }).success);

  const big = await R.submitExpenditure("large", large(1_500_000, { natureOfExpenditure: "ZZ nature", expenseDate: "2026-04-10", taxInvoiceDate: "2026-04-09", publicationTypeId: pubType.id, publicationId: pub.id }), req);
  const bigRow = await row(big.id);
  const [bigD] = await db.select().from(T.aprExpenditureDetails).where(eq(T.aprExpenditureDetails.requestId, big.id));
  check("a 15,000 expense gets an EXP number and two steps: Expense Admin, then Super Admin", big.requestNo === `EXP-${FY}-0001` && bigRow.totalSteps === 2 && bigRow.currentApproverUserId === expA.id, big.requestNo);
  check("the expense fields asked on the one form are kept for a large one too", bigD.expenseDate === "2026-04-10" && bigD.taxInvoiceDate === "2026-04-09" && bigD.publicationId === pub.id && bigD.natureOfExpenditure === "ZZ nature");
  check("no budget figures are stored", bigD.budgetAllocatedPaise === null && bigD.budgetAvailablePaise === null && bigRow.overBudget === false);
  check("the Expense Admin recommends it without a comment, and the Super Admin approves it", (await R.decideRequest(big.id, { action: "approve", comment: null }, expA)).status === "pending" && (await R.decideRequest(big.id, { action: "approve", comment: null }, dg)).status === "approved");

  const rej = await R.submitExpenditure("large", large(1_200_000), req);
  await R.decideRequest(rej.id, { action: "reject", comment: "not needed" }, expA);
  const rejRow = await row(rej.id);
  check("a request the Expense Admin rejects ends there, with the comment", rejRow.status === "rejected" && rejRow.decisionComment === "not needed");
  check("its remaining steps are marked skipped, not left waiting", (await stepsOf(rej.id)).every((s) => s.status !== "waiting" && s.status !== "pending"));
  check("and it never reached the Super Admin's queue", !(await Q.listRequests(dg, { waitingForMe: true })).rows.some((r) => r.id === rej.id));

  const sm = await R.submitExpenditure("small", smallIn(500_000, { expenseDate: "2026-04-10", taxInvoiceDate: "2026-04-09", publicationTypeId: pubType.id, publicationId: pub.id }), req);
  const smRow = await row(sm.id);
  check("a 5,000 expense gets an EXB number and one step, the Expense Admin", sm.requestNo === `EXB-${FY}-0001` && smRow.totalSteps === 1 && smRow.currentApproverUserId === expA.id, sm.requestNo);
  check("the Super Admin can see it (they oversee every request) but cannot decide it", !!(await Q.getRequestDetail(sm.id, dg)) && (await refused(() => R.decideRequest(sm.id, { action: "approve", comment: null }, dg)))?.status === 403);
  check("the Expense Admin's approval is the only decision", (await Q.getRequestDetail(sm.id, expA))?.can.mode === "single" && (await R.decideRequest(sm.id, { action: "approve", comment: null }, expA)).status === "approved");
  check("a publication from another type is refused", (await refused(async () => {
    const [t2] = await db.insert(T.aprPublicationTypes).values({ name: "ZZ Int Type Two" }).returning();
    return R.submitExpenditure("small", smallIn(100_000, { publicationTypeId: t2.id, publicationId: pub.id }), req);
  }))?.status === 400);
  check("a tax invoice dated in the future is refused, at any amount", (await refused(() => R.submitExpenditure("small", smallIn(100_000, { taxInvoiceDate: "2099-01-01" }), req)))?.status === 400 && (await refused(() => R.submitExpenditure("large", large(1_500_000, { taxInvoiceDate: "2099-01-01" }), req)))?.status === 400);
  check("a person not in the hub list is refused", (await refused(() => R.submitExpenditure("small", smallIn(100_000, { employeeUserId: randomUUID() }), req)))?.status === 400);

  /* ------------------------------------------------------------------ nobody approves their own request */
  console.log("\n== 4. Approvers raising requests themselves ==");
  const byHr = await R.submitHrRequest(hr({ lastName: "ByHrAdmin" }), hrA);
  check("an HR request raised by the HR Admin skips their step: the Super Admin only", (await row(byHr.id)).totalSteps === 1 && (await row(byHr.id)).currentApproverUserId === dg.id);
  await R.withdrawRequest(byHr.id, null, hrA);
  const byDgHr = await R.submitHrRequest(hr({ lastName: "ByDg" }), dg);
  check("an HR request raised by the Super Admin goes to the HR Admin only", (await row(byDgHr.id)).totalSteps === 1 && (await row(byDgHr.id)).currentApproverUserId === hrA.id);
  await R.withdrawRequest(byDgHr.id, null, dg);
  const byExpSmall = await R.submitExpenditure("small", smallIn(500_000, { employeeUserId: expA.id, email: expA.email, categoryId: cat2.id }), expA);
  check("a small expense raised by the Expense Admin goes to the Super Admin instead, as step 1 of 1", (await row(byExpSmall.id)).totalSteps === 1 && (await row(byExpSmall.id)).currentApproverUserId === dg.id && (await stepsOf(byExpSmall.id))[0].stepLabel === "Super Admin");
  check("he cannot approve his own request, the Super Admin can", (await refused(() => R.decideRequest(byExpSmall.id, { action: "approve", comment: null }, expA)))?.status === 403 && (await R.decideRequest(byExpSmall.id, { action: "approve", comment: null }, dg)).status === "approved");
  const byExpLarge = await R.submitExpenditure("large", large(2_000_000, { employeeUserId: expA.id, email: expA.email }), expA);
  check("a large one raised by him has the Super Admin only", (await row(byExpLarge.id)).totalSteps === 1 && (await row(byExpLarge.id)).currentApproverUserId === dg.id);
  await R.withdrawRequest(byExpLarge.id, null, expA);
  const byDgLarge = await R.submitExpenditure("large", large(2_000_000), dg);
  check("a large expense raised by the Super Admin goes to the Expense Admin only", (await row(byDgLarge.id)).totalSteps === 1 && (await row(byDgLarge.id)).currentApproverUserId === expA.id);
  await R.withdrawRequest(byDgLarge.id, null, dg);

  /* ------------------------------------------------------------------ an approver who is gone */
  await db.update(users).set({ isActive: false }).where(eq(users.id, expA.id));
  const gone = await F.startUpload(req, { fileName: "zz-gone.pdf", size: 4 });
  await F.putChunk(req, gone.fileId, 0, Buffer.from("%PDF"));
  const noExp = await refused(() => R.submitExpenditure("small", smallIn(100_000, { fileUpload: { fileId: gone.fileId } }), req));
  check("with the Expense Admin deactivated and no one else to hand it to, a small expense is refused with the reason", noExp?.status === 409, noExp);
  check("its file is given back, and nothing half-saved is left", (await db.select().from(T.aprFiles).where(eq(T.aprFiles.id, gone.fileId)))[0].attached === false && await noDrafts());
  await db.update(users).set({ isActive: true }).where(eq(users.id, expA.id));
  check("once they are active again the same file can be used", (await R.submitExpenditure("small", smallIn(100_000, { fileUpload: { fileId: gone.fileId } }), req)).requestNo.startsWith("EXB-"));

  /* ------------------------------------------------------------------ races, withdrawals */
  console.log("\n== 5. Races and withdrawals ==");
  const race = await R.submitHrRequest(hr({ lastName: "Race" }), req);
  const outcomes = await Promise.allSettled([
    R.decideRequest(race.id, { action: "approve", comment: null }, hrA),
    R.decideRequest(race.id, { action: "reject", comment: "no" }, hrA),
    R.decideRequest(race.id, { action: "approve", comment: null }, hrA),
  ]);
  check("when decisions arrive together exactly one wins", outcomes.filter((o) => o.status === "fulfilled").length === 1, outcomes.map((o) => o.status).join());
  check("the others are told it was already decided", outcomes.filter((o) => o.status === "rejected").every((o) => (o as PromiseRejectedResult).reason instanceof ApprovalsError && (o as PromiseRejectedResult).reason.status === 409));
  check("the step has exactly one decision event", (await eventsOf(race.id)).filter((e) => e === "approved" || e === "rejected").length === 1);

  const wd = await R.submitHrRequest(hr({ lastName: "Withdraw" }), req);
  check("someone else cannot withdraw my request", (await refused(() => R.withdrawRequest(wd.id, null, other)))?.status === 404);
  await R.withdrawRequest(wd.id, "changed my mind", req);
  check("the requester can withdraw while pending", (await row(wd.id)).status === "withdrawn");
  check("the approver was told", (await N.recentNotifications(hrA.id)).some((n) => /withdrawn/.test(n.title)));
  check("a withdrawn request cannot be decided", (await refused(() => R.decideRequest(wd.id, { action: "approve", comment: null }, hrA)))?.status === 409);
  const hidden = await R.submitHrRequest(hr({ lastName: "Hidden" }), req);
  await R.withdrawRequest(hidden.id, null, req);
  check("someone not involved learns nothing about it, even after it is withdrawn", (await refused(() => R.decideRequest(hidden.id, { action: "approve", comment: null }, other)))?.status === 404);

  let tornApart = 0;
  for (let i = 0; i < 6; i++) {
    const t = await R.submitExpenditure("small", smallIn(200_000, { vendorName: `Tug${i}` }), req);
    await Promise.allSettled([R.withdrawRequest(t.id, null, req), R.decideRequest(t.id, { action: "approve", comment: null }, expA)]);
    const final = await row(t.id);
    const steps = await stepsOf(t.id);
    const evs = await eventsOf(t.id);
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
  check("the loser is told to attach the file again (409), and no half-saved request is left", lost?.reason instanceof ApprovalsError && lost.reason.status === 409 && await noDrafts());

  /* ------------------------------------------------------------------ files */
  console.log("\n== 6. Files ==");
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
  const { deleteOrphanUploads } = await import("../src/lib/approvals/cleanup");
  const stale = await F.startUpload(req, { fileName: "zz-stale.pdf", size: 4 });
  await F.putChunk(req, stale.fileId, 0, Buffer.from("old!"));
  await db.update(T.aprFiles).set({ createdAt: new Date(Date.now() - 25 * 3600 * 1000) }).where(eq(T.aprFiles.id, stale.fileId));
  const cleaned = await deleteOrphanUploads();
  check("the daily clean-up removes an upload never attached and older than a day, with its parts", cleaned.files >= 1 && (await db.select().from(T.aprFiles).where(eq(T.aprFiles.id, stale.fileId))).length === 0 && (await db.select().from(T.aprFileChunks).where(eq(T.aprFileChunks.fileId, stale.fileId))).length === 0);
  check("it leaves files on requests and recent uploads alone", (await db.select().from(T.aprFiles).where(eq(T.aprFiles.id, up.fileId))).length === 1 && (await db.select().from(T.aprFiles).where(eq(T.aprFiles.id, half.fileId))).length === 1);

  /* ------------------------------------------------------------------ lists and reports */
  console.log("\n== 7. Lists and reports ==");
  const all = await Q.listRequests(support, { pageSize: 500 });
  check("the Support Admin sees every submitted request (and no drafts)", all.total === all.rows.length && all.rows.every((r) => r.status !== "draft") && all.total >= 15, all.total);
  check("someone not involved sees none", (await Q.listRequests(other, {})).total === 0);
  const hrSees = await Q.listRequests(hrA, { pageSize: 500 });
  check("the HR Admin sees the HR requests they had a step on, and no expenses", hrSees.rows.some((r) => r.id === hrMade.id) && hrSees.rows.every((r) => r.type === "hr")); // the only requests the HR Admin raised were HR requests too
  const expSees = await Q.listRequests(expA, { pageSize: 500 });
  check("the Expense Admin sees expenses routed to them, and no HR requests", expSees.rows.some((r) => r.id === sm.id) && expSees.rows.some((r) => r.id === big.id) && !expSees.rows.some((r) => r.id === hrMade.id));
  check("the Super Admin oversees every request, like the Support Admin", (await Q.listRequests(dg, { pageSize: 500 })).total === all.total);
  check("filter by kind and status", (await Q.listRequests(support, { types: ["expenditure_large"], statuses: ["approved"] })).rows.some((r) => r.id === big.id));
  check("search finds a request number", (await Q.listRequests(support, { q: big.requestNo! })).rows.map((r) => r.id).join() === big.id);
  check("search treats % and _ as plain characters", (await Q.listRequests(support, { q: "%" })).total === 0 && (await Q.listRequests(support, { q: "_" })).total === 0);
  check("filter by category", (await Q.listRequests(support, { categoryId: hrCat.id })).rows.every((r) => r.type === "hr") && (await Q.listRequests(support, { categoryId: cat.id })).rows.every((r) => r.type !== "hr"));
  check("a date range around now includes them, one in the past does not", (await Q.listRequests(support, { from: "2000-01-01", to: "2999-01-01", pageSize: 500 })).total === all.total && (await Q.listRequests(support, { from: "2000-01-01", to: "2000-01-02" })).total === 0);
  const pg1 = await Q.listRequests(support, { pageSize: 3, page: 1 });
  const pg2 = await Q.listRequests(support, { pageSize: 3, page: 2 });
  check("paging gives different rows and the same total", pg1.rows.length === 3 && pg2.rows.length > 0 && pg1.total === pg2.total && !pg1.rows.some((r) => pg2.rows.some((x) => x.id === r.id)));
  const waiting = await R.submitHrRequest(hr({ lastName: "Waiting" }), req);
  check("'waiting for me' lists only what is waiting for that person", (await Q.listRequests(hrA, { waitingForMe: true })).rows.some((r) => r.id === waiting.id) && !(await Q.listRequests(dg, { waitingForMe: true })).rows.some((r) => r.id === waiting.id) && (await Q.waitingCount(hrA)) >= 1);
  check("'decided by me' lists what that person decided", (await Q.listRequests(dg, { decidedByMe: true })).rows.some((r) => r.id === hrMade.id) && (await Q.listRequests(other, { decidedByMe: true })).total === 0);
  check("'mine' lists what the person raised", (await Q.listRequests(req, { mine: true, pageSize: 500 })).rows.some((r) => r.id === waiting.id) && !(await Q.listRequests(req, { mine: true, pageSize: 500 })).rows.some((r) => r.id === byExpLarge.id));
  const hrRowList = (await Q.listRequests(support, { q: hrMade.requestNo! })).rows[0];
  check("an HR row carries the HR category and the full name", hrRowList.categoryName === "ZZ Int HR" && hrRowList.name === "Asha Patil");
  const hrr = await Rep.hrReport({});
  const zz = hrr.byCategory.find((c) => c.name === "ZZ Int HR");
  check("the HR report counts by category and outcome", !!zz && zz.total >= 5 && zz.approved >= 1 && zz.pending >= 1, JSON.stringify(zz));
  const ta = await Rep.turnaround({});
  check("approval time lists decided requests with a duration, by approver", ta.rows.length >= 3 && ta.byApprover.some((g) => g.name === dg.name) && ta.rows.every((r) => r.hours >= 0));
  const bell = await N.recentNotifications(req.id);
  await N.markRead(req.id, bell[0].id);
  check("one notification can be marked read, then all", bell.length >= 3 && (await N.unreadCount(req.id)) === bell.filter((n) => !n.read).length - (bell[0].read ? 0 : 1) && (await N.markRead(req.id), (await N.unreadCount(req.id)) === 0));
  await N.markRead(other.id);
  check("marking someone else's read changes nothing for me", (await N.unreadCount(hrA.id)) >= 1);

  /* ------------------------------------------------------------------ return for corrections, correct, resubmit */
  console.log("\n== 8. Returned for corrections, corrected, sent back ==");
  const fix = (kind: "large" | "small" | "hr", extra: object = {}) =>
    S.resubmitInput.parse(kind === "hr"
      ? { kind, firstName: "Asha", lastName: "Patil", hrCategoryId: hrCat.id, keepAttachmentIds: [], ...extra }
      : { kind, ...exp(2_500_000, { categoryId: cat2.id, vendorName: "Fixed Vendor" }), keepAttachmentIds: [], ...extra });
  const pdf1 = Buffer.from("%PDF-1.4 first version");
  const f1 = await F.startUpload(req, { fileName: "zz-first.pdf", size: pdf1.length });
  await F.putChunk(req, f1.fileId, 0, pdf1);
  const rq = await R.submitExpenditure("large", large(2_000_000, { categoryId: cat2.id, fileUpload: { fileId: f1.fileId } }), req);
  check("a 20,000 expense waits for the Expense Admin", (await row(rq.id)).currentApproverUserId === expA.id);
  check("returning needs a comment", (await refused(() => R.decideRequest(rq.id, { action: "return", comment: null }, expA)))?.status === 422);
  check("the Super Admin cannot return it while it is not theirs yet", (await refused(() => R.decideRequest(rq.id, { action: "return", comment: "x" }, dg)))?.status === 403);
  check("the Expense Admin returns it with a comment", (await R.decideRequest(rq.id, { action: "return", comment: "Quotation missing, please attach it" }, expA)).status === "returned");
  const retRow = await row(rq.id);
  const retSteps = await stepsOf(rq.id);
  check("it is returned, keeps its step and its approver, and the Super Admin's step still waits", retRow.status === "returned" && retRow.currentStep === 1 && retRow.currentApproverUserId === expA.id && retSteps[0].status === "returned" && retSteps[1].status === "waiting");
  check("the requester was told why", (await N.recentNotifications(req.id)).some((n) => /returned for corrections/.test(n.title) && n.body === "Quotation missing, please attach it"));
  const retDetail = await Q.getRequestDetail(rq.id, req);
  check("the requester can edit and withdraw, and sees who returned it and why", retDetail?.can.edit === true && retDetail.can.withdraw === true && retDetail.returned?.byName === expA.name);
  check("nobody can approve a returned request", (await refused(() => R.decideRequest(rq.id, { action: "approve", comment: null }, expA)))?.status === 409);
  check("the correction form opens only for the person who raised it", (await Q.getEditValues(rq.id, req)) !== null && (await Q.getEditValues(rq.id, expA)) === null && (await Q.getEditValues(rq.id, other)) === null);
  check("someone else, or the approver, cannot resubmit it", (await refused(() => R.resubmitRequest(rq.id, fix("large"), other)))?.status === 404 && (await refused(() => R.resubmitRequest(rq.id, fix("large"), expA)))?.status === 404);
  check("the wrong kind is refused", (await refused(() => R.resubmitRequest(rq.id, fix("small"), req)))?.status === 400);
  check("an amount below 10,000 is refused with the usual message", /below/.test((await refused(() => R.resubmitRequest(rq.id, fix("large", { amountPaise: 500_000 }), req)))?.message ?? ""));
  check("a file that is not on the request cannot be kept", (await refused(() => R.resubmitRequest(rq.id, fix("large", { keepAttachmentIds: [randomUUID()] }), req)))?.status === 400);
  const pdf2 = Buffer.from("%PDF-1.4 the quotation");
  const f2 = await F.startUpload(req, { fileName: "zz-quote.pdf", size: pdf2.length });
  await F.putChunk(req, f2.fileId, 0, pdf2);
  const keepId = retDetail!.attachments[0].id;
  const raced = await Promise.allSettled([
    R.resubmitRequest(rq.id, fix("large", { quotation: { fileId: f2.fileId }, keepAttachmentIds: [keepId] }), req),
    R.resubmitRequest(rq.id, fix("large", { quotation: { fileId: f2.fileId }, keepAttachmentIds: [keepId] }), req),
  ]);
  check("two corrections sent together: exactly one is accepted", raced.filter((r) => r.status === "fulfilled").length === 1, raced.map((r) => r.status).join());
  const backRow = await row(rq.id);
  const backSteps = await stepsOf(rq.id);
  check("it is pending again at the same step, with the same number and approver", backRow.status === "pending" && backRow.currentStep === 1 && backRow.currentApproverUserId === expA.id && backRow.requestNo === rq.requestNo && backSteps[0].status === "pending" && backSteps[1].status === "waiting");
  check("the new amount and vendor are saved, and the kept file stays beside the new one", backRow.amountPaise === 2_500_000 && (await db.select().from(T.aprExpenditureDetails).where(eq(T.aprExpenditureDetails.requestId, rq.id)))[0].vendorName === "Fixed Vendor" && (await db.select().from(T.aprAttachments).where(eq(T.aprAttachments.requestId, rq.id))).map((a) => a.slot).sort().join() === "file_upload,quotation");
  check("the history keeps the round trip", (await eventsOf(rq.id)).join().includes("returned") && (await eventsOf(rq.id)).join().includes("resubmitted"));
  check("the Expense Admin approves and it moves to the Super Admin", (await R.decideRequest(rq.id, { action: "approve", comment: null }, expA)).status === "pending" && (await row(rq.id)).currentApproverUserId === dg.id);
  check("the Super Admin returns it, and the correction comes back to the Super Admin at step 2", (await R.decideRequest(rq.id, { action: "return", comment: "Split the vendor name" }, dg)).status === "returned" && (await R.resubmitRequest(rq.id, fix("large", { vendorName: "Split Vendor" }), req)).requestNo === rq.requestNo && (await row(rq.id)).currentStep === 2 && (await row(rq.id)).currentApproverUserId === dg.id);
  check("the Expense Admin's earlier approval stays, and the Super Admin's approval completes it", (await stepsOf(rq.id))[0].status === "approved" && (await R.decideRequest(rq.id, { action: "approve", comment: null }, dg)).status === "approved");
  check("an approved request cannot be edited or returned", (await refused(() => R.resubmitRequest(rq.id, fix("large"), req)))?.status === 409 && (await refused(() => R.decideRequest(rq.id, { action: "return", comment: "x" }, dg)))?.status === 409);
  const hq = await R.submitHrRequest(hr({ lastName: "Return" }), req);
  await R.decideRequest(hq.id, { action: "approve", comment: null }, hrA);
  await R.decideRequest(hq.id, { action: "return", comment: "name is misspelt" }, dg);
  await R.resubmitRequest(hq.id, fix("hr", { lastName: "Returned" }), req);
  check("an HR request returned by the Super Admin goes back to the Super Admin after its correction, with the HR Admin's approval kept", (await row(hq.id)).currentApproverUserId === dg.id && (await row(hq.id)).requesterName === "Asha Returned" && (await stepsOf(hq.id))[0].status === "approved");
  const wr = await R.submitExpenditure("small", smallIn(300_000, { categoryId: cat2.id }), req);
  await R.decideRequest(wr.id, { action: "return", comment: "again" }, expA);
  await R.withdrawRequest(wr.id, "not needed", req);
  check("a returned request can be withdrawn, its steps marked not needed, and then cannot be corrected", (await row(wr.id)).status === "withdrawn" && (await stepsOf(wr.id)).every((x) => x.status === "skipped") && (await refused(() => R.resubmitRequest(wr.id, fix("small", { amountPaise: 300_000 }), req)))?.status === 409);

  /* ------------------------------------------------------------------ the HR and Expenditure places */
  console.log("\n== 9. The HR and Expenditure places, and the Super Admin's Recommended ==");
  const itemKeys = async (a: Actor) => (await Q.reviewItemsFor(a)).map((i) => i.key).join();
  check("the HR Admin has HR, the Expense Admin has Expenditure, the Super Admin has Recommended, the Support Admin both, a user none", (await itemKeys(hrA)) === "hr" && (await itemKeys(expA)) === "expenditure" && (await itemKeys(dg)) === "recommendation" && (await itemKeys(support)) === "hr,expenditure" && (await itemKeys(req)) === "");
  const dgItem = (await Q.reviewItemsFor(dg))[0];
  check("the Super Admin's Recommended counts each tab", dgItem.counts !== undefined && dgItem.waiting === Object.values(dgItem.counts!).reduce((a, n) => a + n, 0));
  const reviewHr = await R.submitHrRequest(hr({ lastName: "ReviewList" }), req);
  const notYet = await R.submitHrRequest(hr({ lastName: "ReviewNotYet" }), req);
  await R.decideRequest(reviewHr.id, { action: "approve", comment: null }, hrA);
  check("what the HR Admin recommended is in their Approved / Recommended lists, no longer Pending for them", (await Q.listRequests(hrA, { types: ["hr"], approvedByMe: true })).rows.some((r) => r.id === reviewHr.id) && (await Q.listRequests(hrA, { recommendedByMe: true })).rows.some((r) => r.id === reviewHr.id) && !(await Q.listRequests(hrA, { types: ["hr"], waitingForMe: true })).rows.some((r) => r.id === reviewHr.id));
  const dgRow = (await Q.listRequests(dg, { types: ["hr"], reachedMe: true })).rows.find((r) => r.id === reviewHr.id);
  check("it reached the Super Admin, with the buttons because it waits for them; one still with the HR Admin has not", !!dgRow && dgRow.mineToDecide === true && !(await Q.listRequests(dg, { types: ["hr"], reachedMe: true })).rows.some((r) => r.id === notYet.id));
  await R.decideRequest(reviewHr.id, { action: "reject", comment: "Not needed" }, dg);
  check("the Super Admin's rejection is in their Rejected list; the HR Admin's list still shows what they recommended, not as rejected by them", (await Q.listRequests(dg, { types: ["hr"], rejectedByMe: true })).rows.some((r) => r.id === reviewHr.id) && !(await Q.listRequests(hrA, { rejectedByMe: true })).rows.some((r) => r.id === reviewHr.id) && (await Q.listRequests(hrA, { recommendedByMe: true })).rows.some((r) => r.id === reviewHr.id && r.status === "rejected"));
  await R.decideRequest(notYet.id, { action: "reject", comment: "Not an HR matter" }, hrA);
  check("a request the HR Admin rejects is in their Rejected list and never reaches the Super Admin", (await Q.listRequests(hrA, { rejectedByMe: true })).rows.some((r) => r.id === notYet.id) && !(await Q.listRequests(dg, { waitingForMe: true })).rows.some((r) => r.id === notYet.id));

  /* ------------------------------------------------------------------ the form editor */
  console.log("\n== 10. The form editor, and the answers kept with each request ==");
  const FC = await import("../src/lib/approvals/form-config");
  const FF = await import("../src/lib/approvals/form-fields");
  await db.delete(T.aprFormFields);
  const defaults = await FC.getFormFields("hr");
  check("with nothing set, a form has its own fields in the default order", defaults.map((f) => f.key).join() === FF.BUILTIN.hr.map((d) => d.key).join() && defaults.every((f) => !f.hidden && f.builtin));
  const asInput = (fs: typeof defaults) => fs.map((f) => ({ key: f.key, label: f.label, hidden: f.hidden, kind: f.kind ?? undefined, required: f.required, options: f.options }));
  const layout = (...extra: { key?: string | null; label: string; kind: "text" | "select" | "number" | "date" | "textarea"; required?: boolean; options?: string[]; hidden?: boolean }[]) => ({
    fields: [...asInput(defaults).map((f) => (f.key === "description" ? { ...f, label: "Details" } : f.key === "file2" ? { ...f, hidden: true } : f)), ...extra.map((e) => ({ required: false, options: [], hidden: false, key: null, ...e }))],
  });
  const saved1 = await FC.saveFormFields("hr", FC.saveFieldsInput.parse(layout({ label: "Employee code", kind: "text", required: true }, { label: "Grade", kind: "select", options: ["A", "B"] })), support);
  const empKey = saved1.find((f) => f.label === "Employee code")!.key;
  const gradeKey = saved1.find((f) => f.label === "Grade")!.key;
  check("a saved layout renames a built-in field, removes an optional one and adds extra fields with their own keys", saved1.find((f) => f.key === "description")?.label === "Details" && saved1.find((f) => f.key === "file2")?.hidden === true && /^c_[a-z0-9]{8}$/.test(empKey) && saved1.filter((f) => !f.builtin).length === 2);
  check("the change is in the admin audit", (await db.select().from(T.aprAdminAudit)).some((a) => a.entity === "form_fields" && /HR form/.test(a.summary)));
  const badLayout = async (l: ReturnType<typeof layout>) => (await refused(async () => FC.saveFormFields("hr", FC.saveFieldsInput.parse(l), support)))?.message ?? "";
  check("a field the request cannot do without cannot be removed", /cannot be hidden/.test(await badLayout({ fields: asInput(defaults).map((f) => (f.key === "category" ? { ...f, hidden: true } : f)) })));
  check("two fields cannot share a name, and a dropdown needs choices", /Two fields are called/.test(await badLayout(layout({ label: "details", kind: "text" }))) && /at least one choice/.test(await badLayout(layout({ label: "Level", kind: "select", options: [] }))));
  const noCode = await refused(() => R.submitHrRequest(hr({ lastName: "Custom" }), req));
  check("a required extra field must be answered, or the request is refused with its name", noCode?.status === 422 && /Employee code/.test(noCode.message), noCode);
  check("a dropdown answer must be one of its choices", (await refused(() => R.submitHrRequest(hr({ lastName: "Custom", custom: { [empKey]: "E-1", [gradeKey]: "Z" } }), req)))?.status === 422);
  const withAnswers = await R.submitHrRequest(hr({ lastName: "Custom", custom: { [empKey]: " E-42 ", [gradeKey]: "B" } }), req);
  check("the answers are kept with the request, in form order, each with the name the field had", JSON.stringify((await row(withAnswers.id)).customValues) === JSON.stringify([{ key: empKey, label: "Employee code", value: "E-42" }, { key: gradeKey, label: "Grade", value: "B" }]));
  const renamed = await FC.saveFormFields("hr", FC.saveFieldsInput.parse({ fields: asInput(saved1).map((f) => (f.key === empKey ? { ...f, label: "Staff number" } : f)) }), support);
  check("renaming an extra field changes the form but not what an old request says", renamed.find((f) => f.key === empKey)?.label === "Staff number" && (await row(withAnswers.id)).customValues.find((c) => c.key === empKey)?.label === "Employee code");
  await FC.saveFormFields("hr", FC.saveFieldsInput.parse({ fields: asInput(renamed).filter((f) => f.key !== empKey && f.key !== gradeKey) }), support);
  check("removing the extra fields: old requests keep their answers, new ones need none", (await row(withAnswers.id)).customValues.length === 2 && (await row((await R.submitHrRequest(hr({ lastName: "NoExtras" }), req)).id)).customValues.length === 0);
  // The expense form is one form: its extra fields apply at every amount.
  const expDefaults = await FC.getFormFields("small");
  const expSaved = await FC.saveFormFields("small", FC.saveFieldsInput.parse({ fields: [...asInput(expDefaults), { key: null, label: "Project code", kind: "text", required: true, options: [], hidden: false }] }), support);
  const projKey = expSaved.find((f) => f.label === "Project code")!.key;
  check("an extra field on the expense form is required on a large expense too", /Project code/.test((await refused(() => R.submitExpenditure("large", large(1_500_000), req)))?.message ?? ""));
  const withProj = await R.submitExpenditure("large", large(1_500_000, { custom: { [projKey]: "P-7" } }), req);
  check("and its answer is kept with the large expense", (await row(withProj.id)).customValues.map((c) => `${c.label}=${c.value}`).join() === "Project code=P-7");
  await db.delete(T.aprFormFields);
} catch (e) {
  bad++;
  console.log("FAIL the suite ran to the end without an unexpected error\n", e);
} finally {
  await cleanup().catch((e) => console.error("CLEANUP FAILED:", e));
  if (savedCounters.length) await db.insert(T.aprCounters).values(savedCounters).catch((e) => console.error("COULD NOT RESTORE THE COUNTERS:", e));
  await db.delete(T.aprFormFields).catch(() => {});
  if (savedFormFields.length) await db.insert(T.aprFormFields).values(savedFormFields).catch((e) => console.error("COULD NOT RESTORE THE FORM FIELDS:", e));
  const left = await db.select({ id: users.id }).from(users).where(like(users.email, "zz-int-%"));
  if (left.length) { bad++; console.log(`FAIL ${left.length} test users left behind`); } else { ok++; console.log("PASS all test data removed"); }
  console.log(`\n${ok}/${ok + bad} integration checks passed`);
  process.exit(bad ? 1 : 0);
}
