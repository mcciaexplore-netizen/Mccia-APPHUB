/**
 * The HR Approval form's standard categories: the list in code, the production script that restores it, the older script it grew out of, and
 * the seed must all name the same ones, so the dropdown cannot quietly end up with a different set in one place. Run as part of
 * `npm run test:unit` (tests/unit.ts calls hrCategoriesUnit()).
 */
import { readFileSync } from "node:fs";
import { HR_DOCUMENT_CATEGORIES, HR_EXPENSE_CATEGORIES, STANDARD_HR_CATEGORIES } from "../src/lib/approvals/standard-hr-categories";

type Eq = (name: string, got: unknown, want: unknown) => void;
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

/** The ('Name', n) pairs of the script's wanted(...) list. */
const wanted = (sql: string) => {
  const block = /with wanted\(name, n\) as \(\s*values([\s\S]*?)\)\s*,\s*start as/i.exec(sql)?.[1] ?? "";
  return [...block.matchAll(/\('([^']+)',\s*(\d+)\)/g)].map((m) => ({ name: m[1], n: Number(m[2]) }));
};
/** The lower-case names of the report's `lower(name) in (...)` list. */
const reportNames = (sql: string) => [...(/lower\(btrim\(name\)\) in \(([\s\S]*?)\)\s*;/i.exec(sql)?.[1] ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1]);

export function hrCategoriesUnit(eq: Eq): void {
  const all = [...STANDARD_HR_CATEGORIES];
  const script = wanted(read("../scripts/add-standard-hr-categories.sql"));
  eq("hr categories: 34 standard ones (8 document and notice types + the 26 HR expense categories), none repeated in any capitalisation",
    [all.length, HR_DOCUMENT_CATEGORIES.length, HR_EXPENSE_CATEGORIES.length, new Set(all.map((x) => x.toLowerCase())).size], [34, 8, 26, 34]);
  eq("hr categories: the ones asked for are in: Certificate, Letter, Experience Letter, NOC Letter", ["Certificate", "Letter", "Experience Letter", "NOC Letter"].map((c) => all.includes(c)), [true, true, true, true]);
  eq("hr categories: the production script adds exactly the standard list, in order, numbered 1 to 34", [script.map((s) => s.name), script.map((s) => s.n)], [all, all.map((_, i) => i + 1)]);
  eq("hr categories: the script's report counts exactly the same 34 names", reportNames(read("../scripts/add-standard-hr-categories.sql")).sort(), all.map((x) => x.toLowerCase()).sort());
  eq("hr categories: the earlier 26-category script and the list in code name the same expense categories, in the same order", wanted(read("../scripts/add-hr-categories.sql")).map((s) => s.name), [...HR_EXPENSE_CATEGORIES]);
  eq("hr categories: the seed takes its list from the code, not a list of its own", /STANDARD_HR_CATEGORIES/.test(read("../scripts/seed-approvals.ts")) && !/Experience Certificate/.test(read("../scripts/seed-approvals.ts")), true);
  eq("hr categories: the script only ever adds (never updates or deletes) and never switches one on", /\binsert into apr_hr_categories\b/i.test(read("../scripts/add-standard-hr-categories.sql")) && !/^\s*(update|delete)\b/im.test(read("../scripts/add-standard-hr-categories.sql")) && /on conflict \(lower\(name\)\) do nothing/i.test(read("../scripts/add-standard-hr-categories.sql")), true);
}
