/**
 * End-to-end test of the whole hub in a real browser. Run: E2E_BASE_URL=https://your-site npm run test:e2e
 *
 * It WRITES to the database the site uses: it creates departments, apps and users whose names start with "ZZ"/"zz-",
 * and removes them (and the launches it made) when it finishes. It also checks that your real data is unchanged.
 * Env: E2E_BASE_URL (required), E2E_BROWSER = chromium (default) | firefox | webkit, E2E_CHROME_CHANNEL (default "chrome").
 * Firefox and WebKit need a one-time `npx playwright-core install firefox webkit`.
 */
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const req = createRequire(ROOT + "/package.json");
req("dotenv").config({ path: ROOT + "/.env.local", quiet: true });
req("dotenv").config({ path: ROOT + "/.env", quiet: true });
const BASE = (process.env.E2E_BASE_URL || "").replace(/\/$/, "");
if (!BASE) { console.error("Set E2E_BASE_URL, for example: E2E_BASE_URL=http://localhost:3000 npm run test:e2e"); process.exit(2); }
if (/neon\.tech/i.test(process.env.DATABASE_URL || "") && process.env.E2E_ALLOW_NEON !== "yes") { console.error("DATABASE_URL is a Neon address. Point it (and the site) at a test database, or a Neon branch with E2E_ALLOW_NEON=yes."); process.exit(2); }
const BROWSER = process.env.E2E_BROWSER || "chromium";
// The same query helper for both database drivers the app supports (DB_DRIVER=neon, the default, or DB_DRIVER=pg for a local Postgres).
const rawSql = (() => {
  if ((process.env.DB_DRIVER ?? "neon") !== "pg") return req("@neondatabase/serverless").neon(process.env.DATABASE_URL);
  const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(process.env.DATABASE_URL || "");
  const pool = new (req("pg").Pool)({ connectionString: process.env.DATABASE_URL, max: 4, ssl: local ? false : { rejectUnauthorized: true } });
  return async (strings, ...values) => (await pool.query(strings.reduce((q, t, i) => q + (i ? `$${i}` : "") + t, ""), values)).rows;
})();
// Every query is retried a few times: a flaky connection from the test machine must not fail the run or leave data behind.
const sql = (...args) => retry(() => rawSql(...args), 10, 4000);
const playwright = req("playwright-core");
const SP = fs.mkdtempSync(path.join(os.tmpdir(), "hub-e2e-"));
const ADMIN_EMAIL = (process.env.SUPPORT_ADMIN_EMAIL || process.env.HEAD_ADMIN_EMAIL || "").trim().toLowerCase();
const ADMIN_PW = (process.env.SUPPORT_ADMIN_PASSWORD || process.env.HEAD_ADMIN_PASSWORD || "").trim();
if (!ADMIN_EMAIL || !ADMIN_PW) { console.error("HEAD_ADMIN_EMAIL and HEAD_ADMIN_PASSWORD must be set in .env: the suite signs in as the main admin."); process.exit(2); }
const launch = () => BROWSER === "chromium"
  ? playwright.chromium.launch({ channel: process.env.E2E_CHROME_CHANNEL || "chrome", headless: true }).catch(() => playwright.chromium.launch({ headless: true }))
  : playwright[BROWSER].launch({ headless: true });
