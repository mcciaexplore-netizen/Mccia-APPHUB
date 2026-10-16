/** Fast checks for the pure helpers: CSV parsing/exporting, the email-domain rule and the Approvals money, date and menu rules. Run: npm run test:unit */
import { readdirSync, readFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";
import { parseCsv, toCsv } from "../src/lib/csv";
import { accountStatus } from "../src/lib/account-status";
import { COLUMNS, MAX_IMPORT_ROWS, TEMPLATE_CSV, tableToRows } from "../src/lib/import-parse";
import {
  ADMIN_AREAS, ASSIGNABLE_ROLES, PROMOTABLE_ROLES, canAdminister, canChangeRole, canDeactivate, canEditPerson, canImportUsers, canManageAccess, canUpdateByImport, canViewPerson, capabilities,
  firstUngrantable, grantableApps, hasArea, isStaff, wouldCreateCycle,
  type Actor, type Target,
} from "../src/lib/rbac";
import { isPublicAddress } from "../src/lib/net-guard";
import { adminTabsFor } from "../src/lib/admin-tabs";
import { scrub } from "../src/lib/scrub";
import { xlsxToTable } from "../src/lib/xlsx-read";
import { isEmailAllowed } from "../src/lib/domains";
import {
  FULL_ACCESS_ROLES, approvalsApps, appForType, canSee, parseReviewPath, hasFullAccess, isApprovalsUrl, isGroup, isModuleEnabled, isDgOnly, type ApprovalsRole } from "../src/lib/approvals/approvals.manifest";
import { resolveScreen, reviewScreen, screenFor } from "../src/lib/approvals/screens";
import { BUILTIN, FORM_KEYS, checkCustomAnswers, mergeFields, type FormField, type FormFieldRow } from "../src/lib/approvals/form-fields";
import {
  assessBudget, budgetWarning, commentRequired, decisionMode, escalationApprover, MODE_WORDS, formFor, formatRequestNo, percentUsed, planProblemMessage, planSteps, STATUS_LABEL, utilisationLevel, wrongFormMessage,
  type RuleLike,
} from "../src/lib/approvals/calc";
import { decisionInput, fileUploadStart, hrRequestInput, isAllowedFileName, largeExpenditureInput, mimeFor, safeFileName, smallExpenditureInput } from "../src/lib/approvals/request-schemas";
import {
  financialYearOf, formatDate, formatDateTime, formatINR, fromDateTimeLocal, isFinancialYear, isoToDisplay, parseDisplayDate, parseDisplayDateTime, parseINR,
  recentFinancialYears, todayIST, toDateTimeLocal,
} from "../src/lib/approvals/format";

let ok = 0, bad = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (pass) ok++; else bad++;
  console.log(pass ? "PASS" : "FAIL", name, pass ? "" : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`);
};

eq("simple rows", parseCsv("a,b\n1,2"), [["a", "b"], ["1", "2"]]);
eq("CRLF line endings", parseCsv("a,b\r\n1,2\r\n"), [["a", "b"], ["1", "2"]]);
eq("quoted comma", parseCsv('n,apps\nAsha,"Tally, CRM"'), [["n", "apps"], ["Asha", "Tally, CRM"]]);
eq("doubled quote", parseCsv('a\n"say ""hi"""'), [["a"], ['say "hi"']]);
eq("newline inside quotes", parseCsv('a,b\n"x\ny",z'), [["a", "b"], ["x\ny", "z"]]);
eq("BOM stripped", parseCsv("﻿email,name\nx,y"), [["email", "name"], ["x", "y"]]);
eq("blank lines dropped", parseCsv("a\n\n\nb\n"), [["a"], ["b"]]);
eq("no trailing newline", parseCsv("a,b\n1,2"), [["a", "b"], ["1", "2"]]);
eq("empty string", parseCsv(""), []);
eq("empty cells kept", parseCsv("a,b,c\n1,,3"), [["a", "b", "c"], ["1", "", "3"]]);
eq("export: '=' cell is prefixed against formula injection", toCsv([["=cmd|' /C calc'!A0"]]), "'=cmd|' /C calc'!A0");
eq("export: '+', '-', '@' cells are prefixed", toCsv([["+1", "-1", "@x"]]), "'+1,'-1,'@x");
eq("export: quotes and commas are escaped", toCsv([['a,"b"']]), '"a,""b"""');
eq("export: null/undefined become empty", toCsv([[null, undefined, 0]]), ",,0");
eq("round trip", parseCsv(toCsv([["a,b", "c\nd", 'e"f']])), [["a,b", "c\nd", 'e"f']]);

process.env.ALLOWED_EMAIL_DOMAIN = "mcciapune.com, @gmail.com";
eq("domain: listed domains allowed (case, spaces, @)", [isEmailAllowed("a@mcciapune.com"), isEmailAllowed("A@GMAIL.COM")], [true, true]);
eq("domain: others refused (lookalike, no domain, no name)", [isEmailAllowed("a@yahoo.com"), isEmailAllowed("a@evilmcciapune.com"), isEmailAllowed("nodomain"), isEmailAllowed("@gmail.com")], [false, false, false, false]);
process.env.ALLOWED_EMAIL_DOMAIN = "";
eq("domain: empty setting allows any domain", isEmailAllowed("a@anything.org"), true);

// Approvals: money is paise, shown with Indian grouping.
eq("money: Indian grouping", formatINR(123456700), "12,34,567.00");
eq("money: crore", formatINR(1000000000), "1,00,00,000.00");
eq("money: zero and single paise", [formatINR(0), formatINR(5), formatINR(99)], ["0.00", "0.05", "0.99"]);
eq("money: negative keeps its sign", formatINR(-50000), "-500.00");
eq("money: rupee symbol on request", formatINR(1000000, { symbol: true }), "₹10,000.00");
eq("money: empty for null/undefined", [formatINR(null), formatINR(undefined)], ["", ""]);
eq("money: parses grouped input", parseINR("12,34,567.00"), 123456700);
eq("money: parses plain, symbol and one decimal", [parseINR("10000"), parseINR("₹ 1,000.5"), parseINR("0")], [1000000, 100050, 0]);
eq("money: rejects junk, a third decimal, negatives and a bare point", [parseINR(""), parseINR("abc"), parseINR("100.555"), parseINR("-5"), parseINR(".5")], [null, null, null, null, null]);
eq("money: format then parse round trip", parseINR(formatINR(98765432)), 98765432);

// Approvals: dates show in IST, the financial year runs April to March in IST.
eq("date: dd-MMM-yyyy", formatDate(new Date("2026-10-13T00:00:00Z")), "13-Oct-2026");
eq("date: late evening UTC is already tomorrow in IST", formatDate(new Date("2026-03-31T20:00:00Z")), "01-Apr-2026");
eq("date: datetime", formatDateTime(new Date("2026-10-13T08:35:09Z")), "13-Oct-2026 14:05:09");
eq("date: empty for null", [formatDate(null), formatDateTime(undefined)], ["", ""]);
eq("financial year: October is in the year that began in April", financialYearOf(new Date("2026-10-13T00:00:00Z")), "2026-27");
eq("financial year: 31 March IST is still the old year", financialYearOf(new Date("2027-03-31T10:00:00Z")), "2026-27");
eq("financial year: 1 April IST starts the new year even while UTC is 31 March", [financialYearOf(new Date("2027-03-31T20:00:00Z")), financialYearOf(new Date("2026-03-31T19:00:00Z"))], ["2027-28", "2026-27"]);
eq("financial year: validation", [isFinancialYear("2026-27"), isFinancialYear("2026-28"), isFinancialYear("26-27"), isFinancialYear("2099-00")], [true, false, false, true]);
eq("financial year: picker lists next year first", recentFinancialYears(3, new Date("2026-10-13T00:00:00Z")), ["2027-28", "2026-27", "2025-26"]);

// Approvals: dates as typed on the forms.
eq("date input: shows dd-MMM-yyyy", [isoToDisplay("2026-10-14"), isoToDisplay("2026-02-30"), isoToDisplay(""), isoToDisplay(null)], ["14-Oct-2026", "", "", ""]);
eq("date input: reads the shown format and common typed ones", [parseDisplayDate("14-Oct-2026"), parseDisplayDate("14/10/2026"), parseDisplayDate("4-oct-2026"), parseDisplayDate(" 05-12-2026 ")], ["2026-10-14", "2026-10-14", "2026-10-04", "2026-12-05"]);
eq("date input: refuses things that are not dates", [parseDisplayDate("31-Feb-2026"), parseDisplayDate("14-Foo-2026"), parseDisplayDate("2026-10-14"), parseDisplayDate("")], [null, null, null, null]);
eq("datetime input: typed text is Indian time", parseDisplayDateTime("14-Oct-2026 10:33:55")?.toISOString(), "2026-10-14T05:03:55.000Z");
eq("datetime input: seconds optional, bad times refused", [parseDisplayDateTime("14-Oct-2026 10:33")?.toISOString(), parseDisplayDateTime("14-Oct-2026 25:00"), parseDisplayDateTime("14-Oct-2026")], ["2026-10-14T05:03:00.000Z", null, null]);
eq("datetime input: shown text reads back to the same moment", parseDisplayDateTime(formatDateTime(new Date("2026-10-14T05:03:55Z")))?.toISOString(), "2026-10-14T05:03:55.000Z");
eq("datetime picker value round trip, in Indian time", [toDateTimeLocal(new Date("2026-10-14T05:03:55Z")), fromDateTimeLocal("2026-10-14T10:33")?.toISOString(), fromDateTimeLocal("nonsense")], ["2026-10-14T10:33", "2026-10-14T05:03:00.000Z", null]);
eq("today in IST: late evening UTC is already tomorrow", [todayIST(new Date("2026-10-14T20:00:00Z")), todayIST(new Date("2026-10-14T10:00:00Z"))], ["2026-10-15", "2026-10-14"]);

// Approvals: which hub card is the module, and who sees which menu item.
eq("card url: path, full address and trailing slash match", [isApprovalsUrl("/approvals"), isApprovalsUrl("https://hub.mccia.org/approvals"), isApprovalsUrl("https://hub.mccia.org/approvals/")], [true, true, true]);
eq("card url: other paths do not", [isApprovalsUrl("https://x.org/approvals/admin"), isApprovalsUrl("https://x.org/other"), isApprovalsUrl("/approvals-old")], [false, false, false]);
eq("card url: the entry pages of HR Approval and Expenditure Approval match when written without a domain, other approvals pages and other sites do not", [isApprovalsUrl("/approvals/hr/new"), isApprovalsUrl("/approvals/expenses/new"), isApprovalsUrl("https://x.org/approvals/hr/new"), isApprovalsUrl("/approvals/hr/all"), isApprovalsUrl("/approvals/hr/new/x")], [true, true, false, false, false]);
eq("apps: which application raises each kind of request (HR and large expenditure: HR Approval; a small expense: Expenditure)", [appForType("hr"), appForType("expenditure_large"), appForType("expenditure_small")], ["hr", "hr", "exp"]);
eq("menu: a form is for everyone", canSee({ label: "F", href: "/f", form: true }, ["requester"]), true);
eq("menu: any other page without a role list needs full access, which the Director General alone does not have (their menu is the Recommended Queue)", [canSee({ label: "L", href: "/l" }, ["requester"]), ...FULL_ACCESS_ROLES.map((r) => canSee({ label: "L", href: "/l" }, ["requester", r]))], [false, true, false, true, true]);
eq("menu: the DG alone is told apart from a DG who also reviews or oversees", [isDgOnly(["requester", "dg"]), isDgOnly(["requester", "dg", "approver"]), isDgOnly(["requester", "dg", "viewer"]), isDgOnly(["requester", "approver"])], [true, false, false, false]);
eq("menu: reports and budgets are not for the Director General", [canSee({ label: "R", href: "/r", roles: ["viewer", "approvals_admin"] }, ["requester", "dg"]), canSee({ label: "Q", href: "/q", roles: ["dg"] }, ["requester", "dg"])], [false, true]);
eq("menu: a section is kept for everyone (its pages decide what is left in it)", canSee({ label: "S", items: [] }, ["requester"]), true);
eq("menu: admin-only item is hidden from a requester and shown to an admin", [canSee({ label: "A", href: "/a", roles: ["approvals_admin"] }, ["requester"]), canSee({ label: "A", href: "/a", roles: ["approvals_admin"] }, ["requester", "approvals_admin"])], [false, true]);
eq("full access: a plain requester has none, each of the four roles has it", [hasFullAccess(["requester"]), ...FULL_ACCESS_ROLES.map((r) => hasFullAccess(["requester", r]))], [false, true, true, true, true]);
const pagesOf = (roles: ApprovalsRole[], app: "hr" | "exp") =>
  approvalsApps.find((a) => a.key === app)!.nav.flatMap((e) => (isGroup(e) ? e.items : [e])).filter((i) => canSee(i, roles)).map((i) => i.label);
eq("a plain requester sees the forms only: HR and Expenditure in HR Approval, Expenses in Expenditure", [pagesOf(["requester"], "hr"), pagesOf(["requester"], "exp")], [["HR", "Expenditure"], ["Expenses"]]);
eq("menu: in Expenditure an approver is offered 'Waiting for Me', an oversight role 'All Pending', and nobody gets the old 'Pending' that showed everything to everyone", [pagesOf(["requester", "approver"], "exp").includes("Waiting for Me"), pagesOf(["requester", "approver"], "exp").includes("All Pending"), pagesOf(["requester", "viewer"], "exp").includes("All Pending"), pagesOf(["requester", "viewer"], "exp").includes("Waiting for Me"), pagesOf(["requester", "approvals_admin"], "exp").includes("Pending")], [true, false, true, false, false]);
eq("screens: 'expenses/pending' is each approver's own list (only what waits for them, decided in place) and 'expenses/waiting' is the list of every pending small expense", [screenFor(["expenses", "pending"])?.waitingForMe, screenFor(["expenses", "pending"])?.quickDecide, screenFor(["expenses", "waiting"])?.waitingForMe, screenFor(["expenses", "waiting"])?.statuses, screenFor(["expenses", "waiting"])?.types], [true, true, undefined, ["pending"], ["expenditure_small"]]);
eq("full access still has the forms, and more", [FULL_ACCESS_ROLES.every((r) => pagesOf(["requester", r], "hr").includes("HR") && pagesOf(["requester", r], "exp").includes("Expenses")), pagesOf(["requester", "viewer"], "hr").length > 2], [true, true]);

// Approvals: the HR and Expenditure places under Approval System, each with Pending, Approved and Rejected.
eq("review: the path names a place and a list, and nothing else is one", [parseReviewPath(["review", "hr", "pending"]), parseReviewPath(["review", "expenditure", "rejected"]), parseReviewPath(["review", "hr"]), parseReviewPath(["review", "events", "pending"]), parseReviewPath(["review", "hr", "pending", "x"]), parseReviewPath(["hr", "pending"])], [{ key: "hr", tab: "pending" }, { key: "expenditure", tab: "rejected" }, null, null, null, null]);
eq("review: for an approver, Pending is what waits for them, with Approve and Reject on each row", [reviewScreen("hr", "pending", true).waitingForMe, reviewScreen("hr", "pending", true).quickDecide, reviewScreen("hr", "pending", true).types, reviewScreen("expenditure", "pending", true).types], [true, true, ["hr"], ["expenditure_large", "expenditure_small"]]);
eq("review: for an approver, Approved and Rejected are what they approved and what they rejected", [reviewScreen("hr", "approved", true).approvedByMe, reviewScreen("hr", "rejected", true).rejectedByMe, reviewScreen("hr", "approved", true).statuses], [true, true, undefined]);
eq("review: for someone who only oversees, the three lists are every request of that kind by its status, with no buttons", [reviewScreen("expenditure", "pending", false).statuses, reviewScreen("expenditure", "approved", false).statuses, reviewScreen("expenditure", "rejected", false).statuses, reviewScreen("expenditure", "pending", false).quickDecide ?? false, reviewScreen("expenditure", "pending", false).waitingForMe ?? false], [["pending"], ["approved"], ["rejected"], false, false]);
eq("review: a path resolves to its list, and the fixed lists still resolve", [resolveScreen(["review", "hr", "approved"], true)?.title, resolveScreen(["inbox"], true)?.title, resolveScreen(["review", "nope", "approved"], true)], ["Approved", "Recommended Queue", undefined]);

// Approvals: the form layout the Support Admin sets (names, order, hidden fields, extra fields) and the answers to the extra fields.
const row = (o: Partial<FormFieldRow> & { key: string }): FormFieldRow => ({ form: "hr", label: o.key, builtin: true, kind: "text", required: false, hidden: false, sortOrder: 0, options: [], ...o });
eq("form fields: with nothing set, every form has its own fields in the default order, none hidden", FORM_KEYS.map((f) => [mergeFields(f, []).map((x) => x.key).join(), mergeFields(f, []).some((x) => x.hidden)]), FORM_KEYS.map((f) => [BUILTIN[f].map((d) => d.key).join(), false]));
const hrSet = mergeFields("hr", [
  row({ key: "name", label: "Full name", sortOrder: 10 }), row({ key: "description", label: "Details", sortOrder: 15 }), row({ key: "email", label: "Email", sortOrder: 20, hidden: true }),
  row({ key: "category", sortOrder: 30, hidden: true }), row({ key: "c_aaaa1111", label: "Employee code", builtin: false, kind: "text", required: true, sortOrder: 1000 }),
  row({ key: "c_bbbb2222", label: "Grade", builtin: false, kind: "select", options: ["A", "B"], sortOrder: 1010, hidden: true }),
]);
eq("form fields: a built-in field can be renamed and moved, and an optional one hidden", [hrSet.slice(0, 3).map((f) => f.label), hrSet.find((f) => f.key === "email")?.hidden], [["Full name", "Details", "Email"], true]);
eq("form fields: a field the request cannot do without is never hidden, whatever is stored", hrSet.find((f) => f.key === "category")?.hidden, false);
eq("form fields: the extra fields come with their kind, whether they are required, their choices and their place", hrSet.filter((f) => !f.builtin).map((f) => [f.key, f.label, f.kind, f.required, f.options.join("|"), f.hidden]), [["c_aaaa1111", "Employee code", "text", true, "", false], ["c_bbbb2222", "Grade", "select", false, "A|B", true]]);
const answers = (given: Record<string, string>, fields: FormField[] = hrSet) => checkCustomAnswers(fields, given);
eq("form fields: a required extra field must be answered", [answers({}), answers({ c_aaaa1111: "   " })], [{ ok: false, error: '"Employee code" is required.' }, { ok: false, error: '"Employee code" is required.' }]);
eq("form fields: an answer is kept with the name the field has now, and a hidden field is not asked", answers({ c_aaaa1111: " E-42 ", c_bbbb2222: "Z" }), { ok: true, values: [{ key: "c_aaaa1111", label: "Employee code", value: "E-42" }] });
const kinds = mergeFields("hr", [
  row({ key: "c_n", label: "Count", builtin: false, kind: "number", sortOrder: 1 }), row({ key: "c_d", label: "Due", builtin: false, kind: "date", sortOrder: 2 }),
  row({ key: "c_s", label: "Grade", builtin: false, kind: "select", options: ["A", "B"], sortOrder: 3 }), row({ key: "c_t", label: "Note", builtin: false, kind: "textarea", sortOrder: 4 }),
]);
eq("form fields: a number, a date and a dropdown choice are checked, and a long text is not cut", [
  answers({ c_n: "12.5", c_d: "2026-10-31", c_s: "B", c_t: "x".repeat(4000) }, kinds).ok, answers({ c_n: "twelve" }, kinds).ok, answers({ c_d: "31/10/2026" }, kinds).ok, answers({ c_s: "C" }, kinds).ok, answers({ c_t: "x".repeat(4001) }, kinds).ok,
], [true, false, false, false, false]);

// Approvals: budget maths. Only approved spend counts; pending is shown, never subtracted.
const pos = (allocated: number | null, spent = 0, pending = 0) => ({ allocatedPaise: allocated, spentPaise: spent, pendingPaise: pending });
eq("budget: fits", assessBudget(pos(5_000_000, 1_000_000), 1_500_000), { noBudget: false, allocatedPaise: 5_000_000, availablePaise: 4_000_000, afterPaise: 2_500_000, excessPaise: 0, overBudget: false });
eq("budget: spending exactly what is left is not over budget", assessBudget(pos(1_000_000, 400_000), 600_000).overBudget, false);
eq("budget: one paisa over is over budget, by one paisa", [assessBudget(pos(1_000_000, 400_000), 600_001).overBudget, assessBudget(pos(1_000_000, 400_000), 600_001).excessPaise], [true, 1]);
eq("budget: no budget row is flagged like over budget", assessBudget(pos(null), 500), { noBudget: true, allocatedPaise: null, availablePaise: null, afterPaise: null, excessPaise: 0, overBudget: true });
eq("budget: pending requests do not reduce what is available", assessBudget(pos(1_000_000, 0, 900_000), 500_000).overBudget, false);
eq("budget: warning text", [budgetWarning(assessBudget(pos(1_000_000), 1_250_000)), budgetWarning(assessBudget(pos(1_000_000), 100)), budgetWarning(assessBudget(pos(null), 100))?.startsWith("No budget allocated")],
  ["This request exceeds the remaining budget by ₹2,500.00.", null, true]);

// Approvals: the 10,000 rule. Exactly 10,000 is "large".
eq("threshold: 9,999.99 is small, 10,000.00 is large", [formFor(999_999, 1_000_000), formFor(1_000_000, 1_000_000)], ["small", "large"]);
eq("wrong form: small form with 10,000", wrongFormMessage("small", 1_000_000, 1_000_000), "Amounts of ₹10,000 and above must be submitted through DG Expenditure Approval.");
eq("wrong form: large form with 9,999", wrongFormMessage("large", 999_900, 1_000_000), "Amounts below ₹10,000 must be submitted through the Expenses form.");
eq("wrong form: nothing to say when it fits or is empty", [wrongFormMessage("small", 999_900, 1_000_000), wrongFormMessage("large", 1_000_000, 1_000_000), wrongFormMessage("small", null, 1_000_000)], [null, null, null]);
eq("wrong form: a zero or negative amount says so, instead of passing the form", [wrongFormMessage("small", 0, 1_000_000), wrongFormMessage("large", -500, 1_000_000)], ["Please enter a valid amount greater than ₹0.", "Please enter a valid amount greater than ₹0."]);

// Approvals: who approves. A rule with nobody named is skipped; nobody approves their own request.
const rule = (stepNo: number, label: string, ids: string[], extra: Partial<RuleLike> = {}): RuleLike => ({ stepNo, stepLabel: label, minAmountPaise: 0, maxAmountPaise: null, approverUserIds: ids, active: true, ...extra });
eq("routing: an empty Reviewer step is skipped, so the DG is the only approver", planSteps([rule(1, "Reviewer", []), rule(2, "Director General", ["dg"])], "req", 100),
  { steps: [{ stepNo: 1, stepLabel: "Director General", approverUserId: "dg" }], problem: null });
eq("routing: two named steps run in order and are renumbered", planSteps([rule(2, "Director General", ["dg"]), rule(1, "Reviewer", ["rev"])], "req", 100).steps.map((s) => [s.stepNo, s.approverUserId]), [[1, "rev"], [2, "dg"]]);
eq("routing: nothing named anywhere", planSteps([rule(1, "Reviewer", []), rule(2, "Director General", [])], "req", 100), { steps: [], problem: "no-approver" });
eq("routing: no rules at all", planSteps([], "req", 100).problem, "no-approver");
eq("routing: the requester is never their own approver, the next person named is used", planSteps([rule(1, "Reviewer", ["req", "other"])], "req", 100).steps[0].approverUserId, "other");
eq("routing: a step only the requester could do is dropped, the rest stay", planSteps([rule(1, "Reviewer", ["req"]), rule(2, "Director General", ["dg"])], "req", 100).steps.map((s) => s.approverUserId), ["dg"]);
eq("routing: the requester being the only approver cannot be routed", planSteps([rule(1, "Director General", ["req"])], "req", 100), { steps: [], problem: "only-self" });
eq("routing: inactive rules are ignored", planSteps([rule(1, "Reviewer", ["a"], { active: false })], "req", 100).problem, "no-approver");
eq("routing: amount bands, min inclusive and max exclusive", [
  planSteps([rule(1, "Small", ["a"], { maxAmountPaise: 1_000_000 })], "r", 999_999).problem,
  planSteps([rule(1, "Small", ["a"], { maxAmountPaise: 1_000_000 })], "r", 1_000_000).problem,
  planSteps([rule(1, "Large", ["a"], { minAmountPaise: 1_000_000 })], "r", 1_000_000).problem,
], [null, "no-approver", null]);

// Approvals: when the first approver raises a request himself, the Director General decides it; the same person never holds two steps.
const dgEsc = { approverUserId: "dg", stepLabel: "Director General" };
eq("routing: the first approver raising a small request goes to the DG, not refused", planSteps([rule(1, "Reviewer", ["shrotri"])], "shrotri", 100, dgEsc),
  { steps: [{ stepNo: 1, stepLabel: "Director General", approverUserId: "dg" }], problem: null });
eq("routing: without a DG to hand it to, the first approver's own small request is still refused", planSteps([rule(1, "Reviewer", ["shrotri"])], "shrotri", 100).problem, "only-self");
eq("routing: the first approver raising a large request has the DG only (step 1 of 1)", planSteps([rule(1, "Reviewer", ["shrotri"]), rule(2, "Director General", ["dg"])], "shrotri", 2_000_000, dgEsc).steps.map((s) => [s.stepNo, s.approverUserId]), [[1, "dg"]]);
eq("routing: the DG being the one who raised it is not handed to themselves, and the reason names it", [planSteps([rule(1, "Reviewer", ["dg"])], "dg", 100, dgEsc).problem, planProblemMessage("requester-is-dg").startsWith("You are the Director General and also the requester")], ["requester-is-dg", true]);
eq("routing: a first approver on their own, with a DG who is somebody else named, is handed on; with nobody to hand to it stays only-self", [planSteps([rule(1, "Reviewer", ["shrotri"])], "shrotri", 100, dgEsc).problem, planSteps([rule(1, "Reviewer", ["shrotri"])], "shrotri", 100).problem], [null, "only-self"]);
eq("routing: nobody named still says so, the DG is not invented", planSteps([rule(1, "Reviewer", [])], "shrotri", 100, dgEsc).problem, "no-approver");
eq("routing: the same person on two steps is refused", planSteps([rule(1, "Reviewer", ["a"]), rule(2, "Director General", ["a"])], "req", 100).problem, "same-approver");
eq("routing: two different people on two steps are fine", planSteps([rule(1, "Reviewer", ["a"]), rule(2, "Director General", ["b"])], "req", 100).problem, null);
const typed = (requestType: string, r: RuleLike) => ({ ...r, requestType });
eq("escalation: the DG is the last staffed step of the large expenditure rules", escalationApprover([typed("hr", rule(2, "Director General", ["hrdg"])), typed("expenditure_large", rule(1, "Reviewer", ["shrotri"])), typed("expenditure_large", rule(2, "Director General", ["dg"]))]), { approverUserId: "dg", stepLabel: "Director General" });
eq("escalation: with no large expenditure DG the HR one is used, and with none at all there is none", [escalationApprover([typed("hr", rule(2, "Director General", ["hrdg"]))])?.approverUserId, escalationApprover([typed("expenditure_large", rule(1, "Reviewer", ["a"]))])], ["hrdg", null]);

// Approvals: decisions, utilisation, numbers.
eq("comment: needed to reject, and to approve over budget", [commentRequired("reject", false), commentRequired("approve", true), commentRequired("approve", false)], [true, true, false]);
eq("comment: always needed to return a request for corrections", [commentRequired("return", false), commentRequired("return", true)], [true, true]);
eq("status: a returned request has a label", STATUS_LABEL.returned, "Returned");
eq("decisions: a step before the last recommends to the next approver, the last of several decides finally, a lone step just approves", [decisionMode(1, 2), decisionMode(2, 2), decisionMode(1, 1), decisionMode(1, 3), decisionMode(3, 3)], ["recommend", "final", "single", "recommend", "final"]);
eq("decisions: the buttons say what they do", [MODE_WORDS.recommend.approve, MODE_WORDS.final.approve, MODE_WORDS.final.reject, MODE_WORDS.single.approve, MODE_WORDS.single.reject], ["Recommend to DG", "Final approve", "Final reject", "Approve", "Reject"]);
eq("utilisation: percent and colours", [percentUsed(1000, 905), percentUsed(1000, 1000), percentUsed(1000, 1010), percentUsed(null, 5), percentUsed(0, 5), percentUsed(0, 0)], [91, 100, 101, null, 100, 0]);
eq("utilisation: above 90 is amber, above 100 is red", [utilisationLevel(90), utilisationLevel(91), utilisationLevel(100), utilisationLevel(101), utilisationLevel(null)], ["ok", "warn", "warn", "over", "ok"]);
eq("request number", [formatRequestNo("HR", "2026-27", 1), formatRequestNo("EXB", "2026-27", 123), formatRequestNo("EXP", "2027-28", 12345)], ["HR-2026-27-0001", "EXB-2026-27-0123", "EXP-2027-28-12345"]);

// Approvals: file rules.
eq("files: allowed and refused extensions", ["a.PDF", "b.jpeg", "c.docx", "d.xlsx", "e.exe", "f", "g.pdf.exe", "h.html"].map(isAllowedFileName), [true, true, true, true, false, false, false, false]);
eq("files: type comes from the extension", [mimeFor("a.pdf"), mimeFor("b.PNG"), mimeFor("c.exe")], ["application/pdf", "image/png", "application/octet-stream"]);
eq("files: names lose path and header characters", safeFileName('..\\x/"evil"\n.pdf'), "..xevil.pdf");
eq("files: size limit and extension are checked on upload start", [fileUploadStart.safeParse({ fileName: "a.pdf", size: 10 * 1024 * 1024 }).success, fileUploadStart.safeParse({ fileName: "a.pdf", size: 10 * 1024 * 1024 + 1 }).success, fileUploadStart.safeParse({ fileName: "a.exe", size: 5 }).success, fileUploadStart.safeParse({ fileName: "a.pdf", size: 0 }).success], [true, false, false, false]);

// Approvals: what each form accepts.
const uid = "6f9619ff-8b86-4011-b42d-00c04fc964ff";
const hrOk = { firstName: " Asha ", lastName: "Patil", hrCategoryId: uid };
eq("hr form: minimum fields pass and are trimmed", (() => { const r = hrRequestInput.safeParse(hrOk); return r.success ? [r.data.firstName, r.data.email, r.data.amountPaise, r.data.description] : r.error.issues[0].message; })(), ["Asha", null, null, null]);
eq("hr form: name and category are required, email must be valid, amount must be positive", [hrRequestInput.safeParse({ ...hrOk, firstName: " " }).success, hrRequestInput.safeParse({ ...hrOk, hrCategoryId: "x" }).success, hrRequestInput.safeParse({ ...hrOk, email: "nope" }).success, hrRequestInput.safeParse({ ...hrOk, amountPaise: 0 }).success, hrRequestInput.safeParse({ ...hrOk, amountPaise: 12.5 }).success], [false, false, false, false, false]);
eq("hr form: a blank email is fine", hrRequestInput.safeParse({ ...hrOk, email: "" }).success, true);
const lg = { employeeUserId: uid, categoryId: uid, branchId: uid, amountPaise: 1_500_000 };
eq("large form: minimum fields pass, amount is required", [largeExpenditureInput.safeParse(lg).success, largeExpenditureInput.safeParse({ ...lg, amountPaise: undefined }).success], [true, false]);
const sm = { ...lg, amountPaise: 500_000, email: "a@b.org", vendorName: "Vendor" };
eq("small form: vendor name and email are required", [smallExpenditureInput.safeParse(sm).success, smallExpenditureInput.safeParse({ ...sm, vendorName: "" }).success, smallExpenditureInput.safeParse({ ...sm, email: "" }).success], [true, false, false]);
eq("dates: the request date cannot be in the future, an ordinary past one is fine", [
  largeExpenditureInput.safeParse({ ...lg, requestedAt: new Date(Date.now() + 3 * 86400000).toISOString() }).success,
  largeExpenditureInput.safeParse({ ...lg, requestedAt: new Date(Date.now() - 86400000).toISOString() }).success,
], [false, true]);
eq("decision: only approve or reject", [decisionInput.safeParse({ action: "approve" }).success, decisionInput.safeParse({ action: "maybe" }).success], [true, false]);

// Approvals is on unless it is switched off on purpose.
eq("module setting: unset, empty and true all mean on", [isModuleEnabled(undefined), isModuleEnabled(""), isModuleEnabled("  "), isModuleEnabled("true"), isModuleEnabled("TRUE"), isModuleEnabled("1")], [true, true, true, true, true, true]);
eq("module setting: false, 0, off and no switch it off (any case, spaces ignored)", [isModuleEnabled("false"), isModuleEnabled(" False "), isModuleEnabled("0"), isModuleEnabled("off"), isModuleEnabled("NO")], [false, false, false, false, false]);

// ---------------------------------------------------------------------------------------------------------------------------------
// Users & Access: who may do what (src/lib/rbac.ts is the single source of truth)
const ADMIN: Actor = { id: "a", role: "head_admin", teamId: null };
const TM: Actor = { id: "m", role: "dept_lead", teamId: "t1" };
const TM_NOTEAM: Actor = { id: "m2", role: "dept_lead", teamId: null };
const USER: Actor = { id: "u", role: "member", teamId: "t1" };
const person = (o: Partial<Target> & { id: string }): Target => ({ role: "member", teamId: null, reportingManagerId: null, ...o });
eq("rbac: the super administrator may manage anyone", [canManageAccess(ADMIN, person({ id: "x" })), canManageAccess(ADMIN, person({ id: "y", role: "dept_lead" }))], [true, true]);
eq("rbac: a plain user may manage no one, not even in their own team", [canManageAccess(USER, person({ id: "x", teamId: "t1" })), isStaff(USER)], [false, false]);
eq("rbac: a team manager reaches people in their team and people reporting to them", [
  canManageAccess(TM, person({ id: "x", teamId: "t1" })), canManageAccess(TM, person({ id: "y", reportingManagerId: "m" })),
], [true, true]);
eq("rbac: a team manager does not reach other teams, themselves, other managers or administrators", [
  canManageAccess(TM, person({ id: "x", teamId: "t2" })), canManageAccess(TM, person({ id: "m", teamId: "t1" })),
  canManageAccess(TM, person({ id: "y", teamId: "t1", role: "dept_lead" })), canManageAccess(TM, person({ id: "z", teamId: "t1", role: "head_admin" })),
], [false, false, false, false]);
eq("rbac: a team manager with no team reaches only their direct reports (a missing team never matches everyone)", [
  canManageAccess(TM_NOTEAM, person({ id: "x", teamId: null })), canManageAccess(TM_NOTEAM, person({ id: "y", reportingManagerId: "m2" })),
], [false, true]);
eq("rbac: viewing a profile is managing, plus your own", [canViewPerson(USER, person({ id: "u" })), canViewPerson(USER, person({ id: "x" })), canViewPerson(TM, person({ id: "x", teamId: "t1" }))], [true, false, true]);
eq("rbac: only the super administrator changes roles, never their own and never a head admin's", [
  canChangeRole(ADMIN, { id: "x", role: "member" }), canChangeRole(ADMIN, { id: "a", role: "head_admin" }), canChangeRole(ADMIN, { id: "h", role: "head_admin" }), canChangeRole(TM, { id: "x", role: "member" }),
], [true, false, false, false]);
eq("rbac: only the super administrator deactivates, and not themselves", [canDeactivate(ADMIN, { id: "x", role: "member" }), canDeactivate(ADMIN, { id: "a", role: "head_admin" }), canDeactivate(TM, { id: "x", role: "member" })], [true, false, false]);
eq("rbac: head_admin can never be assigned through the screens", [...ASSIGNABLE_ROLES], ["member", "dept_lead"]);
eq("rbac: the screens show buttons from one capabilities() answer: everything for the super administrator, only assigning for a team manager, nothing for a user", [
  Object.values(capabilities(ADMIN)).every(Boolean), Object.entries(capabilities(TM)).filter(([, v]) => v).map(([k]) => k), Object.values(capabilities(USER)).some(Boolean),
], [true, ["assign"], false]);
// The new roles: the Super Admin (the DG), the Support Admin (head_admin) and an Admin with areas switched on one by one.
const SUPER: Actor = { id: "s", role: "super_admin", teamId: null };
const adminWith = (...areas: string[]): Actor => ({ id: "ad", role: "admin", teamId: null, adminAreas: areas });
const A_PEOPLE = adminWith("people"), A_NONE = adminWith(), A_AUDIT = adminWith("audit"), A_IMPORT = adminWith("import");
const mk = (role: Target["role"], id = "x"): Target => person({ id, role });
eq("rbac: the Super Admin (the DG) is an ordinary user in the hub: no reach over people, access, import or organisation, and no Administrator", [
  canManageAccess(SUPER, mk("member")), canManageAccess(SUPER, mk("admin")), canImportUsers(SUPER), canDeactivate(SUPER, { id: "x", role: "member" }), canEditPerson(SUPER, mk("admin")),
  hasArea(SUPER, "audit"), hasArea(SUPER, "apps"), canAdminister(SUPER), isStaff(SUPER), Object.values(capabilities(SUPER)).some(Boolean),
], [false, false, false, false, false, false, false, false, false, false]);
eq("rbac: only the Support Admin manages people, roles and access: the Support Admin reaches everyone, including the Super Admin", [
  canManageAccess(ADMIN, mk("super_admin")), canEditPerson(ADMIN, mk("super_admin")), canChangeRole(ADMIN, { id: "x", role: "super_admin" }), canAdminister(ADMIN),
], [true, true, true, true]);
eq("rbac: only the Support Admin changes roles: not the Super Admin, not an Admin, never their own, never a Support Admin's", [
  canChangeRole(ADMIN, { id: "x", role: "member" }), canChangeRole(ADMIN, { id: "x", role: "admin" }), canChangeRole(ADMIN, { id: "x", role: "super_admin" }),
  canChangeRole(SUPER, { id: "x", role: "member" }), canChangeRole(A_PEOPLE, { id: "x", role: "member" }), canChangeRole(ADMIN, { id: "a", role: "head_admin" }), canChangeRole(ADMIN, { id: "h", role: "head_admin" }),
], [true, true, true, false, false, false, false]);
eq("rbac: the Super Admin is a main admin: nobody deactivates them (change their role first), but everyone else can still be deactivated by the top roles", [canDeactivate(ADMIN, { id: "x", role: "super_admin" }), canDeactivate(SUPER, { id: "x", role: "super_admin" }), canDeactivate(ADMIN, { id: "x", role: "admin" }), canDeactivate(ADMIN, { id: "x", role: "member" })], [false, false, true, true]);
eq("rbac: an Admin with nothing switched on can do nothing and cannot even open Administrator", [
  canAdminister(A_NONE), isStaff(A_NONE), canManageAccess(A_NONE, mk("member")), canImportUsers(A_NONE), Object.values(capabilities(A_NONE)).some(Boolean),
], [false, false, false, false, false]);
eq("rbac: an Admin can open Administrator as soon as one area is on, and has exactly that area", [
  canAdminister(A_AUDIT), hasArea(A_AUDIT, "audit"), hasArea(A_AUDIT, "people"), hasArea(A_AUDIT, "apps"), Object.entries(capabilities(A_AUDIT)).filter(([, v]) => v).map(([k]) => k),
], [true, true, false, false, ["viewAudit"]]);
eq("rbac: an Admin with Users & access reaches plain users and Team managers, never another Admin, the Super Admin or the Support Admin, and not themselves", [
  canManageAccess(A_PEOPLE, mk("member")), canManageAccess(A_PEOPLE, mk("dept_lead")), canManageAccess(A_PEOPLE, mk("admin")), canManageAccess(A_PEOPLE, mk("super_admin")),
  canManageAccess(A_PEOPLE, mk("head_admin")), canManageAccess(A_PEOPLE, mk("member", "ad")),
], [true, true, false, false, false, false]);
eq("rbac: an Admin can edit, deactivate and send links to plain users only, and never delete anyone", [
  canEditPerson(A_PEOPLE, mk("member")), canEditPerson(A_PEOPLE, mk("admin")), canEditPerson(A_PEOPLE, mk("super_admin")), canEditPerson(A_PEOPLE, mk("head_admin")),
  canDeactivate(A_PEOPLE, { id: "x", role: "member" }), canDeactivate(A_PEOPLE, { id: "x", role: "admin" }), canDeactivate(A_PEOPLE, { id: "x", role: "head_admin" }), canDeactivate(A_PEOPLE, { id: "ad", role: "member" }),
  capabilities(A_PEOPLE).remove, capabilities(A_PEOPLE).changeRole,
], [true, false, false, false, true, false, false, false, false, false]);
eq("rbac: without Users & access an Admin edits nobody, even with other areas on", [canEditPerson(A_AUDIT, mk("member")), canManageAccess(A_AUDIT, mk("member")), canDeactivate(A_IMPORT, { id: "x", role: "member" })], [false, false, false]);
eq("rbac: bulk add needs its own area", [canImportUsers(A_IMPORT), canImportUsers(A_PEOPLE), canImportUsers(A_NONE)], [true, false, false]);
eq("rbac: an import may update plain users for an Admin with Bulk add, anyone for the top roles, and nothing without the area", [canUpdateByImport(A_IMPORT, mk("member")), canUpdateByImport(A_IMPORT, mk("admin")), canUpdateByImport(A_IMPORT, mk("super_admin")), canUpdateByImport(A_PEOPLE, mk("member")), canUpdateByImport(ADMIN, mk("admin")), canUpdateByImport(ADMIN, mk("super_admin"))], [true, false, false, false, true, true]);
eq("rbac: an Admin with Users & access may hand out any application, one without may hand out none", [grantableApps(A_PEOPLE, new Set(["app1"])), [...(grantableApps(A_NONE, new Set(["app1"])) ?? ["x"])]], [null, []]);
eq("rbac: Admin and Super Admin can be given through the screens, only by the Support Admin (and the Support Admin role never)", [[...PROMOTABLE_ROLES], [...ASSIGNABLE_ROLES].includes("head_admin" as never)], [["admin", "super_admin"], false]);
eq("rbac: the areas an Admin can be given", [...ADMIN_AREAS], ["people", "import", "org", "apps", "audit", "activity"]);
eq("rbac: a plain user and a Team manager never open Administrator", [canAdminister(USER), canAdminister(TM)], [false, false]);
eq("tabs: the Support Admin sees every tab: Dashboard, Users, Approval Forms, Notification Panel and Activity Log", adminTabsFor(ADMIN).map((t) => t.label),
  ["Dashboard", "Users", "Approval Forms", "Notification Panel", "Activity Log"]);
eq("tabs: an Admin sees the Dashboard, the Notification Panel and only the tabs of the areas switched on, never Approval Forms", [adminTabsFor(A_NONE).map((t) => t.label), adminTabsFor(adminWith("people")).map((t) => t.label), adminTabsFor(adminWith("apps", "activity")).map((t) => t.label)],
  [["Dashboard", "Notification Panel"], ["Dashboard", "Users", "Notification Panel"], ["Dashboard", "Notification Panel", "Activity Log"]]);
eq("tabs: Users opens on the first page of it the Admin may use", [adminTabsFor(A_IMPORT).find((t) => t.label === "Users")?.href, adminTabsFor(A_AUDIT).find((t) => t.label === "Users")?.href, adminTabsFor(adminWith("org")).find((t) => t.label === "Users")?.href],
  ["/administrator/users/import", "/administrator/users/audit", "/administrator/users/org"]);
const own = new Set(["app1", "app2"]);
eq("rbac: a team manager can hand out only the applications they hold", [
  grantableApps(ADMIN, own), firstUngrantable(grantableApps(TM, own), ["app1", "app2"]), firstUngrantable(grantableApps(TM, own), ["app1", "app9"]), firstUngrantable(grantableApps(USER, own), ["app1"]),
], [null, null, "app9", "app1"]);
const mgr: Record<string, string | null> = { b: "a", c: "b", d: "c" }; // a <- b <- c <- d (d reports to c, ...)
eq("rbac: a reporting line may not loop", [
  wouldCreateCycle("a", "d", (id) => mgr[id]), wouldCreateCycle("a", "a", (id) => mgr[id]), wouldCreateCycle("d", "a", (id) => mgr[id]), wouldCreateCycle("x", null, (id) => mgr[id]),
], [true, true, false, false]);
eq("rbac: a loop that already exists above is refused rather than extended", wouldCreateCycle("z", "p", (id) => ({ p: "q", q: "p" })[id]), true);

// Account status shown in the directory
eq("status: inactive wins, no password means pending, the environment admin is active without one", [
  accountStatus({ isActive: false, hasPassword: true, passwordInSettings: false }), accountStatus({ isActive: true, hasPassword: false, passwordInSettings: false }),
  accountStatus({ isActive: true, hasPassword: true, passwordInSettings: false }), accountStatus({ isActive: true, hasPassword: false, passwordInSettings: true }),
], ["inactive", "pending", "active", "active"]);

// The audit log never keeps a secret
eq("audit: keys that look like secrets are dropped at any depth", scrub({ a: 1, password: "x", nested: { token: "t", ok: "y", list: [{ passwordHash: "h", n: 1 }] }, setupLink: "https://x/set-password?token=abc" }), { a: 1, nested: { ok: "y", list: [{ n: 1 }] } });

// Bulk import: reading the table
const T = (rows: string[][]) => tableToRows(rows);
eq("import: columns are found by their usual names, in any order, and rows are numbered from 1", (() => {
  const r = T([["E-mail Address", "Full Name", "Branch", "Manager"], ["a@x.org", "Asha", "Pune", "m@x.org"]]);
  return r.rows.length === 0 ? r.problem : [r.rows[0].row, r.rows[0].name, r.rows[0].email, r.rows[0].branch, r.rows[0].manager];
})(), [1, "Asha", "a@x.org", "Pune", "m@x.org"]);
eq("import: a department column is not an import column any more: it is reported as ignored", T([["name", "email", "Department"], ["Asha", "a@x.org", "Finance"]]).ignoredColumns, ["Department"]);
eq("import: a password column is refused outright, whatever it is called", ["password", "Initial Password", "pwd"].map((h) => !!T([["name", "email", h], ["A", "a@x.org", "secret-1"]]).problem), [true, true, true]);
eq("import: name and email columns are required", [!!T([["name"], ["A"]]).problem, !!T([["email"], ["a@x.org"]]).problem, !!T([["name", "email"]]).problem], [true, true, true]);
eq("import: notes starting with # and blank rows are skipped, emails are lower-cased and cells trimmed", (() => {
  const r = T([["# a note"], ["name", "email"], ["", ""], ["  Asha ", " A@X.ORG "]]);
  return r.rows.map((x) => [x.row, x.name, x.email]);
})(), [[1, "Asha", "a@x.org"]]);
eq("import: unknown columns are reported as ignored, not silently used", T([["name", "email", "favourite colour"], ["A", "a@x.org", "red"]]).ignoredColumns, ["favourite colour"]);
eq("import: more than the limit is refused", !!T([["name", "email"], ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => [`P${i}`, `p${i}@x.org`])]).problem, true);
eq("import: the template parses to the header only (its notes and example are comments), so uploading it unchanged adds no one", (() => {
  const t = tableToRows(parseCsv(TEMPLATE_CSV));
  return [t.rows.length, t.problem?.startsWith("The file needs") ?? false];
})(), [0, true]);
eq("import: the template lists every column and warns against passwords", [COLUMNS.every((c) => TEMPLATE_CSV.includes(c)), /Do NOT add a password column/.test(TEMPLATE_CSV)], [true, true]);

// Bulk import: a real Excel file (written by openpyxl), including a note row, an empty row, a symbol-laden name and a number cell
const people = tableToRows(xlsxToTable(new Uint8Array(readFileSync(new URL("./fixtures/people.xlsx", import.meta.url)))));
eq("xlsx: the first sheet is read, in order, with notes and empty rows skipped", people.rows.map((r) => [r.row, r.name, r.email]), [[1, "Asha Patil", "asha@example.com"], [2, "Ravi & Sons <Test>", "ravi@example.com"], [3, "Meera Joshi", "meera@example.com"]]);
eq("xlsx: columns by their friendly names, empty cells empty, numbers kept as text", [people.rows[0].branch, people.rows[0].manager, people.rows[0].applications, people.rows[1].role, people.rows[1].branch, people.rows[2].designation], ["Pune", "boss@example.com", "Tally, CRM", "Team manager", "", "12345"]);
eq("xlsx: a password column in a spreadsheet is refused just the same", !!tableToRows(xlsxToTable(new Uint8Array(readFileSync(new URL("./fixtures/with-password.xlsx", import.meta.url))))).problem, true);
const bomb = zipSync({ "xl/worksheets/sheet1.xml": new Uint8Array(40_000_000) }); // 40 MB of zeros squeezes to a few kilobytes
const bombStarted = Date.now();
eq("xlsx: a part that would unpack to more than the limit is skipped, not inflated (a zip bomb costs nothing)", [(() => { try { xlsxToTable(bomb); return "no error"; } catch (e) { return (e as Error).message; } })(), Date.now() - bombStarted < 3000], ["That Excel file has no readable sheet.", true]);
eq("xlsx: entities, inline strings, shared strings with formatting runs, and sparse cells are read correctly", xlsxToTable(zipSync({
  "xl/worksheets/sheet1.xml": strToU8('<worksheet><sheetData><row r="2"><c r="A2" t="inlineStr"><is><t>a &amp; b</t></is></c><c r="C2" t="s"><v>0</v></c></row></sheetData></worksheet>'),
  "xl/sharedStrings.xml": strToU8('<sst><si><r><t>x</t></r><r><t> y</t></r></si></sst>'),
})), [[], ["a & b", "", "x y"]]);
eq("xlsx: a file that is not a spreadsheet gives a plain-language error", (() => { try { xlsxToTable(new Uint8Array([1, 2, 3, 4])); return "no error"; } catch (e) { return (e as Error).message; } })(), "That does not look like a valid Excel (.xlsx) file.");

// Every server action must prove who is asking. This reads the source of src/actions/*.ts, so an action added later without a guard fails here.
const SELF_CHECKING = new Set(["login", "logout", "unlockAdmin", "lockAdmin", "changePassword", "finishSetup", "markNotificationRead", "markAllNotificationsRead"]); // sign-in itself, the person's own password, the one-time link page, and a person marking their own notifications read
const actionsDir = new URL("../src/actions/", import.meta.url);
const unguarded: string[] = [];
let actionCount = 0;
for (const file of readdirSync(actionsDir).filter((f) => f.endsWith(".ts"))) {
  const parts = readFileSync(new URL(file, actionsDir), "utf8").split(/^export async function /m).slice(1);
  for (const part of parts) {
    actionCount++;
    const name = /^(\w+)/.exec(part)?.[1] ?? "?";
    if (!/\b(adminAction|staffAction)\(/.test(part) && !SELF_CHECKING.has(name)) unguarded.push(`${file}:${name}`);
  }
}
eq(`guards: every one of the ${actionCount} server actions goes through adminAction or staffAction (or is on the short, reviewed list that checks for itself)`, unguarded, []);
eq("guards: the reviewed list holds only actions that really exist", [...SELF_CHECKING].filter((n) => !readdirSync(actionsDir).some((f) => readFileSync(new URL(f, actionsDir), "utf8").includes(`export async function ${n}(`))), []);

// The same for plain route handlers (downloads, the launch route): each must check the session or the administrator itself. The Approval System's
// routes go through its own route() wrapper, which does it centrally, so they are covered by its own tests.
const appDir = new URL("../src/app/", import.meta.url);
const routeFiles = (readdirSync(appDir, { recursive: true }) as string[]).filter((f) => /(^|\/)route\.ts$/.test(f) && !/^(api\/approvals|approvals)\//.test(f));
const openRoutes = routeFiles.filter((f) => !/\b(assertHeadAdmin|assertArea|getCurrentUser|requireUser|requireHeadAdmin|requireArea|requireAdministrator)\(/.test(readFileSync(new URL(f, appDir), "utf8")));
eq(`guards: all ${routeFiles.length} route handlers outside the Approval System check who is asking`, openRoutes, []);

// The application check must never be steered at an internal network
eq("net guard: private, loopback, metadata and reserved IPv4 are refused", ["127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255"].map(isPublicAddress), Array(10).fill(false));
eq("net guard: ordinary public IPv4 is allowed, including just outside the private ranges", ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "192.169.0.1", "100.63.0.1"].map(isPublicAddress), Array(6).fill(true));
eq("net guard: IPv6 loopback, unique-local, link-local, multicast and mapped private addresses are refused", ["::1", "::", "fd00::1", "fc00::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:7f00:1"].map(isPublicAddress), Array(9).fill(false));
eq("net guard: public IPv6 and a mapped public IPv4 are allowed, and anything that is not an address is refused", [isPublicAddress("2606:4700:4700::1111"), isPublicAddress("::ffff:8.8.8.8"), isPublicAddress("localhost"), isPublicAddress("evil.example.com"), isPublicAddress("")], [true, true, false, false, false]);

console.log(`\n${ok}/${ok + bad} unit checks passed`);
process.exit(bad ? 1 : 0);
