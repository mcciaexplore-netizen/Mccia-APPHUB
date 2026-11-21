/**
 * End-to-end test of Watching in the Approval System, in a real browser against a running app: the Support Admin sets a person's watching
 * rules on their page in Administrator > Users (Budget: all; Expenditure: two of the expense categories; HR saved and removed again); the
 * watcher gets All Approvals in the sidebar with its count, one list holding exactly what the rules match (filterable by type), opens a
 * request with the view-only note and no decision buttons, prints, exports, is told of new budgets, and cannot see anything outside the
 * rules; removing rules takes the access away. Expenditure requests are written straight into the database (their routing needs hub roles
 * the test does not set up).
 *
 * Writes test people (zz-wat-*), a test department, expense categories (ZZ Wat ...) and requests, and removes them at the end. Run it
 * against a TEST database only:
 *   E2E_WATCHERS_CONFIRM=yes E2E_BASE_URL=http://localhost:3000 HEAD_ADMIN_EMAIL=... HEAD_ADMIN_PASSWORD=... npm run test:e2e:approvals:watchers
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
if (!BASE) { console.error("Set E2E_BASE_URL, for example: E2E_BASE_URL=http://localhost:3000 npm run test:e2e:approvals:watchers"); process.exit(2); }
if (process.env.E2E_WATCHERS_CONFIRM !== "yes") { console.error("This test writes watchers and requests. Run it against a test database, then set E2E_WATCHERS_CONFIRM=yes."); process.exit(2); }
const ADMIN_EMAIL = (process.env.HEAD_ADMIN_EMAIL || "").trim().toLowerCase(), ADMIN_PW = process.env.HEAD_ADMIN_PASSWORD || "";
if (!ADMIN_EMAIL || !ADMIN_PW) { console.error("Set HEAD_ADMIN_EMAIL and HEAD_ADMIN_PASSWORD (the Support Admin manages watchers)."); process.exit(2); }

const rawSql = (() => {
  if ((process.env.DB_DRIVER ?? "neon") !== "pg") return req("@neondatabase/serverless").neon(process.env.DATABASE_URL);
  const pool = new (req("pg").Pool)({ connectionString: process.env.DATABASE_URL, max: 4, ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false });
  return async (strings, ...values) => (await pool.query(strings.reduce((q, s, i) => q + (i ? `$${i}` : "") + s, ""), values)).rows;
})();
const sql = (...a) => rawSql(...a);
const playwright = req("playwright-core");
const launch = () => playwright.chromium.launch({ channel: process.env.E2E_CHROME_CHANNEL || "chrome", headless: true }).catch(() => playwright.chromium.launch({ headless: true }));

const results = [];
const check = (name, ok, extra = "") => { results.push([name, !!ok]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && extra !== "" ? "  -> " + String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 1500) : ""}`); };
const section = (t) => console.log(`\n== ${t} ==`);
const poll = async (fn, ms = 15000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 300)); } return v; };
const hash = (pw) => { const salt = randomBytes(16); return `scrypt$16384$${salt.toString("base64")}$${scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("base64")}`; };

const PW = "zz-Watch-pass-1";
const EVENT = "ZZ Watched Summit";
const now = new Date();
const FY = now.getMonth() >= 3 ? `${now.getFullYear()}-${String((now.getFullYear() + 1) % 100).padStart(2, "0")}` : `${now.getFullYear() - 1}-${String(now.getFullYear() % 100).padStart(2, "0")}`;

const removeData = async () => {
  const ids = (await sql`select id from users where email like 'zz-wat-%'`).map((r) => r.id);
  for (const uid of ids) {
    for (const r of await sql`select id from apr_requests where requester_user_id = ${uid}`) {
      await sql`delete from apr_approval_events where request_id = ${r.id}`;
      await sql`delete from apr_notifications where request_id = ${r.id}`;
      await sql`delete from apr_requests where id = ${r.id}`;
    }
    await sql`delete from apr_watchers where user_id = ${uid}`;
    await sql`delete from apr_notifications where user_id = ${uid}`;
    await sql`delete from apr_rate_limits where user_id = ${uid}`;
    await sql`delete from activity_log where user_id = ${uid}`;
    await sql`delete from login_attempts where email = (select email from users where id = ${uid})`;
  }
  await sql`delete from apr_admin_audit where entity = 'watcher' and summary like 'ZZ Wat%'`;
  await sql`delete from apr_categories where name like 'ZZ Wat%'`;
  await sql`delete from users where email like 'zz-wat-%'`;
  await sql`delete from departments where name = 'ZZ Watch Dept'`;
};

await removeData();
const counters = await sql`select key, last_value from apr_counters`;
const [dept] = await sql`insert into departments (kind, name, icon) values ('organisation', 'ZZ Watch Dept', 'Building') returning id`;
const person = async (name, email) => (await sql`insert into users (name, email, password_hash, status, role, home_department_id) values (${name}, ${email}, ${hash(PW)}, 'approved', 'member', ${dept.id}) returning id`)[0];
const requester = await person("ZZ Wat Requester", "zz-wat-requester@example.com");
const approver = await person("ZZ Wat Approver", "zz-wat-approver@example.com");
const watcher = await person("ZZ Wat Watcher", "zz-wat-watcher@example.com");
await person("ZZ Wat Outsider", "zz-wat-outsider@example.com");

const browser = await launch();
const noInstallPrompt = (ctx) => ctx.addInitScript(() => {
  try { localStorage.setItem("mccia-install-popup-seen", "1"); localStorage.setItem("mccia-install-snoozed-until", String(Date.now() + 864e5)); } catch { /* none */ }
});
const signedIn = async (email, pw = PW) => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 1000 } });
  await noInstallPrompt(ctx);
  const page = await ctx.newPage();
  await page.goto(BASE + "/login");
  await page.locator("input[name=email]").fill(email); await page.locator("input[name=password]").fill(pw);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForFunction(() => location.pathname !== "/login", null, { timeout: 30000 });
  return { ctx, page };
};
const go = async (page, p) => { const r = await page.goto(BASE + p); await page.waitForLoadState("networkidle").catch(() => {}); return r; };
const api = (page, url, method = "GET", body) => page.evaluate(async ([u, m, b]) => {
  const r = await fetch(u, { method: m, headers: b ? { "Content-Type": "application/json" } : {}, body: b ? JSON.stringify(b) : undefined });
  let j = null; try { j = await r.json(); } catch { /* not JSON */ }
  return { status: r.status, body: j, text: j ? "" : await r.text().catch(() => "") };
}, [url, method, body]);
const raw = (page, url) => page.evaluate(async (u) => { const r = await fetch(u); return { status: r.status, body: await r.text() }; }, url);
const text = async (page) => (await page.locator("main").innerText()).replace(/\s+/g, " ");
const raise = async (R, eventName) => (await api(R.page, "/api/approvals/requests", "POST", {
  kind: "budget", eventName, description: "x", departmentId: `hub:${dept.id}`, financialYear: FY, incomeLines: [], expenseLines: [{ name: "ZZ Hall", amountPaise: 75000 }], budgetPaise: 75000, approverUserId: approver.id,
})).body;

