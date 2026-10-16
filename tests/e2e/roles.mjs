/**
 * End-to-end test of the roles in a real browser: the Support Admin (the environment account), the Super Admin, and Admins whose areas
 * of Administrator are switched on one by one. Run:
 *   E2E_BASE_URL=http://localhost:3000 npm run test:e2e:roles
 *
 * It WRITES to the database the site uses, but only rows named "ZZR"/"zzr-": one department with an application and a few people with
 * different roles. Everything is removed when it finishes (and at the start, if an earlier run was interrupted), including the audit
 * entries this run caused, and it confirms that everything else is exactly as before. The environment must allow gmail.com addresses.
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
if (!BASE) { console.error("Set E2E_BASE_URL, for example: E2E_BASE_URL=http://localhost:3000 npm run test:e2e:roles"); process.exit(2); }
const ADMIN_EMAIL = (process.env.HEAD_ADMIN_EMAIL || "").trim().toLowerCase();
const ADMIN_PW = process.env.HEAD_ADMIN_PASSWORD || "";
if (!ADMIN_EMAIL || !ADMIN_PW) { console.error("HEAD_ADMIN_EMAIL and HEAD_ADMIN_PASSWORD must be set: the suite signs in as the main admin."); process.exit(2); }

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
const check = (name, ok, extra = "") => { results.push([name, !!ok]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? "  -> " + String(extra).slice(0, 240) : ""}`); };
const section = (t) => console.log(`\n== ${t} ==`);
const poll = async (fn, ms = 20000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 400)); } return v; };
const hash = (pw) => { const salt = randomBytes(16); return `scrypt$16384$${salt.toString("base64")}$${scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("base64")}`; };
const PW = "zzr-Test-pass-123";
const startedAt = new Date();

const removeTestData = async () => {
  await sql`delete from access_audit where at >= ${new Date(startedAt.getTime() - 60000)}`;
  const ids = (await sql`select id from users where email like 'zzr-%'`).map((r) => r.id);
  for (const id of ids) { await sql`delete from user_app_access where user_id = ${id}`; await sql`delete from activity_log where user_id = ${id}`; await sql`delete from user_invites where user_id = ${id}`; }
  await sql`delete from users where email like 'zzr-%'`;
  await sql`delete from apps where name like 'ZZR%'`;
  await sql`delete from departments where name like 'ZZR%'`;
};
const snap = async () => JSON.stringify([
  await sql`select name,is_active from departments where name not like 'ZZR%' order by name`,
  await sql`select name,url,is_active,status from apps where name not like 'ZZR%' order by name`,
  await sql`select email,role,is_active,admin_areas from users where email not like 'zzr-%' order by email`,
  await sql`select user_id,app_id from user_app_access where user_id in (select id from users where email not like 'zzr-%') order by user_id, app_id`,
]);

await removeTestData();
const before = await snap();
const browser = await launch();
const consoleErrors = [], pageErrors = [];
const newSession = async (viewport = { width: 1300, height: 1000 }) => {
  const ctx = await browser.newContext({ viewport });
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
/** Opens a page; if Administrator asks for the password, gives this person's own. */
const visit = async (page, p, pw) => {
  await page.goto(BASE + p);
  if (new URL(page.url()).pathname === "/unlock") {
    await page.locator("input[name=password]").fill(pw); await page.getByRole("button", { name: "Unlock" }).click();
    await page.waitForURL((u) => u.pathname !== "/unlock", { timeout: 20000 }).catch(() => {});
  }
  await page.waitForLoadState("networkidle").catch(() => {});
  // The page streams in behind a loading skeleton, which has no text: wait for the real content.
  await page.waitForFunction(() => (document.querySelector("main")?.innerText ?? "").trim().length > 0, null, { timeout: 30000 }).catch(() => {});
  // A redirect raised while the page streams lands a moment later: wait until the address has stopped changing.
  let last = "";
  for (let i = 0; i < 8; i++) { const now = new URL(page.url()).pathname; if (now === last) break; last = now; await page.waitForTimeout(700); await page.waitForLoadState("networkidle").catch(() => {}); }
  return new URL(page.url()).pathname;
};
const toast = (page, t) => page.getByText(t).first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
const main = (page) => page.locator("main").first().innerText();
// The sections of Administrator are listed once, in the sidebar's Administrator menu (there is no row of tabs on the page).
const tabs = async (page) => (await page.locator("aside").first().locator("a[href^='/administrator']").allInnerTexts()).map((t) => t.trim());
const subtabs = (page) => page.locator('nav[aria-label="Users and access pages"] a').allInnerTexts();
const sidebarHasAdministrator = async (page) => (await page.locator("aside").first().getByRole("button", { name: "Administrator" }).count()) > 0;

