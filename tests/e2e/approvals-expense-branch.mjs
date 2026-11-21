/**
 * End-to-end test of the Branch of an expense, in a real browser against a running app: on the expense form, Branch appears under Category
 * only for "Administrative Expenses" (the hub's branches, as on people's profiles), is required there and hidden for any other category; the
 * server enforces the same; the request page (and its printed page) shows the Branch; a watcher's All Approvals has a Branch column and a
 * Branch filter, and its export follows the filter.
 *
 * Writes test people (zz-xb-*, one of them the Expense Admin), a department, two hub branches (ZZ XB ...), the expense categories
 * "Administrative Expenses" (only if missing) and "ZZ XB Events", and requests, and removes them at the end. Run it against a TEST database
 * only, and one with no other Expense Admin:
 *   E2E_BRANCH_CONFIRM=yes E2E_BASE_URL=http://localhost:3000 npm run test:e2e:approvals:branch
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
if (!BASE) { console.error("Set E2E_BASE_URL, for example: E2E_BASE_URL=http://localhost:3000 npm run test:e2e:approvals:branch"); process.exit(2); }
if (process.env.E2E_BRANCH_CONFIRM !== "yes") { console.error("This test writes people, branches and requests. Run it against a test database, then set E2E_BRANCH_CONFIRM=yes."); process.exit(2); }

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
const hash = (pw) => { const salt = randomBytes(16); return `scrypt$16384$${salt.toString("base64")}$${scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("base64")}`; };
const PW = "zz-Branch-pass-1";
const ADMIN_CAT = "Administrative Expenses";

let createdAdminCat = false;
const removeData = async () => {
  const ids = (await sql`select id from users where email like 'zz-xb-%'`).map((r) => r.id);
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
  await sql`delete from users where email like 'zz-xb-%'`;
  await sql`delete from apr_categories where name = 'ZZ XB Events'`;
  if (createdAdminCat) await sql`delete from apr_categories where name = ${ADMIN_CAT}`;
  await sql`delete from branches where name like 'ZZ XB %'`;
  await sql`delete from departments where name = 'ZZ XB Dept'`;
};

await removeData();
const [dept] = await sql`insert into departments (kind, name, icon) values ('organisation', 'ZZ XB Dept', 'Building') returning id`;
const person = async (name, email, role = "member") => (await sql`insert into users (name, email, password_hash, status, role, home_department_id) values (${name}, ${email}, ${hash(PW)}, 'approved', ${role}, ${dept.id}) returning id`)[0];
const requester = await person("ZZ XB Requester", "zz-xb-requester@example.com");
await person("ZZ XB Expense Admin", "zz-xb-expense@example.com", "expense_admin");
const watcher = await person("ZZ XB Watcher", "zz-xb-watcher@example.com");
const [pune] = await sql`insert into branches (name) values ('ZZ XB Pune') returning id`;
const [mumbai] = await sql`insert into branches (name) values ('ZZ XB Mumbai') returning id`;
let [adminCat] = await sql`select id from apr_categories where lower(name) = lower(${ADMIN_CAT})`;
if (!adminCat) { [adminCat] = await sql`insert into apr_categories (name) values (${ADMIN_CAT}) returning id`; createdAdminCat = true; }
await sql`update apr_categories set active = true where id = ${adminCat.id}`;
const [eventCat] = await sql`insert into apr_categories (name) values ('ZZ XB Events') returning id`;
await sql`insert into apr_watchers (form_type, user_id) values ('expenditure', ${watcher.id})`;

const browser = await launch();
const signedIn = async (email) => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 1000 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("mccia-install-popup-seen", "1"); localStorage.setItem("mccia-install-snoozed-until", String(Date.now() + 864e5)); } catch { /* none */ } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
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
const pick = async (page, id, label) => {
  await page.locator(`#${id}`).click();
  await page.getByRole("option", { name: label, exact: true }).click();
};
/** After Submit the app lands on My Requests with ?submitted=<id>. */
const submittedId = async (page) => {
  await page.waitForURL(/submitted=[0-9a-f-]{36}|requests\/[0-9a-f-]{36}/, { timeout: 30000 }).catch(() => {});
  return page.url().match(/(?:submitted=|requests\/)([0-9a-f-]{36})/)?.[1];
};
const labels = async (page) => (await page.locator("label.zf-label").allInnerTexts()).map((t) => t.replace(/\s*\*$/, "").trim());