console.log(`Testing ${BASE} in ${BROWSER}`);
const res = []; const check = (n, ok, x = "") => { res.push([n, !!ok]); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${x !== "" ? "  -> " + String(x).slice(0, 220) : ""}`); };
const section = (t) => console.log(`\n== ${t} ==`);
/** The page's HTML, read again if the page happens to be navigating at that very moment (a redirect still settling). */
const html = async (pg) => { for (let i = 0; i < 6; i++) { try { return await pg.content(); } catch { await pg.waitForLoadState("domcontentloaded").catch(() => {}); await pg.waitForTimeout(400); } } return pg.content(); };
const startedAt = new Date();
// Waits (up to a limit) for something the app does in the background to show up, instead of guessing a fixed delay.
const poll = async (fn, ms = 25000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { try { v = await fn(); if (v) return v; } catch { /* keep trying */ } await new Promise((r) => setTimeout(r, 800)); } return v; };
// A dropped connection must never leave test data behind, so database work is retried.
const retry = async (fn, tries = 14, waitMs = 5000) => { let last; for (let i = 0; i < tries; i++) { try { return await fn(); } catch (e) { last = e; await new Promise((r) => setTimeout(r, waitMs)); } } throw last; };
const removeTestData = async () => {
  await sql`delete from access_audit where at >= ${new Date(startedAt.getTime() - 60000)}`; // what this run's own administrator actions recorded
  await sql`delete from login_attempts where created_at >= ${new Date(startedAt.getTime() - 60000)} and (email like 'zz-%' or email = ${ADMIN_EMAIL} or email = 'nobody-here@example.com')`;
  const ids = (await sql`select id from users where email like 'zz-%'`).map((r) => r.id);
  for (const id of ids) { await sql`delete from user_app_access where user_id=${id}`; await sql`delete from activity_log where user_id=${id}`; }
  await sql`delete from users where email like 'zz-%'`;
  await sql`delete from access_templates where name like 'ZZ%'`;
  await sql`delete from apps where name like 'ZZ%' or name like '<img%' or name like '=HYPERLINK%'`;
  await sql`delete from teams where name like 'ZZ%'`;
  await sql`delete from branches where name like 'ZZ%'`;
  await sql`delete from departments where name like 'ZZ%'`;
};
// The same scrypt format the site uses, so a test can give a person a known password without going through the screens.
const scryptHash = (pw) => { const salt = crypto.randomBytes(16); const key = crypto.scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }); return `scrypt$16384$${salt.toString("base64")}$${key.toString("base64")}`; };
const setPassword = (email, pw) => sql`update users set password_hash = ${scryptHash(pw)}, must_change_password = false where email = ${email}`;
const snap = async () => ({
  departments: (await sql`select name,is_active from departments where kind = 'application' and name not like 'ZZ%' order by sort_order,name`),
  apps: await sql`select a.name,a.url,a.is_active,a.status,d.name dept from apps a join departments d on d.id=a.department_id where a.name not like 'ZZ%' order by a.name`,
  branches: await sql`select name,is_active from branches where name not like 'ZZ%' order by name`,
  teams: await sql`select name,is_active from teams where name not like 'ZZ%' order by name`,
  users: await sql`select email,role,is_active from users where email not like 'zz-%' and email <> ${ADMIN_EMAIL} order by email`,
});
await retry(removeTestData); // clears leftovers of any earlier interrupted run
const before = await retry(snap);
const browser = await launch();
// The "Download the app" popup and banner are marked as already seen in every test browser, so they never cover a button.
{ const open = browser.newContext.bind(browser); browser.newContext = async (o) => { const c = await open(o); await c.addInitScript(() => { try { localStorage.setItem("mccia-install-popup-seen", "1"); localStorage.setItem("mccia-install-snoozed-until", String(Date.now() + 864e5)); } catch {} }); return c; }; }
const ctx = await browser.newContext({ viewport: { width: 1300, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
const unlockIf = async (pg) => {
  if (new URL(pg.url()).pathname !== "/unlock") return false;
  await pg.locator("input[name=password]").fill(ADMIN_PW); await pg.getByRole("button", { name: "Unlock" }).click();
  await pg.waitForURL((u) => u.pathname !== "/unlock", { timeout: 20000 }).catch(() => {}); return true;
};
const rawGoto = page.goto.bind(page);
page.goto = async (url, opts) => { let r = await rawGoto(url, opts); if (await unlockIf(page)) r = await rawGoto(url, opts); return r; };
const signIn = async (pg, email, password) => {
  await pg.goto(BASE + "/login"); await pg.locator("input[name=email]").fill(email); await pg.locator("input[name=password]").fill(password);
  await pg.getByRole("button", { name: "Sign in" }).click();
  // Done once the page left /login (signed in) or came back with ?error (refused).
  await pg.waitForFunction(() => location.pathname !== "/login" || location.search.includes("error"), null, { timeout: 25000 }).catch(() => {});
  await pg.waitForLoadState("networkidle").catch(() => {}); await pg.waitForTimeout(300);
};
const consoleErrors = [], pageErrors = [], dialogs = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160)); });
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 160)));
page.on("dialog", async (d) => { dialogs.push(d.message()); await d.dismiss(); });
// A page load can be cut short by a redirect still settling from the page before (net::ERR_ABORTED): it is simply tried again once.
const go = async (p) => { try { await page.goto(BASE + p); } catch { await page.waitForLoadState("networkidle").catch(() => {}); await page.goto(BASE + p); } await page.waitForLoadState("networkidle").catch(() => {}); };
const main = async () => (await page.locator("main").first().innerText());
const toast = async (t) => page.getByText(t).first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
const dep = async (name) => (await sql`select * from departments where kind = 'application' and name=${name}`)[0];
const app = async (name) => (await sql`select * from apps where name=${name}`)[0];

try {
  section("0. Sign-in gate");
  {
    const anon = await browser.newContext(); const ap0 = await anon.newPage();
    for (const p of ["/", "/administrator/users", "/go/00000000-0000-4000-8000-000000000000", "/change-password"]) { await ap0.goto(BASE + p); check("signed out, " + p + " goes to the login page", new URL(ap0.url()).pathname === "/login", ap0.url()); }
    check("the login page asks for an email and a password", (await ap0.locator("input[name=email]").count()) === 1 && (await ap0.locator("input[name=password]").count()) === 1);
    // Wrong passwords are tried from a made-up address, so the limits they trigger never touch the rest of this run. (Off Vercel the
    // address comes from this header; on Vercel only Vercel sets it, so a visitor cannot choose their address there.)
    const WRONG_IP = "198.51.100.23";
    const wc = await browser.newContext({ extraHTTPHeaders: { "x-vercel-forwarded-for": WRONG_IP } }); const wp = await wc.newPage();
    await signIn(wp, ADMIN_EMAIL, "definitely-wrong-1");
    const wrongTxt = await html(wp); check("a wrong password shows an error and stays on the login page", /Incorrect email or password/.test(wrongTxt) && new URL(wp.url()).pathname === "/login");
    await signIn(wp, "nobody-here@example.com", "definitely-wrong-1");
    check("an unknown email gets exactly the same message (no hint which emails exist)", /Incorrect email or password/.test(await html(wp)));
    for (let i = 0; i < 4; i++) await signIn(wp, ADMIN_EMAIL, "wrong-attempt-" + i + "x");
    await signIn(wp, ADMIN_EMAIL, ADMIN_PW);
    check("after 5 wrong passwords from one address, even the right one is refused there for now, with the same message", new URL(wp.url()).pathname === "/login" && /Incorrect email or password/.test(await html(wp)), wp.url());
    check("every try is recorded, the refused one marked as such", (await sql`select count(*)::int n from login_attempts where email = ${ADMIN_EMAIL} and ip_address = ${WRONG_IP} and blocked`)[0].n >= 1 && (await sql`select count(*)::int n from login_attempts where email = 'nobody-here@example.com'`)[0].n >= 1);
    await wc.close();
    await signIn(ap0, ADMIN_EMAIL, ADMIN_PW);
    check("from another address the right password still works: nobody can lock an account from somewhere else", new URL(ap0.url()).pathname === "/", ap0.url());
    const sess = (await anon.cookies()).find((c) => c.name === "hub_session");
    check("the sign-in cookie is HttpOnly, SameSite=Lax" + (BASE.startsWith("https") ? " and Secure" : ""), sess && sess.httpOnly && sess.sameSite === "Lax" && (!BASE.startsWith("https") || sess.secure), JSON.stringify(sess && { httpOnly: sess.httpOnly, sameSite: sess.sameSite, secure: sess.secure }));
    await anon.close();
    const forged = await browser.newContext(); await forged.addCookies([{ name: "hub_session", value: "eyJ1IjoieCIsImYiOiJ5IiwiZSI6OTk5OTk5OTk5OSwicCI6InNlc3Npb24ifQ.AAAA", url: BASE }]);
    const fp = await forged.newPage(); await fp.goto(BASE + "/"); check("a forged cookie is rejected", new URL(fp.url()).pathname === "/login", fp.url()); await forged.close();
    await signIn(page, ADMIN_EMAIL, ADMIN_PW);
  }

  section("1. Hub: the home page, search");
  const r0 = await page.goto(BASE + "/"); await page.waitForLoadState("networkidle").catch(() => {});
  check("home opens after signing in", r0.status() === 200 && page.url() === BASE + "/", r0.status());
  // The Approval System is a card of its own, so an old Approvals application card (URL /approvals) is never listed.
  const isApprovalsCard = (a) => /^((https?:\/\/[^/?#]+)?\/approvals\/?|\/approvals\/(hr|expenses)\/new)$/.test(a.url.trim());
  const liveApps = before.apps.filter((a) => a.is_active && !isApprovalsCard(a) && before.departments.some((d) => d.name === a.dept && d.is_active)).map((a) => a.name);
  const homeTxt = await main();
  check("the home page shows every active application of an active category, all on one page", liveApps.every((n) => homeTxt.includes(n)), liveApps.join(", "));
  check("with the Approval System and Administrator cards", /Approval System/.test(homeTxt) && /Administrator/.test(homeTxt));
  check("the header shows who is signed in", (await page.locator("header").first().innerText()).includes(process.env.SUPPORT_ADMIN_NAME || process.env.HEAD_ADMIN_NAME || ADMIN_EMAIL), (await page.locator("header").first().innerText()).trim());
  await page.getByRole("button", { name: "Search applications" }).click();
  await page.getByPlaceholder("Search").fill("Raise HR"); await page.waitForTimeout(400);
  check("search narrows the cards to the matching ones", /Approval System/.test(await main()) && !/Users, access, the approval forms/.test(await main()));
  await page.getByPlaceholder("Search").fill("zzqqxx-nothing"); await page.waitForTimeout(400);
  check("search with no match says so", /No applications match/.test(await main()));
  await page.getByRole("button", { name: "Close search" }).click();
  await page.locator("main select").first().selectOption("apps"); await page.waitForTimeout(300);
  check("the Show filter can hide the hub's own cards", !/Raise HR and expense requests/.test(await main()));
  await page.locator("main select").first().selectOption("all");

  section("2. Launch redirect and bad ids");
  // The old Approvals card (URL /approvals) is hidden from the hub and has no launch route, and a path URL redirects to an absolute address, so use a real https app.
  const firstApp = before.apps.find((a) => a.is_active && !isApprovalsCard(a) && a.url.startsWith("https://"));
  if (firstApp) {
    const firstRow = (await sql`select id,url from apps where name=${firstApp.name}`)[0];
    const lr = await page.request.get(BASE + "/go/" + firstRow.id, { maxRedirects: 0 });
    check("/go/<app> redirects to the app's URL", lr.status() === 302 && lr.headers().location === firstRow.url, lr.headers().location);
  } else console.log("NOTE  no real https application here to launch; the redirect target is checked on a test app in section 4");
  check("/go/not-a-uuid is 404", (await page.request.get(BASE + "/go/not-a-uuid", { maxRedirects: 0 })).status() === 404);
  check("/go/<unknown uuid> is 404", (await page.request.get(BASE + "/go/00000000-0000-4000-8000-000000000000", { maxRedirects: 0 })).status() === 404);
  const nf = await page.goto(BASE + "/this-page-does-not-exist"); check("unknown page is a branded 404", nf.status() === 404 && (await html(page)).includes("Page not found"));
  const hh = (await page.request.get(BASE + "/")).headers();
  check("security headers present", hh["x-frame-options"] === "DENY" && hh["x-content-type-options"] === "nosniff" && !!hh["referrer-policy"], `${hh["x-frame-options"]} / ${hh["x-content-type-options"]}`);
  check("the old auth endpoints are gone", (await page.request.get(BASE + "/api/auth/session")).status() === 404);

  section("3. Departments: add, duplicate, edit, reorder, deactivate");
  await go("/administrator/departments");
  const addDept = async (name) => { await page.getByRole("button", { name: /Add category/ }).click(); const f = page.locator("form").filter({ has: page.getByRole("button", { name: "Create category" }) }); await f.locator("input").first().fill(name); await f.getByRole("button", { name: "Create category" }).click(); };
  await addDept("ZZ Dept A"); check("add application category shows a success message", await toast("Application category created"));
  const dA = await dep("ZZ Dept A"); check("department saved with a slug and active", dA && dA.slug === "zz-dept-a" && dA.is_active);
  const maxReal = (await sql`select max(sort_order)::int m from departments where kind = 'application' and name not like 'ZZ%'`)[0].m; check("a new department is added at the END of the list", dA.sort_order > maxReal, dA.sort_order + " > " + maxReal);
  await page.waitForTimeout(1500); await addDept("ZZ Dept A");
  check("duplicate department name is refused", await toast("already exists"));
  await page.waitForTimeout(500); await page.reload(); await page.waitForLoadState("networkidle");
  await page.locator("tr", { hasText: "ZZ Dept A" }).getByRole("button", { name: "Edit" }).click();
  const ef = page.locator("form").filter({ has: page.getByRole("button", { name: "Save" }) }); await ef.locator("input").first().fill("ZZ Dept A2"); await ef.getByRole("button", { name: "Save" }).click();
  check("edit application category shows a success message", await toast("Application category saved")); await page.waitForTimeout(800);
  check("rename persisted (name and slug)", (await dep("ZZ Dept A2"))?.slug === "zz-dept-a2");
  await page.reload(); await page.waitForLoadState("networkidle"); await addDept("ZZ Dept B"); await toast("Application category created"); await page.waitForTimeout(1500); await page.reload(); await page.waitForLoadState("networkidle");
  const order = async () => (await sql`select name from departments where name like 'ZZ Dept%' order by sort_order,name`).map((r) => r.name);
  const o1 = await order(); await page.locator("tr", { hasText: "ZZ Dept A2" }).getByRole("button", { name: "Move down" }).click(); await toast("Reordered"); await page.waitForTimeout(1200);
  const o2 = await order(); check("move down changes the order", JSON.stringify(o1) !== JSON.stringify(o2), o1.join(">") + " => " + o2.join(">"));
  await page.reload(); await page.waitForLoadState("networkidle");
  await page.locator("tr", { hasText: "ZZ Dept B" }).getByRole("button", { name: "Active" }).click(); await page.waitForTimeout(2000);
  check("deactivating a department saves", (await dep("ZZ Dept B")).is_active === false);
  await go("/administrator/departments"); await page.locator("tr", { hasText: "ZZ Dept B" }).getByRole("button", { name: "Inactive" }).click(); await page.waitForTimeout(2000);
  check("reactivating it brings it back", (await dep("ZZ Dept B")).is_active === true);

  section("4. Applications: validation, XSS, scoping, active flag");
  await go("/administrator/departments"); await page.locator("main").getByRole("link", { name: "ZZ Dept A2" }).click(); await page.waitForURL(/departments\/[0-9a-f-]{36}/); const deptUrl = page.url();
  const addApp = async (name, url, opts = {}) => { await page.getByRole("button", { name: /^Add application/ }).first().click(); const f = page.locator("form").filter({ has: page.getByRole("button", { name: "Add application" }) }); await f.locator("input").nth(0).fill(name); if (opts.desc) await f.locator("input").nth(1).fill(opts.desc); await f.locator("input[inputmode=url]").fill(url); if (opts.inactive) await f.getByRole("checkbox").uncheck(); await f.getByRole("button", { name: "Add application" }).click(); };
  await addApp("ZZ App One", "https://example.com/one", { desc: "first" }); check("add application succeeds", await toast("Application added")); await page.waitForTimeout(1500);
  const a1 = await app("ZZ App One"); check("saved under the right department, active, ordered", a1 && a1.department_id === dA.id && a1.is_active && a1.sort_order > 0);
  await page.reload(); await page.waitForLoadState("networkidle"); await addApp("ZZ Plain Http", "http://example.com/x"); check("http:// URL is refused", await toast("must start with https://")); await page.waitForTimeout(500);
  check("refused app was not saved", !(await app("ZZ Plain Http")));
  await page.reload(); await page.waitForLoadState("networkidle"); await addApp("ZZ Js Url", "javascript:alert(1)"); await page.waitForTimeout(2500);
  check("javascript: URL is refused", !(await app("ZZ Js Url")));
  await page.reload(); await page.waitForLoadState("networkidle"); await addApp('<img src=x onerror=alert("xss")>', "https://example.com/xss"); await toast("Application added"); await page.waitForTimeout(1500);
  await page.reload(); await page.waitForLoadState("networkidle");
  check("HTML in a name is shown as text, never run", (await main()).includes("<img src=x") && dialogs.length === 0, dialogs.join(","));
  await addApp("=HYPERLINK(\"http://evil\")", "https://example.com/formula"); await toast("Application added"); await page.waitForTimeout(1500);
  await page.reload(); await page.waitForLoadState("networkidle"); await addApp("ZZ Hidden App", "https://example.com/hidden", { inactive: true }); await toast("Application added"); await page.waitForTimeout(1500);
  check("app added with Active unticked is inactive", (await app("ZZ Hidden App"))?.is_active === false);
  await go("/administrator/departments"); await page.locator("main").getByRole("link", { name: "ZZ Dept B" }).click(); await page.waitForURL(/departments\/[0-9a-f-]{36}/);
  check("another department does not show these apps", !(await main()).includes("ZZ App One"));
  await page.goto(deptUrl); await page.waitForLoadState("networkidle");
  await page.locator("tr", { hasText: "ZZ App One" }).getByRole("button", { name: "Edit" }).click(); const af = page.locator("form").filter({ has: page.getByRole("button", { name: "Save" }) });
  await af.locator("input").nth(0).fill("ZZ App Uno"); await af.getByRole("button", { name: "Save" }).click(); check("edit application saves", await toast("Application saved")); await page.waitForTimeout(1200);
  check("rename persisted", !!(await app("ZZ App Uno")));
  await page.reload(); await page.waitForLoadState("networkidle");
  const so = async () => (await sql`select name from apps where department_id=${dA.id} order by sort_order,name`).map((r) => r.name).join(">");
  const s1 = await so(); await page.locator("tr", { hasText: "ZZ App Uno" }).getByRole("button", { name: "Move down" }).click(); await toast("Reordered"); await page.waitForTimeout(1200);
  check("move down reorders apps", s1 !== (await so()));
  await go("/"); const hubTxt = await main();
  check("the home page shows the active apps, each with its category, not the inactive one", hubTxt.includes("ZZ App Uno") && hubTxt.includes("ZZ Dept A2") && !hubTxt.includes("ZZ Hidden App"));
  check("hub card shows the XSS-looking name as plain text", hubTxt.includes("<img src=x") && dialogs.length === 0);
  const hid = await app("ZZ Hidden App"); check("/go for an inactive app is 404", (await page.request.get(BASE + "/go/" + hid.id, { maxRedirects: 0 })).status() === 404);
  const l1 = await page.request.get(BASE + "/go/" + (await app("ZZ App Uno")).id, { maxRedirects: 0 }); check("launching an app redirects to its URL", l1.status() === 302 && l1.headers().location === "https://example.com/one", l1.headers().location); check("launching an app logs the launch",l1.status() === 302 && (await sql`select count(*)::int n from activity_log where app_id=${(await app("ZZ App Uno")).id} and action='launch'`)[0].n === 1);
  const fRow = await sql`select id from apps where name like '=HYPERLINK%'`; await page.request.get(BASE + "/go/" + fRow[0].id, { maxRedirects: 0 });
  await sql`update departments set is_active = false where id = ${dA.id}`;
  await go("/"); check("when a category is switched off, its applications leave the home page", !(await main()).includes("ZZ App Uno"));
  await sql`update departments set is_active = true where id = ${dA.id}`;

  section("5. Users & Access: the directory and bulk add");
  await go("/administrator/users");
  check("Users & Access offers Add user and Bulk add users", (await page.getByRole("button", { name: /Add user/ }).count()) === 1 && (await page.getByRole("link", { name: /Bulk add users/ }).count()) >= 1);
  check("the Support Admin's row is marked as such", (await page.locator("tr", { hasText: ADMIN_EMAIL }).first().innerText()).toLowerCase().includes("support admin"));
  for (const l of ["Filter by branch", "Filter by team", "Filter by role", "Filter by status", "Filter by application"]) check(`the directory has: ${l}`, (await page.getByLabel(l).count()) === 1);
  await go("/administrator/users/import");
  const pickFile = async (name, content) => { fs.writeFileSync(SP + "/" + name, content); await page.locator("input[type=file]").setInputFiles(SP + "/" + name); };
  const problem = (text) => page.locator("[role=alert]", { hasText: text }).first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
  await pickFile("bad1.csv", "name,email\n"); check("header-only file is rejected with a message", await problem("at least one person"));
  await pickFile("bad2.csv", "foo,bar\n1,2"); check("missing name and email columns is rejected", await problem('"name" and "email"'));
  await pickFile("bad3.csv", ""); check("empty file is rejected", await problem("at least one person"));
  await pickFile("bad4.csv", "name,email,password\nA,a@gmail.com,secret-pass-1\n"); check("a file with a password column is refused outright", await problem("Remove the password column"));
  fs.writeFileSync(SP + "/big.csv", "email,name\n" + "x".repeat(2_100_000)); await page.locator("input[type=file]").setInputFiles(SP + "/big.csv"); check("file over 2 MB is rejected", await problem("over 2 MB"));
  fs.writeFileSync(SP + "/notes.pdf", "x"); await page.locator("input[type=file]").setInputFiles(SP + "/notes.pdf"); check("a file that is not CSV or Excel is rejected", await problem("Choose a .csv or .xlsx"));
  const csv = "\uFEFF" + ["name,email,branch,applications,designation,ignored",
    '"Asha Patil",zz-asha@gmail.com,,"ZZ App Uno, ZZ App Uno",Accountant,x',
    '  Mixed Case  ,  ZZ-UP@GMAIL.COM  ,,ZZ App Uno,,',
    '"Line\nBreak",zz-nl@gmail.com,,,,',
    "=1+1,zz-formula@gmail.com,,,,",
    "",
    "Dup One,zz-dup@gmail.com,,,,",
    "Dup Two,ZZ-DUP@gmail.com,,,,",
    "Wrong Domain,zz-bad@yahoo.com,,,,",
    "Bad Branch,zz-badbranch@gmail.com,No Such Branch,,,",
    "Bad App,zz-badapp@gmail.com,,No Such App,,",
    ",zz-noname@gmail.com,,,,",
    "Not An Email,not-an-email,,,,"].join("\r\n");
  fs.writeFileSync(SP + "/edge.csv", csv); await page.locator("input[type=file]").setInputFiles(SP + "/edge.csv");
  const createBtn = page.getByRole("button", { name: /^Create \d+ accounts?/ });
  await poll(async () => /Create 7 accounts/.test(await createBtn.innerText()) && !(await createBtn.isDisabled()));
  check("blank lines are not counted as rows, and an unused column is reported", (await page.getByRole("button", { name: /^All · 11$/ }).count()) === 1 && (await main()).includes("ignored"), await createBtn.innerText());
  const rowText = async (n) => (await page.locator(`tr[data-row='${n}']`).innerText()).replace(/\s+/g, " ");
  check("a duplicate email is flagged and points at the first row", /duplicate/i.test(await rowText(6)) && /Row 5/.test(await rowText(6)), await rowText(6));
  check("each problem row says why, with the exact value", /must end with/.test(await rowText(7)) && /Name is missing/.test(await rowText(10)) && /not a valid email/.test(await rowText(11)));
  check("an unknown branch or application is only a warning: the row is still ready, and says what is left empty", /ready/i.test(await rowText(8)) && /No Such Branch/.test(await rowText(8)) && /ready/i.test(await rowText(9)) && /No Such App/.test(await rowText(9)), `${await rowText(8)} | ${await rowText(9)}`);
  check("a good row says it will be created", /ready/i.test(await rowText(1)) && /will create/.test(await rowText(1)));
  await page.getByLabel("name for row 10").fill("Fixed Name");
  await poll(async () => /Create 8 accounts/.test(await createBtn.innerText()) && !(await createBtn.isDisabled()));
  check("a problem can be corrected on screen before confirming (row 10 becomes ready)", /Create 8 accounts/.test(await createBtn.innerText()) && /ready/i.test(await rowText(10)), await rowText(10));
  await createBtn.click(); await page.getByText(/Finished\./).waitFor({ timeout: 90000 }); const sum = (await page.getByText(/Finished\./).innerText()).replace(/\s+/g, " ");
  check("summary: 11 submitted, 8 created, 3 not imported", /11 submitted: 8 created, 0 updated, 0 skipped, 3 not imported \(invalid\), 0 failed/.test(sum), sum);
  const u = async (e) => (await sql`select id,name,email,designation,home_department_id,password_hash from users where email=${e}`)[0];
  const asha = await u("zz-asha@gmail.com"); check("designation set; BOM/CRLF handled", asha && asha.designation === "Accountant");
  check("same app listed twice gives one grant", (await sql`select count(*)::int n from user_app_access where user_id=${asha.id}`)[0].n === 1);
  check("email is trimmed and lower-cased", !!(await u("zz-up@gmail.com")) && (await u("zz-up@gmail.com")).name === "Mixed Case");
  check("name with a line break in quotes is kept whole", (await u("zz-nl@gmail.com"))?.name === "Line\nBreak");
  check("formula-looking name is stored as plain text", (await u("zz-formula@gmail.com"))?.name === "=1+1");
  check("duplicate email inside one file: first created, second not", (await u("zz-dup@gmail.com"))?.name === "Dup One");
  check("the corrected row was created with its corrected name", (await u("zz-noname@gmail.com"))?.name === "Fixed Name");
  check("wrong domain / bad email: not created", !(await u("zz-bad@yahoo.com")) && !(await u("not-an-email")));
  check("unknown branch / unknown app: created, with the branch left empty and no application given", (await sql`select branch_id from users where email = 'zz-badbranch@gmail.com'`)[0]?.branch_id === null && (await sql`select count(*)::int n from user_app_access g join users us on us.id = g.user_id where us.email = 'zz-badapp@gmail.com'`)[0].n === 0);
  check("nobody was given a password: every imported account has none until sign-in details are sent", (await sql`select count(*)::int n from users where email like 'zz-%' and password_hash is not null`)[0].n === 0);
  check("and no sign-in details were sent yet (that is chosen after the import)", (await sql`select count(*)::int n from user_invites i join users us on us.id = i.user_id where us.email like 'zz-%'`)[0].n === 0);
  const rtxt = await main(); check("each error row explains why in the results", /must end with|was not found|Name is missing|not a valid email/i.test(rtxt));
  const dl = page.waitForEvent("download"); await page.getByRole("button", { name: /Download report/ }).click(); const rep = fs.readFileSync(await (await dl).path(), "utf8");
  check("the report lists each row's result and reason, and never a password", rep.includes("Asha Patil") && rep.includes("created") && /not imported/.test(rep) && !/token=|set-password|scrypt/i.test(rep), rep.slice(0, 200));
  const send = page.locator('[aria-label="Send sign-in details"]').first();
  check("after the import, everyone created is listed to tick for their sign-in details", (await send.locator("li").count()) === 8);
  const everyone = send.getByRole("checkbox", { name: /Tick everyone/ });
  check("everyone is ticked to begin with", await everyone.isChecked());
  if (!(await everyone.isChecked())) await everyone.check();
  await send.getByRole("button", { name: /^Send to 8 ticked/ }).click();
  const signDlg = page.getByRole("dialog", { name: "Sign-in details" });
  await signDlg.getByLabel("Temporary password for Asha Patil").waitFor({ timeout: 30000 });
  const ashaTemp = await signDlg.getByLabel("Temporary password for Asha Patil").inputValue();
  check("with no email set up, each person's temporary password is shown once, for the administrator to pass on", ashaTemp.length === 12, ashaTemp.length);
  await signDlg.getByRole("button", { name: "Done", exact: true }).click();
  check("each of them now has one invitation record, stored only as a hash, and must choose their own password", (await sql`select count(*)::int n from user_invites i join users us on us.id = i.user_id where us.email like 'zz-%' and i.token_hash ~ '^[0-9a-f]{64}$'`)[0].n === 8 && (await sql`select count(*)::int n from users where email like 'zz-%' and must_change_password`)[0].n === 8);
  await page.getByRole("button", { name: "Start another import" }).click(); await pickFile("edge2.csv", csv);
  await poll(async () => /Create 0 accounts/.test(await createBtn.innerText()));
  const usersBefore = (await sql`select count(*)::int n from users where email like 'zz-%'`)[0].n;
  check("running the same file again creates no one (retries are safe): the button offers 0 and is disabled", /Create 0 accounts/.test(await createBtn.innerText()) && (await createBtn.isDisabled()));
  check("the people already created are reported as already existing (the row with no name is simply invalid)", await poll(async () => (await page.getByRole("button", { name: /^Already exists · 7$/ }).count()) === 1), (await page.getByRole("group", { name: "Show rows" }).innerText()).replace(/\s+/g, " "));
  check("and no one was duplicated", (await sql`select count(*)::int n from users where email like 'zz-%'`)[0].n === usersBefore);

  await go("/administrator/users");
  await page.getByLabel("Filter by application").selectOption({ label: "ZZ App Uno" }); await page.waitForURL(/app=/);
  await page.waitForFunction(() => /\d+ (?:people|person) match/.test(document.querySelector("main")?.innerText ?? ""), null, { timeout: 15000 }).catch(() => {});
  const ft = (await main()).toLowerCase(); check("filtering the directory by application shows only people who hold it", ft.includes("asha patil") && !ft.includes("line"));
  await go("/administrator/users?status=pending"); check("the 'Pending invitation' filter lists people who have not chosen their own password yet", (await main()).toLowerCase().includes("asha patil") && /Pending invitation/i.test(await main()));

  section("6. Access: the profile, per app, templates, department Users tab");
  await go("/administrator/users/" + asha.id);
  const tree = page.locator("main");
  check("a person's page shows their overview, account, access and history on one screen", /User overview/i.test(await main()) && /Application access/i.test(await main()) && /Account/.test(await main()) && /Recently opened/i.test(await main()));
  const switches = await tree.getByRole("switch").count(); check("the profile shows an on/off switch per application", switches > 0, switches + " switches");
  check("the switches include inactive apps too", (await tree.getByRole("switch", { name: /access to ZZ Hidden App$/ }).count()) === 1);
  await tree.getByRole("switch", { name: "Give access to ZZ Hidden App" }).click(); await page.getByRole("button", { name: "Save access" }).click(); check("save access shows a success message", await toast("Access saved")); await page.waitForTimeout(1000);
  check("access grant saved to the database", (await sql`select count(*)::int n from user_app_access where user_id=${asha.id}`)[0].n === 2);
  await page.getByRole("button", { name: "Remove all", exact: true }).click(); await page.getByRole("button", { name: "Save access" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save changes" }).click();
  await toast("Access saved"); await page.waitForTimeout(1000);
  check("Remove all + save (confirmed, since access is taken away) removes every grant", await poll(async () => (await sql`select count(*)::int n from user_app_access where user_id=${asha.id}`)[0].n === 0));
  await go("/administrator/access/app/" + (await app("ZZ App Uno")).id); check("per-app access page opens", /Users with access|ZZ App Uno/.test(await main()));
  await go("/administrator/departments"); await page.locator("main").getByRole("link", { name: "ZZ Dept A2" }).click(); await page.waitForURL(/departments\//);
  const dut = (await main()).toLowerCase(); check("an application category's page has only an Applications tab (people sit in organisation departments, not in categories) and lists its applications", (await page.getByRole("tab").allInnerTexts()).map((t) => t.replace(/\s*\d+$/, "").trim()).join("|") === "Applications" && dut.includes("zz app uno"), (await page.getByRole("tab").allInnerTexts()).join("|"));

  section("7. Activity log and CSV export");
  await go("/administrator/activity"); const at = await main(); check("activity page lists the launches", at.includes("ZZ App Uno") && /launch/i.test(at));
  const ex = await page.request.get(BASE + "/administrator/activity/export"); const exTxt = await ex.text();
  check("export is a CSV download", ex.status() === 200 && (ex.headers()["content-type"] || "").includes("text/csv") && (ex.headers()["content-disposition"] || "").includes("attachment"), ex.headers()["content-disposition"]);
  check("export has the header row and the launch rows", exTxt.startsWith("User,Email,Action,Application,Department") && exTxt.includes("ZZ App Uno"));
  check("export neutralises formula injection ('=' cell is prefixed)", /(^|,)"?'=HYPERLINK/m.test(exTxt) && !/(^|,)=HYPERLINK/m.test(exTxt), (exTxt.match(/.*HYPERLINK.*/) || [""])[0]);
  const exF = await page.request.get(BASE + "/administrator/activity/export?action=launch"); check("export honours filters", exF.status() === 200);

  section("8. Notifications and navigation");
  await go("/administrator/notifications"); check("notifications panel renders", (await main()).includes("Notification Panel"));
  await go("/administrator"); const dash = (await main()).toLowerCase(); check("/administrator is the dashboard, with real counts for people and applications", page.url().endsWith("/administrator") && ["total users", "active users", "inactive users", "applications", "pending invitation", "under testing", "unavailable"].every((t) => dash.includes(t)) && /\d/.test(dash), page.url());
  const bad = await page.goto(BASE + "/administrator/departments/not-a-uuid"); check("bad department id shows the not-found page", /Page not found/i.test(await html(page)), bad.status());
  const bad2 = await page.goto(BASE + "/administrator/departments/00000000-0000-4000-8000-000000000000"); check("unknown department id shows the not-found page", /Page not found/i.test(await html(page)), bad2.status());
  const bad3 = await page.goto(BASE + "/administrator/access/user/not-a-uuid"); check("bad user id on access page is a 404", bad3.status() === 404 || bad3.status() === 200 && /not found/i.test(await html(page)), bad3.status());


  section("8b. Access: templates, the assign-applications dialog, per-application editor, tick-all");
  const uno = await app("ZZ App Uno");
  const grants = async (email) => (await sql`select a.name from user_app_access g join apps a on a.id=g.app_id join users us on us.id=g.user_id where us.email=${email} order by a.name`).map((r) => r.name).join(",");
  await go("/administrator/access");
  const tabTexts = (await page.locator("nav[aria-label='Access sections'] button").allInnerTexts()).map((s) => s.trim());
  check("the access page offers its two views (people's own access is changed in Users)", ["By application", "Templates"].every((x) => tabTexts.includes(x)) && tabTexts.length === 2 && /open Users/.test(await main()), `${page.url()} | ${tabTexts.join(" | ")}`);
  await page.getByRole("button", { name: "Templates" }).click(); await page.getByRole("button", { name: /New template/ }).click();
  const tm = page.locator("form").filter({ has: page.getByRole("button", { name: "Save template" }) });
  await tm.getByPlaceholder("e.g. Finance Staff").fill("ZZ Template");
  await tm.locator("label", { hasText: "ZZ App Uno" }).getByRole("checkbox").check(); await tm.getByRole("button", { name: "Save template" }).click();
  check("creating a template shows a success message", await toast("Template saved")); await page.waitForTimeout(1500);
  const tpl = (await sql`select id from access_templates where name='ZZ Template'`)[0];
  check("template saved with its application", !!tpl && (await sql`select count(*)::int n from access_template_apps where template_id=${tpl.id}`)[0].n === 1);
  await page.locator("tr", { hasText: "ZZ Template" }).getByRole("button", { name: "Edit" }).click();
  const te = page.locator("form").filter({ has: page.getByRole("button", { name: "Save template" }) });
  await te.locator("label", { hasText: "ZZ Hidden App" }).getByRole("checkbox").check(); await te.getByRole("button", { name: "Save template" }).click(); await page.waitForTimeout(2500);
  check("editing a template updates its applications", (await sql`select count(*)::int n from access_template_apps where template_id=${tpl.id}`)[0].n === 2);

  // The assign-applications dialog: choose who and what, review, confirm, see the result.
  await go("/administrator/users?q=zz-");
  await page.getByLabel("Select Asha Patil").check(); await page.getByLabel("Select Mixed Case").check();
  const bar = page.getByRole("region", { name: "Actions for the selected people" });
  const dlg = page.getByRole("dialog", { name: "Assign applications" });
  const both = async () => [await grants("zz-asha@gmail.com"), await grants("zz-up@gmail.com")];
  const assign = async ({ template, ticks = [], untick = [], mode, confirmName }) => {
    await bar.getByRole("button", { name: "Assign applications" }).click();
    if (template) await dlg.getByLabel("Start from a template").selectOption({ label: template });
    for (const t of untick) await dlg.locator("label", { hasText: t }).getByRole("checkbox").uncheck();
    for (const t of ticks) await dlg.locator("label", { hasText: t }).getByRole("checkbox").check();
    await dlg.getByLabel(mode.label).check();
    await dlg.getByRole("button", { name: "Review changes" }).click();
    await dlg.getByRole("button", { name: confirmName }).click();
    await dlg.getByText(/Saved\. \d+ (people|person) changed/).waitFor({ timeout: 20000 });
    const result = await dlg.innerText(); await dlg.getByRole("button", { name: "Done", exact: true }).click(); return result;
  };
  await bar.getByRole("button", { name: "Assign applications" }).click();
  check("the dialog shows how many of the chosen people already have each application", await dlg.getByText("0 of 2 have it").first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false));
  await dlg.getByLabel("Start from a template").selectOption({ label: "ZZ Template (2)" });
  const beforeReview = await both();
  await dlg.getByLabel(/Add these applications/).check(); await dlg.getByRole("button", { name: "Review changes" }).click();
  await dlg.getByText(/people? will change/).waitFor({ timeout: 15000 });
  check("the review step lists who gets what before anything is saved", /2 of 2 people will change/.test(await dlg.innerText()) && /ZZ App Uno/.test(await dlg.innerText()) && JSON.stringify(await both()) === JSON.stringify(beforeReview), await dlg.innerText());
  await dlg.getByRole("button", { name: "Back" }).click(); await dlg.getByRole("button", { name: "Review changes" }).click();
  await dlg.getByRole("button", { name: /^Add for 2 people/ }).click(); await dlg.getByText(/Saved\. 2 people changed/).waitFor({ timeout: 20000 });
  check("the result says who changed and that it is recorded in the audit log", /Recorded in the audit log/.test(await dlg.innerText()));
  await dlg.getByRole("button", { name: "Done", exact: true }).click();
  let g = await both(); check("both users now hold the template's two apps", g[0] === "ZZ App Uno,ZZ Hidden App" && g[1] === g[0], g.join(" | "));
  await page.getByLabel("Select Asha Patil").check(); await page.getByLabel("Select Mixed Case").check();
  await assign({ template: "ZZ Template (2)", untick: ["ZZ App Uno"], mode: { label: /Remove these applications/ }, confirmName: /^Remove for 2 people/ });
  g = await both(); check("'remove' took only the ticked app away", g[0] === "ZZ App Uno" && g[1] === "ZZ App Uno", g.join(" | "));
  await page.getByLabel("Select Asha Patil").check(); await page.getByLabel("Select Mixed Case").check();
  await assign({ template: "ZZ Template (2)", untick: ["ZZ App Uno"], mode: { label: /Make their access exactly/ }, confirmName: /^Replace for 2 people/ });
  g = await both(); check("'replace' leaves exactly the ticked app", g[0] === "ZZ Hidden App" && g[1] === "ZZ Hidden App", g.join(" | "));
  await page.getByLabel("Select Asha Patil").check(); await page.getByLabel("Select Mixed Case").check();
  await assign({ template: "ZZ Template (2)", mode: { label: /Make their access exactly/ }, confirmName: /^Replace for 2 people/ });
  g = await both(); check("'replace' with a template gives exactly the template's apps", g[0] === "ZZ App Uno,ZZ Hidden App" && g[1] === g[0], g.join(" | "));
  await page.getByLabel("Select Asha Patil").check();
  await bar.getByRole("button", { name: "Assign applications" }).click(); await dlg.getByLabel("Start from a template").selectOption({ label: "ZZ Template (2)" });
  await dlg.getByLabel(/Add these applications/).check(); await dlg.getByRole("button", { name: "Review changes" }).click();
  await dlg.getByText(/Nothing to change/).waitFor({ timeout: 15000 }).catch(() => {});
  check("when nothing would change the review says so and the confirm button is disabled", /Nothing to change/.test(await dlg.innerText()) && (await dlg.getByRole("button", { name: /^Add for/ }).isDisabled()), await dlg.innerText());
  await dlg.getByRole("button", { name: "Cancel" }).or(dlg.getByRole("button", { name: "Back" })).first().click(); await page.keyboard.press("Escape");
  const audited = (await sql`select count(*)::int n from access_audit where action = 'access.change' and target_label in ('Asha Patil', 'Mixed Case')`)[0].n;
  check("every change was recorded in the audit log, per person", audited >= 8, audited);
  await go("/administrator/users/audit?q=Asha");
  check("the audit log page shows who changed whose access, and what", /access\.change/.test(await main()) && /Added: ZZ App Uno/.test(await main()) && /Removed:/.test(await main()));
  await go("/administrator/access"); await page.getByRole("button", { name: "Templates" }).click();
  await page.locator("tr", { hasText: "ZZ Template" }).getByRole("button", { name: "Delete" }).click(); await page.getByRole("button", { name: "Delete", exact: true }).last().click();
  check("deleting a template shows a success message", await toast("Template deleted")); await page.waitForTimeout(1500);
  check("template is gone but users keep their access", !(await sql`select 1 from access_templates where name='ZZ Template'`)[0] && (await both())[0] === "ZZ App Uno,ZZ Hidden App");

  await go("/administrator/access/app/" + uno.id);
  const arow = (email) => page.locator("tr", { hasText: email });
  check("per-app page shows who has access (Asha ticked, Line Break not)", (await arow("zz-asha@gmail.com").getByRole("checkbox").isChecked()) && !(await arow("zz-nl@gmail.com").getByRole("checkbox").isChecked()));
  await arow("zz-asha@gmail.com").getByRole("checkbox").uncheck(); await arow("zz-nl@gmail.com").getByRole("checkbox").check();
  check("unsaved changes are counted", (await main()).includes("+1 / −1 unsaved"));
  await page.getByRole("button", { name: "Save access" }).click(); check("per-app save shows how many were added and removed", await toast("1 added, 1 removed")); await page.waitForTimeout(1500);
  check("per-app save changed exactly those two users", !(await grants("zz-asha@gmail.com")).includes("ZZ App Uno") && (await grants("zz-nl@gmail.com")).includes("ZZ App Uno"));
  await arow("zz-formula@gmail.com").getByRole("checkbox").check(); await page.getByRole("button", { name: "Discard changes" }).click();
  check("discard changes undoes unsaved ticks", !(await arow("zz-formula@gmail.com").getByRole("checkbox").isChecked()));
  await page.getByLabel("Only users with access").check(); await page.waitForTimeout(300);
  const granted = (await sql`select count(*)::int n from user_app_access where app_id=${uno.id}`)[0].n;
  check("'Only users with access' shows just those users", (await page.locator("tbody tr").count()) === granted && (await page.locator("tbody input:checked").count()) === granted, granted);
  await page.getByLabel("Only users with access").uncheck();
  await page.getByPlaceholder("Search users").fill("zz-formula"); await page.getByRole("button", { name: "Tick all shown", exact: true }).click(); await page.getByPlaceholder("Search users").fill("");
  await page.getByRole("button", { name: "Save access" }).click(); await page.waitForTimeout(2500);
  check("'Tick all shown' with a search adds only the matching user", (await grants("zz-formula@gmail.com")).includes("ZZ App Uno") && (await sql`select count(*)::int n from user_app_access where app_id=${uno.id}`)[0].n === granted + 1);
  await page.getByPlaceholder("Search users").fill("zz-formula"); await page.getByRole("button", { name: "Untick all shown" }).click(); await page.getByPlaceholder("Search users").fill("");
  await page.getByRole("button", { name: "Save access" }).click(); await page.waitForTimeout(2500);
  check("'Untick all shown' removes only the matching user", !(await grants("zz-formula@gmail.com")).includes("ZZ App Uno") && (await sql`select count(*)::int n from user_app_access where app_id=${uno.id}`)[0].n === granted);

  const dupU = await u("zz-dup@gmail.com"); await go("/administrator/access/user/" + dupU.id);
  check("the old per-person access address opens the person's page", new URL(page.url()).pathname === "/administrator/users/" + dupU.id);
  const panel = page.locator("main div.overflow-hidden", { hasText: "ZZ Dept A2" }).first();
  await panel.getByRole("button", { name: "All on", exact: true }).click();
  const on = async (n) => (await page.getByRole("switch", { name: new RegExp(`access to ${n}`) }).first().getAttribute("aria-checked")) === "true";
  check("All on in a category switches on every one of its applications", (await on("ZZ App Uno")) && (await on("ZZ Hidden App")) && (await on("=HYPERLINK")));
  await page.getByRole("switch", { name: "Remove access to ZZ Hidden App" }).click();
  check("the category says how many are on", /4 applications · 3 enabled/.test(await panel.innerText()), (await panel.innerText()).replace(/\s+/g, " ").slice(0, 120));
  await page.getByRole("button", { name: "Save access" }).click(); await toast("Access saved"); await page.waitForTimeout(1500);
  check("the partial selection is saved (3 of the category's 4 apps)", (await sql`select count(*)::int n from user_app_access where user_id=${dupU.id}`)[0].n === 3);

  section("8c. Icon pickers (department and application forms)");
  await go("/administrator/departments"); await page.locator("tr", { hasText: "ZZ Dept A2" }).getByRole("button", { name: "Edit" }).click();
  const ie = page.locator("form").filter({ has: page.getByRole("button", { name: "Save" }) });
  await ie.getByPlaceholder("Search icons").fill("wallet"); await page.waitForTimeout(300);
  const opts = ie.getByRole("option"); const titles = await opts.evaluateAll((els) => els.map((e) => e.title.toLowerCase()));
  check("icon search narrows the list to matching icons", titles.length >= 1 && titles.length <= 4 && titles.every((x) => x.includes("wallet")), titles.join(","));
  await ie.getByPlaceholder("Search icons").fill("zzqqx"); check("an icon search with no match says so", (await ie.innerText()).includes("No icons match"));
  await ie.getByPlaceholder("Search icons").fill("wallet"); await opts.first().click();
  check("the clicked icon is marked selected", (await opts.first().getAttribute("aria-selected")) === "true");
  await ie.getByRole("button", { name: "Save" }).click(); await toast("Application category saved"); await page.waitForTimeout(1500);
  check("department icon saved", (await dep("ZZ Dept A2")).icon === "Wallet", (await dep("ZZ Dept A2")).icon);
  await page.goto(deptUrl); await page.waitForLoadState("networkidle").catch(() => {});
  await page.locator("tr", { hasText: "ZZ App Uno" }).getByRole("button", { name: "Edit" }).click();
  const ia = page.locator("form").filter({ has: page.getByRole("button", { name: "Save" }) });
  await ia.getByPlaceholder("Search icons").fill("globe"); await ia.getByRole("option").first().click(); await ia.getByRole("button", { name: "Save" }).click(); await toast("Application saved"); await page.waitForTimeout(1500);
  check("application icon saved", (await app("ZZ App Uno")).icon === "Globe", (await app("ZZ App Uno")).icon);

  section("8d. Accounts: sign-in, per-user access, deactivation, passwords, the Administrator lock");
  const unoApp = await app("ZZ App Uno"), hidApp = await app("ZZ Hidden App");
  await sql`delete from user_app_access where user_id=${asha.id}`; await sql`insert into user_app_access (user_id, app_id) values (${asha.id}, ${unoApp.id})`;
  const ashaPw = "Asha-pass-12345"; const ashaEmail = "zz-asha@gmail.com";
  // Asha was created by bulk add and sent a temporary password: she signs in with it and must choose her own first.
  const sc = await browser.newContext(); const sp = await sc.newPage();
  await signIn(sp, ashaEmail, ashaTemp); await sp.waitForURL(/change-password/, { timeout: 20000 }).catch(() => {});
  check("the temporary password signs her in straight to choosing her own", new URL(sp.url()).pathname === "/change-password", sp.url());
  const cpOn = async (pg, cur, nw, again) => { await pg.locator("input[autocomplete=current-password]").fill(cur); await pg.locator("input[autocomplete=new-password]").nth(0).fill(nw); await pg.locator("input[autocomplete=new-password]").nth(1).fill(again); await pg.getByRole("button", { name: "Save password" }).click(); await pg.waitForTimeout(2500); };
  await cpOn(sp, ashaTemp, "abcdefghijkl", "abcdefghijkl"); check("a weak password is refused", /one letter and one number/.test(await html(sp)));
  await cpOn(sp, ashaTemp, ashaPw, "Different-pass-9"); check("two different passwords are refused", /do not match/.test(await html(sp)));
  await cpOn(sp, ashaTemp, ashaPw, ashaPw); check("a good password is saved, with a confirmation", /Password changed/.test(await html(sp)));
  await sc.close();
  const tc = await browser.newContext(); const tp = await tc.newPage(); await signIn(tp, ashaEmail, ashaTemp);
  check("the temporary password no longer works", new URL(tp.url()).pathname === "/login"); await tc.close();
  const ac = await browser.newContext({ viewport: { width: 1300, height: 1000 } }); const ap = await ac.newPage();
  await signIn(ap, ashaEmail, ashaPw);
  check("after choosing her own password she signs in with it", new URL(ap.url()).pathname === "/", ap.url());
  const hubText = await ap.locator("main").innerText();
  check("the hub shows only the applications assigned to her", hubText.includes("ZZ App Uno") && !hubText.includes("ZZ Hidden App") && !hubText.includes("<img"), hubText.slice(0, 120));
  check("no Administrator card for a normal user", !/\bAdministrator\b/.test(hubText));
  check("launching an application they were not given is a 404", (await ap.request.get(BASE + "/go/" + hidApp.id, { maxRedirects: 0 })).status() === 404);
  check("launching their own application works", (await ap.request.get(BASE + "/go/" + unoApp.id, { maxRedirects: 0 })).status() === 302);
  await ap.goto(BASE + "/administrator/users"); await ap.waitForLoadState("networkidle").catch(() => {});
  check("a normal user who opens Administrator is sent back to the hub", new URL(ap.url()).pathname === "/", ap.url());
  await page.goto(BASE + "/administrator/users");
  const adminUnlock = (await ctx.cookies()).find((c) => c.name === "hub_admin");
  check("the admin unlock cookie exists while Administrator is open", !!adminUnlock && adminUnlock.httpOnly);
  if (adminUnlock) await ac.addCookies([{ name: adminUnlock.name, value: adminUnlock.value, url: BASE }]);
  await ap.goto(BASE + "/administrator/users"); await ap.waitForLoadState("networkidle").catch(() => {});
  check("someone else's unlock cookie does not open Administrator for a normal user", new URL(ap.url()).pathname === "/", ap.url());

  const guesser = await browser.newContext({ extraHTTPHeaders: { "x-vercel-forwarded-for": "198.51.100.24" } }); const gp = await guesser.newPage();
  for (let i = 0; i < 6; i++) await signIn(gp, ashaEmail, "Wrong-guess-" + i + "xx");
  await signIn(gp, ashaEmail, ashaPw);
  check("six wrong passwords from one address stop that address for a while, even with the right password", new URL(gp.url()).pathname === "/login", gp.url());
  await guesser.close();
  const owner = await browser.newContext(); const op = await owner.newPage(); await signIn(op, ashaEmail, ashaPw);
  check("but they never lock the person out: from their own address the right password works", new URL(op.url()).pathname === "/", op.url());
  await owner.close();

  // admin: create a user by hand
  await page.goto(BASE + "/administrator/users"); await page.getByRole("button", { name: /^Add user/ }).click();
  const uf = page.locator("form").filter({ has: page.getByRole("button", { name: "Create user" }) });
  await uf.getByLabel(/I will set a password for them/).check();
  const submitUser = async (name, email) => { await uf.locator("input").nth(0).fill(name); await uf.locator("input[type=email]").fill(email); await uf.getByRole("button", { name: "Create user" }).click(); };
  const typedPw = await uf.locator("input.font-mono").inputValue();
  await submitUser("ZZ By Hand", "zz-ui@gmail.com"); check("Add user shows a success message", await toast("User created")); await page.waitForTimeout(1500);
  const ui = (await sql`select password_hash, status, role, is_active from users where email='zz-ui@gmail.com'`)[0];
  check("the new account is stored with a hashed password, never the password itself", !!ui && ui.password_hash.startsWith("scrypt$") && !ui.password_hash.includes(typedPw) && ui.role === "member" && ui.status === "approved");
  const uc = await browser.newContext(); const up = await uc.newPage(); await signIn(up, "zz-ui@gmail.com", typedPw);
  check("the hand-made user can sign in with that password", new URL(up.url()).pathname === "/", up.url()); await uc.close();
  // by default a new person gets a temporary password instead: no one types a password for them
  await page.reload(); await page.getByRole("button", { name: /^Add user/ }).click();
  await submitUser("ZZ Invited", "zz-invited@gmail.com");
  const invDlg = page.getByRole("dialog", { name: "Sign-in details" });
  check("adding someone without choosing a password makes a temporary password and shows it once", await invDlg.getByLabel("Temporary password for ZZ Invited").waitFor({ timeout: 15000 }).then(() => true).catch(() => false));
  const invTemp = await invDlg.getByLabel("Temporary password for ZZ Invited").inputValue(); await invDlg.getByRole("button", { name: "Done", exact: true }).click();
  const inv = (await sql`select password_hash, must_change_password from users where email='zz-invited@gmail.com'`)[0];
  check("that account holds only a scrambled temporary password, which must be changed", !!inv && inv.password_hash.startsWith("scrypt$") && inv.must_change_password === true);
  const ic = await browser.newContext(); const ip = await ic.newPage(); await signIn(ip, "zz-invited@gmail.com", invTemp); await ip.waitForURL(/change-password/, { timeout: 20000 }).catch(() => {});
  await cpOn(ip, invTemp, "Invited-pass-12345", "Invited-pass-12345"); await ic.close();
  const ic2 = await browser.newContext(); const ip2 = await ic2.newPage();
  await signIn(ip2, "zz-invited@gmail.com", "Invited-pass-12345"); check("and they choose their own password with it, then sign in", new URL(ip2.url()).pathname === "/", ip2.url()); await ic2.close();
  await page.reload(); await page.getByRole("button", { name: /^Add user/ }).click();
  await submitUser("ZZ Dup", "zz-ui@gmail.com"); check("a duplicate email is refused", await toast("already has an account")); await page.waitForTimeout(800);
  await page.reload(); await page.getByRole("button", { name: /^Add user/ }).click();
  await submitUser("ZZ Bad Domain", "zz-bad2@yahoo.com"); check("an email outside the allowed domains is refused", await toast("must end with")); await page.waitForTimeout(800);

  // admin: deactivate / reactivate
  const userPage = async (e) => { await page.goto(BASE + "/administrator/users?q=" + encodeURIComponent(e)); await page.waitForLoadState("networkidle").catch(() => {}); await page.locator("tr", { hasText: e }).first().waitFor({ timeout: 15000 }); };
  await userPage(ashaEmail);
  const urow = (e) => page.locator("tr", { hasText: e });
  await urow(ashaEmail).getByRole("button", { name: "Active", exact: true }).click();
  check("deactivating asks for confirmation first and explains what happens", /signed out at once/.test(await page.locator("body").innerText()));
  await page.getByRole("button", { name: "Deactivate", exact: true }).click(); await toast("deactivated"); await page.waitForTimeout(1200);
  check("deactivating saves", (await sql`select is_active from users where email=${ashaEmail}`)[0].is_active === false);
  await ap.goto(BASE + "/"); check("a deactivated user is signed out on their very next click", new URL(ap.url()).pathname === "/login", ap.url());
  const blocked = await browser.newContext(); const bp = await blocked.newPage(); await signIn(bp, ashaEmail, ashaPw);
  check("a deactivated user cannot sign in", new URL(bp.url()).pathname === "/login" && /Incorrect email or password/.test(await html(bp))); await blocked.close();
  await userPage(ashaEmail);
  await urow(ashaEmail).getByRole("button", { name: "Inactive", exact: true }).click(); await toast("activated"); await page.waitForTimeout(1200);
  await ap.goto(BASE + "/"); if (new URL(ap.url()).pathname !== "/") await signIn(ap, ashaEmail, ashaPw);
  check("reactivating lets them back in", new URL(ap.url()).pathname === "/", ap.url());

  // admin: reset password
  const ashaNew = "Asha-new-pass-777";
  await urow(ashaEmail).getByRole("button", { name: /^Reset password for/ }).click();
  const rf = page.locator("form").filter({ has: page.getByRole("button", { name: "Reset password", exact: true }) }); await rf.locator("input.font-mono").fill(ashaNew); await rf.getByRole("button", { name: "Reset password", exact: true }).click();
  check("reset password shows a success message", await toast("Password reset")); await page.waitForTimeout(1500);
  await ap.goto(BASE + "/"); check("a password reset signs the person out everywhere", new URL(ap.url()).pathname === "/login", ap.url());
  await signIn(ap, ashaEmail, ashaPw); check("the old password no longer works", new URL(ap.url()).pathname === "/login");
  await signIn(ap, ashaEmail, ashaNew); check("the new password works", new URL(ap.url()).pathname === "/", ap.url());

  // user: change own password, sign out
  await ap.goto(BASE + "/change-password");
  const cp = async (cur, nw, again) => { await ap.locator("input[autocomplete=current-password]").fill(cur); await ap.locator("input[autocomplete=new-password]").nth(0).fill(nw); await ap.locator("input[autocomplete=new-password]").nth(1).fill(again); await ap.getByRole("button", { name: "Save password" }).click(); await ap.waitForTimeout(2500); };
  await cp("Totally-wrong-1", "Asha-third-pass-9", "Asha-third-pass-9"); check("a wrong current password is refused", /Current password is incorrect/.test(await html(ap)));
  await cp(ashaNew, "Asha-third-pass-9", "Different-pass-9"); check("mismatched new passwords are refused", /do not match/.test(await html(ap)));
  await cp(ashaNew, "abcdefghijkl", "abcdefghijkl"); check("a weak new password is refused", /one letter and one number/.test(await html(ap)));
  await cp(ashaNew, "Asha-third-pass-9", "Asha-third-pass-9"); check("changing the password works", /Password changed/.test(await html(ap)));
  await ap.goto(BASE + "/"); check("they stay signed in on this browser after changing it", new URL(ap.url()).pathname === "/", ap.url());
  await ap.locator("header").first().getByRole("button", { name: /Asha Patil/ }).click(); await ap.getByRole("button", { name: "Sign out" }).click(); await ap.waitForURL("**/login", { timeout: 20000 }).catch(() => {});
  check("Sign out returns to the login page", new URL(ap.url()).pathname === "/login", ap.url());
  await ap.goto(BASE + "/"); check("after signing out the hub is closed again", new URL(ap.url()).pathname === "/login");
  await signIn(ap, ashaEmail, ashaNew); check("the previous password no longer works after a change", new URL(ap.url()).pathname === "/login");
  // This run has typed several deliberate wrong passwords for Asha from this address by now, which would reach the sign-in limit (5 in
  // 15 minutes) and refuse even the right one: they are cleared so the next check tests the password change, not the limit.
  await sql`delete from login_attempts where email = ${ashaEmail}`;
  await signIn(ap, ashaEmail, "Asha-third-pass-9"); check("the changed password signs in", new URL(ap.url()).pathname === "/", ap.url());
  await ac.close();

  // main admin protections
  await userPage(ADMIN_EMAIL);
  const mrow = urow(ADMIN_EMAIL);
  check("the main admin has no Reset password button", (await mrow.getByRole("button", { name: /^Reset password for/ }).count()) === 0);
  check("the main admin cannot be deactivated from the screen (no button to press)", (await mrow.getByRole("button", { name: "Active", exact: true }).count()) === 0 && (await mrow.getByText("Active", { exact: true }).count()) >= 1);
  await page.goto(BASE + "/change-password"); check("the main admin is told the password lives in the settings", /environment settings/.test(await html(page)));

  // the Administrator lock
  await page.goto(BASE + "/administrator/users"); await page.waitForTimeout(3500);
  await page.reload(); await page.waitForLoadState("networkidle").catch(() => {});
  check("background prefetching of other pages does not lock Administrator", new URL(page.url()).pathname === "/administrator/users", page.url());
  await rawGoto(BASE + "/"); await page.waitForLoadState("networkidle").catch(() => {}); // leave Administrator for the hub
  await rawGoto(BASE + "/administrator/users"); await page.waitForURL((u) => /unlock|administrator\/users/.test(u.pathname), { timeout: 20000 }).catch(() => {});
  check("after leaving Administrator, going back asks for the password again", new URL(page.url()).pathname === "/unlock", page.url());
  check("the unlock page remembers where you were going", new URL(page.url()).searchParams.get("next") === "/administrator/users");
  await page.locator("input[name=password]").fill("not-the-password-1"); await page.getByRole("button", { name: "Unlock" }).click(); await page.waitForTimeout(2000);
  check("a wrong unlock password is refused and stays locked", new URL(page.url()).pathname === "/unlock" && /Incorrect password/.test(await html(page)));
  await unlockIf(page); check("the right password opens it at the page you asked for", new URL(page.url()).pathname === "/administrator/users", page.url());
  const exportAfterLeave = await (async () => { await page.goto(BASE + "/"); return page.request.get(BASE + "/administrator/activity/export", { maxRedirects: 0 }); })();
  check("once locked, even the CSV export is closed", exportAfterLeave.status() >= 300 && exportAfterLeave.status() < 400, exportAfterLeave.status());

  section("8e. Deleting an application and a user");
  // an application that people hold, with a launch in the history
  const delApp = await app("ZZ Hidden App");
  await sql`insert into user_app_access (user_id, app_id) values (${asha.id}, ${delApp.id}) on conflict do nothing`;
  const [histApp] = await sql`insert into activity_log (user_id, app_id, department_id, action, ip_address) values (${asha.id}, ${delApp.id}, ${dA.id}, 'launch', 'zz-test') returning id`;
  await page.goto(deptUrl); await page.waitForLoadState("networkidle").catch(() => {});
  await page.locator("tr", { hasText: "ZZ Hidden App" }).getByRole("button", { name: "Delete ZZ Hidden App" }).click();
  check("the confirmation says what will happen", /removed for good/.test(await page.locator("body").innerText()));
  await page.getByRole("button", { name: "Cancel" }).click(); await page.waitForTimeout(600);
  check("Cancel keeps the application", !!(await app("ZZ Hidden App")));
  await page.locator("tr", { hasText: "ZZ Hidden App" }).getByRole("button", { name: "Delete ZZ Hidden App" }).click(); await page.getByRole("button", { name: "Delete", exact: true }).click();
  check("deleting an application shows a success message", await toast("Application deleted")); await page.waitForTimeout(1500);
  check("the application is gone", !(await app("ZZ Hidden App")));
  check("nobody keeps access to it", (await sql`select count(*)::int n from user_app_access where app_id=${delApp.id}`)[0].n === 0);
  const keptApp = (await sql`select app_id, user_id from activity_log where id=${histApp.id}`)[0];
  check("its launch history stays, now pointing at no application", !!keptApp && keptApp.app_id === null && keptApp.user_id === asha.id);
  await page.reload(); await page.waitForLoadState("networkidle").catch(() => {});
  check("it disappears from the department's list", !(await page.locator("main").innerText()).includes("ZZ Hidden App"));

  // a person who is signed in right now, with access and history
  const nl = await u("zz-nl@gmail.com");
  const [histUser] = await sql`insert into activity_log (user_id, app_id, department_id, action, ip_address) values (${nl.id}, ${(await app("ZZ App Uno")).id}, ${dA.id}, 'launch', 'zz-test') returning id`;
  await setPassword("zz-nl@gmail.com", "Newline-pass-123");
  const nlc = await browser.newContext(); const nlp = await nlc.newPage(); await signIn(nlp, "zz-nl@gmail.com", "Newline-pass-123");
  check("the person to be deleted is signed in", new URL(nlp.url()).pathname === "/", nlp.url());
  await userPage("zz-nl@gmail.com");
  const nlRow = page.locator("tr", { hasText: "zz-nl@gmail.com" });
  await nlRow.getByRole("button", { name: /^Delete / }).click();
  check("the user confirmation names the person and offers deactivating instead", /zz-nl@gmail.com/.test(await page.locator("body").innerText()) && /deactivate/i.test(await page.locator("body").innerText()));
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  check("deleting a user shows a success message", await toast("User deleted")); await page.waitForTimeout(1500);
  check("the account is gone", !(await u("zz-nl@gmail.com")));
  check("their access grants are gone", (await sql`select count(*)::int n from user_app_access where user_id=${nl.id}`)[0].n === 0);
  const keptUser = (await sql`select user_id, app_id from activity_log where id=${histUser.id}`)[0];
  check("their activity stays in the history, now without a person", !!keptUser && keptUser.user_id === null && !!keptUser.app_id);
  await nlp.goto(BASE + "/"); await nlp.waitForLoadState("networkidle").catch(() => {});
  check("their open session stops working at once", new URL(nlp.url()).pathname === "/login", nlp.url()); await nlc.close();
  const nlAgain = await browser.newContext(); const nla = await nlAgain.newPage(); await signIn(nla, "zz-nl@gmail.com", "Newline-pass-123");
  check("and they cannot sign in again", new URL(nla.url()).pathname === "/login"); await nlAgain.close();
  await userPage(ADMIN_EMAIL);
  check("the main admin has no Delete button", (await page.locator("tr", { hasText: ADMIN_EMAIL }).getByRole("button", { name: /^Delete / }).count()) === 0);
  await sql`delete from activity_log where id in (${histApp.id}, ${histUser.id})`;

  await page.goto(BASE + "/administrator/departments");
  section("9. Phone-sized screen");
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, ...(BROWSER === "firefox" ? {} : { isMobile: true, hasTouch: true }) }); const mp = await m.newPage(); await m.addCookies(await ctx.cookies());
  const mErr = []; mp.on("pageerror", (e) => mErr.push(String(e).slice(0, 120)));
  const noOverflow = async (p, label) => { const pg = await m.newPage(); pg.on("pageerror", (e) => mErr.push(String(e).slice(0, 120))); await pg.goto(BASE + p); await unlockIf(pg); await pg.waitForLoadState("networkidle").catch(() => {}); const o = await pg.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })); check("no sideways page scroll on " + label, o.sw <= o.iw + 1, `${o.sw} vs ${o.iw}`); await pg.close(); };
  await mp.goto(BASE + "/administrator"); await unlockIf(mp); await mp.waitForLoadState("networkidle").catch(() => {});
  const navVisible = async () => mp.locator('nav[aria-label="Administrator"] a', { hasText: "Users" }).first().isVisible();
  check("on a phone, Administrator's sections are folded behind a Menu button", !(await navVisible()) && (await mp.getByRole("button", { name: /Administrator menu/ }).count()) === 1);
  await mp.getByRole("button", { name: /Administrator menu/ }).click(); await mp.waitForTimeout(400);
  check("the Menu button opens the list of sections", await navVisible());
  await mp.locator('nav[aria-label="Administrator"] a', { hasText: "Users" }).first().click(); await mp.waitForURL("**/administrator/users"); await mp.waitForLoadState("networkidle").catch(() => {}); check("tapping a section navigates", mp.url().endsWith("/administrator/users"), mp.url());
  for (const [p, l] of [["/", "home"], ["/administrator", "dashboard"], ["/administrator/departments", "departments"], ["/administrator/users", "users and access"], ["/administrator/users/import", "bulk add"], ["/administrator/users/org", "branches and teams"], ["/administrator/users/audit", "audit log"], ["/administrator/inventory", "application inventory"], ["/administrator/access", "access"], ["/administrator/activity", "activity"], ["/administrator/notifications", "notifications"], [deptUrl.replace(BASE, ""), "department detail"]]) await noOverflow(p, l);
  check("no script errors on the phone layout", mErr.length === 0, mErr.join(" | "));
  await m.close();

  section("10. Speed and browser health");
  const times = []; for (let i = 0; i < 3; i++) { const t = Date.now(); await page.request.get(BASE + "/"); times.push(Date.now() - t); } times.sort((a, b) => a - b);
  check("home page responds in under 3 seconds (median of 3)", times[1] < 3000, times.join("ms, ") + "ms");
  // WebKit reports page loads that the test itself cancelled by navigating away ("Load failed", chunk or prefetch fetches) as errors.
  // A calm walk through the same pages shows none, so only WebKit gets this allowance.
  const benign = BROWSER === "webkit" ? /Load failed|ChunkLoadError|Fetch API cannot load/i : /(?!)/;
  const real = consoleErrors.filter((e) => !/favicon|Failed to load resource.*(404|40\d)/i.test(e) && !benign.test(e)); const realPage = pageErrors.filter((e) => !benign.test(e));
  check("no JavaScript errors in the browser console", real.length === 0 && realPage.length === 0, real.concat(realPage).join(" | "));
  check("no alert/confirm dialogs were ever triggered", dialogs.length === 0, dialogs.join(","));
} catch (e) { console.log("\nTEST ERROR:", String(e).split("\n").slice(0, 3).join(" | ")); res.push(["test crashed", false]); } finally {
  await browser.close();
  section("Cleanup and data-safety check");
  await retry(async () => {
    await removeTestData();
    // The activity this run caused: sign-ins and launches by the main admin from this machine's address, since the run began.
    const [row] = await sql`select l.ip_address ip from activity_log l join users u on u.id = l.user_id where u.email = ${ADMIN_EMAIL} and l.action = 'login' and l.opened_at >= ${new Date(startedAt.getTime() - 60000)} order by l.opened_at desc limit 1`;
    if (row) await sql`delete from activity_log where action in ('login','launch') and opened_at >= ${new Date(startedAt.getTime() - 60000)} and ip_address is not distinct from ${row.ip} and user_id = (select id from users where email = ${ADMIN_EMAIL})`;
    await sql`delete from activity_log where action = 'launch' and app_id is null and opened_at >= ${new Date(startedAt.getTime() - 60000)}`;
    // Sign-ins of test users the run deleted lose their person (the history is kept), so they are matched by time instead.
    await sql`delete from activity_log where action = 'login' and user_id is null and opened_at >= ${new Date(startedAt.getTime() - 60000)}`;
  });
  const after = await retry(snap);
  check("your real departments, apps and users are exactly as before", JSON.stringify(before) === JSON.stringify(after), JSON.stringify(before) === JSON.stringify(after) ? "" : "DIFFERENT");
  const left = (await retry(() => sql`select (select count(*) from users where email like 'zz-%') u,(select count(*) from apps where name like 'ZZ%' or name like '<img%' or name like '=HYPERLINK%') a,(select count(*) from departments where name like 'ZZ%') d`))[0];
  check("all test data removed", left.u == 0 && left.a == 0 && left.d == 0, JSON.stringify(left));
  const failed = res.filter(([, ok]) => !ok); console.log(`\n${res.length - failed.length}/${res.length} checks passed`); if (failed.length) console.log("FAILED:\n - " + failed.map(([n]) => n).join("\n - "));
  fs.rmSync(SP, { recursive: true, force: true });
  process.exit(failed.length ? 1 : 0);
}
