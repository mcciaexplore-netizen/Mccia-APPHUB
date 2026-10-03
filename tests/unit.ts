/** Fast checks for the pure helpers: CSV parsing/exporting and the email-domain rule. Run: npm run test:unit */
import { parseCsv, toCsv } from "../src/lib/csv";
import { isEmailAllowed } from "../src/lib/domains";

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

console.log(`\n${ok}/${ok + bad} unit checks passed`);
process.exit(bad ? 1 : 0);
