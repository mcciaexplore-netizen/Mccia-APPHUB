/**
 * End-to-end test of the AI Studio module in a real browser: who may open its two sections (AI Studio at /aistudio for the people who ask,
 * AI Studio Admin at /aistudio/admin for the team: App Staff are members, App Admins are leads); that requesters see only their own requests,
 * only the notes shared with them and never who works on them; and the whole life of a request: the form with a file → Pending Review →
 * accepted (assigned, deadline, priority, a note) → In progress → internal and shared notes → a deliverable → Mark as Delivered → the
 * requester downloads it; a decline with its reason; deleting; All Requests as cards and as a list; the activity feed. Run against a site
 * with AISTUDIO_ENABLED=true and SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY pointing at a storage (the local stub in tests is fine):
 *   E2E_BASE_URL=http://localhost:3000 STORAGE_STUB=http://localhost:54400 node tests/e2e/aistudio.mjs
 * With the module switched off (AISTUDIO_ENABLED unset), E2E_AISTUDIO_OFF=yes checks instead that every page and route is a 404.
 *
 * It WRITES to the database the site uses, but only rows of people named "ZZA"/"zza-": people, two "ZZA" applications (URLs /aistudio,
 * /aistudio/admin) given to them, and the requests and files they make. Everything is removed when it finishes (and at the start, if an
 * earlier run was interrupted), and it checks that every other aistudio_ request is exactly as before. It refuses a Neon database unless
 * E2E_ALLOW_NEON=yes.
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
if (!BASE) { console.error("Set E2E_BASE_URL, for example: E2E_BASE_URL=http://localhost:3000 node tests/e2e/aistudio.mjs"); process.exit(2); }
if (/neon\.tech/i.test(process.env.DATABASE_URL || "") && process.env.E2E_ALLOW_NEON !== "yes") { console.error("Refusing: DATABASE_URL is a Neon database. Use a test database, or set E2E_ALLOW_NEON=yes for a Neon test branch."); process.exit(2); }
const STUB = (process.env.STORAGE_STUB || "").replace(/\/$/, "");

const results = [];
const check = (name, ok, extra = "") => { results.push([name, !!ok]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? "  -> " + String(extra).slice(0, 220) : ""}`); };
const section = (t) => console.log(`\n== ${t} ==`);
const finish = () => {
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
};

const rawSql = (() => {
  if ((process.env.DB_DRIVER ?? "neon") !== "pg") return req("@neondatabase/serverless").neon(process.env.DATABASE_URL);
  const pool = new (req("pg").Pool)({ connectionString: process.env.DATABASE_URL, max: 4, ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false });
  return async (strings, ...values) => (await pool.query(strings.reduce((q, s, i) => q + (i ? `$${i}` : "") + s, ""), values)).rows;
})();
const retry = async (fn, tries = 8, waitMs = 3000) => { let last; for (let i = 0; i < tries; i++) { try { return await fn(); } catch (e) { last = e; await new Promise((r) => setTimeout(r, waitMs)); } } throw last; };
const sql = (...a) => retry(() => rawSql(...a));
const playwright = req("playwright-core");
const launch = () => playwright.chromium.launch({ channel: process.env.E2E_CHROME_CHANNEL || "chrome", headless: true }).catch(() => playwright.chromium.launch({ headless: true }));
const poll = async (fn, ms = 20000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 400)); } return v; };
const hash = (pw) => { const salt = randomBytes(16); return `scrypt$16384$${salt.toString("base64")}$${scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("base64")}`; };
const PW = "zza-Test-pass-123";
const istDay = (offset = 0) => new Date(Date.now() + 5.5 * 3600_000 + offset * 86_400_000).toISOString().slice(0, 10);
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

const testPeople = async () => (await sql`select id from users where email like 'zza-%'`).map((r) => r.id);
const removeTestData = async () => {
  const people = await testPeople();
  if (people.length) {
    const reqs = (await sql`select id from aistudio_requests where requester_id = any(${people})`).map((r) => r.id);
    const files = (await sql`select id from aistudio_files where uploaded_by = any(${people})`).map((r) => r.id);
    if (reqs.length) await sql`delete from aistudio_requests where id = any(${reqs})`;
    if (files.length) await sql`delete from aistudio_files where id = any(${files})`;
    await sql`delete from hub_notifications where user_id = any(${people})`;
    await sql`delete from activity_log where user_id = any(${people})`;
  }
  await sql`delete from users where email like 'zza-%'`;
  for (const a of await sql`select id from apps where name like 'ZZA%'`) await sql`delete from activity_log where app_id = ${a.id}`;
  await sql`delete from apps where name like 'ZZA%'`;
  await sql`delete from departments where name like 'ZZA%'`;
};
// Every request that is not this test's own, so the end can prove none of it changed.
const snap = async () => JSON.stringify(await sql`select id, status, assignee_id, updated_at from aistudio_requests where requester_id not in (select id from users where email like 'zza-%') order by id`);

await removeTestData();
const before = await snap();

const [org] = await sql`insert into departments (kind, name, icon) values ('organisation', 'ZZA Membership', 'Building') returning id`;
const person = async (name, email, role = "member") => (await sql`insert into users (name, email, password_hash, status, role, home_department_id) values (${name}, ${email}, ${hash(PW)}, 'approved', ${role}, ${org.id}) returning id`)[0];
const requester = await person("ZZA Requester Riya", "zza-requester@gmail.com");
const requester2 = await person("ZZA Requester Two", "zza-requester2@gmail.com");
const member = await person("ZZA Member Manav", "zza-member@gmail.com");
const lead = await person("ZZA Lead Lata", "zza-lead@gmail.com");
const unlisted = await person("ZZA Unlisted Uma", "zza-unlisted@gmail.com");
const outsider = await person("ZZA Outsider Om", "zza-outsider@gmail.com");
const [dept] = await sql`insert into departments (kind, name, icon) values ('application', 'ZZA AI', 'Bot') returning id`;
const app = async (name, url) => (await sql`insert into apps (department_id, name, url, icon) values (${dept.id}, ${name}, ${url}, 'Bot') returning id`)[0];
const userApp = await app("ZZA AI Studio", "/aistudio");
const adminApp = await app("ZZA AI Studio Admin", "/aistudio/admin");
const grant = (u, a) => sql`insert into user_app_access (user_id, app_id) values (${u.id}, ${a.id}) on conflict do nothing`;
await grant(requester, userApp); await grant(requester2, userApp);
await grant(member, adminApp); await grant(lead, adminApp); await grant(unlisted, adminApp);
await sql`insert into app_staff (app_id, user_id) values (${adminApp.id}, ${member.id})`;
await sql`insert into app_admins (app_id, user_id) values (${adminApp.id}, ${lead.id})`;
// An App Admin of AI Studio Admin who was never given it is not a lead.
await sql`insert into app_admins (app_id, user_id) values (${adminApp.id}, ${outsider.id})`;

const browser = await launch();
const pageErrors = [];
const fresh = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 }, acceptDownloads: true });
  ctx.setDefaultTimeout(45000);
  await ctx.addInitScript(() => { try { localStorage.setItem("mccia-install-popup-seen", "1"); localStorage.setItem("mccia-install-snoozed-until", String(Date.now() + 864e5)); } catch {} });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(`${new URL(page.url()).pathname}: ${String(e).slice(0, 160)}`));
  return { ctx, page };
};
const signedIn = async (email, password = PW) => {
  const { ctx, page } = await fresh();
  await page.goto(BASE + "/login"); await page.fill("input[name=email]", email); await page.fill("input[name=password]", password);
  await page.click("button[type=submit]"); await page.waitForURL((u) => u.pathname === "/", { timeout: 60000 });
  return { ctx, page };
};
const go = async (page, p) => { const r = await page.goto(BASE + p); await page.waitForLoadState("networkidle").catch(() => {}); return r; };
const pathOf = (page) => new URL(page.url()).pathname;
const mainText = async (page) => page.locator("main").innerText();
const navLabels = async (page, name) => (await page.locator(`nav[aria-label="${name}"] a`).allInnerTexts()).map((t) => t.trim().replace(/\s+\d+$/, "")).filter((t) => t && !/hub/i.test(t)).join("|");
const fetchIn = async (page, url) => { const r = await page.request.get(BASE + url, { maxRedirects: 0 }); return { status: r.status(), location: r.headers().location ?? null }; };
const requestByNumber = async (n) => (await sql`select * from aistudio_requests where number = ${n}`)[0];
const upload = async (page, name, bytes = PNG, type = "image/png") => {
  await page.locator("input[type=file]").first().setInputFiles({ name, mimeType: type, buffer: bytes });
  return poll(async () => (await page.getByText(`${name}`).count()) > 0 && (await page.getByText("uploaded", { exact: false }).count()) > 0, 30000);
};
const bell = async (userId, like) => (await sql`select count(*)::int n from hub_notifications where user_id = ${userId} and title like ${like}`)[0].n;

let exitCode = 0;
if (process.env.E2E_AISTUDIO_OFF === "yes") {
  try {
    section("module switched off");
    const { page } = await signedIn("zza-lead@gmail.com");
    for (const p of ["/aistudio", "/aistudio/request", "/aistudio/my-requests", "/aistudio/admin", "/aistudio/admin/requests", "/aistudio/admin/settings"]) check(`off: ${p} is a 404`, (await go(page, p))?.status() === 404);
    for (const p of ["/api/aistudio/activity", "/api/aistudio/files/00000000-0000-4000-8000-000000000000"]) check(`off: GET ${p} is a 404`, (await fetchIn(page, p)).status === 404);
  } catch (e) { console.error(e); exitCode = 1; }
  await browser.close(); await removeTestData();
  if (exitCode) process.exit(exitCode);
  finish();
}

try {
  const R = await signedIn("zza-requester@gmail.com");
  const R2 = await signedIn("zza-requester2@gmail.com");
  const M = await signedIn("zza-member@gmail.com");
  const L = await signedIn("zza-lead@gmail.com");
  const U = await signedIn("zza-unlisted@gmail.com");
  const O = await signedIn("zza-outsider@gmail.com");

  section("who may open which section");
  await go(R.page, "/aistudio"); check("AI Studio opens the request form", pathOf(R.page) === "/aistudio/request" && /Request from AI Studio/.test(await mainText(R.page)));
  check("the requester's menu", (await navLabels(R.page, "AI Studio")) === "New request|My requests", await navLabels(R.page, "AI Studio"));
  await go(R.page, "/aistudio/admin"); check("a requester is kept out of AI Studio Admin", pathOf(R.page) === "/aistudio/request", pathOf(R.page));
  await go(O.page, "/aistudio/request"); check("without either application (even as an App Admin of it), the request pages send you to the hub", pathOf(O.page) === "/");
  await go(U.page, "/aistudio/admin"); check("given AI Studio Admin but neither App Admin nor App Staff: sent to the hub", pathOf(U.page) === "/");
  await go(M.page, "/aistudio/admin"); check("App Staff (a member) opens AI Studio Admin, without Settings", pathOf(M.page) === "/aistudio/admin" && (await navLabels(M.page, "AI Studio Admin")) === "Dashboard|Pending Review|All Requests", await navLabels(M.page, "AI Studio Admin"));
  await go(M.page, "/aistudio/admin/settings"); check("a member is sent back from Settings", pathOf(M.page) === "/aistudio/admin");
  await go(L.page, "/aistudio/admin"); check("an App Admin (a lead) also gets Settings", (await navLabels(L.page, "AI Studio Admin")) === "Dashboard|Pending Review|All Requests|Settings");
  await go(L.page, "/aistudio/admin/settings"); check("a lead (not the Support Admin) has no Delete all data", !/Delete all data/.test(await mainText(L.page)) && /Slack/.test(await mainText(L.page)));

  section("submitting a request");
  await go(R.page, "/aistudio/request");
  check("the department is filled in from the hub profile", (await R.page.locator("#department").inputValue()) === "ZZA Membership");
  check("six kinds to choose from, each with its hint", (await R.page.locator('input[name="requestType"]').count()) === 6 && /Automate a repetitive task or process/.test(await mainText(R.page)));
  await R.page.getByLabel("Automation / Workflow", { exact: true }).check();
  await R.page.fill("#title", "ZZA Weekly membership report");
  await R.page.fill("#description", "Every Monday, pull the new and renewed memberships and email a summary to the team.");
  await R.page.getByLabel("Link 1", { exact: true }).fill("https://example.org/current-report");
  await R.page.fill("#content", "ZZA columns: name, type, renewal date");
  check("a file uploads straight to storage", await upload(R.page, "zza-sample.png"));
  await R.page.getByRole("button", { name: /Submit request/ }).click();
  await R.page.getByText("Your request has been submitted").waitFor();
  const number = /AS-\d{4,}/.exec(await mainText(R.page))?.[0];
  check("the success screen shows the number and a tracking link", !!number && (await R.page.getByRole("link", { name: /Track your request/ }).count()) === 1, number);
  let r1 = await requestByNumber(number);
  check("it is stored as Pending review, with its type, links, content and department", r1?.status === "pending_review" && r1.request_type === "automation" && JSON.stringify(r1.reference_links) === JSON.stringify(["https://example.org/current-report"]) && /renewal date/.test(r1.content) && r1.department === "ZZA Membership");
  const att = await sql`select f.storage_key, f.purpose from aistudio_attachments a join aistudio_files f on f.id = a.file_id where a.request_id = ${r1.id}`;
  check("its file is attached", att.length === 1 && att[0].purpose === "attachment");
  if (STUB) check("the file really is in the storage bucket", (await (await fetch(`${STUB}/_stub/count`)).json()).keys.some((k) => k.endsWith(att[0].storage_key)));
  check("every lead hears about it on the bell", await poll(async () => (await bell(lead.id, `%${number}%`)) >= 1));
  await R.page.getByRole("link", { name: /Track your request/ }).click();
  await R.page.waitForURL(`**/aistudio/requests/${r1.id}`);
  check("the request page: Pending review, deadline and priority to be confirmed", /Pending review/.test(await mainText(R.page)) && /Deadline: To be confirmed/.test(await mainText(R.page)) && /Priority: To be confirmed/.test(await mainText(R.page)));
  await go(R.page, "/aistudio/my-requests");
  check("My Requests lists it, with its steps", (await mainText(R.page)).includes(number) && (await R.page.getByLabel("Progress: Submitted").count()) === 1);
  check("another requester gets not found for it", (await go(R2.page, `/aistudio/requests/${r1.id}`))?.status() === 404);
  const [attFile] = await sql`select file_id from aistudio_attachments where request_id = ${r1.id}`;
  check("nor can they open its file", (await fetchIn(R2.page, `/api/aistudio/files/${attFile.file_id}`)).status === 404);
  check("the requester can", (await fetchIn(R.page, `/api/aistudio/files/${attFile.file_id}`)).status === 302);

  section("Pending Review: accept");
  await go(M.page, "/aistudio/admin/pending");
  check("a member sees it waiting, with no Accept or Decline", (await mainText(M.page)).includes(number) && !(await M.page.getByRole("button", { name: /^Accept$/ }).count()));
  await go(L.page, "/aistudio/admin");
  const pendingRow = L.page.locator("li", { hasText: number }).first();
  check("the lead's dashboard lists it under Pending Review, with the requester and department", /ZZA Requester Riya/.test(await pendingRow.innerText()) && /ZZA Membership/.test(await pendingRow.innerText()));
  await pendingRow.getByRole("button", { name: /^Accept$/ }).click();
  const dlg = L.page.getByRole("dialog");
  await dlg.getByLabel("Assign to").selectOption({ label: "ZZA Member Manav" });
  await dlg.getByLabel("Deadline").fill(istDay(7));
  await dlg.getByLabel("Priority").selectOption("high");
  await dlg.getByLabel(/Note to the requester/).fill("ZZA Thanks, we will start on Monday.");
  await dlg.getByRole("button", { name: "Confirm" }).click();
  r1 = await poll(async () => { const t = await requestByNumber(number); return t.status === "accepted" ? t : null; });
  const deadline = (await sql`select deadline::text as d from aistudio_requests where id = ${r1.id}`)[0]?.d;
  check("accepted, assigned, with the deadline and priority", r1?.assignee_id === member.id && deadline === istDay(7) && r1.priority === "high", JSON.stringify(r1 && { a: r1.assignee_id, d: deadline, p: r1.priority }));
  check("the note is shared with the requester", (await sql`select count(*)::int n from aistudio_notes where request_id = ${r1.id} and not is_internal`)[0].n === 1);
  check("the requester is told, and so is the person it is assigned to", await poll(async () => (await bell(requester.id, `Request accepted: ${number}`)) === 1 && (await bell(member.id, `%assigned you ${number}%`)) === 1));

  section("the team works on it");
  await go(M.page, `/aistudio/admin/requests/${r1.id}`);
  check("a member cannot change who it is assigned to", await M.page.getByLabel("Assigned to").isDisabled());
  check("nor accept, decline or close it: the status choices are the work's", JSON.stringify(await M.page.getByLabel("Status").locator("option").allInnerTexts()) === JSON.stringify(["Accepted", "In progress", "Review / Testing", "Delivered"]), JSON.stringify(await M.page.getByLabel("Status").locator("option").allInnerTexts()));
  await M.page.getByLabel("Status").selectOption("in_progress");
  await M.page.getByRole("button", { name: "Save changes" }).click();
  check("a member moves it to In progress", await poll(async () => (await requestByNumber(number)).status === "in_progress"));
  check("the requester is told work has started", await poll(async () => (await bell(requester.id, `Work has started: ${number}`)) === 1));
  await M.page.getByRole("tab", { name: /^Notes/ }).click();
  await M.page.getByLabel("Note", { exact: true }).fill("ZZA internal: use the CRM export");
  await M.page.getByRole("button", { name: "Add note" }).click();
  await poll(async () => (await sql`select count(*)::int n from aistudio_notes where request_id = ${r1.id} and is_internal`)[0].n === 1);
  await M.page.getByRole("tab", { name: /^Notes/ }).click();
  await M.page.getByLabel("Note", { exact: true }).fill("ZZA update: first draft by Thursday");
  await M.page.getByRole("tab", { name: "Share with requester" }).click();
  await M.page.getByRole("button", { name: "Add note" }).click();
  check("an internal note and a shared one are kept", await poll(async () => { const n = await sql`select is_internal from aistudio_notes where request_id = ${r1.id} order by created_at`; return n.length === 3 && n.filter((x) => x.is_internal).length === 1; }));
  check("the requester is told about the shared note", await poll(async () => (await bell(requester.id, `An update on ${number}`)) >= 2));
  await go(R.page, `/aistudio/requests/${r1.id}`);
  const rt = await mainText(R.page);
  check("the requester sees the shared notes, signed by the team, not the internal one", rt.includes("ZZA update: first draft by Thursday") && rt.includes("ZZA Thanks, we will start on Monday.") && !rt.includes("ZZA internal") && /AI Studio team/.test(rt));
  check("and never who works on it", !rt.includes("ZZA Member Manav") && !(await R.page.content()).includes("ZZA Member Manav"));
  check("the deadline and priority the team set show", rt.includes("High") && /Deadline: \d+ \w{3} \d{4}/.test(rt));
  check("the timeline shows Accepted and In Progress", (await R.page.getByText("✅").count()) >= 2 && (await R.page.getByText("🔄").count()) === 1);

  section("deliverables and delivery");
  await go(M.page, `/aistudio/admin/requests/${r1.id}`);
  await M.page.getByRole("tab", { name: /^Deliverables/ }).click();
  check("Mark as Delivered waits for a deliverable", await M.page.getByRole("button", { name: "Mark as Delivered" }).isDisabled());
  check("a deliverable uploads", await upload(M.page, "zza-report.pdf", PDF, "application/pdf"));
  await M.page.getByRole("button", { name: /^Upload/ }).click();
  const del = await poll(async () => (await sql`select f.id from aistudio_attachments a join aistudio_files f on f.id = a.file_id where a.request_id = ${r1.id} and f.purpose = 'deliverable'`)[0]);
  check("it is kept as a deliverable", !!del);
  check("the requester cannot download it before delivery", (await fetchIn(R.page, `/api/aistudio/files/${del.id}`)).status === 404);
  await M.page.getByRole("tab", { name: /^Deliverables/ }).click();
  await M.page.getByLabel(/Delivery note/).fill("ZZA It runs every Monday at 9:00.");
  await M.page.getByRole("button", { name: "Mark as Delivered" }).click();
  r1 = await poll(async () => { const t = await requestByNumber(number); return t.status === "delivered" ? t : null; });
  check("marked as delivered, with the delivery note", !!r1 && /Monday at 9/.test(r1.delivery_notes ?? ""));
  check("the requester is told", await poll(async () => (await bell(requester.id, `Delivered: ${number}`)) === 1));
  await go(R.page, "/aistudio/my-requests?tab=delivered");
  const myCard = R.page.locator("li", { hasText: number }).first();
  check("My Requests: Delivered, with Download deliverables", /Delivered/.test(await myCard.innerText()) && (await myCard.getByRole("link", { name: /Download deliverables/ }).count()) === 1);
  check("the requester can download it now", (await fetchIn(R.page, `/api/aistudio/files/${del.id}`)).status === 302);
  await go(R.page, `/aistudio/requests/${r1.id}`);
  check("the request page shows the deliverable, the delivery note and every step done", (await mainText(R.page)).includes("zza-report.pdf") && (await mainText(R.page)).includes("It runs every Monday") && (await R.page.getByText("✅").count()) === 5);

  section("All Requests: cards and list");
  await go(L.page, "/aistudio/admin/requests");
  const group = L.page.locator("section", { has: L.page.getByRole("heading", { name: /^Delivered/ }) });
  check("cards, grouped by status: it is under Delivered with its assignee and priority", (await group.count()) === 1 && /ZZA Member Manav/.test(await group.innerText()) && /High/.test(await group.innerText()));
  await go(L.page, `/aistudio/admin/requests?view=list&q=${number}`);
  const row = L.page.locator("tbody tr", { hasText: number });
  check("the list view finds it by number, with requester, type and status", (await row.count()) === 1 && /ZZA Requester Riya/.test(await row.innerText()) && /Automation/.test(await row.innerText()) && /Delivered/.test(await row.innerText()) && /Showing 1–1 of 1 request/.test(await mainText(L.page)));
  await go(L.page, "/aistudio/admin/requests?view=list&q=Riya&filter=pending");
  check("searching by requester on the Pending tab leaves it out", !(await L.page.locator("tbody tr", { hasText: number }).count()));
  await go(L.page, "/aistudio/admin/requests?view=list&sort=title&dir=asc");
  check("a column header sorts (marked ascending)", /title/i.test(await L.page.locator('th[aria-sort="ascending"]').innerText()));
  await go(L.page, `/aistudio/admin/requests?view=list&q=${number}`);
  await L.page.locator("tbody tr", { hasText: number }).locator("td").nth(1).click();
  check("clicking a row opens the request", await L.page.waitForURL(`**/aistudio/admin/requests/${r1.id}`, { timeout: 15000 }).then(() => true).catch(() => false));
  const kpi = await (await go(L.page, "/aistudio/admin"), mainText(L.page));
  check("the dashboard's numbers include it under Delivered this week", /delivered this week\s*[1-9]/i.test(kpi), kpi.slice(0, 200));

  section("decline and delete");
  await go(R2.page, "/aistudio/request");
  await R2.page.getByLabel("AI Chatbot", { exact: true }).check();
  await R2.page.fill("#title", "ZZA Chatbot for the website");
  await R2.page.fill("#description", "A chatbot that answers member questions on the website.");
  await R2.page.getByRole("button", { name: /Submit request/ }).click();
  await R2.page.getByText("Your request has been submitted").waitFor();
  const n2 = /AS-\d{4,}/.exec(await mainText(R2.page))?.[0];
  const r2 = await requestByNumber(n2);
  check("request numbers follow on", Number(n2.slice(3)) === Number(number.slice(3)) + 1, `${number} → ${n2}`);
  await go(L.page, `/aistudio/admin/requests/${r2.id}`);
  await L.page.getByRole("button", { name: /^Decline$/ }).click();
  await L.page.getByRole("dialog").locator("textarea").fill("ZZA The website team already has one planned.");
  await L.page.getByRole("button", { name: "Decline request" }).click();
  check("declined with its reason, and the requester is told", await poll(async () => (await requestByNumber(n2)).status === "declined") && await poll(async () => (await bell(requester2.id, `Request declined: ${n2}`)) === 1));
  await go(R2.page, `/aistudio/requests/${r2.id}`);
  check("the requester sees it declined, with the reason", /declined: ZZA The website team/i.test(await mainText(R2.page)));
  await go(L.page, `/aistudio/admin/requests/${r2.id}`);
  L.page.once("dialog", (d) => d.accept());
  await L.page.getByRole("button", { name: /Delete/ }).first().click();
  await L.page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  check("a lead deletes it", await poll(async () => !(await requestByNumber(n2))));
  await go(M.page, `/aistudio/admin/requests/${r1.id}`);
  check("a member has no Delete button", !(await M.page.getByRole("button", { name: /Delete/ }).count()));

  section("the activity feed and its guard");
  const feed = await M.page.request.get(`${BASE}/api/aistudio/activity`);
  check("the team's feed lists what happened", feed.status() === 200 && JSON.stringify(await feed.json()).includes(number));
  check("a requester cannot read it", (await R.page.request.get(`${BASE}/api/aistudio/activity`)).status() === 403);

  section("other pages open without errors");
  for (const [who, p] of [[L, "/aistudio/admin/pending"], [L, "/aistudio/admin/requests"], [L, "/aistudio/admin/requests?view=list"], [L, "/aistudio/admin/settings"], [R, "/aistudio/my-requests"]]) {
    check(`${p} opens`, (await go(who.page, p))?.status() === 200);
  }
  check("no page threw an error in the browser", pageErrors.length === 0, pageErrors.join(" | "));
} catch (e) {
  check("the run finished without crashing", false, String(e?.stack ?? e).slice(0, 600));
  exitCode = 1;
}

section("nothing else changed");
await browser.close();
await removeTestData();
check("every other aistudio_ request is exactly as before", (await snap()) === before);
check("cleanup: no ZZA people or requests left", (await sql`select count(*)::int n from users where email like 'zza-%'`)[0].n === 0);
finish();
