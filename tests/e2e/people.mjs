/**
 * End-to-end test of Users & Access in a real browser: branches and teams, editing a person, the team manager's limited view, application
 * labels and checks, bulk add from Excel, temporary passwords from a person's page, the audit log, and basic accessibility. Run:
 *   E2E_BASE_URL=http://localhost:3000 npm run test:e2e:people
 *
 * It WRITES to the database the site uses, but only rows named "ZZP"/"zzp-": a department with four applications, a few people and a
 * branch and team or two. Everything is removed when it finishes (and at the start, if an earlier run was interrupted), including the
 * audit entries this run caused. The environment must allow gmail.com addresses (ALLOWED_EMAIL_DOMAIN empty or including gmail.com).
 * Env: E2E_BROWSER = chromium (default) | firefox | webkit, E2E_CHROME_CHANNEL (default "chrome").
 */
import { createRequire } from "node:module";
import { randomBytes, scryptSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const req = createRequire(ROOT + "/package.json");
req("dotenv").config({ path: ROOT + "/.env.local", quiet: true });
req("dotenv").config({ path: ROOT + "/.env", quiet: true });
const BASE = (process.env.E2E_BASE_URL || "").replace(/\/$/, "");
if (!BASE) { console.error("Set E2E_BASE_URL, for example: E2E_BASE_URL=http://localhost:3000 npm run test:e2e:people"); process.exit(2); }
if (/neon\.tech/i.test(process.env.DATABASE_URL || "") && process.env.E2E_ALLOW_NEON !== "yes") { console.error("DATABASE_URL is a Neon address. Point it (and the site) at a test database, or a Neon branch with E2E_ALLOW_NEON=yes."); process.exit(2); }
const ADMIN_EMAIL = (process.env.SUPPORT_ADMIN_EMAIL || process.env.HEAD_ADMIN_EMAIL || "").trim().toLowerCase();
const ADMIN_PW = (process.env.SUPPORT_ADMIN_PASSWORD || process.env.HEAD_ADMIN_PASSWORD || "").trim();
if (!ADMIN_EMAIL || !ADMIN_PW) { console.error("HEAD_ADMIN_EMAIL and HEAD_ADMIN_PASSWORD must be set: the suite signs in as the main admin."); process.exit(2); }

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
const PW = "zzp-Test-pass-123";
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "people-e2e-"));
const startedAt = new Date();

const removeTestData = async () => {
  await sql`delete from access_audit where at >= ${new Date(startedAt.getTime() - 60000)}`;
  const ids = (await sql`select id from users where email like 'zzp-%'`).map((r) => r.id);
  for (const id of ids) { await sql`delete from user_app_access where user_id = ${id}`; await sql`delete from activity_log where user_id = ${id}`; }
  await sql`delete from users where email like 'zzp-%'`;
  await sql`delete from apps where name like 'ZZP%'`;
  await sql`delete from teams where name like 'ZZP%'`;
  await sql`delete from branches where name like 'ZZP%'`;
  await sql`delete from departments where name like 'ZZP%'`;
};
const snap = async () => JSON.stringify([
  await sql`select name,is_active from departments where name not like 'ZZP%' order by name`,
  await sql`select name,url,is_active,status from apps where name not like 'ZZP%' order by name`,
  await sql`select name,is_active from branches where name not like 'ZZP%' order by name`,
  await sql`select name,is_active from teams where name not like 'ZZP%' order by name`,
  await sql`select email,role,is_active,branch_id,team_id,reporting_manager_id from users where email not like 'zzp-%' order by email`,
  await sql`select user_id,app_id from user_app_access where user_id in (select id from users where email not like 'zzp-%') order by user_id, app_id`,
]);

await removeTestData();
const before = await snap();
const browser = await launch();
// The "Download the app" popup and banner are marked as already seen in every test browser, so they never cover a button.
{ const open = browser.newContext.bind(browser); browser.newContext = async (o) => { const c = await open(o); await c.addInitScript(() => { try { localStorage.setItem("mccia-install-popup-seen", "1"); localStorage.setItem("mccia-install-snoozed-until", String(Date.now() + 864e5)); } catch {} }); return c; }; }
const consoleErrors = [], pageErrors = [];
const newSession = async (viewport = { width: 1300, height: 1000 }) => {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  ctx.setDefaultTimeout(45000); ctx.setDefaultNavigationTimeout(90000);
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) consoleErrors.push(m.text().slice(0, 160)); });
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 160)));
  return { ctx, page };
};
const signIn = async (page, email, password) => {
  await page.goto(BASE + "/login");
  await page.locator("input[name=email]").fill(email); await page.locator("input[name=password]").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForFunction(() => location.pathname !== "/login" || location.search.includes("error"), null, { timeout: 25000 }).catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
};
const unlockIf = async (pg) => {
  if (new URL(pg.url()).pathname !== "/unlock") return;
  await pg.locator("input[name=password]").fill(ADMIN_PW); await pg.getByRole("button", { name: "Unlock" }).click();
  await pg.waitForURL((u) => u.pathname !== "/unlock", { timeout: 20000 }).catch(() => {});
};
const toast = (page, t) => page.getByText(t).first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
const main = (page) => page.locator("main").first().innerText();