try {
  // ---- fixtures: people with every role, and one department with an application
  const mk = async (key, role, areas = []) => (await sql`insert into users (name, email, role, admin_areas, password_hash, status, signup_source) values (${"ZZR " + key}, ${"zzr-" + key.toLowerCase().replace(/\s+/g, "-") + "@example.com"}, ${role}::role, ${areas}, ${hash(PW)}, 'approved', 'test') returning id, email, name`)[0];
  const sup = await mk("Super", "super_admin");
  const adm = await mk("Admin People", "admin", ["people"]);
  const none = await mk("Admin None", "admin");
  const org = await mk("Admin Org", "admin", ["org", "audit"]);
  const plain = await mk("Plain One", "member");
  const plain2 = await mk("Plain Two", "member");
  const [dept] = await sql`insert into departments (name, slug, icon, sort_order) values ('ZZR Dept', 'zzr-dept', 'Building2', 9200) returning id`;
  const [app] = await sql`insert into apps (name, description, url, icon, department_id, sort_order) values ('ZZR App', 'Test app', 'https://example.com/zzr', 'AppWindow', ${dept.id}, 1) returning id`;
  const envAdmin = (await sql`select id, name from users where lower(email) = ${ADMIN_EMAIL}`)[0];

  const A = (await newSession()).page, S = (await newSession()).page, P = (await newSession()).page, N = (await newSession()).page, O = (await newSession()).page, U = (await newSession()).page;
  await Promise.all([signIn(A, ADMIN_EMAIL, ADMIN_PW), signIn(S, sup.email, PW), signIn(P, adm.email, PW), signIn(N, none.email, PW), signIn(O, org.email, PW), signIn(U, plain.email, PW)]);

  // ------------------------------------------------------------------------------------------------------------------------------
  section("1. The Support Admin (the environment account)");
  await visit(A, "/administrator/users", ADMIN_PW);
  const dir = await main(A);
  check("the Support Admin is labelled as such in the directory", /Support admin/.test(dir), dir.replace(/\s+/g, " ").slice(0, 120));
  check("and sees everyone: the Super Admin and every Admin", [sup, adm, none, org].every((p) => dir.includes(p.name)));
  const superRowText = await A.locator("tr", { hasText: sup.name }).first().innerText();
  check("the Super Admin is shown as a main admin, without the 'password in settings' note", /Main admin/i.test(superRowText) && !/password in settings/i.test(superRowText), superRowText.replace(/\s+/g, " ").slice(0, 120));
  check("while the Support Admin keeps 'Main admin · password in settings'", /Main admin · password in settings/i.test(await A.locator("tr", { hasText: envAdmin.name }).first().innerText()));
  check("a main admin's status cannot be clicked to deactivate them, and there is no Delete button on their row", (await A.locator("tr", { hasText: sup.name }).first().getByRole("button", { name: /Delete/ }).count()) === 0 && (await A.locator("tr", { hasText: sup.name }).first().getByTitle("Click to deactivate").count()) === 0);
  check("the sections are listed once, in the sidebar, with no second row of the same links on the page", (await A.locator('nav[aria-label="Administrator sections"]').count()) === 0 && (await tabs(A)).length === 8);
  check("all eight sections of Administrator, as before", JSON.stringify(await tabs(A)) === JSON.stringify(["Dashboard", "Departments", "Users & Access", "Applications", "Application categories", "Approvals", "Notifications Panel", "Activity log"]), (await tabs(A)).join("|"));
  check("the four pages inside Users & Access, as before", JSON.stringify(await subtabs(A)) === JSON.stringify(["People", "Branches & teams", "Audit log", "By application & templates"]), (await subtabs(A)).join("|"));
  const roleOptions = await A.locator("select[aria-label], select").evaluateAll((els) => els.flatMap((e) => [...e.options].map((o) => o.textContent)));
  check("the role filter lists User, Team manager, Admin, Super admin and Support admin", ["User", "Team manager", "Admin", "Super admin", "Support admin"].every((t) => roleOptions.includes(t)), roleOptions.join(","));

  section("2. The Support Admin gives an Admin their areas");
  await visit(A, `/administrator/users/${none.id}`, ADMIN_PW);
  const areasBox = A.locator('section[aria-label="What this Admin may open"]');
  check("an Admin's profile has the list of what they may open, with six boxes, none ticked yet", (await areasBox.count()) === 1 && (await areasBox.getByRole("checkbox").count()) === 6 && (await areasBox.locator("input:checked").count()) === 0);
  check("the Role box offers User, Team manager, Admin and Super admin, and shows Admin", (await A.getByLabel("Role").inputValue()) === "admin" && (await A.getByLabel("Role").locator("option").allInnerTexts()).join("|") === "User|Team manager|Admin|Super admin");
  await areasBox.getByRole("checkbox", { name: /^Users & access/ }).check();
  await areasBox.getByRole("checkbox", { name: /^Audit log/ }).check();
  await areasBox.getByRole("button", { name: "Save what they may open" }).click();
  check("saving shows a message", await toast(A, "What this Admin may open is saved"));
  check("the two areas are stored", await poll(async () => JSON.stringify((await sql`select admin_areas from users where id = ${none.id}`)[0].admin_areas) === JSON.stringify(["people", "audit"])));
  check("and recorded in the audit log, with what was switched on", (await sql`select details from access_audit where action = 'user.admin_areas' and target_id = ${none.id}`).some((r) => JSON.stringify(r.details.added) === JSON.stringify(["people", "audit"])));
  await areasBox.getByRole("checkbox", { name: /^Audit log/ }).uncheck();
  await areasBox.getByRole("button", { name: "Save what they may open" }).click();
  check("an area can be switched off again", await poll(async () => JSON.stringify((await sql`select admin_areas from users where id = ${none.id}`)[0].admin_areas) === JSON.stringify(["people"])));
  await sql`update users set admin_areas = '{}' where id = ${none.id}`; // back to nothing for the next sections

  section("3. Roles are changed on the profile, by the Support Admin only");
  await visit(A, `/administrator/users/${plain2.id}`, ADMIN_PW);
  check("a plain user's profile has no areas section", (await A.locator('section[aria-label="What this Admin may open"]').count()) === 0);
  await A.getByLabel("Role").selectOption("admin");
  await A.getByRole("button", { name: "Save details" }).click();
  check("making someone an Admin is saved", await toast(A, "Details saved") && await poll(async () => (await sql`select role from users where id = ${plain2.id}`)[0].role === "admin"));
  await visit(A, `/administrator/users/${plain2.id}`, ADMIN_PW);
  check("the areas section then appears", (await A.locator('section[aria-label="What this Admin may open"]').count()) === 1);
  await A.locator('section[aria-label="What this Admin may open"]').getByRole("checkbox", { name: /^Applications/ }).check();
  await A.getByRole("button", { name: "Save what they may open" }).click();
  await poll(async () => (await sql`select admin_areas from users where id = ${plain2.id}`)[0].admin_areas.length === 1);
  await A.getByLabel("Role").selectOption("member");
  await A.getByRole("button", { name: "Save details" }).click();
  check("changing them back to User clears their areas", await poll(async () => { const r = (await sql`select role, admin_areas from users where id = ${plain2.id}`)[0]; return r.role === "member" && r.admin_areas.length === 0; }));
  check("the role change is in the audit log", (await sql`select count(*)::int n from access_audit where action = 'user.update' and target_id = ${plain2.id}`)[0].n >= 2);
  await visit(A, "/administrator/users", ADMIN_PW);
  await A.getByRole("button", { name: "Add user" }).click();
  const dlg = A.getByRole("dialog");
  check("Add user offers Admin and Super admin to the Support Admin", (await dlg.getByLabel("Role").locator("option").allInnerTexts()).join("|") === "User|Team manager|Admin|Super admin");
  await dlg.getByLabel("Name", { exact: true }).fill("ZZR New Admin");
  await dlg.getByLabel("Email (the username)").fill("zzr-new-admin@gmail.com");
  await dlg.getByLabel("Role").selectOption("admin");
  await dlg.getByRole("button", { name: "Create user" }).click();
  check("an Admin can be created straight away, with nothing switched on", await poll(async () => { const r = (await sql`select role, admin_areas from users where email = 'zzr-new-admin@gmail.com'`)[0]; return r && r.role === "admin" && r.admin_areas.length === 0; }));

  section("4. The Super Admin (the DG): an ordinary user in the hub, plus the final approvals");
  await S.goto(BASE + "/");
  check("the Super Admin has no Administrator in the sidebar", !(await sidebarHasAdministrator(S)));
  await S.goto(BASE + "/administrator/users");
  check("and its address sends them home, whatever they type", new URL(S.url()).pathname === "/");
  check("they see no application until the Support Admin gives them one", !(await S.locator("body").innerText()).includes("ZZR Dept"));
  await visit(A, `/administrator/users/${sup.id}`, ADMIN_PW);
  await A.getByRole("heading", { name: sup.name }).waitFor({ timeout: 30000 }).catch(() => {});
  const supProfile = await main(A);
  const supFacts = { mainLabel: /main admin/i.test(supProfile), inSettings: /password in settings/i.test(supProfile), link: await A.getByRole("button", { name: "Send setup link" }).count(), reset: await A.getByRole("button", { name: /Reset password/ }).count(), deactivate: await A.getByRole("button", { name: "Deactivate" }).count(), del: await A.getByRole("button", { name: "Delete" }).count() };
  check("the Super Admin's profile has the Main admin label, setup link and password reset, but no Deactivate or Delete", supFacts.mainLabel && !supFacts.inSettings && supFacts.link === 1 && supFacts.reset === 1 && supFacts.deactivate === 0 && supFacts.del === 0, JSON.stringify(supFacts));
  check("and the Application access box lets the Support Admin choose what they may open: categories with their applications", (await A.locator("main label", { hasText: "ZZR App" }).count()) >= 1 && (await A.getByRole("button", { name: "Save access" }).count()) === 1);
  await A.locator("main label", { hasText: "ZZR App" }).getByRole("checkbox").first().check();
  await A.getByRole("button", { name: "Save access" }).click();
  check("giving the Super Admin an application is saved", await toast(A, "Access saved") && await poll(async () => (await sql`select count(*)::int n from user_app_access where user_id = ${sup.id} and app_id = ${app.id}`)[0].n === 1));
  await S.goto(BASE + "/");
  check("then they see that application, under its category, and can open it", /ZZR Dept/.test(await S.locator("body").innerText()) && (await S.request.get(BASE + "/go/" + app.id, { maxRedirects: 0 })).status() === 302);
  check("the bell tells them", await poll(async () => (await sql`select count(*)::int n from hub_notifications where user_id = ${sup.id} and kind = 'access_granted'`)[0].n >= 1));

  section("5. An Admin with Users & access");
  const pp = await visit(P, "/administrator", PW);
  check("the sidebar offers Administrator, and it opens after unlocking", (await sidebarHasAdministrator(P)) && pp === "/administrator");
  check("the Admin sees the Dashboard, Users & Access and the Notifications Panel only", JSON.stringify(await tabs(P)) === JSON.stringify(["Dashboard", "Users & Access", "Notifications Panel"]), (await tabs(P)).join("|"));
  check("the Administrator menu in the sidebar lists only those", (await P.locator("aside").first().innerText()).includes("Users & Access") && !(await P.locator("aside").first().innerText()).includes("Departments"));
  for (const p of ["/administrator/departments", "/administrator/inventory", "/administrator/users/org", "/administrator/users/audit", "/administrator/users/import", "/administrator/activity"]) {
    const landed = await visit(P, p, PW);
    check(`${p} is not open to them: they are sent back to the Dashboard`, landed === "/administrator", landed);
  }
  check("the audit export is refused too", (await P.request.get(BASE + "/administrator/users/audit/export")).status() !== 200 || !/text\/csv/.test((await P.request.get(BASE + "/administrator/users/audit/export")).headers()["content-type"] ?? ""));
  await visit(P, "/administrator/users", PW);
  const pdir = await main(P);
  check("the directory shows plain users", pdir.includes(plain.name));
  check("and never the Support Admin, the Super Admin or another Admin", !pdir.includes(sup.name) && !pdir.includes(none.name) && !pdir.includes(org.name) && !pdir.includes(ADMIN_EMAIL), pdir.replace(/\s+/g, " ").slice(0, 160));
  check("inside Users & Access they have People and By application & templates only", JSON.stringify(await subtabs(P)) === JSON.stringify(["People", "By application & templates"]), (await subtabs(P)).join("|"));
  await P.getByRole("button", { name: "Add user" }).click();
  check("Add user offers no Admin or Super admin to an Admin", (await P.getByRole("dialog").getByLabel("Role").locator("option").allInnerTexts()).join("|") === "User|Team manager");
  await P.keyboard.press("Escape");
  for (const [who, id] of [["the Super Admin", sup.id], ["another Admin", org.id], ["the Support Admin", envAdmin.id]]) {
    await visit(P, `/administrator/users/${id}`, PW);
    check(`the profile of ${who} is not found`, /not found|could not be found|doesn.t exist|404/i.test(await P.locator("body").innerText()), (await P.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 80));
  }
  await visit(P, `/administrator/users/${plain.id}`, PW);
  check("a plain user's profile opens, with details editable and the Role box disabled", !(await P.getByLabel("Name", { exact: true }).isDisabled()) && (await P.getByLabel("Role").isDisabled()));
  check("the buttons for deleting a person are not there", (await P.getByRole("button", { name: "Delete" }).count()) === 0);
  check("and there is no list of areas on a plain user's page", (await P.locator('section[aria-label="What this Admin may open"]').count()) === 0);
  await P.getByLabel("Name", { exact: true }).fill("ZZR Plain One Edited");
  await P.getByRole("button", { name: "Save details" }).click();
  check("they may change a plain user's details", await toast(P, "Details saved") && await poll(async () => (await sql`select name from users where id = ${plain.id}`)[0].name === "ZZR Plain One Edited"));
  await sql`update users set name = 'ZZR Plain One' where id = ${plain.id}`;
  const appBox = P.locator("main label", { hasText: "ZZR App" }).getByRole("checkbox").first();
  if (await appBox.count()) {
    await appBox.check();
    await P.getByRole("button", { name: "Save access" }).click();
    check("and give them an application, even one they do not hold themselves", await toast(P, "Access saved") && await poll(async () => (await sql`select count(*)::int n from user_app_access where user_id = ${plain.id} and app_id = ${app.id}`)[0].n === 1));
  } else check("the access tree lists the test application", false);
  check("the audit entry names the Admin who gave it", (await sql`select actor_name from access_audit where action = 'access.change' and target_id = ${plain.id}`).some((r) => r.actor_name === adm.name));
  await visit(P, `/administrator/users/${adm.id}`, PW);
  check("their own profile opens read only", (await P.getByLabel("Name", { exact: true }).isDisabled()) && /cannot change these details/.test(await main(P)));

  section("6. An Admin with Branches & teams and the Audit log only");
  const op = await visit(O, "/administrator/users", PW);
  check("the People address is not open to them", op === "/administrator", op);
  check("their tabs are the Dashboard, Departments, Users & Access and the Notifications Panel", JSON.stringify(await tabs(O)) === JSON.stringify(["Dashboard", "Departments", "Users & Access", "Notifications Panel"]), (await tabs(O)).join("|"));
  check("and Users & Access opens on the first page they may use, not People", (await O.locator("aside").first().locator("a[href^='/administrator']", { hasText: "Users & Access" }).getAttribute("href")) === "/administrator/users/org");
  await visit(O, "/administrator/users/org", PW);
  check("inside Users & Access they have Branches & teams and Audit log only", JSON.stringify(await subtabs(O)) === JSON.stringify(["Branches & teams", "Audit log"]), (await subtabs(O)).join("|"));
  check("the audit log opens", (await visit(O, "/administrator/users/audit", PW)) === "/administrator/users/audit");
  const csv = await O.request.get(BASE + "/administrator/users/audit/export");
  check("and can be exported", csv.status() === 200 && /text\/csv/.test(csv.headers()["content-type"] ?? ""));
  check("the People page is not open to them", (await visit(O, "/administrator/users", PW)) === "/administrator");
  check("nor the activity log", (await visit(O, "/administrator/activity", PW)) === "/administrator");

  section("7. An Admin with nothing switched on, and a plain user");
  await N.goto(BASE + "/");
  check("an Admin with nothing switched on has no Administrator in the sidebar", !(await sidebarHasAdministrator(N)));
  await N.goto(BASE + "/administrator");
  check("and cannot open it: they land back on the home page", new URL(N.url()).pathname === "/", N.url());
  await U.goto(BASE + "/");
  check("a plain user has no Administrator either", !(await sidebarHasAdministrator(U)));
  await U.goto(BASE + "/administrator/users");
  check("and is sent away from it", new URL(U.url()).pathname !== "/administrator/users", U.url());
  check("a plain user cannot open the people pages even by address", (await U.request.get(BASE + "/administrator/users/audit/export")).status() !== 200 || !/text\/csv/.test((await U.request.get(BASE + "/administrator/users/audit/export")).headers()["content-type"] ?? ""));

  section("7b. The Super Admin as an environment account (when SUPER_ADMIN_* are set to a test address)");
  const ENV_SUP_EMAIL = (process.env.SUPER_ADMIN_EMAIL || "").trim().toLowerCase();
  const ENV_SUP_PW = process.env.SUPER_ADMIN_PASSWORD || "";
  if (ENV_SUP_EMAIL.startsWith("zzr-") && ENV_SUP_PW) {
    const bad = (await newSession()).page;
    await signIn(bad, ENV_SUP_EMAIL, ENV_SUP_PW + "x");
    check("a wrong password is refused", new URL(bad.url()).pathname === "/login");
    const E = (await newSession()).page;
    await signIn(E, ENV_SUP_EMAIL, ENV_SUP_PW);
    check("the right one signs in, and the account is made as a Super Admin from the settings", new URL(E.url()).pathname === "/" && await poll(async () => { const r = (await sql`select role, signup_source from users where lower(email) = ${ENV_SUP_EMAIL}`)[0]; return r && r.role === "super_admin" && r.signup_source === "env"; }));
    check("they have no Administrator: not in the sidebar, and its address sends them home", !(await sidebarHasAdministrator(E)) && (await E.goto(BASE + "/administrator").then(() => new URL(E.url()).pathname)) === "/");
    await visit(A, "/administrator/users", ADMIN_PW);
    const envRow = await A.locator("tr", { hasText: ENV_SUP_EMAIL }).first().innerText();
    check("their row says Super admin and Main admin · password in settings", /super admin/i.test(envRow) && /main admin · password in settings/i.test(envRow), envRow.replace(/\s+/g, " ").slice(0, 140));
    const envId = (await sql`select id from users where lower(email) = ${ENV_SUP_EMAIL}`)[0].id;
    await visit(A, `/administrator/users/${envId}`, ADMIN_PW);
    await A.getByRole("heading", { name: /./ }).first().waitFor({ timeout: 30000 }).catch(() => {});
    check("their profile has no setup link or password reset, no Deactivate or Delete, and the Role box is fixed", (await A.getByRole("button", { name: "Send setup link" }).count()) === 0 && (await A.getByRole("button", { name: /Reset password/ }).count()) === 0
      && (await A.getByRole("button", { name: "Deactivate" }).count()) === 0 && (await A.getByRole("button", { name: "Delete" }).count()) === 0 && (await A.getByLabel("Role").isDisabled()));
    await E.goto(BASE + "/change-password");
    check("they are told their password is changed in the settings", /environment settings/i.test(await E.locator("body").innerText()));
  } else {
    console.log("   (skipped: set SUPER_ADMIN_EMAIL to a zzr-... address and SUPER_ADMIN_PASSWORD in the environment of this test and of the site to run these)");
  }

  section("7c. HR and Expenditure main accounts, and the approver rules filled from them (when HR_ADMIN_*, EXPENDITURE_ADMIN_* and SUPER_ADMIN_* are set to test addresses)");
  const ENV_HR = { email: (process.env.HR_ADMIN_EMAIL || "").trim().toLowerCase(), pw: process.env.HR_ADMIN_PASSWORD || "" };
  const ENV_EXP = { email: (process.env.EXPENDITURE_ADMIN_EMAIL || "").trim().toLowerCase(), pw: process.env.EXPENDITURE_ADMIN_PASSWORD || "" };
  if ([ENV_HR, ENV_EXP].every((a) => a.email.startsWith("zzr-") && a.pw) && ENV_SUP_EMAIL.startsWith("zzr-") && ENV_SUP_PW) {
    const savedRules = await sql`select id, request_type, step_no, step_label, min_amount_paise, max_amount_paise, approver_user_ids, active from apr_approver_rules`;
    const savedMarker = await sql`select key, value from apr_settings where key = 'env_rules_seeded'`;
    try {
      const H = (await newSession()).page, X = (await newSession()).page;
      await signIn(H, ENV_HR.email, ENV_HR.pw);
      check("HR signs in with the password from the settings", new URL(H.url()).pathname === "/");
      await signIn(X, ENV_EXP.email, ENV_EXP.pw);
      check("so does Expenditure", new URL(X.url()).pathname === "/");
      check("neither has Administrator in the sidebar, and its address sends them home", !(await sidebarHasAdministrator(H)) && !(await sidebarHasAdministrator(X)) && (await H.goto(BASE + "/administrator").then(() => new URL(H.url()).pathname)) === "/");
      check("both have the Approval System", (await H.locator("aside").first().getByRole("button", { name: "Approval System" }).count()) > 0);
      const hrId = (await sql`select id from users where lower(email) = ${ENV_HR.email}`)[0].id;
      await visit(A, "/administrator/users", ADMIN_PW);
      const hrRow = await A.locator("tr", { hasText: ENV_HR.email }).first().innerText();
      check("the directory shows HR as a User, marked Main account · password in settings", /user/i.test(hrRow) && /main account · password in settings/i.test(hrRow), hrRow.replace(/\s+/g, " ").slice(0, 140));
      await visit(A, `/administrator/users/${hrId}`, ADMIN_PW);
      await A.getByRole("heading", { name: /./ }).first().waitFor({ timeout: 30000 }).catch(() => {});
      check("HR's profile has no password reset, setup link, Deactivate or Delete, and the Role box is fixed; applications can still be assigned", (await A.getByRole("button", { name: /Reset password/ }).count()) === 0 && (await A.getByRole("button", { name: "Send setup link" }).count()) === 0
        && (await A.getByRole("button", { name: "Deactivate" }).count()) === 0 && (await A.getByRole("button", { name: "Delete" }).count()) === 0 && (await A.getByLabel("Role").isDisabled()) && (await A.getByRole("button", { name: "Save access" }).count()) === 1);
      // The rules are filled from the three accounts the first time: start from empty rules and no marker.
      await sql`update apr_approver_rules set approver_user_ids = '{}'`;
      await sql`delete from apr_settings where key = 'env_rules_seeded'`;
      await visit(A, "/approvals/admin/rules", ADMIN_PW);
            const supId = (await sql`select id from users where lower(email) = ${ENV_SUP_EMAIL}`)[0].id;
      const expId = (await sql`select id from users where lower(email) = ${ENV_EXP.email}`)[0].id;
      const rule = async (t, n) => (await sql`select approver_user_ids from apr_approver_rules where request_type = ${t}::apr_request_type and step_no = ${n}`)[0]?.approver_user_ids?.[0];
      check("opening Approver Rules fills them from the accounts: HR reviews HR, Expenditure is the first approver, the Super Admin is last", await poll(async () => (await rule("hr", 1)) === hrId && (await rule("hr", 2)) === supId && (await rule("expenditure_large", 1)) === expId && (await rule("expenditure_large", 2)) === supId && (await rule("expenditure_small", 1)) === expId));
      const picked = await A.locator("main select").evaluateAll((els) => els.map((e) => e.options[e.selectedIndex]?.textContent ?? "").join("|"));
      check("the screen names them", picked.includes("ZZR Env HR") && picked.includes("ZZR Env Expenditure") && picked.includes("ZZR Env Super"), picked);
      const SE = (await newSession()).page;
      await signIn(SE, ENV_SUP_EMAIL, ENV_SUP_PW);
      check("HR is now an approver and opens the approvals waiting for them; the Super Admin has the Recommended Queue and not the all-requests lists", (await H.goto(BASE + "/approvals/my/pending")).status() === 200 && (await SE.goto(BASE + "/approvals/inbox")).status() === 200 && (await SE.goto(BASE + "/approvals/hr/all")).status() === 404 && (await SE.goto(BASE + "/approvals/expenditures/all")).status() === 404);
      check("the Support Admin alone has the Approvals settings: the Super Admin does not open Approver Rules", (await SE.goto(BASE + "/approvals/admin/rules")).status() === 404);
      check("the run is noted once in the audit log as the System", (await sql`select count(*)::int n from apr_admin_audit where actor_name = 'System' and summary like 'Filled % empty approver rules%' and created_at >= ${startedAt}`)[0].n === 1);
      await sql`update apr_approver_rules set approver_user_ids = '{}' where request_type = 'hr' and step_no = 1`;
      await visit(A, "/approvals/admin/rules", ADMIN_PW);
      check("what the Support Admin clears is not filled in again", (await rule("hr", 1)) === undefined);
    } finally {
      await sql`delete from apr_approver_rules`;
      for (const r of savedRules) await sql`insert into apr_approver_rules (id, request_type, step_no, step_label, min_amount_paise, max_amount_paise, approver_user_ids, active) values (${r.id}, ${r.request_type}::apr_request_type, ${r.step_no}, ${r.step_label}, ${r.min_amount_paise}, ${r.max_amount_paise}, ${r.approver_user_ids}, ${r.active})`;
      await sql`delete from apr_settings where key = 'env_rules_seeded'`;
      for (const m of savedMarker) await sql`insert into apr_settings (key, value) values (${m.key}, ${m.value}) on conflict do nothing`;
      await sql`delete from apr_admin_audit where actor_name = 'System' and created_at >= ${startedAt}`;
    }
  } else {
    console.log("   (skipped: needs HR_ADMIN_*, EXPENDITURE_ADMIN_* and SUPER_ADMIN_* set to zzr-... test addresses with passwords)");
  }

  section("7d. The Approval Forms are for everyone; the sidebar's Approval System follows what is ticked");
  const aprItem = (page) => page.locator("aside").first().getByRole("button", { name: "Approval System" });
  const aprLinks = async (page) => (await page.locator("aside").first().locator("a[href^='/approvals/']").allInnerTexts()).map((t) => t.trim()).join("|");
  await U.goto(BASE + "/");
  const formCards = U.locator('section[aria-labelledby="approval-forms-title"]');
  check("a plain user nobody ticked anything for has the Approval Forms on their home page: HR Approval Form and Expenditure Approval Form", (await formCards.count()) === 1 && (await formCards.getByRole("link", { name: /HR Approval Form/ }).getAttribute("href")) === "/approvals/hr/new" && (await formCards.getByRole("link", { name: /Expenditure Approval Form/ }).getAttribute("href")) === "/approvals/expenses/new");
  check("the Super Admin (the DG), who has no applications, has them too", await (async () => { await S.goto(BASE + "/"); return (await S.locator('section[aria-labelledby="approval-forms-title"]').getByRole("link").count()) === 2; })());
  await U.goto(BASE + "/");
  await formCards.getByRole("link", { name: /HR Approval Form/ }).click();
  await U.waitForURL(/\/approvals\/hr\/new/, { timeout: 20000 }).catch(() => {});
  check("the HR card opens the HR form", new URL(U.url()).pathname === "/approvals/hr/new" && (await U.locator("main form").count()) >= 1);
  check("the Expenses and DG Expenditure forms, and the bare /approvals address, open for them too", (await U.goto(BASE + "/approvals/expenses/new")).status() === 200 && (await U.goto(BASE + "/approvals/expenditures/new")).status() === 200 && (await U.goto(BASE + "/approvals").then(() => new URL(U.url()).pathname)) === "/approvals/expenses/new");
  await U.goto(BASE + "/");
  check("with nothing ticked they have no Approval System item in the sidebar (the cards are their way in)", (await aprItem(U).count()) === 0);
  await visit(A, `/administrator/users/${plain.id}`, ADMIN_PW);
  check("the Application access box lists HR Approval and Expenditure Approval under the category Approval System, and no single 'Approvals'", (await A.locator("main label", { hasText: "HR Approval" }).count()) >= 1 && (await A.locator("main label", { hasText: "Expenditure Approval" }).count()) >= 1 && /Approval System/.test(await main(A)) && (await A.locator("main label", { hasText: /^\s*Approvals\s*$/ }).count()) === 0);
  await A.locator("main label", { hasText: "HR Approval" }).getByRole("checkbox").first().check();
  await A.getByRole("button", { name: "Save access" }).click();
  check("ticking HR Approval is saved", await toast(A, "Access saved") && await poll(async () => (await sql`select count(*)::int n from user_app_access ua join apps a on a.id = ua.app_id where ua.user_id = ${plain.id} and a.url = '/approvals/hr/new'`)[0].n === 1));
  await U.goto(BASE + "/");
  await aprItem(U).click();
  check("they then see Approval System in the sidebar with HR Approval only", (await aprLinks(U)) === "HR Approval", await aprLinks(U));
  await A.locator("main label", { hasText: "Expenditure Approval" }).getByRole("checkbox").first().check();
  await A.getByRole("button", { name: "Save access" }).click();
  check("ticking Expenditure Approval as well is saved", await toast(A, "Access saved") && await poll(async () => (await sql`select count(*)::int n from user_app_access ua join apps a on a.id = ua.app_id where ua.user_id = ${plain.id} and a.url in ('/approvals/hr/new', '/approvals/expenses/new')`)[0].n === 2));
  await U.goto(BASE + "/");
  if ((await aprLinks(U)) === "") await aprItem(U).click();
  check("and both applications are listed", (await aprLinks(U)) === "HR Approval|Expenditure", await aprLinks(U));
  check("the Support Admin has the cards and both applications too", (await A.goto(BASE + "/").then(() => A.locator('section[aria-labelledby="approval-forms-title"]').getByRole("link").count())) === 2 && (await A.goto(BASE + "/approvals/hr/new")).status() === 200);

  section("8. Console and untouched data");
  check("no browser console or page errors on any screen", consoleErrors.length === 0 && pageErrors.length === 0, [...consoleErrors, ...pageErrors].join(" | "));
} catch (e) {
  check("the suite ran to the end without an unexpected error", false, e.stack || e);
} finally {
  await browser.close().catch(() => {});
  await removeTestData().catch((e) => console.error("CLEANUP FAILED, run again to retry:", e.message));
  check("everything that was there before is exactly as before", (await snap()) === before);
}

const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed${failed ? `, ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
