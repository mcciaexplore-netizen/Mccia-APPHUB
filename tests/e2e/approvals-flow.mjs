/**
 * End-to-end test of the Approvals request flow in a real browser: submitting HR, expenditure and expense requests, routing, approving,
 * rejecting, the budget the requester types, over-budget handling, files, who can see what, lists, export, reports and notifications.
 *
 * Run it against a TEST database (a Neon branch, for example), never the live one:
 *   E2E_FLOW_CONFIRM=yes E2E_BASE_URL=http://localhost:3000 npm run test:e2e:approvals:flow
 *
 * Why not live: while it runs it temporarily names its own test people as the approvers on the routing rules (and puts the rules back
 * at the end), and it uses up request numbers (it puts the counters back too). A real request submitted in that window would be routed
 * to a test person. Everything it creates is named "ZZ"/"zz-flow-" and is removed when it finishes, and again at the start in case an
 * earlier run was interrupted.
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
  console.error("This test changes the approver rules while it runs. Run it against a test database (a Neon branch), then set E2E_FLOW_CONFIRM=yes.");
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
  req: { name: "ZZ Flow Requester", email: "zz-flow-requester@example.com" },
  dg: { name: "ZZ Flow DG", email: "zz-flow-dg@example.com" },
  small: { name: "ZZ Flow Small Approver", email: "zz-flow-small@example.com" },
  other: { name: "ZZ Flow Other", email: "zz-flow-other@example.com" },
};

/** The financial year of now in Indian time, spelled like the app does ("2026-27"). */
const fyNow = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "numeric" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  const start = Number(p.month) >= 4 ? Number(p.year) : Number(p.year) - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
};
const FY = fyNow();

let savedRules = null;
let savedCounters = null;

const removeFlowData = async () => {
  const ids = (await sql`select id from users where email like 'zz-flow-%'`).map((r) => r.id);
  for (const uid of ids) {
    for (const r of await sql`select id from apr_requests where requester_user_id = ${uid}`) {
      await sql`delete from apr_approval_events where request_id = ${r.id}`;
      await sql`delete from apr_requests where id = ${r.id}`; // details, steps and attachments go with it
    }
    await sql`delete from apr_files where uploaded_by = ${uid}`; // chunks go with it
    await sql`delete from apr_notifications where user_id = ${uid}`;
    await sql`delete from apr_rate_limits where user_id = ${uid}`;
    await sql`delete from apr_user_roles where user_id = ${uid}`;
    await sql`delete from user_app_access where user_id = ${uid}`;
    await sql`delete from activity_log where user_id = ${uid}`;
  }
  if (savedRules) for (const r of savedRules) await sql`update apr_approver_rules set approver_user_ids = ${r.approver_user_ids}, active = ${r.active} where id = ${r.id}`;
  if (savedCounters) {
    const now = await sql`select key from apr_counters`;
    for (const c of savedCounters) await sql`update apr_counters set last_value = ${c.last_value} where key = ${c.key}`;
    for (const c of now) if (!savedCounters.some((s) => s.key === c.key)) await sql`delete from apr_counters where key = ${c.key}`;
  }
  await sql`delete from users where email like 'zz-flow-%'`;
  await sql`delete from apr_categories where name like 'ZZ%'`;
  await sql`delete from apr_hr_categories where name like 'ZZ%'`;
  await sql`delete from apr_branches where name like 'ZZ%'`;
  await sql`delete from apr_form_fields`;
  await sql`delete from apr_admin_audit where summary like '%ZZ%' or entity = 'form_fields'`;
  await sql`delete from apps where name like 'ZZ Flow%'`;
  await sql`delete from departments where name like 'ZZ Flow%'`;
};

await removeFlowData();
// An interrupted earlier run may have left rules naming test people who no longer exist: drop those names before taking the "before" picture.
await sql`update apr_approver_rules r set approver_user_ids = coalesce((select array_agg(u) from unnest(r.approver_user_ids) u where exists (select 1 from users where id = u)), '{}')`;
savedRules = await sql`select id, approver_user_ids, active from apr_approver_rules`;
savedCounters = await sql`select key, last_value from apr_counters`;
const seededBefore = { categories: (await sql`select count(*)::int n from apr_categories where name not like 'ZZ%'`)[0].n, rules: savedRules.length };

const browser = await launch();
// The "Download the app" popup and banner are marked as already seen in every test browser, so they never cover a button.
{ const open = browser.newContext.bind(browser); browser.newContext = async (o) => { const c = await open(o); await c.addInitScript(() => { try { localStorage.setItem("mccia-install-popup-seen", "1"); localStorage.setItem("mccia-install-snoozed-until", String(Date.now() + 864e5)); } catch {} }); return c; }; }
const consoleErrors = [], pageErrors = [];
const newSession = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 1000 } });
  ctx.setDefaultTimeout(60000); ctx.setDefaultNavigationTimeout(90000);
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
const toast = (page, t) => page.getByText(t).first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
const status = async (page, p) => (await page.goto(BASE + p)).status();
const post = (page, url, data) => page.request.post(BASE + url, { data });
const body = async (res) => { try { return await res.json(); } catch { return {}; } };

// The requester types the budget: a roomy one by default, so a request is not over budget unless a test says so.
const common = (branchId, categoryId) => ({ categoryId, branchId, budgetAllocatedPaise: 100000000, budgetUsedPaise: 0 });
const tight = (allocated, used) => ({ budgetAllocatedPaise: allocated, budgetUsedPaise: used });

