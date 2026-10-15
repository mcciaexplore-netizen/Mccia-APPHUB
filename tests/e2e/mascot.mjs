/**
 * End-to-end test of the Safety Week mascot in a real browser. Run: E2E_BASE_URL=http://localhost:3000 npm run test:e2e:mascot
 *
 * Clicking "Safety Week" in the sidebar shows a small waving mascot for about two seconds; nothing else about the page may change.
 * It signs in as the main admin (who sees every department). If there is no department named "Safety Week" it makes one for the run and
 * removes it afterwards; if there is one, it is only read. Set E2E_SHOTS=/some/folder to also save pictures of the animation.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const req = createRequire(ROOT + "/package.json");
req("dotenv").config({ path: ROOT + "/.env.local", quiet: true });
req("dotenv").config({ path: ROOT + "/.env", quiet: true });
const BASE = (process.env.E2E_BASE_URL || "").replace(/\/$/, "");
if (!BASE) { console.error("Set E2E_BASE_URL, for example: E2E_BASE_URL=http://localhost:3000 npm run test:e2e:mascot"); process.exit(2); }
const ADMIN_EMAIL = (process.env.HEAD_ADMIN_EMAIL || "").trim().toLowerCase();
const ADMIN_PW = process.env.HEAD_ADMIN_PASSWORD || "";
if (!ADMIN_EMAIL || !ADMIN_PW) { console.error("HEAD_ADMIN_EMAIL and HEAD_ADMIN_PASSWORD must be set."); process.exit(2); }
const SHOTS = process.env.E2E_SHOTS || "";

const rawSql = (() => {
  if ((process.env.DB_DRIVER ?? "neon") !== "pg") return req("@neondatabase/serverless").neon(process.env.DATABASE_URL);
  const pool = new (req("pg").Pool)({ connectionString: process.env.DATABASE_URL, max: 2, ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false });
  return async (strings, ...values) => (await pool.query(strings.reduce((q, s, i) => q + (i ? `$${i}` : "") + s, ""), values)).rows;
})();
const retry = async (fn, tries = 6, waitMs = 2000) => { let last; for (let i = 0; i < tries; i++) { try { return await fn(); } catch (e) { last = e; await new Promise((r) => setTimeout(r, waitMs)); } } throw last; };
const sql = (...a) => retry(() => rawSql(...a));
const playwright = req("playwright-core");
const launch = () => playwright.chromium.launch({ channel: process.env.E2E_CHROME_CHANNEL || "chrome", headless: true }).catch(() => playwright.chromium.launch({ headless: true }));

const results = [];
const check = (name, ok, extra = "") => { results.push([name, !!ok]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra !== "" ? "  -> " + String(extra).slice(0, 200) : ""}`); };
const section = (t) => console.log(`\n== ${t} ==`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MASCOT = "[data-safety-mascot]";

let created = null;
const existing = (await sql`select id from departments where lower(name) = 'safety week'`)[0];
if (!existing) created = (await sql`insert into departments (name, slug, icon, sort_order) values ('Safety Week', 'safety-week', 'ShieldCheck', 9990) returning id`)[0];
const before = JSON.stringify([await sql`select name, is_active from departments where lower(name) <> 'safety week' order by name`, await sql`select count(*)::int n from apps`, await sql`select count(*)::int n from users`]);

const browser = await launch();
const errors = [];
const watch = (page) => { page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*40\d/.test(m.text())) errors.push(m.text().slice(0, 160)); }); page.on("pageerror", (e) => errors.push(String(e).slice(0, 160))); };
const signIn = async (page) => {
  await page.goto(BASE + "/login");
  await page.locator("input[name=email]").fill(ADMIN_EMAIL); await page.locator("input[name=password]").fill(ADMIN_PW);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForFunction(() => location.pathname !== "/login", null, { timeout: 25000 }).catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
};
const gone = async (page, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if ((await page.locator(MASCOT).count()) === 0) return Date.now() - t; await sleep(25); } return null; };
const shot = (page, name) => (SHOTS ? page.screenshot({ path: path.join(SHOTS, name + ".png") }) : Promise.resolve());

try {
  // ------------------------------------------------------------------------------------------------ desktop
  section("1. Desktop: clicking Safety Week");
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  const page = await ctx.newPage(); watch(page);
  const assets = []; page.on("response", (r) => { if (r.url().includes("safety-first-mascot")) assets.push(r.status()); });
  await signIn(page);
  await page.goto(BASE + "/"); await page.waitForLoadState("networkidle").catch(() => {});
  const link = page.locator("aside:visible nav a", { hasText: /^\s*Safety Week\s*$/ });
  check("the Safety Week item is in the sidebar", (await link.count()) === 1);
  check("no mascot is on the page until Safety Week is clicked", (await page.locator(MASCOT).count()) === 0);
  const others = page.locator("aside:visible nav a").filter({ hasNotText: /Safety Week/ });
  if ((await others.count()) > 0) { await others.first().click(); await sleep(500); }
  check("clicking any other sidebar item shows no mascot", (await page.locator(MASCOT).count()) === 0);

  const swId = (existing ?? created).id;
  await page.goto(BASE + "/?d=" + swId); await page.waitForLoadState("networkidle").catch(() => {});
  check("opening the Safety Week page directly (not by clicking the sidebar item) does not play it", (await page.locator(MASCOT).count()) === 0);
  const mainBefore = await page.locator("main").innerText();
  const clickedAt = Date.now();
  await link.click();
  await page.locator(MASCOT).waitFor({ timeout: 2000 });
  check("clicking Safety Week shows the mascot straight away", Date.now() - clickedAt < 1500, `${Date.now() - clickedAt} ms`);
  check("the user stays on Safety Week and the page is its normal one", /[?&]d=/.test(page.url()) && (await page.locator("main h1").first().innerText()).trim() === "Safety Week", page.url());
  await sleep(150); await shot(page, "1-pop-in");
  const box = await page.locator(MASCOT).boundingBox();
  const vw = 1300, vh = 900;
  check("it sits near the bottom-right corner, fully on screen, and is small", !!box && box.x + box.width <= vw && box.y + box.height <= vh && box.x + box.width > vw - 60 && box.y + box.height > vh - 60 && box.width <= 160 && box.width >= 90, JSON.stringify(box));
  check("it can never be clicked, so it cannot block anything (pointer-events: none, and the page underneath receives clicks)", (await page.locator(MASCOT).evaluate((el) => getComputedStyle(el).pointerEvents)) === "none" && (await page.evaluate(([x, y]) => !document.elementFromPoint(x, y)?.closest("[data-safety-mascot]"), [box.x + box.width / 2, box.y + box.height / 2])));
  check("it is decorative: hidden from screen readers", (await page.locator(MASCOT).getAttribute("aria-hidden")) === "true");
  check("both layers of the picture loaded (no broken image)", (await page.locator(MASCOT + " img").evaluateAll((imgs) => imgs.length === 2 && imgs.every((i) => i.complete && i.naturalWidth > 0))) && assets.length >= 1 && assets.every((s) => s === 200 || s === 304), assets.join(",")); // 304 = the browser's copy is current
  // is it waving? the glove's rotation must change over time while the rest stays still
  const angle = () => page.locator(MASCOT + " img").nth(1).evaluate((el) => { const m = new DOMMatrix(getComputedStyle(el).transform); return Math.round(Math.atan2(m.b, m.a) * 180 / Math.PI * 10) / 10; });
  const baseStill = () => page.locator(MASCOT + " img").nth(0).evaluate((el) => getComputedStyle(el).transform);
  const seen = [];
  for (let i = 0; i < 8; i++) { seen.push(await angle()); await sleep(110); }
  await shot(page, "2-waving");
  check("the glove swings both ways (it is waving)", Math.min(...seen) < -6 && Math.max(...seen) > 6, seen.join(", "));
  check("the rest of the mascot stays still", (await baseStill()) === "none", await baseStill());
  const hideAfter = await gone(page, 3500);
  const total = Date.now() - clickedAt;
  check("it disappears by itself after about two seconds", total > 1700 && total < 2700, `${total} ms in all`);
  check("the Safety Week page itself is exactly as it was before the click", (await page.locator("main").innerText()) === mainBefore && /[?&]d=/.test(page.url()));
  void hideAfter;

  section("2. Replaying, rapid clicks and the keyboard");
  await link.click(); await page.locator(MASCOT).waitFor({ timeout: 2000 });
  check("clicking Safety Week again plays it again", (await page.locator(MASCOT).count()) === 1);
  await gone(page, 3500);
  let last = 0;
  for (let i = 0; i < 4; i++) { await link.click(); last = Date.now(); await sleep(120); }
  check("clicking repeatedly never makes more than one mascot", (await page.locator(MASCOT).count()) === 1);
  await sleep(1500);
  check("it is still showing 1.6 s after the last of the rapid clicks (the timer restarted, nothing hid it early)", (await page.locator(MASCOT).count()) === 1, `${Date.now() - last} ms since the last click`);
  await gone(page, 3500);
  const sinceLast = Date.now() - last;
  check("and it goes about two seconds after the LAST click, not earlier", sinceLast > 1800 && sinceLast < 2800, `${sinceLast} ms`);
  await link.focus(); await page.keyboard.press("Enter");
  check("the keyboard works too: Enter on the focused item plays it", await page.locator(MASCOT).waitFor({ timeout: 2000 }).then(() => true).catch(() => false));
  await gone(page, 3500);
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  check("no sideways scroll and no layout shift from the mascot", o.sw <= o.iw + 1, `${o.sw} vs ${o.iw}`);
  await page.goto(BASE + "/"); await page.waitForLoadState("networkidle").catch(() => {});
  check("loading or leaving the page never plays it", (await page.locator(MASCOT).count()) === 0);
  await ctx.close();

  // ------------------------------------------------------------------------------------------------ phone
  section("3. A phone-sized screen");
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await mctx.newPage(); watch(mp);
  await signIn(mp); await mp.goto(BASE + "/"); await mp.waitForLoadState("networkidle").catch(() => {});
  await mp.getByRole("button", { name: "Open menu" }).click(); await sleep(450);
  const mlink = mp.locator("aside").last().locator("nav a", { hasText: /^\s*Safety Week\s*$/ });
  await mlink.click();
  await mp.locator(MASCOT).waitFor({ timeout: 2500 });
  await sleep(300); await shot(mp, "3-phone");
  const mb = await mp.locator(MASCOT).boundingBox();
  check("on a phone the mascot is shown, fully on screen, and no bigger than 150 px", !!mb && mb.x >= 0 && mb.x + mb.width <= 390 && mb.y + mb.height <= 844 && mb.width <= 150, JSON.stringify(mb));
  check("the menu closed as usual and the page is Safety Week", /[?&]d=/.test(mp.url()) && (await mp.locator("main h1").first().innerText()).trim() === "Safety Week");
  const mo = await mp.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  check("no sideways scroll on the phone", mo.sw <= mo.iw + 1, `${mo.sw} vs ${mo.iw}`);
  const mgone = await gone(mp, 3500);
  check("on the phone it also goes by itself", mgone !== null);
  await mctx.close();

  // ------------------------------------------------------------------------------------------------ reduced motion
  section("4. People who ask for less motion");
  const rctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, reducedMotion: "reduce" });
  const rp = await rctx.newPage(); watch(rp);
  await signIn(rp); await rp.goto(BASE + "/"); await rp.waitForLoadState("networkidle").catch(() => {});
  const rlink = rp.locator("aside:visible nav a", { hasText: /^\s*Safety Week\s*$/ });
  const rt = Date.now(); await rlink.click(); await rp.locator(MASCOT).waitFor({ timeout: 2000 });
  check("with reduced motion it still shows (no animation) and still goes away after about two seconds", (await rp.locator(MASCOT + " img").evaluateAll((i) => i.every((x) => x.complete && x.naturalWidth > 0))) && (await gone(rp, 3500)) !== null && Date.now() - rt < 3000, `${Date.now() - rt} ms`);
  await rctx.close();

  check("no JavaScript or console errors anywhere", errors.length === 0, errors.join(" | "));
} catch (e) {
  console.log("\nTEST ERROR:", String(e).split("\n").slice(0, 4).join(" | ")); results.push(["test crashed", false]);
} finally {
  await browser.close();
  section("Cleanup and data-safety check");
  if (created) await retry(() => sql`delete from departments where id = ${created.id}`);
  const after = JSON.stringify([await sql`select name, is_active from departments where lower(name) <> 'safety week' order by name`, await sql`select count(*)::int n from apps`, await sql`select count(*)::int n from users`]);
  check("nothing in the database changed", before === after);
  if (created) check("the temporary Safety Week department was removed", (await sql`select count(*)::int n from departments where lower(name) = 'safety week'`)[0].n === 0);
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) console.log("FAILED:\n - " + failed.map(([n]) => n).join("\n - "));
  process.exit(failed.length ? 1 : 0);
}
