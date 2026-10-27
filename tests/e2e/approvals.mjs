/**
 * End-to-end test of the Approvals module in a real browser. Run: E2E_BASE_URL=http://localhost:3000 npm run test:e2e:approvals
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
// Waits (up to a limit) for a database change the app makes in the background; a toast from an earlier action may still be on screen.
const poll = async (fn, ms = 20000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 400)); } return v; };

// The hub stores passwords as scrypt$N$salt$hash; a test person needs one to sign in.
const hash = (pw) => { const salt = randomBytes(16); return `scrypt$16384$${salt.toString("base64")}$${scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("base64")}`; };
const MEMBER = { email: "zz-apr-member@example.com", pw: "zz-Member-pass-1" };
const OUTSIDER = { email: "zz-apr-outsider@example.com", pw: "zz-Outsider-pass-1" };

const removeTestData = async () => {
  const ids = (await sql`select id from users where email like 'zz-apr-%'`).map((r) => r.id);
  for (const id of ids) {
    await sql`delete from apr_user_roles where user_id = ${id}`;
    await sql`delete from user_app_access where user_id = ${id}`;
    await sql`delete from activity_log where user_id = ${id}`;
  }
  await sql`delete from users where email like 'zz-apr-%'`;
  await sql`delete from apr_categories where name like 'ZZ%'`;
  await sql`delete from apr_branches where name like 'ZZ%'`;
  await sql`delete from apr_publications where name like 'ZZ%'`;
  await sql`delete from apr_publication_types where name like 'ZZ%'`;
  await sql`delete from apr_admin_audit where summary like '%ZZ%'`;
  await sql`delete from apps where name like 'ZZ Apr%'`;
  await sql`delete from departments where name like 'ZZ Apr%'`;
};
const seeded = async () => ({
  categories: (await sql`select count(*)::int n from apr_categories where name not like 'ZZ%'`)[0].n,
  hr: (await sql`select count(*)::int n from apr_hr_categories`)[0].n,
  rules: (await sql`select count(*)::int n from apr_approver_rules`)[0].n,
});

await removeTestData();
const before = await seeded();
const browser = await launch();
// The "Download the app" popup and banner are marked as already seen in every test browser, so they never cover a button.
{ const open = browser.newContext.bind(browser); browser.newContext = async (o) => { const c = await open(o); await c.addInitScript(() => { try { localStorage.setItem("mccia-install-popup-seen", "1"); localStorage.setItem("mccia-install-snoozed-until", String(Date.now() + 864e5)); } catch {} }); return c; }; }
const consoleErrors = [], pageErrors = [];

const newSession = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 1000 } });
  ctx.setDefaultTimeout(60000); ctx.setDefaultNavigationTimeout(90000); // a dev server compiles each page on first visit
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) consoleErrors.push(m.text().slice(0, 160)); });
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 160)));
  return { ctx, page };
};
const signIn = async (page, email, password) => {
  await page.goto(BASE + "/login");
  await page.locator("input[name=email]").fill(email);
  await page.locator("input[name=password]").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForFunction(() => location.pathname !== "/login" || location.search.includes("error"), null, { timeout: 25000 }).catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
};
// An application's menu used to be a row of section tabs and a row of pages under it; there is none now, only the form or list itself.
const menuRows = (page) => page.locator('main nav[aria-label$=" sections"], main nav[aria-label$=" pages"]');
const hubApps = (page) => page.locator("aside:visible nav a[href^='/approvals/']");
const toast = (page, t) => page.getByText(t).first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
const status = async (page, p, opts) => (await page.goto(BASE + p, opts)).status();

try {
  section("0. Setup: an old-style card pointing at /approvals, and two ordinary people (neither is given anything)");
  const [dept] = await sql`insert into departments (name, icon, sort_order) values ('ZZ Apr Dept', 'Building2', 9999) returning id`;
  const [card] = await sql`insert into apps (department_id, name, url, icon) values (${dept.id}, 'ZZ Apr Card', '/approvals', 'ClipboardList') returning id`;
  const [member] = await sql`insert into users (name, email, password_hash, status) values ('ZZ Apr Member', ${MEMBER.email}, ${hash(MEMBER.pw)}, 'approved') returning id`;
  await sql`insert into users (name, email, password_hash, status) values ('ZZ Apr Outsider', ${OUTSIDER.email}, ${hash(OUTSIDER.pw)}, 'approved')`;
  check("test card, department and people created", true && !!member);

  section("1. Signed out");
  {
    const { ctx, page } = await newSession();
    for (const p of ["/approvals", "/approvals/admin/categories", "/api/approvals/masters/categories"]) {
      await page.goto(BASE + p);
      check(`signed out, ${p} goes to the login page`, new URL(page.url()).pathname === "/login", page.url());
    }
    await ctx.close();
  }

  section("2. Admin: the module opens, and there is no application menu");
  const admin = await newSession();
  const A = admin.page;
  await signIn(A, ADMIN_EMAIL, ADMIN_PW);
  check("/approvals opens for the head admin", (await status(A, "/approvals")) === 200);
  check("opening /approvals shows the Approval System page: the two form cards, HR Approval Form and Expenditure Approval Form", new URL(A.url()).pathname === "/approvals" && (await A.locator("main h1").first().innerText()) === "Approval System" && (await A.getByRole("link", { name: /HR Approval Form/ }).getAttribute("href")) === "/approvals/hr/new" && (await A.getByRole("link", { name: /Expenditure Approval Form/ }).getAttribute("href")) === "/approvals/expenses/new", A.url());
  check("it opens inside the hub: the sidebar is still there, and its Approval System item is one link (no dropdown) that marks the page you are on", (await A.locator("aside:visible nav", { hasText: "Administrator" }).count()) >= 1 && (await A.locator('aside:visible nav a[href="/approvals"]').first().getAttribute("aria-current")) === "page" && (await A.locator("aside:visible nav button", { hasText: "Approval System" }).count()) === 0);
  await A.getByRole("link", { name: /Expenditure Approval Form/ }).click();
  await A.waitForURL(/\/approvals\/expenses\/new$/);
  check("the Expenditure card opens the Expenses form, inside the application titled Expenditure", (await A.locator("main h1").first().innerText()) === "Expenditure" && (await A.locator("main h2").first().innerText()) === "Expenses");
  check("the Expenses form has no application menu: no row of sections and no row of pages", (await menuRows(A).count()) === 0);
  await A.goto(BASE + "/approvals");
  await A.getByRole("link", { name: /HR Approval Form/ }).click();
  await A.waitForURL(/\/approvals\/hr\/new$/);
  check("the HR card opens the HR form beside the sidebar, titled HR Approval (not DG Approval)", (await A.locator("main h1").first().innerText()) === "HR Approval");
  check("the HR form has no application menu either, and nothing in the application is still called DG Approval", (await menuRows(A).count()) === 0 && !/DG Approval/.test(await A.locator("main").first().innerText()));
  await A.goto(BASE + "/approvals/hr/new");
  check("the old Setup page is gone (404)", (await status(A, "/approvals/admin/setup")) === 404 && (await status(A, "/approvals/hr/timeline")) === 404);
  await A.goto(BASE + "/approvals/admin/rules");
  check("the Setup checklist is a collapsed section at the bottom of Approver Rules", (await A.locator("details", { hasText: "Setup checklist" }).count()) === 1 && (await A.locator("details", { hasText: "Setup checklist" }).evaluate((el) => el.open)) === false);
  await A.locator("summary", { hasText: "Setup checklist" }).click();
  const home = await A.locator("main").first().innerText();
  check("opened, it shows the checklist", /Setup checklist/.test(home) && /Expense categories/.test(home));
  check("setup checklist counts the 40 seeded categories", /40 active/.test(home), home.match(/\d+ active/)?.[0]);
  check("setup checklist flags the kinds of request that still have no approver", /of 3 kinds of request have an approver/.test(home), home.match(/\d+ of \d+ kinds[^\n]*/)?.[0]);

  section("3. The HR form opens, and unknown pages");
  await A.goto(BASE + "/approvals/hr/new");
  const hrMain = await A.locator("main").first().innerText();
  check("the HR form shows the Zoho fields in order", ["Name", "Email", "Category", "Date of Request", "Amount", "Description", "File upload"].every((l, i, a) => hrMain.includes(l) && (i === 0 || hrMain.indexOf(l) > hrMain.indexOf(a[i - 1]))), hrMain.replace(/\s+/g, " ").slice(0, 160));
  check("a path that is not in the menu is a 404", (await status(A, "/approvals/definitely/not/here")) === 404);

  section("4. Approvals in the hub: a sidebar item, not an application");
  await A.goto(BASE + "/");
  const hubMenu = await A.locator("aside:visible nav").first().innerText();
  check("the hub sidebar has one Approval System link, not a dropdown", /Approval System/.test(hubMenu) && (await A.locator("aside:visible nav a", { hasText: "Approval System" }).count()) === 1 && (await A.locator("aside:visible nav button", { hasText: "Approval System" }).count()) === 0);
  check("a department holding only an old Approvals card is not listed", !hubMenu.includes("ZZ Apr Dept"), hubMenu.replace(/\s+/g, " ").slice(0, 120));
  check("an old Approvals card cannot be launched", (await A.request.get(`${BASE}/go/${card.id}`, { maxRedirects: 0 })).status() === 404);
  await A.locator("aside:visible nav a", { hasText: "Approval System" }).click();
  await A.waitForURL(/\/approvals$/);
  check("clicking it opens the Approval System page, with the two form cards", (await A.getByRole("link", { name: /Approval Form/ }).count()) === 2);
  await A.getByRole("link", { name: /Expenditure Approval Form/ }).click();
  await A.waitForURL(/\/approvals\/expenses\/new$/);
  check("choosing the Expenditure card opens the application in the same tab, on the Expenses form", await poll(async () => new URL(A.url()).pathname === "/approvals/expenses/new" && (await A.locator("main h2").first().innerText()) === "Expenses"), A.url());

  section("5. Branches: add, reject duplicates and blanks, deactivate, audit");
  await A.goto(BASE + "/approvals/admin/branches");
  await A.getByLabel("New branch").fill("ZZ Branch One");
  await A.getByRole("button", { name: "Add branch" }).click();
  check("adding a branch shows a success message", await toast(A, "Branch added"));
  const [branch] = await sql`select * from apr_branches where name = 'ZZ Branch One'`;
  check("the branch is saved and active", branch && branch.active);
  await A.getByLabel("New branch").fill("zz branch  ONE");
  await A.getByRole("button", { name: "Add branch" }).click();
  check("the same name in another case or spacing is refused", await toast(A, "That already exists."));
  const dup = await A.request.post(`${BASE}/api/approvals/masters/branches`, { data: { name: "   " } });
  check("a blank name is a 400", dup.status() === 400);
  await A.getByRole("row", { name: /ZZ Branch One/ }).getByRole("button", { name: "Active" }).click();
  check("deactivating shows a message", await toast(A, "Branch deactivated"));
  check("the branch is now inactive in the database", (await sql`select active from apr_branches where id = ${branch.id}`)[0].active === false);
  await A.request.patch(`${BASE}/api/approvals/masters/branches/${branch.id}`, { data: { active: true } });

  section("6. Categories, and no budget pages: the requester types the budget on the form");
  const cat = await (await A.request.post(`${BASE}/api/approvals/masters/categories`, { data: { name: "ZZ Cat A", duplicateGroup: "zz-dup" } })).json();
  const catB = await (await A.request.post(`${BASE}/api/approvals/masters/categories`, { data: { name: "ZZ Cat B", duplicateGroup: "zz-dup", aliases: ["ZZ Old Spelling"] } })).json();
  check("categories can be created through the API", cat.ok && catB.ok);
  check("the Budgets and Budget Utilisation pages no longer exist, even for the Support Admin", (await status(A, "/approvals/budgets")) === 404 && (await status(A, "/approvals/budgets/utilisation")) === 404);
  check("and neither does the budgets API", (await A.request.get(`${BASE}/api/approvals/budgets`)).status() === 404 && (await A.request.post(`${BASE}/api/approvals/budgets`, { data: { financialYear: "2026-27", branchId: branch.id, categoryId: cat.item.id, allocatedPaise: 100 } })).status() === 404);

  section("7. Category merge: requests move, names become aliases");
  const merge = await A.request.post(`${BASE}/api/approvals/category-merge`, { data: { sourceId: cat.item.id, targetId: catB.item.id } });
  check("merge succeeds", merge.status() === 200, merge.status());
  const [src] = await sql`select * from apr_categories where id = ${cat.item.id}`;
  const [tgt] = await sql`select * from apr_categories where id = ${catB.item.id}`;
  check("the source is inactive, points at the target and is no longer flagged", !src.active && src.merged_into_id === tgt.id && src.duplicate_group === null);
  check("the target keeps its alias and gains the source's name", tgt.aliases.includes("ZZ Old Spelling") && tgt.aliases.includes("ZZ Cat A"), tgt.aliases.join(" | "));
  check("the duplicate flag clears once only one is left", tgt.duplicate_group === null);
  check("merging into a merged category is refused", (await A.request.post(`${BASE}/api/approvals/category-merge`, { data: { sourceId: cat.item.id, targetId: catB.item.id } })).status() === 409);
  check("merging a category into itself is refused", (await A.request.post(`${BASE}/api/approvals/category-merge`, { data: { sourceId: catB.item.id, targetId: catB.item.id } })).status() === 400);

  section("8. An ordinary person with a hub login and no module role");
  const mem = await newSession();
  const M = mem.page;
  await signIn(M, MEMBER.email, MEMBER.pw);
  check("they can open /approvals with no card and no grant", (await status(M, "/approvals")) === 200);
  await M.goto(BASE + "/");
  check("and the hub shows them the Approval System item", (await M.locator("aside:visible nav").first().innerText()).includes("Approval System"));
  await M.goto(BASE + "/approvals");
  check("the Approval System page is their staff dashboard: Submit a Request, with Submit HR Request and Submit Expense", (await M.locator("main h1").first().innerText()) === "Submit a Request" && (await M.getByRole("link", { name: "Submit HR Request" }).getAttribute("href")) === "/approvals/hr/new" && (await M.getByRole("link", { name: "Submit Expense" }).getAttribute("href")) === "/approvals/expenses/new");
  check("there is no separate ₹10,000+ form to choose, and My Recent Submissions is empty", (await M.getByRole("link", { name: /Use the Expenditure form/ }).count()) === 0 && /Nothing submitted yet/.test(await M.locator("main").first().innerText()));
  await M.getByRole("link", { name: "Submit Expense" }).click();
  await M.locator("main h2").first().waitFor();
  check("Submit Expense takes them to the Expenses form, with no menu around it", (await M.locator("main h2").first().innerText()) === "Expenses" && (await menuRows(M).count()) === 0);
  await M.goto(BASE + "/approvals/hr/new");
  await M.locator("main h2").first().waitFor();
  check("the HR form has no menu around it either", (await menuRows(M).count()) === 0);
  const forms = [await status(M, "/approvals/hr/new"), await status(M, "/approvals/expenditures/new"), await status(M, "/approvals/expenses/new")];
  check("the three forms open for them", forms.every((s) => s === 200), forms.join(","));
  const listPaths = ["/approvals/hr/all", "/approvals/hr/pending", "/approvals/expenditures/all", "/approvals/expenses/mine", "/approvals/inbox", "/approvals/my/completed", "/approvals/timeline", "/approvals/hr/timeline", "/approvals/hr/report", "/approvals/hr/approval-time"];
  const listStatuses = []; for (const p of listPaths) listStatuses.push(await status(M, p));
  check("every list, timeline and report is a 404 for them: forms only", listStatuses.every((s) => s === 404), listStatuses.join(","));
  check("the CSV export is closed to them (403)", (await M.request.get(`${BASE}/api/approvals/requests/export?screen=hr/all`)).status() === 403);
  check("admin pages are a 404 for them", (await status(M, "/approvals/admin/categories")) === 404 && (await status(M, "/approvals/admin/access")) === 404);
  const read = await M.request.get(`${BASE}/api/approvals/masters/categories`);
  const readBody = await read.json();
  check("they can read the active categories (for dropdowns)", read.status() === 200 && readBody.items.length >= 40);
  check("inactive categories are not shown to them, even when asked for", !(await (await M.request.get(`${BASE}/api/approvals/masters/categories?all=1`)).json()).items.some((i) => i.name === "ZZ Cat A"));
  check("they cannot create a branch (403)", (await M.request.post(`${BASE}/api/approvals/masters/branches`, { data: { name: "ZZ Sneaky" } })).status() === 403);
  check("they cannot merge categories or change roles (403)", (await M.request.post(`${BASE}/api/approvals/category-merge`, { data: { sourceId: tgt.id, targetId: tgt.id } })).status() === 403 && (await M.request.put(`${BASE}/api/approvals/roles`, { data: { userId: member.id, role: "approvals_admin", granted: true } })).status() === 403);
  check("no row was created by the refused calls", (await sql`select count(*)::int n from apr_branches where name = 'ZZ Sneaky'`)[0].n === 0);

  section("9. Granting viewer in Roles and Access");
  await A.goto(BASE + "/approvals/admin/access");
  const memRow = A.getByRole("row", { name: /ZZ Apr Member/ });
  await memRow.getByRole("switch", { name: /is a viewer/ }).click();
  check("the grant is stored", await poll(async () => (await sql`select count(*)::int n from apr_user_roles where user_id = ${member.id} and role = 'viewer'`)[0].n === 1));
  check("and, with full access, the lists and the CSV export too", (await status(M, "/approvals/hr/all")) === 200 && (await status(M, "/approvals/expenses/approved")) === 200 && (await M.request.get(`${BASE}/api/approvals/requests/export?screen=hr/all`)).status() === 200);
  await M.goto(BASE + "/approvals/hr/new");
  await A.goto(BASE + "/approvals/admin/access");
  await A.getByRole("row", { name: /ZZ Apr Member/ }).getByRole("switch", { name: /is a viewer/ }).click();
  await poll(async () => (await sql`select count(*)::int n from apr_user_roles where user_id = ${member.id} and role = 'viewer'`)[0].n === 0);
  check("and the lists and the export close with it: forms only again", (await status(M, "/approvals/hr/all")) === 404 && (await M.request.get(`${BASE}/api/approvals/requests/export?screen=hr/all`)).status() === 403 && (await status(M, "/approvals/hr/new")) === 200);

  section("10. The forms are for everyone who signs in, through the Approval System page; nothing has to be ticked");
  const out = await newSession();
  await signIn(out.page, OUTSIDER.email, OUTSIDER.pw);
  check("a second ordinary person, with neither application ticked, can open /approvals and both forms", (await status(out.page, "/approvals")) === 200 && (await status(out.page, "/approvals/hr/new")) === 200 && (await status(out.page, "/approvals/expenses/new")) === 200 && (await status(out.page, "/approvals/expenditures/new")) === 200);
  check("with nothing ticked the forms are all they have: no dropdown in the sidebar, no lists", (await out.page.locator("aside").first().getByRole("button", { name: "Approval System" }).count()) === 0 && (await status(out.page, "/approvals/hr/all")) === 404);
  await out.page.goto(BASE + "/approvals");
  check("and the Approval System page gives them the two forms, like anyone without a role", (await out.page.getByRole("link", { name: /^Submit (HR Request|Expense)$/ }).count()) === 2);
  check("the API answers them (they read the dropdown lists)", (await out.page.request.get(`${BASE}/api/approvals/masters/categories`)).status() === 200);
  check("but the admin pages stay closed to them", (await status(out.page, "/approvals/admin/categories")) === 404);

  section("11. Writes from another site are refused");
  const evil = await A.request.post(`${BASE}/api/approvals/masters/branches`, { data: { name: "ZZ Cross Site" }, headers: { Origin: "https://evil.example" } });
  check("a write carrying a foreign Origin is a 403", evil.status() === 403);
  check("and nothing was written", (await sql`select count(*)::int n from apr_branches where name = 'ZZ Cross Site'`)[0].n === 0);

  section("12. Settings and the audit log");
  await A.goto(BASE + "/approvals/admin/settings");
  check("the threshold shows as 10,000.00", (await A.locator("input[inputmode=decimal]").first().inputValue()) === "10,000.00");
  const badSettings = await A.request.put(`${BASE}/api/approvals/settings`, { data: { thresholdPaise: 0, reminderAfterHours: 48, largeFormShowQuotation: true, notifyApproverOnAssignment: true, notifyRequesterOnOutcome: true, notifyAdminOnImportErrors: true } });
  check("a zero threshold is refused", badSettings.status() === 400);
  await A.goto(BASE + "/approvals/admin/audit");
  const audit = await A.locator("main").first().innerText();
  check("the audit log lists the branch, merge and role changes made above", /Added branch "ZZ Branch One"/.test(audit) && /Merged category "ZZ Cat A" into "ZZ Cat B"/.test(audit) && /viewer/.test(audit), audit.slice(0, 200).replace(/\s+/g, " "));
  check("the audit log names who did it", audit.includes(process.env.HEAD_ADMIN_NAME || ADMIN_EMAIL));

  section("13. Console, seeded data and the module switch");
  check("no browser console or page errors on any screen", consoleErrors.length === 0 && pageErrors.length === 0, [...consoleErrors, ...pageErrors].join(" | "));
  const after = await seeded();
  check("the seeded masters are exactly as before", JSON.stringify(after) === JSON.stringify(before), JSON.stringify(after));
  if (OFF) {
    const off = await newSession();
    const offStatus = async (p) => (await off.page.goto(OFF + p)).status();
    await off.page.goto(OFF + "/login");
    await off.page.locator("input[name=email]").fill(ADMIN_EMAIL);
    await off.page.locator("input[name=password]").fill(ADMIN_PW);
    await off.page.getByRole("button", { name: "Sign in" }).click();
    await off.page.waitForFunction(() => location.pathname !== "/login", null, { timeout: 25000 }).catch(() => {});
    check("with the module switched off, /approvals is a 404 even for the head admin", (await offStatus("/approvals")) === 404);
    check("and the API is a 404", (await off.page.request.get(OFF + "/api/approvals/masters/categories")).status() === 404);
    check("and the hub no longer launches the card", (await off.page.request.get(`${OFF}/go/${card.id}`, { maxRedirects: 0 })).status() === 404);
    await off.page.goto(OFF + "/");
    check("and the hub no longer lists it", !(await off.page.locator("main").first().innerText()).includes("ZZ Apr Card"));
    check("and the sidebar has no Approval System item", !(await off.page.locator("aside:visible nav").first().innerText()).includes("Approval System"));
  } else console.log("(skipped: set E2E_OFF_URL to a server started with APPROVALS_ENABLED=false to check the switch)");
} catch (e) {
  check("the suite ran to the end without an unexpected error", false, e.stack || e);
} finally {
  await browser.close().catch(() => {});
  await removeTestData().catch((e) => console.error("CLEANUP FAILED, run again to retry:", e.message));
}

const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
