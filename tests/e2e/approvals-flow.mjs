/**
 * End-to-end test of the Approvals request flow in a real browser: submitting HR requests and expenses, routing by role (HR Admin, then the
 * Super Admin; the Expense Admin, then the Super Admin from ₹10,000), recommending and deciding from the screens, returning for corrections,
 * files, who can see what, lists, export, reports, notifications and an extra form field.
 *
 * Run it against a TEST database (a Neon branch, for example), never the live one:
 *   E2E_FLOW_CONFIRM=yes E2E_BASE_URL=http://localhost:3000 npm run test:e2e:approvals:flow
 *
 * Why not live: it makes its own Super Admin, HR Admin and Expense Admin (one person each, so it refuses a database where real people hold
 * those roles), and it uses up request numbers (it puts the counters back). Everything it creates is named "ZZ"/"zz-flow-" and is removed
 * when it finishes, and again at the start in case an earlier run was interrupted.
 *
 * The site must be running with APPROVALS_ENABLED=true and the module's migrations applied (npx drizzle-kit migrate).
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
if (!BASE) { console.error("Set E2E_BASE_URL, for example: E2E_BASE_URL=http://localhost:3000 npm run test:e2e:approvals:flow"); process.exit(2); }
if (/neon\.tech/i.test(process.env.DATABASE_URL || "") && process.env.E2E_ALLOW_NEON !== "yes") { console.error("DATABASE_URL is a Neon address. Point it (and the site) at a test database, or a Neon branch with E2E_ALLOW_NEON=yes."); process.exit(2); }
if (process.env.E2E_FLOW_CONFIRM !== "yes") {
  console.error("This test makes its own approvers and uses request numbers. Run it against a test database (a Neon branch), then set E2E_FLOW_CONFIRM=yes.");
  process.exit(2);
}
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
const check = (name, ok, extra = "") => { results.push([name, !!ok]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? "  -> " + String(extra).slice(0, 220) : ""}`); };
const section = (t) => console.log(`\n== ${t} ==`);
const poll = async (fn, ms = 20000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 400)); } return v; };
const hash = (pw) => { const salt = randomBytes(16); return `scrypt$16384$${salt.toString("base64")}$${scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("base64")}`; };

const PW = "zz-Flow-pass-1";
const PEOPLE = {
  req: { name: "ZZ Flow Requester", email: "zz-flow-requester@example.com", role: "member" },
  hr: { name: "ZZ Flow HR Admin", email: "zz-flow-hr@example.com", role: "hr_admin" },
  exp: { name: "ZZ Flow Expense Admin", email: "zz-flow-exp@example.com", role: "expense_admin" },
  dg: { name: "ZZ Flow DG", email: "zz-flow-dg@example.com", role: "super_admin" },
  other: { name: "ZZ Flow Other", email: "zz-flow-other@example.com", role: "member" },
};

let savedCounters = null, savedFields = null;
const removeFlowData = async () => {
  const ids = (await sql`select id from users where email like 'zz-flow-%'`).map((r) => r.id);
  for (const uid of ids) {
    for (const r of await sql`select id from apr_requests where requester_user_id = ${uid}`) {
      await sql`delete from apr_approval_events where request_id = ${r.id}`;
      await sql`delete from apr_requests where id = ${r.id}`; // details, steps and attachments go with it
    }
    await sql`delete from apr_files where uploaded_by = ${uid}`;
    await sql`delete from apr_notifications where user_id = ${uid}`;
    await sql`delete from apr_rate_limits where user_id = ${uid}`;
    await sql`delete from apr_user_roles where user_id = ${uid}`;
    await sql`delete from user_app_access where user_id = ${uid}`;
    await sql`delete from activity_log where user_id = ${uid}`;
  }
  if (savedCounters) {
    const now = await sql`select key from apr_counters`;
    for (const c of savedCounters) await sql`update apr_counters set last_value = ${c.last_value} where key = ${c.key}`;
    for (const c of now) if (!savedCounters.some((x) => x.key === c.key)) await sql`delete from apr_counters where key = ${c.key}`;
  }
  if (savedFields) {
    await sql`delete from apr_form_fields`;
    for (const f of savedFields) await sql`insert into apr_form_fields (form, key, label, builtin, kind, required, hidden, sort_order, options) values (${f.form}, ${f.key}, ${f.label}, ${f.builtin}, ${f.kind}, ${f.required}, ${f.hidden}, ${f.sort_order}, ${f.options})`;
  }
  await sql`delete from login_attempts where email like 'zz-flow-%'`;
  await sql`delete from users where email like 'zz-flow-%'`;
  await sql`delete from apr_categories where name like 'ZZ%'`;
  await sql`delete from apr_hr_categories where name like 'ZZ%'`;
  await sql`delete from apr_admin_audit where summary like '%ZZ%' or entity = 'form_fields'`;
};

const holders = await sql`select count(*)::int n from users where role in ('super_admin','hr_admin','expense_admin') and email not like 'zz-flow-%'`;
if (holders[0].n > 0) { console.error("This database already has a Super Admin, HR Admin or Expense Admin. Use a test database: the suite makes its own."); process.exit(2); }
await removeFlowData();
savedCounters = await sql`select key, last_value from apr_counters`;
savedFields = await sql`select form, key, label, builtin, kind, required, hidden, sort_order, options from apr_form_fields`;
const categoriesBefore = JSON.stringify(await sql`select name, active from apr_categories where name not like 'ZZ%' order by name`);

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
const status = async (page, p) => (await page.goto(BASE + p)).status();
const post = (page, url, data) => page.request.post(BASE + url, { data });
const body = async (res) => { try { return await res.json(); } catch { return {}; } };
const main = (page) => page.locator("main").first().innerText();
const labels = async (page) => (await page.locator("label.zf-label").allInnerTexts()).map((t) => t.replace(/\s*\*$/, "").trim());
async function submitWith(page, data) {
  const res = await page.request.post(BASE + "/api/approvals/requests", { data });
  return { status: res.status(), json: await body(res) };
}
const reqRow = async (id) => (await sql`select * from apr_requests where id = ${id}`)[0];

try {
  section("0. Setup: a requester, the three approvers (one person each), and categories");
  const ids = {};
  for (const [k, pp] of Object.entries(PEOPLE)) {
    const [u] = await sql`insert into users (name, email, role, password_hash, status) values (${pp.name}, ${pp.email}, ${pp.role}::role, ${hash(PW)}, 'approved') returning id`;
    ids[k] = u.id;
  }
  const [cat] = await sql`insert into apr_categories (name) values ('ZZ Flow Cat') returning id`;
  const [hrCat] = await sql`insert into apr_hr_categories (name) values ('ZZ Flow Certificate') returning id`;
  check("test people and categories are in place", Object.values(ids).every(Boolean) && !!cat && !!hrCat);
  const R = await newSession(), H = await newSession(), X = await newSession(), D = await newSession(), O = await newSession(), A = await newSession();
  await Promise.all([signIn(R.page, PEOPLE.req.email, PW), signIn(H.page, PEOPLE.hr.email, PW), signIn(X.page, PEOPLE.exp.email, PW), signIn(D.page, PEOPLE.dg.email, PW), signIn(O.page, PEOPLE.other.email, PW), signIn(A.page, ADMIN_EMAIL, ADMIN_PW)]);
  const exp = (amountPaise, extra = {}) => ({ employeeUserId: ids.req, email: PEOPLE.req.email, categoryId: cat.id, amountPaise, vendorName: "ZZ Vendor", ...extra });

  section("1. The forms");
  await R.page.goto(BASE + "/approvals/hr/new");
  check("the HR form has its fields in order", JSON.stringify(await labels(R.page)) === JSON.stringify(["Name", "Email", "Category", "Date of Request", "Amount", "Description", "File upload", "File upload"]), (await labels(R.page)).join(" | "));
  await R.page.goto(BASE + "/approvals/expenses/new");
  const expLabels = ["Name", "Email", "Date", "Category", "Nature of Expenditure", "File upload", "Date", "Type of Publication", "Publication", "Vendor Name", "Tax Invoice", "Quotation", "Date of Tax Invoice", "Amount"];
  check("the one expense form has its fields in order", JSON.stringify(await labels(R.page)) === JSON.stringify(expLabels), (await labels(R.page)).join(" | "));
  check("the Name is the signed-in person and the Email is filled in from it", (await R.page.locator("#ex-email").inputValue()) === PEOPLE.req.email && (await R.page.locator("#ex-name").innerText()).includes(PEOPLE.req.name));
  await R.page.locator("#ex-amount").fill("15,000");
  await R.page.getByText("recommends it to the Director General").first().waitFor({ timeout: 10000 }).catch(() => {});
  check("typing 15,000 keeps exactly the same fields, says it goes on to the DG, and does not block Submit", JSON.stringify(await labels(R.page)) === JSON.stringify(expLabels) && (await R.page.getByText("recommends it to the Director General").count()) >= 1 && !(await R.page.getByRole("button", { name: "Submit" }).isDisabled()));

  section("2. + Add New in the dropdowns is for the Support Admin only, behind the Administrator lock");
  await R.page.goto(BASE + "/approvals/hr/new");
  await R.page.locator("#hr-category").click();
  check("a requester does not see + Add New", (await R.page.getByRole("button", { name: /Add New/ }).count()) === 0);
  await A.page.goto(BASE + "/approvals/hr/new");
  await A.page.locator("#hr-category").click();
  check("the Support Admin sees + Add New", (await A.page.getByRole("button", { name: /Add New/ }).count()) === 1);
  await A.page.getByRole("button", { name: /Add New/ }).click();
  await A.page.locator("#zd-new-name").fill("ZZ Flow Added Category");
  await A.page.getByRole("button", { name: "Add", exact: true }).click();
  check("with Administrator locked, adding is refused and says how to unlock it", await toast(A.page, "Administrator has locked") && (await sql`select count(*)::int n from apr_hr_categories where name = 'ZZ Flow Added Category'`)[0].n === 0);

  section("3. An HR request, through the screens: the HR Admin recommends it, the Super Admin decides");
  const rp = R.page;
  await rp.goto(BASE + "/approvals/hr/new");
  check("the name is pre-filled from the signed-in person", (await rp.locator("#hr-first").inputValue()) === "ZZ" && (await rp.locator("#hr-last").inputValue()) === "Flow Requester");
  await rp.locator("#hr-category").click();
  await rp.getByRole("option", { name: "ZZ Flow Certificate", exact: true }).click();
  await rp.locator("#hr-desc").fill("ZZ flow test certificate");
  await rp.locator(".zf-row", { has: rp.locator("#hr-file1") }).locator("input[type=file]").setInputFiles({ name: "zz-note.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 zz flow test file") });
  check("the chosen file is shown by name", await rp.getByText("zz-note.pdf").first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false));
  await rp.getByRole("button", { name: "Submit" }).click();
  await rp.waitForURL(/\/approvals\/requests\/[0-9a-f-]{36}/, { timeout: 30000 }).catch(() => {});
  const hrId = new URL(rp.url()).pathname.split("/").pop();
  const hrReq = await reqRow(hrId);
  check("submitting saved a pending request with an HR number", hrReq?.status === "pending" && /^HR-\d{4}-\d{2}-\d{4}$/.test(hrReq.request_no), hrReq?.request_no);
  check("it has two steps and waits for the HR Admin", hrReq?.total_steps === 2 && hrReq.current_approver_user_id === ids.hr);
  check("the file is stored and attached", (await sql`select count(*)::int n from apr_attachments where request_id = ${hrId}`)[0].n === 1);
  check("the requester sees a confirmation with the number", await rp.locator("main [role=status]", { hasText: `Request submitted: ${hrReq.request_no}` }).first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false));
  check("the HR Admin was notified, the Super Admin not yet", (await sql`select count(*)::int n from apr_notifications where user_id = ${ids.hr} and request_id = ${hrId}`)[0].n === 1 && (await sql`select count(*)::int n from apr_notifications where user_id = ${ids.dg} and request_id = ${hrId}`)[0].n === 0);
  await H.page.goto(BASE + "/approvals/review/hr/pending");
  check("it is in the HR Admin's Pending HR list", (await main(H.page)).includes(hrReq.request_no));
  await H.page.goto(BASE + `/approvals/requests/${hrId}`);
  check("the HR Admin's buttons are Recommend to DG, Return for corrections and Reject", (await H.page.getByRole("button", { name: "Recommend to DG", exact: true }).count()) === 1 && (await H.page.getByRole("button", { name: "Return for corrections", exact: true }).count()) === 1 && (await H.page.getByRole("button", { name: "Reject", exact: true }).count()) === 1);
  await H.page.getByRole("button", { name: "Recommend to DG", exact: true }).click();
  check("recommending needs no comment and says it went to the DG", await toast(H.page, "Recommended to the DG") && await poll(async () => (await reqRow(hrId)).current_approver_user_id === ids.dg));
  await D.page.goto(BASE + "/approvals/review/recommendation/hr");
  check("it is in the Super Admin's Recommended list, HR tab", (await main(D.page)).includes(hrReq.request_no));
  await D.page.goto(BASE + `/approvals/requests/${hrId}`);
  check("the Super Admin's buttons are Final approve and Final reject", (await D.page.getByRole("button", { name: "Final approve", exact: true }).count()) === 1 && (await D.page.getByRole("button", { name: "Final reject", exact: true }).count()) === 1);
  await D.page.getByRole("button", { name: "Final approve", exact: true }).click();
  check("approving needs no comment", await toast(D.page, "Request approved") && await poll(async () => (await reqRow(hrId)).status === "approved"));
  const events = (await sql`select action from apr_approval_events where request_id = ${hrId} order by id`).map((e) => e.action);
  check("the history has the submission, both approvals and the viewing", events[0] === "submitted" && events.filter((e) => e === "approved").length === 2 && events.includes("viewed"), events.join(","));
  check("the requester was told", (await sql`select count(*)::int n from apr_notifications where user_id = ${ids.req} and request_id = ${hrId} and title like '%approved%'`)[0].n === 1);

  section("4. Files are private");
  const [att] = await sql`select id from apr_attachments where request_id = ${hrId}`;
  const own = await R.page.request.get(`${BASE}/api/approvals/files/${att.id}`);
  check("the requester can open the file, with the right bytes and type", own.status() === 200 && (await own.text()).startsWith("%PDF-1.4 zz flow") && /pdf/.test(own.headers()["content-type"]));
  check("its approvers can open it too", (await H.page.request.get(`${BASE}/api/approvals/files/${att.id}`)).status() === 200 && (await D.page.request.get(`${BASE}/api/approvals/files/${att.id}`)).status() === 200);
  check("someone not involved gets a 404 for the file and for the request", (await O.page.request.get(`${BASE}/api/approvals/files/${att.id}`)).status() === 404 && (await status(O.page, `/approvals/requests/${hrId}`)) === 404);
  check("the Expense Admin, who has no step on an HR request, gets a 404 too", (await X.page.request.get(`${BASE}/api/approvals/files/${att.id}`)).status() === 404);
  check("without signing in, the file address gives nothing", (await (await browser.newContext()).request.get(`${BASE}/api/approvals/files/${att.id}`, { maxRedirects: 0 })).status() !== 200);

  section("5. Upload rules");
  check("a file type that is not allowed is refused", (await post(R.page, "/api/approvals/uploads", { fileName: "virus.exe", size: 100 })).status() === 400);
  check("a file over 10 MB is refused", (await post(R.page, "/api/approvals/uploads", { fileName: "big.pdf", size: 10 * 1024 * 1024 + 1 })).status() === 400);
  const started = await body(await post(R.page, "/api/approvals/uploads", { fileName: "zz-short.pdf", size: 1000 }));
  check("a part of the wrong size is refused", (await R.page.request.put(`${BASE}/api/approvals/uploads/${started.fileId}?i=0`, { data: Buffer.from("too short"), headers: { "Content-Type": "application/octet-stream" } })).status() === 400);
  check("someone else cannot add to my upload", (await O.page.request.put(`${BASE}/api/approvals/uploads/${started.fileId}?i=0`, { data: Buffer.alloc(1000), headers: { "Content-Type": "application/octet-stream" } })).status() === 404);
  check("a request pointing at a file that never finished uploading is refused", (await submitWith(R.page, { kind: "hr", firstName: "A", lastName: "B", hrCategoryId: hrCat.id, fileUpload: { fileId: started.fileId } })).status === 400);

  section("6. Expenses: the Expense Admin, then the Super Admin from ₹10,000");
  check("an amount sent as the wrong kind is refused (the one form always sends the right one)", (await submitWith(R.page, { kind: "small", ...exp(1000000) })).status === 422 && (await submitWith(R.page, { kind: "large", ...exp(999900) })).status === 422);
  const big = await submitWith(R.page, { kind: "large", ...exp(1500000, { natureOfExpenditure: "ZZ test", expenseDate: "2026-04-10", taxInvoiceDate: "2026-04-09" }) });
  check("a 15,000 expense is accepted with an EXP number", big.status === 201 && /^EXP-\d{4}-\d{2}-\d{4}$/.test(big.json.requestNo), big.json.requestNo ?? big.json.error);
  check("it waits for the Expense Admin, then goes to the Super Admin (two steps), and keeps the expense dates", (await reqRow(big.json.id)).current_approver_user_id === ids.exp && (await reqRow(big.json.id)).total_steps === 2 && (await sql`select expense_date::text d from apr_expenditure_details where request_id = ${big.json.id}`)[0].d === "2026-04-10");
  check("the requester cannot decide their own request", (await post(R.page, `/api/approvals/requests/${big.json.id}/decision`, { action: "approve" })).status() === 403);
  check("someone not involved is told it does not exist", (await post(O.page, `/api/approvals/requests/${big.json.id}/decision`, { action: "approve" })).status() === 404);
  check("the Super Admin cannot decide it before the Expense Admin", (await post(D.page, `/api/approvals/requests/${big.json.id}/decision`, { action: "approve" })).status() === 403);
  check("rejecting needs a comment", (await post(X.page, `/api/approvals/requests/${big.json.id}/decision`, { action: "reject" })).status() === 422);
  check("the Expense Admin recommends it without a comment, the Super Admin approves it", (await post(X.page, `/api/approvals/requests/${big.json.id}/decision`, { action: "approve" })).status() === 200 && (await post(D.page, `/api/approvals/requests/${big.json.id}/decision`, { action: "approve" })).status() === 200 && (await reqRow(big.json.id)).status === "approved");
  check("deciding again is refused with a clear message", await (async () => { const r = await post(D.page, `/api/approvals/requests/${big.json.id}/decision`, { action: "reject", comment: "x" }); return r.status() === 409 && /already been approved/.test((await body(r)).error); })());
  const rej = await submitWith(R.page, { kind: "large", ...exp(1200000) });
  check("an expense the Expense Admin rejects ends there and never reaches the Super Admin", (await post(X.page, `/api/approvals/requests/${rej.json.id}/decision`, { action: "reject", comment: "Not needed" })).status() === 200 && (await reqRow(rej.json.id)).status === "rejected" && (await sql`select count(*)::int n from apr_notifications where user_id = ${ids.dg} and request_id = ${rej.json.id}`)[0].n === 0);
  const small = await submitWith(R.page, { kind: "small", ...exp(500000, { expenseDate: "2026-04-10", taxInvoiceDate: "2026-04-09" }) });
  check("a 5,000 expense gets an EXB number and one step, the Expense Admin", small.status === 201 && /^EXB-\d{4}-\d{2}-\d{4}$/.test(small.json.requestNo) && (await reqRow(small.json.id)).total_steps === 1 && (await reqRow(small.json.id)).current_approver_user_id === ids.exp, small.json.error);
  await X.page.goto(BASE + "/approvals/review/expenditure/pending");
  check("it is in the Expense Admin's Pending Expenditure list", (await main(X.page)).includes(small.json.requestNo));
  await X.page.goto(BASE + `/approvals/requests/${small.json.id}`);
  await X.page.getByRole("button", { name: "Approve", exact: true }).click();
  check("the Expense Admin's Approve is the final decision, with no comment needed", await toast(X.page, "Request approved") && await poll(async () => (await reqRow(small.json.id)).status === "approved"));
  check("a future tax invoice date is refused, and the vendor name is required", (await submitWith(R.page, { kind: "small", ...exp(100000, { taxInvoiceDate: "2099-01-01" }) })).status === 400 && (await submitWith(R.page, { kind: "small", ...exp(100000, { vendorName: "  " }) })).status === 400);

  section("7. Nobody approves their own request; two clicks at once; withdrawing");
  const byHr = await submitWith(H.page, { kind: "hr", firstName: "ZZ", lastName: "ByHr", hrCategoryId: hrCat.id });
  check("an HR request raised by the HR Admin skips their step and goes to the Super Admin", byHr.status === 201 && (await reqRow(byHr.json.id)).current_approver_user_id === ids.dg && (await reqRow(byHr.json.id)).total_steps === 1);
  const byExp = await submitWith(X.page, { kind: "small", ...exp(300000, { employeeUserId: ids.exp, email: PEOPLE.exp.email }) });
  check("an expense raised by the Expense Admin goes to the Super Admin instead", byExp.status === 201 && (await reqRow(byExp.json.id)).current_approver_user_id === ids.dg, byExp.json.error);
  const race = await submitWith(R.page, { kind: "small", ...exp(200000) });
  const [r1, r2] = await Promise.all([post(X.page, `/api/approvals/requests/${race.json.id}/decision`, { action: "approve" }), post(X.page, `/api/approvals/requests/${race.json.id}/decision`, { action: "reject", comment: "no" })]);
  check("when two decisions arrive together exactly one wins", [r1.status(), r2.status()].sort().join() === "200,409", `${r1.status()},${r2.status()}`);
  const wd = await submitWith(R.page, { kind: "hr", firstName: "ZZ", lastName: "Withdraw", hrCategoryId: hrCat.id });
  check("someone else cannot withdraw my request; I can while it is pending; then it cannot be decided", (await post(O.page, `/api/approvals/requests/${wd.json.id}/withdraw`, {})).status() === 404 && (await post(R.page, `/api/approvals/requests/${wd.json.id}/withdraw`, {})).status() === 200 && (await post(H.page, `/api/approvals/requests/${wd.json.id}/decision`, { action: "approve" })).status() === 409);

  section("8. Who sees what in the lists");
  const closed = ["/approvals/hr/all", "/approvals/expenditures/all", "/approvals/review/hr/pending", "/approvals/review/expenditure/pending", "/approvals/review/recommendation/hr", "/approvals/timeline", "/approvals/hr/report"];
  const closedStatuses = []; for (const pp of closed) closedStatuses.push(await status(R.page, pp));
  check("a plain requester gets a 404 for every list and report", closedStatuses.every((st) => st === 404), closedStatuses.join(","));
  check("and the CSV export is closed to them (403), while both forms open", (await R.page.request.get(`${BASE}/api/approvals/requests/export?screen=hr/all`)).status() === 403 && (await status(R.page, "/approvals/hr/new")) === 200 && (await status(R.page, "/approvals/expenses/new")) === 200);
  await R.page.goto(BASE + `/approvals/requests/${small.json.id}?app=exp`);
  check("their own request page opens with its number and where it stands", (await main(R.page)).includes(small.json.requestNo) && /approved/i.test(await main(R.page)));
  check("the HR Admin has the HR place and not the Expenditure one; the Expense Admin the other way round", (await status(H.page, "/approvals/review/hr/approved")) === 200 && (await status(H.page, "/approvals/review/expenditure/pending")) === 404 && (await status(X.page, "/approvals/review/expenditure/approved")) === 200 && (await status(X.page, "/approvals/review/hr/pending")) === 404);
  await X.page.goto(BASE + "/approvals/review/expenditure/approved");
  check("the Expense Admin's Approved list holds what they approved", (await main(X.page)).includes(small.json.requestNo));
  await D.page.goto(BASE + "/approvals/review/recommendation/expenditure");
  check("the Super Admin's Recommended list has HR and Expenditure tabs, and the expense they decided", (await D.page.locator('nav[aria-label="Recommended lists"] a').allInnerTexts()).map((t) => t.replace(/\s*\d+$/, "").trim()).join("|") === "HR|Expenditure" && (await main(D.page)).includes(big.json.requestNo));
  await A.page.goto(BASE + "/approvals/expenditures/all?q=" + encodeURIComponent(big.json.requestNo));
  const searched = await A.page.locator("tbody tr").allInnerTexts();
  check("the Support Admin's search narrows the list to the matching request", searched.length === 1 && searched[0].includes(big.json.requestNo), searched.length);
  const csv = await A.page.request.get(`${BASE}/api/approvals/requests/export?screen=expenditures/all`);
  const csvText = await csv.text();
  check("the export is a CSV with a header and the requests", csv.status() === 200 && /text\/csv/.test(csv.headers()["content-type"]) && csvText.includes("Request No.") && csvText.includes(big.json.requestNo));
  check("the reports open for the Support Admin", (await status(A.page, "/approvals/hr/report")) === 200 && (await status(A.page, "/approvals/hr/approval-time")) === 200);
  await A.page.goto(BASE + `/approvals/timeline?id=${hrId}`);
  check("the Approval Timeline shows who did what", /Submitted by ZZ Flow Requester/.test(await main(A.page)) && /ZZ Flow HR Admin/.test(await main(A.page)) && /ZZ Flow DG/.test(await main(A.page)));

  section("9. Notifications");
  const notes = await body(await R.page.request.get(`${BASE}/api/approvals/notifications`));
  check("the requester has notifications about their decided requests", notes.unread >= 3 && notes.items.some((n) => /approved/.test(n.title)) && notes.items.some((n) => /rejected/.test(n.title)), `${notes.unread} unread`);
  const linked = notes.items.find((n) => /approved/.test(n.title) && n.link);
  check("a notification opens the request page", !!linked && (await status(R.page, linked.link)) === 200);
  check("marking all read clears the count", (await post(R.page, "/api/approvals/notifications", {})).status() === 200 && (await body(await R.page.request.get(`${BASE}/api/approvals/notifications`))).unread === 0);
  check("one person's notifications never show another's requests", (await body(await O.page.request.get(`${BASE}/api/approvals/notifications`))).items.length === 0);

  section("10. Returned for corrections, through the screens");
  const ret = await submitWith(R.page, { kind: "large", ...exp(1200000, { vendorName: "ZZ Return Vendor", natureOfExpenditure: "first version" }) });
  const xp = X.page;
  await xp.goto(BASE + `/approvals/requests/${ret.json.id}`);
  await xp.getByRole("button", { name: "Return for corrections", exact: true }).click();
  check("returning without a comment is stopped with a plain message, and nothing changes", await xp.getByText("Please write a comment saying what needs to be corrected.").first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false) && (await reqRow(ret.json.id)).status === "pending");
  await xp.locator("textarea").first().fill("Vendor name is incomplete, please write the full name");
  await xp.getByRole("button", { name: "Return for corrections", exact: true }).click();
  check("returning with a comment works, keeps the step and approver, and tells the requester", await toast(xp, "Request returned for corrections") && await poll(async () => (await reqRow(ret.json.id)).status === "returned") && (await reqRow(ret.json.id)).current_approver_user_id === ids.exp && (await sql`select count(*)::int n from apr_notifications where user_id = ${ids.req} and request_id = ${ret.json.id} and title like '%returned for corrections%'`)[0].n === 1);
  const rr = R.page;
  await rr.goto(BASE + `/approvals/requests/${ret.json.id}`);
  check("the requester sees who returned it and why, with Edit and resubmit", (await main(rr)).includes("ZZ Flow Expense Admin") && (await main(rr)).includes("Vendor name is incomplete") && (await rr.getByRole("link", { name: "Edit and resubmit" }).count()) === 1);
  check("nobody else can open the correction form", (await status(O.page, `/approvals/requests/${ret.json.id}/edit`)) === 404 && (await status(X.page, `/approvals/requests/${ret.json.id}/edit`)) === 404);
  await rr.goto(BASE + `/approvals/requests/${ret.json.id}`);
  await rr.getByRole("link", { name: "Edit and resubmit" }).click();
  await rr.waitForURL(/\/edit$/, { timeout: 30000 });
  check("the correction form has the same fields as a new expense, the saved values, and Resubmit", JSON.stringify(await labels(rr)) === JSON.stringify(expLabels) && (await rr.locator("#ex-vendor").inputValue()) === "ZZ Return Vendor" && (await rr.getByRole("button", { name: "Resubmit" }).count()) === 1, (await labels(rr)).join(" | "));
  await rr.locator("#ex-vendor").fill("ZZ Return Vendor Private Limited");
  await rr.locator("#ex-amount").fill("12,500");
  await rr.getByRole("button", { name: "Resubmit" }).click();
  check("resubmitting shows a message", await toast(rr, "corrected and sent back for approval"));
  const back = await reqRow(ret.json.id);
  check("it is pending again with the same number and the new amount, for the same Expense Admin", back.status === "pending" && back.request_no === ret.json.requestNo && Number(back.amount_paise) === 1250000 && back.current_approver_user_id === ids.exp && (await sql`select vendor_name from apr_expenditure_details where request_id = ${ret.json.id}`)[0].vendor_name === "ZZ Return Vendor Private Limited");
  check("the Expense Admin is told it was corrected", (await sql`select count(*)::int n from apr_notifications where user_id = ${ids.exp} and request_id = ${ret.json.id} and title like '%corrected%'`)[0].n === 1);
  check("then it goes on to the Super Admin as before", (await post(xp, `/api/approvals/requests/${ret.json.id}/decision`, { action: "approve" })).status() === 200 && (await reqRow(ret.json.id)).current_approver_user_id === ids.dg);

  section("11. Approval Forms: an extra field the Support Admin adds is asked, checked and kept");
  await A.page.goto(BASE + "/administrator/approval-forms/hr"); await unlock(A.page);
  const hrFields = (await body(await A.page.request.get(`${BASE}/api/approvals/form-fields/hr`))).fields;
  const toPut = (fs) => fs.map((f) => ({ key: f.key, label: f.label, hidden: f.hidden, kind: f.builtin ? undefined : f.kind, required: f.required, options: f.options }));
  const put1 = await A.page.request.put(`${BASE}/api/approvals/form-fields/hr`, { data: { fields: [...toPut(hrFields), { key: null, label: "ZZ Employee code", kind: "text", required: true, hidden: false, options: [] }] } });
  const codeKey = ((await body(put1)).fields ?? []).find((f) => f.label === "ZZ Employee code")?.key;
  check("with Administrator unlocked, the Support Admin saves an extra required field on the HR form", put1.status() === 200 && /^c_[a-z0-9]{8}$/.test(codeKey ?? ""));
  check("a requester is not allowed to change the forms", (await R.page.request.put(`${BASE}/api/approvals/form-fields/hr`, { data: { fields: toPut(hrFields) } })).status() === 403);
  await R.page.goto(BASE + "/approvals/hr/new");
  check("the HR form now asks for it", (await R.page.getByText("ZZ Employee code").count()) >= 1);
  const noCode = await submitWith(R.page, { kind: "hr", firstName: "Eve", lastName: "Extra", hrCategoryId: hrCat.id, custom: {} });
  check("sending the request without it is refused, naming the field", noCode.status === 422 && /ZZ Employee code/.test(noCode.json.error), noCode.json.error);
  const withCode = await submitWith(R.page, { kind: "hr", firstName: "Eve", lastName: "Extra", hrCategoryId: hrCat.id, custom: { [codeKey]: "E-42" } });
  await R.page.goto(BASE + `/approvals/requests/${withCode.json.id}`);
  check("with the answer it is accepted, and its page shows the answer under the field's name", withCode.status === 201 && /ZZ Employee code/.test(await main(R.page)) && /E-42/.test(await main(R.page)));

  section("12. Console");
  check("no browser console or page errors on any screen", consoleErrors.length === 0 && pageErrors.length === 0, [...consoleErrors, ...pageErrors].join(" | "));
} catch (e) {
  check("the suite ran to the end without an unexpected error", false, e.stack || e);
} finally {
  await browser.close().catch(() => {});
  await removeFlowData().catch((e) => console.error("CLEANUP FAILED, run again to retry:", e.message));
  check("the categories are exactly as before", JSON.stringify(await sql`select name, active from apr_categories where name not like 'ZZ%' order by name`) === categoriesBefore);
  check("no test approvers are left holding a role", (await sql`select count(*)::int n from users where email like 'zz-flow-%'`)[0].n === 0);
}

const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
