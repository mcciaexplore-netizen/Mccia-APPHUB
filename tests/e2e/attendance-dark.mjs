/**
 * End-to-end check of Attendance's dark mode (pure black), in a real browser against a running app: every staff, manager and admin page, on
 * a laptop and a phone, with data in the lists, tables, calendar and approval cards; also a row hovered, a field focused, a button hovered,
 * the dialogs (Reject with a remark, Edit person, Adjust balance, Add shift), an error toast and the header's user menu. Each must have NO
 * light surface left: no light background (plain or gradient, any colour format), no light border, and no dark text on a dark background.
 * Two light things are meant to be: the white knob of the Dark mode switch and the grey dot of a day with no status.
 *
 * Writes test people (zzd-*), two test applications and some requests, and removes them at the end. Run it against a TEST database with
 * ATT_ENABLED=true:
 *   E2E_ATT_DARK_CONFIRM=yes E2E_BASE_URL=http://localhost:3000 node tests/e2e/attendance-dark.mjs
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
if (!BASE) { console.error("Set E2E_BASE_URL, for example: E2E_BASE_URL=http://localhost:3000 node tests/e2e/attendance-dark.mjs"); process.exit(2); }
if (process.env.E2E_ATT_DARK_CONFIRM !== "yes") { console.error("This test writes people and requests. Run it against a test database, then set E2E_ATT_DARK_CONFIRM=yes."); process.exit(2); }

const q = (() => {
  if ((process.env.DB_DRIVER ?? "neon") !== "pg") { const n = req("@neondatabase/serverless").neon(process.env.DATABASE_URL); return (t, v = []) => n.query(t, v); }
  const pool = new (req("pg").Pool)({ connectionString: process.env.DATABASE_URL, max: 4, ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false });
  const f = (t, v = []) => pool.query(t, v).then((r) => r.rows);
  f.end = () => pool.end();
  return f;
})();
const playwright = req("playwright-core");
const launch = () => playwright.chromium.launch({ channel: process.env.E2E_CHROME_CHANNEL || "chrome", headless: true }).catch(() => playwright.chromium.launch({ headless: true }));
const PW = "zzd-Dark-pass-1";
const hash = (pw) => { const s = randomBytes(16); return `scrypt$16384$${s.toString("base64")}$${scryptSync(pw, s, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("base64")}`; };
const results = [];
const check = (name, ok, extra = "") => { results.push([name, !!ok]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && extra !== "" ? "  -> " + String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 1500) : ""}`); };
const section = (t) => console.log(`\n== ${t} ==`);

async function tidy() {
  const ids = (await q("select id from users where email like 'zzd-%'")).map((r) => r.id);
  if (ids.length) {
    for (const t of ["att_attendance", "att_leave_requests", "att_leave_balances", "att_leave_adjustments", "att_wfh_requests", "att_regularization_requests", "att_compoff_requests", "att_time_logs", "att_timesheets", "att_user_profiles", "hub_notifications"]) await q(`delete from ${t} where user_id = any($1)`, [ids]).catch(() => {});
    await q("delete from access_audit where actor_id = any($1)", [ids]).catch(() => {});
    await q("delete from activity_log where user_id = any($1)", [ids]).catch(() => {});
    await q("delete from login_attempts where email like 'zzd-%'").catch(() => {});
  }
  await q("delete from users where email like 'zzd-%'");
  await q("delete from apps where name like 'ZZD%'");
  await q("delete from departments where name like 'ZZD%'");
}

/** Runs in the page: every visible element still light in dark mode. */
const AUDIT = () => {
  // Any CSS colour (rgb, oklab, color-mix …) → r, g, b, a: painted onto a 1×1 canvas and read back.
  const cv = document.createElement("canvas"); cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const memo = new Map();
  const rgba = (s) => {
    if (!s || s === "none") return null;
    if (memo.has(s)) return memo.get(s);
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = "rgba(0,0,0,0)"; cx.fillStyle = s; cx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = cx.getImageData(0, 0, 1, 1).data;
    const v = { r, g, b, a: a / 255 }; memo.set(s, v); return v;
  };
  const colorsIn = (s) => s.match(/(rgba?|oklab|oklch|color|lab|lch|hsla?)\((?:[^()]|\([^()]*\))*\)|#[0-9a-f]{3,8}\b/gi) ?? [];
  const light = (c) => c && c.a > 0.25 && Math.min(c.r, c.g, c.b) >= 150;
  const dark = (c) => c && c.a > 0.5 && Math.max(c.r, c.g, c.b) <= 110;
  const MEANT = [".att-switch-knob", ".att-dot", 'img[alt="MCCIA"]'];
  const name = (el) => `${el.tagName.toLowerCase()}${typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).slice(0, 5).join(".") : ""}`;
  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    if (["SCRIPT", "STYLE", "NOSCRIPT", "IMG"].includes(el.tagName) || el.closest("svg") || MEANT.some((m) => el.matches(m))) continue;
    const box = el.getBoundingClientRect();
    if (box.width < 4 || box.height < 4) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
    const issues = [];
    if (light(rgba(cs.backgroundColor))) issues.push(`background ${cs.backgroundColor}`);
    if (colorsIn(cs.backgroundImage).some((c) => light(rgba(c)))) issues.push(`gradient ${cs.backgroundImage.slice(0, 80)}`);
    for (const side of ["Top", "Bottom", "Left", "Right"]) {
      if (parseFloat(cs[`border${side}Width`]) > 0 && cs[`border${side}Style`] !== "none" && light(rgba(cs[`border${side}Color`]))) { issues.push(`border ${cs[`border${side}Color`]}`); break; }
    }
    if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && dark(rgba(cs.color))) {
      let p = el, behind = null; // dark text is fine on a light chip; flag it only on a dark background
      while (p && p !== document.documentElement) { const c = rgba(getComputedStyle(p).backgroundColor); if (c && c.a > 0.5) { behind = c; break; } p = p.parentElement; }
      if (!behind || Math.max(behind.r, behind.g, behind.b) < 100) issues.push(`dark text ${cs.color}`);
    }
    if (issues.length) out.push(`${name(el)} "${(el.innerText || el.value || el.placeholder || "").trim().replace(/\s+/g, " ").slice(0, 30)}": ${issues.join("; ")}`);
  }
  return out;
};