let admin, tmS, memS, mobile;
try {
  admin = await newSession(); const A = admin.page;
  await signIn(A, ADMIN_EMAIL, ADMIN_PW);
  const go = async (p) => { await A.goto(BASE + p); await unlockIf(A); await A.waitForLoadState("networkidle").catch(() => {}); };

  // ---- fixtures: a department with four applications, and five people
  const [dept] = await sql`insert into departments (name, slug, icon, sort_order) values ('ZZP Dept', 'zzp-dept', 'Building2', 9100) returning id`;
  const mkApp = async (n, url) => (await sql`insert into apps (name, description, url, icon, department_id, sort_order) values (${n}, ${"Test app " + n}, ${url}, 'AppWindow', ${dept.id}, ${Number(n.slice(-1))}) returning id`)[0];
  const app1 = await mkApp("ZZP App 1", "https://example.com/zzp1"), app2 = await mkApp("ZZP App 2", "https://zzp-nonexistent.invalid/"), app3 = await mkApp("ZZP App 3", "https://127.0.0.1/x"), app4 = await mkApp("ZZP App 4", "https://169.254.169.254/latest/meta-data");

  // ------------------------------------------------------------------------------------------------------------------------------
  section("1. Branches and teams");
  await go("/administrator/users/org");
  const addBranch = async (n) => { await A.getByLabel("New branch name").fill(n); await A.getByRole("button", { name: "Add branch" }).click(); };
  await addBranch("ZZP Pune"); check("adding a branch shows a success message", await toast(A, "Branch added")); await A.waitForTimeout(800);
  await addBranch("ZZP Pune"); check("a duplicate branch name is refused", await toast(A, "already exists")); await A.waitForTimeout(600);
  await addBranch("ZZP Mumbai"); await toast(A, "Branch added"); await A.waitForTimeout(800);
  await addBranch("ZZP Temp"); await toast(A, "Branch added"); await A.waitForTimeout(800);
  await A.getByRole("button", { name: "Rename ZZP Temp" }).click(); await A.getByLabel("Name of ZZP Temp").fill("ZZP Temp 2"); await A.getByRole("button", { name: "Save name" }).click();
  check("renaming a branch works", await toast(A, "Branch renamed")); await A.waitForTimeout(800);
  await A.getByRole("button", { name: "Delete ZZP Temp 2" }).click(); check("deleting asks for confirmation", /cannot be deleted/.test(await A.locator("body").innerText()));
  await A.getByRole("button", { name: "Delete", exact: true }).click(); check("an unused branch can be deleted", await toast(A, "Branch deleted")); await A.waitForTimeout(800);
  const addTeam = async (n, branch) => { await A.getByLabel("New team name").fill(n); if (branch) await A.getByLabel("Branch of the new team").selectOption({ label: branch }); await A.getByRole("button", { name: "Add team" }).click(); };
  await addTeam("ZZP Team A", "ZZP Pune"); check("adding a team with a branch shows a success message", await toast(A, "Team added")); await A.waitForTimeout(800);
  await addTeam("ZZP Team B"); await toast(A, "Team added"); await A.waitForTimeout(800);
  const teamA = (await sql`select id, branch_id from teams where name = 'ZZP Team A'`)[0], teamB = (await sql`select id, branch_id from teams where name = 'ZZP Team B'`)[0];
  const pune = (await sql`select id from branches where name = 'ZZP Pune'`)[0], mumbai = (await sql`select id from branches where name = 'ZZP Mumbai'`)[0];
  check("the team is saved with its branch, and a team can have none", teamA.branch_id === pune.id && teamB.branch_id === null);
  await A.getByLabel("Branch of ZZP Team B").selectOption({ label: "ZZP Mumbai" }); check("a team's branch can be changed", await toast(A, "Team saved")); await A.waitForTimeout(800);
  check("the change is in the database", (await sql`select branch_id from teams where name = 'ZZP Team B'`)[0].branch_id === mumbai.id);
  await A.getByRole("row", { name: /ZZP Team B/ }).getByRole("button", { name: "Active", exact: true }).click(); check("a team can be deactivated", await toast(A, "Team deactivated")); await A.waitForTimeout(800);
  await A.getByRole("row", { name: /ZZP Team B/ }).getByRole("button", { name: "Inactive", exact: true }).click(); await toast(A, "Team activated"); await A.waitForTimeout(800);

  // people (made directly: the screens for this are covered elsewhere)
  const mk = async (key, o = {}) => (await sql`insert into users (name, email, role, password_hash, signup_source, team_id, branch_id, reporting_manager_id, designation) values (${"ZZP " + key}, ${"zzp-" + key.toLowerCase() + "@gmail.com"}, ${o.role ?? "member"}, ${o.pw === null ? null : hash(PW)}, 'test', ${o.team ?? null}, ${o.branch ?? null}, ${o.manager ?? null}, null) returning id, email, name`)[0];
  const tm = await mk("Manager", { role: "dept_lead", team: teamA.id, branch: pune.id });
  const m1 = await mk("Member1", { team: teamA.id, branch: pune.id }), m2 = await mk("Member2", { team: teamA.id, branch: pune.id });
  const m3 = await mk("Member3", { team: teamB.id, branch: mumbai.id });
  const m4 = await mk("Member4", { manager: tm.id });
  const grant = (u, a) => sql`insert into user_app_access (user_id, app_id) values (${u.id}, ${a.id}) on conflict do nothing`;
  await grant(tm, app1); await grant(tm, app2); await grant(m1, app3); await grant(m1, app1); await grant(m3, app1);
  await go("/administrator/users/org");
  await A.getByRole("button", { name: "Delete ZZP Pune" }).click(); await A.getByRole("button", { name: "Delete", exact: true }).click();
  check("a branch that still has people or teams cannot be deleted, and the message says why", await toast(A, "people are in this branch") || await toast(A, "person is in this branch"));
  await A.waitForTimeout(600);
  await A.getByRole("button", { name: "Delete ZZP Team A" }).click(); await A.getByRole("button", { name: "Delete", exact: true }).click();
  check("a team that still has people cannot be deleted either", await toast(A, "people are in this team")); await A.waitForTimeout(600);
  check("nothing was deleted by those refusals", (await sql`select count(*)::int n from branches where name = 'ZZP Pune'`)[0].n === 1 && (await sql`select count(*)::int n from teams where name = 'ZZP Team A'`)[0].n === 1);

  // ------------------------------------------------------------------------------------------------------------------------------
  section("2. Editing a person: organisation, role, and the rules");
  await go("/administrator/users/" + m3.id);
  const form = A.getByRole("form", { name: "Details and organisation" });
  check("the profile offers branch, team, reporting manager and role as choices, and a designation", (await form.locator("select").count()) === 4 && (await form.getByLabel("Designation").count()) === 1);
  await form.locator("select").nth(1).selectOption({ label: "ZZP Team A" }); // team
  await form.locator("select").nth(0).selectOption({ label: "ZZP Mumbai" }); // branch
  await form.getByRole("button", { name: "Save details" }).click();
  check("a team that belongs to another branch is refused, naming the branch", await toast(A, "belongs to branch")); await A.waitForTimeout(800);
  check("nothing was changed by the refusal", (await sql`select team_id from users where id = ${m3.id}`)[0].team_id === teamB.id);
  await form.locator("select").nth(0).selectOption({ label: "ZZP Pune" });
  await form.locator("select").nth(2).selectOption({ label: `ZZP Manager (${tm.email})` });
  await form.getByLabel("Designation").fill("Team lead trainee");
  await form.getByRole("button", { name: "Save details" }).click(); check("a valid change saves", await toast(A, "Details saved")); await A.waitForTimeout(1200);
  const m3Row = (await sql`select team_id, branch_id, reporting_manager_id, designation from users where id = ${m3.id}`)[0];
  check("team, branch, manager and designation are saved", m3Row.team_id === teamA.id && m3Row.branch_id === pune.id && m3Row.reporting_manager_id === tm.id && m3Row.designation === "Team lead trainee");
  const au = (await sql`select details from access_audit where target_id = ${m3.id} and action = 'user.update' order by id desc limit 1`)[0];
  check("the change is in the audit log with before and after, by names", !!au && /Team lead trainee/.test(JSON.stringify(au.details)) && /ZZP Team B/.test(JSON.stringify(au.details)) && /ZZP Team A/.test(JSON.stringify(au.details)), JSON.stringify(au?.details));
  await sql`update users set team_id = ${teamB.id}, branch_id = ${mumbai.id}, reporting_manager_id = null where id = ${m3.id}`;
  await go("/administrator/users/" + tm.id);
  const tf = A.getByRole("form", { name: "Details and organisation" });
  await sql`update users set reporting_manager_id = ${tm.id} where id = ${m4.id}`;
  await tf.locator("select").nth(2).selectOption({ label: `ZZP Member4 (${m4.email})` }); await tf.getByRole("button", { name: "Save details" }).click();
  check("a reporting loop is refused with a clear message", await toast(A, "loop")); await A.waitForTimeout(800);
  check("a person cannot be offered as their own manager", (await tf.locator("select").nth(2).locator("option", { hasText: tm.email }).count()) === 0);
  await go("/administrator/users/" + m2.id);
  const rf = A.getByRole("form", { name: "Details and organisation" });
  await rf.getByLabel("Role").selectOption("admin"); await rf.getByRole("button", { name: "Save details" }).click(); check("the role can be changed to Admin", await toast(A, "Details saved")); await A.waitForTimeout(1000);
  check("and it is stored", (await sql`select role from users where id = ${m2.id}`)[0].role === "admin");
  await rf.getByLabel("Role").selectOption("member"); await rf.getByRole("button", { name: "Save details" }).click(); await toast(A, "Details saved"); await A.waitForTimeout(1000);
  check("and can be changed back", (await sql`select role from users where id = ${m2.id}`)[0].role === "member");
  await go("/administrator/users/" + tm.id);
  check("a Team manager keeps that choice in the Role box (it is not offered to anyone else)", (await A.getByRole("form", { name: "Details and organisation" }).getByLabel("Role").inputValue()) === "dept_lead");
  const adminRow = (await sql`select id from users where email = ${ADMIN_EMAIL}`)[0];
  await go("/administrator/users/" + adminRow.id);
  check("the Support Admin's own page has no delete, no deactivate and no role change", (await A.getByRole("button", { name: /Delete|Deactivate/ }).count()) === 0 && (await A.getByLabel("Role").isDisabled()));

  // ------------------------------------------------------------------------------------------------------------------------------
  section("3. A team manager sees and changes only their own team");
  tmS = await newSession(); const T = tmS.page;
  await signIn(T, tm.email, PW);
  await T.goto(BASE + "/"); await T.waitForLoadState("networkidle").catch(() => {});
  check("a team manager has a 'My team' card on the home page", (await T.locator('main a[href="/team"]').count()) === 1);
  check("and no Administrator card", !/\bAdministrator\b/.test(await main(T)));
  await T.goto(BASE + "/team"); await T.waitForLoadState("networkidle").catch(() => {});
  const tText = await main(T);
  check("My team lists people in the team and people reporting to them", tText.includes("ZZP Member1") && tText.includes("ZZP Member2") && tText.includes("ZZP Member4"));
  const listed = await T.locator("tbody a.font-bold").allInnerTexts();
  check("it does not list people from other teams, other managers or administrators", listed.sort().join("|") === "ZZP Member1|ZZP Member2|ZZP Member4" && !tText.includes(ADMIN_EMAIL), listed.join("|"));
  check("a team manager cannot add or bulk add users", (await T.getByRole("button", { name: /Add user/ }).count()) === 0 && (await T.getByRole("link", { name: /Bulk add users/ }).count()) === 0);
  check("rows have no delete or reset buttons, and the status is just a label", (await T.getByRole("button", { name: /^Delete / }).count()) === 0 && (await T.getByRole("button", { name: /^Reset password/ }).count()) === 0 && (await T.locator("tbody tr button", { hasText: /^Active$/ }).count()) === 0);
  await T.goto(BASE + `/team?team=${teamB.id}`); await T.waitForLoadState("networkidle").catch(() => {});
  check("filtering by another team cannot widen what a team manager sees", /No one matches|No one is in your team/.test(await main(T)) && !(await main(T)).includes("ZZP Member3"));
  await T.goto(BASE + `/team/${m1.id}`); await T.waitForLoadState("networkidle").catch(() => {});
  check("a team member's profile opens with the details read only (fields are disabled, there is no Save details)", (await T.getByLabel("Name").first().isDisabled()) && (await T.getByRole("button", { name: "Save details" }).count()) === 0);
  check("it has no delete, deactivate, temporary password or reset buttons", (await T.getByRole("button", { name: /Delete|Deactivate|temporary password|Reset password/ }).count()) === 0);
  check("the access switches offer only the applications the manager holds themselves", (await T.getByRole("switch", { name: /access to ZZP App 1$/ }).count()) === 1 && (await T.getByRole("switch", { name: /access to ZZP App 3$/ }).count()) === 0);
  check("it says the person has another application only wider access can change", /1 application that only someone with wider access/.test(await main(T)), (await main(T)).slice(0, 200));
  await T.goto(BASE + `/team/${m3.id}`); await T.waitForLoadState("networkidle").catch(() => {});
  check("a person outside the team is 'not found', not forbidden (nothing is revealed)", /not found/i.test(await T.locator("body").innerText()) && !(await T.locator("body").innerText()).includes("ZZP Member3"));
  await T.goto(BASE + `/team/${tm.id}`); await T.waitForLoadState("networkidle").catch(() => {});
  check("a team manager's own profile shows their access read only (no one widens their own access)", (await T.getByRole("button", { name: "Save access" }).count()) === 0 && /zzp app 1/i.test(await T.locator("main").innerText()));
  await T.goto(BASE + "/team"); await T.waitForLoadState("networkidle").catch(() => {});
  await T.getByLabel("Select ZZP Member1").check(); await T.getByLabel("Select ZZP Member2").check();
  const bar = T.getByRole("region", { name: "Actions for the selected people" }); const dlg = T.getByRole("dialog", { name: "Assign applications" });
  await bar.getByRole("button", { name: "Assign applications" }).click();
  check("the assign dialog offers only the manager's own applications", (await dlg.locator("label", { hasText: "ZZP App 2" }).count()) >= 1 && (await dlg.locator("label", { hasText: "ZZP App 3" }).count()) === 0 && (await dlg.locator("label", { hasText: "ZZP App 4" }).count()) === 0);
  check("it offers no team, department or branch targets beyond the ones that exist (and the selection is 2 people)", /The 2 people selected/.test(await dlg.innerText()));
  await dlg.locator("label", { hasText: "ZZP App 2" }).getByRole("checkbox").check(); await dlg.getByLabel(/Add these applications/).check(); await dlg.getByRole("button", { name: "Review changes" }).click();
  await dlg.getByRole("button", { name: /^Add for 2 people/ }).click(); await dlg.getByText(/Saved\. 2 people changed/).waitFor({ timeout: 20000 }); await dlg.getByRole("button", { name: "Done", exact: true }).click();
  const holds = async (u) => (await sql`select a.name from user_app_access g join apps a on a.id = g.app_id where g.user_id = ${u.id} order by a.name`).map((r) => r.name).join(",");
  check("the team manager gave both people an application they hold", (await holds(m1)) === "ZZP App 1,ZZP App 2,ZZP App 3" && (await holds(m2)) === "ZZP App 2");
  await T.getByLabel("Select ZZP Member1").check();
  await bar.getByRole("button", { name: "Assign applications" }).click(); await dlg.locator("label", { hasText: "ZZP App 1" }).getByRole("checkbox").check(); await dlg.getByLabel(/Make their access exactly/).check();
  await dlg.getByRole("button", { name: "Review changes" }).click(); await dlg.getByRole("button", { name: /^Replace for 1 person/ }).click(); await dlg.getByText(/Saved\. 1 person changed/).waitFor({ timeout: 20000 }); await dlg.getByRole("button", { name: "Done", exact: true }).click();
  check("a 'replace' by a team manager changes only what they may hand out: App 2 goes, App 3 (which they do not hold) stays", (await holds(m1)) === "ZZP App 1,ZZP App 3", await holds(m1));
  const tmAudit = (await sql`select actor_name, details from access_audit where target_id = ${m1.id} and action = 'access.change' order by id desc limit 1`)[0];
  check("the team manager's change is audited under their own name", tmAudit?.actor_name === "ZZP Manager" && /ZZP App 2/.test(JSON.stringify(tmAudit.details)));
  await T.goto(BASE + "/administrator/users"); await T.waitForLoadState("networkidle").catch(() => {});
  check("a team manager who opens Administrator is sent back to the hub", new URL(T.url()).pathname === "/", T.url());
  const exp = await T.request.get(BASE + "/administrator/users/audit/export", { maxRedirects: 0 });
  check("and the audit export is closed to them", exp.status() >= 300, exp.status());
  memS = await newSession(); const M = memS.page;
  await signIn(M, m1.email, PW);
  await M.goto(BASE + "/"); await M.waitForLoadState("networkidle").catch(() => {});
  check("a plain user has no 'My team' card", (await M.locator('main a[href="/team"]').count()) === 0);
  await M.goto(BASE + "/team"); await M.waitForLoadState("networkidle").catch(() => {});
  check("and a plain user who opens /team is sent back to the hub", new URL(M.url()).pathname === "/", M.url());

  // ------------------------------------------------------------------------------------------------------------------------------
  section("4. Application labels, the inventory and link checks");
  await go("/administrator/inventory");
  const inv = await main(A);
  check("the inventory lists applications with their department, address and who can open them", inv.includes("ZZP App 1") && inv.includes("ZZP Dept") && /https:\/\/example\.com\/zzp1/.test(inv) && /people? assigned, plus the Support Admin/.test(inv) && !/Super Admin/.test(inv));
  check("it explains that 'verified' means the link answered, not that features were tested", /does not mean the application.s own features were tested/.test(inv));
  await A.getByRole("button", { name: "Check ZZP App 3" }).click();
  check("a check aimed at a private address is refused and says so (the server never fetches internal addresses)", await toast(A, "private or internal network")); await A.waitForTimeout(800);
  await A.getByRole("button", { name: "Check ZZP App 4" }).click(); check("so is the cloud metadata address", await toast(A, "private or internal network")); await A.waitForTimeout(800);
  await A.getByRole("button", { name: "Check ZZP App 2" }).click(); check("a domain that does not exist is reported as such", await toast(A, "could not be found")); await A.waitForTimeout(800);
  check("every check is recorded with its result", (await sql`select count(*)::int n from app_checks where app_id in (${app2.id}, ${app3.id}, ${app4.id}) and ok = false`)[0].n === 3);
  await go("/administrator/inventory");
  check("a failed check shows as 'Check failed' with its reason, not as verified", /check failed/i.test(await A.getByRole("row", { name: /ZZP App 3/ }).innerText()) && !/link verified/i.test(await A.getByRole("row", { name: /ZZP App 3/ }).innerText()));
  check("an application never checked says 'Not checked'", /not checked/i.test(await A.getByRole("row", { name: /ZZP App 1/ }).innerText()));
  const dlcsv = A.waitForEvent("download"); await A.getByRole("button", { name: "Export CSV" }).click(); const csv = fs.readFileSync(await (await dlcsv).path(), "utf8");
  check("the inventory exports as CSV with identifiers, status and check results", /Application,Identifier,Department/.test(csv) && csv.includes("ZZP App 1") && csv.includes(app1.id) && /Check failed/.test(csv));
  // adding and deleting an application right from the inventory
  await A.getByRole("button", { name: "Add application" }).click();
  const addDlg = A.getByRole("dialog", { name: "Add application" });
  await addDlg.locator("input").nth(0).fill("ZZP App 5"); await addDlg.locator("input[inputmode=url]").fill("https://example.com/zzp5");
  const deptSel = addDlg.getByLabel("Department (an app belongs to exactly one)"); if (await deptSel.count()) await deptSel.selectOption({ label: "ZZP Dept" });
  await addDlg.getByRole("button", { name: "Add application" }).click();
  check("an application can be added right from the inventory", await toast(A, "Application added")); await A.waitForTimeout(1200);
  const added = (await sql`select a.id, a.status, a.is_active, d.name dept from apps a join departments d on d.id = a.department_id where a.name = 'ZZP App 5'`)[0];
  check("it is saved in the chosen department, shown, and labelled Active", !!added && added.dept === "ZZP Dept" && added.is_active && added.status === "active", JSON.stringify(added));
  check("it appears in the inventory table at once", (await A.getByRole("row", { name: /ZZP App 5/ }).count()) === 1);
  check("adding it is in the audit log", (await sql`select count(*)::int n from access_audit where action = 'app.create' and target_label = 'ZZP App 5'`)[0].n === 1);
  await A.getByRole("button", { name: "Add application" }).click();
  const badDlg = A.getByRole("dialog", { name: "Add application" });
  await badDlg.locator("input").nth(0).fill("ZZP Bad Url"); await badDlg.locator("input[inputmode=url]").fill("http://example.com/insecure");
  const deptSel2 = badDlg.getByLabel("Department (an app belongs to exactly one)"); if (await deptSel2.count()) await deptSel2.selectOption({ label: "ZZP Dept" });
  await badDlg.getByRole("button", { name: "Add application" }).click();
  check("a web address that is not https:// is refused, and nothing is added", await toast(A, "must start with https://") && (await sql`select count(*)::int n from apps where name = 'ZZP Bad Url'`)[0].n === 0);
  await A.keyboard.press("Escape");
  await A.getByRole("button", { name: "Delete ZZP App 5" }).click();
  check("deleting asks first and says what will happen", /removed for good/.test(await A.locator("body").innerText()));
  await A.getByRole("button", { name: "Cancel" }).click(); await A.waitForTimeout(500);
  check("Cancel keeps the application", (await sql`select count(*)::int n from apps where name = 'ZZP App 5'`)[0].n === 1);
  await A.getByRole("button", { name: "Delete ZZP App 5" }).click(); await A.getByRole("button", { name: "Delete", exact: true }).click();
  check("confirming deletes it", await toast(A, "Application deleted")); await A.waitForTimeout(1200);
  check("it is gone from the database and the table, and the deletion is in the audit log", (await sql`select count(*)::int n from apps where name = 'ZZP App 5'`)[0].n === 0 && (await A.getByRole("row", { name: /ZZP App 5/ }).count()) === 0 && (await sql`select count(*)::int n from access_audit where action = 'app.delete' and target_label = 'ZZP App 5'`)[0].n === 1);
  await A.getByLabel("Label for ZZP App 1").selectOption("testing"); check("an application can be labelled Under testing", await toast(A, "Label saved")); await A.waitForTimeout(1000);
  await M.goto(BASE + "/?d=" + dept.id); await M.waitForLoadState("networkidle").catch(() => {});
  check("a person who holds it sees the label on its card", (await M.locator("main a", { hasText: "ZZP App 1" }).innerText()).includes("Under testing"));
  check("and can still open it while it is under testing", (await M.request.get(BASE + "/go/" + app1.id, { maxRedirects: 0 })).status() === 302);
  await A.getByLabel("Label for ZZP App 1").selectOption("unavailable"); await toast(A, "Label saved"); await A.waitForTimeout(1000);
  await M.goto(BASE + "/?d=" + dept.id); await M.waitForLoadState("networkidle").catch(() => {});
  const card = M.locator("main [aria-disabled=true]", { hasText: "ZZP App 1" });
  check("an unavailable application is shown but cannot be opened (no link on its card)", (await card.count()) === 1 && /Cannot be opened right now/.test(await card.innerText()) && (await M.locator("main a", { hasText: "ZZP App 1" }).count()) === 0);
  const blocked = await M.request.get(BASE + "/go/" + app1.id, { maxRedirects: 0 });
  check("and the launch address itself refuses (503), so typing it does not work either", blocked.status() === 503 && /unavailable/i.test(await blocked.text()), blocked.status());
  check("the head admin can still open it, to test it", (await A.request.get(BASE + "/go/" + app1.id, { maxRedirects: 0 })).status() === 302);
  check("no launch is logged for the refused attempt", (await sql`select count(*)::int n from activity_log where app_id = ${app1.id} and user_id = ${m1.id}`)[0].n === 1);
  await A.getByLabel("Label for ZZP App 1").selectOption("active"); await toast(A, "Label saved"); await A.waitForTimeout(1000);
  check("setting it back to Active opens it again", (await M.request.get(BASE + "/go/" + app1.id, { maxRedirects: 0 })).status() === 302);
  check("each label change is in the audit log", (await sql`select count(*)::int n from access_audit where action = 'app.status' and target_label = 'ZZP App 1'`)[0].n === 3);

  // ------------------------------------------------------------------------------------------------------------------------------
  section("5. Bulk add from an Excel file");
  await go("/administrator/users/import");
  await A.locator("input[type=file]").setInputFiles(path.join(ROOT, "tests/fixtures/with-password.xlsx"));
  check("an Excel file with a password column is refused", await A.locator("[role=alert]", { hasText: "Remove the password column" }).first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false));
  await A.locator("input[type=file]").setInputFiles(path.join(ROOT, "tests/fixtures/people.xlsx"));
  await A.getByLabel("name for row 1").waitFor({ timeout: 15000 });
  check("an Excel file is read: note rows and empty rows skipped, names and symbols intact", (await A.getByLabel("name for row 2").inputValue()) === "Ravi & Sons <Test>" && (await A.locator("tr[data-row]").count()) === 3);
  if ((process.env.ALLOWED_EMAIL_DOMAIN || "").trim()) {
    await poll(async () => /must end with/.test((await A.locator("tr[data-row='1']").innerText()).replace(/\s+/g, " ")));
    check("addresses outside the allowed domains are flagged and cannot be created", /must end with/.test((await A.locator("tr[data-row='1']").innerText()).replace(/\s+/g, " ")) && (await A.getByRole("button", { name: /^Create \d+ accounts?/ }).isDisabled()));
  } else console.log("   (skipped: the allowed-domains check needs ALLOWED_EMAIL_DOMAIN set, for example gmail.com,example.com, for this test and the site)");
  await A.locator("input[type=file]").setInputFiles(path.join(ROOT, "tests/fixtures/people-gmail.xlsx"));
  await A.getByLabel("name for row 1").waitFor({ timeout: 15000 });
  const createBtn = A.getByRole("button", { name: /^Create \d+ accounts?/ });
  await poll(async () => /Create 3 accounts/.test(await createBtn.innerText()) && !(await createBtn.isDisabled()));
  check("a real Excel file is read (numbers kept as text, upper-case emails fixed) and three accounts are ready", /Create 3 accounts/.test(await createBtn.innerText()) && (await A.getByLabel("designation for row 2").inputValue()) === "4521");
  check("a manager who is in the same file is accepted", /ready/i.test(await A.locator("tr[data-row='2']").innerText()));
  await createBtn.click(); await A.getByText(/Finished\./).waitFor({ timeout: 60000 });
  const xl = async (e) => (await sql`select id, name, role, reporting_manager_id, password_hash, designation from users where email = ${e}`)[0];
  const x1 = await xl("zzp-xl1@gmail.com"), x2 = await xl("zzp-xl2@gmail.com"), x3 = await xl("zzp-xl3@gmail.com");
  check("all three were created, with the upper-case email stored in lower case", !!x1 && !!x2 && !!x3 && x2.name === "ZZP Xl Two & Co <T>");
  check("the manager in the file is linked: the second person reports to the first", x2.reporting_manager_id === x1.id);
  check("the Team manager role was applied, and applications were assigned", x3.role === "dept_lead" && (await holds(x2)) === "ZZP App 1,ZZP App 2" && (await holds(x1)) === "ZZP App 1");
  check("no one has a password until they choose one", x1.password_hash === null && x2.password_hash === null && x3.password_hash === null);
  // the update policy
  await A.getByRole("button", { name: "Start another import" }).click();
  fs.writeFileSync(path.join(TMP, "zzp-update.csv"), "name,email,designation\nWhatever Name,zzp-xl1@gmail.com,Senior analyst\n");
  await A.locator("input[type=file]").setInputFiles(path.join(TMP, "zzp-update.csv")); await A.getByLabel("name for row 1").waitFor({ timeout: 15000 });
  await poll(async () => /Create 0 accounts/.test(await createBtn.innerText()));
  check("by default an existing email is skipped and nothing would change", /already exists/i.test(await A.locator("tr[data-row='1']").innerText()) && (await createBtn.isDisabled()));
  await A.getByLabel("If an email already has an account").selectOption("update");
  await poll(async () => /Create 1 account/.test(await createBtn.innerText()));
  check("with the update policy it says it will update", /will update/.test(await A.locator("tr[data-row='1']").innerText()));
  await createBtn.click(); await A.getByText(/Finished\./).waitFor({ timeout: 60000 });
  const x1b = await xl("zzp-xl1@gmail.com");
  check("the update changed the designation but never the name, the role or the password", x1b.designation === "Senior analyst" && x1b.name === "ZZP Xl One" && x1b.role === "member" && x1b.password_hash === null);

  // ------------------------------------------------------------------------------------------------------------------------------
  section("6. Temporary passwords from a person's page");
  await go("/administrator/users/" + x1.id);
  check("a person who has not set a password shows as Pending invitation", /pending invitation/i.test(await main(A)));
  const details = A.getByRole("dialog", { name: "Sign-in details" });
  const sendTemp = async (name) => { await A.getByRole("button", { name: "Email temporary password" }).click(); const v = await details.getByLabel(`Temporary password for ${name}`).inputValue(); await details.getByRole("button", { name: "Done", exact: true }).click(); return v; };
  const tempA = await sendTemp("ZZP Xl One");
  const tempB = await sendTemp("ZZP Xl One");
  check("with no email set up, each temporary password is shown once to pass on, and every one is new", tempA !== tempB && tempB.length === 12);
  const pub = await newSession(); const P = pub.page;
  await signIn(P, "zzp-xl1@gmail.com", tempA);
  check("sending a new one cancels the old one", new URL(P.url()).searchParams.get("error") === "1");
  await signIn(P, "zzp-xl1@gmail.com", tempB);
  await P.waitForURL(/change-password/, { timeout: 20000 }).catch(() => {});
  check("the new one signs in, straight to choosing their own password", new URL(P.url()).pathname === "/change-password");
  await P.getByLabel("Current password").fill(tempB); await P.getByLabel("New password", { exact: true }).fill("Xl-one-pass-12345"); await P.getByLabel("Repeat new password").fill("Xl-one-pass-12345");
  await P.getByRole("button", { name: "Save password" }).click();
  check("choosing their own password is confirmed", await toast(P, "Password changed."));
  await pub.ctx.close();
  const pub1b = await newSession(); await signIn(pub1b.page, "zzp-xl1@gmail.com", "Xl-one-pass-12345");
  check("after that they sign in with their own password, to the hub", new URL(pub1b.page.url()).pathname === "/", pub1b.page.url()); await pub1b.ctx.close();
  await go("/administrator/users/" + x1.id); const account = A.locator('section[aria-label="Account"]'); check("their status is now Active", /active/i.test(await account.innerText()) && !/pending/i.test(await account.innerText()), (await account.innerText()).replace(/\s+/g, " "));
  await go("/administrator/users/" + x2.id); const x2Temp = await sendTemp("ZZP Xl Two & Co <T>");
  await A.getByRole("button", { name: "Deactivate" }).click(); await A.getByRole("button", { name: "Deactivate", exact: true }).last().click(); await toast(A, "deactivated"); await A.waitForTimeout(1000);
  const pub2 = await newSession(); await signIn(pub2.page, "zzp-xl2@gmail.com", x2Temp); check("a temporary password for an account that has since been deactivated no longer works", new URL(pub2.page.url()).searchParams.get("error") === "1"); await pub2.ctx.close();
  const pub3 = await newSession(); const nolink = await pub3.page.request.get(BASE + "/set-password"); check("the old set-password page without a link is a polite refusal, not an error", nolink.status() === 200 && /This link cannot be used/.test(await nolink.text())); await pub3.ctx.close();

  // ------------------------------------------------------------------------------------------------------------------------------
  section("7. The audit log and the dashboard");
  await go("/administrator/users/audit?q=ZZP");
  check("the old audit address opens the Admin changes tab of the Activity Log", new URL(A.url()).pathname === "/administrator/activity" && new URL(A.url()).searchParams.get("tab") === "changes");
  const at = await main(A);
  check("the audit log lists changes with who, what and when", /access\.change/i.test(at) && /user\.update/i.test(at) && /app\.status/i.test(at) && /user\.invite/i.test(at) && /user\.create|import\.batch/i.test(at), at.slice(0, 300));
  check("it never shows a password, a token or a setup link", !/set-password|token=|scrypt|password:/i.test(at) && !(JSON.stringify(await sql`select details from access_audit where at >= ${startedAt}`)).match(/set-password|scrypt|token/i));
  await A.getByLabel("Action").selectOption("access.change"); await A.getByRole("button", { name: "Apply" }).click(); await A.waitForLoadState("networkidle").catch(() => {});
  check("filtering by action shows only that action", (await A.locator("tbody tr .badge").allInnerTexts()).every((t) => t.trim().toLowerCase() === "access.change") && (await A.locator("tbody tr").count()) > 0);
  const href = await A.getByRole("link", { name: /Export CSV/ }).getAttribute("href"); const ex = await A.request.get(BASE + href);
  const exTxt = await ex.text();
  check("the audit log exports as CSV with its filters", ex.status() === 200 && /text\/csv/.test(ex.headers()["content-type"]) && exTxt.includes("Time (IST)") && exTxt.includes("access.change") && !/set-password|scrypt/i.test(exTxt));
  const cold = await newSession(); const coldEx = await cold.page.request.get(BASE + href, { maxRedirects: 0 }); check("without signing in, the export is closed", coldEx.status() >= 300 && coldEx.status() < 400, coldEx.status()); await cold.ctx.close();
  await go("/administrator");
  // Pending: no password of their own yet (none at all, or only the temporary one they were sent).
  const pendingDb = (await sql`select count(*)::int n from users where is_active and (password_hash is null or must_change_password) and signup_source is distinct from 'env'`)[0].n;
  const totalDb = (await sql`select count(*)::int n from users`)[0].n;
  const shows = async (label, n) => poll(async () => (await A.getByRole("link", { name: label }).first().innerText()).includes(String(n)), 8000);
  check("the dashboard's numbers match the database (pending invitations and total users)", (await shows(/Pending invitation/, pendingDb)) && (await shows(/Total users/, totalDb)), `${pendingDb} / ${totalDb}`);

  // ------------------------------------------------------------------------------------------------------------------------------
  section("8. Keyboard, labels and a phone-sized screen");
  await go("/administrator/users?q=ZZP");
  const unnamed = await A.evaluate(() => [...document.querySelectorAll("main button, main a, main select, main input")].filter((e) => { const n = (e.getAttribute("aria-label") || e.getAttribute("title") || e.innerText || e.getAttribute("placeholder") || "").trim(); const labelled = e.id && document.querySelector(`label[for="${e.id}"]`); const wrapped = e.closest("label"); return !n && !labelled && !wrapped && !(e.getAttribute("type") === "hidden"); }).map((e) => e.outerHTML.slice(0, 80)));
  check("every button, link and field in the directory has an accessible name", unnamed.length === 0, unnamed.join(" | "));
  await A.getByRole("button", { name: /Add user/ }).click(); check("Add user opens a dialog", (await A.getByRole("dialog", { name: "Add user" }).count()) === 1);
  await A.keyboard.press("Escape"); check("Escape closes the dialog", (await A.getByRole("dialog").count()) === 0);
  mobile = await newSession({ width: 390, height: 844 }); const Mo = mobile.page; await mobile.ctx.addCookies(await admin.ctx.cookies());
  for (const [p, l] of [["/administrator/users?q=ZZP", "the directory"], ["/administrator/users/" + m1.id, "a profile"], ["/administrator/users/import", "bulk add"], ["/administrator/users/org", "branches and teams"], ["/administrator/inventory", "the inventory"], ["/administrator", "the dashboard"]]) {
    await Mo.goto(BASE + p); await unlockIf(Mo); await Mo.waitForLoadState("networkidle").catch(() => {});
    const o = await Mo.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    check(`no sideways page scroll on a phone: ${l}`, o.sw <= o.iw + 1, `${o.sw} vs ${o.iw}`);
  }

  check("no JavaScript errors in the browser console", consoleErrors.length === 0 && pageErrors.length === 0, consoleErrors.concat(pageErrors).join(" | "));
} catch (e) {
  console.log("\nTEST ERROR:", String(e).split("\n").slice(0, 4).join(" | ")); results.push(["test crashed", false]);
} finally {
  for (const s of [admin, tmS, memS, mobile]) await s?.ctx.close().catch(() => {});
  await browser.close();
  section("Cleanup and data-safety check");
  await retry(removeTestData);
  fs.rmSync(TMP, { recursive: true, force: true });
  const after = await retry(snap);
  check("your real departments, applications, branches, teams, people and access are exactly as before", before === after, before === after ? "" : "DIFFERENT");
  const left = (await sql`select (select count(*) from users where email like 'zzp-%') u, (select count(*) from apps where name like 'ZZP%') a, (select count(*) from departments where name like 'ZZP%') d, (select count(*) from branches where name like 'ZZP%') b, (select count(*) from teams where name like 'ZZP%') t`)[0];
  check("all test data removed", [left.u, left.a, left.d, left.b, left.t].every((n) => Number(n) === 0), JSON.stringify(left));
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) console.log("FAILED:\n - " + failed.map(([n]) => n).join("\n - "));
  process.exit(failed.length ? 1 : 0);
}
