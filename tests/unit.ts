/** Fast checks for the pure helpers: CSV parsing/exporting, the email-domain rule and the Approvals money, date and menu rules. Run: npm run test:unit */
import { readdirSync, readFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";
import { parseCsv, toCsv } from "../src/lib/csv";
import { accountStatus } from "../src/lib/account-status";
import { COLUMNS, MAX_IMPORT_ROWS, TEMPLATE_CSV, tableToRows } from "../src/lib/import-parse";
import {
  ADMIN_AREAS, ASSIGNABLE_ROLES, PROMOTABLE_ROLES, SINGLE_HOLDER_ROLES, canAdminister, canChangeRole, canDeactivate, canEditPerson, canImportUsers, canManageAccess, canUpdateByImport, canViewPerson, capabilities,
  firstUngrantable, grantableApps, hasArea, isStaff, wouldCreateCycle,
  type Actor, type Target,
} from "../src/lib/rbac";
import { isPublicAddress } from "../src/lib/net-guard";
import { clientIp } from "../src/lib/ip";
import { isAdminPath } from "../src/lib/admin-paths";
import { errorSummary } from "../src/lib/log-error";
import { siteUrl } from "../src/lib/site-url";
import { WINDOW_MS as SIR_WINDOW, refusedUntil as sirRefusedUntil, slowDownMs as sirSlowDownMs } from "../src/lib/sign-in-rules";
import { adminTabsFor } from "../src/lib/admin-tabs";
import { scrub } from "../src/lib/scrub";
import { xlsxToTable } from "../src/lib/xlsx-read";
import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { SSO_ISSUER, SSO_KID, SsoConfigError, buildClaims, loadSigningKey, signSsoToken, verifySsoToken } from "../src/lib/sso";
import { SSO_ROLES, callbackProblem, slugProblem, ssoTokenRole } from "../src/lib/sso-rules";
import { autoPostHtml, launchHeaders, messageHtml } from "../src/lib/sso-page";
import { appInput } from "../src/lib/validation";
import { safeNext } from "../src/lib/session";
import { isEmailAllowed } from "../src/lib/domains";
import {
  FULL_ACCESS_ROLES, approvalsApps, appForType, canSee, parseRecommendationPath, parseReviewPath, reviewHref, hasFullAccess, isApprovalsUrl, isGroup, isModuleEnabled, isDgOnly, type ApprovalsRole } from "../src/lib/approvals/approvals.manifest";
import { recommendationScreen, resolveScreen, reviewScreen, screenFor } from "../src/lib/approvals/screens";
import { BUILTIN, FORM_KEYS, checkCustomAnswers, mergeFields, type FormField, type FormFieldRow } from "../src/lib/approvals/form-fields";
import { INVENTORY_URL_PATTERN, inventoryRoleFor, navFor } from "../src/lib/inventory/inventory.manifest";
import { CABS_ADMIN_URL_PATTERN, CABS_DRIVER_URL_PATTERN, CABS_USER_URL_PATTERN, CAB_NAV, cabRolesFor, navFor as cabNavFor } from "../src/lib/cabs/cabs.manifest";
import { assignInput, costInput, driverInput, fuelInput, invoiceInput, istLocalToDate, locationInput, maintenanceInput, otpInput, rideInput, rupeesToPaise as cabRupees, scheduleProblem, vehicleInput } from "../src/lib/cabs/validation";
import { OTP_MAX_ATTEMPTS, mapsLink, otpExpiry } from "../src/lib/cabs/otp-rules";
import { DRIVER_SESSION_HOURS, LOGIN_MAX_ATTEMPTS, LOGIN_OTP_HOURS, driverLoginInput, loginPhone, pickDriver } from "../src/lib/cabs/driver-login-rules";
import { MCCIA_OFFICES, officeText, officesFor } from "../src/components/cabs/offices";
import { issueInput, poInput, receiveInput, ticketInput, ticketUpdate, requestDecision, requestInput, returnInput, rupeesToPaise, transferInput, vendorInput } from "../src/lib/inventory/validation";
import { financialYear, nextPoNo, poPrefix } from "../src/lib/inventory/po-number";
import { MAX_PHOTO_BYTES, checkPhoto, sniffPhoto } from "../src/lib/inventory/photos";
import {
  commentRequired, decisionMode, escalationApprover, MODE_WORDS, formFor, formatRequestNo, planProblemMessage, planSteps, STATUS_LABEL, wrongFormMessage,
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
eq("a plain requester sees the forms and their own Approved Forms: HR, Expenditure and Approved Forms in HR Approval, Expenses in Expenditure", [pagesOf(["requester"], "hr"), pagesOf(["requester"], "exp")], [["HR", "Expenditure", "Approved Forms"], ["Expenses"]]);
eq("menu: in Expenditure an approver is offered 'Waiting for Me', an oversight role 'All Pending', and nobody gets the old 'Pending' that showed everything to everyone", [pagesOf(["requester", "approver"], "exp").includes("Waiting for Me"), pagesOf(["requester", "approver"], "exp").includes("All Pending"), pagesOf(["requester", "viewer"], "exp").includes("All Pending"), pagesOf(["requester", "viewer"], "exp").includes("Waiting for Me"), pagesOf(["requester", "approvals_admin"], "exp").includes("Pending")], [true, false, true, false, false]);
eq("screens: 'expenses/pending' is each approver's own list (only what waits for them, decided in place) and 'expenses/waiting' is the list of every pending small expense", [screenFor(["expenses", "pending"])?.waitingForMe, screenFor(["expenses", "pending"])?.quickDecide, screenFor(["expenses", "waiting"])?.waitingForMe, screenFor(["expenses", "waiting"])?.statuses, screenFor(["expenses", "waiting"])?.types], [true, true, undefined, ["pending"], ["expenditure_small"]]);
eq("full access still has the forms, and more", [FULL_ACCESS_ROLES.every((r) => pagesOf(["requester", r], "hr").includes("HR") && pagesOf(["requester", r], "exp").includes("Expenses")), pagesOf(["requester", "viewer"], "hr").length > 2], [true, true]);

// Approvals: the HR and Expenditure places under Approval System, each with Pending, Approved and Rejected.
eq("review: the path names a place and a list, and nothing else is one", [parseReviewPath(["review", "hr", "pending"]), parseReviewPath(["review", "expenditure", "rejected"]), parseReviewPath(["review", "hr"]), parseReviewPath(["review", "events", "pending"]), parseReviewPath(["review", "hr", "pending", "x"]), parseReviewPath(["hr", "pending"])], [{ key: "hr", tab: "pending" }, { key: "expenditure", tab: "rejected" }, null, null, null, null]);
eq("review: for an approver, Pending is what waits for them, with Approve and Reject on each row", [reviewScreen("hr", "pending", true).waitingForMe, reviewScreen("hr", "pending", true).quickDecide, reviewScreen("hr", "pending", true).types, reviewScreen("expenditure", "pending", true).types], [true, true, ["hr"], ["expenditure_large", "expenditure_small"]]);
eq("review: for an approver, Approved and Rejected are what they approved and what they rejected", [reviewScreen("hr", "approved", true).approvedByMe, reviewScreen("hr", "rejected", true).rejectedByMe, reviewScreen("hr", "approved", true).statuses], [true, true, undefined]);
eq("review: for someone who only oversees, the three lists are every request of that kind by its status, with no buttons", [reviewScreen("expenditure", "pending", false).statuses, reviewScreen("expenditure", "approved", false).statuses, reviewScreen("expenditure", "rejected", false).statuses, reviewScreen("expenditure", "pending", false).quickDecide ?? false, reviewScreen("expenditure", "pending", false).waitingForMe ?? false], [["pending"], ["approved"], ["rejected"], false, false]);
eq("review: a path resolves to its list, and the fixed lists still resolve", [resolveScreen(["review", "hr", "approved"], true)?.title, resolveScreen(["inbox"], true)?.title, resolveScreen(["review", "nope", "approved"], true)], ["Approved", "Recommended Queue", undefined]);

eq("review: the Director General's Recommended place has a tab each for HR and Expenditure, and nothing else is one", [parseRecommendationPath(["review", "recommendation", "hr"]), parseRecommendationPath(["review", "recommendation", "expenditure"]), parseRecommendationPath(["review", "recommendation"]), parseRecommendationPath(["review", "recommendation", "events"]), parseRecommendationPath(["review", "hr", "pending"])], ["hr", "expenditure", null, null, null]);
eq("review: what was recommended to the DG is everything that reached their step, with the buttons on what waits", [recommendationScreen("hr").reachedMe, recommendationScreen("hr").quickDecide, recommendationScreen("hr").statuses, recommendationScreen("hr").types, recommendationScreen("expenditure").types, resolveScreen(["review", "recommendation", "expenditure"], true)?.reachedMe], [true, true, undefined, ["hr"], ["expenditure_large", "expenditure_small"], true]);
eq("review: where each place opens", [reviewHref("hr"), reviewHref("expenditure"), reviewHref("recommendation")], ["/approvals/review/hr/pending", "/approvals/review/expenditure/pending", "/approvals/review/recommendation/hr"]);
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
eq("routing: the DG being the one who raised it is not handed to themselves, and the reason names it", [planSteps([rule(1, "Reviewer", ["dg"])], "dg", 100, dgEsc).problem, planProblemMessage("requester-is-dg").startsWith("You are the Super Admin and also the requester")], ["requester-is-dg", true]);
eq("routing: a first approver on their own, with a DG who is somebody else named, is handed on; with nobody to hand to it stays only-self", [planSteps([rule(1, "Reviewer", ["shrotri"])], "shrotri", 100, dgEsc).problem, planSteps([rule(1, "Reviewer", ["shrotri"])], "shrotri", 100).problem], [null, "only-self"]);
eq("routing: nobody named still says so, the DG is not invented", planSteps([rule(1, "Reviewer", [])], "shrotri", 100, dgEsc).problem, "no-approver");
eq("routing: the same person on two steps is refused", planSteps([rule(1, "Reviewer", ["a"]), rule(2, "Director General", ["a"])], "req", 100).problem, "same-approver");
eq("routing: two different people on two steps are fine", planSteps([rule(1, "Reviewer", ["a"]), rule(2, "Director General", ["b"])], "req", 100).problem, null);
const typed = (requestType: string, r: RuleLike) => ({ ...r, requestType });
eq("escalation: the DG is the last staffed step of the large expenditure rules", escalationApprover([typed("hr", rule(2, "Director General", ["hrdg"])), typed("expenditure_large", rule(1, "Reviewer", ["shrotri"])), typed("expenditure_large", rule(2, "Director General", ["dg"]))]), { approverUserId: "dg", stepLabel: "Director General" });
eq("escalation: with no large expenditure DG the HR one is used, and with none at all there is none", [escalationApprover([typed("hr", rule(2, "Director General", ["hrdg"]))])?.approverUserId, escalationApprover([typed("expenditure_large", rule(1, "Reviewer", ["a"]))])], ["hrdg", null]);

// Approvals: decisions, utilisation, numbers.
eq("comment: needed to reject and to return, never to approve", [commentRequired("reject"), commentRequired("return"), commentRequired("approve")], [true, true, false]);
eq("status: a returned request has a label", STATUS_LABEL.returned, "Returned");
eq("decisions: a step before the last recommends to the next approver, the last of several decides finally, a lone step just approves", [decisionMode(1, 2), decisionMode(2, 2), decisionMode(1, 1), decisionMode(1, 3), decisionMode(3, 3)], ["recommend", "final", "single", "recommend", "final"]);
eq("decisions: the buttons say what they do", [MODE_WORDS.recommend.approve, MODE_WORDS.final.approve, MODE_WORDS.final.reject, MODE_WORDS.single.approve, MODE_WORDS.single.reject], ["Recommend to DG", "Final approve", "Final reject", "Approve", "Reject"]);
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
// One expense form for every amount: from the threshold up the same fields are asked (vendor name and email included).
const lg = { employeeUserId: uid, categoryId: uid, branchId: uid, amountPaise: 1_500_000, budgetAllocatedPaise: 5_000_000, budgetUsedPaise: 0, email: "a@b.org", vendorName: "Vendor" };
eq("large form: minimum fields pass, amount is required", [largeExpenditureInput.safeParse(lg).success, largeExpenditureInput.safeParse({ ...lg, amountPaise: undefined }).success], [true, false]);
eq("large form: the same fields as below the threshold (vendor name and email required, expense fields kept)", [
  largeExpenditureInput.safeParse({ ...lg, vendorName: "" }).success, largeExpenditureInput.safeParse({ ...lg, email: "" }).success,
  largeExpenditureInput.safeParse({ ...lg, expenseDate: "2026-01-05", taxInvoiceDate: "2026-01-04" }).data?.expenseDate,
], [false, false, "2026-01-05"]);
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
eq("rbac: the Support Admin may deactivate anyone but themselves, the Super Admin included; the Super Admin has no such power", [canDeactivate(ADMIN, { id: "x", role: "super_admin" }), canDeactivate(SUPER, { id: "x", role: "super_admin" }), canDeactivate(SUPER, { id: "x", role: "member" }), canDeactivate(ADMIN, { id: "x", role: "admin" }), canDeactivate(ADMIN, { id: "x", role: "member" }), canDeactivate(ADMIN, { id: "x", role: "head_admin" })], [true, false, false, true, true, true]);
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
eq("rbac: Admin, Super Admin, HR Admin and Expense Admin are given only by the Support Admin (and the Support Admin role never); the last three are one person each", [[...PROMOTABLE_ROLES], [...ASSIGNABLE_ROLES].includes("head_admin" as never), [...SINGLE_HOLDER_ROLES]], [["admin", "super_admin", "hr_admin", "expense_admin"], false, ["super_admin", "hr_admin", "expense_admin"]]);
eq("rbac: the areas an Admin can be given", [...ADMIN_AREAS], ["people", "import", "org", "apps", "audit", "activity"]);
eq("rbac: a plain user and a Team manager never open Administrator", [canAdminister(USER), canAdminister(TM)], [false, false]);
eq("tabs: the Support Admin sees Dashboard, Users, Applications and Activity Log, then Approval Forms, HR, Expenditure and the Notification Panel", [adminTabsFor(ADMIN).filter((t) => t.group === "main").map((t) => t.label), adminTabsFor(ADMIN).filter((t) => t.group === "settings").map((t) => t.label)],
  [["Dashboard", "Users", "Applications", "Activity Log"], ["Approval Forms", "HR", "Expenditure", "Notification Panel"]]);
eq("tabs: an Admin sees the Dashboard, the Notification Panel and only the sections of the areas switched on, never the approval forms", [adminTabsFor(A_NONE).map((t) => t.label), adminTabsFor(adminWith("people")).map((t) => t.label), adminTabsFor(adminWith("apps", "activity")).map((t) => t.label)],
  [["Dashboard", "Notification Panel"], ["Dashboard", "Users", "Notification Panel"], ["Dashboard", "Applications", "Activity Log", "Notification Panel"]]);
eq("tabs: Users and the Activity Log open on the first page the Admin may use", [adminTabsFor(A_IMPORT).find((t) => t.label === "Users")?.href, adminTabsFor(adminWith("org")).find((t) => t.label === "Users")?.href, adminTabsFor(A_AUDIT).find((t) => t.label === "Activity Log")?.href],
  ["/administrator/users/import", "/administrator/users/org", "/administrator/activity?tab=changes"]);
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
// the Inventory module's and the Cab Booking module's routes go through their own route() wrappers, which do it centrally (checked just below).
const appDir = new URL("../src/app/", import.meta.url);
const allRouteFiles = (readdirSync(appDir, { recursive: true }) as string[]).filter((f) => /(^|\/)route\.ts$/.test(f));
const routeFiles = allRouteFiles.filter((f) => !/^(api\/approvals|approvals|api\/inventory|inventory|api\/cabs|cabs)\//.test(f));
// A Vercel Cron route has no sign-in: it must check CRON_SECRET instead. The only route open to anyone on purpose is the ping, which
// touches nothing and answers only "ok" and the time (the proxy lets exactly /api/ping through).
const PUBLIC_ROUTES = ["api/ping/route.ts"];
const openRoutes = routeFiles.filter((f) => !PUBLIC_ROUTES.includes(f) && !/\b(assertHeadAdmin|assertArea|getCurrentUser|requireUser|requireHeadAdmin|requireArea|requireAdministrator)\(|process\.env\.CRON_SECRET/.test(readFileSync(new URL(f, appDir), "utf8")));
eq(`guards: all ${routeFiles.length} route handlers outside the Approval System and Inventory check who is asking`, openRoutes, []);
// Every handler an Inventory route file exports is wrapped in the Inventory guard's route() (sign-in, roles, same-site writes, clean errors).
const inventoryRoutes = allRouteFiles.filter((f) => /^api\/inventory\//.test(f));
const unwrapped = inventoryRoutes.flatMap((f) => {
  const src = readFileSync(new URL(f, appDir), "utf8");
  const handlers = [...src.matchAll(/export (?:const|async function|function) (GET|POST|PUT|PATCH|DELETE)\b(.*)/g)];
  const imported = /from "@\/lib\/inventory\/guard"/.test(src);
  return handlers.filter(([, , rest]) => !imported || !/^\s*=\s*route[<(]/.test(rest)).map(([, method]) => `${f}:${method}`);
});
eq(`guards: every handler in the ${inventoryRoutes.length} Inventory route files goes through the Inventory guard's route()`, [inventoryRoutes.length > 0, unwrapped], [true, []]);
// The same for Cab Booking: every handler is wrapped in its guard's route(), which always names the roles that may call it. Only the drivers'
// sign-in, sign-out and "who am I" (called before anyone is signed in) use publicRoute() instead.
const CAB_PUBLIC = ["api/cabs/driver-access/route.ts", "api/cabs/driver-login/route.ts", "api/cabs/driver-logout/route.ts", "api/cabs/driver-me/route.ts"];
const cabRoutes = allRouteFiles.filter((f) => /^api\/cabs\//.test(f));
const cabUnwrapped = cabRoutes.flatMap((f) => {
  const src = readFileSync(new URL(f, appDir), "utf8");
  const handlers = [...src.matchAll(/export (?:const|async function|function) (GET|POST|PUT|PATCH|DELETE)\b(.*)/g)];
  const imported = /from "@\/lib\/cabs\/guard"/.test(src);
  const wrapped = CAB_PUBLIC.includes(f) ? /^\s*=\s*publicRoute\(/ : /^\s*=\s*route(<[^>]*>)?\(\{ roles: \[/;
  return handlers.filter(([, , rest]) => !imported || !wrapped.test(rest)).map(([, method]) => `${f}:${method}`);
});
eq(`guards: every handler in the ${cabRoutes.length} Cab Booking route files goes through the Cabs guard's route() with its roles (the 4 driver sign-in routes: publicRoute())`,
  [cabRoutes.length, cabUnwrapped, CAB_PUBLIC.filter((f) => cabRoutes.includes(f)).length], [37, [], 4]);

// The application check must never be steered at an internal network
eq("net guard: private, loopback, metadata and reserved IPv4 are refused", ["127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255"].map(isPublicAddress), Array(10).fill(false));
eq("net guard: ordinary public IPv4 is allowed, including just outside the private ranges", ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "192.169.0.1", "100.63.0.1"].map(isPublicAddress), Array(6).fill(true));
eq("net guard: IPv6 loopback, unique-local, link-local, multicast and mapped private addresses are refused", ["::1", "::", "fd00::1", "fc00::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:7f00:1"].map(isPublicAddress), Array(9).fill(false));
eq("net guard: public IPv6 and a mapped public IPv4 are allowed, and anything that is not an address is refused", [isPublicAddress("2606:4700:4700::1111"), isPublicAddress("::ffff:8.8.8.8"), isPublicAddress("localhost"), isPublicAddress("evil.example.com"), isPublicAddress("")], [true, true, false, false, false]);

// Sign-in limits (src/lib/sign-in-rules.ts): when a refusal ends, and how long a try waits.
{
  const m = 60_000;
  eq("limits: 4 wrong passwords are not refused", sirRefusedUntil([0, m, 2 * m, 3 * m], 5), 0);
  eq("limits: the 5th wrong password within 15 minutes refuses for 15 minutes after it", sirRefusedUntil([0, m, 2 * m, 3 * m, 4 * m], 5), 4 * m + SIR_WINDOW);
  eq("limits: 5 wrong passwords spread over more than 15 minutes do not refuse", sirRefusedUntil([0, 4 * m, 8 * m, 12 * m, 16 * m], 5), 0);
  eq("limits: order does not matter", sirRefusedUntil([4 * m, 0, 3 * m, m, 2 * m], 5), 4 * m + SIR_WINDOW);
  eq("client IP: Vercel's own header first, then x-real-ip, then the first X-Forwarded-For address", [
    clientIp(new Headers({ "x-vercel-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8", "x-forwarded-for": "9.9.9.9" })),
    clientIp(new Headers({ "x-real-ip": "5.6.7.8", "x-forwarded-for": "9.9.9.9, 10.0.0.1" })),
    clientIp(new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" })), clientIp(new Headers()),
  ], ["1.2.3.4", "5.6.7.8", "9.9.9.9", null]);
  eq("limits: the email-only slow-down starts at 10 and stops growing at 5 seconds", [sirSlowDownMs(9), sirSlowDownMs(10), sirSlowDownMs(12), sirSlowDownMs(14), sirSlowDownMs(40)], [0, 1000, 3000, 5000, 5000]);
}

// Which pages count as Administrator for the unlock and the lock (src/lib/admin-paths.ts).
eq("admin paths: Administrator and the Approval System's admin pages count; nothing else does", [
  "/administrator", "/administrator/users/1", "/approvals/admin", "/approvals/admin/categories?x=1",
  "/approvals", "/approvals/administrators", "/approvals/requests/1", "/administratorx", "/",
].map(isAdminPath), [true, true, true, true, false, false, false, false, false]);

// What goes in the logs (src/lib/log-error.ts): a code and a short first line, never the query parameters.
{
  const dbErr = Object.assign(new Error("Failed query: insert into users (email) values ($1)\nparams: asha@mcciapune.com"), {
    cause: Object.assign(new Error("duplicate key value violates unique constraint \"users_email_key\""), { code: "23505", detail: "Key (email)=(asha@mcciapune.com) already exists." }),
  });
  eq("log: a database error gives its code and the driver's message, without the parameters or details", errorSummary(dbErr), '[23505] duplicate key value violates unique constraint "users_email_key"');
  eq("log: a plain error gives its first line only, cut short", errorSummary(new Error(`${"x".repeat(300)}\nsecond line`)).length, 160);
  eq("log: odd values do not throw", [errorSummary(null), errorSummary("boom"), errorSummary({ code: "ECONNREFUSED" })], ["unknown error", "boom", "[ECONNREFUSED] unknown error"]);
}

// The site address in emails (src/lib/site-url.ts): never the request's Host header.
{
  const threw = (env: Record<string, string>) => { try { siteUrl(env); return false; } catch (e) { return e instanceof Error && e.message.includes("APP_BASE_URL"); } };
  eq("site url: APP_BASE_URL wins, without a trailing slash", siteUrl({ APP_BASE_URL: "https://mccia-apphub.vercel.app/", VERCEL_ENV: "production", VERCEL_URL: "x.vercel.app" }), "https://mccia-apphub.vercel.app");
  eq("site url: production without APP_BASE_URL fails clearly (on Vercel and self-hosted)", [threw({ VERCEL_ENV: "production", VERCEL_URL: "x.vercel.app" }), threw({ NODE_ENV: "production" })], [true, true]);
  eq("site url: a Preview uses its own Vercel address", siteUrl({ VERCEL_ENV: "preview", VERCEL_URL: "mccia-apphub-git-security-fixes.vercel.app", NODE_ENV: "production" }), "https://mccia-apphub-git-security-fixes.vercel.app");
  eq("site url: local development falls back to localhost", siteUrl({ NODE_ENV: "development" }), "http://localhost:3000");
}


// Single sign-on (src/lib/sso.ts, sso-rules.ts, sso-page.ts): the token contract, the rules for a slug and a callback address, and the hand-off page.
// Inventory: the role each hub role gets, which application rows stand for the module, what the menu shows each person, and the form rules
eq("inventory roles: the Support Admin and the Inventory application's App Admins run the store; everyone else, whatever their hub role, is a user", [
  inventoryRoleFor("head_admin", false), inventoryRoleFor("member", true), inventoryRoleFor("super_admin", false), inventoryRoleFor("admin", false),
  inventoryRoleFor("admin", true), inventoryRoleFor("member", false),
], ["inventory_admin", "inventory_admin", "requester", "requester", "inventory_admin", "requester"]);
eq("inventory roles: the Inventory application's App Staff are Staff; an App Admin (or the Support Admin) who is also App Staff stays admin", [
  inventoryRoleFor("member", false, true), inventoryRoleFor("admin", false, true), inventoryRoleFor("member", true, true), inventoryRoleFor("head_admin", false, true),
], ["inventory_staff", "inventory_staff", "inventory_admin", "inventory_admin"]);
eq("inventory access: only an application whose URL is /inventory stands for the module", ["/inventory", "/inventory/", "/inventory/items", "/inventory-old", "https://mccia-inventory-management.vercel.app/", "/approvals"]
  .map((u) => new RegExp(INVENTORY_URL_PATTERN).test(u)), [true, true, false, false, false, false]);
const navLabels = (roles: Parameters<typeof navFor>[0]) => navFor(roles).map((i) => i.label);
eq("inventory menu: no Settings any more; Categories, purchase orders and the stock history for Inventory admins; Items for Staff and admins; requests for everyone", [
  navLabels(["requester", "inventory_admin"]).includes("Settings"), navLabels(["requester"]).includes("Categories"), navLabels(["requester"]).includes("Purchase orders"),
  navLabels(["requester"]).includes("Stock movements"), navLabels(["requester", "inventory_admin"]).includes("Categories"), navLabels(["requester"]).includes("Items"), navLabels(["requester"]).includes("Requests"),
  navLabels(["requester", "inventory_staff"]).includes("Items"), navLabels(["requester", "inventory_admin"]).includes("Items"),
], [false, false, false, false, true, false, true, true, true]);
eq("inventory menu: a user sees exactly the dashboard, their requests and maintenance; Staff also the items; an admin sees all twelve, Transfers and the Audit Log among them",
  [navLabels(["requester"]), navLabels(["requester", "inventory_staff"]), navLabels(["requester", "inventory_admin"]).length, navLabels(["requester", "inventory_staff"]).includes("Transfers"), navLabels(["requester", "inventory_admin"]).includes("Transfers"),
    navLabels(["requester", "inventory_staff"]).includes("Audit Log"), navLabels(["requester", "inventory_admin"]).includes("Audit Log")],
  [["Dashboard", "Requests", "Maintenance"], ["Dashboard", "Items", "Requests", "Maintenance"], 12, false, true, false, true]);
eq("inventory rupees: amounts become paise; bad input is refused", [rupeesToPaise("1,250.50"), rupeesToPaise("₹ 35"), rupeesToPaise(""), rupeesToPaise("1.234"), rupeesToPaise("-5"), rupeesToPaise("abc")], [125050, 3500, null, "invalid", "invalid", "invalid"]);
const okParse = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => schema.safeParse(v).success;
{
  const b1 = "11111111-1111-4111-8111-111111111111", b2 = "22222222-2222-4222-8222-222222222222", it = "33333333-3333-4333-8333-333333333333";
  eq("inventory transfers: two different branches and a whole quantity of at least 1", [
    okParse(transferInput, { itemId: it, fromBranchId: b1, toBranchId: b2, quantity: "4" }), okParse(transferInput, { itemId: it, fromBranchId: b1, toBranchId: b1, quantity: 4 }),
    okParse(transferInput, { itemId: it, fromBranchId: b1, toBranchId: b2, quantity: 0 }), okParse(transferInput, { itemId: it, fromBranchId: "", toBranchId: b2, quantity: 1 }),
  ], [true, false, false, false]);
}
eq("inventory requests: an item and a whole quantity of at least 1; a reject needs a reason", [
  okParse(requestInput, { itemId: "11111111-1111-4111-8111-111111111111", quantity: "3" }), okParse(requestInput, { itemId: "11111111-1111-4111-8111-111111111111", quantity: 0 }), okParse(requestInput, { itemId: "11111111-1111-4111-8111-111111111111", quantity: 1.5 }),
  okParse(requestDecision, { action: "approve" }), okParse(requestDecision, { action: "reject", reason: "  " }), okParse(requestDecision, { action: "reject", reason: "Out of budget" }),
  okParse(requestDecision, { action: "fulfil" }), okParse(requestDecision, { action: "delete" }),
], [true, false, false, true, false, true, true, false]);
eq("inventory issues: to a hub user or a typed name (one is needed); returns are whole numbers of at least 1", [
  okParse(issueInput, { itemId: "11111111-1111-4111-8111-111111111111", quantity: 2, userId: "11111111-1111-4111-8111-111111111111" }), okParse(issueInput, { itemId: "11111111-1111-4111-8111-111111111111", quantity: 2, name: "Guest speaker", eventName: "AGM" }),
  okParse(issueInput, { itemId: "11111111-1111-4111-8111-111111111111", quantity: 2, userId: "", name: "" }), okParse(issueInput, { itemId: "11111111-1111-4111-8111-111111111111", quantity: -1, name: "X" }),
  okParse(returnInput, { quantity: "2" }), okParse(returnInput, { quantity: 0 }),
], [true, true, false, false, true, false]);
const vendor = (v: Record<string, unknown>) => { const r = vendorInput.safeParse({ name: "ZZ Vendor", ...v }); return r.success ? r.data : "refused"; };
eq("inventory vendors: GSTIN and PAN in their official formats (stored in capitals, spaces dropped); email and phone checked; blanks are empty", [
  (vendor({ gstin: "27abcde1234f1z5", pan: "abcde 1234f" }) as { gstin: string; pan: string }).gstin, (vendor({ pan: "abcde1234f" }) as { pan: string }).pan,
  vendor({ gstin: "27ABCDE1234F1Z" }), vendor({ pan: "ABCD1234F" }), vendor({ email: "not-an-email" }), vendor({ phone: "call me" }),
  (vendor({ email: "", phone: "", gstin: "", pan: "" }) as { email: null; gstin: null }).gstin, vendor({ name: " " }),
], ["27ABCDE1234F1Z5", "ABCDE1234F", "refused", "refused", "refused", "refused", null, "refused"]);
eq("inventory PO numbers: the financial year turns at midnight on 1 April, India time", [
  financialYear(new Date("2027-03-31T18:29:59Z")), financialYear(new Date("2027-03-31T18:30:00Z")), financialYear(new Date("2026-04-01T00:00:00+05:30")),
  financialYear(new Date("2027-01-15T12:00:00Z")), financialYear(new Date("2099-12-31T12:00:00Z")), poPrefix(new Date("2026-10-29T10:00:00Z")),
], ["2026-27", "2027-28", "2026-27", "2026-27", "2099-00", "PO-2026-27-"]);
eq("inventory PO numbers: the next serial of the year, starting at 0001, past 9999, ignoring other years", [
  nextPoNo("PO-2026-27-", null), nextPoNo("PO-2026-27-", "PO-2026-27-0041"), nextPoNo("PO-2026-27-", "PO-2026-27-9999"), nextPoNo("PO-2027-28-", "PO-2026-27-0041"),
], ["PO-2026-27-0001", "PO-2026-27-0042", "PO-2026-27-10000", "PO-2027-28-0001"]);
eq("inventory PO input: a vendor (chosen or typed) and 1-100 lines, each with an item or a description, a quantity and a rate", [
  okParse(poInput, { vendorName: "X", lines: [{ description: "Chairs", quantity: 2, rate: "1500" }] }), okParse(poInput, { vendorId: "11111111-1111-4111-8111-111111111111", lines: [{ itemId: "11111111-1111-4111-8111-111111111111", quantity: 1, rate: "0" }] }),
  okParse(poInput, { lines: [{ description: "Chairs", quantity: 2, rate: "1500" }] }), okParse(poInput, { vendorName: "X", lines: [] }),
  okParse(poInput, { vendorName: "X", lines: [{ quantity: 2, rate: "1" }] }), okParse(poInput, { vendorName: "X", lines: [{ description: "A", quantity: 2, rate: "" }] }),
  okParse(poInput, { vendorName: "X", lines: Array.from({ length: 101 }, () => ({ description: "A", quantity: 1, rate: "1" })) }),
], [true, true, false, false, false, false, false]);
eq("inventory receipts: lines with 0 are dropped; nothing at all is refused unless the order is being closed", [
  (receiveInput.safeParse({ lines: [{ lineId: "11111111-1111-4111-8111-111111111111", quantity: "0" }, { lineId: "11111111-1111-4111-8111-111111111111", quantity: 3 }] }) as { data?: { lines: unknown[] } }).data?.lines.length,
  okParse(receiveInput, { lines: [{ lineId: "11111111-1111-4111-8111-111111111111", quantity: 0 }] }), okParse(receiveInput, { lines: [], close: true }), okParse(receiveInput, { lines: [{ lineId: "11111111-1111-4111-8111-111111111111", quantity: -1 }] }),
], [1, false, true, false]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]), JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]), GIF = Buffer.from("GIF89a....");
const dataUrl = (type: string, b: Buffer) => `data:${type};base64,${b.toString("base64")}`;
const photoResult = (u: string) => { const r = checkPhoto(u); return r.ok ? r.type : r.error; };
eq("inventory photos: JPEG and PNG by their own first bytes; the label is corrected from the bytes; anything else refused", [
  sniffPhoto(PNG), sniffPhoto(JPG), sniffPhoto(GIF), photoResult(dataUrl("image/png", PNG)), photoResult(dataUrl("image/jpeg", JPG)), photoResult(dataUrl("image/jpeg", PNG)),
  photoResult(dataUrl("image/png", GIF)), photoResult(dataUrl("image/gif", GIF)), photoResult("not a data url"),
], ["image/png", "image/jpeg", null, "image/png", "image/jpeg", "image/png", "That file is not really a JPEG or PNG image.", "Only JPEG or PNG photos can be attached.",
  "The photo could not be read. Choose a JPEG or PNG image."]);
eq("inventory photos: at most 2 MB (checked before decoding)", [
  photoResult(dataUrl("image/png", Buffer.concat([PNG, Buffer.alloc(MAX_PHOTO_BYTES - PNG.length)]))), photoResult(dataUrl("image/png", Buffer.concat([PNG, Buffer.alloc(MAX_PHOTO_BYTES)]))),
], ["image/png", "The photo is larger than 2 MB. Choose a smaller one."]);
eq("inventory tickets: a title is needed; the photo is optional and checked; a status is open, in progress or resolved", [
  okParse(ticketInput, { title: "Fan broken" }), okParse(ticketInput, { title: " " }), okParse(ticketInput, { title: "A", photo: dataUrl("image/png", GIF) }), okParse(ticketInput, { title: "A", photo: "" }),
  okParse(ticketUpdate, { status: "in_progress" }), okParse(ticketUpdate, { status: "closed" }),
], [true, false, false, true, true, false]);

// Cab Booking: who gets which role, which application rows stand for each section, each section's menu, and the form rules.
eq("cabs roles: MCCIA Cabs access makes a user; a cab_drivers row a driver; an App Admin of Cabs Admin (with access to it) or the Support Admin an admin", [
  cabRolesFor({ hubRole: "member", userAccess: true, adminAppAdmin: false, isDriver: false }),
  cabRolesFor({ hubRole: "member", userAccess: false, adminAppAdmin: false, isDriver: true }),
  cabRolesFor({ hubRole: "admin", userAccess: true, adminAppAdmin: true, isDriver: false }),
  cabRolesFor({ hubRole: "head_admin", userAccess: false, adminAppAdmin: false, isDriver: false }),
  cabRolesFor({ hubRole: "super_admin", userAccess: false, adminAppAdmin: false, isDriver: false }),
], [["cab_user"], ["cab_driver"], ["cab_user", "cab_admin"], ["cab_user", "cab_admin"], []]);
eq("cabs access: each section is the application whose URL is exactly its path", ["/cabs", "/cabs/", "/cabs/driver", "/cabs/admin", "/cabs/book", "/cabs-old", "https://cabs.example.com/cabs"].map((u) => [
  new RegExp(CABS_USER_URL_PATTERN).test(u), new RegExp(CABS_DRIVER_URL_PATTERN).test(u), new RegExp(CABS_ADMIN_URL_PATTERN).test(u)]),
  [[true, false, false], [true, false, false], [false, true, false], [false, false, true], [false, false, false], [false, false, false], [false, false, false]]);
eq("cabs menus: the rider's 3 tabs, the driver's 4 tabs, 10 admin pages in one flat list, each shown only to its roles (Cabs admins see the driver pages too)", [
  cabNavFor("staff", ["cab_user"]).map((i) => i.label), cabNavFor("driver", ["cab_driver"]).map((i) => i.label), cabNavFor("admin", ["cab_admin"]).map((i) => i.label),
  cabNavFor("admin", ["cab_user", "cab_driver"]).length, cabNavFor("driver", ["cab_user", "cab_admin"]).length, cabNavFor("driver", ["cab_user"]).length, [CAB_NAV.staff.title, CAB_NAV.driver.title, CAB_NAV.admin.title],
], [["Book", "My rides", "Account"], ["Assigned", "Trip", "History", "Profile"], ["Dashboard", "Live Trips", "Pending Requests", "Upcoming Rides", "All Trips", "Drivers", "Vehicles", "Maintenance", "Payments", "Audit Log"], 0, 4, 0, ["MCCIA Cabs", "Cabs Driver", "Cabs Admin"]]);
eq("cabs admin menu: no nested lines; Live Trips carries the live dot, Pending Requests the red count, Drivers the amber login dot", [
  CAB_NAV.admin.items.every((i) => !("children" in i)), CAB_NAV.admin.items.filter((i) => i.live).map((i) => i.label),
  CAB_NAV.admin.items.filter((i) => i.badge).map((i) => `${i.label}:${i.badge}`),
], [true, ["Live Trips"], ["Pending Requests:pending", "Drivers:login"]]);
{
  const now = Date.parse("2026-11-02T04:00:00Z"); // 09:30 in India
  eq("cabs times: a datetime-local value is India time; a full ISO time keeps its own offset; junk is refused", [
    istLocalToDate("2026-11-02T09:30")?.toISOString(), istLocalToDate("2026-11-02T09:30:00Z")?.toISOString(), istLocalToDate("2026-13-02T09:30"), istLocalToDate("tomorrow"), istLocalToDate(""),
  ], ["2026-11-02T04:00:00.000Z", "2026-11-02T09:30:00.000Z", null, null, null]);
  eq("cabs times: a ride starts at least 15 minutes from now (the server allows 5 of them for a form left open), and at most a year ahead", [
    scheduleProblem(new Date(now + 15 * 60_000), now), scheduleProblem(new Date(now + 11 * 60_000), now), scheduleProblem(new Date(now + 9 * 60_000), now), scheduleProblem(new Date(now - 60_000), now),
    scheduleProblem(new Date(now + 86_400_000), now), !!scheduleProblem(new Date(now + 366 * 86_400_000), now),
  ], [null, null, "Please select a future time", "Please select a future time", null, true]);
}
{
  const later = new Date(Date.now() + 2 * 86_400_000 + 5.5 * 3600_000).toISOString().slice(0, 16);
  const v = "11111111-1111-4111-8111-111111111111";
  eq("cabs forms: a ride needs a pickup, a drop-off (200 characters at most) and a future time; notes are optional", [
    okParse(rideInput, { pickup: "Office", dropoff: "Airport", scheduledFor: later }), okParse(rideInput, { pickup: " ", dropoff: "Airport", scheduledFor: later }),
    okParse(rideInput, { pickup: "x".repeat(201), dropoff: "Airport", scheduledFor: later }), okParse(rideInput, { pickup: "Office", dropoff: "Airport", scheduledFor: "2020-01-01T10:00" }),
    rideInput.parse({ pickup: " Office ", dropoff: "Airport", scheduledFor: later, notes: "" }).notes,
  ], [true, false, false, false, null]);
  eq("cabs forms: a number plate is kept in one form; seats are 1 to 50; assigning needs a driver and a vehicle", [
    vehicleInput.parse({ numberPlate: "  mh 12   ab 1234 ", model: "Innova", capacity: "7" }), okParse(vehicleInput, { numberPlate: "MH12AB1234", model: "Innova", capacity: 0 }),
    okParse(assignInput, { driverId: v, vehicleId: v }), okParse(assignInput, { driverId: v }),
  ], [{ numberPlate: "MH 12 AB 1234", model: "Innova", capacity: 7 }, false, true, false]);
  eq("cabs forms: a driver is a name and a phone of 10 to 15 digits (kept as digits); an email is optional (kept lower case); no vehicle of their own", [
    driverInput.parse({ name: " Ravi Patil ", email: " Ravi.Patil@MCCIA.org ", phone: "+91 98765-43210", vehicleId: "" }),
    okParse(driverInput, { name: "Ravi", email: "ravi@x.org", phone: "12345" }), okParse(driverInput, { name: "Ravi", email: "not-an-email", phone: "9876543210" }),
    okParse(driverInput, { name: "", email: "ravi@x.org", phone: "9876543210" }), okParse(driverInput, { userId: v, vehicleId: v }),
    driverInput.parse({ name: "Suresh", phone: "98220 00001" }).email, driverInput.parse({ name: "Suresh", phone: "9822000001", email: "" }).email, okParse(driverInput, { name: "Suresh", email: "s@x.org" }),
  ], [{ name: "Ravi Patil", email: "ravi.patil@mccia.org", phone: "+919876543210" }, false, false, false, false, null, null, false]);
  {
    const fuel = (extra: Record<string, unknown>) => fuelInput.safeParse({ vehicleId: v, fuelledAt: "2026-01-05T09:30", litres: "35.5", cost: "3,550", ...extra });
    const okFuel = fuel({ stationName: " HP Baner " });
    eq("cabs fuel: a vehicle, a time (India, not in the future), litres above 0 with at most 2 decimals, a cost; the station is optional", [
      okFuel.success && [okFuel.data.litres, okFuel.data.cost, okFuel.data.fuelledAt.toISOString(), okFuel.data.stationName], fuel({}).success && fuel({}).data?.stationName,
      fuel({ litres: "0" }).success, fuel({ litres: "12.345" }).success, fuel({ litres: "abc" }).success, fuel({ litres: "1001" }).success,
      fuel({ cost: "" }).success, fuel({ cost: "0" }).success, fuel({ fuelledAt: "2099-01-01T10:00" }).success, fuel({ fuelledAt: "yesterday" }).success, fuel({ vehicleId: "x" }).success,
    ], [["35.5", 355000, "2026-01-05T04:00:00.000Z", "HP Baner"], null, false, false, false, false, false, false, false, false, false]);
  }
  eq("cabs driver login: a phone is matched as typed (digits, + kept) or by its last 10 digits; fewer than 10 or more than 15 digits is no phone", [
    loginPhone(" +91 98765-43210 "), loginPhone("98765 43210"), loginPhone("919876543210"), loginPhone("12345"), loginPhone("1234567890123456"), loginPhone(""),
  ], [{ exact: "+919876543210", last10: "9876543210" }, { exact: "9876543210", last10: "9876543210" }, { exact: "919876543210", last10: "9876543210" }, null, null, null]);
  const ds = [{ id: "a", phone: "+919876543210" }, { id: "b", phone: "9822000001" }, { id: "c", phone: "+919822000002" }, { id: "d", phone: "+449822000002" }];
  eq("cabs driver login: the exact number first; else the one driver ending in the same 10 digits; two such drivers is nobody", [
    pickDriver(ds, loginPhone("+919876543210")!)?.id, pickDriver(ds, loginPhone("98765 43210")!)?.id, pickDriver(ds, loginPhone("+91 98220 00001")!)?.id,
    pickDriver(ds, loginPhone("9822000002")!)?.id ?? null, pickDriver(ds, loginPhone("+449822000002")!)?.id, pickDriver(ds, loginPhone("9000000000")!)?.id ?? null,
  ], ["a", "a", "b", null, "d", null]);
  eq("cabs driver login: the OTP is exactly 6 digits; a session lasts 12 hours, an OTP 24, and 5 wrong tries lock it", [
    ...["847291", " 000042 ", "84729", "8472910", "84a291"].map((otp) => okParse(driverLoginInput, { phone: "9876543210", otp })), DRIVER_SESSION_HOURS, LOGIN_OTP_HOURS, LOGIN_MAX_ATTEMPTS,
  ], [true, true, false, false, false, 12, 24, 5]);
}

{
  const later = new Date(Date.now() + 2 * 86_400_000 + 5.5 * 3600_000).toISOString().slice(0, 16);
  const ride = (extra: Record<string, unknown>) => rideInput.safeParse({ pickup: "Office", dropoff: "Airport", scheduledFor: later, ...extra });
  const parsed = rideInput.parse({ pickup: "Office", dropoff: "Airport", scheduledFor: later, pickup_lat: "18.5204", pickup_lng: 73.8567, dropoffLat: 18.58, dropoffLng: "73.92" });
  eq("cabs coordinates: optional; taken as pickup_lat or pickupLat; both halves of a point or neither; real latitudes and longitudes only", [
    ride({}).success, [parsed.pickupLat, parsed.pickupLng, parsed.dropoffLat, parsed.dropoffLng], ride({ pickupLat: 18.5 }).success, ride({ pickupLat: 91, pickupLng: 73 }).success,
    ride({ dropoffLat: "", dropoffLng: "" }).success,
    Object.values(rideInput.parse({ pickup: "Office", dropoff: "Airport", scheduledFor: later, pickupLat: null, pickupLng: null, dropoffLat: "", dropoffLng: "" })).slice(2, 6),
  ], [true, [18.5204, 73.8567, 18.58, 73.92], false, false, true, [null, null, null, null]]);
  const loc = locationInput.parse({ driver_id: "11111111-1111-4111-8111-111111111111", latitude: 18.52, longitude: 73.85, speed: 42.5, ride_id: "" });
  eq("cabs location: a position with optional accuracy, heading (0 to 360) and speed; any driver_id sent is dropped", [
    loc, locationInput.parse({ latitude: 18.52, longitude: 73.85, accuracy: null, heading: null, speed: null }).heading, okParse(locationInput, { latitude: 18.52 }), okParse(locationInput, { latitude: 18.52, longitude: 73.85, heading: 400 }),
  ], [{ latitude: 18.52, longitude: 73.85, accuracy: null, heading: null, speed: 42.5, rideId: null }, null, false, false]);
  eq("cabs OTP: exactly 4 digits", ["4829", " 0042 ", "482", "48290", "48a9"].map((v) => okParse(otpInput, { otp: v })), [true, true, false, false, false]);
  const now = Date.parse("2026-11-02T04:00:00Z");
  eq("cabs OTP: expires 2 hours after the scheduled time, never sooner than 2 hours from now; 3 tries", [
    otpExpiry(new Date(now + 26 * 3600_000), now).toISOString(), otpExpiry(new Date(now + 30 * 60_000), now).toISOString(), otpExpiry(new Date(now - 3600_000), now).toISOString(), OTP_MAX_ATTEMPTS,
  ], ["2026-11-03T08:00:00.000Z", "2026-11-02T06:30:00.000Z", "2026-11-02T06:00:00.000Z", 3]);
  eq("cabs navigation: Google Maps directions by coordinates, or by the addresses when a ride has none", [
    mapsLink({ text: "Office", lat: 18.5204, lng: 73.8567 }, { text: "Airport", lat: 18.5821, lng: 73.9197 }),
    mapsLink({ text: "MCCIA, Tilak Road", lat: null, lng: null }, { text: "Pune Airport", lat: 18.5821, lng: 73.9197 }),
  ], ["https://www.google.com/maps/dir/?api=1&origin=18.5204%2C73.8567&destination=18.5821%2C73.9197&travelmode=driving",
    "https://www.google.com/maps/dir/?api=1&origin=MCCIA%2C+Tilak+Road&destination=18.5821%2C73.9197&travelmode=driving"]);
}

{
  const v = "11111111-1111-4111-8111-111111111111";
  const m = (extra: Record<string, unknown>) => maintenanceInput.safeParse({ vehicleId: v, type: "service", description: "Oil change", doneAt: "2026-10-30", doneBy: "Garage", ...extra });
  eq("cabs rupees: amounts become paise; empty is none; anything else is refused", [cabRupees("1,250.50"), cabRupees("₹ 35"), cabRupees(""), cabRupees(null), cabRupees("1.234"), cabRupees("-5"), cabRupees("abc"), cabRupees("20000000")],
    [125050, 3500, null, null, "invalid", "invalid", "invalid", "invalid"]);
  eq("cabs maintenance: a vehicle, a type from the list, a description, the date done (a real day) and who did it; cost and next due optional; next due not before it was done", [
    m({}).success, m({ cost: "2,500" }).success && maintenanceInput.parse({ vehicleId: v, type: "repair", description: "Brakes", doneAt: "2026-10-30", doneBy: "Garage", cost: "2,500" }).cost,
    m({ type: "wash" }).success, m({ doneAt: "2026-02-30" }).success, m({ description: " " }).success, m({ nextDueAt: "2026-10-01" }).success, m({ nextDueAt: "2027-04-30" }).success, m({ cost: "abc" }).success,
  ], [true, 250000, false, false, false, false, true, false]);
  eq("cabs costs: an amount is required; distance (up to 2 decimals) and notes optional", [
    costInput.parse({ fare: "850" }), costInput.safeParse({ fare: "" }).success, costInput.parse({ fare: "1,200.50", distanceKm: "18.5" }).distanceKm, costInput.safeParse({ fare: "100", distanceKm: "-3" }).success,
  ], [{ fare: 85000, distanceKm: null, notes: null }, false, 18.5, false]);
  eq("cabs invoices: a branch and a period that ends on or after it starts", [
    invoiceInput.safeParse({ branch: "Pune HQ", periodStart: "2026-10-01", periodEnd: "2026-10-31" }).success, invoiceInput.safeParse({ branch: "Pune HQ", periodStart: "2026-10-31", periodEnd: "2026-10-01" }).success,
    invoiceInput.safeParse({ branch: "", periodStart: "2026-10-01", periodEnd: "2026-10-31" }).success, invoiceInput.safeParse({ branch: "Pune HQ", periodStart: "2026-13-01", periodEnd: "2026-10-31" }).success,
  ], [true, false, false, false]);
}

{
  const day = (d: number) => new Date(Date.now() + d * 86_400_000 + 5.5 * 3600_000).toISOString().slice(0, 10);
  const base = { pickup: "Office", dropoff: "Airport" };
  const now = rideInput.parse({ ...base, tripType: "now" });
  const multi = rideInput.parse({ ...base, tripType: "multiday", scheduledFor: `${day(2)}T09:00`, endsOn: day(4) });
  eq("cabs when: Now needs no time (it is the moment of booking); Schedule needs one; without a type it is Schedule, as before", [
    now.tripType, Math.abs(now.scheduledFor.getTime() - Date.now()) < 5_000, now.endsAt, rideInput.safeParse({ ...base, tripType: "scheduled" }).success,
    rideInput.parse({ ...base, scheduledFor: `${day(1)}T10:00` }).tripType,
  ], ["now", true, null, false, "scheduled"]);
  eq("cabs when: Multi-day runs to the end of its last day (India time), which is a later day than the first, and lasts at most 31 days", [
    multi.endsAt?.toISOString(), rideInput.safeParse({ ...base, tripType: "multiday", scheduledFor: `${day(2)}T09:00` }).success,
    rideInput.safeParse({ ...base, tripType: "multiday", scheduledFor: `${day(5)}T09:00`, endsOn: day(3) }).success,
    rideInput.safeParse({ ...base, tripType: "multiday", scheduledFor: `${day(2)}T09:00`, endsOn: day(40) }).success,
    rideInput.safeParse({ ...base, tripType: "multiday", scheduledFor: `${day(2)}T09:00`, endsOn: day(2) }).success,
  ], [new Date(new Date(`${day(4)}T00:00:00+05:30`).getTime() + 86_399_999).toISOString(), false, false, false, false]);
  eq("cabs stops and passengers: up to 3 stops (each a full point or none); 1 to 20 passengers, 1 by default", [
    rideInput.parse({ ...base, tripType: "now", stops: [{ text: "Bank", lat: 18.5, lng: 73.8 }, { text: "Hotel" }] }).stops,
    rideInput.safeParse({ ...base, tripType: "now", stops: [{ text: "a" }, { text: "b" }, { text: "c" }, { text: "d" }] }).success,
    rideInput.safeParse({ ...base, tripType: "now", stops: [{ text: "a", lat: 18.5 }] }).success, now.passengers,
    rideInput.parse({ ...base, tripType: "now", passengers: "6" }).passengers, rideInput.safeParse({ ...base, tripType: "now", passengers: 0 }).success, rideInput.safeParse({ ...base, tripType: "now", passengers: 21 }).success,
  ], [[{ text: "Bank", lat: 18.5, lng: 73.8 }, { text: "Hotel", lat: null, lng: null }], false, false, 1, 6, false, false]);
  eq("cabs navigation: the route goes through the stops in order", mapsLink({ text: "A", lat: 18.5, lng: 73.8 }, { text: "D", lat: 18.6, lng: 73.9 }, [{ text: "B", lat: 18.55, lng: 73.85 }, { text: "C Road", lat: null, lng: null }]),
    "https://www.google.com/maps/dir/?api=1&origin=18.5%2C73.8&destination=18.6%2C73.9&travelmode=driving&waypoints=18.55%2C73.85%7CC+Road");
}

{
  const names = (t: string) => officesFor(t).map((o) => o.name);
  eq("cabs offices: all six when the box is (almost) empty; those matching the rest of the words after MCCIA / office / cluster; none for anything else", [
    names("").length, names("M").length, names("MCCIA").length, names("office").length, names("mccia hadapsar"), names("Bhosari office"), names("cluster"), names("Pune airport"), names("mccia xyz"),
  ], [6, 6, 6, 6, ["MCCIA Hadapsar Office"], ["MCCIA Bhosari Office"], ["Auto Cluster"], [], []]);
  eq("cabs offices: each has its address and a position; choosing one fills its name and address", [
    MCCIA_OFFICES.every((o) => o.address && Number.isFinite(o.lat) && Number.isFinite(o.lng)), officeText(MCCIA_OFFICES[3]),
  ], [true, "MCCIA Tilak Road Office, Central Chamber, 1023, Tilak Rd, Dadawadi, Shukrawar Peth, Pune, Maharashtra 411002"]);
}

const ssoTests = (async () => {
  const pair = () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    return { env: Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" }) as string).toString("base64"), publicPem: publicKey.export({ type: "spki", format: "pem" }) as string };
  };
  const hub = pair();
  const person = { id: "6f1c0a52-3f0e-4c58-9a57-0d5f2d7d9a11", email: "asha@mcciapune.com", name: "Asha Kulkarni" };
  const AUD = "mccia-search";
  // Runs something that should be refused and says why (jose's error code), or "accepted" when it was not.
  const why = async (fn: () => Promise<unknown>) => { try { await fn(); return "accepted"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };

  // Claims
  const T0 = Date.UTC(2026, 9, 27, 12, 0, 0);
  const c = buildClaims({ slug: AUD, user: person, role: "user", now: T0, jti: "fixed-id" });
  eq("sso claims: issuer, audience, subject, email, name, role and a fixed id", { iss: c.iss, aud: c.aud, sub: c.sub, email: c.email, name: c.name, role: c.role, jti: c.jti },
    { iss: "mccia-app-hub", aud: "mccia-search", sub: person.id, email: person.email, name: person.name, role: "user", jti: "fixed-id" });
  eq("sso claims: iat is the time in whole seconds and exp is exactly 60 seconds later", [c.iat, c.exp - c.iat], [T0 / 1000, 60]);
  eq("sso claims: nothing else is in the token (no password, no hub role)", Object.keys(c).sort(), ["aud", "email", "exp", "hub_url", "iat", "iss", "jti", "name", "role", "sub"]);
  eq("sso claims: hub_url says where the hub lives", c.hub_url, process.env.APP_BASE_URL || "https://mccia-apphub.vercel.app");
  eq("sso claims: every token gets its own jti", new Set(Array.from({ length: 500 }, () => buildClaims({ slug: AUD, user: person, role: "user" }).jti)).size, 500);

  // Signing and verifying with the matching public key
  const key = await loadSigningKey(hub.env);
  const token = await signSsoToken(key, buildClaims({ slug: AUD, user: person, role: "user" }));
  const ok1 = await verifySsoToken(token, hub.publicPem, { audience: AUD });
  eq("sso token: three dot-separated parts; header is EdDSA / JWT / hub-1", [token.split(".").length, ok1.header], [3, { alg: "EdDSA", typ: "JWT", kid: "hub-1" }]);
  eq("sso token: verifies with the matching public key and carries the claims", [ok1.claims.iss, ok1.claims.aud, ok1.claims.sub, ok1.claims.email, ok1.claims.name, ok1.claims.role, ok1.claims.exp - ok1.claims.iat],
    [SSO_ISSUER, AUD, person.id, person.email, person.name, "user", 60]);
  eq("sso token: the key id constant is hub-1", SSO_KID, "hub-1");
  eq("sso token: a wrong audience is rejected", await why(() => verifySsoToken(token, hub.publicPem, { audience: "some-other-app" })), "ERR_JWT_CLAIM_VALIDATION_FAILED");
  const old = await signSsoToken(key, buildClaims({ slug: AUD, user: person, role: "user", now: Date.now() - 5 * 60 * 1000 }));
  eq("sso token: an expired token is rejected", await why(() => verifySsoToken(old, hub.publicPem, { audience: AUD })), "ERR_JWT_EXPIRED");
  const fresh = buildClaims({ slug: AUD, user: person, role: "user" });
  const soon = await signSsoToken(key, fresh);
  eq("sso token: valid at 59 seconds, expired at 61", [await why(() => verifySsoToken(soon, hub.publicPem, { audience: AUD, now: new Date((fresh.iat + 59) * 1000) })), await why(() => verifySsoToken(soon, hub.publicPem, { audience: AUD, now: new Date((fresh.iat + 61) * 1000) }))], ["accepted", "ERR_JWT_EXPIRED"]);
  const [h, p, sig] = token.split(".");
  const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
  eq("sso token: a tampered signature is rejected", await why(() => verifySsoToken(`${h}.${p}.${flipped}`, hub.publicPem, { audience: AUD })), "ERR_JWS_SIGNATURE_VERIFICATION_FAILED");
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), role: "admin", email: "someone-else@mcciapune.com" })).toString("base64url");
  eq("sso token: a tampered payload is rejected", await why(() => verifySsoToken(`${h}.${forged}.${sig}`, hub.publicPem, { audience: AUD })), "ERR_JWS_SIGNATURE_VERIFICATION_FAILED");
  const other = pair();
  const strangers = await signSsoToken(await loadSigningKey(other.env), buildClaims({ slug: AUD, user: person, role: "user" }));
  eq("sso token: a token signed by a different key is rejected", await why(() => verifySsoToken(strangers, hub.publicPem, { audience: AUD })), "ERR_JWS_SIGNATURE_VERIFICATION_FAILED");
  eq("sso token: an unsigned (alg none) token is rejected", await why(() => verifySsoToken(`${Buffer.from('{"alg":"none"}').toString("base64url")}.${p}.`, hub.publicPem, { audience: AUD })) === "accepted", false);

  // The key setting
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const keyCode = async (v: string | undefined) => { try { await loadSigningKey(v); return "loaded"; } catch (e) { return e instanceof SsoConfigError ? e.code : String(e); } };
  eq("sso key: missing or blank is key_missing", [await keyCode(undefined), await keyCode(""), await keyCode("   ")], ["key_missing", "key_missing", "key_missing"]);
  eq("sso key: junk, a bare PEM (not base64) and an RSA key are key_invalid", [await keyCode("not-a-key"), await keyCode(Buffer.from("-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----").toString("base64")), await keyCode(Buffer.from(rsa).toString("base64"))], ["key_invalid", "key_invalid", "key_invalid"]);
  eq("sso key: the error carries only its code, never the key", await (async () => { try { await loadSigningKey(hub.env.slice(0, 40)); } catch (e) { return (e as Error).message; } return ""; })(), "key_invalid");
  eq("sso key: surrounding whitespace and a trailing newline are fine", await keyCode(` ${hub.env}\n`), "loaded");
  eq("sso key: the public key is what the private key makes", createPublicKey(Buffer.from(hub.env, "base64").toString()).export({ type: "spki", format: "pem" }), hub.publicPem);

  // Role mapping
  eq("sso role: App Admins get admin in the token, App Staff staff, everyone else user; no other role exists",
    [ssoTokenRole(true), ssoTokenRole(false), ssoTokenRole(false, true), ssoTokenRole(false, false), [...SSO_ROLES]], ["admin", "user", "staff", "user", ["user", "staff", "admin"]]);
  eq("sso role: someone who is both an App Admin and App Staff gets admin", ssoTokenRole(true, true), "admin");

  // Slug rules
  eq("sso slug: valid ones", ["mccia-search", "ab", "a1", "x-y-z", "a".repeat(40), "app2"].map(slugProblem), [null, null, null, null, null, null]);
  eq("sso slug: too short, too long, capitals, spaces, underscores, edge or double hyphens, empty are all refused",
    ["a", "a".repeat(41), "Mccia", "mccia search", "mccia_search", "-abc", "abc-", "a--b", "", "ab/cd", "é-app"].map((x) => slugProblem(x) !== null), Array(11).fill(true));

  // Callback rules
  const APP = "https://search.mcciapune.com";
  const prod = { production: true }, dev = { production: false };
  eq("sso callback: https on the application's own origin is fine, with a path and a query", [
    callbackProblem("https://search.mcciapune.com/api/sso/callback", APP, prod), callbackProblem("https://search.mcciapune.com", APP, prod), callbackProblem("https://search.mcciapune.com/cb?x=1", APP, prod),
    callbackProblem("https://search.mcciapune.com/cb", "https://search.mcciapune.com/app/home", prod),
  ], [null, null, null, null]);
  eq("sso callback: another host, a subdomain, a different port, a lookalike or the parent domain is refused", [
    "https://evil.example.com/cb", "https://x.search.mcciapune.com/cb", "https://search.mcciapune.com:8443/cb", "https://search.mcciapune.com.evil.com/cb", "https://mcciapune.com/cb",
  ].map((u) => callbackProblem(u, APP, prod) !== null), [true, true, true, true, true]);
  eq("sso callback: http is refused in production, even for localhost", [callbackProblem("http://search.mcciapune.com/cb", "http://search.mcciapune.com", prod) !== null, callbackProblem("http://127.0.0.1:3001/cb", "http://127.0.0.1:3001", prod) !== null, callbackProblem("http://localhost:3001/cb", "http://localhost:3001", prod) !== null], [true, true, true]);
  eq("sso callback: outside production http is allowed only for localhost and 127.0.0.1", [
    callbackProblem("http://127.0.0.1:3001/api/sso/callback", "http://127.0.0.1:3001", dev), callbackProblem("http://localhost:3001/cb", "http://localhost:3001", dev),
    callbackProblem("http://search.mcciapune.com/cb", "http://search.mcciapune.com", dev) !== null, callbackProblem("http://192.168.1.5/cb", "http://192.168.1.5", dev) !== null,
  ], [null, null, true, true]);
  eq("sso callback: a user name or password in it is refused", ["https://user@search.mcciapune.com/cb", "https://user:pw@search.mcciapune.com/cb", "https://:pw@search.mcciapune.com/cb"].map((u) => callbackProblem(u, APP, prod) !== null), [true, true, true]);
  eq("sso callback: a #fragment is refused (even an empty one)", ["https://search.mcciapune.com/cb#x", "https://search.mcciapune.com/cb#"].map((u) => callbackProblem(u, APP, prod) !== null), [true, true]);
  eq("sso callback: not an address, other schemes, and a hub path as the application's address are refused", [
    callbackProblem("/api/sso/callback", APP, prod) !== null, callbackProblem("javascript:alert(1)", APP, prod) !== null, callbackProblem("ftp://search.mcciapune.com/cb", APP, prod) !== null,
    callbackProblem("https://search.mcciapune.com/cb", "/approvals", prod) !== null, callbackProblem("", APP, prod) !== null,
  ], [true, true, true, true, true]);

  // The form's own validation (appInput): the same rules, and the old behaviour when the fields are left out
  const base = { departmentId: "6f1c0a52-3f0e-4c58-9a57-0d5f2d7d9a11", name: "MCCIA Search", url: "https://search.mcciapune.com", icon: "Globe" };
  const msg = (x: unknown) => { const r = appInput.safeParse(x); return r.success ? "ok" : r.error.issues[0].message; };
  const parsed = appInput.parse({ ...base, ssoEnabled: true, ssoSlug: " MCCIA-Search ", ssoCallbackUrl: " https://search.mcciapune.com/api/sso/callback " });
  eq("app form: a valid single sign-on setup is accepted, the slug lowercased and both trimmed", [parsed.ssoEnabled, parsed.ssoSlug, parsed.ssoCallbackUrl], [true, "mccia-search", "https://search.mcciapune.com/api/sso/callback"]);
  eq("app form: single sign-on on needs both a slug and a callback", [msg({ ...base, ssoEnabled: true, ssoCallbackUrl: "https://search.mcciapune.com/cb" }).startsWith("Enter an SSO slug"), msg({ ...base, ssoEnabled: true, ssoSlug: "mccia-search" }).startsWith("Enter the callback"), msg({ ...base, ssoEnabled: true, ssoSlug: "", ssoCallbackUrl: "" }).startsWith("Enter an SSO slug")], [true, true, true]);
  eq("app form: a cross-origin callback is refused", msg({ ...base, ssoEnabled: true, ssoSlug: "mccia-search", ssoCallbackUrl: "https://evil.example.com/cb" }).includes("same site"), true);
  eq("app form: a bad slug is refused", msg({ ...base, ssoEnabled: true, ssoSlug: "Bad Slug!", ssoCallbackUrl: "https://search.mcciapune.com/cb" }).includes("SSO slug"), true);
  const legacy = appInput.parse(base);
  eq("app form: an older form that sends no single sign-on fields leaves them alone (undefined, not erased)", [legacy.ssoEnabled, legacy.ssoSlug, legacy.ssoCallbackUrl], [undefined, undefined, undefined]);
  eq("app form: single sign-on off needs neither, and empty strings become null", (() => { const r = appInput.parse({ ...base, ssoEnabled: false, ssoSlug: "", ssoCallbackUrl: "" }); return [r.ssoEnabled, r.ssoSlug, r.ssoCallbackUrl]; })(), [false, null, null]);

  // The hand-off page
  const nonce = "bm9uY2U=";
  const html = autoPostHtml({ callback: 'https://search.mcciapune.com/api/sso/callback?a=1&b="2"', token: "aaa.bbb.ccc", appName: 'Search <b>"x"</b>', nonce });
  eq("sso page: a POST form to the callback with one hidden token field, an auto-submit script with the nonce, and a noscript button", [
    /<form id="sso" method="post" action="https:\/\/search\.mcciapune\.com\/api\/sso\/callback\?a=1&amp;b=&quot;2&quot;">/.test(html),
    (html.match(/<input /g) ?? []).length, html.includes('<input type="hidden" name="token" value="aaa.bbb.ccc">'),
    html.includes(`<script nonce="${nonce}">setTimeout(function(){document.getElementById("sso").submit();},100);</script>`), /<noscript>[\s\S]*<button type="submit">/.test(html),
  ], [true, 1, true, true, true]);
  eq("sso page: the signing-in screen shows the MCCIA logo, the app's name and a spinner, with its one style under the nonce", [
    html.includes('<img class="logo" src="/mccia-logo.png" alt="MCCIA">'), html.includes("Signing you in to Search &lt;b&gt;&quot;x&quot;&lt;/b&gt;…"), html.includes('class="spin"'), html.includes(`<style nonce="${nonce}">`),
  ], [true, true, true, true]);
  eq("sso page: the application's name cannot inject markup", html.includes("<b>") || html.includes('"x"</b>'), false);
  const hd = launchHeaders("https://search.mcciapune.com", nonce);
  eq("sso page headers: never cached, no referrer, never framed, and a policy of nothing but this script and style, the hub's own images and one form target", [
    hd["Cache-Control"], hd["Referrer-Policy"], hd["X-Frame-Options"], hd["Content-Security-Policy"],
  ], ["no-store", "no-referrer", "DENY", `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self'; form-action https://search.mcciapune.com; base-uri 'none'; frame-ancestors 'none'`]);
  eq("sso page: the refusal page says exactly what was asked and links back to the hub", [
    messageHtml("No access", "You don't have access to this app. Ask your administrator.", true).includes("You don't have access to this app. Ask your administrator."),
    messageHtml("No access", "x", true).includes('<a href="/">'), messageHtml("No access", "x").includes("<a "),
  ], [true, true, false]);

  // Sign-in round trip: /launch/<slug> is a safe place to come back to after signing in
  eq("sso sign-in: /login?next=/launch/<slug> sends the person back to the launch address", [safeNext("/launch/mccia-search"), safeNext("//evil.com"), safeNext("https://evil.com")], ["/launch/mccia-search", "/", "/"]);
  // Browsers drop tabs and line breaks from an address: /<tab>/evil.com would open evil.com. Every such character is refused.
  eq("safe next: whitespace, control characters and backslashes never pass",
    ["/\t/evil.com", "/\n/evil.com", "/\r/evil.com", "/ /evil.com", "/\x00x", "/\x7f", "/\\evil.com", "/a\\b", "/ /evil.com"].map(safeNext), Array(9).fill("/"));
  eq("safe next: ordinary paths still pass", ["/", "/approvals/review/hr/pending?x=1", "/administrator/people", "/a%20b"].map(safeNext), ["/", "/approvals/review/hr/pending?x=1", "/administrator/people", "/a%20b"]);
})();

ssoTests.then(() => {
  console.log(`\n${ok}/${ok + bad} unit checks passed`);
  process.exit(bad ? 1 : 0);
}, (e) => {
  console.error("FAIL single sign-on tests crashed:", e);
  process.exit(1);
});

