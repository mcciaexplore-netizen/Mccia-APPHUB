/**
 * End-to-end test of the Inventory module in a real browser: categories, items, the stock history behind quantity changes, the dashboard
 * figures, Settings (who runs the store), requests, issues and returns, and who may do what (Inventory admin, Inventory staff, everyone else). Run against a site with
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
const [member] = await sql`insert into users (name, email, password_hash, status) values ('ZZI Member', 'zzi-member@gmail.com', ${hash(PW)}, 'approved') returning id`;
const [staff] = await sql`insert into users (name, email, password_hash, status) values ('ZZI Staff', 'zzi-staff@gmail.com', ${hash(PW)}, 'approved') returning id`;
await sql`insert into inventory_user_roles (user_id, role) values (${staff.id}, 'inventory_staff')`;
const [admin2] = await sql`insert into users (name, email, password_hash, status) values ('ZZI Admin', 'zzi-admin@gmail.com', ${hash(PW)}, 'approved') returning id`;
await sql`insert into inventory_user_roles (user_id, role) values (${admin2.id}, 'inventory_admin')`;

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
const rolesOf = async (id) => (await sql`select role from inventory_user_roles where user_id = ${id} order by role`).map((x) => x.role).join(",");
const roleAudits = async (id) => (await sql`select action, details->>'role' as role from access_audit where target_id = ${id} and action like 'inventory.role_%' order by at, action`).map((x) => `${x.action.replace("inventory.", "")}:${x.role}`);
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

  section("Settings: who runs the store");
  const set = await go(A, "/inventory/settings");
  check("the Support Admin opens Settings, which lists the hub's users", set.status() === 200 && (await A.locator("tr", { hasText: "ZZI Member" }).count()) === 1, set.status());
  check("the Support Admin's own row is a fixed Admin label, not a choice", (await A.locator("tr", { hasText: ADMIN_EMAIL }).getByText("Admin (Support Admin)").count()) === 1 && (await A.locator("tr", { hasText: ADMIN_EMAIL }).locator("select").count()) === 0);
  const roleSelect = (name) => A.getByLabel(`Inventory role of ${name}`);
  await roleSelect("ZZI Member").selectOption("inventory_staff");
  check("making someone Staff says so and stores it", await toast(A, "ZZI Member is now Staff") && await poll(async () => (await rolesOf(member.id)) === "inventory_staff"));
  check("…and records inventory.role_granted in the hub's audit log", JSON.stringify(await roleAudits(member.id)) === JSON.stringify(["role_granted:inventory_staff"]), JSON.stringify(await roleAudits(member.id)));
  await A.waitForTimeout(1200);
  await roleSelect("ZZI Member").selectOption("inventory_admin");
  check("Staff to Admin leaves exactly one role, Admin", await toast(A, "ZZI Member is now Admin") && await poll(async () => (await rolesOf(member.id)) === "inventory_admin"));
  check("…recorded as Staff removed and Admin granted", JSON.stringify(await roleAudits(member.id)) === JSON.stringify(["role_granted:inventory_staff", "role_granted:inventory_admin", "role_revoked:inventory_staff"]), JSON.stringify(await roleAudits(member.id)));
  await A.waitForTimeout(1200);
  await roleSelect("ZZI Member").selectOption("none");
  check("removing someone's admin role asks first", (await A.getByRole("dialog").getByText(/will no longer be able to change items/).count()) === 1);
  await A.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
  check("…and then removes it, recorded as inventory.role_revoked", await toast(A, "has no Inventory role now") && await poll(async () => (await rolesOf(member.id)) === "")
    && (await roleAudits(member.id)).at(-1) === "role_revoked:inventory_admin");
  const supportId = (await sql`select id from users where email = ${ADMIN_EMAIL}`)[0].id;
  const supportChange = await api(A, "/api/inventory/roles", "PUT", { userId: supportId, role: null });
  check("the Support Admin's own Admin role cannot be changed here (409)", supportChange.status === 409 && /always an Inventory admin/.test(supportChange.body?.error ?? ""), JSON.stringify(supportChange));
  const bad = await api(A, "/api/inventory/roles", "PUT", { userId: member.id, role: "requester" });
  check("a role that is not Admin, Staff or none is refused (400)", bad.status === 400, bad.status);

  section("An Inventory admin cannot remove their own admin role");
  {
    const { ctx, page } = await signedIn("zzi-admin@gmail.com", PW);
    const r = await go(page, "/inventory/settings");
    check("an Inventory admin (not a hub admin) opens Settings", r.status() === 200, r.status());
    const own = page.getByLabel("Inventory role of ZZI Admin");
    check("in their own row only Admin can be chosen", (await own.locator("option:disabled").count()) === 2);
    const selfRemove = await api(page, "/api/inventory/roles", "PUT", { userId: admin2.id, role: "inventory_staff" });
    check("removing their own admin role through the API is refused (409) and changes nothing", selfRemove.status === 409 && /your own admin role/.test(selfRemove.body?.error ?? "") && (await rolesOf(admin2.id)) === "inventory_admin", JSON.stringify(selfRemove));
    const grant = await api(page, "/api/inventory/roles", "PUT", { userId: member.id, role: "inventory_staff" });
    check("they can manage other people's roles", grant.status === 200 && (await rolesOf(member.id)) === "inventory_staff", grant.status);
    await api(page, "/api/inventory/roles", "PUT", { userId: member.id, role: null });
    await ctx.close();
  }

  section("Requests: anyone asks, store staff decide");
  {
    const stock = async () => (await item("ZZI Paper")).quantity;
    const reqs = async () => sql`select id, quantity, status, reject_reason, requested_by_user_id from inventory_requests r where r.item_id = ${(await item("ZZI Paper")).id} order by requested_at`;
    const { ctx: mctx, page: M } = await signedIn("zzi-member@gmail.com", PW);
    const mr = await go(M, "/inventory/requests");
    check("an ordinary user opens Requests and sees their own (My requests)", mr.status() === 200 && (await M.getByRole("heading", { name: "My requests" }).count()) === 1, mr.status());
    const ask = async (qty, note) => {
      await M.getByRole("button", { name: "New request" }).click(); const d = M.getByRole("dialog");
      await d.getByLabel(/^Item/).selectOption({ label: `ZZI Paper (${await stock()} Ream in stock)` });
      await d.getByLabel(/^Quantity/).fill(String(qty)); if (note) await d.getByLabel(/Note/).fill(note);
      await d.getByRole("button", { name: "Send request" }).click(); await toast(M, "Request sent"); await M.waitForTimeout(900);
    };
    await ask(5, "For the board meeting"); await ask(500); await ask(1);
    let rs = await reqs();
    check("an ordinary user raises requests (stored as pending, under their name)", rs.length === 3 && rs.every((r) => r.status === "pending" && r.requested_by_user_id === member.id), JSON.stringify(rs));
    const [r5, r500, r1] = rs;
    const { ctx: sctx, page: S } = await signedIn("zzi-staff@gmail.com", PW);
    await go(S, "/inventory/requests");
    const staffOwn = await api(S, "/api/inventory/requests", "POST", { itemId: (await item("ZZI Paper")).id, quantity: 2 });
    check("store staff can raise a request too", staffOwn.status === 201, staffOwn.status);
    await M.reload(); await M.waitForLoadState("networkidle");
    check("the ordinary user sees only their own 3 requests, not the staff member's", (await M.locator("tbody tr").count()) === 3);
    await go(S, "/inventory/requests");
    check("store staff see everyone's requests, with counts per status", (await S.getByRole("heading", { name: "Requests", exact: true }).count()) === 1 && /Pending\s*4/.test(await S.getByRole("tablist").innerText()), await S.getByRole("tablist").innerText());

    const early = await api(S, `/api/inventory/requests/${r5.id}`, "PATCH", { action: "fulfil" });
    check("a pending request cannot be fulfilled before it is approved (409)", early.status === 409 && /pending now/.test(early.body?.error ?? ""), JSON.stringify(early));
    const noReason = await api(S, `/api/inventory/requests/${r1.id}`, "PATCH", { action: "reject", reason: " " });
    check("rejecting without a reason is refused (400)", noReason.status === 400, noReason.status);
    const row = (q) => S.locator("tr", { hasText: "ZZI Member" }).filter({ hasText: `${q} Ream` });
    await row(5).getByRole("button", { name: "Approve" }).click(); check("approving says so", await toast(S, "Request approved"));
    await poll(async () => (await reqs()).find((r) => r.id === r5.id)?.status === "approved");
    const twice = await api(S, `/api/inventory/requests/${r5.id}`, "PATCH", { action: "approve" });
    check("approving an already approved request is refused (409)", twice.status === 409, twice.status);
    await S.waitForTimeout(800);
    await row(1).getByRole("button", { name: "Reject" }).click(); await S.getByRole("dialog").getByLabel("Reason").fill("ZZI: use the shared stock");
    await S.getByRole("dialog").getByRole("button", { name: "Reject request" }).click();
    check("rejecting with a reason stores it", await toast(S, "Request rejected") && await poll(async () => (await reqs()).find((r) => r.id === r1.id)?.reject_reason === "ZZI: use the shared stock"));

    await api(S, `/api/inventory/requests/${r500.id}`, "PATCH", { action: "approve" });
    const before500 = await stock();
    const big = await api(S, `/api/inventory/requests/${r500.id}`, "PATCH", { action: "fulfil" });
    check("fulfilling more than is in stock is refused with the numbers, and nothing changes", big.status === 409 && new RegExp(`500 requested, ${before500} available`).test(big.body?.error ?? "")
      && (await stock()) === before500 && (await reqs()).find((r) => r.id === r500.id)?.status === "approved", JSON.stringify(big));

    await go(S, "/inventory/requests?status=approved");
    const beforeFulfil = await stock();
    await row(5).getByRole("button", { name: "Fulfil" }).click();
    check("fulfilling asks first, saying how much leaves the stock", (await S.getByRole("dialog").getByText(new RegExp(`5 Ream of .ZZI Paper. will be taken out of stock \\(${beforeFulfil} available\\)`)).count()) === 1);
    await S.getByRole("dialog").getByRole("button", { name: "Fulfil" }).click();
    check("fulfilling says so", await toast(S, "Request fulfilled"));
    await poll(async () => (await reqs()).find((r) => r.id === r5.id)?.status === "fulfilled");
    const [fm] = await sql`select kind, delta, quantity_after, issued_to_user_id, request_id from inventory_stock_movements where request_id = ${r5.id}`;
    check("fulfilling takes 5 out of stock and records an issue to the requester, linked to the request", (await stock()) === beforeFulfil - 5 && fm?.kind === "issue" && fm.delta === -5
      && fm.quantity_after === beforeFulfil - 5 && fm.issued_to_user_id === member.id, JSON.stringify(fm));

    // Two people fulfil the same request at the same moment: exactly one of them does it.
    const [race] = await sql`insert into inventory_requests (item_id, quantity, status, requested_by_user_id, requested_by_name) values (${(await item("ZZI Paper")).id}, 3, 'approved', ${member.id}, 'ZZI Member') returning id`;
    const beforeRace = await stock();
    const both = await Promise.all([api(S, `/api/inventory/requests/${race.id}`, "PATCH", { action: "fulfil" }), api(S, `/api/inventory/requests/${race.id}`, "PATCH", { action: "fulfil" })]);
    check("two fulfils of the same request at the same moment: one succeeds, one is refused, the stock goes down once",
      both.map((b) => b.status).sort().join() === "200,409" && (await stock()) === beforeRace - 3 && (await sql`select count(*)::int n from inventory_stock_movements where request_id = ${race.id}`)[0].n === 1, both.map((b) => b.status).join());

    await M.reload(); await M.waitForLoadState("networkidle");
    const mine = await M.locator("tbody").innerText();
    check("the requester sees Fulfilled, and Rejected with the reason", /Fulfilled/i.test(mine) && /Rejected/i.test(mine) && /use the shared stock/.test(mine));
    const audits = (await sql`select action from access_audit where action like 'inventory.request_%' and target_label = 'ZZI Paper'`).map((a) => a.action);
    check("raising, approving, rejecting and fulfilling are all in the audit log", ["inventory.request_raised", "inventory.request_approved", "inventory.request_rejected", "inventory.request_fulfilled"].every((a) => audits.includes(a)), [...new Set(audits)].join());
    await mctx.close(); await sctx.close();
  }

  section("Issues & returns");
  {
    const stock = async () => (await item("ZZI Paper")).quantity;
    const paperId = (await item("ZZI Paper")).id;
    const { ctx: sctx, page: S } = await signedIn("zzi-staff@gmail.com", PW);
    const ir = await go(S, "/inventory/issues");
    check("store staff open Issues & returns", ir.status() === 200 && (await S.getByRole("heading", { name: "Issues & returns" }).count()) === 1, ir.status());
    const before = await stock();
    await S.getByRole("button", { name: "Issue item" }).click(); let d = S.getByRole("dialog");
    await d.getByLabel(/^Item/).selectOption({ label: `ZZI Paper (${before} Ream in stock)` });
    await d.getByLabel(/^Quantity/).fill("3"); await d.getByLabel("Issued to (a hub user)").selectOption({ label: "ZZI Member" });
    await d.getByLabel(/Event/).fill("ZZI Workshop"); await d.getByRole("button", { name: "Issue", exact: true }).click();
    check("issuing to a hub user says so", await toast(S, "Item issued"));
    await poll(async () => (await stock()) === before - 3);
    const [iss] = await sql`select id, kind, delta, quantity_after, issued_to_user_id, issued_to_name, event_name from inventory_stock_movements where item_id = ${paperId} and kind = 'issue' and event_name = 'ZZI Workshop'`;
    check("issuing takes the stock out and records who received it", (await stock()) === before - 3 && iss?.delta === -3 && iss.issued_to_user_id === member.id && iss.issued_to_name === "ZZI Member", JSON.stringify(iss));
    const visitor = await api(S, "/api/inventory/issues", "POST", { itemId: paperId, quantity: 2, name: "ZZI Visitor", eventName: "ZZI Expo" });
    check("issuing to a typed name works too", visitor.status === 201, JSON.stringify(visitor));
    const nobody = await api(S, "/api/inventory/issues", "POST", { itemId: paperId, quantity: 1 });
    check("issuing to nobody is refused (400)", nobody.status === 400, nobody.status);
    const now = await stock();
    const tooMany = await api(S, "/api/inventory/issues", "POST", { itemId: paperId, quantity: now + 1, name: "ZZI Greedy" });
    check("issuing more than is in stock is refused with the numbers, and nothing changes", tooMany.status === 409 && new RegExp(`${now + 1} asked for, ${now} available`).test(tooMany.body?.error ?? "") && (await stock()) === now, JSON.stringify(tooMany));
    const race = await Promise.all([1, 2].map(() => api(S, "/api/inventory/issues", "POST", { itemId: paperId, quantity: now, name: "ZZI Racer" })));
    check("two issues of everything that is left, at the same moment: one succeeds, the other is refused, stock never goes below zero",
      race.map((r) => r.status).sort().join() === "201,409" && (await stock()) === 0, race.map((r) => r.status).join());
    const racer = (await sql`select id from inventory_stock_movements where issued_to_name = 'ZZI Racer'`)[0];
    await api(S, `/api/inventory/issues/${racer.id}/return`, "POST", { quantity: now });

    await go(S, "/inventory/issues");
    const issueRow = S.locator("tr", { hasText: "ZZI Workshop" });
    await issueRow.getByRole("button", { name: /Mark .* returned/ }).click(); d = S.getByRole("dialog");
    await d.getByLabel("Quantity returned").fill("1"); await d.getByRole("button", { name: "Record return" }).click();
    check("a partial return says so", await toast(S, "Return recorded"));
    await S.waitForTimeout(1000);
    check("…and the list shows 1 of 3 back", (await S.locator("tr", { hasText: "ZZI Workshop" }).getByText("1 of 3 back").count()) === 1);
    const s1 = await stock();
    const over = await api(S, `/api/inventory/issues/${iss.id}/return`, "POST", { quantity: 5 });
    check("returning more than is still out is refused (409: only 2 still out) and nothing changes", over.status === 409 && /Only 2 still out/.test(over.body?.error ?? "") && (await stock()) === s1, JSON.stringify(over));
    const rest = await api(S, `/api/inventory/issues/${iss.id}/return`, "POST", { quantity: 2, note: "ZZI good condition" });
    check("returning the rest puts it back in stock", rest.status === 200 && (await stock()) === s1 + 2, rest.status);
    const again = await api(S, `/api/inventory/issues/${iss.id}/return`, "POST", { quantity: 1 });
    check("returning once everything is back is refused", again.status === 409 && /already come back/.test(again.body?.error ?? ""), JSON.stringify(again));
    await go(S, "/inventory/issues?show=returned");
    check("the Returned list shows it as All returned", (await S.locator("tr", { hasText: "ZZI Workshop" }).getByText("All returned").count()) === 1);
    const rm = await sql`select delta, issue_id from inventory_stock_movements where issue_id = ${iss.id} and kind = 'return' order by created_at`;
    check("each return is a movement pointing back at its issue", rm.length === 2 && rm[0].delta === 1 && rm[1].delta === 2, JSON.stringify(rm));
    const ia = (await sql`select action from access_audit where action in ('inventory.item_issued', 'inventory.item_returned') and target_label = 'ZZI Paper'`).map((a) => a.action);
    check("issues and returns are in the audit log", ia.includes("inventory.item_issued") && ia.includes("inventory.item_returned"), [...new Set(ia)].join());
    await sctx.close();

    const { ctx: mctx, page: M } = await signedIn("zzi-member@gmail.com", PW);
    await go(M, "/inventory/issues?show=all");
    const mineText = await M.locator("tbody").innerText();
    check("an ordinary user sees what was issued to them (the fulfilled request and the workshop issue), not other people's",
      (await M.getByRole("heading", { name: "Issued to me" }).count()) === 1 && /From a request/i.test(mineText) && /ZZI Workshop/.test(mineText) && !/ZZI Visitor|ZZI Racer/.test(mineText));
    check("they have no Issue or Mark returned buttons", (await M.getByRole("button", { name: /Issue item|Mark .* returned/ }).count()) === 0);
    const p1 = await api(M, "/api/inventory/issues", "POST", { itemId: paperId, quantity: 1, name: "ZZI Self" });
    const p2 = await api(M, `/api/inventory/issues/${iss.id}/return`, "POST", { quantity: 1 });
    const p3 = await api(M, `/api/inventory/requests/${(await sql`select id from inventory_requests where status = 'approved' and item_id = ${paperId} limit 1`)[0].id}`, "PATCH", { action: "fulfil" });
    check("they are refused (403) when issuing, recording a return or deciding a request through the API", [p1.status, p2.status, p3.status].join() === "403,403,403", [p1.status, p2.status, p3.status].join());
    await mctx.close();
  }

  section("Inventory staff and everyone else: view only");
  for (const [who, email] of [["Inventory staff", "zzi-staff@gmail.com"], ["a plain user", "zzi-member@gmail.com"]]) {
    const { ctx, page } = await signedIn(email, PW);
    const r = await go(page, "/inventory/items");
    check(`${who} can open the item list and sees the items`, r.status() === 200 && (await page.locator("tr", { hasText: "ZZI Paper" }).count()) === 1, r.status());
    check(`${who} has no Add, Edit or Delete buttons`, (await page.getByRole("button", { name: /Add item|^Edit |^Delete / }).count()) === 0);
    check(`${who} cannot open Categories (not found)`, (await go(page, "/inventory/categories")).status() === 404);
    check(`${who} cannot open Settings (not found), and has no Settings link`, (await go(page, "/inventory/settings")).status() === 404);
    await go(page, "/inventory/items");
    check(`${who} sees no Settings link in the Inventory menu`, (await page.getByRole("navigation", { name: "Inventory" }).getByText("Settings").count()) === 0);
    const roleChange = await api(page, "/api/inventory/roles", "PUT", { userId: member.id, role: "inventory_admin" });
    check(`${who} is refused when changing roles through the API (403)`, roleChange.status === 403 && (await rolesOf(member.id)) === "", roleChange.status);
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