let failed = null;
let browser;
await tidy();
try {
  const [d] = await q("insert into departments (name, icon) values ('ZZD Dark', 'clock') returning id");
  const [ua] = await q("insert into apps (department_id, name, url, icon) values ($1, 'ZZD Attendance', '/attendance', 'clock') returning id", [d.id]);
  const [aa] = await q("insert into apps (department_id, name, url, icon) values ($1, 'ZZD Attendance Admin', '/attendance/admin', 'clock') returning id", [d.id]);
  const mk = async (n, mgr = null) => (await q("insert into users (name, email, password_hash, reporting_manager_id) values ($1, $2, $3, $4) returning id, email", [`ZZD ${n}`, `zzd-${n.toLowerCase()}@mcciapune.com`, hash(PW), mgr]))[0];
  const mgr = await mk("Manju");
  const staff = await mk("Asha", mgr.id);
  const hr = await mk("Hema");
  for (const u of [mgr, staff, hr]) await q("insert into user_app_access (user_id, app_id, app_role) values ($1, $2, 'user')", [u.id, ua.id]);
  await q("insert into app_admins (app_id, user_id) values ($1, $2)", [aa.id, hr.id]);
  // Data, so lists, tables, the calendar and approval cards are filled.
  const day = (n) => new Date(Date.now() + 330 * 60000 + n * 864e5).toISOString().slice(0, 10);
  for (const i of [1, 2, 3, 4, 5, 8]) {
    await q("insert into att_attendance (user_id, date, check_in_time, check_out_time, check_in_method, is_late, hours_worked) values ($1, $2::date, ($2::date + time '09:40') at time zone 'Asia/Kolkata', ($2::date + time '18:05') at time zone 'Asia/Kolkata', 'ip', $3, 8.4) on conflict do nothing", [staff.id, day(-i), i === 2]);
  }
  const [lt] = await q("select id from att_leave_types order by name limit 1");
  if (lt) {
    await q("insert into att_leave_requests (user_id, leave_type_id, start_date, end_date, days_count, reason, status, approver_id) values ($1, $2, $3, $3, 1, 'ZZD family function', 'pending', $4)", [staff.id, lt.id, day(5), mgr.id]);
    await q("insert into att_leave_requests (user_id, leave_type_id, start_date, end_date, days_count, reason, status, approver_id, decided_by, approved_at) values ($1, $2, $3, $3, 1, 'ZZD fever', 'approved', $4, $4, now())", [staff.id, lt.id, day(-9), mgr.id]);
  }
  await q("insert into att_wfh_requests (user_id, date, reason, status, approver_id) values ($1, $2, 'ZZD plumber', 'pending', $3)", [staff.id, day(3), mgr.id]);
  await q("insert into att_regularization_requests (user_id, date, missed, reason, status, approver_id) values ($1, $2, 'checkout', 'ZZD forgot', 'pending', $3)", [staff.id, day(-2), mgr.id]);

  browser = await launch();
  const session = async (email, viewport) => {
    const phone = viewport.width < 768;
    const ctx = await browser.newContext({ viewport, colorScheme: "dark", isMobile: phone, hasTouch: phone });
    ctx.setDefaultTimeout(60000);
    await ctx.addInitScript(() => { try { localStorage.setItem("att-theme", "dark"); localStorage.setItem("mccia-install-popup-seen", "1"); localStorage.setItem("mccia-install-snoozed-until", String(Date.now() + 864e5)); localStorage.setItem("att-install-dismissed", "1"); } catch { /* none */ } });
    const p = await ctx.newPage();
    await p.goto(BASE + "/login"); await p.fill("input[name=email]", email); await p.fill("input[name=password]", PW);
    await p.click("button[type=submit]"); await p.waitForURL((u) => u.pathname === "/", { timeout: 90000 });
    return { ctx, p };
  };
  const go = async (p, to) => { await p.goto(BASE + to); await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(300); };
  const clean = async (p, what) => { const left = await p.evaluate(AUDIT); check(`${what}: nothing light`, left.length === 0, left.slice(0, 8)); };
  const page = async (p, to, tag) => {
    await go(p, to);
    check(`${tag} ${to}: dark`, await p.evaluate(() => document.documentElement.classList.contains("att-dark")));
    await clean(p, `${tag} ${to}`);
    const states = [];
    const row = p.locator("main tbody tr:visible").first();
    if (await row.count()) { await row.hover().catch(() => {}); states.push(...(await p.evaluate(AUDIT))); }
    const field = p.locator("main :is(input, textarea, select):visible").first();
    if (await field.count()) { await field.focus().catch(() => {}); states.push(...(await p.evaluate(AUDIT))); }
    const btn = p.locator("main :is(.btn-ghost, .btn-danger):visible").first();
    if (await btn.count()) { await btn.hover().catch(() => {}); await p.waitForTimeout(250); states.push(...(await p.evaluate(AUDIT))); }
    if (states.length) check(`${tag} ${to} (hover and focus): nothing light`, false, [...new Set(states)].slice(0, 8));
  };
  const dialog = async (p, to, button, tag) => {
    await go(p, to);
    const b = p.getByRole("button", { name: button }).first();
    if (!(await b.count())) { check(`${tag} ${to}: has the ${button} button`, false); return; }
    await b.click();
    const open = await p.locator('[role="dialog"]').first().waitFor({ timeout: 10000 }).then(() => true, () => false);
    await p.waitForTimeout(400); // the opening animation
    check(`${tag} ${to}: the ${button} dialog opens`, open);
    await clean(p, `${tag} ${to}: the ${button} dialog`);
    await p.keyboard.press("Escape");
  };

  const STAFF = ["/attendance", "/attendance/time", "/attendance/leave", "/attendance/leave/apply", "/attendance/more", "/attendance/more/profile", "/attendance/more/summary", "/attendance/more/wfh", "/attendance/more/regularization", "/attendance/more/compoff", "/attendance/more/org-chart"];
  const ADMIN = ["/attendance/admin", "/attendance/admin/approvals", "/attendance/admin/approvals?tab=history", "/attendance/admin/people", "/attendance/admin/attendance", "/attendance/admin/leave", "/attendance/admin/time", "/attendance/admin/reports", "/attendance/admin/settings"];
  for (const vp of [{ width: 1366, height: 900 }, { width: 390, height: 844 }]) {
    const tag = vp.width < 768 ? "phone" : "laptop";
    section(`Staff (${tag})`);
    const s = await session(staff.email, vp);
    for (const to of STAFF) await page(s.p, to, tag);
    await go(s.p, "/attendance/leave/apply");
    await s.p.locator("main form button[type=submit]").first().click();
    const toast = await s.p.locator(".toast-in").first().waitFor({ timeout: 10000 }).then(() => true, () => false);
    check(`${tag}: applying without notice shows an error toast`, toast);
    await clean(s.p, `${tag}: the error toast`);
    await s.p.locator('header [aria-haspopup="menu"]').first().click();
    check(`${tag}: the header's user menu opens`, await s.p.locator('[role="menu"]').first().waitFor({ timeout: 10000 }).then(() => true, () => false));
    await clean(s.p, `${tag}: the user menu`);
    await s.ctx.close();

    section(`Manager (${tag})`);
    const m = await session(mgr.email, vp);
    await page(m.p, "/attendance/more/approvals", tag);
    await dialog(m.p, "/attendance/more/approvals", /^Reject/, tag);

    await m.ctx.close();
    section(`HR (${tag})`);
    const h = await session(hr.email, vp);
    for (const to of ADMIN) await page(h.p, to, tag);
    if (tag === "laptop") await dialog(h.p, "/attendance/admin/people", /^Edit/, tag); // a phone opens a person by tapping their card
    await dialog(h.p, "/attendance/admin/leave", /^Adjust/, tag);
    await dialog(h.p, "/attendance/admin/settings", /Add shift/, tag);
    await h.ctx.close();
  }
} catch (e) {
  failed = e;
  check("the suite ran to the end without an unexpected error", false, e?.stack ?? String(e));
} finally {
  await browser?.close();
  await tidy();
  check("cleanup: no test people left", (await q("select count(*)::int n from users where email like 'zzd-%'"))[0].n === 0);
  await q.end?.();
}

const passed = results.filter(([, ok]) => ok).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(failed || passed !== results.length ? 1 : 0);
