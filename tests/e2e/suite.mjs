/**
 * End-to-end test of the whole hub in a real browser. Run: E2E_BASE_URL=https://your-site npm run test:e2e
 *
 * It WRITES to the database the site uses: it creates departments, apps and users whose names start with "ZZ"/"zz-",
 * and removes them (and the launches it made) when it finishes. It also checks that your real data is unchanged.
 * Env: E2E_BASE_URL (required), E2E_BROWSER = chromium (default) | firefox | webkit, E2E_CHROME_CHANNEL (default "chrome").
 * Firefox and WebKit need a one-time `npx playwright-core install firefox webkit`.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const req = createRequire(ROOT + "/package.json");
req("dotenv").config({ path: ROOT + "/.env" });
const BASE = (process.env.E2E_BASE_URL || "").replace(/\/$/, "");
if (!BASE) { console.error("Set E2E_BASE_URL, for example: E2E_BASE_URL=http://localhost:3000 npm run test:e2e"); process.exit(2); }
const BROWSER = process.env.E2E_BROWSER || "chromium";
const { neon } = req("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);
const playwright = req("playwright-core");
const SP = fs.mkdtempSync(path.join(os.tmpdir(), "hub-e2e-"));
const launch = () => BROWSER === "chromium"
  ? playwright.chromium.launch({ channel: process.env.E2E_CHROME_CHANNEL || "chrome", headless: true }).catch(() => playwright.chromium.launch({ headless: true }))
  : playwright[BROWSER].launch({ headless: true });
console.log(`Testing ${BASE} in ${BROWSER}`);
const res = []; const check = (n, ok, x = "") => { res.push([n, !!ok]); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${x !== "" ? "  -> " + String(x).slice(0, 220) : ""}`); };
const section = (t) => console.log(`\n== ${t} ==`);
const startedAt = new Date();
const snap = async () => ({
  departments: (await sql`select name,is_active from departments where name not like 'ZZ%' order by sort_order,name`),
  apps: await sql`select a.name,a.is_active,d.name dept from apps a join departments d on d.id=a.department_id where a.name not like 'ZZ%' order by a.name`,
  users: await sql`select email,role,is_active from users where email not like 'zz-%' order by email`,
});
const before = await snap();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1300, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
const consoleErrors = [], pageErrors = [], dialogs = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160)); });
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 160)));
page.on("dialog", async (d) => { dialogs.push(d.message()); await d.dismiss(); });
const go = async (p) => { await page.goto(BASE + p); await page.waitForLoadState("networkidle").catch(() => {}); };
const main = async () => (await page.locator("main").first().innerText());
const toast = async (t) => page.getByText(t).first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
const dep = async (name) => (await sql`select * from departments where name=${name}`)[0];
const app = async (name) => (await sql`select * from apps where name=${name}`)[0];
const sidebarLink = (n) => page.locator("aside:visible").getByRole("link", { name: n, exact: true });

try {
  section("1. Hub: first load, navigation, search");
  const r0 = await page.goto(BASE + "/"); await page.waitForLoadState("networkidle").catch(() => {});
  check("home returns 200 with no login", r0.status() === 200 && page.url() === BASE + "/", r0.status());
  const realDeps = before.departments.filter((d) => d.is_active).map((d) => d.name);
  const links = await page.locator("aside:visible nav a").allInnerTexts();
  check("sidebar lists every active department", realDeps.every((n) => links.some((l) => l.trim() === n)), links.map((s) => s.trim()).join(" | "));
  check("hub shows who it is acting as", (await page.content()).includes("HEAD ADMIN") || (await page.content()).toLowerCase().includes("head admin"));
  for (const d of realDeps) { await sidebarLink(d).click(); await page.waitForFunction((x) => document.querySelector("main h1")?.innerText.trim() === x, d, { timeout: 15000 }).catch(() => {}); const h = await page.locator("main h1").first().innerText(); if (h.trim() !== d) check("department page title for " + d, false, h); }
  check("each department link opens its own page", true);
  await sidebarLink("Finance").click(); await page.waitForFunction(() => document.querySelector("main h1")?.innerText.trim() === "Finance", null, { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(800);
  const fin = await main(); const finApps = before.apps.filter((a) => a.dept === "Finance" && a.is_active).map((a) => a.name);
  check("Finance page shows its active apps", finApps.every((n) => fin.includes(n)), finApps.join(", "));
  await page.getByPlaceholder("Search applications").fill("payment"); await page.waitForTimeout(500);
  check("search finds apps across departments", (await main()).includes("Search results"));
  await page.getByPlaceholder("Search applications").fill("zzqqxx-nothing"); await page.waitForTimeout(500);
  check("search with no match shows an empty message", /0 applications|No applications/i.test(await main()));
  await page.getByPlaceholder("Search applications").fill("");

  section("2. Launch redirect and bad ids");
  const firstApp = before.apps.find((a) => a.is_active); const firstRow = (await sql`select id,url from apps where name=${firstApp.name}`)[0];
  const lr = await page.request.get(BASE + "/go/" + firstRow.id, { maxRedirects: 0 });
  check("/go/<app> redirects to the app's URL", lr.status() === 302 && lr.headers().location === firstRow.url, lr.headers().location);
  check("/go/not-a-uuid is 404", (await page.request.get(BASE + "/go/not-a-uuid", { maxRedirects: 0 })).status() === 404);
  check("/go/<unknown uuid> is 404", (await page.request.get(BASE + "/go/00000000-0000-4000-8000-000000000000", { maxRedirects: 0 })).status() === 404);
  const nf = await page.goto(BASE + "/this-page-does-not-exist"); check("unknown page is a branded 404", nf.status() === 404 && (await page.content()).includes("Page not found"));
  const hh = (await page.request.get(BASE + "/")).headers();
  check("security headers present", hh["x-frame-options"] === "DENY" && hh["x-content-type-options"] === "nosniff" && !!hh["referrer-policy"], `${hh["x-frame-options"]} / ${hh["x-content-type-options"]}`);
  check("login routes are gone", (await page.request.get(BASE + "/login")).status() === 404 && (await page.request.get(BASE + "/api/auth/session")).status() === 404);

  section("3. Departments: add, duplicate, edit, reorder, deactivate");
  await go("/administrator/departments");
  const addDept = async (name) => { await page.getByRole("button", { name: /Add department/ }).click(); const f = page.locator("form").filter({ has: page.getByRole("button", { name: "Create department" }) }); await f.locator("input").first().fill(name); await f.getByRole("button", { name: "Create department" }).click(); };
  await addDept("ZZ Dept A"); check("add department shows a success message", await toast("Department created"));
  const dA = await dep("ZZ Dept A"); check("department saved with a slug and active", dA && dA.slug === "zz-dept-a" && dA.is_active);
  const maxReal = (await sql`select max(sort_order)::int m from departments where name not like 'ZZ%'`)[0].m; check("a new department is added at the END of the list", dA.sort_order > maxReal, dA.sort_order + " > " + maxReal);
  await page.waitForTimeout(1500); await addDept("ZZ Dept A");
  check("duplicate department name is refused", await toast("already exists"));
  await page.waitForTimeout(500); await page.reload(); await page.waitForLoadState("networkidle");
  await page.locator("tr", { hasText: "ZZ Dept A" }).getByRole("button", { name: "Edit" }).click();
  const ef = page.locator("form").filter({ has: page.getByRole("button", { name: "Save" }) }); await ef.locator("input").first().fill("ZZ Dept A2"); await ef.getByRole("button", { name: "Save" }).click();
  check("edit department shows a success message", await toast("Department saved")); await page.waitForTimeout(800);
  check("rename persisted (name and slug)", (await dep("ZZ Dept A2"))?.slug === "zz-dept-a2");
  await page.reload(); await page.waitForLoadState("networkidle"); await addDept("ZZ Dept B"); await toast("Department created"); await page.waitForTimeout(1500); await page.reload(); await page.waitForLoadState("networkidle");
  const order = async () => (await sql`select name from departments where name like 'ZZ Dept%' order by sort_order,name`).map((r) => r.name);
  const o1 = await order(); await page.locator("tr", { hasText: "ZZ Dept A2" }).getByRole("button", { name: "Move down" }).click(); await toast("Reordered"); await page.waitForTimeout(1200);
  const o2 = await order(); check("move down changes the order", JSON.stringify(o1) !== JSON.stringify(o2), o1.join(">") + " => " + o2.join(">"));
  await page.reload(); await page.waitForLoadState("networkidle");
  await page.locator("tr", { hasText: "ZZ Dept B" }).getByRole("button", { name: "Active" }).click(); await page.waitForTimeout(2000);
  check("deactivating a department saves", (await dep("ZZ Dept B")).is_active === false);
  await go("/"); check("inactive department disappears from the hub sidebar", (await sidebarLink("ZZ Dept B").count()) === 0 && (await sidebarLink("ZZ Dept A2").count()) === 1);
  await go("/administrator/departments"); await page.locator("tr", { hasText: "ZZ Dept B" }).getByRole("button", { name: "Inactive" }).click(); await page.waitForTimeout(2000);
  check("reactivating it brings it back", (await dep("ZZ Dept B")).is_active === true);

  section("4. Applications: validation, XSS, scoping, active flag");
  await go("/administrator/departments"); await page.locator("main").getByRole("link", { name: "ZZ Dept A2" }).click(); await page.waitForURL(/departments\/[0-9a-f-]{36}/); const deptUrl = page.url();
  const addApp = async (name, url, opts = {}) => { await page.getByRole("button", { name: /^Add application/ }).first().click(); const f = page.locator("form").filter({ has: page.getByRole("button", { name: "Add application" }) }); await f.locator("input").nth(0).fill(name); if (opts.desc) await f.locator("input").nth(1).fill(opts.desc); await f.locator("input[type=url]").fill(url); if (opts.inactive) await f.getByRole("checkbox").uncheck(); await f.getByRole("button", { name: "Add application" }).click(); };
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
  await go("/"); await sidebarLink("ZZ Dept A2").click(); await page.waitForTimeout(1200); const hubTxt = await main();
  check("hub shows active apps of the department, not the inactive one", hubTxt.includes("ZZ App Uno") && !hubTxt.includes("ZZ Hidden App"));
  check("hub card shows the XSS-looking name as plain text", hubTxt.includes("<img src=x") && dialogs.length === 0);
  const hid = await app("ZZ Hidden App"); check("/go for an inactive app is 404", (await page.request.get(BASE + "/go/" + hid.id, { maxRedirects: 0 })).status() === 404);
  const l1 = await page.request.get(BASE + "/go/" + (await app("ZZ App Uno")).id, { maxRedirects: 0 }); check("launching an app logs the launch", l1.status() === 302 && (await sql`select count(*)::int n from activity_log where app_id=${(await app("ZZ App Uno")).id} and action='launch'`)[0].n === 1);
  const fRow = await sql`select id from apps where name like '=HYPERLINK%'`; await page.request.get(BASE + "/go/" + fRow[0].id, { maxRedirects: 0 });

  section("5. Users: read-only overview and CSV import edge cases");
  await go("/administrator/users");
  const ut = await main(); check("users view is read-only", !/Add user|Create user|Deactivate/.test(ut) && (await page.locator('button[aria-label="Edit"]').count()) === 0);
  const importCsv = async (name, content) => { fs.writeFileSync(SP + "/" + name, content); if (!(await page.getByText(/Choose CSV file/).count())) await page.getByRole("button", { name: /Bulk import/ }).click(); await page.locator("input[type=file]").setInputFiles(SP + "/" + name); };
  // bad files first
  await importCsv("bad1.csv", "email,name\n"); check("header-only file is rejected with a message", await toast("at least one user"));
  await importCsv("bad2.csv", "foo,bar\n1,2"); check("missing email/name columns is rejected", await toast('"email" and "name"'));
  await importCsv("bad3.csv", ""); check("empty file is rejected", await toast("at least one user"));
  fs.writeFileSync(SP + "/big.csv", "email,name\n" + "x".repeat(1_100_000)); await page.locator("input[type=file]").setInputFiles(SP + "/big.csv"); check("file over 1 MB is rejected", await toast("over 1 MB"));
  const csv = "﻿" + ["name,email,department,applications,designation,ignored",
    '"Asha Patil",zz-asha@gmail.com,ZZ Dept A2,"ZZ App Uno, ZZ App Uno",Accountant,x',
    '  Mixed Case  ,  ZZ-UP@GMAIL.COM  ,ZZ Dept A2,ZZ App Uno,,',
    '"Line\nBreak",zz-nl@gmail.com,,,,',
    "=1+1,zz-formula@gmail.com,,,,",
    "",
    "Dup One,zz-dup@gmail.com,,,,",
    "Dup Two,ZZ-DUP@gmail.com,,,,",
    "Wrong Domain,zz-bad@yahoo.com,,,,",
    "Bad Dept,zz-baddept@gmail.com,No Such Dept,,,",
    "Bad App,zz-badapp@gmail.com,ZZ Dept A2,No Such App,,",
    ",zz-noname@gmail.com,,,,",
    "Not An Email,not-an-email,,,,"].join("\r\n");
  fs.writeFileSync(SP + "/edge.csv", csv); await page.locator("input[type=file]").setInputFiles(SP + "/edge.csv");
  const importBtn = page.getByRole("button", { name: /^Import \d+ users?/ }); await importBtn.waitFor({ timeout: 10000 });
  check("blank lines are not counted as rows", /Import 11 users/.test(await importBtn.innerText()), await importBtn.innerText());
  await importBtn.click(); await page.getByText(/Finished:/).waitFor({ timeout: 60000 }); const sum = await page.getByText(/Finished:/).innerText();
  check("summary: 5 created, 1 skipped, 5 errors", sum.includes("5 created, 1 skipped, 5 with errors"), sum);
  const u = async (e) => (await sql`select id,name,email,designation,home_department_id from users where email=${e}`)[0];
  const asha = await u("zz-asha@gmail.com"); check("department and designation set; BOM/CRLF handled", asha && asha.home_department_id === dA.id && asha.designation === "Accountant");
  check("same app listed twice gives one grant", (await sql`select count(*)::int n from user_app_access where user_id=${asha.id}`)[0].n === 1);
  check("email is trimmed and lower-cased", !!(await u("zz-up@gmail.com")) && (await u("zz-up@gmail.com")).name === "Mixed Case");
  check("name with a line break in quotes is kept whole", (await u("zz-nl@gmail.com"))?.name === "Line\nBreak");
  check("formula-looking name is stored as plain text", (await u("zz-formula@gmail.com"))?.name === "=1+1");
  check("duplicate email inside one file: first created, second skipped", (await u("zz-dup@gmail.com"))?.name === "Dup One");
  check("wrong domain / unknown department / unknown app / no name / bad email: none created", !(await u("zz-bad@yahoo.com")) && !(await u("zz-baddept@gmail.com")) && !(await u("zz-badapp@gmail.com")) && !(await u("zz-noname@gmail.com")) && !(await u("not-an-email")));
  const rtxt = await main(); check("each error row explains why", /not found|must end|missing|valid email/i.test(rtxt));
  await page.getByRole("button", { name: /Bulk import/ }).click(); await page.waitForTimeout(300);
  await page.getByPlaceholder("Search name, email or application").fill("zz app uno"); await page.waitForTimeout(500);
  const ft = (await main()).toLowerCase(); check("overview search by application name filters users", ft.includes("asha patil") && !ft.includes("line"));
  await page.getByPlaceholder("Search name, email or application").fill("");
  await page.getByLabel("Filter by department").selectOption("ZZ Dept A2"); await page.waitForTimeout(400);
  check("department filter works", (await main()).toLowerCase().includes("asha patil") && /\d of \d+ users/.test(await main()));

  section("6. Access: per user, per app, templates, department Users tab");
  await go("/administrator/access/user/" + asha.id);
  const tree = page.locator("main");
  const boxes = await tree.getByRole("checkbox").count(); check("per-user access page shows a checklist", boxes > 0, boxes + " checkboxes");
  const hiddenBox = tree.locator("label", { hasText: "ZZ Hidden App" }).getByRole("checkbox").first();
  check("access checklist includes inactive apps too", (await tree.locator("label", { hasText: "ZZ Hidden App" }).count()) >= 1);
  await hiddenBox.check(); await page.getByRole("button", { name: "Save access" }).click(); check("save access shows a success message", await toast("Access saved")); await page.waitForTimeout(1000);
  check("access grant saved to the database", (await sql`select count(*)::int n from user_app_access where user_id=${asha.id}`)[0].n === 2);
  await page.getByRole("button", { name: "Untick all" }).click(); await page.getByRole("button", { name: "Save access" }).click(); await toast("Access saved"); await page.waitForTimeout(1000);
  check("untick all + save removes every grant", (await sql`select count(*)::int n from user_app_access where user_id=${asha.id}`)[0].n === 0);
  await go("/administrator/access/app/" + (await app("ZZ App Uno")).id); check("per-app access page opens", /Users with access|ZZ App Uno/.test(await main()));
  await go("/administrator/departments"); await page.locator("main").getByRole("link", { name: "ZZ Dept A2" }).click(); await page.waitForURL(/departments\//); await page.getByRole("tab", { name: /Users/ }).click(); await page.getByText("People whose home department").waitFor({ timeout: 20000 });
  const dut = (await main()).toLowerCase(); check("department Users tab lists its members", dut.includes("asha patil") && dut.includes("mixed case"));

  section("7. Activity log and CSV export");
  await go("/administrator/activity"); const at = await main(); check("activity page lists the launches", at.includes("ZZ App Uno") && /launch/i.test(at));
  const ex = await page.request.get(BASE + "/administrator/activity/export"); const exTxt = await ex.text();
  check("export is a CSV download", ex.status() === 200 && (ex.headers()["content-type"] || "").includes("text/csv") && (ex.headers()["content-disposition"] || "").includes("attachment"), ex.headers()["content-disposition"]);
  check("export has the header row and the launch rows", exTxt.startsWith("User,Email,Action,Application,Department") && exTxt.includes("ZZ App Uno"));
  check("export neutralises formula injection ('=' cell is prefixed)", /(^|,)"?'=HYPERLINK/m.test(exTxt) && !/(^|,)=HYPERLINK/m.test(exTxt), (exTxt.match(/.*HYPERLINK.*/) || [""])[0]);
  const exF = await page.request.get(BASE + "/administrator/activity/export?action=launch"); check("export honours filters", exF.status() === 200);

  section("8. Notifications and navigation");
  await go("/administrator/notifications"); check("notifications panel renders", (await main()).includes("Notifications Panel"));
  await go("/administrator"); check("/administrator redirects to Departments", page.url().endsWith("/administrator/departments"), page.url());
  await go("/administrator/apps"); check("old /administrator/apps redirects", page.url().endsWith("/administrator/departments"), page.url());
  const bad = await page.goto(BASE + "/administrator/departments/not-a-uuid"); check("bad department id shows the not-found page", /Page not found/i.test(await page.content()), bad.status());
  const bad2 = await page.goto(BASE + "/administrator/departments/00000000-0000-4000-8000-000000000000"); check("unknown department id shows the not-found page", /Page not found/i.test(await page.content()), bad2.status());
  const bad3 = await page.goto(BASE + "/administrator/access/user/not-a-uuid"); check("bad user id on access page is a 404", bad3.status() === 404 || bad3.status() === 200 && /not found/i.test(await page.content()), bad3.status());


  section("8b. Access: templates, bulk assign, per-application editor, tick-all");
  const uno = await app("ZZ App Uno");
  const grants = async (email) => (await sql`select a.name from user_app_access g join apps a on a.id=g.app_id join users us on us.id=g.user_id where us.email=${email} order by a.name`).map((r) => r.name).join(",");
  await go("/administrator/access");
  const tabTexts = (await page.locator("nav[aria-label='Access sections'] button").allInnerTexts()).map((s) => s.trim());
  check("access page offers its three views", ["By user & bulk assign", "By application", "Templates"].every((x) => tabTexts.includes(x)), tabTexts.join(" | "));
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

  await page.getByRole("button", { name: "By user & bulk assign" }).click(); await page.waitForTimeout(300);
  await page.getByLabel("Select Asha Patil").check(); await page.getByLabel("Select Mixed Case").check();
  const bulk = page.locator("section", { hasText: "Bulk assign to" });
  const both = async () => [await grants("zz-asha@gmail.com"), await grants("zz-up@gmail.com")];
  await bulk.locator("select").first().selectOption({ label: "ZZ Template (2 apps)" });
  await bulk.getByRole("button", { name: "Add template to selected" }).click(); check("adding a template to two users succeeds", await toast("Template added for 2 user(s)")); await page.waitForTimeout(1500);
  let g = await both(); check("both users now hold the template's two apps", g[0] === "ZZ App Uno,ZZ Hidden App" && g[1] === g[0], g.join(" | "));
  await bulk.locator("label", { hasText: "ZZ Hidden App" }).getByRole("checkbox").check();
  await bulk.getByLabel("How to apply").selectOption("remove"); await bulk.getByRole("button", { name: "Apply to selected" }).click();
  check("bulk 'remove' succeeds", await toast("Access updated for 2 user(s)")); await page.waitForTimeout(1500);
  g = await both(); check("remove took only the ticked app away", g[0] === "ZZ App Uno" && g[1] === "ZZ App Uno", g.join(" | "));
  await bulk.getByLabel("How to apply").selectOption("replace"); await bulk.getByRole("button", { name: "Apply to selected" }).click();
  await page.getByRole("button", { name: "Replace", exact: true }).click(); await page.waitForTimeout(2500);
  g = await both(); check("bulk 'replace' (after confirming) leaves exactly the ticked app", g[0] === "ZZ Hidden App" && g[1] === "ZZ Hidden App", g.join(" | "));
  await bulk.getByRole("button", { name: "Replace with template" }).click(); await page.getByRole("button", { name: "Replace", exact: true }).click(); await page.waitForTimeout(2500);
  g = await both(); check("'Replace with template' gives exactly the template's apps", g[0] === "ZZ App Uno,ZZ Hidden App" && g[1] === g[0], g.join(" | "));
  await page.getByRole("button", { name: "Templates" }).click();
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
  const deptBox = page.getByLabel("Select all in ZZ Dept A2"); await deptBox.check();
  const appBox = (n) => page.locator("main label", { hasText: n }).getByRole("checkbox");
  check("ticking a department ticks all of its applications", (await appBox("ZZ App Uno").isChecked()) && (await appBox("ZZ Hidden App").isChecked()) && (await appBox("HYPERLINK").isChecked()));
  await appBox("ZZ Hidden App").uncheck(); check("unticking one app leaves the department partly ticked", await deptBox.evaluate((el) => el.indeterminate && !el.checked));
  await page.getByRole("button", { name: "Save access" }).click(); await toast("Access saved"); await page.waitForTimeout(1500);
  check("partial selection saved (3 of the department's 4 apps)", (await sql`select count(*)::int n from user_app_access where user_id=${dupU.id}`)[0].n === 3);

  section("8c. Icon pickers (department and application forms)");
  await go("/administrator/departments"); await page.locator("tr", { hasText: "ZZ Dept A2" }).getByRole("button", { name: "Edit" }).click();
  const ie = page.locator("form").filter({ has: page.getByRole("button", { name: "Save" }) });
  await ie.getByPlaceholder("Search icons").fill("wallet"); await page.waitForTimeout(300);
  const opts = ie.getByRole("option"); const titles = await opts.evaluateAll((els) => els.map((e) => e.title.toLowerCase()));
  check("icon search narrows the list to matching icons", titles.length >= 1 && titles.length <= 4 && titles.every((x) => x.includes("wallet")), titles.join(","));
  await ie.getByPlaceholder("Search icons").fill("zzqqx"); check("an icon search with no match says so", (await ie.innerText()).includes("No icons match"));
  await ie.getByPlaceholder("Search icons").fill("wallet"); await opts.first().click();
  check("the clicked icon is marked selected", (await opts.first().getAttribute("aria-selected")) === "true");
  await ie.getByRole("button", { name: "Save" }).click(); await toast("Department saved"); await page.waitForTimeout(1500);
  check("department icon saved", (await dep("ZZ Dept A2")).icon === "Wallet", (await dep("ZZ Dept A2")).icon);
  await page.goto(deptUrl); await page.waitForLoadState("networkidle").catch(() => {});
  await page.locator("tr", { hasText: "ZZ App Uno" }).getByRole("button", { name: "Edit" }).click();
  const ia = page.locator("form").filter({ has: page.getByRole("button", { name: "Save" }) });
  await ia.getByPlaceholder("Search icons").fill("globe"); await ia.getByRole("option").first().click(); await ia.getByRole("button", { name: "Save" }).click(); await toast("Application saved"); await page.waitForTimeout(1500);
  check("application icon saved", (await app("ZZ App Uno")).icon === "Globe", (await app("ZZ App Uno")).icon);

  section("9. Phone-sized screen");
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, ...(BROWSER === "firefox" ? {} : { isMobile: true, hasTouch: true }) }); const mp = await m.newPage();
  const mErr = []; mp.on("pageerror", (e) => mErr.push(String(e).slice(0, 120)));
  const noOverflow = async (p, label) => { const pg = await m.newPage(); pg.on("pageerror", (e) => mErr.push(String(e).slice(0, 120))); await pg.goto(BASE + p); await pg.waitForLoadState("networkidle").catch(() => {}); const o = await pg.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })); check("no sideways page scroll on " + label, o.sw <= o.iw + 1, `${o.sw} vs ${o.iw}`); await pg.close(); };
  await mp.goto(BASE + "/"); await mp.waitForLoadState("networkidle").catch(() => {});
  const sb = async () => { const b = await mp.locator("aside").last().boundingBox(); return b && b.x + b.width > 1; };
  check("sidebar is off-screen until the menu button is pressed", !(await sb()));
  await mp.getByRole("button", { name: "Open menu" }).click(); await mp.waitForTimeout(500);
  check("menu button slides the sidebar in", await sb());
  await mp.locator("aside").last().getByRole("button", { name: "Administrator" }).click(); await mp.waitForTimeout(300);
  check("Administrator expands to three sections on a phone", (await mp.locator("aside").last().locator("a[href^='/administrator/']").count()) === 3);
  await mp.locator("aside").last().locator("a[href='/administrator/users']").click(); await mp.waitForURL("**/administrator/users"); await mp.waitForLoadState("networkidle").catch(() => {}); check("tapping a section navigates", mp.url().endsWith("/administrator/users"), mp.url());
  for (const [p, l] of [["/", "home"], ["/administrator/departments", "departments"], ["/administrator/users", "users"], ["/administrator/access", "access"], ["/administrator/activity", "activity"], ["/administrator/notifications", "notifications"], [deptUrl.replace(BASE, ""), "department detail"]]) await noOverflow(p, l);
  check("no script errors on the phone layout", mErr.length === 0, mErr.join(" | "));
  await m.close();

  section("10. Speed and browser health");
  const times = []; for (let i = 0; i < 3; i++) { const t = Date.now(); await page.request.get(BASE + "/"); times.push(Date.now() - t); } times.sort((a, b) => a - b);
  check("home page responds in under 3 seconds (median of 3)", times[1] < 3000, times.join("ms, ") + "ms");
  // WebKit reports a background page prefetch that the test cancelled by navigating away as an "access control" error; that is not a bug.
  const real = consoleErrors.filter((e) => !/favicon|Failed to load resource.*(404|40\d)|_rsc=.*access control/i.test(e)); const realPage = pageErrors.filter((e) => !/_rsc=.*access control/i.test(e));
  check("no JavaScript errors in the browser console", real.length === 0 && realPage.length === 0, real.concat(realPage).join(" | "));
  check("no alert/confirm dialogs were ever triggered", dialogs.length === 0, dialogs.join(","));
} catch (e) { console.log("\nTEST ERROR:", String(e).split("\n").slice(0, 3).join(" | ")); res.push(["test crashed", false]); } finally {
  await browser.close();
  section("Cleanup and data-safety check");
  const zzUsers = (await sql`select id from users where email like 'zz-%'`).map((r) => r.id);
  for (const id of zzUsers) { await sql`delete from user_app_access where user_id=${id}`; await sql`delete from activity_log where user_id=${id}`; }
  await sql`delete from users where email like 'zz-%'`;
  await sql`delete from access_templates where name like 'ZZ%'`;
  await sql`delete from activity_log where opened_at >= ${startedAt} and action='launch'`;
  await sql`delete from apps where name like 'ZZ%' or name like '<img%' or name like '=HYPERLINK%'`;
  await sql`delete from departments where name like 'ZZ%'`;
  const after = await snap();
  check("your real departments, apps and users are exactly as before", JSON.stringify(before) === JSON.stringify(after), JSON.stringify(before) === JSON.stringify(after) ? "" : "DIFFERENT");
  const left = (await sql`select (select count(*) from users where email like 'zz-%') u,(select count(*) from apps where name like 'ZZ%' or name like '<img%' or name like '=HYPERLINK%') a,(select count(*) from departments where name like 'ZZ%') d`)[0];
  check("all test data removed", left.u == 0 && left.a == 0 && left.d == 0, JSON.stringify(left));
  const failed = res.filter(([, ok]) => !ok); console.log(`\n${res.length - failed.length}/${res.length} checks passed`); if (failed.length) console.log("FAILED:\n - " + failed.map(([n]) => n).join("\n - "));
  fs.rmSync(SP, { recursive: true, force: true });
  process.exit(failed.length ? 1 : 0);
}
