/**
 * End-to-end test of the Cab Booking module in a real browser: who may open each of its three sections (MCCIA Cabs, Cabs Driver, Cabs
 * Admin), vehicles and drivers, booking a ride, assigning it (and two admins assigning at once), the driver starting and completing it,
 * cancelling (by the person and by an admin, with a reason), the notifications each step sends, the audit log and its CSV; and phase 2:
 * the ride OTP (made on assign, shown only to the rider, three tries, an admin's New OTP), starting a ride with it and the Google Maps
 * link, the driver's phone sharing its position (a simulated GPS), and the admins' fleet map; and phase 3: Live Trips, vehicle
 * maintenance, ride costs, invoices, and user and driver activity; and drivers signing in by phone with an admin's login OTP. Run against a
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
import { createHash, randomBytes, scryptSync } from "node:crypto";
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
  await sql`delete from cab_audit_log where actor_name like 'ZZC%'`; // phone drivers' own actions (their actor id is their driver id)
  await sql`delete from cab_invoices where branch like 'ZZC%'`;
  await sql`delete from cab_rides where requested_by_email like 'zzc-%'`;
  await sql`delete from cab_drivers where email like 'zzc-%' or name like 'ZZC%'`;
  await sql`delete from cab_fuel_costs where vehicle_plate like 'ZZC%'`;
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
  await sql`select id, name, email, phone, is_available from cab_drivers where coalesce(email, '') not like 'zzc-%' and name not like 'ZZC%' order by id`,
  await sql`select id, status, driver_id, vehicle_id, updated_at from cab_rides where requested_by_email not like 'zzc-%' order by id`,
  await sql`select count(*)::int n from cab_audit_log`,
  await sql`select count(*)::int n from cab_driver_locations l join cab_drivers d on d.id = l.driver_id where d.email not like 'zzc-%'`,
  await sql`select count(*)::int n from cab_ride_otps o join cab_rides r on r.id = o.ride_id where r.requested_by_email not like 'zzc-%'`,
  await sql`select id, total_amount_paise, status from cab_invoices where branch not like 'ZZC%' order by id`,
  await sql`select id, base_fare_paise, invoice_id from cab_ride_costs c where not exists (select 1 from cab_rides r where r.id = c.ride_id and r.requested_by_email like 'zzc-%') order by id`,
  await sql`select id, cost_paise from cab_maintenance where vehicle_plate not like 'ZZC%' order by id`,
  await sql`select id, cost_paise from cab_fuel_costs where vehicle_plate not like 'ZZC%' order by id`,
  await sql`select id, login_requested_at from cab_drivers where name not like 'ZZC%' order by id`,
  await sql`select count(*)::int n from cab_driver_sessions s join cab_drivers d on d.id = s.driver_id where d.name not like 'ZZC%'`,
  await sql`select count(*)::int n from cab_driver_otps o join cab_drivers d on d.id = o.driver_id where d.name not like 'ZZC%'`,
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
/** `gps`: a simulated phone position this browser shares when asked (the driver's). */
const signedIn = async (email, gps) => {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 1000 }, ...(gps ? { geolocation: gps, permissions: ["geolocation"] } : {}) });
  ctx.setDefaultTimeout(45000);
  await ctx.addInitScript(() => { try { localStorage.setItem("mccia-install-popup-seen", "1"); localStorage.setItem("mccia-install-snoozed-until", String(Date.now() + 864e5)); } catch {} });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(`${new URL(page.url()).pathname}: ${String(e).slice(0, 120)}`));
  await page.goto(BASE + "/login"); await page.fill("input[name=email]", email); await page.fill("input[name=password]", PW);
  await page.click("button[type=submit]"); await page.waitForURL((u) => u.pathname === "/", { timeout: 60000 });
  return { ctx, page };
};
/** The Cabs Admin menu's lines, without their badges (a count, a dot). */
const navLabels = async (page) => (await page.locator('nav[aria-label="Cabs Admin"] a').allInnerTexts()).map((t) => t.replace(/\s*\d+\s*$/, "").trim()).join("|");
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
    for (const p of ["/cabs", "/cabs/book", "/cabs/rides", "/cabs/driver", "/cabs/driver/rides", "/cabs/admin", "/cabs/admin/rides", "/cabs/admin/trips", "/cabs/admin/pending", "/cabs/admin/upcoming", "/cabs/admin/drivers", "/cabs/admin/vehicles", "/cabs/admin/audit"]) {
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
  const D = await signedIn("zzc-driver@gmail.com", { latitude: 18.5204, longitude: 73.8567, accuracy: 12 });
  const D2 = await signedIn("zzc-driver2@gmail.com");
  const O = await signedIn("zzc-outsider@gmail.com");

  section("who may open which section");
  await go(S.page, "/");
  const tiles = await S.page.locator("main").innerText();
  check("hub: the staffer sees the MCCIA Cabs tile, not the Driver or Admin ones", tiles.includes("ZZC Cabs") && !tiles.includes("ZZC Cabs Admin") && !tiles.includes("ZZC Cabs Driver"));
  await go(S.page, "/cabs");
  check("staffer: /cabs opens on Book, with the rider menu (Book, My rides, Account) and the way back to the hub in the top bar", await S.page.locator('nav[aria-label="MCCIA Cabs"]').isVisible()
    && (await S.page.locator('nav[aria-label="MCCIA Cabs"] a').allInnerTexts()).map((t) => t.trim()).join("|") === "Book|My rides|Account"
    && (await S.page.locator('header a[href="/"]').count()) === 1 && (await S.page.getByRole("heading", { name: "Where to?" }).count()) === 1);
  await go(S.page, "/cabs/admin"); check("staffer: Cabs Admin sends them back to the hub", new URL(S.page.url()).pathname === "/");
  await go(S.page, "/cabs/driver"); check("staffer: Cabs Driver sends them back to the hub", new URL(S.page.url()).pathname === "/");
  await go(A.page, "/cabs/driver");
  check("admin: opens Cabs Driver too (to see it as a driver does), with its menu", new URL(A.page.url()).pathname === "/cabs/driver"
    && (await A.page.locator('nav[aria-label="Cabs Driver"] a').allInnerTexts()).map((t) => t.trim()).join("|") === "Assigned|Trip|History|Profile"
    && (await A.page.locator("header").getByText("Admin view").count()) === 1);
  check("admin: but cannot start a ride as a driver (403)", (await api(A.page, "/api/cabs/rides/00000000-0000-4000-8000-000000000000/start", "POST")).status === 403);
  await go(O.page, "/cabs"); check("someone without MCCIA Cabs is sent back to the hub", new URL(O.page.url()).pathname === "/");
  check("API: no MCCIA Cabs, no booking (403)", (await api(O.page, "/api/cabs/rides", "POST", { pickup: "a", dropoff: "b", scheduledFor: istSlot(1, 10) })).status === 403);
  check("API: a staffer cannot manage vehicles (403)", (await api(S.page, "/api/cabs/vehicles", "POST", { numberPlate: "ZZC 99", model: "x", capacity: 4 })).status === 403);
  const anon = await fetch(BASE + "/api/cabs/rides", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", redirect: "manual" });
  check("API: signed out is refused", anon.status === 401 || anon.status === 307, anon.status);
  await go(A.page, "/cabs/admin");
  check("admin: Cabs Admin opens with its menu", (await navLabels(A.page))
    === "App Hub|Dashboard|Live Trips|Pending Requests|Upcoming Rides|All Trips|Drivers|Vehicles|Maintenance|Payments|Audit Log");
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
  check("the Add driver form has no vehicle: drivers have no car of their own", (await A.page.locator("[role=dialog] select[name=vehicleId]").count()) === 0);
  await A.page.locator("[role=dialog]").getByRole("button", { name: "Add driver" }).click();
  check("admin adds a driver on the page: name, email and phone (kept as digits), no hub user id", await toast(A.page, "added as a driver")
    && !!(await poll(async () => (await sql`select 1 from cab_drivers where email = 'zzc-driver@gmail.com' and name = 'ZZC Driver' and phone = '9876543210'`)[0])));
  check("cab_drivers has no vehicle column any more (migration 0034)", (await sql`select 1 from information_schema.columns where table_name = 'cab_drivers' and column_name = 'vehicle_id'`).length === 0);
  const [dr1] = await sql`select id from cab_drivers where email = 'zzc-driver@gmail.com'`;
  check("the same email twice is refused, whatever its case (409)", (await api(A.page, "/api/cabs/drivers", "POST", { name: "Again", email: "ZZC-Driver@gmail.com", phone: "9876543210" })).status === 409);
  check("a phone number that is too short is refused (400)", (await api(A.page, "/api/cabs/drivers", "POST", { name: "ZZC Short", email: "zzc-short@gmail.com", phone: "12345" })).status === 400);
  const dr2 = (await api(A.page, "/api/cabs/drivers", "POST", { name: "ZZC Second Driver", email: "zzc-driver2@gmail.com", phone: "9822000001", vehicleId: v2.id })).body;
  check("a second driver (a vehicle sent with it is ignored)", !!dr2?.id);
  check("a driver can no longer be given a vehicle: editing takes a name and phone, so a vehicle alone is refused (400)", (await api(A.page, `/api/cabs/drivers/${dr2.id}`, "PATCH", { vehicleId: v1.id })).status === 400);
  const nohub = (await api(A.page, "/api/cabs/drivers", "POST", { name: "ZZC Outside Driver", email: "zzc-nohub@gmail.com", phone: "+91 98220 00002" })).body;
  await go(A.page, "/cabs/admin/drivers");
  check("a driver with no hub account can be added", !!nohub?.id);
  check("the Drivers list: Name, Phone, Availability (no Vehicle), with Get Login OTP on each driver",
    (await A.page.locator("thead th").allInnerTexts()).map((t) => t.trim().toLowerCase()).join("|") === "name|phone|availability|rides on|actions"
    && (await A.page.locator(`tr[data-driver="${nohub.id}"] [data-get-otp]`).count()) === 1);
  check("Drivers links to Driver Activity", (await A.page.locator("[data-driver-activity-link]").getAttribute("href")) === "/cabs/admin/drivers/activity");
  await A.page.locator(`tr[data-driver="${nohub.id}"] [data-edit-driver]`).click();
  await A.page.fill("[role=dialog] input[name=name]", "ZZC Outside Driver Two");
  await A.page.locator("[role=dialog]").getByRole("button", { name: "Save" }).click();
  check("Edit: the driver's name changes, logged as \"Driver edited\" with what changed", await toast(A.page, "Driver updated")
    && !!(await poll(async () => (await sql`select 1 from cab_drivers where id = ${nohub.id} and name = 'ZZC Outside Driver Two'`)[0]))
    && (await sql`select details from cab_audit_log where action = 'driver_edited' and details->>'subject' = 'ZZC Outside Driver Two'`)[0]?.details?.name === "ZZC Outside Driver → ZZC Outside Driver Two");
  const phoneClash = await api(A.page, `/api/cabs/drivers/${nohub.id}`, "PATCH", { name: "ZZC Outside Driver Two", phone: "98765 43210" });
  check("Edit: another driver's phone is refused (409), naming them; a staffer cannot edit (403)", phoneClash.status === 409 && /ZZC Driver already has the phone number/.test(phoneClash.body?.error)
    && (await api(S.page, `/api/cabs/drivers/${nohub.id}`, "PATCH", { name: "x", phone: "9822000099" })).status === 403, JSON.stringify(phoneClash));
  await go(A.page, "/cabs/admin/vehicles");
  check("the Vehicles list has no Drivers column", !(await A.page.locator("thead th").allInnerTexts()).some((t) => /drivers/i.test(t)));
  await go(D.page, "/cabs/driver");
  check("once added, the driver opens Cabs Driver", new URL(D.page.url()).pathname === "/cabs/driver" && await D.page.locator('nav[aria-label="Cabs Driver"]').isVisible());

  section("booking");
  await go(S.page, "/cabs/book");
  check("the old Book a Ride address goes to Book (/cabs)", new URL(S.page.url()).pathname === "/cabs");
  await S.page.fill("input[name=pickup]", "ZZC Office"); await S.page.fill("input[name=dropoff]", "ZZC Airport");
  await S.page.getByRole("tab", { name: "Schedule" }).click();
  check("Schedule starts at tomorrow, 9:00 AM (India time)", (await S.page.inputValue("input[name=scheduledDate]")) === istSlot(1, 9).slice(0, 10) && (await S.page.inputValue("select[name=scheduledTime]")) === "09:00");
  check("the time list runs in half hours, as AM/PM", (await S.page.locator("select[name=scheduledTime] option").count()) === 48 && (await S.page.locator('select[name=scheduledTime] option[value="13:30"]').innerText()) === "1:30 PM");
  // Today at midnight has passed: the form says so and sends nothing (set as a person might leave it, the way React sees a change).
  await S.page.fill("input[name=scheduledDate]", istSlot(0, 0).slice(0, 10));
  await S.page.$eval("select[name=scheduledTime]", (el) => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, "00:00"); el.dispatchEvent(new Event("change", { bubbles: true })); });
  const sentBefore = (await sql`select count(*)::int n from cab_rides where requested_by_id = ${staffer.id}`)[0].n;
  await S.page.getByRole("button", { name: "Send request" }).click();
  check("a time that has passed: \"Please select a future time\", and nothing is sent", (await S.page.locator("[data-time-error]").innerText()).trim() === "Please select a future time"
    && (await sql`select count(*)::int n from cab_rides where requested_by_id = ${staffer.id}`)[0].n === sentBefore);
  check("…and today's past half hours cannot be chosen", await S.page.$eval('select[name=scheduledTime] option[value="00:00"]', (o) => o.disabled));
  await S.page.getByRole("tab", { name: "Multi-day" }).click();
  await S.page.fill("input[name=scheduledDate]", istSlot(1, 9).slice(0, 10));
  check("Multi-day: a first day, a start time and a last day, from tomorrow to the day after", (await S.page.inputValue("input[name=endsOn]")) === istSlot(2, 9).slice(0, 10));
  await S.page.getByRole("tab", { name: "Schedule" }).click();
  await S.page.fill("input[name=scheduledDate]", istSlot(1, 10).slice(0, 10));
  await S.page.selectOption("select[name=scheduledTime]", "10:00");
  await S.page.getByRole("button", { name: "Add a note" }).click(); await S.page.fill("textarea[name=notes]", "Two people, one bag");
  await S.page.getByRole("button", { name: "More passengers" }).click();
  check("the passengers counter: 1 by default, + adds one", (await S.page.locator("[data-passengers]").innerText()).trim() === "2");
  await S.page.getByRole("button", { name: "Send request" }).click();
  await S.page.waitForURL((u) => u.pathname === "/cabs/rides", { timeout: 30000 });
  const r1 = await poll(async () => (await sql`select * from cab_rides where requested_by_id = ${staffer.id} and pickup = 'ZZC Office'`)[0]);
  check("staffer books on the form: a pending ride with their name, email and branch, at the India time chosen", r1?.status === "pending" && r1.requested_by_name === "ZZC Staffer"
    && r1.requested_by_email === "zzc-staffer@gmail.com" && r1.requested_by_branch === "ZZC Branch" && new Date(r1.scheduled_for).toISOString() === new Date(`${istSlot(1, 10)}:00+05:30`).toISOString()
    && r1.trip_type === "scheduled" && r1.passengers === 2 && r1.notes === "Two people, one bag", JSON.stringify(r1));
  check("My Rides shows it, Pending", (await S.page.locator(`[data-ride="${r1.id}"] [data-status]`).innerText()).trim() === "Pending");
  check("the staffer is told it was received", (await notices(staffer)).some((n) => n.title === "Your ride request has been received"));
  check("the Cabs admins get a bell notice to assign it", (await notices(admin)).some((n) => n.title === "New ride request from ZZC Staffer: ZZC Office → ZZC Airport"));
  check("…and only they (not the driver, nor someone without Cabs Admin)", !(await notices(driver)).some((n) => n.title.startsWith("New ride request")) && !(await notices(outsider)).some((n) => n.title.startsWith("New ride request")));
  check("a time in the past is refused", (await api(S.page, "/api/cabs/rides", "POST", { pickup: "ZZC a", dropoff: "b", scheduledFor: "2020-01-01T10:00" })).status === 400);
  const soon = new Date(Date.now() + 5 * 60_000 + 5.5 * 3600_000).toISOString().slice(0, 16);
  const soonRes = await api(S.page, "/api/cabs/rides", "POST", { pickup: "ZZC a", dropoff: "b", scheduledFor: soon });
  check("…and so is one only 5 minutes away: \"Please select a future time\"", soonRes.status === 400 && soonRes.body?.error === "Please select a future time", JSON.stringify(soonRes));
  const rNow = (await api(S.page, "/api/cabs/rides", "POST", { pickup: "ZZC Now Office", dropoff: "ZZC Now Station", tripType: "now" })).body;
  const rNowRow = await ride(rNow.id);
  check("Now: booked for the moment it was sent", rNowRow.trip_type === "now" && Math.abs(new Date(rNowRow.scheduled_for).getTime() - Date.now()) < 60_000);
  const rMulti = (await api(S.page, "/api/cabs/rides", "POST", { pickup: "ZZC Multi Office", dropoff: "ZZC Multi Resort", tripType: "multiday", scheduledFor: istSlot(2, 8),
    endsOn: istSlot(4, 0).slice(0, 10), passengers: 6, stops: [{ text: "ZZC Bank", lat: 18.51, lng: 73.84 }, { text: "ZZC Hotel" }] })).body;
  const rm = await ride(rMulti.id);
  check("Multi-day with stops and 6 passengers: the end of the last day, the stops in order", rm.trip_type === "multiday" && rm.passengers === 6
    && new Date(rm.ends_at).toISOString() === new Date(new Date(`${istSlot(4, 0).slice(0, 10)}T00:00:00+05:30`).getTime() + 86_399_999).toISOString()
    && JSON.stringify(rm.stops.map((x) => [x.text, x.lat, x.lng])) === JSON.stringify([["ZZC Bank", 18.51, 73.84], ["ZZC Hotel", null, null]]), JSON.stringify(rm.stops));
  await go(S.page, "/cabs/rides");
  check("My rides shows the multi-day dates, the stops and the passengers", /until/.test(await S.page.locator(`[data-ride="${rMulti.id}"]`).innerText())
    && (await S.page.locator(`[data-ride="${rMulti.id}"]`).innerText()).includes("Via ZZC Bank, ZZC Hotel") && (await S.page.locator(`[data-ride="${rMulti.id}"]`).innerText()).includes("6 passengers"));
  // A rider page left open, with notifications allowed (a stand-in records what would be shown): it alerts when the ride is confirmed.
  const watch = await S.ctx.newPage();
  await watch.addInitScript(() => {
    window.__notes = [];
    window.Notification = class { static permission = "granted"; static requestPermission = async () => "granted"; constructor(title, o) { window.__notes.push({ title, body: o?.body }); } };
  });
  await watch.goto(BASE + "/cabs/rides"); await watch.waitForLoadState("networkidle").catch(() => {});

  section("pending requests");
  {
    const [{ n: waitingNow }] = await sql`select count(*)::int as n from cab_rides where status = 'pending'`;
    await go(A.page, "/cabs/admin/rides?status=pending");
    check("the old All Rides address goes to All Trips, keeping its filters", new URL(A.page.url()).pathname === "/cabs/admin/trips" && new URL(A.page.url()).searchParams.get("status") === "pending");
    check("sidebar: Pending Requests shows how many rides are waiting, in red", Number(await A.page.locator("[data-pending-badge]").innerText()) === waitingNow, waitingNow);
    check("All Trips links to User Activity", (await A.page.locator("[data-user-activity-link]").getAttribute("href")) === "/cabs/admin/activity");
    await go(A.page, "/cabs/admin/pending");
    const order = await A.page.locator("article[data-ride]").evaluateAll((els) => els.map((e) => e.getAttribute("data-ride")));
    const want = (await sql`select id from cab_rides where status = 'pending' order by created_at`).map((r) => r.id);
    const card1 = await A.page.locator(`article[data-ride="${r1.id}"]`).innerText();
    check("Pending Requests: every waiting ride, the longest-waiting first, with rider, branch, route, time, passengers, Assign and Cancel", order.join() === want.join()
      && ["ZZC Staffer", "ZZC Branch", "ZZC Office", "ZZC Airport", "passenger", "Waiting"].every((t) => card1.includes(t))
      && (await A.page.locator(`article[data-ride="${r1.id}"] button`).allInnerTexts()).map((t) => t.trim()).join("|") === "Assign|Cancel", card1);
    const rQ = (await api(S.page, "/api/cabs/rides", "POST", { pickup: "ZZC Queue Pickup", dropoff: "ZZC Queue Drop", scheduledFor: istSlot(7, 10) })).body;
    await go(A.page, "/cabs/admin/pending");
    await A.page.locator(`article[data-ride="${rQ.id}"]`).getByRole("button", { name: "Cancel" }).click();
    await A.page.fill("[role=dialog] textarea[name=reason]", "ZZC no longer needed");
    await A.page.locator("[role=dialog]").getByRole("button", { name: "Cancel ride" }).click();
    check("Pending Requests: Cancel with a reason", await toast(A.page, "Ride cancelled")
      && !!(await poll(async () => { const x = await ride(rQ.id); return x.status === "cancelled" && x.cancel_reason === "ZZC no longer needed"; })));
  }

  section("assigning");
  await go(A.page, "/cabs/admin/trips?status=pending");
  await A.page.locator(`tr[data-ride="${r1.id}"]`).getByRole("button", { name: "Assign" }).click();
  await A.page.locator("[role=dialog] select[name=driverId]").selectOption(dr1.id);
  check("picking a driver chooses no car for you; every active car is offered with its seats, an inactive one is not",
    (await A.page.locator("[role=dialog] select[name=vehicleId]").inputValue()) === ""
    && (await A.page.locator(`[role=dialog] select[name=vehicleId] option[value="${v1.id}"]`).innerText()).includes("seats")
    && (await A.page.locator(`[role=dialog] select[name=vehicleId] option[value="${v2.id}"]`).count()) === 1
    && (await A.page.locator(`[role=dialog] select[name=vehicleId] option[value="${v3.id}"]`).count()) === 0);
  await A.page.locator("[role=dialog] select[name=vehicleId]").selectOption(v1.id);
  await A.page.locator("[role=dialog]").getByRole("button", { name: "Assign", exact: true }).click();
  const r1a = await poll(async () => { const x = await ride(r1.id); return x.status === "assigned" ? x : null; });
  check("admin assigns on the page: assigned, with the driver's name and the plate kept on the ride", r1a?.driver_id === dr1.id && r1a.vehicle_id === v1.id && r1a.driver_name === "ZZC Driver" && r1a.vehicle_plate === "ZZC 01 AA 1111" && !!r1a.assigned_at, JSON.stringify(r1a));
  check("the staffer is told: confirmed, with the driver and the plate", (await notices(staffer)).some((n) => n.title === "Your ride is confirmed" && n.body.includes("Driver: ZZC Driver, Vehicle: ZZC 01 AA 1111")));
  check("the driver is told a ride was assigned to them", (await notices(driver)).some((n) => n.title === "New ride assigned to you"));
  if (process.env.E2E_SMTP_LOG) {
    // The site under test sends its email to a local test mail server, which records each message's recipients and subject.
    const mails = async () => { try { return (await import("node:fs")).readFileSync(process.env.E2E_SMTP_LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
    const driverMail = await poll(async () => (await mails()).find((m) => m.to.includes("zzc-driver@gmail.com") && m.subject === "New ride assigned to you"), 15000);
    check("the driver is emailed about the ride (it reaches drivers without a hub account too)", !!driverMail, JSON.stringify(await mails()).slice(0, 300));
    check("the rider is emailed that the ride is confirmed", (await mails()).some((m) => m.to.includes("zzc-staffer@gmail.com") && m.subject === "Your ride is confirmed"));
    check("the admins' new-request notice is the bell only, not an email", !(await mails()).some((m) => m.subject.startsWith("New ride request")));
  }
  const alerted = await poll(async () => (await watch.evaluate(() => window.__notes)).find((n) => n.title === "Your ride is confirmed"), 40_000);
  check("the rider's open page alerts them that the ride is confirmed (within 30 seconds)", !!alerted && alerted.body.includes("ZZC Office") && alerted.body.includes("ZZC Driver"), JSON.stringify(alerted));
  await watch.close();
  await go(A.page, "/cabs/admin/trips?status=pending");
  await A.page.locator(`tr[data-ride="${rMulti.id}"]`).getByRole("button", { name: "Assign" }).click();
  const optText = (id) => A.page.$eval(`[role=dialog] select[name=vehicleId] option[value="${id}"]`, (o) => ({ disabled: o.disabled, text: o.textContent }));
  const [o1, o2] = [await optText(v1.id), await optText(v2.id)];
  check("assign dialog: a car with too few seats is marked \"Too small\" and can't be chosen; a big enough one can", o2.disabled && /Too small/.test(o2.text) && !o1.disabled && /7 seats/.test(o1.text), JSON.stringify([o1, o2]));
  await A.page.locator("[role=dialog]").getByRole("button", { name: "Close", exact: true }).last().click();
  const small = await api(A.page, `/api/cabs/rides/${rMulti.id}/assign`, "POST", { driverId: dr2.id, vehicleId: v2.id });
  check("a car with fewer seats than passengers is refused (409)", small.status === 409 && /4 seats and this ride is for 6/.test(small.body?.error), JSON.stringify(small));
  await api(S.page, `/api/cabs/rides/${rMulti.id}/cancel`, "POST", {}); await api(S.page, `/api/cabs/rides/${rNow.id}/cancel`, "POST", {});
  const otp1 = (await sql`select * from cab_ride_otps where ride_id = ${r1.id}`)[0];
  check("assigning made a 4-digit OTP, no tries used, expiring 2 hours after the scheduled time", /^\d{4}$/.test(otp1?.otp) && otp1.attempts === 0 && !otp1.verified_at
    && new Date(otp1.expires_at).getTime() === new Date(r1.scheduled_for).getTime() + 2 * 3600_000, JSON.stringify(otp1));
  await go(S.page, "/cabs/rides");
  check("the rider sees the OTP on My Rides, big, to show the driver", (await S.page.locator(`[data-ride="${r1.id}"] [data-otp]`).innerText()).includes(otp1.otp)
    && (await S.page.locator(`[data-ride="${r1.id}"] [data-otp]`).innerText()).includes("Show this to your driver"));
  await go(A.page, "/cabs/admin/trips");
  check("the admin's rides list never shows it", (await A.page.locator("[data-otp]").count()) === 0 && !(await A.page.locator(`tr[data-ride="${r1.id}"]`).innerText()).includes(otp1.otp));
  const asDriver = await api(D.page, `/api/cabs/rides/${r1.id}`, "GET");
  check("the driver can read the ride but not its OTP", asDriver.status === 200 && asDriver.body.ride.hasOtp === true && !JSON.stringify(asDriver.body).includes(`"${otp1.otp}"`), JSON.stringify(asDriver.body).slice(0, 200));

  const r2 = (await api(S.page, "/api/cabs/rides", "POST", { pickup: "ZZC Office", dropoff: "ZZC Station", scheduledFor: istSlot(2, 9) })).body;
  const both = await Promise.all([1, 2].map(() => api(A.page, `/api/cabs/rides/${r2.id}/assign`, "POST", { driverId: dr2.id, vehicleId: v2.id })));
  check("two admins assigning the same ride at once: one succeeds, the other is told it was already assigned (409)",
    both.map((x) => x.status).sort().join(",") === "200,409" && both.some((x) => x.body?.error === "Ride already assigned"), JSON.stringify(both));
  const r3 = (await api(S.page, "/api/cabs/rides", "POST", { pickup: "ZZC Office", dropoff: "ZZC Hotel", scheduledFor: istSlot(3, 9) })).body;
  await api(A.page, `/api/cabs/drivers/${dr2.id}/availability`, "POST", { available: false });
  await go(D2.page, "/cabs/driver");
  check("an offline driver still opens Cabs Driver, and their switch says Offline", new URL(D2.page.url()).pathname === "/cabs/driver" && (await D2.page.locator("[data-online]").getAttribute("data-online")) === "false");
  check("a driver can only switch themselves (403 for a staffer)", (await api(S.page, "/api/cabs/driver/availability", "POST", { available: false })).status === 403);
  const off = await api(A.page, `/api/cabs/rides/${r3.id}/assign`, "POST", { driverId: dr2.id, vehicleId: v2.id });
  check("an unavailable driver cannot be given a ride (409)", off.status === 409 && /Driver not available/.test(off.body?.error), JSON.stringify(off));
  await D2.page.locator("[data-online]").click();
  check("the driver goes Online themselves", await toast(D2.page, "You're online") && (await poll(async () => (await sql`select is_available from cab_drivers where id = ${dr2.id}`)[0].is_available === true)));
  await sql`update cab_drivers set email = 'ZZC-Driver2@Gmail.com' where id = ${dr2.id}`; // as if typed into the database by hand
  await go(D2.page, "/cabs/driver"); check("available again, and a driver email stored with capitals still matches the hub email", new URL(D2.page.url()).pathname === "/cabs/driver");
  await sql`update cab_drivers set email = 'zzc-driver2@gmail.com' where id = ${dr2.id}`;
  const inactive = await api(A.page, `/api/cabs/rides/${r3.id}/assign`, "POST", { driverId: dr2.id, vehicleId: v3.id });
  check("an inactive vehicle cannot be given a ride (409)", inactive.status === 409 && /Vehicle inactive/.test(inactive.body?.error), JSON.stringify(inactive));
  check("…and the ride is still pending after both refusals", (await ride(r3.id)).status === "pending");

  section("driving: the OTP");
  const wrong = otp1.otp === "0000" ? "1111" : "0000";
  check("another driver cannot start someone else's ride (404)", (await api(D2.page, `/api/cabs/rides/${r1.id}/start`, "POST")).status === 404);
  check("…nor enter its OTP, even the right one (404), and no try is used", (await api(D2.page, `/api/cabs/rides/${r1.id}/otp/verify`, "POST", { otp: otp1.otp })).status === 404
    && (await sql`select attempts from cab_ride_otps where ride_id = ${r1.id}`)[0].attempts === 0);
  check("a ride cannot be completed before it starts (409)", (await api(D.page, `/api/cabs/rides/${r1.id}/complete`, "POST")).status === 409);
  check("a staffer cannot start a ride or enter an OTP (403)", (await api(S.page, `/api/cabs/rides/${r1.id}/start`, "POST")).status === 403 && (await api(S.page, `/api/cabs/rides/${r1.id}/otp/verify`, "POST", { otp: otp1.otp })).status === 403);
  const plain = await api(D.page, `/api/cabs/rides/${r1.id}/start`, "POST");
  check("a ride with an OTP cannot be started without it (409)", plain.status === 409 && /rider's OTP/.test(plain.body?.error), JSON.stringify(plain));
  const tries = [];
  for (let i = 0; i < 3; i++) tries.push(await api(D.page, `/api/cabs/rides/${r1.id}/otp/verify`, "POST", { otp: wrong }));
  check("three wrong OTPs: 2 tries left, 1 try left, then locked", tries.map((t) => t.status).join() === "409,409,409" && /2 tries left/.test(tries[0].body?.error) && /1 try left/.test(tries[1].body?.error) && /locked/.test(tries[2].body?.error), JSON.stringify(tries.map((t) => t.body)));
  const afterLock = await api(D.page, `/api/cabs/rides/${r1.id}/otp/verify`, "POST", { otp: otp1.otp });
  check("once locked, even the right OTP is refused and the ride stays assigned", afterLock.status === 409 && /locked/.test(afterLock.body?.error) && (await ride(r1.id)).status === "assigned", JSON.stringify(afterLock));
  await go(A.page, "/cabs/admin/upcoming");
  const up1 = A.page.locator(`article[data-ride="${r1.id}"]`);
  const upOrder = await A.page.locator("article[data-ride]").evaluateAll((els) => els.map((e) => e.getAttribute("data-ride")));
  const upWant = (await sql`select id from cab_rides where status = 'assigned' order by scheduled_for, created_at`).map((r) => r.id);
  check("Upcoming Rides: assigned rides soonest first; this one with its driver, car and \"OTP locked\"; New OTP and Cancel, no Assign", upOrder.join() === upWant.join()
    && (await up1.innerText()).includes("ZZC Driver") && (await up1.innerText()).includes("ZZC 01 AA 1111") && (await up1.locator('[data-otp-state="locked"]').count()) === 1
    && (await up1.locator("button").allInnerTexts()).map((t) => t.trim()).join("|") === "New OTP|Cancel");
  await go(S.page, "/cabs/rides");
  check("the rider is told their OTP can no longer be used", (await S.page.locator(`[data-ride="${r1.id}"]`).innerText()).includes("can no longer be used"));
  check("a staffer cannot make a new OTP (403)", (await api(S.page, `/api/cabs/rides/${r1.id}/otp/reset`, "POST")).status === 403);
  await go(A.page, "/cabs/admin/trips");
  await A.page.locator(`tr[data-ride="${r1.id}"]`).getByRole("button", { name: "New OTP" }).click();
  check("an admin makes a new OTP on All Rides", await toast(A.page, "New OTP made"));
  const otp2 = await poll(async () => { const o = (await sql`select * from cab_ride_otps where ride_id = ${r1.id}`)[0]; return o.attempts === 0 ? o : null; });
  check("…with no tries used; the rider sees it, and it is recorded", !!otp2 && (await sql`select 1 from cab_audit_log where ride_id = ${r1.id} and action = 'otp_reset'`).length === 1);
  await go(S.page, "/cabs/rides");
  check("…on My Rides", (await S.page.locator(`[data-ride="${r1.id}"] [data-otp]`).innerText()).includes(otp2.otp));
  await go(A.page, "/cabs/admin/upcoming");
  check("…and Upcoming Rides shows it active, with until when, and Cancel only", (await A.page.locator(`article[data-ride="${r1.id}"] [data-otp-state="active"]`).count()) === 1
    && (await A.page.locator(`article[data-ride="${r1.id}"]`).innerText()).includes("works until")
    && (await A.page.locator(`article[data-ride="${r1.id}"] button`).allInnerTexts()).map((t) => t.trim()).join("|") === "Cancel");

  section("driving: navigation and live location");
  await go(D.page, "/cabs/driver");
  await D.page.locator(`[data-ride="${r1.id}"] input[name=otp]`).fill(otp2.otp);
  check("the OTP box opens the number keyboard", (await D.page.locator(`[data-ride="${r1.id}"] input[name=otp]`).getAttribute("inputmode")) === "numeric");
  await D.page.locator(`[data-ride="${r1.id}"]`).getByRole("button", { name: "Confirm pickup" }).click();
  check("the driver enters the rider's OTP on their page: pickup confirmed, the ride is in progress", await toast(D.page, "Pickup confirmed")
    && !!(await poll(async () => { const x = await ride(r1.id); return x.status === "in_progress" && x.otp_verified_at && x.started_at; })));
  const nav = D.page.locator(`[data-ride="${r1.id}"] [data-navigation]`);
  await nav.waitFor({ timeout: 15000 }).catch(() => {});
  const href = await nav.getAttribute("href").catch(() => "");
  check("Pickup confirmed: a full-width Open Google Maps button with the directions from pickup to drop-off", (await nav.innerText().catch(() => "")).includes("Open Google Maps")
    && (await D.page.locator(`[data-ride="${r1.id}"][data-picked-up]`).count()) === 1 && href?.startsWith("https://www.google.com/maps/dir/?api=1&origin=ZZC+Office&destination=ZZC+Airport&travelmode=driving"), href);
  check("\"Sharing location\", and the driver is asked to keep the page open", await D.page.getByText("Sharing location").first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false)
    && (await D.page.getByText("Keep this page open to share your location").count()) > 0);
  const pos = await poll(async () => (await sql`select * from cab_driver_locations where driver_id = ${dr1.id} order by recorded_at desc limit 1`)[0]);
  check("the driver's phone sent its position, tied to the ride", Number(pos?.latitude) === 18.5204 && Number(pos?.longitude) === 73.8567 && pos.ride_id === r1.id && Number(pos.accuracy) === 12, JSON.stringify(pos));
  const before2 = (await sql`select count(*)::int n from cab_driver_locations where driver_id = ${dr1.id}`)[0].n;
  await D.page.waitForTimeout(11_000);
  check("…and again 10 seconds later", (await sql`select count(*)::int n from cab_driver_locations where driver_id = ${dr1.id}`)[0].n > before2);
  const spoof = await api(D2.page, "/api/cabs/location", "POST", { driver_id: dr1.id, latitude: 18.6, longitude: 73.9, heading: 90, speed: 30, ride_id: r1.id });
  const [d2pos] = await sql`select * from cab_driver_locations where driver_id = ${dr2.id}`;
  check("a position is saved for the driver signed in, never the driver_id sent; a ride that is not theirs is dropped", spoof.status === 200 && spoof.body.saved === true && !!d2pos && d2pos.ride_id === null && Number(d2pos.heading) === 90
    && (await sql`select count(*)::int n from cab_driver_locations where driver_id = ${dr1.id} and latitude = 18.6`)[0].n === 0, JSON.stringify(spoof));
  const quick = await api(D2.page, "/api/cabs/location", "POST", { latitude: 18.61, longitude: 73.91 });
  check("a second post within 5 seconds is dropped", quick.status === 200 && quick.body.saved === false && (await sql`select count(*)::int n from cab_driver_locations where driver_id = ${dr2.id}`)[0].n === 1);
  check("a staffer cannot send a position (403); a bad one is refused (400)", (await api(S.page, "/api/cabs/location", "POST", { latitude: 18.5, longitude: 73.8 })).status === 403
    && (await api(D2.page, "/api/cabs/location", "POST", { latitude: 95, longitude: 73.8 })).status === 400);
  const fleet = await api(A.page, "/api/cabs/fleet", "GET");
  const f1 = fleet.body?.drivers?.find((x) => x.driver_id === dr1.id), f2 = fleet.body?.drivers?.find((x) => x.driver_id === dr2.id);
  check("fleet: each driver's latest position, their current ride and vehicle", fleet.status === 200 && f1?.latitude === 18.5204 && f1.current_ride_id === r1.id && f1.current_ride_status === "in_progress"
    && f1.vehicle_plate === "ZZC 01 AA 1111" && f1.driver_name === "ZZC Driver" && f2?.latitude === 18.6 && !!f2.recorded_at, JSON.stringify(fleet.body).slice(0, 300));
  check("fleet: Cabs admins only (403 for a driver or a staffer)", (await api(D.page, "/api/cabs/fleet", "GET")).status === 403 && (await api(S.page, "/api/cabs/fleet", "GET")).status === 403);
  await go(A.page, "/cabs/admin");
  check("the dashboard has no map any more (it is on Live Trips)", (await A.page.locator("[data-fleet-map], .leaflet-container").count()) === 0);
  await go(A.page, "/cabs/admin/live");
  check("Live Trips, All drivers: the fleet map draws a marker for each driver, labelled with when they were last seen",
    await A.page.locator("[data-fleet-map] .leaflet-marker-icon").first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false)
    && (await A.page.locator("[data-fleet-map] .leaflet-marker-icon").count()) >= 2 && /ZZC Driver · (just now|\d+ min ago)/.test((await A.page.locator("[data-fleet-map] .leaflet-tooltip").allInnerTexts()).join("|")),
    (await A.page.locator("[data-fleet-map] .leaflet-tooltip").allInnerTexts().catch(() => [])).join("|"));
  const fleetRow = await A.page.locator(`tr[data-fleet-driver="${dr1.id}"]`).innerText().catch((e) => String(e));
  check("…and lists the drivers below it, with availability and last seen", /available/i.test(fleetRow) && /just now|min ago/.test(fleetRow), fleetRow);
  const polls = [];
  A.page.on("request", (q) => { if (q.url().includes("/api/cabs/fleet")) polls.push(Date.now()); });
  await A.page.waitForTimeout(5_000);
  check("the map polls the fleet every 2 seconds", polls.length >= 2 && polls.length <= 4, polls.length);

  const live = await api(A.page, "/api/cabs/live", "GET");
  const lt = live.body?.trips?.find((t) => t.ride_id === r1.id);
  check("Live Trips: the ride in progress, with its driver, rider, route, start and the driver's position", live.status === 200 && lt?.driver_name === "ZZC Driver" && lt.rider_name === "ZZC Staffer"
    && lt.pickup === "ZZC Office" && lt.dropoff === "ZZC Airport" && !!lt.started_at && lt.latitude === 18.5204, JSON.stringify(live.body).slice(0, 300));
  check("Live Trips: Cabs admins only (403)", (await api(S.page, "/api/cabs/live", "GET")).status === 403 && (await api(D.page, "/api/cabs/live", "GET")).status === 403);
  await go(A.page, "/cabs/admin/live");
  check("Live Trips page: the green dot in the menu, the ride on the map and in the list",
    (await A.page.locator('nav[aria-label="Cabs Admin"] [data-live-dot]').count()) === 1
    && await A.page.locator('[data-map="live"] .leaflet-marker-icon').first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false)
    && await A.page.locator(`tr[data-live-ride="${r1.id}"]`).waitFor({ timeout: 15000 }).then(() => true).catch(() => false)
    && (await A.page.locator(`tr[data-live-ride="${r1.id}"]`).innerText()).includes("ZZC Staffer"));
  const livePolls = [];
  A.page.on("request", (q) => { if (q.url().includes("/api/cabs/live")) livePolls.push(Date.now()); });
  await A.page.waitForTimeout(11_000);
  check("Live Trips refreshes every 5 seconds", livePolls.length >= 2 && livePolls.length <= 3, livePolls.length);

  await D.page.locator(`[data-ride="${r1.id}"]`).getByRole("button", { name: "Go to Trip" }).click();
  await D.page.waitForURL((u) => u.pathname === "/cabs/driver/trip");
  check("Go to Trip: the ride under way, with Open Google Maps and Complete Ride", (await D.page.locator(`[data-ride="${r1.id}"] [data-navigation]`).innerText()).includes("Open Google Maps"));
  await D.page.locator(`[data-ride="${r1.id}"]`).getByRole("button", { name: "Complete Ride" }).click();
  await D.page.locator("[role=dialog]").getByRole("button", { name: "Complete" }).click();
  check("the driver completes it: completed, with the times recorded", await toast(D.page, "Ride completed") && !!(await poll(async () => { const x = await ride(r1.id); return x.status === "completed" && x.started_at && x.completed_at; })));
  check("…and stops sharing their location", await poll(async () => (await D.page.getByText("Sharing location").count()) === 0, 10000));
  check("the staffer is told the ride is complete", (await notices(staffer)).some((n) => n.title === "Your ride is complete"));
  await go(D.page, "/cabs/driver/rides");
  check("the driver's history shows it", await D.page.locator(`[data-ride="${r1.id}"]`).isVisible());

  section("coordinates, and rides from before OTPs");
  const r5 = (await api(S.page, "/api/cabs/rides", "POST", { pickup: "ZZC Pin Office", dropoff: "ZZC Pin Airport", scheduledFor: istSlot(1, 15), pickup_lat: 18.5204, pickup_lng: 73.8567, dropoff_lat: 18.5821, dropoff_lng: 73.9197 })).body;
  const r5row = await ride(r5.id);
  check("a ride booked with coordinates keeps them", Number(r5row.pickup_lat) === 18.5204 && Number(r5row.dropoff_lng) === 73.9197);
  check("a pickup with only half a point is refused (400)", (await api(S.page, "/api/cabs/rides", "POST", { pickup: "ZZC a", dropoff: "ZZC b", scheduledFor: istSlot(1, 16), pickupLat: 18.5 })).status === 400);
  await api(A.page, `/api/cabs/rides/${r5.id}/assign`, "POST", { driverId: dr1.id, vehicleId: v1.id });
  const code5 = (await sql`select otp from cab_ride_otps where ride_id = ${r5.id}`)[0].otp;
  const ok5 = await api(D.page, `/api/cabs/rides/${r5.id}/otp/verify`, "POST", { otp: code5 });
  check("with coordinates, the Maps link goes from point to point", ok5.status === 200 && ok5.body.mapsUrl === "https://www.google.com/maps/dir/?api=1&origin=18.5204%2C73.8567&destination=18.5821%2C73.9197&travelmode=driving", JSON.stringify(ok5.body));
  check("a used OTP cannot be used again", (await api(D.page, `/api/cabs/rides/${r5.id}/otp/verify`, "POST", { otp: code5 })).status === 409);
  await api(D.page, `/api/cabs/rides/${r5.id}/complete`, "POST");
  const r6 = (await api(S.page, "/api/cabs/rides", "POST", { pickup: "ZZC Old Office", dropoff: "ZZC Old Station", scheduledFor: istSlot(1, 17) })).body;
  await api(A.page, `/api/cabs/rides/${r6.id}/assign`, "POST", { driverId: dr1.id, vehicleId: v1.id });
  await sql`delete from cab_ride_otps where ride_id = ${r6.id}`; // as a ride assigned before OTPs existed
  await go(D.page, "/cabs/driver");
  check("a ride without an OTP keeps Start Ride (no OTP box)", (await D.page.locator(`[data-ride="${r6.id}"] input[name=otp]`).count()) === 0);
  await D.page.locator(`[data-ride="${r6.id}"]`).getByRole("button", { name: "Start Ride" }).click();
  check("…and starts with it", await toast(D.page, "Ride started") && (await poll(async () => (await ride(r6.id)).status === "in_progress")));
  await api(D.page, `/api/cabs/rides/${r6.id}/complete`, "POST");

  section("phase 3: maintenance");
  await go(A.page, "/cabs/admin");
  check("with no ride in progress, no green dot", (await A.page.locator("[data-live-dot]").count()) === 0);
  check("the admin menu: one flat list", (await navLabels(A.page))
    === "App Hub|Dashboard|Live Trips|Pending Requests|Upcoming Rides|All Trips|Drivers|Vehicles|Maintenance|Payments|Audit Log");
  const ist = (days) => new Date(Date.now() + days * 86_400_000 + 5.5 * 3600_000).toISOString().slice(0, 10);
  await go(A.page, "/cabs/admin/maintenance");
  await A.page.locator("[data-add-maintenance]").click();
  await A.page.locator("[role=dialog] select[name=vehicleId]").selectOption(v1.id);
  await A.page.locator("[role=dialog] select[name=type]").selectOption("service");
  await A.page.fill("[role=dialog] input[name=description]", "ZZC oil change");
  await A.page.fill("[role=dialog] input[name=cost]", "2,500");
  await A.page.fill("[role=dialog] input[name=doneBy]", "ZZC Garage");
  await A.page.fill("[role=dialog] input[name=doneAt]", ist(-10));
  await A.page.fill("[role=dialog] input[name=nextDueAt]", ist(-2));
  await A.page.locator("[role=dialog]").getByRole("button", { name: "Add record" }).click();
  const mrow = await poll(async () => (await sql`select * from cab_maintenance where description = 'ZZC oil change'`)[0]);
  check("admin records maintenance on the page: the plate copied in, the cost in paise, the days as India dates", await toast(A.page, "Maintenance recorded") && mrow?.vehicle_plate === "ZZC 01 AA 1111"
    && mrow.cost_paise === 250000 && mrow.recorded_by_name === "ZZC Admin" && new Date(mrow.done_at).toISOString() === new Date(`${ist(-10)}T00:00:00+05:30`).toISOString(), JSON.stringify(mrow));
  check("a next due date that has passed is shown in red as overdue", (await A.page.locator(`tr[data-maintenance="${mrow.id}"] [data-overdue]`).innerText()).includes("overdue"));
  await go(A.page, "/cabs/admin/vehicles");
  check("Vehicles: last maintenance and next due shown, red when overdue or within 7 days", !!(await A.page.locator(`tr[data-vehicle="${v1.id}"] [data-due-soon]`).count())
    && (await A.page.locator(`tr[data-vehicle="${v2.id}"] [data-due-soon]`).count()) === 0);
  const edit = await api(A.page, `/api/cabs/maintenance/${mrow.id}`, "PATCH", { vehicleId: v1.id, type: "repair", description: "ZZC oil change and filter", cost: "3000", doneAt: ist(-10), doneBy: "ZZC Garage", nextDueAt: ist(30) });
  check("editing a record", edit.status === 200 && (await sql`select type, cost_paise, description from cab_maintenance where id = ${mrow.id}`)[0].cost_paise === 300000);
  check("maintenance on an inactive vehicle is refused (409); a bad date (400)", (await api(A.page, "/api/cabs/maintenance", "POST", { vehicleId: v3.id, type: "service", description: "ZZC x", doneAt: ist(-1), doneBy: "ZZC" })).status === 409
    && (await api(A.page, "/api/cabs/maintenance", "POST", { vehicleId: v1.id, type: "service", description: "ZZC x", doneAt: "2026-02-30", doneBy: "ZZC" })).status === 400);
  const extra = (await api(A.page, "/api/cabs/maintenance", "POST", { vehicleId: v2.id, type: "cleaning", description: "ZZC wash", doneAt: ist(-1), doneBy: "ZZC Wash Co" })).body;
  await go(A.page, "/cabs/admin/maintenance?type=cleaning");
  check("the type filter", (await A.page.locator("tbody tr[data-maintenance]").count()) >= 1 && (await A.page.locator(`tr[data-maintenance="${mrow.id}"]`).count()) === 0);
  await A.page.getByRole("button", { name: "Delete ZZC wash" }).click();
  await A.page.locator("[role=dialog]").getByRole("button", { name: "Delete" }).click();
  check("deleting a record on the page", await toast(A.page, "Record deleted") && (await poll(async () => (await sql`select count(*)::int n from cab_maintenance where id = ${extra.id}`)[0].n === 0)));
  const mcsv = await A.page.evaluate(async () => (await fetch("/api/cabs/maintenance/export")).text());
  check("maintenance CSV", mcsv.replace(/^\uFEFF/, "").startsWith("Vehicle,Type,Description,Cost (Rs)") && mcsv.includes("ZZC oil change and filter") && mcsv.includes("3000"));
  check("maintenance is for Cabs admins only (403)", (await api(S.page, "/api/cabs/maintenance", "POST", { vehicleId: v1.id, type: "service", description: "x", doneAt: ist(-1), doneBy: "x" })).status === 403);

  section("fuel costs");
  {
    await go(A.page, "/cabs/admin/payments");
    await A.page.getByRole("button", { name: "Add Fuel Cost" }).click();
    const fuelForm = A.page.locator("[role=dialog]");
    check("Add Fuel Cost: active vehicles only, \"Added by\" the admin signed in", (await fuelForm.locator(`select[name=vehicleId] option[value="${v3.id}"]`).count()) === 0
      && (await fuelForm.innerText()).includes("Added by ZZC Admin"));
    await fuelForm.locator("select[name=vehicleId]").selectOption(v1.id);
    await fuelForm.locator("input[name=fuelledAt]").fill(`${ist(-1)}T18:45`);
    await fuelForm.locator("input[name=litres]").fill("40.25");
    await fuelForm.locator("input[name=cost]").fill("4,100.50");
    await fuelForm.locator("input[name=stationName]").fill("ZZC HP Baner");
    await fuelForm.getByRole("button", { name: "Add fuel cost" }).click();
    const fuel1 = await poll(async () => (await sql`select * from cab_fuel_costs where vehicle_plate = 'ZZC 01 AA 1111' and station_name = 'ZZC HP Baner'`)[0]);
    check("…recorded: the plate copied in, litres, the cost in paise, the time in India, who added it", await toast(A.page, "Fuel cost recorded") && fuel1?.litres === "40.25"
      && fuel1.cost_paise === 410050 && fuel1.recorded_by_name === "ZZC Admin" && new Date(fuel1.fuelled_at).toISOString() === new Date(`${ist(-1)}T18:45:00+05:30`).toISOString(), JSON.stringify(fuel1));
    const fuelRow = await A.page.locator(`tr[data-fuel-row="${fuel1?.id}"]`).innerText().catch(() => "");
    check("…and listed: date, vehicle, litres, cost, station, added by", ["ZZC 01 AA 1111", "40.25", "ZZC HP Baner", "ZZC Admin", "4,100.5"].every((t) => fuelRow.includes(t)), fuelRow);
    const fuelBody = (extra) => ({ vehicleId: v1.id, fuelledAt: `${ist(-2)}T09:00`, litres: "10", cost: "1000", ...extra });
    check("fuel: a staffer cannot record it (403); an inactive vehicle (409), a time in the future, no litres or no cost (400) are refused",
      (await api(S.page, "/api/cabs/fuel", "POST", fuelBody({}))).status === 403 && (await api(A.page, "/api/cabs/fuel", "POST", fuelBody({ vehicleId: v3.id }))).status === 409
      && (await api(A.page, "/api/cabs/fuel", "POST", fuelBody({ fuelledAt: `${ist(2)}T09:00` }))).status === 400 && (await api(A.page, "/api/cabs/fuel", "POST", fuelBody({ litres: "0" }))).status === 400
      && (await api(A.page, "/api/cabs/fuel", "POST", fuelBody({ cost: "" }))).status === 400);
    const fuel2 = (await api(A.page, "/api/cabs/fuel", "POST", fuelBody({ vehicleId: v2.id, stationName: "ZZC Mistake" }))).body;
    const fcsv = await A.page.evaluate(async () => { const r = await fetch("/api/cabs/fuel/export"); return { status: r.status, type: r.headers.get("content-type"), text: await r.text() }; });
    check("fuel CSV: the header row and the records, newest first", fcsv.status === 200 && /text\/csv/.test(fcsv.type) && fcsv.text.replace(/^\uFEFF/, "").startsWith("Date,Vehicle,Litres,Cost (Rs),Petrol station,Added by")
      && fcsv.text.indexOf("ZZC HP Baner") < fcsv.text.indexOf("ZZC Mistake") && (await S.page.evaluate(async () => (await fetch("/api/cabs/fuel/export")).status)) === 403, fcsv.text.slice(0, 160));
    await go(A.page, "/cabs/admin/payments");
    await A.page.locator(`tr[data-fuel-row="${fuel2.id}"]`).getByRole("button", { name: "Delete" }).click();
    await A.page.locator("[role=dialog]").getByRole("button", { name: "Delete" }).click();
    check("a fuel record entered by mistake is deleted; recording and deleting are both in the audit log", await toast(A.page, "Fuel record deleted")
      && !!(await poll(async () => (await sql`select 1 from cab_fuel_costs where id = ${fuel2.id}`).length === 0))
      && (await sql`select count(*)::int n from cab_audit_log where action = 'fuel_recorded' and actor_id = ${admin.id}`)[0].n === 2
      && (await sql`select count(*)::int n from cab_audit_log where action = 'fuel_deleted' and details->>'subject' = 'ZZC 02 BB 2222'`)[0].n === 1);
    check("Payments shows this month's fuel", /This month: ₹/.test(await A.page.locator("[data-fuel-month]").innerText()));
  }

  section("phase 3: ride costs");
  check("only a completed ride gets a cost (409 for an assigned one)", (await api(A.page, `/api/cabs/rides/${r3.id}/cost`, "POST", { fare: "100" })).status === 409);
  await go(A.page, "/cabs/admin/payments?missing=1");
  await A.page.locator(`tr[data-cost-ride="${r1.id}"]`).getByRole("button", { name: "Add Cost" }).click();
  await A.page.fill("[role=dialog] input[name=fare]", "850");
  await A.page.fill("[role=dialog] input[name=distanceKm]", "18.5");
  await A.page.locator("[role=dialog]").getByRole("button", { name: "Save" }).click();
  check("admin adds a ride's cost on the page", await toast(A.page, "Cost recorded") && !!(await poll(async () => (await sql`select 1 from cab_ride_costs where ride_id = ${r1.id} and base_fare_paise = 85000 and distance_km = 18.5`)[0])));
  check("costs for two more rides", (await api(A.page, `/api/cabs/rides/${r5.id}/cost`, "POST", { fare: "1,200.50" })).body?.result === "recorded"
    && (await api(A.page, `/api/cabs/rides/${r6.id}/cost`, "POST", { fare: "500" })).body?.result === "recorded");
  check("changing a cost", (await api(A.page, `/api/cabs/rides/${r6.id}/cost`, "POST", { fare: "600", notes: "ZZC toll" })).body?.result === "changed"
    && (await sql`select base_fare_paise from cab_ride_costs where ride_id = ${r6.id}`)[0].base_fare_paise === 60000);
  check("a cost needs an amount (400); staff cannot record one (403)", (await api(A.page, `/api/cabs/rides/${r6.id}/cost`, "POST", { fare: "" })).status === 400
    && (await api(S.page, `/api/cabs/rides/${r6.id}/cost`, "POST", { fare: "1" })).status === 403);
  await go(A.page, "/cabs/admin/payments");
  check("payments: this month's figures count the costed rides", Number((await A.page.locator('[data-stat="Rides costed this month"]').innerText()).replace(/\D/g, "")) >= 3);
  const pcsv = await A.page.evaluate(async () => (await fetch("/api/cabs/payments/export?branch=ZZC%20Branch")).text());
  check("payments CSV, filtered by branch", pcsv.includes("ZZC Office") && pcsv.includes("1200.5") && !pcsv.includes("Pune HQ"));

  section("phase 3: invoices");
  const fy = (() => { const d = new Date(Date.now() + 5.5 * 3600_000); return d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; })();
  await go(A.page, "/cabs/admin/payments/invoices");
  await A.page.getByRole("button", { name: "Create invoice" }).click();
  await A.page.locator("[role=dialog] select[name=branch]").selectOption("ZZC Branch");
  await A.page.fill("[role=dialog] input[name=periodStart]", ist(-1));
  await A.page.fill("[role=dialog] input[name=periodEnd]", ist(1));
  await A.page.locator("[role=dialog]").getByRole("button", { name: "Create" }).click();
  const inv = await poll(async () => (await sql`select * from cab_invoices where branch = 'ZZC Branch'`)[0]);
  check("admin creates an invoice: CAB-<FY>-NNNN, the branch's 3 costed rides and their total, a draft", await toast(A.page, "Invoice created")
    && new RegExp(`^CAB-${fy}-\\d{4}$`).test(inv?.invoice_number) && inv.total_rides === 3 && inv.total_amount_paise === 85000 + 120050 + 60000 && inv.status === "draft", JSON.stringify(inv));
  check("…and claims those rides, so a ride is billed once", (await sql`select count(*)::int n from cab_ride_costs where invoice_id = ${inv.id}`)[0].n === 3);
  const again = await api(A.page, "/api/cabs/invoices", "POST", { branch: "ZZC Branch", periodStart: ist(-5), periodEnd: ist(5) });
  check("a second, overlapping invoice finds nothing left to bill (409)", again.status === 409 && /No costed rides/.test(again.body?.error), JSON.stringify(again));
  check("while the invoice is a draft, changing a cost moves its total", (await api(A.page, `/api/cabs/rides/${r6.id}/cost`, "POST", { fare: "700" })).body?.result === "changed"
    && (await sql`select total_amount_paise from cab_invoices where id = ${inv.id}`)[0].total_amount_paise === 85000 + 120050 + 70000);
  await go(A.page, "/cabs/admin/payments/invoices");
  check("the invoice list shows it as a draft (grey)", (await A.page.locator(`tr[data-invoice="${inv.id}"] [data-invoice-status]`).getAttribute("data-invoice-status")) === "draft");
  await A.page.locator(`tr[data-invoice="${inv.id}"]`).getByRole("button", { name: "Mark sent" }).click();
  check("mark sent", await toast(A.page, "Marked sent") && (await poll(async () => (await sql`select status from cab_invoices where id = ${inv.id}`)[0].status === "sent")));
  const locked = await api(A.page, `/api/cabs/rides/${r6.id}/cost`, "POST", { fare: "900" });
  check("once sent, its rides' costs can't change (409)", locked.status === 409 && /has been sent/.test(locked.body?.error), JSON.stringify(locked));
  check("a sent invoice cannot be deleted (409), nor sent again (409)", (await api(A.page, `/api/cabs/invoices/${inv.id}`, "DELETE")).status === 409 && (await api(A.page, `/api/cabs/invoices/${inv.id}/sent`, "POST")).status === 409);
  check("mark paid: paid, with the date", (await api(A.page, `/api/cabs/invoices/${inv.id}/paid`, "POST")).status === 200 && !!(await sql`select paid_at from cab_invoices where id = ${inv.id} and status = 'paid'`)[0]?.paid_at);
  check("invoices are for Cabs admins only (403)", (await api(S.page, "/api/cabs/invoices", "POST", { branch: "ZZC Branch", periodStart: ist(-1), periodEnd: ist(1) })).status === 403);

  section("phase 3: activity");
  const [{ n: booked }] = await sql`select count(*)::int n from cab_rides where requested_by_id = ${staffer.id}`;
  await go(A.page, "/cabs/admin/activity");
  const urow = await A.page.locator(`tr[data-user-activity="${staffer.id}"]`).innerText();
  check("user activity: the staffer's rides, branch and most common pickup", urow.includes("ZZC Staffer") && urow.includes("ZZC Branch") && urow.includes(String(booked)) && urow.includes("ZZC Office"), urow);
  await A.page.locator(`tr[data-user-activity="${staffer.id}"] a`).click();
  await A.page.waitForURL((u) => u.pathname === "/cabs/admin/trips" && u.searchParams.get("user") === staffer.id);
  check("a user row opens All Trips with only their rides", (await A.page.locator("tbody tr[data-ride]").count()) === booked);
  const ucsv = await A.page.evaluate(async () => (await fetch("/api/cabs/activity/export?branch=ZZC%20Branch")).text());
  check("user activity CSV", ucsv.replace(/^\uFEFF/, "").startsWith("User,Branch,Total rides") && ucsv.includes("ZZC Staffer"));
  await go(A.page, "/cabs/admin/drivers/activity");
  const drow = await A.page.locator(`tr[data-driver-activity="${dr1.id}"]`).innerText();
  check("driver activity: completed rides, phone, vehicle, average ride time", drow.includes("ZZC Driver") && drow.includes("9876543210") && drow.includes("ZZC 01 AA 1111") && /\t3\t/.test(drow), drow);
  await go(A.page, "/cabs/admin/drivers/activity?available=no");
  check("driver activity: the availability filter", (await A.page.locator(`tr[data-driver-activity="${dr1.id}"]`).count()) === 0);
  await go(D.page, "/cabs/driver/profile");
  const [current] = await sql`select vehicle_plate from cab_rides where driver_id = ${dr1.id} and status in ('in_progress', 'assigned') order by (status = 'in_progress') desc, scheduled_for limit 1`;
  check("driver Profile: name, phone, the current ride's car (or none) and rides completed", (await D.page.locator("[data-profile]").innerText()).includes("9876543210")
    && (await D.page.locator("[data-completed]").innerText()).trim() === "3" && (await D.page.locator("[data-current-vehicle]").innerText()).includes(current?.vehicle_plate ?? "No ride right now"));
  check("activity pages are for Cabs admins only", (await go(S.page, "/cabs/admin/activity")) && new URL(S.page.url()).pathname === "/");

  section("maps, address search and GPS fallbacks");
  {
    // A map with OpenStreetMap's tiles failing: CARTO takes over (this test site has no Geoapify key). Nothing is sent to the real tile servers.
    const ctx = A.page.context();
    const tileHits = { osm: 0, carto: 0 };
    await ctx.route("https://tile.openstreetmap.org/**", (rt) => { tileHits.osm++; return rt.abort(); });
    await ctx.route("https://*.basemaps.cartocdn.com/**", (rt) => { tileHits.carto++; return rt.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64") }); });
    await go(A.page, "/cabs/admin/live");
    const switched = await poll(async () => (await A.page.locator('[data-map="live"] img.leaflet-tile[src*="basemaps.cartocdn.com"]').count()) > 0, 15000);
    check("map tiles: when OpenStreetMap's fail, CARTO's are used instead", switched && tileHits.osm >= 4 && tileHits.carto > 0, JSON.stringify(tileHits));
    check("map: with nothing to show, Pune at zoom 13", (await A.page.locator('[data-map="live"] img.leaflet-tile').first().getAttribute("src"))?.includes("/13/"));
    await ctx.unroute("https://tile.openstreetmap.org/**"); await ctx.unroute("https://*.basemaps.cartocdn.com/**");

    // MCCIA's offices as quick picks.
    await go(S.page, "/cabs");
    check("the pickup box invites picking an office", (await S.page.getAttribute("input[name=pickup]", "placeholder")) === "Pickup location or select an office →");
    await S.page.locator("input[name=pickup]").click();
    check("tapping the empty pickup box: the six MCCIA offices, under \"MCCIA Offices\"", (await S.page.locator("[data-office]").count()) === 6 && (await S.page.getByText("MCCIA Offices").count()) === 1);
    await S.page.locator("input[name=dropoff]").focus();
    check("moving to the drop-off box: only its own list is open", (await S.page.locator('[role=listbox]').evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))).join() === "Drop-off: suggestions");
    await S.page.locator("input[name=pickup]").focus();
    await S.page.locator("input[name=pickup]").pressSequentially("mccia bhos");
    check("typing \"mccia bhos\" narrows them to Bhosari", JSON.stringify(await S.page.locator("[data-office]").evaluateAll((els) => els.map((e) => e.getAttribute("data-office")))) === '["MCCIA Bhosari Office"]');
    await S.page.locator('[data-office="MCCIA Bhosari Office"] button').click();
    check("choosing an office fills its name and address, with its position, and closes the list",
      (await S.page.inputValue("input[name=pickup]")).startsWith("MCCIA Bhosari Office, J-462, Telco Rd") && (await S.page.locator('[data-located="pickup"]').count()) === 1 && (await S.page.locator("[data-office]").count()) === 0);
    await S.page.locator("input[name=dropoff]").fill("Pune airport");
    check("typing something else shows no offices", (await S.page.locator("[data-office]").count()) === 0);
    await S.page.locator("input[name=dropoff]").fill("");
    await S.page.locator("input[name=dropoff]").press("ArrowDown"); await S.page.locator("input[name=dropoff]").press("ArrowDown"); await S.page.locator("input[name=dropoff]").press("Enter");
    check("the arrow keys and Enter pick an office too (the second: Hadapsar)", (await S.page.inputValue("input[name=dropoff]")).startsWith("MCCIA Hadapsar Office") && new URL(S.page.url()).pathname === "/cabs");

    // Address search without Geoapify: Nominatim, only on Enter, kept to the Pune area (answered here by a stand-in).
    const sctx = S.page.context();
    const asked = [];
    await sctx.route("https://nominatim.openstreetmap.org/search**", (rt) => { asked.push(rt.request().url()); return rt.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ display_name: "ZZC Shaniwar Wada, Pune", lat: "18.5195", lon: "73.8553" }]) }); });
    await go(S.page, "/cabs");
    await S.page.fill("input[name=pickup]", "Shaniwar Wada");
    await S.page.waitForTimeout(800);
    check("address search: nothing is sent to Nominatim while typing", asked.length === 0);
    await S.page.locator("input[name=pickup]").press("Enter");
    await S.page.getByRole("option", { name: /ZZC Shaniwar Wada/ }).click();
    const q = asked[0] ? new URL(asked[0]).searchParams : null;
    check("…Enter searches Nominatim in India, bounded to the Pune area, and does not send the booking form", asked.length === 1 && q?.get("q") === "Shaniwar Wada" && q.get("countrycodes") === "in"
      && q.get("viewbox") === "72.6,17.8,74.8,19.5" && q.get("bounded") === "1" && new URL(S.page.url()).pathname === "/cabs", asked.join(" "));
    check("…and choosing the result keeps its coordinates", (await S.page.inputValue("input[name=pickup]")) === "ZZC Shaniwar Wada, Pune" && (await S.page.locator('[data-located="pickup"]').count()) === 1);
    await sctx.unroute("https://nominatim.openstreetmap.org/search**");

    // GPS failures, each with its own message.
    const gps = async (code) => {
      const c = await browser.newContext({ viewport: { width: 400, height: 900 } });
      await c.addCookies(await sctx.cookies());
      await c.addInitScript((k) => { Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition: (_ok, err) => setTimeout(() => err({ code: k, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }), 50), watchPosition: () => 1, clearWatch: () => {} } }); }, code);
      const pg = await c.newPage();
      await pg.goto(BASE + "/cabs"); await pg.getByRole("button", { name: "Use my location" }).click();
      const msg = await pg.locator('[role="status"]').first().innerText({ timeout: 10000 }).catch(() => "");
      await c.close();
      return msg;
    };
    check("GPS refused: \"Please allow location access in your browser settings\"", (await gps(1)) === "Please allow location access in your browser settings");
    check("GPS unavailable: \"Unable to get your location. Please try again.\"", (await gps(2)) === "Unable to get your location. Please try again.");
    check("GPS timed out: \"Location request timed out. Please try again.\"", (await gps(3)) === "Location request timed out. Please try again.");
  }

  section("a driver without an email");
  {
    await go(A.page, "/cabs/admin/drivers");
    await A.page.getByRole("button", { name: "Add driver" }).click();
    await A.page.fill("[role=dialog] input[name=name]", "ZZC Phone Driver");
    await A.page.fill("[role=dialog] input[name=phone]", "98220 07777");
    await A.page.locator("[role=dialog]").getByRole("button", { name: "Add driver" }).click();
    const dr3 = await poll(async () => (await sql`select * from cab_drivers where name = 'ZZC Phone Driver'`)[0]);
    check("a driver with only a name and a phone: added, with no email", await toast(A.page, "added as a driver") && dr3?.email === null && dr3.phone === "9822007777", JSON.stringify(dr3));
    await go(A.page, "/cabs/admin/drivers");
    check("the Drivers list shows their name and phone", (await A.page.locator(`tr[data-driver="${dr3.id}"]`).innerText()).includes("9822007777"));
    const samePhone = await api(A.page, "/api/cabs/drivers", "POST", { name: "ZZC Twin", phone: "+9822007777".replace("+", "") });
    check("the same phone number twice is refused (409), naming who has it", samePhone.status === 409 && /ZZC Phone Driver already has the phone number/.test(samePhone.body?.error), JSON.stringify(samePhone));
    const r8 = (await api(S.page, "/api/cabs/rides", "POST", { pickup: "ZZC Phone Pickup", dropoff: "ZZC Phone Drop", scheduledFor: istSlot(5, 11) })).body;
    check("a ride can be assigned to them", (await api(A.page, `/api/cabs/rides/${r8.id}/assign`, "POST", { driverId: dr3.id, vehicleId: v1.id })).status === 200);
    check("a staffer cannot start a ride (403), with or without ?as=admin", (await api(S.page, `/api/cabs/rides/${r8.id}/start`, "POST")).status === 403
      && (await api(S.page, `/api/cabs/rides/${r8.id}/start?as=admin`, "POST")).status === 403);
    check("nor can a Cabs admin: only the driver starts a ride (403), and it stays assigned", (await api(A.page, `/api/cabs/rides/${r8.id}/start`, "POST")).status === 403
      && (await api(A.page, `/api/cabs/rides/${r8.id}/start?as=admin`, "POST")).status === 403 && (await ride(r8.id)).status === "assigned");
    await go(A.page, "/cabs/admin/trips");
    const actions8 = (await A.page.locator(`tr[data-ride="${r8.id}"] button`).allInnerTexts()).map((t) => t.trim());
    check("All Rides: an assigned ride offers New OTP and Cancel, no Start or Complete", actions8.includes("New OTP") && actions8.includes("Cancel") && !actions8.some((t) => /^(Start|Complete)/.test(t)), actions8.join("|"));
    check("the admin can still cancel it, with a reason", (await api(A.page, `/api/cabs/rides/${r8.id}/cancel?as=admin`, "POST", { reason: "ZZC driver has no app yet" })).status === 200 && (await ride(r8.id)).status === "cancelled");
    if (process.env.E2E_SMTP_LOG) {
      const all = (await import("node:fs")).readFileSync(process.env.E2E_SMTP_LOG, "utf8");
      check("no email is attempted for a driver without one", !all.split("\n").filter(Boolean).map((l) => JSON.parse(l)).some((m) => m.subject === "New ride assigned to you" && !m.to.some((t) => t.startsWith("zzc-"))));
    }

    section("drivers signing in by phone");
    // A phone with no hub sign-in at all, as a driver's would be.
    const P = await (async () => {
      const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, geolocation: { latitude: 18.53, longitude: 73.85, accuracy: 10 }, permissions: ["geolocation"] });
      ctx.setDefaultTimeout(45000);
      await ctx.addInitScript(() => { try { localStorage.setItem("mccia-install-popup-seen", "1"); localStorage.setItem("mccia-install-snoozed-until", String(Date.now() + 864e5)); } catch {} });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => pageErrors.push(`${new URL(page.url()).pathname}: ${String(e).slice(0, 120)}`));
      return { ctx, page };
    })();
    const login = (page, phone, otp) => api(page, "/api/cabs/driver-login", "POST", { phone, otp });
    const gated = (page, url, method = "GET") => page.evaluate(async ([u, m]) => (await fetch(u, { method: m, redirect: "manual" })).type === "opaqueredirect", [url, method]);
    await go(P.page, "/cabs/driver");
    check("no sign-in: Cabs Driver goes to the driver sign-in, not the hub's", new URL(P.page.url()).pathname === "/cabs/driver-login");
    const loginText = await P.page.locator("main").innerText();
    check("the sign-in page, step 1: MCCIA logo, \"Driver Login\", Name and Phone, Request Login, no OTP box yet, 400px at most",
      await P.page.locator('main img[alt="MCCIA"]').isVisible() && /Driver Login/.test(loginText) && /Contact your admin if you need an OTP/.test(loginText)
      && await P.page.locator("input[name=name]").isVisible() && (await P.page.locator("input[name=phone]").getAttribute("type")) === "tel"
      && await P.page.getByRole("button", { name: "Request Login" }).isDisabled() && (await P.page.locator("input[name=otp]").count()) === 0
      && (await P.page.locator("main").evaluate((m) => m.getBoundingClientRect().width)) <= 400);
    await P.page.fill("input[name=name]", "Nobody");
    await P.page.fill("input[name=phone]", "90000 00001");
    await P.page.getByRole("button", { name: "Request Login" }).click();
    await P.page.locator("[data-login-error]").waitFor();
    check("step 1, a phone that is not a driver's: \"Phone not found. Ask your admin to add you as a driver first.\", and no OTP box",
      (await P.page.locator("[data-login-error]").innerText()) === "Phone not found. Ask your admin to add you as a driver first." && (await P.page.locator("input[name=otp]").count()) === 0);
    const asked = () => notices(admin).then((ns) => ns.filter((n) => n.title === "Driver ZZC Phone Driver is requesting a login OTP." && n.body.startsWith("Go to Cabs Admin → Drivers to generate one.")).length);
    await P.page.fill("input[name=name]", "Phone Driver");
    await P.page.fill("input[name=phone]", "+91 98220 07777");
    await P.page.getByRole("button", { name: "Request Login" }).click();
    await P.page.locator("[data-otp-requested]").waitFor();
    check("step 1, a driver's phone: \"Your admin has been notified. Ask them for your 6-digit OTP.\", then the OTP box and Login",
      (await P.page.locator("[data-otp-requested]").innerText()).includes("Your admin has been notified. Ask them for your 6-digit OTP.")
      && (await P.page.locator("input[name=otp]").getAttribute("inputmode")) === "numeric" && /Enter the OTP your admin gave you/.test(await P.page.locator("main").innerText())
      && await P.page.getByRole("button", { name: "Login" }).isDisabled());
    check("…the Cabs admins get a bell notice \"Driver ZZC Phone Driver is requesting a login OTP.\" (the name they gave the driver)", (await poll(asked)) === 1);
    check("asking again soon tells them only once; a staffer is not told", (await api(P.page, "/api/cabs/driver-access", "POST", { name: "Phone Driver", phone: "9822007777" })).status === 200
      && (await asked()) === 1 && !(await notices(staffer)).some((n) => n.title.includes("requesting login OTP")));
    await go(A.page, "/cabs/admin/drivers");
    check("sidebar: an amber dot on Drivers; the driver's row says \"Login requested\"", (await A.page.locator("[data-login-dot]").count()) === 1
      && /Login requested (just now|\d+ min ago)/.test(await A.page.locator(`tr[data-driver="${dr3.id}"] [data-login-requested]`).innerText().catch(() => "")));
    check("a request without a name is refused (400)", (await api(P.page, "/api/cabs/driver-access", "POST", { name: " ", phone: "9822007777" })).status === 400);
    await P.page.locator("[data-back]").click();
    check("← Back returns to step 1, with the name and phone editable", await P.page.getByRole("button", { name: "Request Login" }).isVisible()
      && await P.page.locator("input[name=phone]").isEditable() && (await P.page.locator("input[name=otp]").count()) === 0);
    check("no sign-in: the rest stays behind the hub's sign-in (Cabs Admin, MCCIA Cabs, admin routes)", await (async () => { await go(P.page, "/cabs/admin"); return new URL(P.page.url()).pathname === "/login"; })()
      && await (async () => { await go(P.page, "/cabs"); return new URL(P.page.url()).pathname === "/login"; })()
      && await gated(P.page, "/api/cabs/drivers") && await gated(P.page, `/api/cabs/drivers/${dr3.id}/otp`, "POST") && await gated(P.page, `/api/cabs/rides/${r8.id}/assign`, "POST"));
    check("no sign-in: who-am-I is 401, and so is a driver route", (await api(P.page, "/api/cabs/driver-me", "GET")).status === 401 && (await api(P.page, "/api/cabs/location", "POST", { latitude: 18.5, longitude: 73.8 })).status === 401);

    await go(A.page, "/cabs/admin/drivers");
    await A.page.locator(`tr[data-driver="${dr3.id}"] [data-get-otp]`).click();
    await A.page.locator("[data-login-otp]").waitFor();
    const shown1 = (await A.page.locator("[data-otp-digits]").innerText()).trim();
    const dialog = await A.page.locator("[data-login-otp]").innerText();
    check("Get Login OTP: \"Share with ZZC Phone Driver\", 6 digits, \"Valid for 24 hours (until … tomorrow)\", a Copy button", /^\d{6}$/.test(shown1) && /Share with\s+ZZC Phone Driver/.test(dialog)
      && /Valid for 24 hours \(until \d{1,2}:\d{2} [AP]M tomorrow\)/.test(dialog) && await A.page.locator("[data-login-otp]").getByRole("button", { name: "Copy" }).isVisible(), dialog);
    const row1 = (await sql`select * from cab_driver_otps where driver_id = ${dr3.id}`)[0];
    check("…only a hash of it is stored (never the digits), expiring in 24 hours, made by the admin", row1 && row1.otp_hash.length === 64 && !row1.otp_hash.includes(shown1)
      && Math.abs(new Date(row1.expires_at).getTime() - Date.now() - 24 * 3600_000) < 120_000 && row1.created_by_id === admin.id, JSON.stringify(row1));
    await A.page.locator("[data-login-otp]").getByRole("button", { name: "New OTP" }).click();
    const shown2 = await poll(async () => { const t = (await A.page.locator("[data-otp-digits]").innerText()).trim(); return t !== shown1 ? t : null; });
    check("New OTP: different digits, and the first one is gone (one unused code per driver)", /^\d{6}$/.test(shown2 ?? "") && (await sql`select count(*)::int n from cab_driver_otps where driver_id = ${dr3.id} and used_at is null`)[0].n === 1);
    await A.page.locator("[data-login-otp]").getByRole("button", { name: "Done" }).click();
    await go(A.page, "/cabs/admin/drivers");
    check("once the admin has made the OTP, the dot and the label go", (await A.page.locator("[data-login-dot]").count()) === 0
      && (await A.page.locator(`tr[data-driver="${dr3.id}"] [data-login-requested]`).count()) === 0 && (await sql`select login_requested_at from cab_drivers where id = ${dr3.id}`)[0].login_requested_at === null);
    check("only Cabs admins make login OTPs (403 for a staffer and for a hub driver)", (await api(S.page, `/api/cabs/drivers/${dr3.id}/otp`, "POST")).status === 403
      && (await api(D2.page, `/api/cabs/drivers/${dr3.id}/otp`, "POST")).status === 403);
    check("the old code no longer works (401)", shown1 === shown2 || (await login(P.page, "9822007777", shown1)).status === 401);
    // The old code, tried just above, counted as a wrong try on the current one.
    const triesSoFar = (await sql`select attempts from cab_driver_otps where driver_id = ${dr3.id} and used_at is null`)[0].attempts;
    const wrong = shown2 === "000000" ? "111111" : "000000";
    const bad = await login(P.page, "9822007777", wrong);
    const unknown = await login(P.page, "9000000001", shown2);
    check("a wrong OTP: 401 \"Invalid OTP. Try again.\", and it counts a try; an unknown phone: 404 \"Phone not found…\"", bad.status === 401 && bad.body?.error === "Invalid OTP. Try again."
      && unknown.status === 404 && /^Phone not found/.test(unknown.body?.error) && (await sql`select attempts from cab_driver_otps where driver_id = ${dr3.id} and used_at is null`)[0].attempts === triesSoFar + 1);
    check("a malformed OTP is refused (400)", (await login(P.page, "9822007777", "12345")).status === 400);
    const crossSite = await fetch(BASE + "/api/cabs/driver-login", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example" }, body: JSON.stringify({ phone: "9822007777", otp: shown2 }) });
    check("a sign-in posted from another site is refused (403), and uses no try", crossSite.status === 403 && (await sql`select attempts from cab_driver_otps where driver_id = ${dr3.id} and used_at is null`)[0].attempts === triesSoFar + 1);

    await go(P.page, "/cabs/driver-login");
    await P.page.fill("input[name=name]", "Phone Driver");
    await P.page.fill("input[name=phone]", "+91 98220 07777");
    await P.page.getByRole("button", { name: "Request Login" }).click();
    await P.page.fill("input[name=otp]", shown2);
    await P.page.getByRole("button", { name: "Login" }).click();
    await P.page.waitForURL((u) => u.pathname === "/cabs/driver", { timeout: 30000 }).catch(() => {});
    check("the driver signs in on the page with +91 in front (matched on the last 10 digits) and lands on Assigned", new URL(P.page.url()).pathname === "/cabs/driver"
      && /Hi ZZC/i.test(await P.page.locator("main").innerText()));
    check("…with no way back to the hub (they have no hub account)", (await P.page.locator('header a[href="/"]').count()) === 0);
    const cookie = (await P.ctx.cookies()).find((c) => c.name === "cab_driver_session");
    const hoursLeft = cookie ? (cookie.expires * 1000 - Date.now()) / 3600_000 : 0;
    check("the session cookie: httpOnly, SameSite=Lax, 12 hours", !!cookie && cookie.httpOnly && cookie.sameSite === "Lax" && hoursLeft > 11.9 && hoursLeft <= 12.01, JSON.stringify({ ...cookie, value: "…" }));
    const sess = (await sql`select * from cab_driver_sessions where driver_id = ${dr3.id}`);
    check("…the database keeps only the SHA-256 of the cookie, expiring in 12 hours", sess.length === 1 && sess[0].token === createHash("sha256").update(cookie?.value ?? "").digest("hex")
      && sess[0].token !== cookie?.value && Math.abs(new Date(sess[0].expires_at).getTime() - Date.now() - 12 * 3600_000) < 120_000);
    check("the code is used up: the same code again is 401", (await sql`select used_at from cab_driver_otps where driver_id = ${dr3.id}`)[0].used_at !== null
      && await (async () => { const c = await browser.newContext(); const p = await c.newPage(); await p.goto(BASE + "/cabs/driver-login"); const r = await login(p, "9822007777", shown2); await c.close(); return r.status === 401; })());
    const me = await api(P.page, "/api/cabs/driver-me", "GET");
    check("who-am-I: the driver's name and phone", me.status === 200 && me.body?.driver?.name === "ZZC Phone Driver" && me.body.driver.phone === "9822007777");
    check("signing in is in the Cab audit log, and not in the hub's (no hub account)", (await sql`select 1 from cab_audit_log where action = 'driver_signed_in' and actor_id = ${dr3.id}`).length === 1
      && (await sql`select 1 from cab_audit_log where action = 'driver_login_otp' and actor_id = ${admin.id}`).length >= 2
      && (await sql`select 1 from access_audit where action = 'cabs.driver_signed_in'`).length === 0);
    check("a phone driver still cannot reach admin pages or routes", await (async () => { await go(P.page, "/cabs/admin"); return new URL(P.page.url()).pathname === "/login"; })()
      && await gated(P.page, "/api/cabs/drivers") && await gated(P.page, `/api/cabs/rides/${r8.id}/otp/reset`, "POST"));

    // A ride for them, done entirely in the driver app.
    const r9 = (await api(S.page, "/api/cabs/rides", "POST", { pickup: "ZZC Phone Pickup 2", dropoff: "ZZC Phone Drop 2", scheduledFor: istSlot(6, 15) })).body;
    check("a ride is assigned to the phone driver, with a car chosen for this ride", (await api(A.page, `/api/cabs/rides/${r9.id}/assign`, "POST", { driverId: dr3.id, vehicleId: v1.id })).status === 200);
    const code9 = (await sql`select otp from cab_ride_otps where ride_id = ${r9.id}`)[0].otp;
    check("the phone driver cannot act on another driver's ride", (await api(P.page, `/api/cabs/rides/${r3.id}/otp/verify`, "POST", { otp: "0000" })).status === 404
      && (await api(P.page, `/api/cabs/rides/${r3.id}/start`, "POST")).status >= 400);
    await go(P.page, "/cabs/driver");
    await P.page.locator(`[data-ride="${r9.id}"] input[name=otp]`).fill(code9);
    await P.page.locator(`[data-ride="${r9.id}"]`).getByRole("button", { name: "Confirm pickup" }).click();
    check("the phone driver enters the rider's OTP: the ride is under way", await toast(P.page, "Pickup confirmed") && !!(await poll(async () => (await ride(r9.id)).status === "in_progress")));
    check("…their phone shares its position", !!(await poll(async () => (await sql`select 1 from cab_driver_locations where driver_id = ${dr3.id}`).length > 0, 30000)));
    await go(P.page, "/cabs/driver/profile");
    check("Profile: the car of the current ride, and Sign out in place of the hub's", (await P.page.locator("[data-current-vehicle]").innerText()).includes("ZZC 01 AA 1111")
      && await P.page.locator("[data-driver-sign-out]").isVisible() && (await P.page.getByText("Back to the App Hub").count()) === 0);
    await go(A.page, "/cabs/admin/trips");
    check("All Rides: a ride under way has no Complete for the admin; completing it through the API is 403",
      !(await A.page.locator(`tr[data-ride="${r9.id}"] button`).allInnerTexts()).some((t) => /Complete/.test(t))
      && (await api(A.page, `/api/cabs/rides/${r9.id}/complete`, "POST")).status === 403 && (await api(A.page, `/api/cabs/rides/${r9.id}/complete?as=admin`, "POST")).status === 403
      && (await ride(r9.id)).status === "in_progress");
    const doneBefore = (await notices(staffer)).filter((n) => n.title === "Your ride is complete").length;
    check("the phone driver completes the ride; the rider is told \"Your ride is complete\"", (await api(P.page, `/api/cabs/rides/${r9.id}/complete`, "POST")).status === 200 && (await ride(r9.id)).status === "completed"
      && (await sql`select 1 from cab_audit_log where ride_id = ${r9.id} and action = 'ride_completed' and actor_id = ${dr3.id}`).length === 1
      && !!(await poll(async () => (await notices(staffer)).filter((n) => n.title === "Your ride is complete").length === doneBefore + 1)));
    await go(P.page, "/cabs/driver/profile");
    check("…and with no ride on, Profile says so", (await P.page.locator("[data-current-vehicle]").innerText()).includes("No ride right now"));
    check("the phone driver goes offline and online again", (await api(P.page, "/api/cabs/driver/availability", "POST", { available: false })).status === 200
      && (await sql`select is_available from cab_drivers where id = ${dr3.id}`)[0].is_available === false
      && (await api(P.page, "/api/cabs/driver/availability", "POST", { available: true })).status === 200);

    await sql`update cab_driver_sessions set expires_at = now() - interval '1 second' where driver_id = ${dr3.id}`;
    await go(P.page, "/cabs/driver");
    check("after 12 hours the session has ended: back to the driver sign-in", new URL(P.page.url()).pathname === "/cabs/driver-login");
    if (process.env.CRON_SECRET) {
      const cron = await P.page.evaluate(async (s) => { const r = await fetch("/api/cron/cleanup-uploads", { headers: { Authorization: `Bearer ${s}` } }); return { status: r.status, body: await r.json().catch(() => null) }; }, process.env.CRON_SECRET);
      check("the daily cron deletes expired sessions and old codes", cron.body?.driverLogins?.sessions >= 1 && (await sql`select 1 from cab_driver_sessions where driver_id = ${dr3.id}`).length === 0, JSON.stringify(cron));
    }

    // The lock: five wrong tries.
    const fresh = (await api(A.page, `/api/cabs/drivers/${dr3.id}/otp`, "POST")).body;
    check("the OTP route answers the digits and the expiry, uncached", /^\d{6}$/.test(fresh?.otp) && !!fresh.expires_at);
    const wrong2 = fresh.otp === "000000" ? "111111" : "000000";
    const five = [];
    for (let i = 0; i < 5; i++) five.push((await login(P.page, "9822007777", wrong2)).status);
    const afterLock = await login(P.page, "9822007777", fresh.otp);
    check("tries 1–4 are 401, the 5th is 429, and then even the right code is 429", five.join(",") === "401,401,401,401,429" && afterLock.status === 429
      && afterLock.body?.error === "OTP locked. Ask your admin for a new OTP.", five.join(",") + " " + JSON.stringify(afterLock));

    // Signing out; and removing a driver ends their sign-in.
    const again = (await api(A.page, `/api/cabs/drivers/${dr3.id}/otp`, "POST")).body;
    check("a new code from the admin unlocks them", (await login(P.page, "9822007777", again.otp)).status === 200);
    await go(P.page, "/cabs/driver/profile");
    await P.page.locator("[data-driver-sign-out]").click();
    await P.page.waitForURL((u) => u.pathname === "/cabs/driver-login").catch(() => {});
    check("Sign out: back to the driver sign-in, the session is deleted, who-am-I is 401", new URL(P.page.url()).pathname === "/cabs/driver-login"
      && (await sql`select 1 from cab_driver_sessions where driver_id = ${dr3.id}`).length === 0 && (await api(P.page, "/api/cabs/driver-me", "GET")).status === 401
      && !(await P.ctx.cookies()).some((c) => c.name === "cab_driver_session" && c.value));
    const last = (await api(A.page, `/api/cabs/drivers/${dr3.id}/otp`, "POST")).body;
    await login(P.page, "9822007777", last.otp);
    check("removing the driver ends their sign-in at once", (await api(A.page, `/api/cabs/drivers/${dr3.id}`, "DELETE")).status === 200
      && await (async () => { await go(P.page, "/cabs/driver"); return new URL(P.page.url()).pathname === "/cabs/driver-login"; })()
      && (await sql`select count(*)::int n from cab_driver_otps where driver_id = ${dr3.id}`)[0].n === 0);
    await P.ctx.close();
  }

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
  await go(A.page, "/cabs/admin/trips");
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

  // Conflicts: the third ride (day 3, 9:00) now has the second driver and vehicle 2.
  const rC = (await api(S.page, "/api/cabs/rides", "POST", { pickup: "ZZC Clash Office", dropoff: "ZZC Clash Station", scheduledFor: istSlot(3, 10) })).body;
  const busyDriver = await api(A.page, `/api/cabs/rides/${rC.id}/assign`, "POST", { driverId: dr2.id, vehicleId: v1.id });
  check("a driver with a ride within 2 hours is refused: \"Driver already has a ride at this time\"", busyDriver.status === 409 && busyDriver.body?.error === "Driver already has a ride at this time", JSON.stringify(busyDriver));
  const busyCar = await api(A.page, `/api/cabs/rides/${rC.id}/assign`, "POST", { driverId: dr1.id, vehicleId: v2.id });
  check("a vehicle with a ride within 2 hours is refused: \"Vehicle already assigned at this time\"", busyCar.status === 409 && busyCar.body?.error === "Vehicle already assigned at this time", JSON.stringify(busyCar));
  const clash = await api(A.page, `/api/cabs/rides/${rC.id}/conflicts`, "GET");
  check("the conflicts for that ride: the busy driver and vehicle", clash.status === 200 && clash.body.drivers.includes(dr2.id) && clash.body.vehicles.includes(v2.id) && !clash.body.drivers.includes(dr1.id), JSON.stringify(clash.body));
  await go(A.page, "/cabs/admin/trips?status=pending");
  await A.page.locator(`tr[data-ride="${rC.id}"]`).getByRole("button", { name: "Assign" }).click();
  await A.page.locator("[role=dialog] [data-busy-note]").waitFor({ timeout: 10000 }).catch(() => {});
  const optDisabled = (sel) => A.page.$eval(sel, (o) => o.disabled && o.textContent.trim()).catch(() => "");
  check("the assign dialog marks and disables the busy driver (\"Busy at this time\") and vehicle (\"In use at this time\")",
    (await optDisabled(`[role=dialog] select[name=driverId] option[value="${dr2.id}"]`)).endsWith("Busy at this time")
    && (await optDisabled(`[role=dialog] select[name=vehicleId] option[value="${v2.id}"]`)).includes("In use at this time")
    && !(await optDisabled(`[role=dialog] select[name=driverId] option[value="${dr1.id}"]`)));
  await A.page.locator("[role=dialog]").getByRole("button", { name: "Close" }).first().click();
  const rLater = (await api(S.page, "/api/cabs/rides", "POST", { pickup: "ZZC Later Office", dropoff: "ZZC Later Station", scheduledFor: istSlot(3, 13) })).body;
  check("4 hours later the same driver and vehicle are free", (await api(A.page, `/api/cabs/rides/${rLater.id}/assign`, "POST", { driverId: dr2.id, vehicleId: v2.id })).status === 200);

  // Admin "view as driver": the second driver's app, read-only.
  await go(A.page, "/cabs/driver");
  check("an admin sees \"Admin view — select a driver to preview\" on the driver app", /admin view — select a driver to preview/i.test(await A.page.locator("[data-driver-picker]").innerText()));
  await A.page.locator("select[name=viewAsDriver]").selectOption(dr2.id);
  await A.page.waitForURL((u) => u.searchParams.get("driver") === dr2.id);
  await A.page.locator(`[data-ride="${r3.id}"]`).waitFor({ timeout: 15000 }).catch(() => {});
  check("…choosing a driver shows their assigned rides, with no OTP box (preview only)", await A.page.locator(`[data-ride="${r3.id}"]`).isVisible()
    && (await A.page.locator(`[data-ride="${r3.id}"] input[name=otp]`).count()) === 0 && (await A.page.locator(`[data-ride="${r3.id}"] [data-preview-note]`).count()) === 1);
  await A.page.locator('nav[aria-label="Cabs Driver"] a', { hasText: "Profile" }).click();
  await A.page.waitForURL((u) => u.pathname === "/cabs/driver/profile");
  check("…and stays on that driver from tab to tab", new URL(A.page.url()).searchParams.get("driver") === dr2.id && (await A.page.locator("[data-profile]").innerText()).includes("ZZC Second Driver"));
  await go(D2.page, "/cabs/driver");
  check("a driver sees only their own rides, with no picker", (await D2.page.locator("[data-driver-picker]").count()) === 0 && await D2.page.locator(`[data-ride="${r3.id}"] input[name=otp]`).isVisible());
  check("a driver cannot look at another driver's app with ?driver=", await (async () => { await go(D2.page, `/cabs/driver?driver=${dr1.id}`); return (await D2.page.locator(`[data-ride="${r3.id}"]`).count()) === 1; })());
  await api(S.page, `/api/cabs/rides/${rC.id}/cancel`, "POST", {});
  await api(A.page, `/api/cabs/rides/${rLater.id}/cancel?as=admin`, "POST", { reason: "ZZC test over" });
  check("a driver with an assigned ride cannot be removed (409)", (await api(A.page, `/api/cabs/drivers/${dr2.id}`, "DELETE")).status === 409);
  check("a vehicle on an assigned ride cannot be deactivated (409)", (await api(A.page, `/api/cabs/vehicles/${v2.id}`, "DELETE")).status === 409);
  check("a driver with nothing on can be removed; their completed ride keeps their name", (await api(A.page, `/api/cabs/drivers/${dr1.id}`, "DELETE")).status === 200
    && (await ride(r1.id)).driver_name === "ZZC Driver" && (await ride(r1.id)).driver_id === null);
  await go(D.page, "/cabs/driver"); check("a removed driver can no longer open Cabs Driver", new URL(D.page.url()).pathname === "/");

  section("dashboards and the audit log");
  await go(A.page, "/cabs/admin");
  const statTiles = await A.page.locator("[data-stat]").evaluateAll((els) => els.map((e) => e.getAttribute("data-stat")));
  const [{ pending: pendingNow }] = await sql`select count(*)::int as pending from cab_rides where status = 'pending'`;
  check("admin dashboard: Pending rides, Active trips, Today's completed, Available drivers; View Pending (N) and View Live Trips",
    statTiles.join("|") === "Pending rides|Active trips|Today's completed|Available drivers" && Number(await A.page.locator('[data-stat="Pending rides"] span').last().innerText()) === pendingNow
    && (await A.page.locator('[data-quick="pending"]').innerText()).includes(`View Pending (${pendingNow})`) && (await A.page.locator('[data-quick="pending"]').getAttribute("href")) === "/cabs/admin/pending"
    && (await A.page.locator('[data-quick="live"]').getAttribute("href")) === "/cabs/admin/live", statTiles.join("|"));
  await go(S.page, "/cabs/rides");
  check("My rides lists the upcoming (assigned) ride and the past ones", await S.page.locator(`[data-ride="${r3.id}"]`).first().isVisible() && await S.page.locator(`[data-ride="${r4.id}"]`).first().isVisible());
  await go(S.page, "/cabs/account");
  const account = await S.page.locator("[data-account]").innerText();
  check("Account: name, email, branch, rides this month", account.includes("ZZC Staffer") && account.includes("zzc-staffer@gmail.com") && account.includes("ZZC Branch")
    && Number(await S.page.locator("[data-rides-this-month]").innerText()) >= 6);
  const actions = (await sql`select action from cab_audit_log where actor_id in (${staffer.id}, ${admin.id}, ${driver.id}) order by created_at`).map((r) => r.action);
  check("the audit log recorded every kind of action", ["vehicle_added", "vehicle_updated", "vehicle_deactivated", "driver_added", "driver_availability", "driver_removed", "ride_created", "ride_assigned", "ride_started", "ride_completed", "ride_cancelled"].every((a) => actions.includes(a)), actions.join(","));
  check("driver and vehicle changes also went to the hub's audit log", (await sql`select count(*)::int n from access_audit where action like 'cabs.%' and target_label like 'ZZC%'`)[0].n >= 5);
  await go(A.page, "/cabs/admin/audit?action=ride_cancelled");
  check("audit page: filtered to cancellations", (await A.page.locator("tbody tr").count()) >= 2 && (await A.page.locator("tbody").innerText()).includes("ZZC Office → ZZC Station"));
  await go(A.page, `/cabs/admin/audit?actor=${admin.id}`);
  const whos = (await A.page.locator("tbody tr td:nth-child(2)").allInnerTexts()).map((t) => t.trim());
  check("audit: filtered by who did it", whos.length > 0 && whos.every((w) => w === "ZZC Admin") && (await A.page.locator(`select[name=actor] option[value="${admin.id}"]`).count()) === 1, whos.slice(0, 5).join(","));
  await go(A.page, `/cabs/admin/audit?ride=${r1.id.slice(0, 8)}`);
  const rideCells = (await A.page.locator("tbody tr td:nth-child(5)").allInnerTexts()).map((t) => t.trim());
  const r1Log = await A.page.locator("tbody").innerText();
  check("audit: filtered by ride (its short id): that ride's every step, OTP verified among them", rideCells.length >= 5 && rideCells.every((c) => c === r1.id.slice(0, 8))
    && ["Ride booked", "Ride assigned", "New OTP made", "OTP verified", "Ride started", "Ride completed"].every((a) => r1Log.toLowerCase().includes(a.toLowerCase())), r1Log.slice(0, 300));
  const rcsv = await A.page.evaluate(async (id) => (await fetch(`/api/cabs/audit/export?ride=${id}`)).text(), r1.id);
  check("audit CSV: the ride filter applies to the export too", rcsv.trim().split("\n").length === rideCells.length + 1 && rcsv.trim().split("\n").slice(1).every((l) => l.includes(r1.id)));
  await go(A.page, "/cabs/admin/audit?ride=not-a-ride");
  check("audit: a ride id that matches nothing shows nothing", (await A.page.locator("tbody").innerText()).includes("No entries match."));
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