let failed = null;
try {
  const R = await signedIn("zz-xb-requester@example.com");
  const W = await signedIn("zz-xb-watcher@example.com");

  section("The expense form");
  await go(R.page, "/approvals/expenses/new");
  check("no Branch field before a category is chosen", (await R.page.locator("#ex-branch").count()) === 0 && !(await labels(R.page)).includes("Branch"));
  await pick(R.page, "ex-category", "ZZ XB Events");
  check("…nor for another category", (await R.page.locator("#ex-branch").count()) === 0);
  await pick(R.page, "ex-category", ADMIN_CAT);
  await R.page.locator("#ex-branch").waitFor({ timeout: 10000 }).catch(() => {});
  const ls = await labels(R.page);
  check("Administrative Expenses: Branch appears right below Category, marked required", ls.indexOf("Branch") === ls.indexOf("Category") + 1 && (await R.page.locator("label.zf-label", { hasText: "Branch" }).innerText()).includes("*"), ls.join(" | "));
  await R.page.locator("#ex-branch").click();
  const opts = await R.page.getByRole("option").allInnerTexts();
  check("its options are the hub's branches (as on people's profiles)", opts.some((o) => o.includes("ZZ XB Pune")) && opts.some((o) => o.includes("ZZ XB Mumbai")), opts.join(" | "));
  await R.page.keyboard.press("Escape");
  await R.page.locator("#ex-vendor").fill("ZZ XB Stationers");
  await R.page.locator("#ex-amount").fill("2,500");
  await R.page.getByRole("button", { name: "Submit" }).click();
  check("submitting without a branch says to choose it", await R.page.getByText("Choose the branch.").first().waitFor({ timeout: 10000 }).then(() => true, () => false));
  await pick(R.page, "ex-branch", "ZZ XB Pune");
  await R.page.getByRole("button", { name: "Submit" }).click();
  const adminId = await submittedId(R.page);
  check("with a branch it is submitted", !!adminId, R.page.url());
  const [stored] = adminId ? await sql`select custom_values from apr_requests where id = ${adminId}` : [{}];
  check("the branch is kept in the request's form data (name and id), no column of its own", stored?.custom_values?.length === 1 && ["key", "label", "value", "ref"].every((k) => stored.custom_values[0][k] === { key: "branch", label: "Branch", value: "ZZ XB Pune", ref: pune.id }[k]), stored?.custom_values);

  section("The request page and its print");
  await go(R.page, `/approvals/requests/${adminId}`);
  const item = R.page.locator(".zdl", { hasText: "ZZ XB Pune" });
  const detail = (await R.page.locator("main").textContent()).replace(/\s+/g, " ");
  check("the request page shows Branch: ZZ XB Pune, once", (await item.count()) === 1 && /Branch\s*ZZ XB Pune/.test(detail) && (detail.match(/ZZ XB Pune/g) ?? []).length === 1, detail.slice(0, 600));
  await R.page.emulateMedia({ media: "print" });
  check("…and so does the printed page", await R.page.getByText("ZZ XB Pune").first().isVisible());
  await R.page.emulateMedia({ media: "screen" });

  section("Any other category: no branch");
  await go(R.page, "/approvals/expenses/new");
  await pick(R.page, "ex-category", ADMIN_CAT);
  await pick(R.page, "ex-branch", "ZZ XB Mumbai");
  await pick(R.page, "ex-category", "ZZ XB Events");
  check("switching away from Administrative Expenses hides Branch again", (await R.page.locator("#ex-branch").count()) === 0);
  await R.page.locator("#ex-vendor").fill("ZZ XB Caterers");
  await R.page.locator("#ex-amount").fill("1,200");
  await R.page.getByRole("button", { name: "Submit" }).click();
  const eventId = await submittedId(R.page);
  const [ev] = eventId ? await sql`select custom_values from apr_requests where id = ${eventId}` : [{}];
  check("it is submitted without a branch (the one picked before is not sent)", !!eventId && JSON.stringify(ev?.custom_values) === "[]", ev?.custom_values);
  await go(R.page, `/approvals/requests/${eventId}`);
  check("…and its page shows no Branch", (await R.page.locator("main").textContent()).includes("ZZ XB Caterers") && !/Branch/.test((await R.page.locator("main section").first().textContent()) ?? ""));

  section("The server enforces it");
  const base = { kind: "small", employeeUserId: requester.id, email: "zz-xb-requester@example.com", requestedAt: new Date().toISOString(), vendorName: "ZZ XB Direct", amountPaise: 50000, custom: {} };
  const noBranch = await api(R.page, "/api/approvals/requests", "POST", { ...base, categoryId: adminCat.id });
  check("Administrative Expenses without a branch is refused (422)", noBranch.status === 422 && /branch/i.test(noBranch.body?.error ?? ""), noBranch);
  const badBranch = await api(R.page, "/api/approvals/requests", "POST", { ...base, categoryId: adminCat.id, hubBranchId: eventCat.id });
  check("…and with something that is not a hub branch (422)", badBranch.status === 422, badBranch);
  const extra = await api(R.page, "/api/approvals/requests", "POST", { ...base, categoryId: eventCat.id, hubBranchId: mumbai.id });
  const [ex] = extra.body?.id ? await sql`select custom_values from apr_requests where id = ${extra.body.id}` : [{}];
  check("a branch sent with another category is dropped", extra.status < 300 && JSON.stringify(ex?.custom_values) === "[]", { extra, ex });
  const mum = await api(R.page, "/api/approvals/requests", "POST", { ...base, categoryId: adminCat.id, hubBranchId: mumbai.id, vendorName: "ZZ XB Mumbai Vendor" });
  check("Administrative Expenses with a hub branch is accepted", mum.status < 300 && !!mum.body?.id, mum);

  section("A watcher's All Approvals: Branch column and filter");
  await go(W.page, "/approvals/watching/all");
  const head = (await W.page.locator("thead").textContent()) ?? "";
  check("the list has a Branch column", /Branch/.test(head), head);
  const rowOf = (id) => W.page.locator(`tbody tr:has(a[href*='${id}'])`);
  check("…showing the branch of each Administrative expense", ((await rowOf(adminId).textContent()) ?? "").includes("ZZ XB Pune") && ((await rowOf(mum.body.id).textContent()) ?? "").includes("ZZ XB Mumbai"));
  const filter = W.page.locator("select", { has: W.page.locator("option", { hasText: "ZZ XB Pune" }) });
  check("there is a Branch filter listing the hub's branches", (await filter.count()) === 1);
  await filter.selectOption({ label: "ZZ XB Pune" });
  await W.page.waitForURL(/branchId=/, { timeout: 15000 }).catch(() => {});
  await W.page.waitForLoadState("networkidle").catch(() => {});
  const shown = await W.page.locator("tbody tr").allTextContents();
  check("filtering by ZZ XB Pune leaves just that request", shown.length === 1 && shown[0].includes("ZZ XB Pune"), shown);
  const csv = await W.page.evaluate(async (u) => (await fetch(u)).text(), `/api/approvals/requests/export?screen=watching/all&branchId=${pune.id}`);
  const lines = csv.trim().split(/\r?\n/);
  check("…and the export follows the filter, with a Branch column", lines.length === 2 && lines[0].includes("Branch") && lines[1].includes("ZZ XB Pune"), csv.slice(0, 400));
  const search = await go(W.page, "/approvals/watching/all?q=ZZ%20XB%20Mumbai");
  const found = await W.page.locator("tbody tr").allTextContents();
  check("searching by a branch name finds its requests", search?.status() === 200 && found.length === 1 && found[0].includes("ZZ XB Mumbai"), found);
} catch (e) {
  failed = e;
  console.error(e);
} finally {
  await browser.close().catch(() => {});
  await removeData().catch((e) => console.error("cleanup failed", e));
}
const bad = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - bad}/${results.length} checks passed`);
process.exit(failed || bad ? 1 : 0);
