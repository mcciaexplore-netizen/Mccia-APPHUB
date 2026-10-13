/** Fast checks for the pure helpers: CSV parsing/exporting, the email-domain rule and the Approvals money, date and menu rules. Run: npm run test:unit */
import { parseCsv, toCsv } from "../src/lib/csv";
import { isEmailAllowed } from "../src/lib/domains";
import { canSee, isApprovalsUrl } from "../src/lib/approvals/approvals.manifest";
import { financialYearOf, formatDate, formatDateTime, formatINR, isFinancialYear, parseINR, recentFinancialYears } from "../src/lib/approvals/format";

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

// Approvals: which hub card is the module, and who sees which menu item.
eq("card url: path, full address and trailing slash match", [isApprovalsUrl("/approvals"), isApprovalsUrl("https://hub.mccia.org/approvals"), isApprovalsUrl("https://hub.mccia.org/approvals/")], [true, true, true]);
eq("card url: other paths do not", [isApprovalsUrl("https://x.org/approvals/admin"), isApprovalsUrl("https://x.org/other"), isApprovalsUrl("/approvals-old")], [false, false, false]);
eq("menu: no role list means everyone", canSee({}, ["requester"]), true);
eq("menu: admin-only item is hidden from a requester and shown to an admin", [canSee({ roles: ["approvals_admin"] }, ["requester"]), canSee({ roles: ["approvals_admin"] }, ["requester", "approvals_admin"])], [false, true]);

console.log(`\n${ok}/${ok + bad} unit checks passed`);
process.exit(bad ? 1 : 0);