let failed = null;
try {
  const R = await signedIn("zz-wat-requester@example.com");
  const A = await signedIn("zz-wat-approver@example.com");
  const W = await signedIn("zz-wat-watcher@example.com");
  const O = await signedIn("zz-wat-outsider@example.com");
  const H = await signedIn(ADMIN_EMAIL, ADMIN_PW);


  // Expense categories and expenditure requests, written straight in (as if raised through the expense form).
  const cat = async (name) => (await sql`insert into apr_categories (name) values (${name}) returning id`)[0].id;
  const [catAdmin, catEvent, catOther] = [await cat("ZZ Wat Administrative Exp"), await cat("ZZ Wat Event Exp"), await cat("ZZ Wat Other Exp")];
  const expense = async (no, categoryId) => {
    const [r] = await sql`insert into apr_requests (request_no, type, status, requester_user_id, requester_name, requester_email, financial_year, current_step, total_steps, current_approver_user_id, amount_paise)
      values (${no}, 'expenditure_large', 'pending', ${requester.id}, 'ZZ Wat Requester', 'zz-wat-requester@example.com', ${FY}, 1, 1, ${approver.id}, 2500000) returning id`;
    await sql`insert into apr_expenditure_details (request_id, category_id, nature_of_expenditure) values (${r.id}, ${categoryId}, 'ZZ test expense')`;
    await sql`insert into apr_request_steps (request_id, step_no, step_label, approver_user_id, approver_name, status, assigned_at) values (${r.id}, 1, 'Expense Admin', ${approver.id}, 'ZZ Wat Approver', 'pending', now())`;
    return r.id;
  };
  const [expAdmin, expEvent, expOther] = [await expense("ZZ-WAT-EXP-1", catAdmin), await expense("ZZ-WAT-EXP-2", catEvent), await expense("ZZ-WAT-EXP-3", catOther)];
  const budgetBefore = await raise(R, "ZZ Before Watching");

  section("Before: no watching rules");
  await go(W.page, "/approvals");
  check("a plain user has no All Approvals in the sidebar", (await W.page.locator("nav a[href='/approvals/watching/all']").count()) === 0);
  check("…cannot open All Approvals (404)", (await go(W.page, "/approvals/watching/all"))?.status() === 404);
  check("…nor a request they have no part in (404)", (await go(W.page, `/approvals/requests/${expAdmin}`))?.status() === 404 && (await go(W.page, `/approvals/requests/${budgetBefore.id}`))?.status() === 404);
  check("…nor export it (403)", (await raw(W.page, "/api/approvals/requests/export?screen=watching/all")).status === 403);

  section("Administrator > Users > the person: Watching");
  await H.page.goto(BASE + `/administrator/users/${watcher.id}`);
  if (new URL(H.page.url()).pathname === "/unlock") {
    await H.page.locator("input[name=password]").fill(ADMIN_PW); await H.page.getByRole("button", { name: "Unlock" }).click();
    await H.page.waitForURL((u) => u.pathname !== "/unlock", { timeout: 30000 });
    await go(H.page, `/administrator/users/${watcher.id}`);
  }
  const box = H.page.locator("[data-testid=watching-rules]");
  await box.waitFor({ timeout: 15000 }).catch(() => {});
  check("the person's page has a Watching section, empty to begin with", (await box.count()) === 1 && (await box.textContent()).includes("Not watching anything."));
  const ruleCount = async (n) => poll(async () => (await box.locator("[data-testid=watching-row]").count()) === n);
  const addRule = async (form, category) => {
    await box.locator("[data-testid=watching-add]").click();
    await box.locator("[data-testid=watching-form]").selectOption(form);
    if (category) await box.locator("[data-testid=watching-category]").selectOption({ label: category });
  };
  await addRule("hr");
  check("choosing HR Approval saves it at once, as All", await ruleCount(1) && (await box.locator("[data-testid=watching-row]").first().textContent()).includes("HR Approval") && (await box.locator("[data-testid=watching-row]").first().textContent()).includes("All"));
  await addRule("budget");
  await ruleCount(2);
  await addRule("expenditure");
  check("Expenditure asks for a category: All, or one of the expense categories", (await box.locator("[data-testid=watching-category] option").allTextContents()).includes("ZZ Wat Event Exp") && (await box.locator("[data-testid=watching-category] option").allTextContents()).includes("All"));
  await box.locator("[data-testid=watching-category]").selectOption({ label: "ZZ Wat Administrative Exp" });
  await ruleCount(3);
  await addRule("expenditure", "ZZ Wat Event Exp");
  check("the same approval type can be added again with another category: four rows", await ruleCount(4), await box.textContent());
  check("…stored as rules: HR and Budget for all, Expenditure for two categories", JSON.stringify((await sql`select form_type, category from apr_watchers where user_id = ${watcher.id} order by form_type, category`).map((r) => `${r.form_type}:${r.category ?? "all"}`))
    === JSON.stringify(["budget:all", `expenditure:${[catAdmin, catEvent].sort()[0]}`, `expenditure:${[catAdmin, catEvent].sort()[1]}`, "hr:all"]));
  check("…each change recorded in the audit log", (await sql`select count(*)::int n from apr_admin_audit where entity = 'watcher' and action = 'grant' and summary like 'ZZ Wat Watcher now watches%'`)[0].n === 4);
  await box.getByRole("button", { name: "Remove HR Approval (All)" }).click();
  check("× removes a row at once", await ruleCount(3) && !(await box.textContent()).includes("HR Approval"));
  check("someone who is not the Support Admin cannot set rules (403)", (await api(W.page, "/api/approvals/watchers", "POST", { userId: watcher.id, form: "hr" })).status === 403
    && (await api(A.page, "/api/approvals/watchers", "POST", { userId: approver.id, form: "budget" })).status === 403);
  // The approver also watches Budget: they must still get only one notice about a budget sent to them.
  check("an approver can have watching rules too", (await api(H.page, "/api/approvals/watchers", "POST", { userId: approver.id, form: "budget" })).status === 201);

  section("A new request tells the watchers");
  const fresh = await raise(R, EVENT);
  const wNote = await poll(async () => (await sql`select title, link from apr_notifications where user_id = ${watcher.id} and request_id = ${fresh.id}`)[0]);
  check("the watcher gets a bell notice \"ZZ Wat Requester submitted a new Budget request\" that opens it", wNote?.title === "ZZ Wat Requester submitted a new Budget request" && wNote.link.includes(fresh.id), wNote);
  check("the approver who also watches Budget gets one notice, not two", (await sql`select count(*)::int n from apr_notifications where user_id = ${approver.id} and request_id = ${fresh.id}`)[0].n === 1);
  check("the person who raised it is not told as a watcher", (await sql`select count(*)::int n from apr_notifications where user_id = ${requester.id} and request_id = ${fresh.id}`)[0].n === 0);
  check("watcher emails are off by default (bell only)", ((await sql`select value from apr_settings where key = 'notify_watchers_by_email'`)[0]?.value ?? "false") === "false");

  section("All Approvals");
  await go(W.page, "/approvals");
  const nav = W.page.locator(`nav[aria-label="Approval System"]`).first();
  const allLink = nav.locator("a[href='/approvals/watching/all']");
  check("the sidebar has All Approvals with a count of 4 (2 budgets, 2 expenses of the watched categories)", (await allLink.count()) >= 1 && (await allLink.last().textContent()).includes("4"), await allLink.last().textContent().catch(() => "none"));
  await go(W.page, "/approvals/watching/all");
  const listText = await text(W.page);
  check("one list holds both budgets and the expenses of the two watched categories", [EVENT, "ZZ Before Watching", "ZZ-WAT-EXP-1", "ZZ-WAT-EXP-2"].every((t) => listText.includes(t)), listText.slice(0, 400));
  check("…but not an expense of another category", !listText.includes("ZZ-WAT-EXP-3"));
  check("…with Type, Name, Category, Amount, Date and Status columns", await (async () => { const head = await W.page.locator("main table thead").first().textContent(); return ["Request No.", "Type", "Name", "Category", "Amount", "Date of Request", "Status"].every((h) => head.includes(h)); })());
  check("…and no Approve or Reject on its rows", (await W.page.getByRole("button", { name: /^(Approve|Reject)$/ }).count()) === 0);
  await W.page.locator("[data-testid=filter-type]").selectOption("expenditure");
  await W.page.waitForURL(/type=expenditure/);
  await W.page.waitForLoadState("networkidle").catch(() => {});
  const expOnly = await text(W.page);
  check("the Type filter shows only Expenditure", expOnly.includes("ZZ-WAT-EXP-1") && expOnly.includes("ZZ-WAT-EXP-2") && !expOnly.includes(EVENT), expOnly.slice(0, 300));
  await go(W.page, `/approvals/requests/${expAdmin}`);
  check("a row opens the full request, with \"You have view-only access to this request\"", (await text(W.page)).includes("ZZ Wat Administrative Exp") && (await W.page.locator("[data-testid=watching-note]").textContent()).includes("You have view-only access to this request"));
  check("…no Approve / Reject panel", (await W.page.locator("section[aria-label='Your decision']").count()) === 0);
  check("…they can print it", (await W.page.getByRole("button", { name: "Print" }).count()) === 1);
  check("the server refuses a decision from them (403)", (await api(W.page, `/api/approvals/requests/${expAdmin}/decision`, "POST", { action: "approve" })).status === 403
    && (await api(W.page, `/api/approvals/requests/${fresh.id}/decision`, "POST", { action: "approve" })).status === 403);
  check("an expense of a category they do not watch stays closed (404)", (await go(W.page, `/approvals/requests/${expOther}`))?.status() === 404);
  const csv = await raw(W.page, "/api/approvals/requests/export?screen=watching/all");
  check("they can export All Approvals as CSV: what their rules match, nothing else", csv.status === 200 && csv.body.includes("ZZ-WAT-EXP-1") && csv.body.includes(EVENT) && !csv.body.includes("ZZ-WAT-EXP-3"), csv.status);
  const csvBudget = await raw(W.page, "/api/approvals/requests/export?screen=watching/all&type=budget");
  check("…filtered by type too", csvBudget.status === 200 && csvBudget.body.includes(EVENT) && !csvBudget.body.includes("ZZ-WAT-EXP-1"));
  check("someone else still cannot open them (404)", (await go(O.page, `/approvals/requests/${expAdmin}`))?.status() === 404);
  check("the approver still decides as before", (await api(A.page, `/api/approvals/requests/${fresh.id}/decision`, "POST", { action: "approve" })).status === 200);

  section("Removing rules");
  await go(H.page, `/administrator/users/${watcher.id}`);
  await box.getByRole("button", { name: "Remove Expenditure (ZZ Wat Event Exp)" }).click();
  await ruleCount(2);
  check("removing one category takes only that away: its expense closes (404), the other stays", (await go(W.page, `/approvals/requests/${expEvent}`))?.status() === 404 && (await go(W.page, `/approvals/requests/${expAdmin}`))?.status() === 200);
  await box.getByRole("button", { name: "Remove Expenditure (ZZ Wat Administrative Exp)" }).click();
  await ruleCount(1);
  await box.getByRole("button", { name: "Remove Budget (All)" }).click();
  check("with every row removed the section is empty again", await ruleCount(0) && (await box.textContent()).includes("Not watching anything."));
  check("…recorded in the audit log", (await sql`select count(*)::int n from apr_admin_audit where entity = 'watcher' and action = 'revoke' and summary like 'ZZ Wat Watcher no longer watches%'`)[0].n === 4);
  await go(W.page, "/approvals");
  check("the watcher no longer has All Approvals", (await W.page.locator("nav a[href='/approvals/watching/all']").count()) === 0);
  check("…nor the list (404), nor the requests (404)", (await go(W.page, "/approvals/watching/all"))?.status() === 404 && (await go(W.page, `/approvals/requests/${fresh.id}`))?.status() === 404 && (await go(W.page, `/approvals/requests/${expAdmin}`))?.status() === 404);
  const later = await raise(R, "ZZ After Watching");
  await new Promise((r) => setTimeout(r, 1500));
  check("…and is not told of new requests", (await sql`select count(*)::int n from apr_notifications where user_id = ${watcher.id} and request_id = ${later.id}`)[0].n === 0);

  for (const s of [R, A, W, O, H]) await s.ctx.close();
} catch (e) {
  failed = e;
  check("the suite ran to the end without an unexpected error", false, e?.stack ?? String(e));
} finally {
  await browser.close();
  await removeData();
  for (const c of counters) await sql`update apr_counters set last_value = ${c.last_value} where key = ${c.key}`;
  check("cleanup: no test people, watchers or requests are left", (await sql`select (select count(*)::int from users where email like 'zz-wat-%') + (select count(*)::int from apr_watchers w where not exists (select 1 from users u where u.id = w.user_id)) n`)[0].n === 0);
}

const passed = results.filter(([, ok]) => ok).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(failed || passed !== results.length ? 1 : 0);
