/**
 * End-to-end test of Watchers in the Approval System, in a real browser against a running app: the Support Admin adds a watcher to a form
 * in Administrator > Approval Forms; a new request of that form tells the watcher (bell, and no second notice for an approver who also
 * watches); the watcher sees the Watching section and the list, opens and prints the request, exports the list, and cannot decide it or see a
 * form they do not watch; watcher emails are off by default; the Support Admin removes the watcher and everything is gone again.
 *
 * Writes test people (zz-wat-*), a test department and budget requests, and removes them at the end. Run it against a TEST database only:
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
  const openForms = async () => {
    await go(H.page, "/administrator/approval-forms");
    if (new URL(H.page.url()).pathname === "/unlock") {
      await H.page.locator("input[name=password]").fill(ADMIN_PW); await H.page.getByRole("button", { name: "Unlock" }).click();
      await H.page.waitForURL((u) => u.pathname !== "/unlock", { timeout: 30000 });
      await go(H.page, "/administrator/approval-forms");
    }
  };

  section("Before: no watchers");
  const before = await raise(R, "ZZ Before Watching");
  await go(W.page, "/approvals");
  check("a plain user has no Watching section", (await W.page.locator("nav a[href^='/approvals/watching/']").count()) === 0);
  check("…cannot open a Watching list (404)", (await go(W.page, "/approvals/watching/budget"))?.status() === 404);
  check("…nor a budget they have no part in (404)", (await go(W.page, `/approvals/requests/${before.id}`))?.status() === 404);
  check("…nor export a Watching list (403)", (await raw(W.page, "/api/approvals/requests/export?screen=watching/budget")).status === 403);

  section("Administrator > Approval Forms: adding a watcher");
  await openForms();
  const card = H.page.locator("[data-testid=watchers-budget]");
  check("each form card (HR, Expenditure, Budget) has a Watchers section with its count", (await H.page.locator("[data-testid=watchers-hr]").count()) === 1 && (await H.page.locator("[data-testid=watchers-expenditure]").count()) === 1
    && (await card.count()) === 1 && (await H.page.locator("[data-testid=watchers-budget-count]").textContent()) === "(0)");
  check("…and each card still opens its form editor", (await H.page.locator("[data-testid=form-card-budget] a[href='/administrator/approval-forms/budget']").count()) === 1);
  await H.page.locator("[data-testid=watchers-budget-add]").click();
  await H.page.locator("[data-testid=watchers-budget-search]").fill("zz-wat-watch");
  const option = card.locator("[data-testid=watcher-option]");
  check("searching hub users by email finds the person", (await option.count()) === 1 && (await option.textContent()).includes("ZZ Wat Watcher"), await option.allTextContents());
  await option.click();
  await poll(async () => (await H.page.locator("[data-testid=watchers-budget-count]").textContent()) === "(1)");
  check("one click adds them: the Budget card shows Watchers (1) with their name", (await H.page.locator("[data-testid=watchers-budget-count]").textContent()) === "(1)" && (await card.textContent()).includes("ZZ Wat Watcher"));
  check("…stored once, for the Budget form only", JSON.stringify((await sql`select form_type from apr_watchers where user_id = ${watcher.id}`).map((r) => r.form_type)) === JSON.stringify(["budget"]));
  check("…and recorded in the audit log", (await sql`select count(*)::int n from apr_admin_audit where entity = 'watcher' and summary = 'ZZ Wat Watcher now watches the Budget form'`)[0].n === 1);
  check("adding the same person again changes nothing", (await api(H.page, "/api/approvals/watchers", "POST", { form: "budget", userId: watcher.id })).status === 201 && (await sql`select count(*)::int n from apr_watchers where user_id = ${watcher.id}`)[0].n === 1);
  check("someone who is not the Support Admin cannot add watchers (403)", (await api(W.page, "/api/approvals/watchers", "POST", { form: "hr", userId: watcher.id })).status === 403 && (await api(A.page, "/api/approvals/watchers", "POST", { form: "budget", userId: approver.id })).status === 403);
  // The approver also watches Budget: they must still get only one notice about a budget sent to them.
  check("an approver can be a watcher too", (await api(H.page, "/api/approvals/watchers", "POST", { form: "budget", userId: approver.id })).status === 201);

  section("A new request tells the watchers");
  const fresh = await raise(R, EVENT);
  const wNote = await poll(async () => (await sql`select title, link from apr_notifications where user_id = ${watcher.id} and request_id = ${fresh.id}`)[0]);
  check("the watcher gets a bell notice \"ZZ Wat Requester submitted a new Budget request\" that opens it", wNote?.title === "ZZ Wat Requester submitted a new Budget request" && wNote.link.includes(fresh.id), wNote);
  check("the approver who also watches Budget gets one notice, not two", (await sql`select count(*)::int n from apr_notifications where user_id = ${approver.id} and request_id = ${fresh.id}`)[0].n === 1);
  check("the person who raised it is not told as a watcher", (await sql`select count(*)::int n from apr_notifications where user_id = ${requester.id} and request_id = ${fresh.id}`)[0].n === 0);
  check("watcher emails are off by default (bell only)", ((await sql`select value from apr_settings where key = 'notify_watchers_by_email'`)[0]?.value ?? "false") === "false");

  section("What the watcher sees");
  await go(W.page, "/approvals");
  const nav = W.page.locator(`nav[aria-label="Approval System"]`).first();
  const watchingLink = nav.locator("a[href='/approvals/watching/budget']");
  check("the sidebar has Watching > Budget, with the number of budgets", (await nav.textContent()).includes("Watching") && (await watchingLink.count()) >= 1 && /\d/.test(await watchingLink.last().textContent()), await nav.textContent());
  check("…and no HR or Expenditure, which they do not watch", (await nav.locator("a[href='/approvals/watching/hr'], a[href='/approvals/watching/expenditure']").count()) === 0);
  await go(W.page, "/approvals/watching/budget");
  check("the Watching list holds every budget, including ones raised before they watched", (await text(W.page)).includes(EVENT) && (await text(W.page)).includes("ZZ Before Watching"));
  check("…with no Approve or Reject on its rows", (await W.page.getByRole("button", { name: /^(Approve|Reject)$/ }).count()) === 0);
  check("a form they do not watch stays closed (404)", (await go(W.page, "/approvals/watching/hr"))?.status() === 404);
  await go(W.page, `/approvals/requests/${fresh.id}`);
  check("they open the request: full details, and the note that they are watching", (await text(W.page)).includes(EVENT) && (await W.page.locator("[data-testid=watching-note]").textContent()).includes("You are watching the Budget form"));
  check("…no Approve / Reject panel, no Revise, no Delete", (await W.page.locator("section[aria-label='Your decision']").count()) === 0 && (await W.page.locator("[data-testid=budget-revise], [data-testid=budget-delete]").count()) === 0);
  check("…they can print it", (await W.page.getByRole("button", { name: "Print" }).count()) === 1);
  check("the server refuses a decision from them (403)", (await api(W.page, `/api/approvals/requests/${fresh.id}/decision`, "POST", { action: "approve" })).status === 403);
  check("…and a revision", [403, 404].includes((await api(W.page, `/api/approvals/requests/${fresh.id}/revise`, "POST", { reason: "x", incomeLines: [], expenseLines: [], budgetPaise: 1, approverUserId: approver.id })).status));
  const csv = await raw(W.page, "/api/approvals/requests/export?screen=watching/budget");
  check("they can export the Watching list as CSV", csv.status === 200 && csv.body.includes(EVENT), csv.status);
  check("…but not a list of another form (403)", (await raw(W.page, "/api/approvals/requests/export?screen=watching/hr")).status === 403);
  check("someone else still cannot open it (404)", (await go(O.page, `/approvals/requests/${fresh.id}`))?.status() === 404);
  check("the approver still decides it as before", (await api(A.page, `/api/approvals/requests/${fresh.id}/decision`, "POST", { action: "approve" })).status === 200);

  section("Removing the watcher");
  await openForms();
  const row = H.page.locator("[data-testid=watchers-budget] [data-testid=watcher-row]", { hasText: "ZZ Wat Watcher" });
  await row.getByRole("button", { name: /Remove/ }).click();
  await poll(async () => (await sql`select count(*)::int n from apr_watchers where user_id = ${watcher.id}`)[0].n === 0);
  check("one click removes them; the card count drops", (await sql`select count(*)::int n from apr_watchers where user_id = ${watcher.id}`)[0].n === 0
    && await poll(async () => (await H.page.locator("[data-testid=watchers-budget-count]").textContent()) === "(1)"));
  check("…recorded in the audit log", (await sql`select count(*)::int n from apr_admin_audit where entity = 'watcher' and summary = 'ZZ Wat Watcher no longer watches the Budget form'`)[0].n === 1);
  await go(W.page, "/approvals");
  check("the watcher no longer has the Watching section", (await W.page.locator("nav a[href^='/approvals/watching/']").count()) === 0);
  check("…nor the list (404)", (await go(W.page, "/approvals/watching/budget"))?.status() === 404);
  check("…nor the request (404)", (await go(W.page, `/approvals/requests/${fresh.id}`))?.status() === 404);
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
