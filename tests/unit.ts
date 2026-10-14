/** Fast checks for the pure helpers: CSV parsing/exporting, the email-domain rule and the Approvals money, date and menu rules. Run: npm run test:unit */
import { parseCsv, toCsv } from "../src/lib/csv";
import { isEmailAllowed } from "../src/lib/domains";
import { canSee, isApprovalsUrl, isModuleEnabled } from "../src/lib/approvals/approvals.manifest";
import {
  assessBudget, budgetWarning, commentRequired, formFor, formatRequestNo, percentUsed, planSteps, utilisationLevel, wrongFormMessage,
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
eq("menu: no role list means everyone", canSee({}, ["requester"]), true);
eq("menu: admin-only item is hidden from a requester and shown to an admin", [canSee({ roles: ["approvals_admin"] }, ["requester"]), canSee({ roles: ["approvals_admin"] }, ["requester", "approvals_admin"])], [false, true]);

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
eq("wrong form: nothing to say when it fits or is empty", [wrongFormMessage("small", 999_900, 1_000_000), wrongFormMessage("large", 1_000_000, 1_000_000), wrongFormMessage("small", null, 1_000_000), wrongFormMessage("small", 0, 1_000_000)], [null, null, null, null]);

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

// Approvals: decisions, utilisation, numbers.
eq("comment: needed to reject, and to approve over budget", [commentRequired("reject", false), commentRequired("approve", true), commentRequired("approve", false)], [true, true, false]);
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

console.log(`\n${ok}/${ok + bad} unit checks passed`);
process.exit(bad ? 1 : 0);
