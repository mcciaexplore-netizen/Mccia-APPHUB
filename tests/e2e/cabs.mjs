/**
 * End-to-end test of the Cab Booking module in a real browser: who may open each of its three sections (MCCIA Cabs, Cabs Driver, Cabs
 * Admin), vehicles and drivers, booking a ride, assigning it (and two admins assigning at once), the driver starting and completing it,
 * cancelling (by the person and by an admin, with a reason), the notifications each step sends, the audit log and its CSV. Run against a
 * site with CABS_ENABLED=true:
 *   E2E_BASE_URL=http://localhost:3000 node tests/e2e/cabs.mjs
 * With the module switched off (CABS_ENABLED unset), E2E_CABS_OFF=yes checks instead that every /cabs page and /api/cabs route is a 404.
 *
 * It WRITES to the database the site uses, but only rows named "ZZC"/"zzc-": people (at a "ZZC Branch"), three "ZZC" applications (URLs
 * /cabs, /cabs/driver, /cabs/admin) given to them, vehicles whose plate starts "ZZC", and the drivers, rides, notifications and audit
 * entries they make. Everything is removed when it finishes (and at the start, if an earlier run was interrupted), and it checks that every
 * other cab_ row is exactly as before. It refuses a Neon database unless E2E_ALLOW_NEON=yes.
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
if (!BASE) { console.error("Set E2E_BASE_URL, for example: E2E_BASE_URL=http://localhost:3000 node tests/e2e/cabs.mjs"); process.exit(2); }
if (/neon\.tech/i.test(process.env.DATABASE_URL || "") && process.env.E2E_ALLOW_NEON !== "yes") { console.error("Refusing: DATABASE_URL is a Neon database. Use a test database, or set E2E_ALLOW_NEON=yes for a Neon test branch."); process.exit(2); }

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
const PW = "zzc-Test-pass-123";

const removeTestData = async () => {
  const people = (await sql`select id from users where email like 'zzc-%'`).map((r) => r.id);
  const rides = (await sql`select id from cab_rides where requested_by_email like 'zzc-%'`).map((r) => r.id);
  for (const id of people) { await sql`delete from cab_audit_log where actor_id = ${id}`; await sql`delete from hub_notifications where user_id = ${id}`; await sql`delete from activity_log where user_id = ${id}`; }
  for (const id of rides) await sql`delete from cab_audit_log where ride_id = ${id}`;
  await sql`delete from cab_rides where requested_by_email like 'zzc-%'`;
  await sql`delete from cab_drivers where email like 'zzc-%'`;
  await sql`delete from cab_vehicles where number_plate like 'ZZC%'`;
  await sql`delete from access_audit where action like 'cabs.%' and target_label like 'ZZC%'`;
  await sql`delete from users where email like 'zzc-%'`;
  for (const a of await sql`select id from apps where name like 'ZZC%'`) await sql`delete from activity_log where app_id = ${a.id}`;
  await sql`delete from apps where name like 'ZZC%'`;
  await sql`delete from departments where name like 'ZZC%'`;
  await sql`delete from branches where name like 'ZZC%'`;
};
// Every cab_ row that is not this test's own, so the end can prove none of it changed.
const snap = async () => JSON.stringify([
  await sql`select id, number_plate, model, capacity, is_active from cab_vehicles where number_plate not like 'ZZC%' order by id`,
  await sql`select id, name, email, phone, vehicle_id, is_available from cab_drivers where email not like 'zzc-%' order by id`,
  await sql`select id, status, driver_id, vehicle_id, updated_at from cab_rides where requested_by_email not like 'zzc-%' order by id`,
  await sql`select count(*)::int n from cab_audit_log`,
]);

await removeTestData();
const before = await snap();
const auditBefore = (await sql`select count(*)::int n from cab_audit_log`)[0].n;
const [branch] = await sql`insert into branches (name) values ('ZZC Branch') returning id`;
const person = async (name, email, role = "member") => (await sql`insert into users (name, email, password_hash, status, role, branch_id) values (${name}, ${email}, ${hash(PW)}, 'approved', ${role}, ${branch.id}) returning id`)[0];
const staffer = await person("ZZC Staffer", "zzc-staffer@gmail.com");
const outsider = await person("ZZC Outsider", "zzc-outsider@gmail.com");
const admin = await person("ZZC Admin", "zzc-admin@gmail.com", "admin");
const driver = await person("ZZC Driver", "zzc-driver@gmail.com");
const driver2 = await person("ZZC Second Driver", "zzc-driver2@gmail.com");
// The three applications, as a Support Admin would add them in Administrator → Applications, and who has each.
const [dept] = await sql`insert into departments (kind, name, icon) values ('application', 'ZZC Dept', 'Car') returning id`;
const app = async (name, url, icon) => (await sql`insert into apps (department_id, name, url, icon) values (${dept.id}, ${name}, ${url}, ${icon}) returning id`)[0];
const cabsApp = await app("ZZC Cabs", "/cabs", "Car");
const driverApp = await app("ZZC Cabs Driver", "/cabs/driver", "Map");
const adminApp = await app("ZZC Cabs Admin", "/cabs/admin", "ClipboardList");
const grant = (u, a) => sql`insert into user_app_access (user_id, app_id) values (${u.id}, ${a.id}) on conflict do nothing`;
await grant(staffer, cabsApp); await grant(admin, cabsApp); await grant(admin, adminApp); await grant(driver, driverApp); await grant(driver2, driverApp);
await sql`insert into app_admins (app_id, user_id) values (${adminApp.id}, ${admin.id})`;

const browser = await launch();
const pageErrors = [];
const signedIn = async (email) => {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 1000 } });
  ctx.setDefaultTimeout(45000);
  await ctx.addInitScript(() => { try { localStorage.setItem("mccia-install-popup-seen", "1"); localStorage.setItem("mccia-install-snoozed-until", String(Date.now() + 864e5)); } catch {} });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 160)));
  await page.goto(BASE + "/login"); await page.fill("input[name=email]", email); await page.fill("input[name=password]", PW);
  await page.click("button[type=submit]"); await page.waitForURL((u) => u.pathname === "/", { timeout: 60000 });
  return { ctx, page };
};
const go = async (page, p) => { const r = await page.goto(BASE + p); await page.waitForLoadState("networkidle").catch(() => {}); return r; };
const toast = (page, text) => page.getByText(text).first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
const api = (page, url, method, body) => page.evaluate(async ([u, m, b]) => { const r = await fetch(u, { method: m, headers: b ? { "Content-Type": "application/json" } : {}, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; }, [url, method, body]);
const ride = async (id) => (await sql`select * from cab_rides where id = ${id}`)[0];
const notices = async (u) => (await sql`select kind, title, body from hub_notifications where user_id = ${u.id} order by created_at`);
/** "YYYY-MM-DDTHH:mm" in India time, `days` from now at `hh`:00, as the booking form's date-time box takes it. */
const istSlot = (days, hh) => `${new Date(Date.now() + days * 86_400_000 + 5.5 * 3600_000).toISOString().slice(0, 10)}T${String(hh).padStart(2, "0")}:00`;

