/**
 * End-to-end test of the Approvals module in a real browser: where it opens, the one expense form, the admin pages behind the
 * Administrator lock, the masters and category merge, who may read and write what, the viewer grant, and settings. Run:
 *   E2E_BASE_URL=http://localhost:3000 npm run test:e2e:approvals
 *
 * It WRITES to the database the site uses, but only rows whose names start with "ZZ"/"zz-": a test department holding an old-style app card
 * pointing at /approvals (to check it is hidden), two test people, a test branch and categories. Everything is removed when it finishes (and at the start, in case
 * an earlier run was interrupted), and the seeded masters are checked to be unchanged.
 * Optional: E2E_OFF_URL = a second server started with APPROVALS_ENABLED=false, to check that the module disappears.
 * Env: E2E_BROWSER = chromium (default) | firefox | webkit, E2E_CHROME_CHANNEL (default "chrome").
 */
import { createRequire } from "node:module";
import { randomBytes, scryptSync } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const req = createRequire(ROOT + "/package.json");
req("dotenv").config({ path: ROOT + "/.env.local", quiet: true });
req("dotenv").config({ path: ROOT + "/.env", quiet: true });
const BASE = (process.env.E2E_BASE_URL || "").replace(/\/$/, "");
const OFF = (process.env.E2E_OFF_URL || "").replace(/\/$/, "");
if (!BASE) { console.error("Set E2E_BASE_URL, for example: E2E_BASE_URL=http://localhost:3000 npm run test:e2e:approvals"); process.exit(2); }
if (/neon\.tech/i.test(process.env.DATABASE_URL || "") && process.env.E2E_ALLOW_NEON !== "yes") { console.error("DATABASE_URL is a Neon address. Point it (and the site) at a test database, or a Neon branch with E2E_ALLOW_NEON=yes."); process.exit(2); }
const ADMIN_EMAIL = (process.env.SUPPORT_ADMIN_EMAIL || process.env.HEAD_ADMIN_EMAIL || "").trim().toLowerCase();
const ADMIN_PW = (process.env.SUPPORT_ADMIN_PASSWORD || process.env.HEAD_ADMIN_PASSWORD || "").trim();
if (!ADMIN_EMAIL || !ADMIN_PW) { console.error("HEAD_ADMIN_EMAIL and HEAD_ADMIN_PASSWORD must be set: the suite signs in as the main admin."); process.exit(2); }

// The same query helper for both database drivers the app supports (DB_DRIVER=neon, the default, or DB_DRIVER=pg for a local Postgres).
const rawSql = (() => {
  if ((process.env.DB_DRIVER ?? "neon") !== "pg") return req("@neondatabase/serverless").neon(process.env.DATABASE_URL);
  const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(process.env.DATABASE_URL || "");
  const pool = new (req("pg").Pool)({ connectionString: process.env.DATABASE_URL, max: 4, ssl: local ? false : { rejectUnauthorized: true } });
  return async (strings, ...values) => (await pool.query(strings.reduce((q, s, i) => q + (i ? `$${i}` : "") + s, ""), values)).rows;
})();
const retry = async (fn, tries = 8, waitMs = 3000) => { let last; for (let i = 0; i < tries; i++) { try { return await fn(); } catch (e) { last = e; await new Promise((r) => setTimeout(r, waitMs)); } } throw last; };
const sql = (...a) => retry(() => rawSql(...a));
const playwright = req("playwright-core");
const BROWSER = process.env.E2E_BROWSER || "chromium";
const launch = () => BROWSER === "chromium"
  ? playwright.chromium.launch({ channel: process.env.E2E_CHROME_CHANNEL || "chrome", headless: true }).catch(() => playwright.chromium.launch({ headless: true }))
  : playwright[BROWSER].launch({ headless: true });

