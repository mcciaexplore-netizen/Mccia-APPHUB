/**
 * End-to-end test of the Inventory module's catalogue in a real browser: categories, items, the stock history behind quantity changes,
 * the dashboard figures, and who may do what (Inventory admin, Inventory staff, everyone else). Run against a site with
 * INVENTORY_ENABLED=true:
 *   E2E_BASE_URL=http://localhost:3000 node tests/e2e/inventory.mjs
 *
 * It WRITES to the database the site uses, but only rows named "ZZI"/"zzi-": two categories, a few items and their stock movements, two
 * people and their Inventory roles. Everything is removed when it finishes (and at the start, if an earlier run was interrupted), and it
 * checks that every other inventory row is exactly as before. It refuses a Neon database unless E2E_ALLOW_NEON=yes.
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
if (!BASE) { console.error("Set E2E_BASE_URL, for example: E2E_BASE_URL=http://localhost:3000 node tests/e2e/inventory.mjs"); process.exit(2); }
if (/neon\.tech/i.test(process.env.DATABASE_URL || "") && process.env.E2E_ALLOW_NEON !== "yes") { console.error("Refusing: DATABASE_URL is a Neon database. Use a test database, or set E2E_ALLOW_NEON=yes for a Neon test branch."); process.exit(2); }
const ADMIN_EMAIL = (process.env.HEAD_ADMIN_EMAIL || "").trim().toLowerCase();
const ADMIN_PW = process.env.HEAD_ADMIN_PASSWORD || "";
if (!ADMIN_EMAIL || !ADMIN_PW) { console.error("HEAD_ADMIN_EMAIL and HEAD_ADMIN_PASSWORD must be set: the suite signs in as the main admin (an Inventory admin)."); process.exit(2); }

const rawSql = (() => {
  if ((process.env.DB_DRIVER ?? "neon") !== "pg") return req("@neondatabase/serverless").neon(process.env.DATABASE_URL);
  const pool = new (req("pg").Pool)({ connectionString: process.env.DATABASE_URL, max: 4, ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false });
  return async (strings, ...values) => (await pool.query(strings.reduce((q, s, i) => q + (i ? `$${i}` : "") + s, ""), values)).rows;
})();
const retry = async (fn, tries = 8, waitMs = 3000) => { let last; for (let i = 0; i < tries; i++) { try { return await fn(); } catch (e) { last = e; await new Promise((r) => setTimeout(r, waitMs)); } } throw last; };
const sql = (...a) => retry(() => rawSql(...a));
const playwright = req("playwright-core");
const launch = () => playwright.chromium.launch({ channel: process.env.E2E_CHROME_CHANNEL || "chrome", headless: true }).catch(() => playwright.chromium.launch({ headless: true }));

const results = [];
const check = (name, ok, extra = "") => { results.push([name, !!ok]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? "  -> " + String(extra).slice(0, 220) : ""}`); };
const section = (t) => console.log(`\n== ${t} ==`);
const poll = async (fn, ms = 20000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 400)); } return v; };
const hash = (pw) => { const salt = randomBytes(16); return `scrypt$16384$${salt.toString("base64")}$${scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("base64")}`; };
const PW = "zzi-Test-pass-123";
const startedAt = new Date();

const removeTestData = async () => {
  const items = (await sql`select id from inventory_items where name like 'ZZI%'`).map((r) => r.id);
  for (const id of items) { await sql`delete from inventory_stock_movements where item_id = ${id}`; await sql`delete from inventory_requests where item_id = ${id}`; }
  await sql`delete from inventory_items where name like 'ZZI%'`;
  await sql`delete from inventory_categories where name like 'ZZI%'`;
  await sql`delete from access_audit where action like 'inventory.%' and target_label like 'ZZI%' and at >= ${new Date(startedAt.getTime() - 60000)}`;
  const people = (await sql`select id from users where email like 'zzi-%'`).map((r) => r.id);
  for (const id of people) { await sql`delete from inventory_user_roles where user_id = ${id}`; await sql`delete from activity_log where user_id = ${id}`; }
  await sql`delete from users where email like 'zzi-%'`;
};
// Every inventory row that is not this test's own, so the end can prove none of it changed.
const snap = async () => JSON.stringify([
  await sql`select id, name, category_id, quantity, min_quantity, rate_paise, active from inventory_items where name not like 'ZZI%' order by id`,
  await sql`select id, name from inventory_categories where name not like 'ZZI%' order by id`,
  await sql`select count(*)::int n from inventory_stock_movements m join inventory_items i on i.id = m.item_id where i.name not like 'ZZI%'`,
  await sql`select user_id, role from inventory_user_roles where user_id not in (select id from users where email like 'zzi-%') order by user_id, role`,
]);

await removeTestData();
const before = await snap();
await sql`insert into users (name, email, password_hash, status) values ('ZZI Member', 'zzi-member@gmail.com', ${hash(PW)}, 'approved')`;
const [staff] = await sql`insert into users (name, email, password_hash, status) values ('ZZI Staff', 'zzi-staff@gmail.com', ${hash(PW)}, 'approved') returning id`;
await sql`insert into inventory_user_roles (user_id, role) values (${staff.id}, 'inventory_staff')`;

const browser = await launch();
const pageErrors = [];
const signedIn = async (email, password) => {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 1000 } });
  ctx.setDefaultTimeout(45000);
  await ctx.addInitScript(() => { try { localStorage.setItem("mccia-install-popup-seen", "1"); localStorage.setItem("mccia-install-snoozed-until", String(Date.now() + 864e5)); } catch {} });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 160)));
  await page.goto(BASE + "/login"); await page.fill("input[name=email]", email); await page.fill("input[name=password]", password);
  await page.click("button[type=submit]"); await page.waitForURL((u) => u.pathname === "/", { timeout: 60000 });
  return { ctx, page };
};
const go = async (page, p) => { const r = await page.goto(BASE + p); await page.waitForLoadState("networkidle").catch(() => {}); return r; };
const toast = (page, text) => page.getByText(text).first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
const item = async (name) => (await sql`select * from inventory_items where name = ${name}`)[0];
const movements = async (name) => sql`select m.kind, m.delta, m.quantity_after, m.reason, m.actor_name from inventory_stock_movements m join inventory_items i on i.id = m.item_id where i.name = ${name} order by m.created_at`;
const api = (page, url, method, body) => page.evaluate(async ([u, m, b]) => { const r = await fetch(u, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; }, [url, method, body]);

try {
  section("Inventory admin: categories");
  const { page: A } = await signedIn(ADMIN_EMAIL, ADMIN_PW);
  const cats = await go(A, "/inventory/categories");
  check("the Support Admin (an Inventory admin) opens Categories", cats.status() === 200 && (await A.getByRole("heading", { name: "Categories" }).count()) === 1, cats.status());
  const addCategory = async (n) => { await A.getByLabel("New category name").fill(n); await A.getByRole("button", { name: "Add", exact: true }).click(); };
  await addCategory("ZZI Stationery"); check("adding a category says so", await toast(A, "Category added"));
  await poll(async () => (await sql`select 1 from inventory_categories where name = 'ZZI Stationery'`).length);
  await addCategory("zzi stationery"); check("the same name in other capitals is refused", await toast(A, "already exists"));
  check("…and was not saved twice", (await sql`select count(*)::int n from inventory_categories where lower(name) = 'zzi stationery'`)[0].n === 1);
  await addCategory("ZZI Spare"); await toast(A, "Category added");
  await A.getByRole("button", { name: "Rename ZZI Spare" }).click(); await A.getByLabel("New name for ZZI Spare").fill("ZZI Spare Parts"); await A.getByRole("button", { name: "Save" }).click();
  check("renaming a category saves", await toast(A, "Category renamed") && await poll(async () => (await sql`select 1 from inventory_categories where name = 'ZZI Spare Parts'`).length));

  section("Inventory admin: items and the stock history");
  await go(A, "/inventory/items");
  const openAdd = async () => { await A.getByRole("button", { name: "Add item" }).first().click(); return A.getByRole("dialog"); };
  const fill = async (d, v) => {
    if (v.name !== undefined) await d.getByLabel("Name", { exact: true }).fill(v.name);
    if (v.category !== undefined) await d.getByLabel(/^Category/).selectOption({ label: v.category });
    if (v.unit !== undefined) await d.getByLabel("Unit", { exact: true }).fill(v.unit);
    if (v.quantity !== undefined) await d.getByLabel(/Opening stock|Quantity in stock/).fill(String(v.quantity));
    if (v.min !== undefined) await d.getByLabel("Minimum stock").fill(String(v.min));
    if (v.rate !== undefined) await d.getByLabel(/Rate/).fill(v.rate);
  };
  let d = await openAdd();
  await fill(d, { name: "ZZI Paper", category: "ZZI Stationery", unit: "Ream", quantity: 4, min: 20, rate: "abc" });
  await d.getByRole("button", { name: "Add item" }).click();
  check("a rate that is not an amount is refused with a plain message", await toast(A, "Rate must be an amount in rupees"));
  check("…and nothing was saved", !(await item("ZZI Paper")));
  await d.getByLabel(/Rate/).fill("1,250.50"); await d.getByRole("button", { name: "Add item" }).click();
  check("adding an item says so", await toast(A, "Item added"));
  const paper = await poll(() => item("ZZI Paper"));
  check("the item is stored with its category, unit, quantity, minimum and the rate in paise", !!paper && paper.unit === "Ream" && paper.quantity === 4 && paper.min_quantity === 20 && Number(paper.rate_paise) === 125050 && !!paper.category_id, JSON.stringify(paper));
  let mv = await movements("ZZI Paper");
  check("its opening stock is written to the stock history under the admin's name", mv.length === 1 && mv[0].kind === "adjust" && mv[0].delta === 4 && mv[0].quantity_after === 4 && mv[0].reason === "Opening stock", JSON.stringify(mv));
  await A.waitForTimeout(800);
  const paperRow = A.locator("tr", { hasText: "ZZI Paper" });
  check("an item below its minimum is highlighted as low on stock", (await paperRow.getByLabel("Low on stock").count()) === 1);

  d = await openAdd(); await fill(d, { name: "ZZI Pen", unit: "Nos", quantity: 0, min: 0 }); await d.getByRole("button", { name: "Add item" }).click();
  await toast(A, "Item added"); await poll(() => item("ZZI Pen"));
  check("an item added with nothing in stock has no stock history", (await movements("ZZI Pen")).length === 0);

  await A.getByRole("button", { name: "Edit ZZI Paper" }).click(); d = A.getByRole("dialog");
  await fill(d, { quantity: 30 });
  check("changing the quantity explains it will be saved as a recount", await d.getByText(/saved in the stock history as a recount/).count() === 1);
  await d.getByRole("button", { name: "Save" }).click(); check("saving the item says so", await toast(A, "Item saved"));
  await poll(async () => (await item("ZZI Paper")).quantity === 30);
  mv = await movements("ZZI Paper");
  check("the change is a recount of +26 in the history, ending at 30", mv.length === 2 && mv[1].kind === "recount" && mv[1].delta === 26 && mv[1].quantity_after === 30, JSON.stringify(mv));
  await A.waitForTimeout(800);
  check("with 30 in stock it is no longer low", (await A.locator("tr", { hasText: "ZZI Paper" }).getByLabel("Low on stock").count()) === 0);

  await A.getByRole("button", { name: "Delete ZZI Paper" }).click(); await A.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  check("an item with stock history cannot be deleted, and the message says to untick Active instead", await toast(A, "untick Active"));
  check("…and it is still there", !!(await item("ZZI Paper")));
  await A.waitForTimeout(1200);
  await A.getByRole("button", { name: "Delete ZZI Pen" }).click(); await A.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  check("an item with no history can be deleted", await toast(A, "Item deleted") && await poll(async () => !(await item("ZZI Pen"))));

  section("Dashboard");
  await go(A, "/inventory");
  const dash = await A.locator("main").first().innerText();
  check("the dashboard shows real figures, with no sample-data label", !/Sample data/i.test(dash) && /Units in stock/i.test(dash) && /Stock value/i.test(dash));
  check("the recent stock movements list the recount just made", /ZZI Paper/.test(dash) && /Recount/i.test(dash));
  const [s] = await sql`select count(*)::int items, coalesce(sum(quantity),0)::int units from inventory_items where active`;
  check("the Items figure matches the database", new RegExp(`\\b${s.items.toLocaleString("en-IN")}\\b`).test(dash), `${s.items} items`);

  section("Deleting a category keeps its items");
  await go(A, "/inventory/categories");
  await A.getByRole("button", { name: "Delete ZZI Stationery" }).click();
  check("the question says how many items stay without a category", await A.getByRole("dialog").getByText(/1 item stays in the catalogue, without a category/).count() === 1);
  await A.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  check("the category is deleted", await toast(A, "Category deleted") && await poll(async () => !(await sql`select 1 from inventory_categories where name = 'ZZI Stationery'`).length));
  check("…and its item is still there, without a category", (await item("ZZI Paper"))?.category_id === null);

  section("Inventory staff and everyone else: view only");
  for (const [who, email] of [["Inventory staff", "zzi-staff@gmail.com"], ["a plain user", "zzi-member@gmail.com"]]) {
    const { ctx, page } = await signedIn(email, PW);
    const r = await go(page, "/inventory/items");
    check(`${who} can open the item list and sees the items`, r.status() === 200 && (await page.locator("tr", { hasText: "ZZI Paper" }).count()) === 1, r.status());
    check(`${who} has no Add, Edit or Delete buttons`, (await page.getByRole("button", { name: /Add item|^Edit |^Delete / }).count()) === 0);
    check(`${who} cannot open Categories (not found)`, (await go(page, "/inventory/categories")).status() === 404);
    await go(page, "/inventory/items");
    const post = await api(page, "/api/inventory/items", "POST", { name: "ZZI Sneaky", unit: "Nos", quantity: 1, minQuantity: 0 });
    check(`${who} is refused when adding an item through the API (403)`, post.status === 403 && !(await item("ZZI Sneaky")), post.status);
    const paperId = (await item("ZZI Paper")).id;
    const del = await api(page, `/api/inventory/items/${paperId}`, "DELETE");
    check(`${who} is refused when deleting through the API (403)`, del.status === 403 && !!(await item("ZZI Paper")), del.status);
    await ctx.close();
  }
  check("no JavaScript errors in the browser", pageErrors.length === 0, pageErrors.join(" | "));
} catch (e) {
  console.log("\nTEST ERROR:", String(e).split("\n").slice(0, 3).join(" | ")); results.push(["test crashed", false]);
} finally {
  await browser.close();
  section("Cleanup and data-safety check");
  await removeTestData();
  check("every other inventory row is exactly as before", before === (await snap()));
  check("all test data removed", (await sql`select (select count(*) from inventory_items where name like 'ZZI%') + (select count(*) from inventory_categories where name like 'ZZI%') + (select count(*) from users where email like 'zzi-%') as n`)[0].n == 0);
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) console.log("FAILED:\n - " + failed.map(([n]) => n).join("\n - "));
  process.exit(failed.length ? 1 : 0);
}