try {
  section("0. Setup: people, rules, a branch and categories");
  const ids = {};
  for (const [k, p] of Object.entries(PEOPLE)) {
    const [u] = await sql`insert into users (name, email, password_hash, status) values (${p.name}, ${p.email}, ${hash(PW)}, 'approved') returning id`;
    ids[k] = u.id;
  }
  // HR and expenditure of 10,000 and above: the DG only (the Reviewer step is left empty). Expenses below 10,000: the small approver.
  await sql`update apr_approver_rules set approver_user_ids = '{}', active = true`;
  await sql`update apr_approver_rules set approver_user_ids = ${[ids.dg]} where request_type in ('hr', 'expenditure_large') and step_no = 2`;
  await sql`update apr_approver_rules set approver_user_ids = ${[ids.small]} where request_type = 'expenditure_small' and step_no = 1`;
  const [branch] = await sql`insert into apr_branches (name) values ('ZZ Flow Branch') returning id`;
  const [cat] = await sql`insert into apr_categories (name) values ('ZZ Flow Cat') returning id`;
  const [hrCat] = await sql`select id from apr_hr_categories where name = 'Certificate'`;
  check("test people, rules, branch and categories are in place", !!(ids.req && ids.dg && ids.small && branch && cat && hrCat), `FY ${FY}`);

  const R = await newSession(), D = await newSession(), S = await newSession(), O = await newSession(), A = await newSession();
  await Promise.all([
    signIn(R.page, PEOPLE.req.email, PW), signIn(D.page, PEOPLE.dg.email, PW), signIn(S.page, PEOPLE.small.email, PW),
    signIn(O.page, PEOPLE.other.email, PW), signIn(A.page, ADMIN_EMAIL, ADMIN_PW),
  ]);

  section("1. The forms look like the Zoho ones");
  const labels = async (page) => (await page.locator("label.zf-label").allInnerTexts()).map((t) => t.replace(/\s*\*$/, "").trim());
  await R.page.goto(BASE + "/approvals/hr/new");
  check("the HR form has its fields in the Zoho order", JSON.stringify(await labels(R.page)) === JSON.stringify(["Name", "Email", "Category", "Date of Request", "Amount", "Description", "File upload", "File upload"]), (await labels(R.page)).join(" | "));
  await R.page.goto(BASE + "/approvals/expenditures/new");
  check("the old ₹10,000+ address opens the one expense form", new URL(R.page.url()).pathname === "/approvals/expenses/new");
  await R.page.locator("#ex-amount").fill("15,000");
  await R.page.getByText("the first approver recommends it to the Director General").first().waitFor({ timeout: 10000 }).catch(() => {});
  check("typing 15,000 switches the one form to the ₹10,000+ fields, with its 13 fields (no branch) in order (the budget allocated and used are typed)", JSON.stringify(await labels(R.page)) === JSON.stringify(["Name", "Email", "Date of Request", "Difference", "Category", "Nature of Expenditure", "Budget Allocated", "Budget Used", "Budget Remaining", "Amount", "Vendor Name", "Tax Invoice/Supporting Documents", "Quotation"]), (await labels(R.page)).join(" | "));
  check("Submit and Reset are there", (await R.page.getByRole("button", { name: "Submit" }).count()) === 1 && (await R.page.getByRole("button", { name: "Reset" }).count()) === 1);
  await R.page.goto(BASE + "/approvals/expenses/new");
  check("the below-10k form has its 18 fields (no branch) in order (two of them labelled Date; the budget allocated and used are typed)", JSON.stringify(await labels(R.page)) === JSON.stringify(["Name", "Email", "Date", "Category", "Nature of Expenditure", "Budget Allocated", "Budget Used", "Available budget", "File upload", "Budget Remaining", "Date", "Type of Publication", "Publication", "Vendor Name", "Tax Invoice", "Quotation", "Date of Tax Invoice", "Amount"]), (await labels(R.page)).join(" | "));
  check("the Name is the signed-in person and the Email is already filled in from it", (await R.page.locator("#ex-email").inputValue()) === PEOPLE.req.email && (await R.page.locator("#ex-name").innerText()).includes(PEOPLE.req.name), await R.page.locator("#ex-email").inputValue());
  check("the worked-out budget boxes show the ##,##,###.## placeholder with the rupee sign, and the two typed ones are boxes to fill", (await R.page.locator("#ex-alloc").isEditable()) && (await R.page.locator("#ex-used").isEditable()) && (await R.page.locator("#ex-available").getAttribute("placeholder")) === "##,##,###.##" && (await R.page.locator("#ex-after").getAttribute("placeholder")) === "##,##,###.##");

  section("2. + Add New is for admins only");
  await R.page.goto(BASE + "/approvals/hr/new");
  await R.page.locator("#hr-category").click();
  check("a requester does not see + Add New", (await R.page.getByRole("button", { name: /Add New/ }).count()) === 0);
  await A.page.goto(BASE + "/approvals/hr/new");
  await A.page.locator("#hr-category").click();
  check("the admin sees + Add New", (await A.page.getByRole("button", { name: /Add New/ }).count()) === 1);
  await A.page.getByRole("button", { name: /Add New/ }).click();
  await A.page.locator("#zd-new-name").fill("ZZ Flow HR Category");
  await A.page.getByRole("button", { name: "Add", exact: true }).click();
  check("a category added from the dropdown is saved and selected at once", (await poll(async () => (await sql`select count(*)::int n from apr_hr_categories where name = 'ZZ Flow HR Category'`)[0].n === 1)) && (await A.page.locator("#hr-category").innerText()).includes("ZZ Flow HR Category"));

  section("3. HR request, through the form: submit, then the DG approves");
  const rp = R.page;
  await rp.goto(BASE + "/approvals/hr/new");
  check("the name is pre-filled from the signed-in person", (await rp.locator("#hr-first").inputValue()) === "ZZ" && (await rp.locator("#hr-last").inputValue()) === "Flow Requester");
  await rp.locator("#hr-category").click();
  await rp.getByRole("option", { name: "Certificate", exact: true }).click();
  await rp.locator("#hr-desc").fill("ZZ flow test certificate");
  await rp.locator(".zf-row", { has: rp.locator("#hr-file1") }).locator("input[type=file]").setInputFiles({ name: "zz-note.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 zz flow test file") });
  check("the chosen file is shown by name", await rp.getByText("zz-note.pdf").first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false));
  await rp.getByRole("button", { name: "Submit" }).click();
  await rp.waitForURL(/\/approvals\/requests\/[0-9a-f-]{36}/, { timeout: 30000 }).catch(() => {});
  const hrId = new URL(rp.url()).pathname.split("/").pop();
  const [hrReq] = await sql`select * from apr_requests where id = ${hrId}`;
  check("submitting saved a pending request with an HR number", hrReq?.status === "pending" && /^HR-\d{4}-\d{2}-\d{4}$/.test(hrReq.request_no), hrReq?.request_no);
  check("it went to the DG, in one step", hrReq?.current_approver_user_id === ids.dg && hrReq.total_steps === 1);
  check("the file is stored and attached", (await sql`select count(*)::int n from apr_attachments where request_id = ${hrId}`)[0].n === 1 && (await sql`select count(*)::int n from apr_file_chunks c join apr_attachments a on a.storage_key = c.file_id::text where a.request_id = ${hrId}`)[0].n === 1);
  check("the DG was notified", (await sql`select count(*)::int n from apr_notifications where user_id = ${ids.dg} and request_id = ${hrId}`)[0].n === 1);
  check("right after submitting, the requester sees a confirmation with the request number, on the request page", await rp.locator("main [role=status]", { hasText: `Request submitted: ${hrReq.request_no}` }).first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false), rp.url());

  const dp = D.page;
  await dp.goto(BASE + "/approvals/inbox");
  check("the request is in the DG's inbox", (await dp.locator("main").first().innerText()).includes(hrReq.request_no));
  await dp.goto(BASE + `/approvals/requests/${hrId}`);
  check("the DG sees the Approve and Reject buttons", (await dp.getByRole("button", { name: "Approve", exact: true }).count()) === 1 && (await dp.getByRole("button", { name: "Reject", exact: true }).count()) === 1);
  await dp.getByRole("button", { name: "Approve", exact: true }).click();
  check("approving shows a message", await toast(dp, "Request approved"));
  check("the request is approved in the database", await poll(async () => (await sql`select status from apr_requests where id = ${hrId}`)[0].status === "approved"));
  const events = (await sql`select action from apr_approval_events where request_id = ${hrId} order by id`).map((e) => e.action);
  check("the timeline recorded submitted, assigned, viewed and approved", ["submitted", "assigned", "viewed", "approved"].every((a) => events.includes(a)), events.join(","));
  check("the requester was told", (await sql`select count(*)::int n from apr_notifications where user_id = ${ids.req} and request_id = ${hrId} and title like '%approved%'`)[0].n === 1);

  section("4. Files are private");
  const [att] = await sql`select id from apr_attachments where request_id = ${hrId}`;
  const own = await R.page.request.get(`${BASE}/api/approvals/files/${att.id}`);
  check("the requester can open the file, with the right bytes and type", own.status() === 200 && (await own.text()).startsWith("%PDF-1.4 zz flow") && /pdf/.test(own.headers()["content-type"]));
  check("the DG can open it too", (await D.page.request.get(`${BASE}/api/approvals/files/${att.id}`)).status() === 200);
  check("someone not involved gets a 404 for the file", (await O.page.request.get(`${BASE}/api/approvals/files/${att.id}`)).status() === 404);
  check("and a 404 for the request itself", (await status(O.page, `/approvals/requests/${hrId}`)) === 404);
  check("an unsigned address to the file gets nothing without signing in", (await (await browser.newContext()).request.get(`${BASE}/api/approvals/files/${att.id}`, { maxRedirects: 0 })).status() !== 200);

  section("5. Upload rules");
  const bad1 = await post(R.page, "/api/approvals/uploads", { fileName: "virus.exe", size: 100 });
  check("a file type that is not allowed is refused", bad1.status() === 400);
  const bad2 = await post(R.page, "/api/approvals/uploads", { fileName: "big.pdf", size: 10 * 1024 * 1024 + 1 });
  check("a file over 10 MB is refused", bad2.status() === 400);
  const started = await body(await post(R.page, "/api/approvals/uploads", { fileName: "zz-short.pdf", size: 1000 }));
  const short = await R.page.request.put(`${BASE}/api/approvals/uploads/${started.fileId}?i=0`, { data: Buffer.from("too short"), headers: { "Content-Type": "application/octet-stream" } });
  check("a part of the wrong size is refused", short.status() === 400);
  const theirs = await O.page.request.put(`${BASE}/api/approvals/uploads/${started.fileId}?i=0`, { data: Buffer.alloc(1000), headers: { "Content-Type": "application/octet-stream" } });
  check("someone else cannot add to my upload", theirs.status() === 404);
  const half = await submitWith(R.page, { kind: "hr", firstName: "A", lastName: "B", hrCategoryId: hrCat.id, fileUpload: { fileId: started.fileId } });
  check("a request pointing at a file that never finished uploading is refused", half.status === 400, half.json.error);

  section("6. The 10,000 rule");
  const wrongSmall = await submitWith(R.page, { kind: "small", employeeUserId: ids.req, email: "a@b.org", ...common(branch.id, cat.id), amountPaise: 1000000, vendorName: "V" });
  check("10,000 on the below-10k form is refused with the redirect message", wrongSmall.status === 422 && /10,000 and above must be submitted through DG Expenditure Approval/.test(wrongSmall.json.error), wrongSmall.json.error);
  const wrongLarge = await submitWith(R.page, { kind: "large", employeeUserId: ids.req, ...common(branch.id, cat.id), amountPaise: 999900 });
  check("9,999 on the DG form is refused with the reverse message", wrongLarge.status === 422 && /below ₹10,000 must be submitted through the Expenses form/.test(wrongLarge.json.error), wrongLarge.json.error);
  await R.page.goto(BASE + "/approvals/expenses/new");
  await R.page.locator("#ex-amount").fill("15,000");
  check("on the one expense form, 15,000 says it will go on to the DG and does not block Submit", (await R.page.getByText("the first approver recommends it to the Director General").count()) >= 1 && !(await R.page.getByRole("button", { name: "Submit" }).isDisabled()));
  await R.page.locator("#ex-amount").fill("9,999");
  check("and 9,999 goes back to the expense fields, with no wrong-form message", (await R.page.getByText("the first approver recommends it to the Director General").count()) === 0 && (await R.page.getByText("must be submitted through").count()) === 0 && (await R.page.locator("#ex-vendor").count()) === 1);

  section("7. Expenditure of 15,000 against the budget the requester typed");
  const big = await submitWith(R.page, { kind: "large", employeeUserId: ids.req, ...common(branch.id, cat.id), ...tight(5000000, 0), amountPaise: 1500000, vendorName: "ZZ Vendor", natureOfExpenditure: "ZZ test" });
  check("a 15,000 request is accepted with an EXP number", big.status === 201 && /^EXP-\d{4}-\d{2}-\d{4}$/.test(big.json.requestNo), big.json.requestNo ?? big.json.error);
  const [bigRow] = await sql`select r.over_budget, r.current_approver_user_id, d.budget_allocated_paise, d.budget_available_paise, d.budget_remaining_paise from apr_requests r join apr_expenditure_details d on d.request_id = r.id where r.id = ${big.json.id}`;
  check("it is not over budget and its budget snapshot is stored", bigRow.over_budget === false && Number(bigRow.budget_allocated_paise) === 5000000 && Number(bigRow.budget_available_paise) === 5000000 && Number(bigRow.budget_remaining_paise) === 3500000, JSON.stringify(bigRow));
  check("it went to the DG", bigRow.current_approver_user_id === ids.dg);
  check("the requester cannot decide their own request", (await post(R.page, `/api/approvals/requests/${big.json.id}/decision`, { action: "approve" })).status() === 403);
  check("someone who has nothing to do with it cannot decide it (and is told it does not exist)", (await post(S.page, `/api/approvals/requests/${big.json.id}/decision`, { action: "approve" })).status() === 404);
  check("rejecting needs a comment", (await post(D.page, `/api/approvals/requests/${big.json.id}/decision`, { action: "reject" })).status() === 422);
  const okDecision = await post(D.page, `/api/approvals/requests/${big.json.id}/decision`, { action: "approve" });
  check("the DG approves without a comment (it is within budget)", okDecision.status() === 200);
  check("deciding again is refused with a clear message", await (async () => { const r = await post(D.page, `/api/approvals/requests/${big.json.id}/decision`, { action: "reject", comment: "x" }); return r.status() === 409 && /already been approved/.test((await body(r)).error); })());

  section("8. Over budget: flagged, never blocked, needs a comment to approve");
  const over = await submitWith(R.page, { kind: "large", employeeUserId: ids.req, ...common(branch.id, cat.id), ...tight(5000000, 1500000), amountPaise: 4000000 });
  check("a 40,000 request (35,000 left) is still accepted", over.status === 201, over.json.error);
  check("it is flagged over budget", (await sql`select over_budget from apr_requests where id = ${over.json.id}`)[0].over_budget === true);
  await D.page.goto(BASE + `/approvals/requests/${over.json.id}`);
  check("the approver sees the Over budget badge and a warning", /over budget/i.test(await D.page.locator("main").first().innerText()) && (await D.page.locator("main").first().innerText()).includes("₹5,000.00 more than the budget left"));
  const noComment = await post(D.page, `/api/approvals/requests/${over.json.id}/decision`, { action: "approve" });
  check("approving without a comment is refused", noComment.status() === 422 && /over budget/.test((await body(noComment)).error));
  check("approving with a comment works", (await post(D.page, `/api/approvals/requests/${over.json.id}/decision`, { action: "approve", comment: "Approved, one-off" })).status() === 200);
  const noBud = await submitWith(R.page, { kind: "large", employeeUserId: ids.req, ...common(branch.id, cat.id), ...tight(1000000, 1500000), amountPaise: 1200000 });
  check("a request whose budget is already used up is accepted and flagged", noBud.status === 201 && (await sql`select over_budget from apr_requests where id = ${noBud.json.id}`)[0].over_budget === true, noBud.json.error);

  section("9. Rejected requests");
  const rej = await submitWith(R.page, { kind: "large", employeeUserId: ids.req, ...common(branch.id, cat.id), amountPaise: 1200000 });
  check("the 12,000 request was accepted", rej.status === 201);
  check("the DG rejects it with a comment", (await post(D.page, `/api/approvals/requests/${rej.json.id}/decision`, { action: "reject", comment: "Not needed" })).status() === 200);
  check("the request is rejected", (await sql`select status from apr_requests where id = ${rej.json.id}`)[0].status === "rejected");

  section("10. Expenses below 10,000 go to their own approver");
  const small = await submitWith(R.page, { kind: "small", employeeUserId: ids.req, email: PEOPLE.req.email, ...common(branch.id, cat.id), ...tight(1000000, 800000), amountPaise: 500000, vendorName: "ZZ Small Vendor", expenseDate: "2026-04-10", taxInvoiceDate: "2026-04-09" });
  check("a 5,000 expense is accepted with an EXB number", small.status === 201 && /^EXB-\d{4}-\d{2}-\d{4}$/.test(small.json.requestNo), small.json.requestNo ?? small.json.error);
  check("it went to the below-10k approver, not the DG", (await sql`select current_approver_user_id from apr_requests where id = ${small.json.id}`)[0].current_approver_user_id === ids.small);
  check("the DG cannot decide it", (await post(D.page, `/api/approvals/requests/${small.json.id}/decision`, { action: "approve" })).status() === 403);
  await S.page.goto(BASE + "/approvals/expenses/pending");
  check("the below-10k approver's own list (/approvals/expenses/pending) holds this expense", (await S.page.locator("main").first().innerText()).includes(small.json.requestNo));
  check("it is not an oversight page: the admin has no Waiting for Me, and sees every pending small expense under All Pending instead", (await status(A.page, "/approvals/expenses/pending")) === 404 && (await status(A.page, "/approvals/expenses/waiting")) === 200 && (await A.page.locator("main").first().innerText()).includes(small.json.requestNo));
  check("the budget typed (10,000 allocated, 8,000 used) is not enough for 5,000, so the expense is flagged and its approver needs a comment", (await sql`select over_budget from apr_requests where id = ${small.json.id}`)[0].over_budget === true && (await post(S.page, `/api/approvals/requests/${small.json.id}/decision`, { action: "approve" })).status() === 422);
  check("with a comment the below-10k approver can approve it", (await post(S.page, `/api/approvals/requests/${small.json.id}/decision`, { action: "approve", comment: "within the overall budget" })).status() === 200);
  check("a future tax invoice date is refused", (await submitWith(R.page, { kind: "small", employeeUserId: ids.req, email: PEOPLE.req.email, ...common(branch.id, cat.id), amountPaise: 100000, vendorName: "V", taxInvoiceDate: "2099-01-01" })).status === 400);
  const noVendor = await submitWith(R.page, { kind: "small", employeeUserId: ids.req, email: PEOPLE.req.email, ...common(branch.id, cat.id), amountPaise: 100000, vendorName: "  " });
  check("vendor name is required on the expenses form", noVendor.status === 400);

  section("11. Nobody approves their own request; two clicks at once");
  const self = await submitWith(D.page, { kind: "hr", firstName: "ZZ", lastName: "Dg", hrCategoryId: hrCat.id });
  check("the DG raising an HR request when they are the only approver is stopped with a reason", self.status === 409 && /Director General and also the requester/.test(self.json.error), self.json.error);
  const race = await submitWith(R.page, { kind: "hr", firstName: "ZZ", lastName: "Race", hrCategoryId: hrCat.id });
  const [r1, r2] = await Promise.all([
    post(D.page, `/api/approvals/requests/${race.json.id}/decision`, { action: "approve" }),
    post(D.page, `/api/approvals/requests/${race.json.id}/decision`, { action: "reject", comment: "no" }),
  ]);
  check("when two decisions arrive together exactly one wins", [r1.status(), r2.status()].sort().join() === "200,409", `${r1.status()},${r2.status()}`);
  check("and the request ends in a single outcome", ["approved", "rejected"].includes((await sql`select status from apr_requests where id = ${race.json.id}`)[0].status));

  section("12. Withdrawing");
  const wd = await submitWith(R.page, { kind: "hr", firstName: "ZZ", lastName: "Withdraw", hrCategoryId: hrCat.id });
  check("someone else cannot withdraw my request", (await post(O.page, `/api/approvals/requests/${wd.json.id}/withdraw`, {})).status() === 404);
  check("the requester can withdraw it while pending", (await post(R.page, `/api/approvals/requests/${wd.json.id}/withdraw`, {})).status() === 200);
  check("a withdrawn request cannot be decided", (await post(D.page, `/api/approvals/requests/${wd.json.id}/decision`, { action: "approve" })).status() === 409);

  section("13. Who sees what in the lists");
  // A plain requester holds no role that gives full access: they get the forms, the confirmation and their own request page, nothing else.
  await R.page.goto(BASE + "/approvals/hr/new");
  check("a plain requester's HR form has no application menu around it", (await R.page.locator('main nav[aria-label$=" sections"], main nav[aria-label$=" pages"]').count()) === 0);
  await R.page.goto(BASE + "/approvals/expenses/new");
  check("nor does their Expenses form", (await R.page.locator('main nav[aria-label$=" sections"], main nav[aria-label$=" pages"]').count()) === 0);
  const closed = ["/approvals/hr/all", "/approvals/hr/pending", "/approvals/hr/approved", "/approvals/expenses/mine", "/approvals/expenses/approved", "/approvals/expenditures/all", "/approvals/inbox", "/approvals/my/pending", "/approvals/my/completed", "/approvals/timeline", "/approvals/hr/timeline"];
  const closedStatuses = []; for (const p of closed) closedStatuses.push(await status(R.page, p));
  check("every list, the inbox and both timelines are a 404 for them", closedStatuses.every((s) => s === 404), closedStatuses.join(","));
  check("the CSV export is closed to them too (403)", (await R.page.request.get(`${BASE}/api/approvals/requests/export?screen=hr/all`)).status() === 403);
  check("the three forms still open", (await status(R.page, "/approvals/hr/new")) === 200 && (await status(R.page, "/approvals/expenditures/new")) === 200 && (await status(R.page, "/approvals/expenses/new")) === 200);
  await R.page.goto(BASE + `/approvals/requests/${small.json.id}?app=exp`);
  const ownPage = await R.page.locator("main").first().innerText();
  check("their own request page opens, with its number and where it stands", ownPage.includes(small.json.requestNo) && /approved/i.test(ownPage), ownPage.replace(/\s+/g, " ").slice(0, 120));
  const banner = (p) => p.locator("main [role=status]", { hasText: "Keep this number" }).count();
  check("the confirmation is not there on a later visit", (await banner(R.page)) === 0);
  await R.page.goto(BASE + `/approvals/requests/${small.json.id}?app=exp&submitted=1`);
  const raisedBanner = await banner(R.page);
  await D.page.goto(BASE + `/approvals/requests/${hrId}?submitted=1`);
  check("it shows for the person who raised the request and not for anyone else opening the same link", raisedBanner === 1 && (await banner(D.page)) === 0, `${raisedBanner} / ${await banner(D.page)}`);
  await S.page.goto(BASE + "/approvals/hr/all");
  check("someone with full access who is not involved sees none of them", !(await S.page.locator("main").first().innerText()).includes(hrReq.request_no));
  await A.page.goto(BASE + "/approvals/hr/approved");
  check("the oversight account sees the approved HR request", (await A.page.locator("main").first().innerText()).includes(hrReq.request_no));
  check("the DG alone does not have the all-requests lists: they have the Recommended Queue", (await status(D.page, "/approvals/hr/approved")) === 404 && (await status(D.page, "/approvals/expenditures/all")) === 404 && (await status(D.page, "/approvals/inbox")) === 200);
  await D.page.goto(BASE + "/approvals/my/completed");
  check("'Completed by me' lists what the DG decided", (await D.page.locator("main").first().innerText()).includes(hrReq.request_no));
  await S.page.goto(BASE + "/approvals/expenses/approved");
  check("the below-10k approver sees the approved expense in their list", (await S.page.locator("main").first().innerText()).includes(small.json.requestNo));
  await A.page.goto(BASE + "/approvals/expenditures/all?q=" + encodeURIComponent(big.json.requestNo));
  const searched = await A.page.locator("tbody tr").allInnerTexts();
  check("search narrows the list to the matching request", searched.length === 1 && searched[0].includes(big.json.requestNo), searched.length);
  const csv = await A.page.request.get(`${BASE}/api/approvals/requests/export?screen=expenditures/all`);
  check("the DG alone cannot export lists", (await D.page.request.get(`${BASE}/api/approvals/requests/export?screen=expenditures/all`)).status() === 403);
  const csvText = await csv.text();
  check("export gives a CSV with a header and the requests", csv.status() === 200 && /text\/csv/.test(csv.headers()["content-type"]) && csvText.includes("Request No.") && csvText.includes(big.json.requestNo));
  const sExport = await S.page.request.get(`${BASE}/api/approvals/requests/export?screen=hr/all`);
  check("export only holds what the person may see", sExport.status() === 200 && !(await sExport.text()).includes(hrReq.request_no));

  section("14. Reports are for the DG, viewers and admins");
  check("the oversight account can open the HR report and Approval Time, the DG alone cannot", (await status(A.page, "/approvals/hr/report")) === 200 && (await status(A.page, "/approvals/hr/approval-time")) === 200 && (await status(D.page, "/approvals/hr/report")) === 404);
  check("an ordinary requester gets a 404 for the reports and for the budget pages that no longer exist", (await status(R.page, "/approvals/hr/report")) === 404 && (await status(R.page, "/approvals/budgets/utilisation")) === 404 && (await status(R.page, "/approvals/budgets")) === 404);
  check("the Budgets and Budget Utilisation pages are gone, even for the Support Admin", (await status(A.page, "/approvals/budgets/utilisation")) === 404 && (await status(A.page, "/approvals/budgets")) === 404);
  await A.page.goto(BASE + `/approvals/timeline?id=${hrId}`);
  check("the Approval Timeline shows who did what", /Submitted by ZZ Flow Requester/.test(await A.page.locator("main").first().innerText()) && /Approved by ZZ Flow DG/.test(await A.page.locator("main").first().innerText()));

  section("15. Notifications");
  const notes = await body(await R.page.request.get(`${BASE}/api/approvals/notifications`));
  check("the requester has unread notifications about their requests", notes.unread >= 3 && notes.items.some((n) => /approved/.test(n.title)) && notes.items.some((n) => /rejected/.test(n.title)), `${notes.unread} unread`);
  const linked = notes.items.find((n) => /approved/.test(n.title) && n.link);
  check("a notification opens the request page, which is how a plain requester follows a decision", !!linked && (await status(R.page, linked.link)) === 200 && (await R.page.locator("main").first().innerText()).includes("Request"), linked?.link);
  check("marking all read clears the count", (await post(R.page, "/api/approvals/notifications", {})).status() === 200 && (await body(await R.page.request.get(`${BASE}/api/approvals/notifications`))).unread === 0);
  check("one person's notifications never show another's requests", (await body(await O.page.request.get(`${BASE}/api/approvals/notifications`))).items.every((n) => !n.title.includes(hrReq.request_no) && !n.title.includes(big.json.requestNo)));

  section("16. Approver Rules screen");
  await A.page.goto(BASE + "/approvals/admin/rules");
  const rulesText = await A.page.locator("main").first().innerText();
  check("the admin sees the three kinds of request and a picker for each step", ["HR requests", "Expenditure: above the limit", "Expenses: below the limit"].every((t) => rulesText.includes(t)) && (await A.page.locator("main select").count()) === 5);
  const rule = (await sql`select id from apr_approver_rules where request_type = 'hr' and step_no = 1`)[0];
  check("the admin can name a Reviewer", (await A.page.request.patch(`${BASE}/api/approvals/rules/${rule.id}`, { data: { approverUserId: ids.small } })).status() === 200);
  check("a non-admin cannot change rules", (await R.page.request.patch(`${BASE}/api/approvals/rules/${rule.id}`, { data: { approverUserId: ids.req } })).status() === 403);
  check("the change is in the audit log", (await sql`select count(*)::int n from apr_admin_audit where entity = 'approver_rule' and summary like '%ZZ Flow Small Approver%'`)[0].n >= 1);
  await A.page.request.patch(`${BASE}/api/approvals/rules/${rule.id}`, { data: { approverUserId: null } });

  section("16b. Return for corrections: the approver returns it, the requester edits and resubmits");
  const ret = await submitWith(R.page, { kind: "large", employeeUserId: ids.req, ...common(branch.id, cat.id), amountPaise: 1200000, vendorName: "ZZ Return Vendor", natureOfExpenditure: "first version" });
  check("a 12,000 request is raised for the return test", ret.status === 201, ret.json.error);
  const dpage = D.page;
  await dpage.goto(BASE + `/approvals/requests/${ret.json.id}`);
  check("the approver sees Approve, Return for corrections and Reject", (await dpage.getByRole("button", { name: "Approve", exact: true }).count()) === 1 && (await dpage.getByRole("button", { name: "Return for corrections", exact: true }).count()) === 1 && (await dpage.getByRole("button", { name: "Reject", exact: true }).count()) === 1);
  await dpage.getByRole("button", { name: "Return for corrections", exact: true }).click();
  check("returning without a comment is stopped with a plain message", await dpage.getByText("Please write a comment saying what needs to be corrected.").first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false));
  check("and nothing changed", (await sql`select status from apr_requests where id = ${ret.json.id}`)[0].status === "pending");
  await dpage.locator("textarea").first().fill("Vendor name is incomplete, please write the full name");
  await dpage.getByRole("button", { name: "Return for corrections", exact: true }).click();
  check("returning with a comment shows a message", await toast(dpage, "Request returned for corrections"));
  const [retRow] = await sql`select r.status, r.current_step, r.current_approver_user_id, s.status as step_status, s.comment from apr_requests r join apr_request_steps s on s.request_id = r.id and s.step_no = r.current_step where r.id = ${ret.json.id}`;
  check("the request is returned, keeps its step and approver, and the comment is on the step", retRow.status === "returned" && retRow.step_status === "returned" && retRow.current_approver_user_id === ids.dg && /full name/.test(retRow.comment), JSON.stringify(retRow));
  check("the requester was told it needs corrections", (await sql`select count(*)::int n from apr_notifications where user_id = ${ids.req} and request_id = ${ret.json.id} and title like '%returned for corrections%'`)[0].n === 1);
  check("a returned request is not in the DG's inbox any more", !(await (async () => { await dpage.goto(BASE + "/approvals/inbox"); return (await dpage.locator("main").first().innerText()).includes(ret.json.requestNo); })()));
  check("nobody can approve it while it is returned", (await post(dpage, `/api/approvals/requests/${ret.json.id}/decision`, { action: "approve" })).status() === 409);

  const rr = R.page;
  await rr.goto(BASE + `/approvals/requests/${ret.json.id}`);
  const retText = await rr.locator("main").first().innerText();
  check("the requester sees Returned, who returned it and why", /Returned/.test(retText) && retText.includes("ZZ Flow DG") && retText.includes("Vendor name is incomplete"), retText.replace(/\s+/g, " ").slice(0, 160));
  check("they have Edit and resubmit and Withdraw, and no Approve", (await rr.getByRole("link", { name: "Edit and resubmit" }).count()) === 1 && (await rr.getByRole("button", { name: "Withdraw request" }).count()) === 1 && (await rr.getByRole("button", { name: "Approve", exact: true }).count()) === 0);
  check("nobody else can open the correction form", (await status(O.page, `/approvals/requests/${ret.json.id}/edit`)) === 404 && (await status(D.page, `/approvals/requests/${ret.json.id}/edit`)) === 404);
  await rr.getByRole("link", { name: "Edit and resubmit" }).click();
  await rr.waitForURL(/\/edit$/, { timeout: 30000 });
  check("the correction form opens with the reason and the saved values", (await rr.locator("[role=status]", { hasText: "Returned for corrections" }).count()) >= 1 && (await rr.locator("#ex-vendor").inputValue()) === "ZZ Return Vendor" && /12,000/.test(await rr.locator("#ex-amount").inputValue()));
  check("it offers Resubmit and Cancel, not Submit and Reset", (await rr.getByRole("button", { name: "Resubmit" }).count()) === 1 && (await rr.getByRole("button", { name: "Cancel" }).count()) === 1 && (await rr.getByRole("button", { name: "Submit", exact: true }).count()) === 0);
  await rr.locator("#ex-vendor").fill("ZZ Return Vendor Private Limited");
  await rr.locator("#ex-amount").fill("9,999");
  check("an amount below 10,000 is blocked on the large form, as on a new request", (await rr.getByText("must be submitted through the Expenses form").count()) >= 1 && (await rr.getByRole("button", { name: "Resubmit" }).isDisabled()));
  await rr.locator("#ex-amount").fill("12,500");
  await rr.getByRole("button", { name: "Resubmit" }).click();
  check("resubmitting shows a message", await toast(rr, "corrected and sent back for approval"));
  await rr.waitForURL(new RegExp(`/approvals/requests/${ret.json.id}`), { timeout: 30000 });
  const [backRow] = await sql`select r.status, r.request_no, r.amount_paise, r.current_approver_user_id, d.vendor_name, s.status as step_status, s.comment from apr_requests r join apr_expenditure_details d on d.request_id = r.id join apr_request_steps s on s.request_id = r.id and s.step_no = r.current_step where r.id = ${ret.json.id}`;
  check("it is pending again with the same number, the new amount and vendor, for the same approver", backRow.status === "pending" && backRow.request_no === ret.json.requestNo && Number(backRow.amount_paise) === 1250000 && backRow.vendor_name === "ZZ Return Vendor Private Limited" && backRow.current_approver_user_id === ids.dg && backRow.step_status === "pending" && backRow.comment === null, JSON.stringify(backRow));
  const retEvents = (await sql`select action from apr_approval_events where request_id = ${ret.json.id} order by id`).map((e) => e.action);
  check("the history keeps submitted, returned, resubmitted", ["submitted", "returned", "resubmitted"].every((a) => retEvents.includes(a)) && retEvents.indexOf("returned") < retEvents.indexOf("resubmitted"), retEvents.join(","));
  await dpage.goto(BASE + `/approvals/requests/${ret.json.id}`);
  check("the timeline on the request page tells the story", /Returned for corrections by ZZ Flow DG/.test(await dpage.locator("main").first().innerText()) && /Corrected and sent back by ZZ Flow Requester/.test(await dpage.locator("main").first().innerText()));
  check("the DG is told it was corrected", (await sql`select count(*)::int n from apr_notifications where user_id = ${ids.dg} and request_id = ${ret.json.id} and title like '%corrected%'`)[0].n === 1);
  // The category is already overspent in this test, so approving needs a comment.
  await dpage.locator("textarea").first().fill("Approved after the correction");
  await dpage.getByRole("button", { name: "Approve", exact: true }).click();
  check("the DG approves the corrected request", await toast(dpage, "Request approved") && await poll(async () => (await sql`select status from apr_requests where id = ${ret.json.id}`)[0].status === "approved"));
  check("nobody can open the correction form of an approved request", (await status(R.page, `/approvals/requests/${ret.json.id}/edit`)) === 404);
  check("the status filter offers Returned and the list still opens", (await status(A.page, "/approvals/expenditures/all?status=returned")) === 200);

  section("16c. Returning from the DG's inbox");
  const ret2 = await submitWith(R.page, { kind: "large", employeeUserId: ids.req, ...common(branch.id, cat.id), amountPaise: 1100000 });
  await dpage.goto(BASE + "/approvals/inbox");
  const inboxRow = dpage.locator("tbody tr", { hasText: ret2.json.requestNo });
  await inboxRow.getByRole("button", { name: "Return", exact: true }).click();
  check("the Return dialog needs a comment before it can be sent", await dpage.getByRole("dialog").getByRole("button", { name: "Return", exact: true }).isDisabled());
  await dpage.locator("textarea").first().fill("Attach the quotation");
  await dpage.getByRole("dialog").getByRole("button", { name: "Return", exact: true }).click();
  check("returning from the inbox works", await toast(dpage, "Request returned for corrections") && await poll(async () => (await sql`select status from apr_requests where id = ${ret2.json.id}`)[0].status === "returned"));
  check("the requester can withdraw a returned request", (await post(R.page, `/api/approvals/requests/${ret2.json.id}/withdraw`, {})).status() === 200 && (await sql`select status from apr_requests where id = ${ret2.json.id}`)[0].status === "withdrawn");

  section("16d. HR requests with an amount follow the budget the requester types");
  await rr.goto(BASE + "/approvals/hr/new");
  check("the HR form shows no budget boxes until an amount is typed", (await rr.locator("#hr-allocated").count()) === 0 && (await rr.locator("#hr-used").count()) === 0 && (await rr.locator("#hr-branch").count()) === 0);
  await rr.locator("#hr-category").click();
  await rr.getByRole("option", { name: "Certificate", exact: true }).click();
  await rr.locator("#hr-amount").fill("1,000");
  check("typing an amount shows Budget Allocated and Budget Used to fill in, and no branch or category to choose", (await rr.locator("#hr-allocated").isEditable()) && (await rr.locator("#hr-used").isEditable()) && (await rr.locator("#hr-branch").count()) === 0 && (await rr.locator("#hr-budget-category").count()) === 0);
  await rr.getByRole("button", { name: "Submit", exact: true }).click();
  check("submitting without them shows inline messages and sends nothing", await rr.getByText("Enter the budget allocated, with at most 2 decimals.").first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false) && (await rr.getByText("Enter the budget used so far (0 if none), with at most 2 decimals.").count()) >= 1);
  await rr.locator("#hr-allocated").fill("500");
  await rr.locator("#hr-used").fill("0");
  check("the budget left is worked out from what was typed", await poll(async () => (await rr.locator("#hr-available").inputValue()) !== "" && (await rr.locator("#hr-after").inputValue()) !== ""));
  await rr.getByRole("button", { name: "Submit", exact: true }).click();
  await rr.waitForURL(/\/approvals\/requests\/[0-9a-f-]{36}/, { timeout: 30000 }).catch(() => {});
  const hrMoneyId = new URL(rr.url()).pathname.split("/").pop();
  const [hrMoneyRow] = await sql`select r.status, r.over_budget, r.amount_paise, h.budget_allocated_paise, h.budget_available_paise from apr_requests r join apr_hr_details h on h.request_id = r.id where r.id = ${hrMoneyId}`;
  check("the HR request keeps its amount and the typed budget, and is over budget (1,000 against 500)", hrMoneyRow.status === "pending" && Number(hrMoneyRow.amount_paise) === 100000 && Number(hrMoneyRow.budget_allocated_paise) === 50000 && Number(hrMoneyRow.budget_available_paise) === 50000 && hrMoneyRow.over_budget === true, JSON.stringify(hrMoneyRow));
  check("its page shows the budget and the over-budget badge", /Budget/.test(await rr.locator("main").first().innerText()) && /over budget/i.test(await rr.locator("main").first().innerText()));
  check("the DG needs a comment to approve it, as for an expenditure", (await post(D.page, `/api/approvals/requests/${hrMoneyId}/decision`, { action: "approve" })).status() === 422);
  check("an HR request without an amount still needs nothing extra", (await submitWith(R.page, { kind: "hr", firstName: "ZZ", lastName: "NoAmount", hrCategoryId: hrCat.id })).status === 201);
  const noBudget = await submitWith(R.page, { kind: "hr", firstName: "ZZ", lastName: "NoBudget", hrCategoryId: hrCat.id, amountPaise: 100000 });
  check("an amount without the budget typed is refused by the server too", noBudget.status === 422 && /budget allocated and the budget used/.test(noBudget.json.error), noBudget.json.error);

  section("16e. The first approver and the DG cannot be the same person");
  const hrRule1 = (await sql`select id from apr_approver_rules where request_type = 'hr' and step_no = 1`)[0];
  const clash = await A.page.request.patch(`${BASE}/api/approvals/rules/${hrRule1.id}`, { data: { approverUserId: ids.dg } });
  check("naming the DG as an HR first approver is refused with the reason", clash.status() === 409 && /must be different people/.test((await body(clash)).error), (await body(clash)).error);
  check("and the rule is unchanged", (await sql`select cardinality(approver_user_ids)::int n from apr_approver_rules where id = ${hrRule1.id}`)[0].n === 0);

  section("16f. Approval Forms: an extra field the Support Admin adds is asked, checked and kept");
  const hrFields = (await body(await A.page.request.get(`${BASE}/api/approvals/form-fields/hr`))).fields;
  const toPut = (fs) => fs.map((f) => ({ key: f.key, label: f.label, hidden: f.hidden, kind: f.builtin ? undefined : f.kind, required: f.required, options: f.options }));
  const put1 = await A.page.request.put(`${BASE}/api/approvals/form-fields/hr`, { data: { fields: [...toPut(hrFields), { key: null, label: "ZZ Employee code", kind: "text", required: true, hidden: false, options: [] }] } });
  const saved = (await body(put1)).fields ?? [];
  const codeKey = saved.find((f) => f.label === "ZZ Employee code")?.key;
  check("the Support Admin saves an extra required field on the HR form", put1.status() === 200 && /^c_[a-z0-9]{8}$/.test(codeKey ?? ""), JSON.stringify(await body(put1)));
  check("a requester is not allowed to change the forms", (await R.page.request.put(`${BASE}/api/approvals/form-fields/hr`, { data: { fields: toPut(hrFields) } })).status() === 403);
  await R.page.goto(BASE + "/approvals/hr/new");
  check("the HR form now asks for it, marked as required", (await R.page.getByText("ZZ Employee code").count()) >= 1);
  const noCode = await submitWith(R.page, { kind: "hr", firstName: "Eve", lastName: "Extra", hrCategoryId: hrCat.id, custom: {} });
  check("sending the request without it is refused, naming the field", noCode.status === 422 && /ZZ Employee code/.test(noCode.json.error), noCode.json.error);
  const withCode = await submitWith(R.page, { kind: "hr", firstName: "Eve", lastName: "Extra", hrCategoryId: hrCat.id, custom: { [codeKey]: "E-42" } });
  check("with the answer it is accepted", withCode.status === 201, withCode.json.error);
  await R.page.goto(BASE + `/approvals/requests/${withCode.json.id}`);
  check("the request page shows the answer under the field's name", /ZZ Employee code/.test(await R.page.locator("main").first().innerText()) && /E-42/.test(await R.page.locator("main").first().innerText()));
  await sql`delete from apr_form_fields`;
  await R.page.goto(BASE + "/approvals/hr/new");
  check("with the setting removed the form is back to its own fields", (await R.page.getByText("ZZ Employee code").count()) === 0);

  section("16g. Approval System: HR and Expenditure open under it for approvers, each with Pending, Approved and Rejected");
  const place = (page, key) => page.locator(`aside a[href="/approvals/review/${key}/pending"]`);
  await S.page.goto(BASE + "/approvals");
  check("the Approval System page itself is the same cards for the Expenditure approver, with Expenditure (and not HR) opened under it in the sidebar", (await S.page.getByRole("link", { name: /Approval Form/ }).count()) === 2 && (await place(S.page, "expenditure").count()) >= 1 && (await place(S.page, "hr").count()) === 0);
  const small16 = await submitWith(R.page, { kind: "small", employeeUserId: ids.req, email: PEOPLE.req.email, ...common(branch.id, cat.id), amountPaise: 150000, vendorName: "ZZ Review Vendor", expenseDate: "2026-04-10", taxInvoiceDate: "2026-04-09" });
  check("an expense is raised for the Expenditure approver", small16.status === 201, small16.json.error);
  await place(S.page, "expenditure").first().click();
  await S.page.waitForURL(/\/approvals\/review\/expenditure\/pending/);
  const tabsNav = S.page.locator('nav[aria-label="Expenditure lists"]');
  check("the Expenditure place has three tabs: Pending, Approved and Rejected", (await tabsNav.locator("a").allInnerTexts()).map((t) => t.replace(/\s*\d+$/, "").trim()).join("|") === "Pending|Approved|Rejected");
  check("the request is in Pending, with Approve and Reject on its row", (await S.page.locator("main").first().innerText()).includes(small16.json.requestNo) && (await S.page.locator("tr", { hasText: small16.json.requestNo }).getByRole("button", { name: "Approve" }).count()) === 1 && (await S.page.locator("tr", { hasText: small16.json.requestNo }).getByRole("button", { name: "Reject" }).count()) === 1);
  await S.page.goto(BASE + "/approvals/review/expenditure/approved");
  check("it is not in Approved yet", !(await S.page.locator("main").first().innerText()).includes(small16.json.requestNo));
  check("the approver decides it from the request page (with a comment)", (await post(S.page, `/api/approvals/requests/${small16.json.id}/decision`, { action: "approve", comment: "fine" })).status() === 200);
  await S.page.goto(BASE + "/approvals/review/expenditure/approved");
  check("and now it is in Approved", (await S.page.locator("main").first().innerText()).includes(small16.json.requestNo));
  check("the Expenditure approver has no HR place: its address is not found", (await status(S.page, "/approvals/review/hr/pending")) === 404);
  const hr16 = await submitWith(R.page, { kind: "hr", firstName: "Hal", lastName: "Review", hrCategoryId: hrCat.id, custom: {} });
  await D.page.goto(BASE + "/approvals");
  check("the DG has one place under Approval System, called Recommended, and not HR or Expenditure", (await D.page.locator('aside a[href="/approvals/review/recommendation/hr"]').count()) >= 1 && (await place(D.page, "hr").count()) === 0 && (await place(D.page, "expenditure").count()) === 0);
  await D.page.locator('aside a[href="/approvals/review/recommendation/hr"]').first().click();
  await D.page.waitForURL(/\/approvals\/review\/recommendation\/hr/);
  check("it has two tabs, HR and Expenditure", (await D.page.locator('nav[aria-label="Recommended lists"] a').allInnerTexts()).map((t) => t.replace(/\s*\d+$/, "").trim()).join("|") === "HR|Expenditure");
  check("an HR request recommended to the DG is in the HR tab, with Approve and Reject on its row", hr16.status === 201 && (await D.page.locator("main").first().innerText()).includes(hr16.json.requestNo) && (await D.page.locator("tr", { hasText: hr16.json.requestNo }).getByRole("button", { name: /Approve/ }).count()) === 1);
  check("the DG's decision keeps it in the list, now with its new status and no buttons", (await post(D.page, `/api/approvals/requests/${hr16.json.id}/decision`, { action: "reject", comment: "no" })).status() === 200 && (await (async () => { await D.page.goto(BASE + "/approvals/review/recommendation/hr"); const row = D.page.locator("tr", { hasText: hr16.json.requestNo }); return (await row.count()) === 1 && /Rejected/i.test(await row.innerText()) && (await row.getByRole("button").count()) === 0; })()));
  await D.page.goto(BASE + "/approvals/review/recommendation/expenditure");
  check("the Expenditure tab opens, and the old HR and Expenditure addresses are not the DG's", (await D.page.locator('nav[aria-label="Recommended lists"]').count()) === 1 && (await status(D.page, "/approvals/review/hr/pending")) === 404);
  await A.page.goto(BASE + "/approvals");
  check("the Support Admin, who oversees everything, has both places", (await place(A.page, "hr").count()) >= 1 && (await place(A.page, "expenditure").count()) >= 1);
  await A.page.goto(BASE + "/approvals/review/hr/rejected");
  check("their Rejected list is every rejected HR request, not only their own", (await A.page.locator("main").first().innerText()).includes(hr16.json.requestNo));
  await O.page.goto(BASE + "/approvals");
  check("someone who approves nothing has no places under Approval System and cannot open them", (await O.page.locator('aside a[href^="/approvals/review/"]').count()) === 0 && (await status(O.page, "/approvals/review/hr/pending")) === 404 && (await status(O.page, "/approvals/review/expenditure/approved")) === 404);

  section("17. Console and the seeded data");
  check("no browser console or page errors on any screen", consoleErrors.length === 0 && pageErrors.length === 0, [...consoleErrors, ...pageErrors].join(" | "));
} catch (e) {
  check("the suite ran to the end without an unexpected error", false, e.stack || e);
} finally {
  await browser.close().catch(() => {});
  await removeFlowData().catch((e) => console.error("CLEANUP FAILED, run again to retry:", e.message));
  const after = { categories: (await sql`select count(*)::int n from apr_categories where name not like 'ZZ%'`)[0].n, rules: (await sql`select count(*)::int n from apr_approver_rules`)[0].n };
  check("the seeded masters and rules are exactly as before", JSON.stringify(after) === JSON.stringify(seededBefore), JSON.stringify(after));
  const restored = await sql`select id, approver_user_ids, active from apr_approver_rules`;
  check("the approver rules were put back", restored.every((r) => { const s = savedRules.find((x) => x.id === r.id); return s && JSON.stringify(s.approver_user_ids) === JSON.stringify(r.approver_user_ids) && s.active === r.active; }));
}

/** Submits a request through the real route and returns its status and answer. */
async function submitWith(page, data) {
  const res = await page.request.post(BASE + "/api/approvals/requests", { data });
  return { status: res.status(), json: await body(res) };
}

const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
