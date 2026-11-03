/**
 * End-to-end test of the DesignDesk module in a real browser: who may open its sections (the request pages for every hub user, Design Team Forms at
 * /design for the people who ask for designs, Design Admin at /design/admin for the creative team, whose App Admins are the leads,
 * Integrations for the Support Admin only); that requesters see only their own requests while the creative team sees every one;
 * the whole life of a request: the form with a file → Pending Review → accept and assign → a proof sent for review → changes asked on the
 * public review link (a new version DF-xxxx-V2) → the next proof approved from My Requests → source files → the scheduled close; the tracking
 * link; the admin pages and exports; and that nothing works without the right sign-in or link. Run against a site with DESIGN_ENABLED=true,
 * CRON_SECRET set, and SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY pointing at a storage (the local stub in tests is fine):
 *   E2E_BASE_URL=http://localhost:3000 CRON_SECRET=... STORAGE_STUB=http://localhost:54400 node tests/e2e/design.mjs
 * With the module switched off (DESIGN_ENABLED unset), E2E_DESIGN_OFF=yes checks instead that every page and route is a 404.
 *
 * It WRITES to the database the site uses, but only rows of people named "ZZD"/"zzd-": people, two "ZZD" applications (URLs /design,
 * /design/admin) given to them, and the tickets, files, campaigns and settings they make. Everything is removed when it finishes (and at the
 * start, if an earlier run was interrupted), and it checks that every other design_ ticket is exactly as before. It refuses a Neon database
 * unless E2E_ALLOW_NEON=yes. The head admin (HEAD_ADMIN_EMAIL / HEAD_ADMIN_PASSWORD) is used for Integrations.
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
if (!BASE) { console.error("Set E2E_BASE_URL, for example: E2E_BASE_URL=http://localhost:3000 node tests/e2e/design.mjs"); process.exit(2); }
if (/neon\.tech/i.test(process.env.DATABASE_URL || "") && process.env.E2E_ALLOW_NEON !== "yes") { console.error("Refusing: DATABASE_URL is a Neon database. Use a test database, or set E2E_ALLOW_NEON=yes for a Neon test branch."); process.exit(2); }
const CRON_SECRET = process.env.CRON_SECRET || "";
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
const PW = "zzd-Test-pass-123";
const istDay = (offset = 0) => new Date(Date.now() + 5.5 * 3600_000 + offset * 86_400_000).toISOString().slice(0, 10);
// A real 1×1 PNG, so the review page can show it.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const testPeople = async () => (await sql`select id from users where email like 'zzd-%'`).map((r) => r.id);
const removeTestData = async () => {
  const people = await testPeople();
  if (people.length) {
    const tickets = (await sql`select id from design_tickets where requester_id = any(${people}) or assignee_id = any(${people})`).map((r) => r.id);
    if (tickets.length) {
      const cdr = (await sql`select id from design_cdr_requests where ticket_id = any(${tickets})`).map((r) => r.id);
      if (cdr.length) await sql`delete from design_cdr_downloads where cdr_request_id = any(${cdr})`;
      await sql`delete from design_cdr_requests where ticket_id = any(${tickets})`;
      await sql`delete from design_approval_requests where ticket_id = any(${tickets})`;
      await sql`delete from design_pinpoints where ticket_id = any(${tickets})`;
      await sql`delete from design_attachments where ticket_id = any(${tickets})`;
      await sql`delete from design_proof_versions where ticket_id = any(${tickets})`;
      await sql`delete from design_subtasks where ticket_id = any(${tickets})`;
      await sql`delete from design_time_entries where ticket_id = any(${tickets})`;
      await sql`delete from design_audit_logs where ticket_id = any(${tickets})`;
      await sql`delete from design_tickets where id = any(${tickets})`;
    }
    await sql`delete from design_social_posts where created_by = any(${people})`;
    await sql`delete from design_campaigns where created_by = any(${people})`;
    await sql`delete from design_saved_views where user_id = any(${people})`;
    await sql`delete from design_profiles where user_id = any(${people})`;
    await sql`delete from design_leaves where user_id = any(${people})`;
    await sql`delete from design_files where uploaded_by = any(${people})`;
    await sql`delete from hub_notifications where user_id = any(${people})`;
    await sql`delete from activity_log where user_id = any(${people})`;
  }
  await sql`delete from design_holidays where name like 'ZZD%'`;
  await sql`delete from users where email like 'zzd-%'`;
  for (const a of await sql`select id from apps where name like 'ZZD%'`) await sql`delete from activity_log where app_id = ${a.id}`;
  await sql`delete from apps where name like 'ZZD%'`;
  await sql`delete from departments where name like 'ZZD%'`;
};
// Every design ticket that is not this test's own, so the end can prove none of it changed.
const snap = async () => JSON.stringify(await sql`select id, status, assignee_id, updated_at from design_tickets where requester_id not in (select id from users where email like 'zzd-%') order by id`);

await removeTestData();
const before = await snap();
const settingsBefore = (await sql`select ticket_number_floor, edit_window_hours, max_free_revisions, slack_webhook from design_settings where id = 1`)[0] ?? null;

const [org] = await sql`insert into departments (kind, name, icon) values ('organisation', 'ZZD Marketing', 'Building') returning id`;
const person = async (name, email, role = "member") => (await sql`insert into users (name, email, password_hash, status, role, home_department_id) values (${name}, ${email}, ${hash(PW)}, 'approved', ${role}, ${org.id}) returning id`)[0];
const requester = await person("ZZD Requester Riya", "zzd-requester@gmail.com");
const d1 = await person("ZZD Designer Dev", "zzd-designer1@gmail.com");
const d2 = await person("ZZD Designer Disha", "zzd-designer2@gmail.com");
const lead = await person("ZZD Lead Lata", "zzd-lead@gmail.com");
const requester2 = await person("ZZD Requester Two", "zzd-requester2@gmail.com");
const outsider = await person("ZZD Outsider Om", "zzd-outsider@gmail.com");
const unlisted = await person("ZZD Unlisted Uma", "zzd-unlisted@gmail.com");
const [dept] = await sql`insert into departments (kind, name, icon) values ('application', 'ZZD Design', 'Palette') returning id`;
const app = async (name, url) => (await sql`insert into apps (department_id, name, url, icon) values (${dept.id}, ${name}, ${url}, 'Palette') returning id`)[0];
const teamApp = await app("ZZD Design Team Forms", "/design");
const adminApp = await app("ZZD Design Admin", "/design/admin");
const grant = (u, a) => sql`insert into user_app_access (user_id, app_id) values (${u.id}, ${a.id}) on conflict do nothing`;
// Design Team Forms is for the people who ask for designs; Design Admin is the creative team: its App Staff are the designers, its App
// Admins the leads. Someone given Design Admin who is on neither list cannot open it.
await grant(requester, teamApp); await grant(requester2, teamApp);
await grant(d1, adminApp); await grant(d2, adminApp); await grant(lead, adminApp); await grant(unlisted, adminApp);
await sql`insert into app_staff (app_id, user_id) values (${adminApp.id}, ${d1.id}), (${adminApp.id}, ${d2.id})`;
await sql`insert into app_admins (app_id, user_id) values (${adminApp.id}, ${lead.id})`;
// An App Admin of Design Admin who was never given it is not a lead.
await sql`insert into app_admins (app_id, user_id) values (${adminApp.id}, ${outsider.id})`;
// Dev has lots of room; Disha is on leave all week, so auto-assign would never pick her.
await sql`insert into design_leaves (user_id, start_date, end_date, note) values (${d2.id}, ${istDay(-1)}, ${istDay(14)}, 'ZZD leave')`;

const browser = await launch();
const pageErrors = [];
const fresh = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
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
// A request with the page's sign-in (its cookies), not following redirects, so a redirect to a signed link can be seen.
const fetchIn = async (page, url) => { const r = await page.request.get(BASE + url, { maxRedirects: 0 }); const h = r.headers(); return { status: r.status(), type: h["content-type"] ?? "", location: h.location ?? null }; };
const ticketByNumber = async (n) => (await sql`select * from design_tickets where number = ${n}`)[0];
const upload = async (page, name, bytes = PNG, type = "image/png") => {
  await page.locator("input[type=file]").first().setInputFiles({ name, mimeType: type, buffer: bytes });
  return poll(async () => (await page.getByText("uploaded", { exact: false }).count()) > 0, 30000);
};

let exitCode = 0;
if (process.env.E2E_DESIGN_OFF === "yes") {
  try {
    section("module switched off");
    const { page } = await signedIn("zzd-lead@gmail.com");
    for (const p of ["/design", "/design/request", "/design/my-requests", "/design/admin/board", "/design/admin", "/design/admin/settings", "/review/abcdefghijklmnopqrstuvwxyz", "/track/DF-0001.abc"]) {
      check(`off: ${p} is a 404`, (await go(page, p))?.status() === 404);
    }
    for (const p of ["/api/design/activity", "/api/design/reports/export", "/api/design/files/00000000-0000-4000-8000-000000000000"]) check(`off: GET ${p} is a 404`, (await fetchIn(page, p)).status === 404);
    if (CRON_SECRET) {
      const r = await fetch(`${BASE}/api/cron/design-tick`, { headers: { authorization: `Bearer ${CRON_SECRET}` } });
      check("off: the cron answers that the module is off", r.status === 200 && /switched off/.test(JSON.stringify(await r.json())));
    }
  } catch (e) { console.error(e); exitCode = 1; }
  await browser.close(); await removeTestData();
  if (exitCode) process.exit(exitCode);
  finish();
}

try {
  const R = await signedIn("zzd-requester@gmail.com");
  const D1 = await signedIn("zzd-designer1@gmail.com");
  const D2 = await signedIn("zzd-designer2@gmail.com");
  const L = await signedIn("zzd-lead@gmail.com");
  const R2 = await signedIn("zzd-requester2@gmail.com");
  const O = await signedIn("zzd-outsider@gmail.com");
  const U = await signedIn("zzd-unlisted@gmail.com");
  const H = process.env.HEAD_ADMIN_EMAIL && process.env.HEAD_ADMIN_PASSWORD ? await signedIn(process.env.HEAD_ADMIN_EMAIL, process.env.HEAD_ADMIN_PASSWORD) : null;

  section("who may open which section");
  check("Design Team Forms opens the request form", (await go(R.page, "/design"))?.status() === 200 && pathOf(R.page) === "/design/request" && /Request a Design/.test(await mainText(R.page)));
  check("the requester's menu: the request pages only", (await navLabels(R.page, "Design Team Forms")) === "Request a design|My requests|All requests|Campaigns", await navLabels(R.page, "Design Team Forms"));
  await go(R.page, "/design/admin"); check("a requester is kept out of Design Admin", pathOf(R.page) === "/design/request", pathOf(R.page));
  await go(O.page, "/design/request"); check("without either application (even as an App Admin of it), the request pages send you to the hub", pathOf(O.page) === "/", pathOf(O.page));
  await go(O.page, "/design/admin"); check("and so does Design Admin", pathOf(O.page) === "/", pathOf(O.page));
  await go(U.page, "/design/admin"); check("given Design Admin but neither App Admin nor App Staff: sent to the hub", pathOf(U.page) === "/", pathOf(U.page));
  await go(D1.page, "/design/admin"); check("App Staff of Design Admin (a designer) opens it", pathOf(D1.page) === "/design/admin");
  check("a member's menu: dashboard, board, library, calendar", (await navLabels(D1.page, "Design Admin")) === "Dashboard|Board|Library|Calendar", await navLabels(D1.page, "Design Admin"));
  for (const p of ["/design/admin/pending", "/design/admin/workload", "/design/admin/reports", "/design/admin/settings"]) {
    await go(D1.page, p); check(`a member is sent back from ${p}`, pathOf(D1.page) === "/design/admin", pathOf(D1.page));
  }
  await go(L.page, "/design/admin");
  check("a lead opens Design Admin, with its menu", pathOf(L.page) === "/design/admin" && (await navLabels(L.page, "Design Admin")) === "Dashboard|Pending Review|Board|Library|Calendar|Workload|Reports|Settings", await navLabels(L.page, "Design Admin"));
  await go(L.page, "/design/admin/settings");
  check("a lead (not the Support Admin) does not see Integrations", !(await L.page.getByRole("tab", { name: /Integrations/ }).count()) && !/Delete all past data/.test(await mainText(L.page)));
  const anon = await fresh();
  await go(anon.page, "/design/request"); check("not signed in: the request form goes to sign-in", pathOf(anon.page) === "/login");
  check("not signed in: a stored file goes to sign-in", (await fetchIn(anon.page, "/api/design/files/00000000-0000-4000-8000-000000000000")).status === 307);

  section("the request form");
  await go(R.page, "/design/request");
  check("department is filled in from the hub profile", (await R.page.locator("#department").inputValue()) === "ZZD Marketing");
  await R.page.getByLabel("Flyer", { exact: true }).check();
  await R.page.selectOption("#q-flyer-size", "A4");
  await R.page.selectOption("#q-flyer-channel", "Print");
  await R.page.selectOption("#q-flyer-language", "Marathi");
  await R.page.fill("#brief", "ZZD annual meeting flyer: logo top left, date and venue large.");
  await R.page.fill("#event-name", "ZZD AGM");
  await R.page.fill("#delivery", istDay(5));
  check("priority shows itself from the date (5 days: Normal)", await poll(async () => /Normal/.test(await R.page.locator("main").innerText())));
  check("a reference file uploads straight to storage", await upload(R.page, "zzd-logo.png"));
  await R.page.getByRole("button", { name: /Submit request/ }).click();
  await R.page.getByText("Your request has been submitted").waitFor();
  const formText = await mainText(R.page);
  const number = /DF-\d{4,}/.exec(formText)?.[0];
  const trackPath = /\/track\/[A-Za-z0-9.-]+/.exec(formText)?.[0];
  check("success screen: the ticket number and the tracking link", !!number && !!trackPath, formText.slice(0, 160));
  let t1 = await ticketByNumber(number);
  check("the request waits in Pending Review, Normal priority, due 18:00 IST on the day asked", t1?.status === "pending_review" && t1.priority === "normal" && t1.department === "ZZD Marketing" && new Date(t1.due_at).toISOString() === new Date(`${istDay(5)}T12:30:00Z`).toISOString());
  check("the answers are kept per design", JSON.stringify(t1.details) === JSON.stringify({ flyer: { size: "A4", channel: "Print", language: "Marathi" } }), JSON.stringify(t1.details));
  const att = await sql`select f.storage_key, f.size from design_attachments a join design_files f on f.id = a.file_id where a.ticket_id = ${t1.id}`;
  check("the file is attached, its size checked in storage", att.length === 1 && att[0].size === PNG.length);
  if (STUB) check("the file really is in the storage bucket", (await (await fetch(`${STUB}/_stub/count`)).json()).keys.some((k) => k.endsWith(att[0].storage_key)));
  check("every lead hears about it in the hub bell", (await sql`select count(*)::int n from hub_notifications where user_id = ${lead.id} and title like ${"%" + number + "%"}`)[0].n === 1);
  check("the requester gets the confirmation", (await sql`select count(*)::int n from hub_notifications where user_id = ${requester.id} and title like ${"Request received: " + number}`)[0].n === 1);
  await go(R.page, "/design/my-requests");
  check("My Requests lists it as pending", /Waiting for a design lead|Pending review/i.test(await mainText(R.page)) && (await mainText(R.page)).includes(number));
  await go(R.page, "/design/requests");
  check("the all-requests board leaves out requests not yet accepted", !(await mainText(R.page)).includes(number));

  section("tracking link (no sign-in)");
  await go(anon.page, trackPath);
  const trackText = await mainText(anon.page);
  check("the tracking page shows the request and its steps, without signing in", pathOf(anon.page) === trackPath && trackText.includes(number) && /Received/.test(trackText) && /Delivered/.test(trackText));
  check("it shows nothing personal (no brief, no requester)", !trackText.includes("logo top left") && !trackText.includes("Riya"));
  await go(anon.page, "/track/DF-0001.0000000000000000000000ff");
  check("a made-up tracking link is refused", /not valid/i.test(await mainText(anon.page)));

  section("Pending Review: accept and assign");
  await go(D2.page, `/design/admin/tickets/${t1.id}`);
  check("a member opening a pending ticket sees it waits for a lead, with no Accept or Decline", /Waiting for a design lead/.test(await mainText(D2.page)) && !(await D2.page.getByRole("button", { name: /Accept \+ Assign/ }).count()));
  await go(L.page, `/design/admin/tickets/${t1.id}`);
  check("a lead opening it gets Accept + Assign and Decline on the ticket page itself", (await L.page.getByRole("button", { name: /Accept \+ Assign/ }).count()) === 1 && (await L.page.getByRole("button", { name: /^Decline$/ }).count()) === 1);
  check("the ticket page shows the five-step progress bar", (await L.page.getByLabel("Progress: Received").count()) === 1);
  await go(L.page, "/design/admin/pending");
  const card = L.page.locator("li, article, div.ds-card").filter({ hasText: number }).first();
  await card.getByRole("button", { name: /Accept \+ Assign/ }).click();
  await L.page.getByRole("radio", { name: /ZZD Designer Dev/ }).check();
  await L.page.getByRole("button", { name: /^Accept$/ }).click();
  t1 = await poll(async () => { const t = await ticketByNumber(number); return t.status === "assigned" ? t : null; });
  check("accepted and assigned to the designer chosen", t1?.assignee_id === d1.id);
  check("the designer is told", await poll(async () => (await sql`select count(*)::int n from hub_notifications where user_id = ${d1.id} and link = ${"/design/admin/tickets/" + t1.id}`)[0].n >= 1));
  await go(R.page, "/design/requests");
  check("now it is on the all-requests board", (await mainText(R.page)).includes(number));

  section("the creative team sees every request; requesters only their own");
  await go(D1.page, "/design/admin");
  check("Dev's dashboard lists it in his queue", (await mainText(D1.page)).includes(number));
  await go(D2.page, "/design/admin/board");
  check("Disha (not assigned) sees it on the board too", (await mainText(D2.page)).includes(number));
  check("and can open its page", (await go(D2.page, `/design/admin/tickets/${t1.id}`))?.status() === 200 && pathOf(D2.page) === `/design/admin/tickets/${t1.id}`);
  check("but cannot change who it is assigned to (no assignee picker for a member)", !(await D2.page.locator("main select").filter({ hasText: "Not assigned" }).count()));
  const feed2 = await D2.page.evaluate(async () => (await (await fetch("/api/design/activity")).json()).items.map((i) => i.number));
  check("the activity feed shows the team everything", feed2.includes(number));
  await go(R2.page, "/design/my-requests");
  check("another requester does not see it in their requests", !(await mainText(R2.page)).includes(number));
  await go(R.page, `/design/admin/tickets/${t1.id}`);
  check("the requester cannot open the team's ticket page", pathOf(R.page) !== `/design/admin/tickets/${t1.id}`, pathOf(R.page));

  section("proof → review link → changes asked (no sign-in)");
  await go(D1.page, `/design/admin/tickets/${t1.id}`);
  await D1.page.getByRole("tab", { name: "Proofs & approval" }).click();
  check("the proof uploads", await upload(D1.page, "zzd-proof-v1.png"));
  await D1.page.getByLabel("Note for this version (optional)").fill("ZZD internal note: used the old logo for now");
  await D1.page.getByRole("button", { name: "Upload and send for review" }).click();
  const reviewLink = await poll(async () => { const c = D1.page.locator("code").filter({ hasText: "/review/" }); return (await c.count()) ? (await c.first().innerText()).trim() : null; });
  check("the review link is shown to the designer", !!reviewLink && reviewLink.includes("/review/"), reviewLink);
  t1 = await ticketByNumber(number);
  check("the ticket is In review, with one open link", t1.status === "in_review" && (await sql`select count(*)::int n from design_approval_requests where ticket_id = ${t1.id} and status = 'pending'`)[0].n === 1);
  check("only the link's hash is stored", !(await sql`select token_hash from design_approval_requests where ticket_id = ${t1.id}`).some((r) => reviewLink.includes(r.token_hash)));
  const reviewPath = new URL(reviewLink).pathname;
  const token = reviewPath.split("/").pop();
  await go(anon.page, reviewPath);
  check("the review page does not show the designer's note", !(await mainText(anon.page)).includes("internal note"));
  check("the review page opens without signing in", /Review your design/.test(await mainText(anon.page)) && (await mainText(anon.page)).includes(number));
  const img = await fetchIn(anon.page, `/api/design/public/review/${token}/file`);
  check("its design is served through a short signed link", img.status === 302 && !!img.location && /token=/.test(img.location), JSON.stringify(img));
  check("a made-up review file link is refused", (await fetchIn(anon.page, "/api/design/public/review/abcdefghijklmnopqrstuvwxyz0123/file")).status === 410);
  await go(R.page, `/design/tickets/${t1.id}`);
  const rt = await mainText(R.page);
  check("the requester's own ticket page: number, progress, the design to review and the brief", rt.includes(number) && rt.includes("Design for your review") && (await R.page.getByLabel("Progress: In review").count()) === 1 && rt.includes("logo top left"));
  check("it shows Approve and Request changes while in review", (await R.page.getByRole("button", { name: /^Approve$/ }).count()) === 1 && (await R.page.getByRole("button", { name: /Request changes/ }).count()) === 1);
  check("and nothing about who works on it: no designer, notes or time", !rt.includes("ZZD Designer Dev") && !rt.includes("internal note") && !/time logged|subtask/i.test(rt));
  await go(R.page, "/design/my-requests");
  check("My Requests links to the request's page", (await R.page.getByRole("link", { name: "Open request →" }).count()) >= 1);
  check("My Requests sends the browser nothing about who it is assigned to", !(await R.page.content()).includes("ZZD Designer Dev"));
  check("another requester gets not found for it", (await go(R2.page, `/design/tickets/${t1.id}`))?.status() === 404);
  await go(D2.page, `/design/admin/tickets/${t1.id}`);
  check("the designer's ticket page shows where it stands (In review)", (await D2.page.getByLabel("Progress: In review").count()) === 1);
  await anon.page.getByRole("button", { name: /Request changes/ }).click();
  await anon.page.fill("#changes", "ZZD: make the date larger and add the venue map.");
  await anon.page.getByRole("button", { name: /^Submit$/ }).click();
  await anon.page.getByText("Changes requested", { exact: false }).first().waitFor();
  t1 = await ticketByNumber(number);
  const v2 = await poll(() => ticketByNumber(`${number}-V2`));
  check("the version is closed as superseded and locked", t1.status === "superseded" && t1.is_locked);
  check(`a new version ${number}-V2 opens for the same designer, with the reason`, v2?.assignee_id === d1.id && v2.status === "assigned" && v2.parent_id === t1.id && /venue map/.test(v2.reason_for_change ?? ""));
  check("the requester's files travel with it", (await sql`select count(*)::int n from design_attachments where ticket_id = ${v2.id}`)[0].n === 1);
  await go(anon.page, reviewPath);
  check("opening the link again says it was already decided", /already requested changes/i.test(await mainText(anon.page)));
  check("the designer is told about the changes", await poll(async () => (await sql`select count(*)::int n from hub_notifications where user_id = ${d1.id} and title like ${"%asked for changes on " + number + "%"}`)[0].n === 1));

  section("version 2 approved from My Requests");
  await go(D1.page, `/design/admin/tickets/${v2.id}`);
  await D1.page.getByRole("tab", { name: "Proofs & approval" }).click();
  check("the second proof uploads", await upload(D1.page, "zzd-proof-v2.png"));
  await D1.page.getByRole("button", { name: "Upload and send for review" }).click();
  await poll(async () => (await ticketByNumber(`${number}-V2`)).status === "in_review");
  await go(R.page, "/design/my-requests?tab=in_review");
  check("My Requests shows it waiting for review", (await mainText(R.page)).includes(`${number}-V2`) && /ready for your review/.test(await mainText(R.page)));
  await R.page.getByRole("button", { name: /^Approve$/ }).first().click();
  await R.page.getByRole("dialog").getByRole("button", { name: /^Approve$/ }).click();
  const v2d = await poll(async () => { const t = await ticketByNumber(`${number}-V2`); return t.status === "delivered" ? t : null; });
  check("approved: delivered, with a 48-hour edit window", !!v2d && Math.abs(new Date(v2d.edit_window_ends_at) - new Date(v2d.delivered_at) - 48 * 3600_000) < 60_000);
  check("the designer and the leads are told", await poll(async () => (await sql`select count(*)::int n from hub_notifications where user_id = any(${[d1.id, lead.id]}) and title like ${"%approved " + number + "-V2%"}`)[0].n === 2));
  await go(R.page, "/design/my-requests?tab=delivered");
  const dl = await R.page.getByRole("link", { name: /Download designs/ }).getAttribute("href");
  check("Download designs gives the requester their approved file", !!dl && (await fetchIn(R.page, dl)).status === 302);
  check("another requester cannot download it", (await fetchIn(R2.page, dl)).status === 404);

  section("source files");
  await go(R.page, "/design/my-requests?tab=delivered");
  check("source files can be asked for once the design is approved", (await R.page.getByRole("button", { name: /Request source files/ }).count()) === 1);
  // The edit window ends: the scheduled jobs close it (approved, so Closed).
  await sql`update design_tickets set edit_window_ends_at = now() - interval '1 minute' where id = ${v2.id}`;
  if (CRON_SECRET) {
    check("the cron refuses a wrong secret", (await fetch(`${BASE}/api/cron/design-tick`, { headers: { authorization: "Bearer nope" } })).status === 401);
    const r = await fetch(`${BASE}/api/cron/design-tick`, { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    check("the cron runs the jobs", r.status === 200);
  }
  const closed = await poll(async () => { const t = await ticketByNumber(`${number}-V2`); return t.status === "closed" ? t : null; });
  check("after the edit window it is Closed and locked", !!closed && closed.is_locked);
  await go(R.page, "/design/my-requests?tab=closed");
  await R.page.getByRole("button", { name: /Request source files/ }).click();
  const cdr = await poll(async () => (await sql`select * from design_cdr_requests where ticket_id = ${v2.id}`)[0]);
  check("the requester asks for the source files", cdr?.status === "requested");
  await go(L.page, `/design/admin/tickets/${v2.id}?tab=source`);
  await L.page.getByRole("tab", { name: "Source files" }).click();
  await L.page.getByRole("button", { name: /^Approve$/ }).click();
  check("a lead approves", await poll(async () => (await sql`select status from design_cdr_requests where id = ${cdr.id}`)[0].status === "approved"));
  await go(D1.page, `/design/admin/tickets/${v2.id}`);
  await D1.page.getByRole("tab", { name: "Source files" }).click();
  check("the designer uploads the source file", await upload(D1.page, "zzd-source.cdr", Buffer.from("CDR test content"), "application/octet-stream"));
  await D1.page.getByRole("button", { name: /Upload/ }).last().click();
  check("it is marked uploaded", await poll(async () => (await sql`select status from design_cdr_requests where id = ${cdr.id}`)[0].status === "uploaded"));
  await go(R.page, "/design/my-requests?tab=closed");
  const [download] = await Promise.all([R.page.waitForEvent("download", { timeout: 20000 }).catch(() => null), R.page.getByRole("button", { name: /Download source files/ }).click()]);
  check("the requester downloads it, and the download is logged", !!download && (await poll(async () => (await sql`select count(*)::int n from design_cdr_downloads where cdr_request_id = ${cdr.id}`)[0].n === 1)));

  section("decline, and an unanswered review");
  // A second request, declined with a reason.
  await go(R2.page, "/design/request");
  await R2.page.getByLabel("Twitter / X post", { exact: true }).check();
  await R2.page.fill("#brief", "ZZD tweet for the trade fair.");
  await R2.page.fill("#delivery", istDay(20));
  await R2.page.getByRole("button", { name: /Submit request/ }).click();
  await R2.page.getByText("Your request has been submitted").waitFor();
  const n2 = /DF-\d{4,}/.exec(await mainText(R2.page))?.[0];
  check("20 days out is Low priority", (await ticketByNumber(n2))?.priority === "low");
  await go(L.page, "/design/admin/pending");
  await L.page.locator("li, article, div.ds-card").filter({ hasText: n2 }).first().getByRole("button", { name: /^Decline$/ }).click();
  await L.page.getByRole("dialog").locator("textarea").fill("ZZD: the social team handles tweets.");
  await L.page.getByRole("button", { name: "Decline request" }).click();
  check("declined, with the reason kept and the requester told", await poll(async () => { const t = await ticketByNumber(n2); return t.status === "declined" && /social team/.test(t.decline_reason ?? ""); }) && await poll(async () => (await sql`select count(*)::int n from hub_notifications where user_id = ${requester2.id} and title like ${"Request declined: " + n2}`)[0].n === 1));
  // An In-review ticket whose link expired: the jobs close it without approval.
  const t3 = (await sql`insert into design_tickets (number, title, brief, design_type_id, requirements, status, requester_id, assignee_id, priority)
    select 'DF-ZZD-1', 'ZZD expired review', 'x', id, '["flyer"]'::jsonb, 'in_review', ${requester.id}, ${d1.id}, 'normal' from design_types where key = 'flyer' returning id`)[0];
  const pf = (await sql`insert into design_files (storage_key, file_name, mime, size, purpose, uploaded_by, attached) values ('proof/zzd/x.png', 'x.png', 'image/png', 1, 'proof', ${d1.id}, true) returning id`)[0];
  const pv = (await sql`insert into design_proof_versions (ticket_id, version, file_id, created_by) values (${t3.id}, 1, ${pf.id}, ${d1.id}) returning id`)[0];
  await sql`insert into design_approval_requests (ticket_id, proof_version_id, token_hash, expires_at, created_by) values (${t3.id}, ${pv.id}, 'zzd-hash-expired', now() - interval '1 minute', ${d1.id})`;
  if (CRON_SECRET) await fetch(`${BASE}/api/cron/design-tick`, { headers: { authorization: `Bearer ${CRON_SECRET}` } });
  check("a review nobody answered in two days closes without approval", await poll(async () => (await sql`select status from design_tickets where id = ${t3.id}`)[0].status === "closed_without_approval"));

  section("admin pages");
  await go(L.page, "/design/admin");
  const dash = await mainText(L.page);
  check("team overview: the four counts and the live feed", /Open tickets/i.test(dash) && /Overdue/i.test(dash) && /In review/i.test(dash) && /Delivered this week/i.test(dash) && /Live activity/i.test(dash), dash.slice(0, 200));
  check("the live feed shows the approval", dash.includes(`${number}-V2`));
  await go(L.page, "/design/admin/board");
  check("the full board shows every designer's tickets", (await mainText(L.page)).includes(`${number}-V2`));
  check("workload page", (await go(L.page, "/design/admin/workload"))?.status() === 200 && (await mainText(L.page)).includes("ZZD Designer Dev"));
  check("reports page", (await go(L.page, "/design/admin/reports"))?.status() === 200 && /Export CSV/i.test(await mainText(L.page)));
  const csv = await fetchIn(L.page, `/api/design/reports/export?from=${istDay(-7)}&to=${istDay(0)}&format=csv`);
  const pdf = await fetchIn(L.page, `/api/design/reports/export?from=${istDay(-7)}&to=${istDay(0)}&format=pdf`);
  check("CSV and PDF exports", csv.status === 200 && csv.type.includes("text/csv") && pdf.status === 200 && pdf.type.includes("application/pdf"), `${csv.status} ${pdf.status}`);
  check("a member (not a lead) cannot export reports", (await fetchIn(D1.page, `/api/design/reports/export?format=csv`)).status === 403);
  if (H) {
    await go(H.page, "/design/admin/settings");
    check("the Support Admin sees Integrations", (await H.page.getByRole("tab", { name: /Integrations/ }).count()) + (await H.page.getByRole("link", { name: /Integrations/ }).count()) > 0);
  }

  section("campaigns");
  await go(R2.page, "/design/campaigns");
  check("requesters can add posts; only leads add campaigns", (await R2.page.getByRole("button", { name: /Add post/ }).count()) === 1 && (await R2.page.getByRole("button", { name: /Add campaign/ }).count()) === 0);
  await go(L.page, "/design/campaigns");
  check("a lead can add a campaign", (await L.page.getByRole("button", { name: /Add campaign/ }).count()) === 1);

  section("other pages open without errors");
  for (const [who, p] of [[D1, "/design/admin/calendar"], [D1, "/design/admin/library"], [D1, "/design/admin/board"], [D1, "/design/my-requests"], [L, "/design/admin/settings?tab=types"], [L, `/design/admin/tickets/${v2.id}?tab=annotate`]]) {
    check(`${p} opens`, (await go(who.page, p))?.status() === 200);
  }
  check("no page threw an error in the browser", pageErrors.length === 0, pageErrors.join(" | "));

  section("nothing else changed");
  check("every other design ticket is exactly as before", (await snap()) === before);
} catch (e) {
  console.error(e);
  check("the run finished without crashing", false, String(e).slice(0, 300));
}
await browser.close();
await removeTestData();
if (settingsBefore) await sql`update design_settings set edit_window_hours = ${settingsBefore.edit_window_hours}, max_free_revisions = ${settingsBefore.max_free_revisions}, slack_webhook = ${settingsBefore.slack_webhook} where id = 1`;
check("cleanup: no ZZD people or tickets left", (await sql`select count(*)::int n from users where email like 'zzd-%'`)[0].n === 0 && (await sql`select count(*)::int n from design_tickets where number like 'DF-ZZD%'`)[0].n === 0);
finish();
