/**
 * End-to-end test of the Budget Approval form in a real browser: raising a budget (income and expense rows with live totals, the Budget
 * Summary's Surplus / Deficit / Balanced, vendors added and
 * removed, the approver picked by typing a name), the approver's Budget place (badge, list, Approve or Reject with a reason, no Return),
 * revisions (only the requester, only an approved budget, one pending at a time, a rejected one leaving the budget before it in force), the
 * budget history, who can see what, and the printed page (one A4 page, with the history).
 *
 * Run it against a TEST database, never the live one:
 *   E2E_BUDGET_CONFIRM=yes E2E_BASE_URL=http://localhost:3000 npm run test:e2e:approvals:budget
 * It WRITES only rows of its own: people "zz-bud-*", a department "ZZ Budget Events", their budget requests and notifications, and it puts the
 * request counters back as they were. Everything is removed when it finishes, and again at the start in case an earlier run was interrupted.
 * The site must have migration 0040 applied (scripts/apply-0040-approvals-budget.sql).
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
if (!BASE) { console.error("Set E2E_BASE_URL, for example: E2E_BASE_URL=http://localhost:3000 npm run test:e2e:approvals:budget"); process.exit(2); }
if (process.env.E2E_BUDGET_CONFIRM !== "yes") { console.error("This test writes budget requests. Run it against a test database, then set E2E_BUDGET_CONFIRM=yes."); process.exit(2); }

const rawSql = (() => {
  if ((process.env.DB_DRIVER ?? "neon") !== "pg") return req("@neondatabase/serverless").neon(process.env.DATABASE_URL);
  const pool = new (req("pg").Pool)({ connectionString: process.env.DATABASE_URL, max: 4, ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false });
  return async (strings, ...values) => (await pool.query(strings.reduce((q, s, i) => q + (i ? `$${i}` : "") + s, ""), values)).rows;
})();
const sql = (...a) => rawSql(...a);
const playwright = req("playwright-core");
const launch = () => playwright.chromium.launch({ channel: process.env.E2E_CHROME_CHANNEL || "chrome", headless: true }).catch(() => playwright.chromium.launch({ headless: true }));

const results = [];
const check = (name, ok, extra = "") => { results.push([name, !!ok]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && extra !== "" ? "  -> " + String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 300) : ""}`); };
const section = (t) => console.log(`\n== ${t} ==`);
const poll = async (fn, ms = 15000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 300)); } return v; };
const hash = (pw) => { const salt = randomBytes(16); return `scrypt$16384$${salt.toString("base64")}$${scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("base64")}`; };

const PW = "zz-Budget-pass-1";
const EVENT = "ZZ Budget Summit";

let savedCounters = null;
const removeData = async () => {
  const ids = (await sql`select id from users where email like 'zz-bud-%'`).map((r) => r.id);
  for (const uid of ids) {
    for (const r of await sql`select id from apr_requests where requester_user_id = ${uid}`) {
      await sql`delete from apr_approval_events where request_id = ${r.id}`;
      await sql`delete from apr_notifications where request_id = ${r.id}`;
      await sql`delete from apr_requests where id = ${r.id}`;
    }
    await sql`delete from apr_notifications where user_id = ${uid}`;
    await sql`delete from apr_rate_limits where user_id = ${uid}`;
    await sql`delete from activity_log where user_id = ${uid}`;
    await sql`delete from login_attempts where email = (select email from users where id = ${uid})`;
  }
  if (savedCounters) {
    const now = await sql`select key from apr_counters`;
    for (const c of savedCounters) await sql`update apr_counters set last_value = ${c.last_value} where key = ${c.key}`;
    for (const c of now) if (!savedCounters.some((s) => s.key === c.key)) await sql`delete from apr_counters where key = ${c.key}`;
  }
  await sql`delete from users where email like 'zz-bud-%'`;
  await sql`delete from departments where name like 'ZZ Budget%'`;
  // The Budget form's layout, as this test sets it (it starts and ends with the defaults: no rows).
  await sql`delete from apr_form_fields where form = 'budget'`;
  await sql`delete from apr_admin_audit where entity = 'form_fields' and summary like '%Budget%'`;
};

await removeData();
savedCounters = await sql`select key, last_value from apr_counters`;
const otherBefore = (await sql`select count(*)::int n from apr_requests where requester_user_id not in (select id from users where email like 'zz-bud-%')`)[0].n;
const [dept] = await sql`insert into departments (kind, name, icon) values ('organisation', 'ZZ Budget Events', 'Building') returning id`;
const person = async (name, email) => (await sql`insert into users (name, email, password_hash, status, role, home_department_id) values (${name}, ${email}, ${hash(PW)}, 'approved', 'member', ${dept.id}) returning id`)[0];
const requester = await person("ZZ Bud Requester", "zz-bud-requester@example.com");
const approver = await person("ZZ Bud Approver", "zz-bud-approver@example.com");
await person("ZZ Bud Outsider", "zz-bud-outsider@example.com");

const browser = await launch();
const signedIn = async (email) => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(BASE + "/login");
  await page.locator("input[name=email]").fill(email); await page.locator("input[name=password]").fill(PW);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForFunction(() => location.pathname !== "/login", null, { timeout: 30000 });
  return { ctx, page };
};
const go = async (page, p) => { const r = await page.goto(BASE + p); await page.waitForLoadState("networkidle").catch(() => {}); return r; };
const api = (page, url, method = "GET", body) => page.evaluate(async ([u, m, b]) => {
  const r = await fetch(u, { method: m, headers: b ? { "Content-Type": "application/json" } : {}, body: b ? JSON.stringify(b) : undefined });
  let j = null; try { j = await r.json(); } catch { /* not JSON */ }
  return { status: r.status, body: j };
}, [url, method, body]);
const pick = async (page, id, text) => { await page.locator(`#${id}`).click(); await page.locator(".zd-pop input[aria-label=Search]").fill(text); await page.locator(".zd-pop .zd-opt").first().click(); };
const text = async (page) => (await page.locator("main").innerText()).replace(/\s+/g, " ");
/** E2E_SHOTS=<folder>: also save screenshots of the form, the history and the printed page there. */
const shot = async (page, name, opts = {}) => { if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/budget-${name}.png`, fullPage: true, ...opts }); };
const decide = async (page, action, comment = "") => {
  if (comment) await page.locator("section[aria-label='Your decision'] textarea").fill(comment);
  await page.locator("section[aria-label='Your decision']").getByRole("button", { name: action, exact: true }).click();
  await page.waitForLoadState("networkidle").catch(() => {});
};

let failed = null;
try {
  const R = await signedIn("zz-bud-requester@example.com");
  const A = await signedIn("zz-bud-approver@example.com");
  const O = await signedIn("zz-bud-outsider@example.com");

  section("The form");
  await go(R.page, "/approvals");
  check("the Approval Forms page has a Budget Approval Form card", (await text(R.page)).includes("Budget Approval Form"));
  await go(R.page, "/approvals/budget/new");
  const f = R.page.locator("[data-testid=budget-form]");
  check("a plain requester opens the Budget Approval form", (await f.count()) === 1);
  const headings = (await R.page.locator("h1, h2").allInnerTexts()).map((h) => h.trim());
  check("its main heading is Budget Approval, and HR Approval appears nowhere on it", (await R.page.locator("h1").first().innerText()).trim() === "Budget Approval" && !(await R.page.locator("body").innerText()).includes("HR Approval") && headings.filter((h) => h === "Budget Approval").length === 1, headings.join(" | "));
  check("its back link is Back to Approval Forms", (await R.page.getByRole("link", { name: /Back to Approval Forms/ }).getAttribute("href")) === "/approvals");
  const labels = (await f.locator(".zf-label").allInnerTexts()).map((l) => l.replace(/\s*\*$/, "").trim());
  check("its sections are in order: event, income, expenses, vendors, summary, total budget requested, approver", JSON.stringify(labels) === JSON.stringify(["Event name", "Description", "Department", "Financial year", "Income sources", "Expenses", "Vendor name", "Summary", "Total Budget Requested", "Approver"]), labels.join(" | "));
  check("the totals and the summary are worked out, not typed (no boxes for them)", (await R.page.locator("[data-testid=budget-total-income]").evaluate((e) => e.tagName)) === "OUTPUT" && (await R.page.locator("[data-testid=budget-balance]").evaluate((e) => e.tagName)) === "DD");
  check("the rows have the placeholders asked for", (await R.page.locator("#bud-income-name-0").getAttribute("placeholder")) === "Income source name" && (await R.page.locator("#bud-expense-name-0").getAttribute("placeholder")) === "Expense name" && (await R.page.locator("#bud-income-amount-0").getAttribute("placeholder")) === "##,##,###.##");
  await R.page.getByRole("button", { name: "Submit", exact: true }).click();
  check("submitting it empty says what is missing", (await f.locator(".zf-error").count()) >= 5);
  await R.page.locator("#bud-event").fill(EVENT);
  await R.page.locator("#bud-desc").fill("Two-day member summit at the Pune centre.");
  await pick(R.page, "bud-dept", "ZZ Budget Events");
  const totalOf = (k) => R.page.locator(`[data-testid=budget-total-${k}]`).textContent();
  const balance = async () => { const b = R.page.locator("[data-testid=budget-balance]"); return `${await b.getAttribute("data-kind")} ${await b.textContent()}`; };
  await R.page.locator("#bud-income-name-0").fill("ZZ Sponsorship");
  await R.page.locator("#bud-income-amount-0").fill("5000");
  await R.page.getByRole("button", { name: "Add income" }).click();
  await R.page.locator("#bud-income-name-1").fill("ZZ Stalls");
  await R.page.locator("#bud-income-amount-1").fill("2500");
  check("Total Income adds the income rows as you type (₹7,500.00)", (await totalOf("income")) === "₹7,500.00", await totalOf("income"));
  check("with income and no expenses the summary is a Surplus in green", (await balance()) === "surplus ₹7,500.00" && (await R.page.locator("[data-testid=budget-balance]").getAttribute("class")).includes("green"), await balance());
  await R.page.locator("#bud-expense-name-0").fill("ZZ Venue");
  await R.page.locator("#bud-expense-amount-0").fill("6000");
  await R.page.getByRole("button", { name: "Add expense" }).click();
  await R.page.locator("#bud-expense-name-1").fill("ZZ Wrong Expense");
  await R.page.locator("#bud-expense-amount-1").fill("99");
  await R.page.getByRole("button", { name: "Add expense" }).click();
  await R.page.locator("#bud-expense-name-2").fill("ZZ Catering");
  await R.page.locator("#bud-expense-amount-2").fill("1500");
  await R.page.getByRole("button", { name: "Remove expense 2" }).click();
  check("expense rows can be added and removed; Total Expense adds them (₹7,500.00)", (await totalOf("expense")) === "₹7,500.00" && (await R.page.locator("[data-testid=budget-expense-rows] li").count()) === 2, await totalOf("expense"));
  check("income equal to expense is Balanced ₹0.00, in grey", (await balance()) === "balanced ₹0.00" && (await R.page.locator("[data-testid=budget-balance]").getAttribute("class")).includes("muted"), await balance());
  await R.page.locator("#bud-expense-amount-1").fill("4000");
  check("more expense than income is a Deficit in red (₹2,500.00)", (await balance()) === "deficit ₹2,500.00" && (await R.page.locator("[data-testid=budget-balance]").getAttribute("class")).includes("red"), await balance());
  await R.page.locator("#bud-income-name-1").fill("");
  await R.page.getByRole("button", { name: "Submit", exact: true }).click();
  check("a row with an amount but no name is refused", (await f.locator("[data-testid=budget-income-rows] .zf-error").innerText().catch(() => "")).includes("income source name"));
  await R.page.locator("#bud-income-name-1").fill("ZZ Stalls");
  await R.page.locator("#bud-amount").fill("10000");
  await R.page.locator("#bud-vendor-0").fill("ZZ Sai Caterers");
  await R.page.getByRole("button", { name: "Add vendor" }).click();
  await R.page.locator("#bud-vendor-1").fill("ZZ Wrong Vendor");
  await R.page.getByRole("button", { name: "Add vendor" }).click();
  await R.page.locator("#bud-vendor-2").fill("ZZ Pune Sound");
  await R.page.getByRole("button", { name: "Remove vendor 2" }).click();
  const vendorValues = await R.page.locator("[data-testid=budget-vendors] input").evaluateAll((els) => els.map((e) => e.value));
  check("vendors can be added without limit and removed one by one", JSON.stringify(vendorValues) === JSON.stringify(["ZZ Sai Caterers", "ZZ Pune Sound"]), vendorValues);
  await R.page.locator("#bud-approver").click();
  await R.page.locator(".zd-pop input[aria-label=Search]").fill("ZZ Bud");
  const offered = await R.page.locator(".zd-pop .zd-opt").allInnerTexts();
  check("the approver list searches everyone in the hub, and leaves out the person filling it in", offered.some((o) => o.startsWith("ZZ Bud Approver")) && offered.some((o) => o.startsWith("ZZ Bud Outsider")) && !offered.some((o) => o.startsWith("ZZ Bud Requester")), offered);
  await R.page.locator(".zd-pop .zd-opt", { hasText: "ZZ Bud Approver" }).click();
  await shot(R.page, "form");
  await R.page.getByRole("button", { name: "Submit", exact: true }).click();
  await R.page.waitForURL(/\/approvals\/requests\/[0-9a-f-]{36}/, { timeout: 30000 });
  const origId = R.page.url().match(/requests\/([0-9a-f-]{36})/)[1];
  const [orig] = await sql`select request_no, type, status, amount_paise, financial_year, budget_details, current_approver_user_id from apr_requests where id = ${origId}`;
  check("it is saved as a pending budget with NO Budget ID yet (that comes with approval), waiting for the approver picked", orig?.type === "budget" && orig.status === "pending" && orig.request_no === null && orig.current_approver_user_id === approver.id && Number(orig.amount_paise) === 1000000, orig);
  const d = orig?.budget_details ?? {};
  check("its details are kept as JSON: event, department, year, the income and expense rows (names and paise) and vendors", d.eventName === EVENT && d.departmentName === "ZZ Budget Events" && d.financialYear === orig.financial_year
    && JSON.stringify(d.incomeLines) === JSON.stringify([{ name: "ZZ Sponsorship", amountPaise: 500000 }, { name: "ZZ Stalls", amountPaise: 250000 }])
    && JSON.stringify(d.expenseLines) === JSON.stringify([{ name: "ZZ Venue", amountPaise: 600000 }, { name: "ZZ Catering", amountPaise: 400000 }])
    && d.income === undefined && JSON.stringify(d.vendors) === JSON.stringify(["ZZ Sai Caterers", "ZZ Pune Sound"]), d);
  const shown = await text(R.page);
  check("the page confirms it and shows each income and expense row, their totals, the Deficit and the Total Budget Requested", shown.includes("Budget submitted. Its Budget ID is given when it is approved.") && shown.includes(EVENT)
    && ["ZZ Sponsorship", "ZZ Stalls", "ZZ Venue", "ZZ Catering", "Total Income", "₹7,500.00", "Total Expense", "₹10,000.00", "Deficit: ₹2,500.00", "Total Budget Requested"].every((t) => shown.includes(t)), shown.slice(0, 400));
  const idOf = async (page, testId) => { const el = page.locator(`[data-testid=${testId}]`).first(); return { text: await el.textContent(), kind: await el.getAttribute("data-kind"), cls: await el.getAttribute("class") }; };
  const pendingId = await idOf(R.page, "budget-id");
  check("the request page's Budget ID says Pending approval, in grey italics, at the top and in its Budget ID row", pendingId.text === "Pending approval" && pendingId.kind === "pending" && pendingId.cls.includes("italic")
    && (await idOf(R.page, "budget-id-row")).text === "Pending approval" && (await R.page.locator("h2", { hasText: "Budget ID" }).count()) === 1, pendingId);
  check("no Revise Budget while it is pending", (await R.page.locator("[data-testid=budget-revise]").count()) === 0);
  const n1 = await poll(async () => (await sql`select title from apr_notifications where user_id = ${approver.id} and request_id = ${origId}`)[0]);
  check("the approver gets a bell notification naming the event", n1?.title === `Budget approval for ${EVENT} is waiting for your approval`, n1?.title);

  section("Who can see it");
  check("someone else cannot open it (404)", (await go(O.page, `/approvals/requests/${origId}`))?.status() === 404);
  check("…nor ask for a revision of it (404)", (await api(O.page, `/api/approvals/requests/${origId}/revise`, "POST", { budgetPaise: 100, reason: "x", income: {}, vendors: [], approverUserId: approver.id })).status === 404);
  check("…nor open the Budget place (404)", (await go(O.page, "/approvals/review/budget/pending"))?.status() === 404);
  check("a plain requester cannot open the All Budgets list (404)", (await go(R.page, "/approvals/budget/all"))?.status() === 404);
  check("you cannot pick yourself as the approver", (await api(R.page, "/api/approvals/requests", "POST", { kind: "budget", eventName: "ZZ Self", description: "x", departmentId: dept.id, financialYear: orig.financial_year, income: {}, vendors: [], budgetPaise: 100, approverUserId: requester.id })).status === 400);

  section("The approver");
  await go(A.page, "/approvals");
  const place = A.page.locator(`nav[aria-label="Approval System"] a[href="/approvals/review/budget/pending"]`).first();
  check("a plain hub user picked as approver gets the Budget place in the sidebar, with a red badge of 1", (await place.count()) === 1 && (await place.innerText()).includes("1"), await place.innerText().catch(() => "none"));
  await go(A.page, "/approvals/review/budget/pending");
  check("the Budget list's first column is the Budget ID", /\bbudget id\b/i.test((await A.page.locator("main table thead th").first().textContent()) ?? ""));
  check("their Pending Budget list holds it, with the event in the Event column", (await text(A.page)).includes("Pending approval") && (await text(A.page)).includes(EVENT) && /\bevent\b/i.test(await text(A.page)), (await text(A.page)).split("Waiting for your decision")[1] ?? await text(A.page));
  await go(A.page, `/approvals/requests/${origId}`);
  const panel = A.page.locator("section[aria-label='Your decision']");
  check("they can Approve or Reject it; there is no Return for corrections", (await panel.getByRole("button", { name: "Approve", exact: true }).count()) === 1 && (await panel.getByRole("button", { name: "Reject", exact: true }).count()) === 1 && (await panel.getByRole("button", { name: /Return/ }).count()) === 0);
  check("the server refuses a return too", (await api(A.page, `/api/approvals/requests/${origId}/decision`, "POST", { action: "return", comment: "fix" })).status === 422);
  await panel.getByRole("button", { name: "Reject", exact: true }).click();
  check("rejecting needs a reason", (await panel.locator(".zf-error").innerText().catch(() => "")).includes("comment"));
  // Its Budget ID is given now: the next number among the budgets of its year already approved.
  const shortFy = `${orig.financial_year.slice(2, 4)}${orig.financial_year.slice(5, 7)}`;
  const approvedBefore = (await sql`select count(*)::int n from apr_requests where type = 'budget' and parent_request_id is null and status = 'approved' and request_no is not null and financial_year = ${orig.financial_year}`)[0].n;
  const expectedNo = `BUD-${shortFy}-${String(approvedBefore + 1).padStart(4, "0")}`;
  await decide(A.page, "Approve");
  check("they approve it", await poll(async () => (await sql`select status from apr_requests where id = ${origId}`)[0].status === "approved"));
  const origNo = (await sql`select request_no from apr_requests where id = ${origId}`)[0].request_no;
  check(`approving gives it its permanent Budget ID, BUD-<short year>-NNNN numbered by approval order (${expectedNo})`, origNo === expectedNo, origNo);
  const n2 = await poll(async () => (await sql`select title from apr_notifications where user_id = ${requester.id} and request_id = ${origId}`)[0]);
  check("the requester is told it was approved, with its Budget ID", n2?.title === `Your Budget approval ${origNo} (${EVENT}) was approved`, n2?.title);
  await go(R.page, `/approvals/requests/${origId}`);
  const approvedId = await idOf(R.page, "budget-id");
  check("its page now shows the Budget ID in navy and bold", approvedId.text === origNo && approvedId.kind === "assigned" && approvedId.cls.includes("font-bold") && approvedId.cls.includes("003F8A"), approvedId);
  check("the approver cannot ask for a revision of someone else's budget (403)", (await api(A.page, `/api/approvals/requests/${origId}/revise`, "POST", { budgetPaise: 100, reason: "x", income: {}, vendors: [], approverUserId: approver.id })).status === 403);

  section("Revisions");
  await go(R.page, `/approvals/requests/${origId}`);
  check("the requester now has Revise Budget; the history shows the Original as the active budget, 0 revisions", (await R.page.locator("[data-testid=budget-revise]").count()) === 1
    && (await R.page.locator("[data-testid=budget-version-0] [data-testid=budget-active-badge]").count()) === 1 && (await R.page.locator("[data-testid=budget-revision-count]").textContent()) === "0 revisions");
  await R.page.locator("[data-testid=budget-revise]").click();
  await R.page.waitForURL(/\/revise$/);
  check("the revision page is headed Revise Budget (not HR Approval), with a link back to the budget", (await R.page.locator("h1").first().innerText()).trim() === "Revise Budget" && !(await R.page.locator("body").innerText()).includes("HR Approval")
    && (await R.page.getByRole("link", { name: /Back to the budget/ }).getAttribute("href")) === `/approvals/requests/${origId}?app=hr`);
  check("the revision form shows the budget in force and keeps its income and expense rows, vendors and approver", (await text(R.page)).includes("The budget in force is ₹10,000.00") && (await R.page.locator("#bud-income-amount-0").inputValue()) === "5,000.00"
    && (await R.page.locator("[data-testid=budget-income-rows] li").count()) === 2 && (await R.page.locator("[data-testid=budget-expense-rows] li").count()) === 2
    && (await R.page.locator("[data-testid=budget-vendors] input").count()) === 2 && (await R.page.locator("#bud-approver").innerText()).includes("ZZ Bud Approver"));
  await R.page.getByRole("button", { name: "Submit revision" }).click();
  check("the new amount and a reason are required", (await R.page.locator("[data-testid=budget-form] .zf-error").count()) >= 2);
  await R.page.locator("#bud-amount").fill("15000");
  await R.page.locator("#bud-reason").fill("Venue cost increased");
  await R.page.getByRole("button", { name: "Submit revision" }).click();
  await R.page.waitForURL((u) => /\/approvals\/requests\/[0-9a-f-]{36}/.test(u.pathname) && !u.pathname.includes(origId), { timeout: 30000 });
  const r1Id = R.page.url().match(/requests\/([0-9a-f-]{36})/)[1];
  const [r1] = await sql`select request_no, parent_request_id, revision_no, status, amount_paise, budget_details from apr_requests where id = ${r1Id}`;
  check("Rev 1 is its own pending request, linked to the original, numbered <original>-R1, with the reason", r1?.parent_request_id === origId && r1.revision_no === 1 && r1.status === "pending" && r1.request_no === `${origNo}-R1` && r1.budget_details?.revisionReason === "Venue cost increased" && r1.budget_details?.eventName === EVENT, r1);
  const n3 = await poll(async () => (await sql`select title from apr_notifications where user_id = ${approver.id} and request_id = ${r1Id}`)[0]);
  check(`the approver is told "Budget revision requested for ${EVENT}"`, n3?.title === `Budget revision requested for ${EVENT}`, n3?.title);
  check("a second revision while one is pending is refused (409)", (await api(R.page, `/api/approvals/requests/${origId}/revise`, "POST", { budgetPaise: 1600000, reason: "again", income: {}, vendors: [], approverUserId: approver.id })).status === 409);
  await go(R.page, `/approvals/requests/${origId}`);
  check("…and the original says so instead of offering Revise Budget", (await R.page.locator("[data-testid=budget-revise]").count()) === 0 && (await R.page.locator("[data-testid=budget-revise-blocked]").innerText()).includes("already waiting"));
  await go(R.page, `/approvals/requests/${origId}/revise`);
  check("…and the revise page sends them back to the budget", new URL(R.page.url()).pathname === `/approvals/requests/${origId}`);
  check("while Rev 1 waits, the Original stays the active budget", (await R.page.locator("[data-testid=budget-version-0] [data-testid=budget-active-badge]").count()) === 1 && (await R.page.locator("[data-testid=budget-version-1]").textContent()).includes("Pending"));

  await go(A.page, `/approvals/requests/${r1Id}`);
  await decide(A.page, "Approve");
  await poll(async () => (await sql`select status from apr_requests where id = ${r1Id}`)[0].status === "approved");
  await go(R.page, `/approvals/requests/${origId}`);
  check("once Rev 1 is approved it is the active budget, and the history counts 1 revision", (await R.page.locator("[data-testid=budget-version-1] [data-testid=budget-active-badge]").count()) === 1 && (await R.page.locator("[data-testid=budget-version-0] [data-testid=budget-active-badge]").count()) === 0 && (await R.page.locator("[data-testid=budget-revision-count]").textContent()) === "1 revision");

  // Rev 2, rejected: Rev 1 stays in force.
  const r2 = await api(R.page, `/api/approvals/requests/${r1Id}/revise`, "POST", { budgetPaise: 1800000, reason: "Additional catering required", incomeLines: [{ name: "ZZ Sponsorship", amountPaise: 500000 }], expenseLines: [{ name: "ZZ Venue", amountPaise: 600000 }, { name: "ZZ Catering", amountPaise: 1200000 }], vendors: ["ZZ Sai Caterers"], approverUserId: approver.id });
  check("a revision can be asked for from a revision's page too: Rev 2 is numbered -R2 and linked to the original", r2.status === 201 && r2.body?.requestNo === `${origNo}-R2` && (await sql`select parent_request_id from apr_requests where id = ${r2.body?.id}`)[0]?.parent_request_id === origId, r2);
  await go(A.page, `/approvals/requests/${r2.body.id}`);
  await decide(A.page, "Reject", "Catering is covered by the sponsor");
  await poll(async () => (await sql`select status from apr_requests where id = ${r2.body.id}`)[0].status === "rejected");
  await go(R.page, `/approvals/requests/${origId}`);
  check("Rev 2 rejected: Rev 1 stays the active budget, and the history shows all three with their reasons and who decided", (await R.page.locator("[data-testid=budget-version-1] [data-testid=budget-active-badge]").count()) === 1
    && (await R.page.locator("[data-testid=budget-version-2]").textContent()).includes("Rejected") && (await R.page.locator("[data-testid=budget-version-2]").textContent()).includes("Additional catering required")
    && (await R.page.locator("[data-testid=budget-version-1]").textContent()).includes("ZZ Bud Approver") && (await R.page.locator("[data-testid=budget-revision-count]").textContent()) === "2 revisions");
  check("and Revise Budget is offered again (no limit on revisions)", (await R.page.locator("[data-testid=budget-revise]").count()) === 1);
  await shot(R.page, "detail");

  section("Lists and print");
  await go(A.page, "/approvals/review/budget/approved");
  check("the approver's Approved Budget list has the original and Rev 1", (await text(A.page)).includes(origNo) && (await text(A.page)).includes(`${origNo}-R1`));
  await go(A.page, "/approvals/review/budget/rejected");
  check("their Rejected Budget list has Rev 2 (its ID shown as Not assigned)", (await text(A.page)).includes("Not assigned") && (await text(A.page)).includes(EVENT));
  const csv = await A.page.evaluate(async () => { const r = await fetch("/api/approvals/requests/export?screen=review/budget/approved"); return { status: r.status, body: await r.text() }; });
  check("they can export their Budget list", csv.status === 200 && csv.body.includes(`${origNo}-R1`), csv.status);
  check("someone else cannot export it (403)", (await O.page.evaluate(async () => (await fetch("/api/approvals/requests/export?screen=review/budget/approved")).status)) === 403);

  await go(R.page, `/approvals/requests/${origId}`);
  check("the page has a Print button", (await R.page.getByRole("button", { name: "Print" }).count()) === 1);
  await R.page.emulateMedia({ media: "print" });
  const printed = (await R.page.locator(".apr-printable").innerText()).replace(/\s+/g, " ");
  check("the printed page has the income and expense rows, their totals, the summary, the vendors and the revision history", ["ZZ Sponsorship", "ZZ Stalls", "Total Income", "ZZ Venue", "ZZ Catering", "Total Expense", "Deficit: ₹2,500.00", "Total Budget Requested", "ZZ Sai Caterers", "ZZ Pune Sound", "Budget history", "Rev 1", "Rev 2", "Venue cost increased"].every((t) => printed.includes(t)), printed.slice(0, 300));
  check("the printed page shows the Budget ID", (await R.page.locator("[data-testid=budget-id-row]").textContent()) === origNo && printed.includes(`Budget ID ${origNo}`));
  check("…and leaves out the controls", !printed.includes("Revise Budget") && !printed.includes("Timeline"));
  await shot(R.page, "print");
  const pdf = await R.page.pdf({ preferCSSPageSize: true, printBackground: true });
  const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  check("it prints on one A4 page", pages === 1, `${pages} pages`);
  await R.page.emulateMedia({ media: "screen" });

  section("Budget IDs follow the order of approval");
  const raise = async (eventName) => (await api(R.page, "/api/approvals/requests", "POST", { kind: "budget", eventName, description: "x", departmentId: dept.id, financialYear: orig.financial_year, incomeLines: [], expenseLines: [], vendors: [], budgetPaise: 50000, approverUserId: approver.id })).body;
  const first = await raise("ZZ Order First"), second = await raise("ZZ Order Second"), third = await raise("ZZ Order Rejected");
  check("a budget gets no number when it is submitted", first?.requestNo === null && second?.requestNo === null && third?.requestNo === null, [first, second, third]);
  const seq = (no) => Number(String(no).slice(-4));
  await api(A.page, `/api/approvals/requests/${second.id}/decision`, "POST", { action: "approve" });
  await api(A.page, `/api/approvals/requests/${first.id}/decision`, "POST", { action: "approve" });
  const [noSecond, noFirst] = await Promise.all([second.id, first.id].map(async (id) => (await sql`select request_no from apr_requests where id = ${id}`)[0].request_no));
  check("the one approved first gets the lower number, whatever order they were submitted in", seq(noSecond) === seq(origNo) + 1 && seq(noFirst) === seq(origNo) + 2 && noFirst.startsWith(`BUD-${shortFy}-`), [origNo, noSecond, noFirst]);
  await api(A.page, `/api/approvals/requests/${third.id}/decision`, "POST", { action: "reject", comment: "Not this year" });
  check("a rejected budget is never given one", (await sql`select request_no from apr_requests where id = ${third.id}`)[0].request_no === null);
  await go(R.page, `/approvals/requests/${third.id}`);
  const rejectedId = await idOf(R.page, "budget-id");
  check("…and its page says Not assigned, in grey", rejectedId.text === "Not assigned" && rejectedId.kind === "none" && rejectedId.cls.includes("italic"), rejectedId);
  const n4 = await poll(async () => (await sql`select title from apr_notifications where user_id = ${requester.id} and request_id = ${third.id}`)[0]);
  check("…and the message about it names the event, with no number", n4?.title === "Your Budget approval (ZZ Order Rejected) was rejected", n4?.title);

  section("Budgets raised before income and expenses were rows");
  const [old] = await sql`insert into apr_requests (request_no, type, status, requester_user_id, requester_name, requester_email, financial_year, current_step, total_steps, amount_paise, budget_details, decided_at)
    values ('ZZ-BUD-OLD-1', 'budget', 'approved', ${requester.id}, 'ZZ Bud Requester', 'zz-bud-requester@example.com', ${orig.financial_year}, 1, 1, 500000,
      ${JSON.stringify({ eventName: "ZZ Old Event", description: "Raised with the fixed income lines", departmentId: dept.id, departmentName: "ZZ Budget Events", financialYear: orig.financial_year, income: { sponsorshipPaise: 100000, stallPaise: null, participantsPaise: 50000, otherPaise: null }, vendors: [] })}::jsonb, now()) returning id`;
  await sql`insert into apr_request_steps (request_id, step_no, step_label, approver_user_id, approver_name, status, decided_at) values (${old.id}, 1, 'Budget Approver', ${approver.id}, 'ZZ Bud Approver', 'approved', now())`;
  const oldResp = await go(R.page, `/approvals/requests/${old.id}`);
  const oldText = await text(R.page);
  check("an older budget still opens, its fixed income lines shown as rows (empty ones left out), no expenses, a Surplus", oldResp?.status() === 200 && oldText.includes("Sponsorship income") && oldText.includes("Participants income") && !oldText.includes("Stall income") && oldText.includes("Surplus: ₹1,500.00"), oldText.slice(0, 300));
  await go(R.page, `/approvals/requests/${old.id}/revise`);
  check("…and its revision form starts from those rows", (await R.page.locator("#bud-income-name-0").inputValue()) === "Sponsorship income" && (await R.page.locator("#bud-income-amount-1").inputValue()) === "500.00");

  section("Administrator: the Budget form's layout");
  const ADMIN_EMAIL = (process.env.HEAD_ADMIN_EMAIL || "").trim().toLowerCase(), ADMIN_PW = process.env.HEAD_ADMIN_PASSWORD || "";
  if (ADMIN_EMAIL && ADMIN_PW) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 1000 } });
    const H = await ctx.newPage();
    await H.goto(BASE + "/login"); await H.locator("input[name=email]").fill(ADMIN_EMAIL); await H.locator("input[name=password]").fill(ADMIN_PW);
    await H.getByRole("button", { name: "Sign in" }).click(); await H.waitForFunction(() => location.pathname !== "/login", null, { timeout: 30000 });
    await H.goto(BASE + "/administrator/approval-forms");
    if (new URL(H.url()).pathname === "/unlock") { await H.locator("input[name=password]").fill(ADMIN_PW); await H.getByRole("button", { name: "Unlock" }).click(); await H.waitForURL((u) => u.pathname !== "/unlock", { timeout: 20000 }).catch(() => {}); await H.goto(BASE + "/administrator/approval-forms"); }
    const card = H.locator('a[href="/administrator/approval-forms/budget"]').filter({ hasText: "Budget form" }).first();
    check("Administrator → Approval Forms has a Budget form card beside HR and Expenditure, with its description and Edit form", (await card.count()) === 1 && (await card.innerText()).includes("The budget approval form for events, with income, expenses and revision tracking.") && (await card.innerText()).includes("Edit form")
      && (await H.locator('a[href="/administrator/approval-forms/hr"]').count()) >= 1 && (await H.locator('a[href="/administrator/approval-forms/expenditure"]').count()) >= 1);
    check("…and Budget is in the Administrator sidebar after HR and Expenditure", (await H.locator('a[href="/administrator/approval-forms/budget"]').count()) >= 2);
    await card.click(); await H.waitForURL(/approval-forms\/budget$/); await H.waitForLoadState("networkidle").catch(() => {});
    const listed = await H.locator('ol[aria-label="Fields of the Budget form"] input[aria-label^="Name of field"]').evaluateAll((els) => els.map((e) => e.value));
    check("its editor lists the Budget form's fields in order", JSON.stringify(listed) === JSON.stringify(["Event name", "Description", "Department", "Financial year", "Income sources", "Expenses", "Vendor name", "Summary", "Total Budget Requested", "Approver"]), listed.join(" | "));
    // A layout like the editor saves: "Event name" renamed, Vendors hidden, and a required extra dropdown after the event.
    const saved = await H.evaluate(async () => (await fetch("/api/approvals/form-fields/budget", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields: [
      { key: "eventName", label: "Programme name" }, { key: "description", label: "Description" }, { key: "department", label: "Department" }, { key: "financialYear", label: "Financial year" },
      { label: "ZZ Venue type", kind: "select", required: true, options: ["Hall", "Outdoor"] },
      { key: "income", label: "Income sources" }, { key: "expenses", label: "Expenses" }, { key: "vendors", label: "Vendor name", hidden: true }, { key: "summary", label: "Summary" },
      { key: "amount", label: "Total Budget Requested" }, { key: "approver", label: "Approver" },
    ] }) })).status);
    check("the Support Admin can save the Budget form's layout", saved === 200, saved);
    check("the event, amount and approver cannot be hidden", (await H.evaluate(async () => (await fetch("/api/approvals/form-fields/budget", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields: [
      { key: "eventName", label: "Event name" }, { key: "description", label: "Description" }, { key: "department", label: "Department" }, { key: "financialYear", label: "Financial year" },
      { key: "income", label: "Income sources" }, { key: "expenses", label: "Expenses" }, { key: "vendors", label: "Vendor name" }, { key: "summary", label: "Summary" },
      { key: "amount", label: "Total Budget Requested", hidden: true }, { key: "approver", label: "Approver" },
    ] }) })).status)) !== 200);
    await ctx.close();

    await go(R.page, "/approvals/budget/new");
    const labels2 = (await R.page.locator("[data-testid=budget-form] .zf-label").allInnerTexts()).map((l) => l.replace(/\s*\*$/, "").trim());
    check("the form follows it: the renamed field, the extra field in its place, and no Vendors", JSON.stringify(labels2) === JSON.stringify(["Programme name", "Description", "Department", "Financial year", "ZZ Venue type", "Income sources", "Expenses", "Summary", "Total Budget Requested", "Approver"]), labels2.join(" | "));
    await R.page.locator("#bud-event").fill("ZZ Layout Event");
    await R.page.locator("#bud-desc").fill("x");
    await pick(R.page, "bud-dept", "ZZ Budget Events");
    await R.page.locator("#bud-amount").fill("1000");
    await pick(R.page, "bud-approver", "ZZ Bud Approver");
    await R.page.getByRole("button", { name: "Submit", exact: true }).click();
    check("the required extra field must be answered", (await R.page.locator("[data-testid=budget-form] .zf-error").allInnerTexts()).some((e) => e.includes("ZZ Venue type")));
    await R.page.locator("#cf-" + (await sql`select key from apr_form_fields where form = 'budget' and not builtin`)[0].key).click();
    await R.page.locator(".zd-pop .zd-opt", { hasText: "Outdoor" }).click();
    await R.page.getByRole("button", { name: "Submit", exact: true }).click();
    await R.page.waitForURL((u) => /\/approvals\/requests\/[0-9a-f-]{36}/.test(u.pathname), { timeout: 30000 });
    const [lay] = await sql`select custom_values, budget_details from apr_requests where id = ${R.page.url().match(/requests\/([0-9a-f-]{36})/)[1]}`;
    check("the answer is kept with the request, under its name, and shown on its page", JSON.stringify(lay?.custom_values?.map((c) => [c.label, c.value])) === JSON.stringify([["ZZ Venue type", "Outdoor"]]) && (await text(R.page)).includes("ZZ Venue type") && (await text(R.page)).includes("Outdoor"), lay?.custom_values);
    await sql`delete from apr_form_fields where form = 'budget'`;
  } else {
    check("Administrator checks need HEAD_ADMIN_EMAIL and HEAD_ADMIN_PASSWORD", false);
  }

  check("no other request was touched", (await sql`select count(*)::int n from apr_requests where requester_user_id not in (select id from users where email like 'zz-bud-%')`)[0].n === otherBefore);
  for (const s of [R, A, O]) await s.ctx.close();
} catch (e) {
  failed = e;
  check("the suite ran to the end without an unexpected error", false, String(e?.stack ?? e));
} finally {
  await browser.close();
  await removeData();
  check("cleanup: no test people, department or budget requests are left", (await sql`select (select count(*)::int from users where email like 'zz-bud-%') + (select count(*)::int from departments where name like 'ZZ Budget%') n`)[0].n === 0);
}

const bad = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length || failed ? 1 : 0);
