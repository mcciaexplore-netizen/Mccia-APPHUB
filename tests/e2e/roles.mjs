/**
 * End-to-end test of the roles in a real browser: the Support Admin (the environment account), Admins whose areas of Administrator are
 * switched on one by one, the Super Admin, HR Admin and Expense Admin (one person each), plain users, and the protections around them:
 * the Administrator lock (including the Approval System's admin pages), the sign-in limits, and the temporary password that must be
 * changed at the first sign-in. Run:
 *   E2E_BASE_URL=http://localhost:3000 npm run test:e2e:roles
 *
 * It WRITES to the database the site uses, but only rows named "ZZR"/"zzr-": one department with an application and a few people with
 * different roles. Everything is removed when it finishes (and at the start, if an earlier run was interrupted), including the audit
 * entries and sign-in attempts this run caused, and it confirms that everything else is exactly as before. It refuses a Neon database
 * unless E2E_ALLOW_NEON=yes (use a Neon branch, never the live one), and a database where real people hold the Super Admin, HR Admin or
 * Expense Admin roles (the test makes its own). The site must run with no email set up (SMTP_HOST empty), so temporary passwords are
 * shown on screen. Env: E2E_BROWSER = chromium (default) | firefox | webkit, E2E_CHROME_CHANNEL (default "chrome").
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
if (/neon\.tech/i.test(process.env.DATABASE_URL || "") && process.env.E2E_ALLOW_NEON !== "yes") { console.error("DATABASE_URL is a Neon address. Point it (and the site) at a test database, or a Neon branch with E2E_ALLOW_NEON=yes."); process.exit(2); }
const ADMIN_EMAIL = (process.env.SUPPORT_ADMIN_EMAIL || process.env.HEAD_ADMIN_EMAIL || "").trim().toLowerCase();
const ADMIN_PW = (process.env.SUPPORT_ADMIN_PASSWORD || process.env.HEAD_ADMIN_PASSWORD || "").trim();
if (!ADMIN_EMAIL || !ADMIN_PW) { console.error("SUPPORT_ADMIN_EMAIL and SUPPORT_ADMIN_PASSWORD (or HEAD_ADMIN_*) must be set, the same as the site's: the suite signs in as the Support Admin."); process.exit(2); }
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
const check = (name, ok, extra = "") => { results.push([name, !!ok]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? "  -> " + String(extra).slice(0, 240) : ""}`); };
const section = (t) => console.log(`\n== ${t} ==`);
const poll = async (fn, ms = 20000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 400)); } return v; };
const hash = (pw) => { const salt = randomBytes(16); return `scrypt$16384$${salt.toString("base64")}$${scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("base64")}`; };
const PW = "zzr-Test-pass-123";
const startedAt = new Date();

const holders = await sql`select count(*)::int n from users where role in ('super_admin','hr_admin','expense_admin') and email not like 'zzr-%'`;
if (holders[0].n > 0) { console.error("This database already has a Super Admin, HR Admin or Expense Admin. Use a test database: the suite makes its own."); process.exit(2); }

const removeTestData = async () => {
  await sql`delete from access_audit where at >= ${new Date(startedAt.getTime() - 60000)}`;
  await sql`delete from login_attempts where email like 'zzr-%' or (email = ${ADMIN_EMAIL} and created_at >= ${new Date(startedAt.getTime() - 60000)})`;
  const ids = (await sql`select id from users where email like 'zzr-%'`).map((r) => r.id);
  for (const id of ids) { await sql`delete from user_app_access where user_id = ${id}`; await sql`delete from activity_log where user_id = ${id}`; await sql`delete from user_invites where user_id = ${id}`; await sql`delete from hub_notifications where user_id = ${id}`; }
  await sql`delete from users where email like 'zzr-%'`;
  await sql`delete from apps where name like 'ZZR%'`;
  await sql`delete from departments where name like 'ZZR%'`;
  await sql`delete from apr_categories where name like 'ZZR%'`;
  await sql`delete from apr_admin_audit where created_at >= ${new Date(startedAt.getTime() - 60000)}`;
};
const snap = async () => JSON.stringify([
  await sql`select name,is_active from departments where name not like 'ZZR%' order by name`,
  await sql`select name,url,is_active,status from apps where name not like 'ZZR%' order by name`,
  await sql`select email,role,is_active,admin_areas from users where email not like 'zzr-%' order by email`,
  await sql`select user_id,app_id from user_app_access where user_id in (select id from users where email not like 'zzr-%') order by user_id, app_id`,
  await sql`select name,active from apr_categories where name not like 'ZZR%' order by name`,
  await sql`select form,key,label,hidden from apr_form_fields order by form,key`,
]);

await removeTestData();
const before = await snap();
const browser = await launch();
const consoleErrors = [], pageErrors = [];
const newSession = async (headers = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 1000 }, extraHTTPHeaders: headers });
  ctx.setDefaultTimeout(45000); ctx.setDefaultNavigationTimeout(90000);
  // The "Download the app" popup and banner are tested on their own; here they are marked as already seen so they never cover a button.
  await ctx.addInitScript(() => { try { localStorage.setItem("mccia-install-popup-seen", "1"); localStorage.setItem("mccia-install-snoozed-until", String(Date.now() + 864e5)); } catch {} });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Content Security Policy/.test(m.text())) consoleErrors.push(m.text().slice(0, 160)); });
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 160)));
  return { ctx, page };
};
const signIn = async (page, email, password) => {
  await page.goto(BASE + "/login");
  await page.locator("input[name=email]").fill(email); await page.locator("input[name=password]").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => u.pathname !== "/login" || u.search.includes("error"), { timeout: 25000 }).catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  // A redirect made by the page that opens next (to /change-password, for example) lands a moment later.
  let last = "";
  for (let i = 0; i < 6; i++) { const now = page.url(); if (now === last) break; last = now; await page.waitForTimeout(600); await page.waitForLoadState("networkidle").catch(() => {}); }
  return new URL(page.url());
};
/** Opens a page; if Administrator asks for the password, gives this person's own. */
const visit = async (page, p, pw) => {
  await page.goto(BASE + p);
  if (new URL(page.url()).pathname === "/unlock" && pw) {
    await page.locator("input[name=password]").fill(pw); await page.getByRole("button", { name: "Unlock" }).click();
    await page.waitForURL((u) => u.pathname !== "/unlock", { timeout: 20000 }).catch(() => {});
  }
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForFunction(() => (document.querySelector("main")?.innerText ?? "").trim().length > 0, null, { timeout: 30000 }).catch(() => {});
  let last = "";
  for (let i = 0; i < 8; i++) { const now = new URL(page.url()).pathname; if (now === last) break; last = now; await page.waitForTimeout(700); await page.waitForLoadState("networkidle").catch(() => {}); }
  return new URL(page.url()).pathname;
};
const toast = (page, t) => page.getByText(t).first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
const main = (page) => page.locator("main").first().innerText();
/** The lines of the Administrator sidebar. */
const adminNav = async (page) => (await page.locator('nav[aria-label="Administrator"] a').allInnerTexts()).map((t) => t.trim());
/** Whether the home page offers Administrator (its card). */
const homeHasAdministrator = async (page) => { await page.goto(BASE + "/"); await page.waitForLoadState("networkidle").catch(() => {}); return /\bAdministrator\b/.test(await main(page)); };
const roleChoices = (page, scope = page) => scope.getByLabel("Role").locator("option").evaluateAll((os) => os.map((o) => o.textContent + (o.disabled ? " [x]" : "")));

