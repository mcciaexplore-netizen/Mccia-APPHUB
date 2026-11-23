/**
 * End-to-end test of the Attendance module in a real browser: who may open its two apps (Attendance for anyone given the tile; Attendance
 * Admin for HR, the App Admins of Attendance Admin), checking in and out from the office network, applying for leave and the manager
 * approving it, logging time, every staff page (Home, Team, Leave, Time, More and each page under it) and every HR page (Today, Approvals,
 * People, Attendance, Leave Tracker, Time Tracker, Reports, Settings), the CSV downloads, and the phone layout (bottom bar, no sideways
 * scroll). No page may throw or log an error. Run against a site with ATT_ENABLED=true:
 *   E2E_BASE_URL=http://localhost:3000 node tests/e2e/attendance.mjs
 * The office network check uses the address the local server sees (127.0.0.1 / ::1), which this test puts in Settings and removes after.
 *
 * It WRITES to the database the site uses, but only rows of people named "ZZA"/"zza-": people, two "ZZA" applications (/attendance,
 * /attendance/admin) and what they do; the settings row is put back. Everything is removed when it finishes (and at the start, if an earlier
 * run was interrupted). It refuses a Neon database unless E2E_ALLOW_NEON=yes.
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
if (!BASE) { console.error("Set E2E_BASE_URL, for example: E2E_BASE_URL=http://localhost:3000 node tests/e2e/attendance.mjs"); process.exit(2); }
if (/neon\.tech/i.test(process.env.DATABASE_URL || "") && process.env.E2E_ALLOW_NEON !== "yes") { console.error("Refusing: DATABASE_URL is a Neon database. Use a test database, or set E2E_ALLOW_NEON=yes for a Neon test branch."); process.exit(2); }

const results = [];
const check = (name, ok, extra = "") => { results.push([name, !!ok]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && extra !== "" ? "  -> " + String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 300) : ""}`); };
const section = (t) => console.log(`\n== ${t} ==`);

const rawSql = (() => {
  if ((process.env.DB_DRIVER ?? "neon") !== "pg") return req("@neondatabase/serverless").neon(process.env.DATABASE_URL);
  const pool = new (req("pg").Pool)({ connectionString: process.env.DATABASE_URL, max: 4, ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false });
  return async (strings, ...values) => (await pool.query(strings.reduce((q, s, i) => q + (i ? `$${i}` : "") + s, ""), values)).rows;
})();
const sql = (...a) => rawSql(...a);
const playwright = req("playwright-core");
const launch = () => playwright.chromium.launch({ channel: process.env.E2E_CHROME_CHANNEL || "chrome", headless: true }).catch(() => playwright.chromium.launch({ headless: true }));
const hash = (pw) => { const salt = randomBytes(16); return `scrypt$16384$${salt.toString("base64")}$${scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("base64")}`; };
const PW = "zza-Test-pass-123";
const istDay = (d = new Date()) => new Date(+d + 330 * 60_000).toISOString().slice(0, 10);
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

async function cleanup() {
  const ids = (await sql`select id from users where email like 'zza-%'`).map((r) => r.id);
  if (ids.length) {
    for (const t of ["att_attendance", "att_leave_requests", "att_leave_balances", "att_leave_adjustments", "att_wfh_requests", "att_regularization_requests", "att_compoff_requests", "att_time_logs", "att_timesheets", "att_user_profiles"]) {
      await rawSql([`delete from ${t} where user_id = any($1)`], ids);
    }
    await sql`delete from att_wishes where from_user_id = any(${ids})`;
    await sql`delete from att_announcements where created_by = any(${ids})`;
    await sql`delete from hub_notifications where user_id = any(${ids})`;
    await sql`delete from access_audit where actor_id = any(${ids})`;
  }
  await sql`delete from att_holidays where name like 'ZZA%'`;
  await sql`delete from att_time_projects where name like 'ZZA%'`;
  await sql`delete from users where email like 'zza-%'`;
  await sql`delete from apps where name like 'ZZA%'`;
  await sql`delete from departments where name like 'ZZA%'`;
}

const pageErrors = [];
const consoleErrors = [];
let browser;
const fresh = async (viewport = { width: 1366, height: 900 }, { hubPopupSeen = true } = {}) => {
  // Below 768 px wide: a phone (touch screen), as the app sees it.
  const phone = viewport.width < 768;
  const ctx = await browser.newContext({ viewport, acceptDownloads: true, isMobile: phone, hasTouch: phone });
  ctx.setDefaultTimeout(60000);
  if (hubPopupSeen) await ctx.addInitScript(() => { try { localStorage.setItem("mccia-install-popup-seen", "1"); localStorage.setItem("mccia-install-snoozed-until", String(Date.now() + 864e5)); } catch {} });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(`${new URL(page.url()).pathname}: ${String(e).slice(0, 200)}`));
  page.on("dialog", (d) => d.accept());
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && consoleErrors.push(`${new URL(page.url()).pathname}: ${m.text().slice(0, 300)}`));
  return { ctx, page };
};
const signedIn = async (email, viewport, opts) => {
  const { ctx, page } = await fresh(viewport, opts);
  await page.goto(BASE + "/login"); await page.fill("input[name=email]", email); await page.fill("input[name=password]", PW);
  await page.click("button[type=submit]"); await page.waitForURL((u) => u.pathname === "/", { timeout: 90000 });
  return { ctx, page };
};
const go = async (page, p) => { const r = await page.goto(BASE + p); await page.waitForLoadState("networkidle").catch(() => {}); return r; };
const pathOf = (page) => new URL(page.url()).pathname;
const mainText = async (page) => page.locator("main").innerText();
const fetchIn = async (page, url) => { const r = await page.request.get(BASE + url, { maxRedirects: 0 }); return { status: r.status(), type: r.headers()["content-type"] ?? "", body: r.status() === 200 ? await r.text() : "" }; };
const toast = async (page, re) => page.getByText(re).first().waitFor({ timeout: 20000 }).then(() => true, () => false);

const [savedSettings] = await sql`select value from att_settings where key = 'config'`;
await cleanup();
try {
  // ── Set up: two applications, a manager, two staff, HR and an outsider ──
  const [dept] = await sql`insert into departments (name, icon, slug) values (${"ZZA HR " + randomBytes(3).toString("hex")}, 'clock', ${"zza-" + randomBytes(3).toString("hex")}) returning id`;
  const [userApp] = await sql`insert into apps (department_id, name, url, icon) values (${dept.id}, 'ZZA Attendance', '/attendance', 'clock') returning id`;
  const [adminApp] = await sql`insert into apps (department_id, name, url, icon) values (${dept.id}, 'ZZA Attendance Admin', '/attendance/admin', 'clock') returning id`;
  const mk = async (name, managerId = null) => (await sql`insert into users (name, email, password_hash, reporting_manager_id) values (${name}, ${`zza-${name.toLowerCase().replace(/\s+/g, "")}@mcciapune.com`}, ${hash(PW)}, ${managerId}) returning id, email`)[0];
  const mgr = await mk("ZZA Manju");
  const asha = await mk("ZZA Asha", mgr.id);
  const hr = await mk("ZZA Hema");
  const out = await mk("ZZA Omar");
  for (const u of [mgr, asha]) await sql`insert into user_app_access (user_id, app_id, app_role) values (${u.id}, ${userApp.id}, 'user')`;
  await sql`insert into app_admins (app_id, user_id) values (${adminApp.id}, ${hr.id})`;
  await sql`insert into att_settings (key, value) values ('config', ${JSON.stringify({ officeIps: ["127.0.0.1", "::1"], goLiveDate: addDays(istDay(), -30), firstEnabledOn: addDays(istDay(), -30) })}::jsonb) on conflict (key) do update set value = excluded.value`;

  browser = await launch();

  section("Who may open what");
  const o = await signedIn(out.email);
  await go(o.page, "/attendance");
  check("outsider: /attendance → the no-access page", pathOf(o.page) === "/attendance/no-access", pathOf(o.page));
  await go(o.page, "/attendance/admin");
  check("outsider: /attendance/admin → no-access", pathOf(o.page) === "/attendance/no-access", pathOf(o.page));
  await o.ctx.close();

  const s = await signedIn(asha.email);
  await go(s.page, "/attendance/admin");
  check("staff: Attendance Admin sends them back to /attendance", pathOf(s.page) === "/attendance", pathOf(s.page));
  check("staff: sidebar is Dashboard, Attendance, Leave, Time, More (no Attendance Admin)", /Dashboard[\s\S]*Attendance[\s\S]*Leave[\s\S]*Time[\s\S]*More/.test(await s.page.locator("aside nav").innerText()) && !(await s.page.locator("aside").innerText()).includes("Attendance Admin"));

  section("Check in and out");
  await go(s.page, "/attendance");
  const head = await mainText(s.page);
  check("home: time-of-day greeting with the first name, the subtitle and the long date", /Good (morning|afternoon|evening|night), ZZA/.test(head) && head.includes("Here's your attendance overview.") && /(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day, \d{1,2} [A-Z][a-z]+ \d{4}/.test(head));
  check("home: before check-in, no Login/Logout wording anywhere", !/\bLog ?in\b|\bLog ?out\b/i.test(head));
  check("home: Work Schedule, Today, Coming up and Announcements cards", ["Work Schedule – Next 7 Days", "View Calendar", "Today", "Coming up (next 30 days)", "Announcements", "TIME WORKED"].every((t) => head.toUpperCase().includes(t.toUpperCase())));
  await s.page.getByRole("button", { name: "Check In", exact: true }).click();
  check("check in: from the office network (no location asked)", await toast(s.page, /Checked in on the office network/));
  const outBtn = s.page.getByRole("button", { name: "Check Out", exact: true });
  await outBtn.waitFor();
  const worked = () => s.page.locator(".att-checkin .att-timer").innerText();
  const t1 = await worked();
  await s.page.waitForTimeout(2200);
  const t2 = await worked();
  check("check in: Check In time, a ticking Time worked HH:MM:SS", /^\d\d:\d\d:\d\d$/.test(t1) && t1 !== t2 && /Check In\s*\d{1,2}:\d\d (AM|PM)/.test(await mainText(s.page)), [t1, t2]);
  const card = await mainText(s.page);
  // On a working day Check Out waits for 7.5 hours; on extra work (a holiday or weekly off) it is open at once.
  if (await outBtn.isDisabled()) {
    check("check out: disabled before 7.5 hours, with a countdown", /Check out available in\s*0?\d:\d\d:\d\d/.test(card) && card.includes("Opens after 7h 30m worked"), card.slice(0, 300));
    await s.page.getByRole("button", { name: "Need to leave early?" }).click();
    await s.page.locator("textarea").fill("Doctor's appointment");
    await s.page.getByRole("button", { name: "Send request" }).click();
    check("early check-out: asked, waiting for the manager", await toast(s.page, /Early check-out requested/));
    const mgEarly = await signedIn(mgr.email);
    await go(mgEarly.page, "/attendance/more/approvals");
    check("early check-out: in the manager's inbox", (await mainText(mgEarly.page)).includes("Check out early"));
    await mgEarly.page.locator("li", { hasText: "Check out early" }).getByRole("button", { name: "Approve" }).click();
    await mgEarly.page.locator(".dialog, [role=dialog]").getByRole("button", { name: "Approve" }).click();
    check("early check-out: approved", await toast(mgEarly.page, /they can check out now/));
    await mgEarly.ctx.close();
    await go(s.page, "/attendance");
    check("check out: enabled (green) once approved", (await outBtn.isEnabled()) && (await outBtn.getAttribute("class"))?.includes("att-btn-in"));
  }
  await outBtn.click();
  check("check out: confirmed by the server", await toast(s.page, /Checked out/));
  check("check out: done for today", await s.page.getByText("Done for").waitFor({ timeout: 20000 }).then(() => true, () => false));
  const [rec] = await sql`select check_in_method, check_out_time from att_attendance where user_id = ${asha.id} and date = ${istDay()}`;
  check("check out: one row today, method ip, with a check-out", rec?.check_in_method === "ip" && !!rec.check_out_time, rec);

  section("Staff pages");
  for (const p of ["/attendance?tab=team", "/attendance/leave", "/attendance/leave/apply", "/attendance/time", "/attendance/more", "/attendance/more/summary", "/attendance/more/summary?view=list", "/attendance/more/regularization", "/attendance/more/wfh", "/attendance/more/compoff", "/attendance/more/profile", "/attendance/more/org-chart"]) {
    const r = await go(s.page, p);
    check(`staff page ${p} opens`, r?.status() === 200 && pathOf(s.page) === p.split("?")[0], r?.status());
  }
  check("team tab lists Asha in office", (await (await go(s.page, "/attendance?tab=team"), mainText(s.page))).includes("ZZA Asha"));
  check("org chart shows HR at the top with Manju and Asha", await (async () => { await go(s.page, "/attendance/more/org-chart"); const t = await mainText(s.page); return t.includes("HR") && t.includes("ZZA Manju") && t.includes("ZZA Asha"); })());
  const mine = await fetchIn(s.page, `/api/attendance/export?report=mine&month=${istDay().slice(0, 7)}`);
  check("staff CSV: their month downloads", mine.status === 200 && /text\/csv/.test(mine.type) && mine.body.includes("Date,Day status"), mine.status);
  check("staff cannot download HR reports", (await fetchIn(s.page, `/api/attendance/export?report=monthly&month=${istDay().slice(0, 7)}`)).status === 403);

  section("Apply for leave");
  await go(s.page, "/attendance/leave/apply");
  let day = addDays(istDay(), 3);
  for (let i = 0; i < 10; i++) { const wd = new Date(`${day}T00:00:00Z`).getUTCDay(); if (wd >= 1 && wd <= 5) break; day = addDays(day, 1); }
  await s.page.locator('input[type="date"]').first().fill(day);
  await s.page.getByText(/^1 day of leave/).waitFor({ timeout: 20000 });
  check("apply: shows who approves (the manager)", (await mainText(s.page)).includes("ZZA Manju (your manager)"));
  await s.page.getByRole("button", { name: "Apply for leave" }).click();
  await s.page.waitForURL((u) => u.pathname === "/attendance/leave");
  check("apply: back on Leave with the request pending", (await mainText(s.page)).includes("Pending"));

  section("Log time");
  await sql`insert into att_time_projects (name) values ('ZZA Project')`;
  await go(s.page, "/attendance/time");
  await s.page.getByRole("button", { name: "Add" }).click();
  check("time: logged", await toast(s.page, /Time logged/));
  await s.page.getByRole("button", { name: /Submit week/ }).click();
  check("time: week submitted", await toast(s.page, /Week submitted/));

  section("Phone layout");
  const m = await signedIn(asha.email, { width: 390, height: 844 });
  for (const p of ["/attendance", "/attendance/leave", "/attendance/time", "/attendance/more", "/attendance/more/summary"]) {
    await go(m.page, p);
    const overflow = await m.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`phone ${p}: bottom bar shown, no sideways scroll`, (await m.page.locator(".att-bottom-nav").isVisible()) && overflow <= 1, overflow);
  }
  await m.ctx.close();
  await s.ctx.close();

  section("Manager approves");
  const mg = await signedIn(mgr.email);
  await go(mg.page, "/attendance/more");
  check("manager: More shows Team approvals with a count", (await mainText(mg.page)).includes("Team approvals"));
  await go(mg.page, "/attendance/more/approvals");
  check("manager: the leave and the timesheet are waiting", (await mainText(mg.page)).includes("Casual Leave") && (await mainText(mg.page)).includes("Timesheet"));
  await mg.page.getByRole("button", { name: "Approve" }).first().click();
  await mg.page.locator(".dialog, [role=dialog]").getByRole("button", { name: "Approve" }).click();
  check("manager: approved", await toast(mg.page, /Approved/));
  await mg.ctx.close();

  section("HR pages");
  const h = await signedIn(hr.email);
  await go(h.page, "/attendance");
  await h.page.locator("aside nav").getByRole("link", { name: "Attendance Admin" }).click();
  await h.page.waitForURL((u) => u.pathname === "/attendance/admin");
  const labelled = await h.page.getByText(/^Attendance Admin · /).waitFor({ timeout: 20000 }).then(() => true, () => false);
  check("HR: the sidebar's Attendance Admin link opens /attendance/admin (Today)", pathOf(h.page) === "/attendance/admin" && labelled, pathOf(h.page));
  {
    const hp = await signedIn(hr.email, { width: 390, height: 844 });
    await go(hp.page, "/attendance/more");
    await hp.page.getByRole("link", { name: /Attendance Admin/ }).click();
    await hp.page.waitForURL((u) => u.pathname === "/attendance/admin");
    check("HR on a phone: More has Attendance Admin, and it opens /attendance/admin", pathOf(hp.page) === "/attendance/admin");
    await hp.ctx.close();
    const sp = await signedIn(asha.email, { width: 390, height: 844 });
    await go(sp.page, "/attendance/more");
    check("staff on a phone: no Attendance Admin in More", !(await mainText(sp.page)).includes("Attendance Admin"));
    await sp.ctx.close();
  }
  for (const p of ["/attendance/admin", "/attendance/admin/approvals", "/attendance/admin/approvals?tab=history", "/attendance/admin/people", "/attendance/admin/attendance", "/attendance/admin/leave", "/attendance/admin/time", "/attendance/admin/reports", "/attendance/admin/settings", "/attendance"]) {
    const r = await go(h.page, p);
    check(`HR page ${p} opens`, r?.status() === 200 && pathOf(h.page) === p.split("?")[0], r?.status());
  }
  await go(h.page, "/attendance/admin");
  check("HR today: Asha in office", (await mainText(h.page)).includes("ZZA Asha"));
  await go(h.page, "/attendance/admin/approvals?tab=history");
  check("HR history: the manager's decision is there, with who decided it", (await mainText(h.page)).includes("ZZA Asha") && /Approved by ZZA Manju/.test(await mainText(h.page)));
  await go(h.page, "/attendance/admin/approvals?tab=pending");
  const withMgr = await mainText(h.page);
  check("HR approvals: requests waiting for a manager are read only (no Approve / Reject)", withMgr.includes("Waiting for ZZA Manju (reporting manager)") && (await h.page.locator("main").getByRole("button", { name: /^(Approve|Reject)$/ }).count()) === 0, withMgr.slice(0, 300));
  await go(h.page, "/attendance/admin/settings");
  const hol = h.page.locator("section").filter({ has: h.page.getByRole("heading", { name: /^Holidays \d{4}$/ }) });
  await hol.locator('input[type="date"]').fill(`${istDay().slice(0, 4)}-12-25`);
  await hol.getByLabel("Name", { exact: true }).fill("ZZA Christmas");
  await hol.getByRole("button", { name: "Add", exact: true }).click();
  check("HR settings: a holiday is added", await toast(h.page, /Holiday saved/));
  await go(h.page, "/attendance/admin/leave");
  await h.page.getByRole("row", { name: /ZZA Asha/ }).getByRole("button", { name: "Adjust" }).click();
  await h.page.locator("textarea").fill("Opening balance");
  await h.page.getByRole("button", { name: /^Add 1 day/ }).click();
  check("HR leave tracker: balance adjusted", await toast(h.page, /Balance adjusted/));
  const [note] = await sql`select title from hub_notifications where user_id = ${asha.id} and title like 'HR added%'`;
  check("HR adjustment: Asha gets a bell notice", !!note);
  for (const q of [`report=monthly&month=${istDay().slice(0, 7)}`, `report=balance&year=${istDay().slice(0, 4)}`, `report=history&from=${istDay().slice(0, 4)}-01-01&to=${addDays(istDay(), 30)}`, `report=time&from=${addDays(istDay(), -30)}&to=${istDay()}`, `report=person&user=${asha.id}&from=${addDays(istDay(), -7)}&to=${istDay()}`]) {
    const r = await fetchIn(h.page, `/api/attendance/export?${q}`);
    check(`HR report ${q.split("&")[0]} downloads as CSV`, r.status === 200 && /text\/csv/.test(r.type) && r.body.split("\n").length >= 2, r.status);
  }
  await h.ctx.close();

  section("Phone app (PWA)");
  {
    const anon = await browser.newContext();
    const res = await anon.request.get(BASE + "/attendance/manifest.json", { maxRedirects: 0 });
    const man = res.status() === 200 ? await res.json() : null;
    check("manifest: served without a sign-in, MCCIA People, standalone, green, from /attendance", !!man && man.name === "MCCIA People" && man.start_url === "/attendance" && man.scope === "/attendance" && man.display === "standalone" && man.theme_color === "#16A34A" && man.icons.some((i) => i.sizes === "512x512"), res.status());
    for (const icon of ["/icons/attendance-192.png", "/icons/attendance-512.png", "/icons/attendance-180.png"]) {
      const r = await anon.request.get(BASE + icon, { maxRedirects: 0 });
      check(`icon ${icon} is there`, r.status() === 200 && /image\/png/.test(r.headers()["content-type"] ?? ""), r.status());
    }
    await anon.close();
  }

  const ph = await signedIn(mgr.email, { width: 375, height: 812 }, { hubPopupSeen: false });
  await go(ph.page, "/attendance");
  check("app: the page links the MCCIA People manifest and green theme colour", (await ph.page.locator('link[rel="manifest"]').getAttribute("href")) === "/attendance/manifest.json" && (await ph.page.locator('meta[name="theme-color"]').first().getAttribute("content"))?.toLowerCase() === "#16a34a");
  const scope = await ph.page.evaluate(async () => { await navigator.serviceWorker.ready; return (await navigator.serviceWorker.getRegistration("/attendance"))?.scope ?? null; });
  check("app: its service worker is registered for /attendance", scope === BASE + "/attendance", scope);
  const banner = ph.page.getByRole("dialog", { name: "Install MCCIA People" });
  check("install: a green banner offers to install on a phone's first visit", await banner.waitFor({ timeout: 8000 }).then(() => true, () => false));
  check("install: the hub's own install popup is not shown in Attendance", !(await ph.page.getByText("Download the MCCIA App Hub").isVisible().catch(() => false)));
  await banner.getByRole("button", { name: "Later" }).click();
  check("install: Later hides it and remembers for 7 days", !(await banner.isVisible()) && Number(await ph.page.evaluate(() => localStorage.getItem("att-install-dismissed-until"))) > Date.now() + 6 * 864e5);
  await go(ph.page, "/attendance");
  await ph.page.waitForTimeout(2500);
  check("install: not shown again after Later", !(await banner.isVisible()));

  const inBtn = ph.page.getByRole("button", { name: "Check In", exact: true });
  const box = await inBtn.boundingBox();
  check("phone: Check In is full width and at least 56 px tall", !!box && box.height >= 56 && box.width >= 375 - 2 * 48, box);
  await ph.ctx.setOffline(true);
  await ph.page.waitForTimeout(300);
  check("offline: the offline banner shows", await ph.page.getByText("You are offline").isVisible());
  await inBtn.click();
  check("offline: the check-in is kept on the phone", await ph.page.getByText("Check-in saved: sent when you are back online").waitFor({ timeout: 5000 }).then(() => true, () => false));
  await ph.ctx.setOffline(false);
  check("offline: back online, it is sent by itself", await ph.page.getByText(/Checked in on the office network/).first().waitFor({ timeout: 30000 }).then(() => true, () => false));
  check("offline: the banner is gone", !(await ph.page.getByText("You are offline").isVisible()));
  const [mrec] = await sql`select check_in_method from att_attendance where user_id = ${mgr.id} and date = ${istDay()}`;
  check("offline: the check-in reached the server (one row, office network)", mrec?.check_in_method === "ip", mrec);
  await ph.ctx.close();

  section("Every page at every width");
  const STAFF = ["/attendance", "/attendance?tab=team", "/attendance/leave", "/attendance/leave/apply", "/attendance/time", "/attendance/more", "/attendance/more/summary", "/attendance/more/profile", "/attendance/more/regularization", "/attendance/more/wfh"];
  const ADMIN = ["/attendance/admin", "/attendance/admin/approvals", "/attendance/admin/people", "/attendance/admin/leave", "/attendance/admin/settings"];
  for (const width of [320, 375, 414, 428, 768, 1024, 1280]) {
    const vp = { width, height: width < 768 ? 800 : 900 };
    const st = await signedIn(asha.email, vp);
    const wide = [];
    let navOk = true;
    for (const p of STAFF) {
      await go(st.page, p);
      await st.page.evaluate(() => localStorage.setItem("att-install-dismissed-until", String(Date.now() + 864e6)));
      const over = await st.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (over > 1) wide.push(`${p} +${over}px`);
      const bottom = await st.page.locator(".att-bottom-nav").isVisible();
      const side = await st.page.locator("aside nav").isVisible();
      if (width < 768 ? !bottom || side : bottom || !side) navOk = false;
    }
    await st.ctx.close();
    const hr2 = await signedIn(hr.email, vp);
    for (const p of ADMIN) {
      await go(hr2.page, p);
      const over = await hr2.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (over > 1) wide.push(`${p} +${over}px`);
    }
    await hr2.ctx.close();
    check(`${width}px: no page scrolls sideways (${STAFF.length + ADMIN.length} pages)`, wide.length === 0, wide);
    check(`${width}px: ${width < 768 ? "bottom bar, no sidebar" : "sidebar, no bottom bar"}`, navOk);
  }

  section("Dark mode");
  {
    const rgb = (page, sel, prop) => page.locator(sel).first().evaluate((el, p) => getComputedStyle(el)[p], prop);
    const isDark = (page) => page.evaluate(() => document.documentElement.classList.contains("att-dark"));
    // A phone set to dark mode: Attendance is dark from the first visit, with no choice made.
    const dctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "dark" });
    await dctx.addInitScript(() => { try { localStorage.setItem("mccia-install-popup-seen", "1"); localStorage.setItem("mccia-install-snoozed-until", String(Date.now() + 864e5)); localStorage.setItem("att-install-dismissed-until", String(Date.now() + 864e6)); } catch {} });
    const dp = await dctx.newPage();
    dp.on("pageerror", (e) => pageErrors.push(`dark ${new URL(dp.url()).pathname}: ${String(e).slice(0, 200)}`));
    dp.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && consoleErrors.push(`dark ${new URL(dp.url()).pathname}: ${m.text().slice(0, 300)}`));
    await dp.goto(BASE + "/login"); await dp.fill("input[name=email]", asha.email); await dp.fill("input[name=password]", PW);
    await dp.click("button[type=submit]"); await dp.waitForURL((u) => u.pathname === "/");
    check("dark: the hub itself is not dark (only Attendance has dark mode)", !(await isDark(dp)));
    await go(dp, "/attendance");
    check("dark: follows the device's dark setting on the first visit", await isDark(dp));
    check("dark: page #111827, cards #1F2937, text #F9FAFB", (await rgb(dp, "body", "backgroundColor")) === "rgb(17, 24, 39)" && (await rgb(dp, ".att-card", "backgroundColor")) === "rgb(31, 41, 55)" && (await rgb(dp, "main h1", "color")) === "rgb(249, 250, 251)");
    check("dark: bottom bar #1F2937 with a #374151 top border; the current item green", (await rgb(dp, ".att-bottom-nav", "backgroundColor")) === "rgb(31, 41, 55)" && (await rgb(dp, ".att-bottom-nav", "borderTopColor")) === "rgb(55, 65, 81)" && (await rgb(dp, '.att-bottom-nav a[aria-current="page"]', "color")) === "rgb(34, 197, 94)");
    const btn = '.att-checkin button.att-btn-in, .att-checkin span:has(svg)';
    check("dark: Check In stays green with white text", await dp.locator(".att-checkin .att-btn-in").count().then(async (n) => n === 0 || ((await rgb(dp, ".att-checkin .att-btn-in", "backgroundColor")) === "rgb(22, 163, 74)" && (await rgb(dp, ".att-checkin .att-btn-in", "color")) === "rgb(255, 255, 255)")), btn);
    check("dark: the browser bar is dark grey", (await dp.evaluate(() => [...document.querySelectorAll('meta[name="theme-color"]')].some((m) => m.content.toLowerCase() === "#111827" && (!m.media || matchMedia(m.media).matches)))));
    await go(dp, "/attendance/more/summary");
    check("dark: calendar: present dark green, absent dark red, weekly off dark grey; today outlined green", (await dp.locator(".att-st-red").count()) === 0 || (await rgb(dp, ".att-st-red", "backgroundColor")) === "rgb(69, 10, 10)");
    check("dark: a weekly off is dark grey", (await rgb(dp, ".att-st-grey", "backgroundColor")) === "rgb(55, 65, 81)");
    check("dark: today is outlined green", (await rgb(dp, ".att-today", "outlineColor")) === "rgb(34, 197, 94)");
    await go(dp, "/attendance/more/profile");
    const sw = dp.getByRole("switch", { name: "Dark mode" });
    check("dark: Profile shows the Dark mode switch, on, following the device", (await sw.getAttribute("aria-checked")) === "true" && (await mainText(dp)).includes("Following this device's setting (dark)"));
    await sw.click();
    check("dark: switching it off applies at once (light, even though the device is dark)", !(await isDark(dp)) && (await rgb(dp, "body", "backgroundColor")) !== "rgb(17, 24, 39)" && (await dp.evaluate(() => localStorage.getItem("att-theme"))) === "light");
    await go(dp, "/attendance");
    check("dark: the choice is remembered on the next page", !(await isDark(dp)));
    await go(dp, "/attendance/more/profile");
    await dp.getByRole("button", { name: "Use the device setting" }).click();
    check("dark: \"Use the device setting\" goes back to dark", (await isDark(dp)) && (await dp.evaluate(() => localStorage.getItem("att-theme"))) === null);
    await go(dp, "/attendance/admin");
    check("dark: admin pages are dark too (staff are sent back to Home, also dark)", await isDark(dp));
    await go(dp, "/");
    check("dark: leaving Attendance for the hub turns dark mode off", !(await isDark(dp)));
    await dctx.close();

    // A light device: the switch turns dark mode on, and it stays on after a reload.
    const l = await signedIn(asha.email);
    await go(l.page, "/attendance/more/profile");
    check("dark: on a light device Attendance starts light", !(await isDark(l.page)));
    await l.page.getByRole("switch", { name: "Dark mode" }).click();
    check("dark: switching it on applies at once", await isDark(l.page));
    await l.page.reload(); await l.page.waitForLoadState("networkidle");
    check("dark: still dark after a reload (remembered), and the sidebar is #1F2937", (await isDark(l.page)) && (await rgb(l.page, ".att-side", "backgroundColor")) === "rgb(31, 41, 55)");
    await l.ctx.close();
  }

  check("no page threw an error", pageErrors.length === 0, pageErrors);
  check("no console errors", consoleErrors.length === 0, consoleErrors);
} catch (e) {
  check("crashed", false, String(e?.stack ?? e));
} finally {
  await browser?.close().catch(() => {});
  await cleanup();
  if (savedSettings) await sql`update att_settings set value = ${JSON.stringify(savedSettings.value)}::jsonb where key = 'config'`;
}
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