let exitCode = 0;
// Switched off: every page and route is a 404 even for someone signed in who has every application (nothing is written by the module).
if (process.env.E2E_CABS_OFF === "yes") {
  try {
    section("module switched off");
    const { page } = await signedIn("zzc-admin@gmail.com");
    for (const p of ["/cabs", "/cabs/book", "/cabs/rides", "/cabs/driver", "/cabs/driver/rides", "/cabs/admin", "/cabs/admin/rides", "/cabs/admin/drivers", "/cabs/admin/vehicles", "/cabs/admin/audit"]) {
      check(`off: ${p} is a 404`, (await go(page, p))?.status() === 404);
    }
    for (const [m, p] of [["POST", "/api/cabs/rides"], ["GET", "/api/cabs/drivers"], ["POST", "/api/cabs/vehicles"], ["GET", "/api/cabs/audit/export"]]) {
      check(`off: ${m} ${p} is a 404`, (await api(page, p, m, m === "POST" ? {} : undefined)).status === 404);
    }
    check("off: nothing was written", (await sql`select count(*)::int n from cab_rides where requested_by_email like 'zzc-%'`)[0].n === 0);
  } catch (e) { console.error(e); exitCode = 1; }
  await browser.close(); await removeTestData();
  if (exitCode) process.exit(exitCode);
  finish();
}
try {
  const S = await signedIn("zzc-staffer@gmail.com");
  const A = await signedIn("zzc-admin@gmail.com");
  const D = await signedIn("zzc-driver@gmail.com");
  const D2 = await signedIn("zzc-driver2@gmail.com");
  const O = await signedIn("zzc-outsider@gmail.com");

  section("who may open which section");
  await go(S.page, "/");
  const tiles = await S.page.locator("main").innerText();
  check("hub: the staffer sees the MCCIA Cabs tile, not the Driver or Admin ones", tiles.includes("ZZC Cabs") && !tiles.includes("ZZC Cabs Admin") && !tiles.includes("ZZC Cabs Driver"));
  await go(S.page, "/cabs");
  check("staffer: /cabs opens with its sidebar (back to the hub, MCCIA Cabs, three pages)", await S.page.locator('nav[aria-label="MCCIA Cabs"]').isVisible()
    && (await S.page.locator('nav[aria-label="MCCIA Cabs"] a').allInnerTexts()).map((t) => t.trim()).join("|") === "App Hub|Dashboard|Book a Ride|My Rides");
  await go(S.page, "/cabs/admin"); check("staffer: Cabs Admin sends them back to the hub", new URL(S.page.url()).pathname === "/");
  await go(S.page, "/cabs/driver"); check("staffer: Cabs Driver sends them back to the hub", new URL(S.page.url()).pathname === "/");
  await go(A.page, "/cabs/driver");
  check("admin: opens Cabs Driver too (to see it as a driver does), with its menu", new URL(A.page.url()).pathname === "/cabs/driver"
    && (await A.page.locator('nav[aria-label="Cabs Driver"] a').allInnerTexts()).map((t) => t.trim()).join("|") === "App Hub|Dashboard|My Rides");
  check("admin: but cannot start a ride as a driver (403)", (await api(A.page, "/api/cabs/rides/00000000-0000-4000-8000-000000000000/start", "POST")).status === 403);
  await go(O.page, "/cabs"); check("someone without MCCIA Cabs is sent back to the hub", new URL(O.page.url()).pathname === "/");
  check("API: no MCCIA Cabs, no booking (403)", (await api(O.page, "/api/cabs/rides", "POST", { pickup: "a", dropoff: "b", scheduledFor: istSlot(1, 10) })).status === 403);
  check("API: a staffer cannot manage vehicles (403)", (await api(S.page, "/api/cabs/vehicles", "POST", { numberPlate: "ZZC 99", model: "x", capacity: 4 })).status === 403);
  const anon = await fetch(BASE + "/api/cabs/rides", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", redirect: "manual" });
  check("API: signed out is refused", anon.status === 401 || anon.status === 307, anon.status);
  await go(A.page, "/cabs/admin");
  check("admin: Cabs Admin opens with its five pages", (await A.page.locator('nav[aria-label="Cabs Admin"] a').allInnerTexts()).map((t) => t.trim()).join("|") === "App Hub|Dashboard|All Rides|Drivers|Vehicles|Audit Log");
  await go(D.page, "/cabs/driver"); check("a driver not yet added on the Drivers page cannot open Cabs Driver", new URL(D.page.url()).pathname === "/");

  section("vehicles");
  await go(A.page, "/cabs/admin/vehicles");
  await A.page.getByRole("button", { name: "Add vehicle" }).click();
  await A.page.fill('[role=dialog] input[name=numberPlate]', "zzc 01  aa 1111"); await A.page.fill('[role=dialog] input[name=model]', "Toyota Innova"); await A.page.fill('[role=dialog] input[name=capacity]', "7");
  await A.page.locator("[role=dialog]").getByRole("button", { name: "Add vehicle" }).click();
  check("admin adds a vehicle on the page; the plate is stored in one form", await toast(A.page, "Vehicle added") && !!(await poll(async () => (await sql`select 1 from cab_vehicles where number_plate = 'ZZC 01 AA 1111' and capacity = 7`)[0])));
  const [v1] = await sql`select id from cab_vehicles where number_plate = 'ZZC 01 AA 1111'`;
  const dup = await api(A.page, "/api/cabs/vehicles", "POST", { numberPlate: "ZZC 01 AA 1111", model: "Other", capacity: 4 });
  check("the same number plate twice is refused (409)", dup.status === 409 && /already exists/.test(dup.body?.error), JSON.stringify(dup));
  const v2 = (await api(A.page, "/api/cabs/vehicles", "POST", { numberPlate: "ZZC 02 BB 2222", model: "Maruti Dzire", capacity: 4 })).body;
  const v3 = (await api(A.page, "/api/cabs/vehicles", "POST", { numberPlate: "ZZC 03 CC 3333", model: "Spare", capacity: 4 })).body;
  check("vehicles: two more added through the API", !!v2?.id && !!v3?.id);
  check("vehicles: editing changes only what is sent", (await api(A.page, `/api/cabs/vehicles/${v2.id}`, "PATCH", { model: "Maruti Dzire Tour" })).status === 200
    && (await sql`select model, capacity from cab_vehicles where id = ${v2.id}`)[0].model === "Maruti Dzire Tour");
  check("vehicles: one is deactivated", (await api(A.page, `/api/cabs/vehicles/${v3.id}`, "DELETE")).status === 200 && (await sql`select is_active from cab_vehicles where id = ${v3.id}`)[0].is_active === false);

  section("drivers");
  await go(A.page, "/cabs/admin/drivers");
  await A.page.getByRole("button", { name: "Add driver" }).click();
  await A.page.fill('[role=dialog] input[type=search]', "ZZC Driver");
  await A.page.locator("[role=dialog] li button", { hasText: "zzc-driver@gmail.com" }).click();
  check("picking one of the hub's people fills in the name and email", (await A.page.inputValue("[role=dialog] input[name=name]")) === "ZZC Driver" && (await A.page.inputValue("[role=dialog] input[name=email]")) === "zzc-driver@gmail.com");
  await A.page.fill("[role=dialog] input[name=phone]", "98765 43210");
  await A.page.locator('[role=dialog] select[name=vehicleId]').selectOption(v1.id);
  await A.page.locator("[role=dialog]").getByRole("button", { name: "Add driver" }).click();
  check("admin adds a driver on the page: name, email and phone (kept as digits), no hub user id", await toast(A.page, "added as a driver")
    && !!(await poll(async () => (await sql`select 1 from cab_drivers where email = 'zzc-driver@gmail.com' and name = 'ZZC Driver' and phone = '9876543210' and vehicle_id = ${v1.id}`)[0])));
  const [dr1] = await sql`select id from cab_drivers where email = 'zzc-driver@gmail.com'`;
  check("the same email twice is refused, whatever its case (409)", (await api(A.page, "/api/cabs/drivers", "POST", { name: "Again", email: "ZZC-Driver@gmail.com", phone: "9876543210" })).status === 409);
  check("a phone number that is too short is refused (400)", (await api(A.page, "/api/cabs/drivers", "POST", { name: "ZZC Short", email: "zzc-short@gmail.com", phone: "12345" })).status === 400);
  check("a driver cannot be given an inactive vehicle (409)", (await api(A.page, "/api/cabs/drivers", "POST", { name: "ZZC Second Driver", email: "zzc-driver2@gmail.com", phone: "9822000001", vehicleId: v3.id })).status === 409);
  const dr2 = (await api(A.page, "/api/cabs/drivers", "POST", { name: "ZZC Second Driver", email: "zzc-driver2@gmail.com", phone: "9822000001", vehicleId: v2.id })).body;
  check("a second driver, with a vehicle", !!dr2?.id);
  const nohub = (await api(A.page, "/api/cabs/drivers", "POST", { name: "ZZC Outside Driver", email: "zzc-nohub@gmail.com", phone: "+91 98220 00002" })).body;
  await go(A.page, "/cabs/admin/drivers");
  check("a driver with no hub account can be added, and is marked as one who cannot open Cabs Driver", !!nohub?.id
    && (await A.page.locator(`tr[data-driver="${nohub.id}"]`).innerText()).includes("No hub account") && !(await A.page.locator(`tr[data-driver="${dr1.id}"]`).innerText()).includes("No hub account"));
  await go(D.page, "/cabs/driver");
  check("once added, the driver opens Cabs Driver", new URL(D.page.url()).pathname === "/cabs/driver" && await D.page.locator('nav[aria-label="Cabs Driver"]').isVisible());

  section("booking");
  await go(S.page, "/cabs/book");
  await S.page.fill("input[name=pickup]", "ZZC Office"); await S.page.fill("input[name=dropoff]", "ZZC Airport");
  await S.page.fill("input[name=scheduledFor]", istSlot(1, 10)); await S.page.fill("textarea[name=notes]", "Two people, one bag");
  await S.page.getByRole("button", { name: "Request ride" }).click();
  await S.page.waitForURL((u) => u.pathname === "/cabs/rides", { timeout: 30000 });
  const r1 = await poll(async () => (await sql`select * from cab_rides where requested_by_id = ${staffer.id} and pickup = 'ZZC Office'`)[0]);
  check("staffer books on the form: a pending ride with their name, email and branch, at the India time chosen", r1?.status === "pending" && r1.requested_by_name === "ZZC Staffer"
    && r1.requested_by_email === "zzc-staffer@gmail.com" && r1.requested_by_branch === "ZZC Branch" && new Date(r1.scheduled_for).toISOString() === new Date(`${istSlot(1, 10)}:00+05:30`).toISOString(), JSON.stringify(r1));
  check("My Rides shows it, Pending", (await S.page.locator(`[data-ride="${r1.id}"] [data-status]`).innerText()).trim() === "Pending");
  check("the staffer is told it was received", (await notices(staffer)).some((n) => n.title === "Your ride request has been received"));
  check("a time in the past is refused", (await api(S.page, "/api/cabs/rides", "POST", { pickup: "ZZC a", dropoff: "b", scheduledFor: "2020-01-01T10:00" })).status === 400);

  section("assigning");
  await go(A.page, "/cabs/admin/rides?status=pending");
  await A.page.locator(`tr[data-ride="${r1.id}"]`).getByRole("button", { name: "Assign" }).click();
  await A.page.locator("[role=dialog] select[name=driverId]").selectOption(dr1.id);
  check("picking a driver offers their usual vehicle", (await A.page.locator("[role=dialog] select[name=vehicleId]").inputValue()) === v1.id);
  await A.page.locator("[role=dialog]").getByRole("button", { name: "Assign", exact: true }).click();
  const r1a = await poll(async () => { const x = await ride(r1.id); return x.status === "assigned" ? x : null; });
  check("admin assigns on the page: assigned, with the driver's name and the plate kept on the ride", r1a?.driver_id === dr1.id && r1a.vehicle_id === v1.id && r1a.driver_name === "ZZC Driver" && r1a.vehicle_plate === "ZZC 01 AA 1111" && !!r1a.assigned_at, JSON.stringify(r1a));
  check("the staffer is told: confirmed, with the driver and the plate", (await notices(staffer)).some((n) => n.title === "Your ride is confirmed" && n.body.includes("Driver: ZZC Driver, Vehicle: ZZC 01 AA 1111")));
  check("the driver is told a ride was assigned to them", (await notices(driver)).some((n) => n.title === "New ride assigned to you"));

  const r2 = (await api(S.page, "/api/cabs/rides", "POST", { pickup: "ZZC Office", dropoff: "ZZC Station", scheduledFor: istSlot(2, 9) })).body;
  const both = await Promise.all([1, 2].map(() => api(A.page, `/api/cabs/rides/${r2.id}/assign`, "POST", { driverId: dr2.id, vehicleId: v2.id })));
  check("two admins assigning the same ride at once: one succeeds, the other is told it was already assigned (409)",
    both.map((x) => x.status).sort().join(",") === "200,409" && both.some((x) => x.body?.error === "Ride already assigned"), JSON.stringify(both));
  const r3 = (await api(S.page, "/api/cabs/rides", "POST", { pickup: "ZZC Office", dropoff: "ZZC Hotel", scheduledFor: istSlot(3, 9) })).body;
  await api(A.page, `/api/cabs/drivers/${dr2.id}/availability`, "POST", { available: false });
  await go(D2.page, "/cabs/driver"); check("a driver marked unavailable cannot open Cabs Driver", new URL(D2.page.url()).pathname === "/");
  const off = await api(A.page, `/api/cabs/rides/${r3.id}/assign`, "POST", { driverId: dr2.id, vehicleId: v2.id });
  check("an unavailable driver cannot be given a ride (409)", off.status === 409 && /Driver not available/.test(off.body?.error), JSON.stringify(off));
  await api(A.page, `/api/cabs/drivers/${dr2.id}/availability`, "POST", { available: true });
  await sql`update cab_drivers set email = 'ZZC-Driver2@Gmail.com' where id = ${dr2.id}`; // as if typed into the database by hand
  await go(D2.page, "/cabs/driver"); check("available again, and a driver email stored with capitals still matches the hub email", new URL(D2.page.url()).pathname === "/cabs/driver");
  await sql`update cab_drivers set email = 'zzc-driver2@gmail.com' where id = ${dr2.id}`;
  const inactive = await api(A.page, `/api/cabs/rides/${r3.id}/assign`, "POST", { driverId: dr2.id, vehicleId: v3.id });
  check("an inactive vehicle cannot be given a ride (409)", inactive.status === 409 && /Vehicle inactive/.test(inactive.body?.error), JSON.stringify(inactive));
  check("…and the ride is still pending after both refusals", (await ride(r3.id)).status === "pending");

  section("driving");
  check("another driver cannot start someone else's ride (404)", (await api(D2.page, `/api/cabs/rides/${r1.id}/start`, "POST")).status === 404);
  check("a ride cannot be completed before it starts (409)", (await api(D.page, `/api/cabs/rides/${r1.id}/complete`, "POST")).status === 409);
  check("a staffer cannot start a ride (403)", (await api(S.page, `/api/cabs/rides/${r1.id}/start`, "POST")).status === 403);
  await go(D.page, "/cabs/driver");
  await D.page.locator(`[data-ride="${r1.id}"]`).getByRole("button", { name: "Start Ride" }).click();
  check("the driver starts the ride on their page: in progress", await toast(D.page, "Ride started") && (await poll(async () => (await ride(r1.id)).status === "in_progress")));
  await D.page.locator(`[data-ride="${r1.id}"]`).getByRole("button", { name: "Complete Ride" }).click();
  await D.page.locator("[role=dialog]").getByRole("button", { name: "Complete" }).click();
  check("…and completes it: completed, with the times recorded", await toast(D.page, "Ride completed") && !!(await poll(async () => { const x = await ride(r1.id); return x.status === "completed" && x.started_at && x.completed_at; })));
  check("the staffer is told the ride is complete", (await notices(staffer)).some((n) => n.title === "Your ride is complete"));
  await go(D.page, "/cabs/driver/rides");
  check("the driver's history shows it", await D.page.locator(`[data-ride="${r1.id}"]`).isVisible());

  section("cancelling");
  const r4 = (await api(S.page, "/api/cabs/rides", "POST", { pickup: "ZZC Office", dropoff: "ZZC Mall", scheduledFor: istSlot(4, 9) })).body;
  await go(S.page, "/cabs/rides");
  await S.page.locator(`[data-ride="${r4.id}"]`).getByRole("button", { name: "Cancel" }).click();
  await S.page.locator("[role=dialog]").getByRole("button", { name: "Cancel ride" }).click();
  check("the staffer cancels their own pending ride on the page", await toast(S.page, "Ride cancelled") && (await poll(async () => (await ride(r4.id)).status === "cancelled")));
  const own = await api(S.page, `/api/cabs/rides/${r2.id}/cancel`, "POST", {});
  check("…but not once it is assigned (409, ask a Cabs admin)", own.status === 409 && /Ask a Cabs admin/.test(own.body?.error), JSON.stringify(own));
  check("a staffer's ?as=admin is ignored: still only their own pending rides", (await api(S.page, `/api/cabs/rides/${r2.id}/cancel?as=admin`, "POST", { reason: "x" })).status === 409);
  check("an admin must give a reason (400)", (await api(A.page, `/api/cabs/rides/${r2.id}/cancel?as=admin`, "POST", {})).status === 400);
  await go(A.page, "/cabs/admin/rides");
  await A.page.locator(`tr[data-ride="${r2.id}"]`).getByRole("button", { name: "Cancel" }).click();
  await A.page.fill("[role=dialog] textarea[name=reason]", "ZZC car needed for an event");
  await A.page.locator("[role=dialog]").getByRole("button", { name: "Cancel ride" }).click();
  check("an admin cancels an assigned ride on the page, with a reason", await toast(A.page, "Ride cancelled")
    && !!(await poll(async () => { const x = await ride(r2.id); return x.status === "cancelled" && x.cancel_reason === "ZZC car needed for an event" && x.cancelled_by_name === "ZZC Admin"; })));
  check("the staffer is told why", (await notices(staffer)).some((n) => n.title === "Your ride was cancelled: ZZC car needed for an event"));
  check("the driver who had it is told too", (await notices(driver2)).some((n) => n.title === "A ride assigned to you was cancelled"));
  check("a finished ride cannot be cancelled (409)", (await api(A.page, `/api/cabs/rides/${r1.id}/cancel?as=admin`, "POST", { reason: "late" })).status === 409);

  section("removing what is in use");
  check("assigning the third ride to the second driver", (await api(A.page, `/api/cabs/rides/${r3.id}/assign`, "POST", { driverId: dr2.id, vehicleId: v2.id })).status === 200);
  check("a driver with an assigned ride cannot be removed (409)", (await api(A.page, `/api/cabs/drivers/${dr2.id}`, "DELETE")).status === 409);
  check("a vehicle on an assigned ride cannot be deactivated (409)", (await api(A.page, `/api/cabs/vehicles/${v2.id}`, "DELETE")).status === 409);
  check("a driver with nothing on can be removed; their completed ride keeps their name", (await api(A.page, `/api/cabs/drivers/${dr1.id}`, "DELETE")).status === 200
    && (await ride(r1.id)).driver_name === "ZZC Driver" && (await ride(r1.id)).driver_id === null);
  await go(D.page, "/cabs/driver"); check("a removed driver can no longer open Cabs Driver", new URL(D.page.url()).pathname === "/");

  section("dashboards and the audit log");
  await go(A.page, "/cabs/admin");
  check("admin dashboard shows the figures", await A.page.locator('[data-stat="Waiting for a driver"]').isVisible() && await A.page.locator('[data-stat="Active vehicles"]').isVisible());
  await go(S.page, "/cabs");
  check("staffer dashboard lists the upcoming (assigned) ride and the past ones", await S.page.locator(`[data-ride="${r3.id}"]`).first().isVisible() && await S.page.locator(`[data-ride="${r1.id}"]`).first().isVisible());
  const actions = (await sql`select action from cab_audit_log where actor_id in (${staffer.id}, ${admin.id}, ${driver.id}) order by created_at`).map((r) => r.action);
  check("the audit log recorded every kind of action", ["vehicle_added", "vehicle_updated", "vehicle_deactivated", "driver_added", "driver_availability", "driver_removed", "ride_created", "ride_assigned", "ride_started", "ride_completed", "ride_cancelled"].every((a) => actions.includes(a)), actions.join(","));
  check("driver and vehicle changes also went to the hub's audit log", (await sql`select count(*)::int n from access_audit where action like 'cabs.%' and target_label like 'ZZC%'`)[0].n >= 5);
  await go(A.page, "/cabs/admin/audit?action=ride_cancelled");
  check("audit page: filtered to cancellations", (await A.page.locator("tbody tr").count()) >= 2 && (await A.page.locator("tbody").innerText()).includes("ZZC Office → ZZC Station"));
  const csv = await A.page.evaluate(async () => { const r = await fetch("/api/cabs/audit/export?action=ride_assigned"); return { status: r.status, type: r.headers.get("content-type"), text: await r.text() }; });
  check("audit CSV: downloads with the header row and the assignments", csv.status === 200 && /text\/csv/.test(csv.type) && csv.text.replace(/^﻿/, "").startsWith("Time,Who,Action,About,Ride,Details") && csv.text.includes("Ride assigned"), csv.text.slice(0, 120));
  check("audit CSV: staff cannot download it (403)", (await S.page.evaluate(async () => (await fetch("/api/cabs/audit/export")).status)) === 403);
  check("no script errors on any page", pageErrors.length === 0, pageErrors.join(" | "));
} catch (e) {
  console.error(e); exitCode = 1;
} finally {
  await browser.close();
  await removeTestData();
  check("cleanup: every cab_ row that was not this test's own is exactly as before", (await snap()) === before);
  check("cleanup: the audit log is back to its size before the run", (await sql`select count(*)::int n from cab_audit_log`)[0].n === auditBefore);
  if (exitCode) process.exit(exitCode);
  finish();
}