try {
  // ---- fixtures: people with every role, and one department with an application
  const mk = async (key, role, areas = []) => (await sql`insert into users (name, email, role, admin_areas, password_hash, status, signup_source) values (${"ZZR " + key}, ${"zzr-" + key.toLowerCase().replace(/\s+/g, "-") + "@example.com"}, ${role}::role, ${areas}, ${hash(PW)}, 'approved', 'test') returning id, email, name`)[0];
  const sup = await mk("Super", "super_admin");
  const hrA = await mk("HR Admin", "hr_admin");
  const adm = await mk("Admin People", "admin", ["people"]);
  const none = await mk("Admin None", "admin");
  const org = await mk("Admin Org", "admin", ["org", "audit"]);
  const plain = await mk("Plain One", "member");
  const plain2 = await mk("Plain Two", "member");
  const [dept] = await sql`insert into departments (name, slug, icon, sort_order) values ('ZZR Dept', 'zzr-dept', 'Building2', 9200) returning id`;
  const [app] = await sql`insert into apps (name, description, url, icon, department_id, sort_order) values ('ZZR App', 'Test app', 'https://example.com/zzr', 'AppWindow', ${dept.id}, 1) returning id`;

  const A = (await newSession()).page, S = (await newSession()).page, H = (await newSession()).page, P = (await newSession()).page, N = (await newSession()).page, O = (await newSession()).page, U = (await newSession()).page;
  await Promise.all([signIn(A, ADMIN_EMAIL, ADMIN_PW), signIn(S, sup.email, PW), signIn(H, hrA.email, PW), signIn(P, adm.email, PW), signIn(N, none.email, PW), signIn(O, org.email, PW), signIn(U, plain.email, PW)]);
  const envAdmin = (await sql`select id, name from users where lower(email) = ${ADMIN_EMAIL}`)[0];

  // ------------------------------------------------------------------------------------------------------------------------------
  section("1. The Support Admin (the environment account)");
  check("the home page offers Administrator", await homeHasAdministrator(A));
  await visit(A, "/administrator/users", ADMIN_PW);
  check("the Administrator sidebar has the main sections, then Settings & Administration", JSON.stringify(await adminNav(A)) === JSON.stringify(["Dashboard", "Users", "Applications", "Activity Log", "Approval Forms", "HR", "Expenditure", "Notification Panel"]), (await adminNav(A)).join("|"));
  const dir = await main(A);
  check("the directory lists everyone, the Super Admin and every Admin included", [sup, hrA, adm, none, org].every((p) => dir.includes(p.name)));
  const roleFilter = await A.getByLabel("Filter by role").locator("option").allInnerTexts();
  check("the role filter knows every role", ["Super admin", "Expense admin", "HR admin", "Admin", "User", "Support admin"].every((t) => roleFilter.includes(t)), roleFilter.join(","));
  check("the Support Admin's own row has no Delete and no way to deactivate themselves", (await A.locator("tr", { hasText: envAdmin.name }).first().getByRole("button", { name: /Delete/ }).count()) === 0 && (await A.locator("tr", { hasText: envAdmin.name }).first().getByTitle("Click to deactivate").count()) === 0);

  section("2. The Role dropdown: one Super Admin, one HR Admin, one Expense Admin");
  await visit(A, `/administrator/users/${plain2.id}`, ADMIN_PW);
  const choices = await roleChoices(A);
  check("the Role box offers Super Admin, Expense Admin, HR Admin, Admin and User, and says who holds the one-person roles", JSON.stringify(choices) === JSON.stringify([`Super Admin (taken by ${sup.name}) [x]`, "Expense Admin", `HR Admin (taken by ${hrA.name}) [x]`, "Admin", "User"]), choices.join("|"));
  await A.getByLabel("Role").selectOption("expense_admin");
  await A.getByRole("button", { name: "Save details" }).click();
  check("a free one-person role can be given, and it is stored", await toast(A, "Details saved") && await poll(async () => (await sql`select role from users where id = ${plain2.id}`)[0].role === "expense_admin"));
  await visit(A, `/administrator/users/${plain.id}`, ADMIN_PW);
  check("then it shows as taken for everyone else", (await roleChoices(A)).includes(`Expense Admin (taken by ${plain2.name}) [x]`));
  check("the person's page lists what they approve", /Approves or rejects expenses below/.test(await (async () => { await visit(A, `/administrator/users/${plain2.id}`, ADMIN_PW); return main(A); })()));
  await A.getByLabel("Role").selectOption("member");
  await A.getByRole("button", { name: "Save details" }).click();
  check("and it can be taken back", await poll(async () => (await sql`select role from users where id = ${plain2.id}`)[0].role === "member"));
  check("the role changes are in the audit log", (await sql`select count(*)::int n from access_audit where action = 'user.update' and target_id = ${plain2.id}`)[0].n >= 2);

  section("3. The Support Admin gives an Admin their areas");
  await visit(A, `/administrator/users/${none.id}`, ADMIN_PW);
  const areasBox = A.locator('section[aria-label="What this Admin may open"]');
  check("an Admin's page has the list of what they may open: six boxes, none ticked yet", (await areasBox.count()) === 1 && (await areasBox.getByRole("checkbox").count()) === 6 && (await areasBox.locator("input:checked").count()) === 0);
  await areasBox.getByRole("checkbox", { name: /^Users & access/ }).check();
  await areasBox.getByRole("checkbox", { name: /^Audit log/ }).check();
  await areasBox.getByRole("button", { name: "Save what they may open" }).click();
  check("saving shows a message and stores the two areas", await toast(A, "What this Admin may open is saved") && await poll(async () => JSON.stringify((await sql`select admin_areas from users where id = ${none.id}`)[0].admin_areas) === JSON.stringify(["people", "audit"])));
  check("and it is in the audit log, with what was switched on", (await sql`select details from access_audit where action = 'user.admin_areas' and target_id = ${none.id}`).some((r) => JSON.stringify(r.details.added) === JSON.stringify(["people", "audit"])));
  await sql`update users set admin_areas = '{}' where id = ${none.id}`; // back to nothing for the sections below
  await visit(A, `/administrator/users/${plain.id}`, ADMIN_PW);
  check("a plain user's page has no areas section", (await A.locator('section[aria-label="What this Admin may open"]').count()) === 0);

  section("4. The Super Admin and the HR Admin: users in the hub, approvers in the Approval System");
  check("the Super Admin has no Administrator, and its address sends them home", !(await homeHasAdministrator(S)) && (await visit(S, "/administrator/users")) === "/");
  check("so does the HR Admin", !(await homeHasAdministrator(H)) && (await visit(H, "/administrator")) === "/");
  await visit(H, "/approvals");
  check("the HR Admin's Approval System has their HR lists, and no Expenditure lists", /Pending HR Approvals/.test(await H.locator('nav[aria-label="Approval System"]').innerText()) && !/Expenditure Approvals/.test(await H.locator('nav[aria-label="Approval System"]').innerText()));
  await visit(U, "/approvals");
  check("a plain user's Approval System has the forms and their own approved forms only", (await U.locator('nav[aria-label="Approval System"] a').allInnerTexts()).map((t) => t.replace(/\d+$/, "").trim()).join("|") === "Approval Forms|Approved Forms");
  check("the Approval System's admin pages are not theirs", (await U.goto(BASE + "/approvals/admin/categories").then(() => new URL(U.url()).pathname)) !== "/approvals/admin/categories");
  await visit(A, `/administrator/users/${sup.id}`, ADMIN_PW);
  const giveSup = A.getByRole("switch", { name: "Give access to ZZR App" });
  check("the Support Admin can give the Super Admin an application with its switch", (await giveSup.count()) === 1);
  await giveSup.click();
  await A.getByRole("button", { name: "Save access" }).click();
  check("it is saved", await toast(A, "Access saved") && await poll(async () => (await sql`select count(*)::int n from user_app_access where user_id = ${sup.id} and app_id = ${app.id}`)[0].n === 1));
  check("then the Super Admin can open it", (await S.request.get(BASE + "/go/" + app.id, { maxRedirects: 0 })).status() === 302);
  await visit(A, `/administrator/users/${envAdmin.id}`, ADMIN_PW);
  check("the Support Admin's own access is shown as full, inherited from the role, with the switches locked", /Full access — inherited from Support Admin role/.test(await main(A)) && await A.getByRole("switch").first().isDisabled());

  section("5. An Admin with Users & access");
  check("the home page offers them Administrator, and it opens after unlocking", (await homeHasAdministrator(P)) && (await visit(P, "/administrator", PW)) === "/administrator");
  check("their sidebar is Dashboard, Users and the Notification Panel only", JSON.stringify(await adminNav(P)) === JSON.stringify(["Dashboard", "Users", "Notification Panel"]), (await adminNav(P)).join("|"));
  for (const p of ["/administrator/departments", "/administrator/inventory", "/administrator/users/org", "/administrator/users/import", "/administrator/activity", "/administrator/approval-forms/hr"]) {
    const landed = await visit(P, p, PW);
    check(`${p} is not open to them`, landed === "/administrator" || landed === "/", landed);
  }
  await visit(P, "/administrator/users", PW);
  const pdir = await main(P);
  check("the directory shows plain users, never the Support Admin, the Super Admin, the HR Admin or another Admin", pdir.includes(plain.name) && ![sup, hrA, none, org].some((p) => pdir.includes(p.name)) && !pdir.includes(ADMIN_EMAIL));
  await P.getByRole("button", { name: "Add user" }).first().click();
  check("Add user offers them User only", (await P.getByRole("dialog").getByLabel("Role").locator("option").allInnerTexts()).join("|") === "User");
  await P.keyboard.press("Escape");
  for (const [who, id] of [["the Super Admin", sup.id], ["the HR Admin", hrA.id], ["another Admin", org.id], ["the Support Admin", envAdmin.id]]) {
    await visit(P, `/administrator/users/${id}`, PW);
    check(`the page of ${who} is not found`, /not found|could not be found|doesn.t exist|404/i.test(await P.locator("body").innerText()));
  }
  await visit(P, `/administrator/users/${plain.id}`, PW);
  check("a plain user's page opens with the details editable, the Role box disabled and no Delete", !(await P.getByLabel("Name", { exact: true }).isDisabled()) && (await P.getByLabel("Role").isDisabled()) && (await P.getByRole("button", { name: "Delete" }).count()) === 0);
  await P.getByRole("switch", { name: "Give access to ZZR App" }).click();
  await P.getByRole("button", { name: "Save access" }).click();
  check("they can give a plain user an application, and the audit entry names them", await toast(P, "Access saved") && await poll(async () => (await sql`select count(*)::int n from user_app_access where user_id = ${plain.id} and app_id = ${app.id}`)[0].n === 1) && (await sql`select actor_name from access_audit where action = 'access.change' and target_id = ${plain.id}`).some((r) => r.actor_name === adm.name));

  section("6. An Admin with Branches & teams and the Audit log only");
  check("their sidebar is Dashboard, Users (opening on Branches & teams), Activity Log and the Notification Panel", JSON.stringify(await (async () => { await visit(O, "/administrator", PW); return adminNav(O); })()) === JSON.stringify(["Dashboard", "Users", "Activity Log", "Notification Panel"]) && (await O.locator('nav[aria-label="Administrator"] a', { hasText: "Users" }).getAttribute("href")) === "/administrator/users/org", (await adminNav(O)).join("|"));
  check("the people list is not open to them", (await visit(O, "/administrator/users", PW)) === "/administrator");
  check("the admin changes tab opens, and can be exported", /Admin changes/.test(await (async () => { await visit(O, "/administrator/activity?tab=changes", PW); return O.locator("body").innerText(); })()) && (await O.request.get(BASE + "/administrator/users/audit/export")).status() === 200);

  section("7. An Admin with nothing switched on, and a plain user");
  check("an Admin with nothing switched on has no Administrator, and lands back home", !(await homeHasAdministrator(N)) && (await visit(N, "/administrator")) === "/");
  check("a plain user has none either, even by address, and the exports refuse them", !(await homeHasAdministrator(U)) && (await visit(U, "/administrator/users")) !== "/administrator/users" && !/text\/csv/.test((await U.request.get(BASE + "/administrator/users/audit/export")).headers()["content-type"] ?? ""));

  section("8. The Administrator lock, including the Approval System's admin pages");
  const L = (await newSession()).page;
  await signIn(L, ADMIN_EMAIL, ADMIN_PW);
  await L.goto(BASE + "/approvals/admin/categories");
  check("opening an Approval System admin page while locked asks for the password first", new URL(L.url()).pathname === "/unlock" && new URL(L.url()).searchParams.get("next") === "/approvals/admin/categories");
  await L.locator("input[name=password]").fill("wrong-password-1"); await L.getByRole("button", { name: "Unlock" }).click();
  await L.waitForURL((u) => u.search.includes("error"), { timeout: 15000 }).catch(() => {});
  check("a wrong password keeps it locked", new URL(L.url()).pathname === "/unlock" && /Incorrect password/.test(await L.locator("body").innerText()));
  await L.locator("input[name=password]").fill(ADMIN_PW); await L.getByRole("button", { name: "Unlock" }).click();
  await L.waitForURL((u) => u.pathname !== "/unlock", { timeout: 20000 }).catch(() => {});
  check("the right one opens the page it was going to", new URL(L.url()).pathname === "/approvals/admin/categories");
  const addCat = (page) => page.evaluate(async () => (await fetch("/api/approvals/masters/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: `ZZR Category ${Math.random().toString(36).slice(2, 7)}` }) })).status);
  check("while unlocked, a change through the admin API is accepted", [200, 201].includes(await addCat(L)));
  await L.goto(BASE + "/administrator/users");
  check("moving on to Administrator does not ask again", new URL(L.url()).pathname === "/administrator/users");
  await L.goto(BASE + "/approvals/admin/settings");
  check("and back to an Approval System admin page does not ask either", new URL(L.url()).pathname === "/approvals/admin/settings");
  await L.goto(BASE + "/");
  check("leaving them locks Administrator: the admin API now refuses a change", (await addCat(L)) === 403);
  await L.goto(BASE + "/approvals/admin/categories");
  check("and the admin pages ask for the password again", new URL(L.url()).pathname === "/unlock");

  section("9. Sign-in limits");
  const V = (await newSession()).page;
  for (let i = 0; i < 5; i++) await signIn(V, plain.email, "wrong-password-1");
  const refusedUrl = await signIn(V, plain.email, PW);
  check("after 5 wrong passwords, even the right one is refused for now, with the same message", refusedUrl.pathname === "/login" && refusedUrl.searchParams.get("error") === "1");
  check("the attempts are recorded, the last one as refused", await poll(async () => (await sql`select count(*)::int n from login_attempts where email = ${plain.email} and not success and not blocked`)[0].n === 5 && (await sql`select count(*)::int n from login_attempts where email = ${plain.email} and blocked`)[0].n === 1));
  // Off Vercel the client's address comes from these headers (on Vercel they are set by Vercel and cannot be changed): another place.
  const W = (await newSession({ "x-vercel-forwarded-for": "203.0.113.77" })).page;
  check("the same person signing in from somewhere else is not locked out", (await signIn(W, plain.email, PW)).pathname === "/");
  await visit(A, "/administrator/activity?tab=signins", ADMIN_PW);
  check("the Sign-ins tab shows the refused try", /Refused: too many tries/i.test(await main(A)));
  await sql`delete from login_attempts where email = ${plain.email}`;

  section("10. A temporary password must be changed at the first sign-in");
  await visit(A, "/administrator/users", ADMIN_PW);
  await A.getByRole("button", { name: "Add user" }).first().click();
  const dlg = A.getByRole("dialog");
  await dlg.getByLabel("Name", { exact: true }).fill("ZZR Newcomer");
  await dlg.getByLabel("Email (the username)").fill("zzr-newcomer@gmail.com");
  await dlg.getByRole("button", { name: "Create user" }).click();
  const tempBox = A.getByLabel("Temporary password for ZZR Newcomer");
  check("with no email set up, the temporary password is shown once to pass on", await tempBox.waitFor({ timeout: 20000 }).then(() => true).catch(() => false));
  const temp = await tempBox.inputValue();
  check("the new person shows as a pending invitation", await poll(async () => (await sql`select must_change_password from users where email = 'zzr-newcomer@gmail.com'`)[0]?.must_change_password === true));
  const Z = (await newSession()).page;
  check("signing in with it goes straight to choosing their own password", (await signIn(Z, "zzr-newcomer@gmail.com", temp)).pathname === "/change-password");
  check("other pages send them back there", (await visit(Z, "/approvals")) === "/change-password");
  const api = await Z.evaluate(async () => { const r = await fetch("/api/approvals/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); return { s: r.status, b: await r.text() }; });
  check("and the API refuses them until they do", api.s === 403 && /Choose your own password first/.test(api.b), JSON.stringify(api));
  await Z.getByLabel("Current password").fill(temp);
  await Z.getByLabel("New password", { exact: true }).fill("Zzr-own-pass-123");
  await Z.getByLabel("Repeat new password").fill("Zzr-own-pass-123");
  await Z.getByRole("button", { name: "Save password" }).click();
  check("saving says the password is changed", await toast(Z, "Password changed."));
  check("after choosing their own they use the hub normally", (await visit(Z, "/")) === "/" && (await visit(Z, "/approvals")) === "/approvals");
  check("the temporary password no longer works", (await signIn((await newSession()).page, "zzr-newcomer@gmail.com", temp)).searchParams.get("error") === "1");

  section("11. Approval Forms: the Support Admin changes what the forms ask");
  await visit(A, "/administrator/approval-forms/hr", ADMIN_PW);
  check("the HR form editor lists its eight fields", (await A.getByRole("list", { name: /Fields of the HR form/ }).locator("li").count()) === 8);
  await A.getByLabel("Name of field 6").fill("ZZR Details");
  await A.getByRole("button", { name: "Remove File upload" }).last().click();
  await A.getByLabel("Name", { exact: true }).fill("ZZR Employee code");
  await A.getByRole("checkbox", { name: "Required" }).first().check();
  await A.getByRole("button", { name: "Add field" }).click();
  await A.getByRole("button", { name: "Save this form" }).click();
  check("saving shows a message and stores the new name, the removed field and the extra field", await toast(A, "HR form saved") && await poll(async () => { const r = await sql`select key, label, hidden, builtin, required from apr_form_fields where form = 'hr'`; return r.some((x) => x.key === "description" && x.label === "ZZR Details") && r.some((x) => x.key === "file2" && x.hidden) && r.some((x) => !x.builtin && x.label === "ZZR Employee code" && x.required); }));
  check("a removed field can be restored", (await A.getByRole("button", { name: "Restore File upload" }).count()) === 1);
  await visit(U, "/approvals/hr/new");
  const hrText = await main(U);
  check("the HR form now shows the new name and the extra field, and one file upload instead of two", /ZZR Details/.test(hrText) && /ZZR Employee code/.test(hrText) && (hrText.match(/File upload/g) ?? []).length === 1);
  await U.getByRole("button", { name: "Submit" }).click();
  check("submitting without the required extra field says so", await U.getByText('Fill in "ZZR Employee code".').first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false));
  await sql`delete from apr_form_fields`;
  check("the Admin with areas cannot open the form editor", (await visit(P, "/administrator/approval-forms/hr", PW)) !== "/administrator/approval-forms/hr");

  section("12. Console");
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