const results = [];
const check = (name, ok, extra = "") => { results.push([name, !!ok]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? "  -> " + String(extra).slice(0, 200) : ""}`); };
const section = (t) => console.log(`\n== ${t} ==`);
const poll = async (fn, ms = 20000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 400)); } return v; };
const hash = (pw) => { const salt = randomBytes(16); return `scrypt$16384$${salt.toString("base64")}$${scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("base64")}`; };
const MEMBER = { email: "zz-apr-member@example.com", pw: "zz-Member-pass-1" };
const OUTSIDER = { email: "zz-apr-outsider@example.com", pw: "zz-Outsider-pass-1" };
const startedAt = new Date();

const removeTestData = async () => {
  const ids = (await sql`select id from users where email like 'zz-apr-%'`).map((r) => r.id);
  for (const id of ids) {
    await sql`delete from apr_user_roles where user_id = ${id}`;
    await sql`delete from user_app_access where user_id = ${id}`;
    await sql`delete from activity_log where user_id = ${id}`;
  }
  await sql`delete from login_attempts where email like 'zz-apr-%'`;
  await sql`delete from users where email like 'zz-apr-%'`;
  await sql`delete from apr_categories where name like 'ZZ%'`;
  await sql`delete from apr_branches where name like 'ZZ%'`;
  await sql`delete from apr_publications where name like 'ZZ%'`;
  await sql`delete from apr_publication_types where name like 'ZZ%'`;
  await sql`delete from apr_admin_audit where summary like '%ZZ%' or created_at >= ${new Date(startedAt.getTime() - 60000)}`;
  await sql`delete from apps where name like 'ZZ Apr%'`;
  await sql`delete from departments where name like 'ZZ Apr%'`;
};
const seeded = async () => JSON.stringify([
  await sql`select name, active from apr_categories where name not like 'ZZ%' order by name`,
  await sql`select name, active from apr_hr_categories order by name`,
  await sql`select key, value from apr_settings order by key`,
]);

await removeTestData();
const before = await seeded();
const browser = await launch();
// The "Download the app" popup and banner are marked as already seen in every test browser, so they never cover a button.
{ const open = browser.newContext.bind(browser); browser.newContext = async (o) => { const c = await open(o); await c.addInitScript(() => { try { localStorage.setItem("mccia-install-popup-seen", "1"); localStorage.setItem("mccia-install-snoozed-until", String(Date.now() + 864e5)); } catch {} }); return c; }; }
const consoleErrors = [], pageErrors = [];
const newSession = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 1000 } });
  ctx.setDefaultTimeout(60000); ctx.setDefaultNavigationTimeout(90000);
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Content Security Policy/.test(m.text())) consoleErrors.push(m.text().slice(0, 160)); });
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 160)));
  return { ctx, page };
};
const signIn = async (page, email, password) => {
  await page.goto(BASE + "/login");
  await page.locator("input[name=email]").fill(email);
  await page.locator("input[name=password]").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => u.pathname !== "/login" || u.search.includes("error"), { timeout: 25000 }).catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
};
const unlock = async (page) => {
  if (new URL(page.url()).pathname !== "/unlock") return;
  await page.locator("input[name=password]").fill(ADMIN_PW); await page.getByRole("button", { name: "Unlock" }).click();
  await page.waitForURL((u) => u.pathname !== "/unlock", { timeout: 20000 }).catch(() => {});
};
const toast = (page, t) => page.getByText(t).first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
const status = async (page, p, opts) => (await page.goto(BASE + p, opts)).status();
const main = (page) => page.locator("main").first().innerText();
const inOrder = (text, labels) => labels.every((l, i) => { const at = text.indexOf(l, i === 0 ? 0 : text.indexOf(labels[i - 1]) + labels[i - 1].length); return at >= 0; });

try {
  section("0. Setup: an old-style card pointing at /approvals, and two ordinary people (neither is given anything)");
  const [dept] = await sql`insert into departments (name, icon, sort_order) values ('ZZ Apr Dept', 'Building2', 9999) returning id`;
  const [card] = await sql`insert into apps (department_id, name, url, icon) values (${dept.id}, 'ZZ Apr Card', '/approvals', 'ClipboardList') returning id`;
  const [member] = await sql`insert into users (name, email, password_hash, status) values ('ZZ Apr Member', ${MEMBER.email}, ${hash(MEMBER.pw)}, 'approved') returning id`;
  await sql`insert into users (name, email, password_hash, status) values ('ZZ Apr Outsider', ${OUTSIDER.email}, ${hash(OUTSIDER.pw)}, 'approved')`;
  check("test card, department and people created", !!member && !!card);

  section("1. Signed out");
  {
    const { ctx, page } = await newSession();
    for (const p of ["/approvals", "/approvals/admin/categories", "/api/approvals/masters/categories"]) {
      await page.goto(BASE + p);
      check(`signed out, ${p} goes to the login page`, new URL(page.url()).pathname === "/login", page.url());
    }
    await ctx.close();
  }

  section("2. The Support Admin: the module and its two forms");
  const admin = await newSession();
  const A = admin.page;
  await signIn(A, ADMIN_EMAIL, ADMIN_PW);
  check("/approvals opens", (await status(A, "/approvals")) === 200);
  check("it is the Approval Forms page, with the HR and Expenditure forms", (await A.locator("main h1").first().innerText()) === "Approval Forms" && (await A.getByRole("link", { name: /HR Approval Form/ }).getAttribute("href")) === "/approvals/hr/new" && (await A.getByRole("link", { name: /Expenditure Approval Form/ }).getAttribute("href")) === "/approvals/expenses/new");
  check("the Approval System has its own sidebar, with the HR and Expenditure lists for the Support Admin", /Pending HR Approvals/.test(await A.locator('nav[aria-label="Approval System"]').innerText()) && /Pending Expenditure Approvals/.test(await A.locator('nav[aria-label="Approval System"]').innerText()));
  await A.getByRole("link", { name: /Expenditure Approval Form/ }).click();
  await A.waitForURL(/\/approvals\/expenses\/new$/);
  const expText = await main(A);
  check("the expense form is one form for every amount, with its fields in order", inOrder(expText, ["Name", "Email", "Date", "Category", "Nature of Expenditure", "File upload", "Type of Publication", "Vendor Name", "Tax Invoice", "Quotation", "Date of Tax Invoice", "Amount"]), expText.replace(/\s+/g, " ").slice(0, 200));
  await A.locator("input#ex-amount").fill("25000");
  check("typing ₹10,000 or more keeps the same fields, and says it goes on to the DG", /goes on to the Director General|recommends it to the Director General/i.test(await main(A)) && /Tax Invoice/.test(await main(A)) && /Type of Publication/.test(await main(A)));
  check("the old ₹10,000+ address opens the same form", (await A.goto(BASE + "/approvals/expenditures/new").then(() => new URL(A.url()).pathname)) === "/approvals/expenses/new");
  await A.goto(BASE + "/approvals/hr/new");
  const hrMain = await main(A);
  check("the HR form shows its fields in order", inOrder(hrMain, ["Name", "Email", "Category", "Date of Request", "Amount", "Description", "File upload"]), hrMain.replace(/\s+/g, " ").slice(0, 160));
  check("the budget pages that were removed are gone (404)", (await status(A, "/approvals/budgets")) === 404 && (await status(A, "/approvals/budgets/utilisation")) === 404);
  check("a path that is not in the menu is a 404", (await status(A, "/approvals/definitely/not/here")) === 404);

  section("3. The Approval System on the home page: a card of its own, never an application");
  await A.goto(BASE + "/");
  const homeText = await main(A);
  check("the home page has the Approval System card, and no old Approvals application card", /Approval System/.test(homeText) && !homeText.includes("ZZ Apr Card"));
  check("an old Approvals card cannot be launched", (await A.request.get(`${BASE}/go/${card.id}`, { maxRedirects: 0 })).status() === 404);

  section("4. The admin pages and the admin API are behind the Administrator lock");
  await A.goto(BASE + "/approvals/admin/categories");
  check("opening an admin page asks for the password first, and comes back to it", new URL(A.url()).pathname === "/unlock" && new URL(A.url()).searchParams.get("next") === "/approvals/admin/categories");
  const lockedWrite = await A.request.post(`${BASE}/api/approvals/masters/branches`, { data: { name: "ZZ Locked Branch" } });
  check("while locked, a change through the admin API is refused", lockedWrite.status() === 403 && (await sql`select count(*)::int n from apr_branches where name = 'ZZ Locked Branch'`)[0].n === 0);
  await unlock(A);
  check("after unlocking, the page opens", new URL(A.url()).pathname === "/approvals/admin/categories");
  check("the admin pages that were removed are gone (404): routing rules, setup", (await status(A, "/approvals/admin/rules")) === 404 && (await status(A, "/approvals/admin/setup")) === 404);

  section("5. Branches through the API: add, reject duplicates and blanks, deactivate");
  const addB = await A.request.post(`${BASE}/api/approvals/masters/branches`, { data: { name: "ZZ Branch One" } });
  check("a branch can be added", addB.status() === 201 || addB.status() === 200, addB.status());
  const [branch] = await sql`select * from apr_branches where name = 'ZZ Branch One'`;
  check("the branch is saved and active", branch && branch.active);
  const dupB = await A.request.post(`${BASE}/api/approvals/masters/branches`, { data: { name: "zz branch  ONE" } });
  check("the same name in another case or spacing is refused", dupB.status() === 409 && /already exists/.test(await dupB.text()));
  check("a blank name is a 400", (await A.request.post(`${BASE}/api/approvals/masters/branches`, { data: { name: "   " } })).status() === 400);
  check("a branch can be switched off", (await A.request.patch(`${BASE}/api/approvals/masters/branches/${branch.id}`, { data: { active: false } })).status() === 200 && (await sql`select active from apr_branches where id = ${branch.id}`)[0].active === false);

  section("6. Categories and the category merge");
  await A.goto(BASE + "/approvals/admin/categories");
  await A.getByLabel(/New category/i).fill("ZZ Cat Page");
  await A.getByRole("button", { name: "Add category" }).click();
  check("a category can be added on its page", await toast(A, "added") && await poll(async () => (await sql`select count(*)::int n from apr_categories where name = 'ZZ Cat Page'`)[0].n === 1));
  const cat = await (await A.request.post(`${BASE}/api/approvals/masters/categories`, { data: { name: "ZZ Cat A", duplicateGroup: "zz-dup" } })).json();
  const catB = await (await A.request.post(`${BASE}/api/approvals/masters/categories`, { data: { name: "ZZ Cat B", duplicateGroup: "zz-dup", aliases: ["ZZ Old Spelling"] } })).json();
  check("categories can be created through the API", cat.ok && catB.ok);
  const merge = await A.request.post(`${BASE}/api/approvals/category-merge`, { data: { sourceId: cat.item.id, targetId: catB.item.id } });
  check("merge succeeds", merge.status() === 200, merge.status());
  const [src] = await sql`select * from apr_categories where id = ${cat.item.id}`;
  const [tgt] = await sql`select * from apr_categories where id = ${catB.item.id}`;
  check("the source is inactive, points at the target and is no longer flagged", !src.active && src.merged_into_id === tgt.id && src.duplicate_group === null);
  check("the target keeps its alias and gains the source's name", tgt.aliases.includes("ZZ Old Spelling") && tgt.aliases.includes("ZZ Cat A"), tgt.aliases.join(" | "));
  check("merging into a merged category is refused, and so is merging one into itself", (await A.request.post(`${BASE}/api/approvals/category-merge`, { data: { sourceId: cat.item.id, targetId: catB.item.id } })).status() === 409 && (await A.request.post(`${BASE}/api/approvals/category-merge`, { data: { sourceId: catB.item.id, targetId: catB.item.id } })).status() === 400);

  section("7. An ordinary person with a hub login and no module role");
  const mem = await newSession();
  const M = mem.page;
  await signIn(M, MEMBER.email, MEMBER.pw);
  check("they can open /approvals with no card and no grant, and see the two forms", (await status(M, "/approvals")) === 200 && (await M.getByRole("link", { name: /^(HR|Expenditure) Approval Form/ }).count()) === 2);
  check("their Approval System sidebar has the forms and their approved forms only", (await M.locator('nav[aria-label="Approval System"] a').allInnerTexts()).map((t) => t.replace(/\d+$/, "").trim()).join("|") === "Approval Forms|Approved Forms");
  const forms = [await status(M, "/approvals/hr/new"), await status(M, "/approvals/expenses/new")];
  check("both forms open for them", forms.every((st) => st === 200), forms.join(","));
  const listPaths = ["/approvals/hr/all", "/approvals/expenditures/all", "/approvals/inbox", "/approvals/my/completed", "/approvals/timeline", "/approvals/hr/report", "/approvals/hr/approval-time", "/approvals/review/hr/pending", "/approvals/review/expenditure/pending"];
  const listStatuses = []; for (const lp of listPaths) listStatuses.push(await status(M, lp));
  check("every list, timeline and report is a 404 for them: forms only", listStatuses.every((st) => st === 404), listStatuses.join(","));
  check("the CSV export is closed to them (403)", (await M.request.get(`${BASE}/api/approvals/requests/export?screen=hr/all`)).status() === 403);
  await M.goto(BASE + "/approvals/admin/categories");
  check("the admin pages are not theirs: they end up away from them", !new URL(M.url()).pathname.startsWith("/approvals/admin"), M.url());
  const read = await M.request.get(`${BASE}/api/approvals/masters/categories`);
  check("they can read the active categories (for the dropdowns), not the inactive ones", read.status() === 200 && (await read.json()).items.some((i) => i.name === "ZZ Cat B") && !(await (await M.request.get(`${BASE}/api/approvals/masters/categories?all=1`)).json()).items.some((i) => i.name === "ZZ Cat A"));
  check("they cannot add a branch, merge categories or change roles (403)", (await M.request.post(`${BASE}/api/approvals/masters/branches`, { data: { name: "ZZ Sneaky" } })).status() === 403 && (await M.request.post(`${BASE}/api/approvals/category-merge`, { data: { sourceId: tgt.id, targetId: tgt.id } })).status() === 403 && (await M.request.put(`${BASE}/api/approvals/roles`, { data: { userId: member.id, role: "approvals_admin", granted: true } })).status() === 403);
  check("no row was created by the refused calls", (await sql`select count(*)::int n from apr_branches where name = 'ZZ Sneaky'`)[0].n === 0);

  section("8. Granting viewer in Roles and Access");
  await A.goto(BASE + "/approvals/admin/access"); await unlock(A);
  await A.getByRole("switch", { name: "ZZ Apr Member is a viewer" }).click();
  check("the grant is stored", await poll(async () => (await sql`select count(*)::int n from apr_user_roles where user_id = ${member.id} and role = 'viewer'`)[0].n === 1));
  check("with it, the lists and the CSV export open", (await status(M, "/approvals/hr/all")) === 200 && (await status(M, "/approvals/review/hr/pending")) === 200 && (await M.request.get(`${BASE}/api/approvals/requests/export?screen=hr/all`)).status() === 200);
  await A.goto(BASE + "/approvals/admin/access"); await unlock(A);
  await A.getByRole("switch", { name: "ZZ Apr Member is a viewer" }).click();
  await poll(async () => (await sql`select count(*)::int n from apr_user_roles where user_id = ${member.id} and role = 'viewer'`)[0].n === 0);
  check("and they close with it: forms only again", (await status(M, "/approvals/hr/all")) === 404 && (await M.request.get(`${BASE}/api/approvals/requests/export?screen=hr/all`)).status() === 403 && (await status(M, "/approvals/hr/new")) === 200);

  section("9. The forms are for everyone who signs in; nothing has to be ticked");
  const out = await newSession();
  await signIn(out.page, OUTSIDER.email, OUTSIDER.pw);
  check("a second ordinary person, with nothing ticked, can open /approvals and both forms", (await status(out.page, "/approvals")) === 200 && (await status(out.page, "/approvals/hr/new")) === 200 && (await status(out.page, "/approvals/expenses/new")) === 200);
  check("the dropdown lists answer them, the lists do not", (await out.page.request.get(`${BASE}/api/approvals/masters/categories`)).status() === 200 && (await status(out.page, "/approvals/hr/all")) === 404);

  section("10. Writes from another site are refused");
  const evil = await A.request.post(`${BASE}/api/approvals/masters/branches`, { data: { name: "ZZ Cross Site" }, headers: { Origin: "https://evil.example" } });
  check("a write carrying a foreign Origin is a 403, and nothing is written", evil.status() === 403 && (await sql`select count(*)::int n from apr_branches where name = 'ZZ Cross Site'`)[0].n === 0);

  section("11. Settings and the audit log");
  await A.goto(BASE + "/approvals/admin/settings"); await unlock(A);
  check("the threshold shows as 10,000.00", (await A.locator("input[inputmode=decimal]").first().inputValue()) === "10,000.00");
  const badSettings = await A.request.put(`${BASE}/api/approvals/settings`, { data: { thresholdPaise: 0, reminderAfterHours: 48, largeFormShowQuotation: true, notifyApproverOnAssignment: true, notifyRequesterOnOutcome: true, notifyAdminOnImportErrors: true } });
  check("a zero threshold is refused", badSettings.status() === 400);
  await A.goto(BASE + "/approvals/admin/audit"); await unlock(A);
  const audit = await main(A);
  check("the audit log lists the branch, merge and role changes made above", /ZZ Branch One/.test(audit) && /Merged category "ZZ Cat A" into "ZZ Cat B"/.test(audit) && /viewer/.test(audit), audit.slice(0, 300).replace(/\s+/g, " "));
  check("and names who did it", audit.includes(process.env.SUPPORT_ADMIN_NAME || process.env.HEAD_ADMIN_NAME || ADMIN_EMAIL));

  section("12. Console, untouched data and the module switch");
  check("no browser console or page errors on any screen", consoleErrors.length === 0 && pageErrors.length === 0, [...consoleErrors, ...pageErrors].join(" | "));
  if (OFF) {
    const off = await newSession();
    const offStatus = async (pp) => (await off.page.goto(OFF + pp)).status();
    await signIn(off.page, ADMIN_EMAIL, ADMIN_PW);
    check("with the module switched off, /approvals is a 404 even for the Support Admin, and so is the API", (await offStatus("/approvals")) === 404 && (await off.page.request.get(OFF + "/api/approvals/masters/categories")).status() === 404);
    await off.page.goto(OFF + "/");
    check("and the home page has no Approval System card", !/Approval System/.test(await off.page.locator("main").first().innerText()));
  } else console.log("(skipped: set E2E_OFF_URL to a server started with APPROVALS_ENABLED=false to check the switch)");
} catch (e) {
  check("the suite ran to the end without an unexpected error", false, e.stack || e);
} finally {
  await browser.close().catch(() => {});
  await removeTestData().catch((e) => console.error("CLEANUP FAILED, run again to retry:", e.message));
  check("the categories, HR categories and settings are exactly as before", (await seeded()) === before);
}

const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
