/**
 * End-to-end test of the Approvals request flow in a real browser: submitting HR, expenditure and expense requests, routing, approving,
 * rejecting, budgets, over-budget handling, files, who can see what, lists, export, reports and notifications.
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
if (process.env.E2E_FLOW_CONFIRM !== "yes") {
  console.error("This test changes the approver rules while it runs. Run it against a test database (a Neon branch), then set E2E_FLOW_CONFIRM=yes.");
  process.exit(2);
}
const ADMIN_EMAIL = (process.env.HEAD_ADMIN_EMAIL || "").trim().toLowerCase();
const ADMIN_PW = process.env.HEAD_ADMIN_PASSWORD || "";
if (!ADMIN_EMAIL || !ADMIN_PW) { console.error("HEAD_ADMIN_EMAIL and HEAD_ADMIN_PASSWORD must be set: the suite signs in as the main admin."); process.exit(2); }

// The same query helper for both database drivers the app supports (DB_DRIVER=neon, the default, or DB_DRIVER=pg for a local Postgres).
const rawSql = (() => {
  if ((process.env.DB_DRIVER ?? "neon") !== "pg") return req("@neondatabase/serverless").neon(process.env.DATABASE_URL);
  const pool = new (req("pg").Pool)({ connectionString: process.env.DATABASE_URL, max: 4, ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false });
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
  await sql`delete from apr_budgets where branch_id in (select id from apr_branches where name like 'ZZ%')`;
  await sql`delete from apr_categories where name like 'ZZ%'`;
  await sql`delete from apr_hr_categories where name like 'ZZ%'`;
  await sql`delete from apr_branches where name like 'ZZ%'`;
  await sql`delete from apr_admin_audit where summary like '%ZZ%'`;
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

const common = (branchId, categoryId) => ({ categoryId, branchId });

try {
  section("0. Setup: people, rules, a branch, categories and a budget");
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
  const [catNoBudget] = await sql`insert into apr_categories (name) values ('ZZ Flow Cat No Budget') returning id`;
  await sql`insert into apr_budgets (financial_year, branch_id, category_id, allocated_paise) values (${FY}, ${branch.id}, ${cat.id}, 5000000)`;
  const [hrCat] = await sql`select id from apr_hr_categories where name = 'Certificate'`;
  check("test people, rules, branch, categories and a 50,000 budget are in place", !!(ids.req && ids.dg && ids.small && branch && cat && hrCat), `FY ${FY}`);

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
  check("the DG expenditure form has its 13 fields in the Zoho order", JSON.stringify(await labels(R.page)) === JSON.stringify(["Name", "Email", "Date of Request", "Difference", "Category", "Nature of Expenditure", "Branch Name", "Budget Allocated", "Budget Remaining", "Amount", "Vendor Name", "Tax Invoice/Supporting Documents", "Quotation"]), (await labels(R.page)).join(" | "));
  check("Submit and Reset are there", (await R.page.getByRole("button", { name: "Submit" }).count()) === 1 && (await R.page.getByRole("button", { name: "Reset" }).count()) === 1);
  await R.page.goto(BASE + "/approvals/expenses/new");
  check("the below-10k form has its 17 fields in the Zoho order (two of them labelled Date)", JSON.stringify(await labels(R.page)) === JSON.stringify(["Name", "Email", "Date", "Category", "Nature of Expenditure", "Branch Name", "Available budget", "File upload", "Budget Remaining", "Date", "Type of Publication", "Publication", "Vendor Name", "Tax Invoice", "Quotation", "Date of Tax Invoice", "Amount"]), (await labels(R.page)).join(" | "));

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
  const hrId = rp.url().split("/").pop();
  const [hrReq] = await sql`select * from apr_requests where id = ${hrId}`;
  check("submitting saved a pending request with an HR number", hrReq?.status === "pending" && /^HR-\d{4}-\d{2}-\d{4}$/.test(hrReq.request_no), hrReq?.request_no);
  check("it went to the DG, in one step", hrReq?.current_approver_user_id === ids.dg && hrReq.total_steps === 1);
  check("the file is stored and attached", (await sql`select count(*)::int n from apr_attachments where request_id = ${hrId}`)[0].n === 1 && (await sql`select count(*)::int n from apr_file_chunks c join apr_attachments a on a.storage_key = c.file_id::text where a.request_id = ${hrId}`)[0].n === 1);
  check("the DG was notified", (await sql`select count(*)::int n from apr_notifications where user_id = ${ids.dg} and request_id = ${hrId}`)[0].n === 1);

  const dp = D.page;
  await dp.goto(BASE + "/approvals/inbox");
  check("the request is in the DG's inbox", (await dp.locator("main").first().innerText()).includes(hrReq.request_no));
  check("the DG's menu shows DG APPROVALS with a count", (await dp.locator("aside:visible").first().innerText()).includes("DG APPROVALS"));
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
  await R.page.goto(BASE + "/approvals/expenditures/new");
  await R.page.locator("#ex-amount").fill("9,999");
  check("typing 9,999 on the DG form shows the message and a link, and blocks Submit", (await R.page.getByText("must be submitted through the Expenses form").count()) >= 1 && (await R.page.getByRole("button", { name: "Submit" }).isDisabled()));
  const href = await R.page.getByRole("link", { name: "Open the Expenses form" }).getAttribute("href");
  check("the link opens the other form with the amount carried over", /\/approvals\/expenses\/new\?.*amount=9%2C999/.test(href ?? ""), href);

  section("7. Expenditure of 15,000: budget used only when approved");
  const live = async (page) => body(await page.request.get(`${BASE}/api/approvals/budget?branchId=${branch.id}&categoryId=${cat.id}&fy=${FY}`));
  check("the live budget starts at 50,000 allocated, nothing spent", (await live(R.page)).allocatedPaise === 5000000 && (await live(R.page)).spentPaise === 0);
  const big = await submitWith(R.page, { kind: "large", employeeUserId: ids.req, ...common(branch.id, cat.id), amountPaise: 1500000, vendorName: "ZZ Vendor", natureOfExpenditure: "ZZ test" });
  check("a 15,000 request is accepted with an EXP number", big.status === 201 && /^EXP-\d{4}-\d{2}-\d{4}$/.test(big.json.requestNo), big.json.requestNo ?? big.json.error);
  const [bigRow] = await sql`select r.over_budget, r.current_approver_user_id, d.budget_allocated_paise, d.budget_available_paise, d.budget_remaining_paise from apr_requests r join apr_expenditure_details d on d.request_id = r.id where r.id = ${big.json.id}`;
  check("it is not over budget and its budget snapshot is stored", bigRow.over_budget === false && Number(bigRow.budget_allocated_paise) === 5000000 && Number(bigRow.budget_available_paise) === 5000000 && Number(bigRow.budget_remaining_paise) === 3500000, JSON.stringify(bigRow));
  check("it went to the DG", bigRow.current_approver_user_id === ids.dg);
  check("pending does not reduce the budget", (await live(R.page)).spentPaise === 0 && (await live(R.page)).pendingPaise === 1500000);
  check("the requester cannot decide their own request", (await post(R.page, `/api/approvals/requests/${big.json.id}/decision`, { action: "approve" })).status() === 403);
  check("someone who is not the approver cannot decide it", (await post(S.page, `/api/approvals/requests/${big.json.id}/decision`, { action: "approve" })).status() === 403);
  check("rejecting needs a comment", (await post(D.page, `/api/approvals/requests/${big.json.id}/decision`, { action: "reject" })).status() === 422);
  const okDecision = await post(D.page, `/api/approvals/requests/${big.json.id}/decision`, { action: "approve" });
  check("the DG approves without a comment (it is within budget)", okDecision.status() === 200);
  check("approval uses up the budget: 15,000 spent", (await live(R.page)).spentPaise === 1500000);
  check("deciding again is refused with a clear message", await (async () => { const r = await post(D.page, `/api/approvals/requests/${big.json.id}/decision`, { action: "reject", comment: "x" }); return r.status() === 409 && /already been approved/.test((await body(r)).error); })());

  section("8. Over budget: flagged, never blocked, needs a comment to approve");
  const over = await submitWith(R.page, { kind: "large", employeeUserId: ids.req, ...common(branch.id, cat.id), amountPaise: 4000000 });
  check("a 40,000 request (35,000 left) is still accepted", over.status === 201, over.json.error);
  check("it is flagged over budget", (await sql`select over_budget from apr_requests where id = ${over.json.id}`)[0].over_budget === true);
  await D.page.goto(BASE + `/approvals/requests/${over.json.id}`);
  check("the approver sees the Over budget badge and a warning", (await D.page.locator("main").first().innerText()).includes("Over budget") && (await D.page.locator("main").first().innerText()).includes("exceeds the remaining budget by ₹5,000.00"));
  const noComment = await post(D.page, `/api/approvals/requests/${over.json.id}/decision`, { action: "approve" });
  check("approving without a comment is refused", noComment.status() === 422 && /over budget/.test((await body(noComment)).error));
  check("approving with a comment works", (await post(D.page, `/api/approvals/requests/${over.json.id}/decision`, { action: "approve", comment: "Approved, one-off" })).status() === 200);
  check("spent is now 55,000, more than the 50,000 allocated", (await live(R.page)).spentPaise === 5500000);
  const noBud = await submitWith(R.page, { kind: "large", employeeUserId: ids.req, ...common(branch.id, catNoBudget.id), amountPaise: 1200000 });
  check("a request with no budget at all is accepted and flagged", noBud.status === 201 && (await sql`select over_budget from apr_requests where id = ${noBud.json.id}`)[0].over_budget === true, noBud.json.error);

  section("9. Rejected requests do not reduce the budget");
  const rej = await submitWith(R.page, { kind: "large", employeeUserId: ids.req, ...common(branch.id, cat.id), amountPaise: 1200000 });
  check("the 12,000 request was accepted", rej.status === 201);
  check("the DG rejects it with a comment", (await post(D.page, `/api/approvals/requests/${rej.json.id}/decision`, { action: "reject", comment: "Not needed" })).status() === 200);
  check("spent is unchanged and the request is rejected", (await live(R.page)).spentPaise === 5500000 && (await sql`select status from apr_requests where id = ${rej.json.id}`)[0].status === "rejected");

  section("10. Expenses below 10,000 go to their own approver");
  const small = await submitWith(R.page, { kind: "small", employeeUserId: ids.req, email: PEOPLE.req.email, ...common(branch.id, cat.id), amountPaise: 500000, vendorName: "ZZ Small Vendor", expenseDate: "2026-04-10", taxInvoiceDate: "2026-04-09" });
  check("a 5,000 expense is accepted with an EXB number", small.status === 201 && /^EXB-\d{4}-\d{2}-\d{4}$/.test(small.json.requestNo), small.json.requestNo ?? small.json.error);
  check("it went to the below-10k approver, not the DG", (await sql`select current_approver_user_id from apr_requests where id = ${small.json.id}`)[0].current_approver_user_id === ids.small);
  check("the DG cannot decide it", (await post(D.page, `/api/approvals/requests/${small.json.id}/decision`, { action: "approve" })).status() === 403);
  check("the category is already overspent, so the expense is flagged and its approver needs a comment", (await sql`select over_budget from apr_requests where id = ${small.json.id}`)[0].over_budget === true && (await post(S.page, `/api/approvals/requests/${small.json.id}/decision`, { action: "approve" })).status() === 422);
  check("with a comment the below-10k approver can approve it", (await post(S.page, `/api/approvals/requests/${small.json.id}/decision`, { action: "approve", comment: "within the overall budget" })).status() === 200);
  check("a future tax invoice date is refused", (await submitWith(R.page, { kind: "small", employeeUserId: ids.req, email: PEOPLE.req.email, ...common(branch.id, cat.id), amountPaise: 100000, vendorName: "V", taxInvoiceDate: "2099-01-01" })).status === 400);
  const noVendor = await submitWith(R.page, { kind: "small", employeeUserId: ids.req, email: PEOPLE.req.email, ...common(branch.id, cat.id), amountPaise: 100000, vendorName: "  " });
  check("vendor name is required on the expenses form", noVendor.status === 400);

  section("11. Nobody approves their own request; two clicks at once");
  const self = await submitWith(D.page, { kind: "hr", firstName: "ZZ", lastName: "Dg", hrCategoryId: hrCat.id });
  check("the DG raising an HR request when they are the only approver is stopped with a reason", self.status === 409 && /nobody can approve their own request/.test(self.json.error), self.json.error);
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
  check("the budget is untouched by withdrawn requests", (await live(R.page)).spentPaise === 5500000 + 500000);

  section("13. Who sees what in the lists");
  await R.page.goto(BASE + "/approvals/hr/all");
  const mine = await R.page.locator("main").first().innerText();
  check("the requester's own HR requests are listed", mine.includes(hrReq.request_no));
  await O.page.goto(BASE + "/approvals/hr/all");
  check("someone not involved sees none of them", !(await O.page.locator("main").first().innerText()).includes(hrReq.request_no));
  await D.page.goto(BASE + "/approvals/hr/approved");
  check("the DG sees the approved HR request", (await D.page.locator("main").first().innerText()).includes(hrReq.request_no));
  await D.page.goto(BASE + "/approvals/my/completed");
  check("'Completed by me' lists what the DG decided", (await D.page.locator("main").first().innerText()).includes(hrReq.request_no));
  await R.page.goto(BASE + "/approvals/expenses/mine");
  check("My Requests shows the requester's expense with its status", (await R.page.locator("main").first().innerText()).includes(small.json.requestNo));
  await D.page.goto(BASE + "/approvals/expenditures/all?q=" + encodeURIComponent(big.json.requestNo));
  const searched = await D.page.locator("tbody tr").allInnerTexts();
  check("search narrows the list to the matching request", searched.length === 1 && searched[0].includes(big.json.requestNo), searched.length);
  const csv = await D.page.request.get(`${BASE}/api/approvals/requests/export?screen=expenditures/all`);
  const csvText = await csv.text();
  check("export gives a CSV with a header and the requests", csv.status() === 200 && /text\/csv/.test(csv.headers()["content-type"]) && csvText.includes("Request No.") && csvText.includes(big.json.requestNo));
  check("export only holds what the person may see", !(await (await O.page.request.get(`${BASE}/api/approvals/requests/export?screen=hr/all`)).text()).includes(hrReq.request_no));

  section("14. Reports and budgets are for the DG, viewers and admins");
  await D.page.goto(BASE + "/approvals/budgets/utilisation");
  const util = await D.page.locator("main").first().innerText();
  check("Budget Utilisation shows the branch, the category and 120% used (60,000 of 50,000)", util.includes("ZZ Flow Branch") && util.includes("ZZ Flow Cat") && /120%/.test(util), util.replace(/\s+/g, " ").slice(0, 200));
  check("the overspent row is marked red", (await D.page.locator("tr[data-level=over]").count()) >= 1);
  check("the DG can open the HR report and Approval Time", (await status(D.page, "/approvals/hr/report")) === 200 && (await status(D.page, "/approvals/hr/approval-time")) === 200);
  check("an ordinary requester gets a 404 for reports and budgets", (await status(R.page, "/approvals/hr/report")) === 404 && (await status(R.page, "/approvals/budgets/utilisation")) === 404 && (await status(R.page, "/approvals/budgets")) === 404);
  await D.page.goto(BASE + `/approvals/timeline?id=${hrId}`);
  check("the Approval Timeline shows who did what", /Submitted by ZZ Flow Requester/.test(await D.page.locator("main").first().innerText()) && /Approved by ZZ Flow DG/.test(await D.page.locator("main").first().innerText()));

  section("15. Notifications");
  const notes = await body(await R.page.request.get(`${BASE}/api/approvals/notifications`));
  check("the requester has unread notifications about their requests", notes.unread >= 3 && notes.items.some((n) => /approved/.test(n.title)) && notes.items.some((n) => /rejected/.test(n.title)), `${notes.unread} unread`);
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
