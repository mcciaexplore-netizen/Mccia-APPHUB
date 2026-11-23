// Payment Desk inside the hub (/payment-desk): the hub tile of an application whose address is Payment Desk's opens the hub page in the same
// tab, the page frames Payment Desk with the signed-in person's email, the help line opens Payment Desk in a new tab and can be closed,
// someone signed out is sent to /login, and the old /go/<id> link lands on /payment-desk too. Another outside application still opens
// through /go in a new tab, as before.
//
// It creates "zzp-" people, a "ZZP" category and two applications, all removed at the end. Run against a local server and a test
// database only:
//   E2E_PAYMENT_DESK_CONFIRM=yes E2E_BASE_URL=http://localhost:3000 DATABASE_URL=... node tests/e2e/payment-desk.mjs
import { createRequire } from "node:module";
import { randomBytes, scryptSync } from "node:crypto";

if (process.env.E2E_PAYMENT_DESK_CONFIRM !== "yes") {
  console.error("This test adds and removes people and applications. Set E2E_PAYMENT_DESK_CONFIRM=yes against a TEST database.");
  process.exit(2);
}
const BASE = (process.env.E2E_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
if (/neon\.tech/.test(process.env.DATABASE_URL ?? "") && process.env.E2E_ALLOW_NEON !== "yes") {
  console.error("DATABASE_URL points at Neon. Use a local test database (or set E2E_ALLOW_NEON=yes for a Neon test branch).");
  process.exit(2);
}

const req = createRequire(import.meta.url);
const pool = new (req("pg").Pool)({ connectionString: process.env.DATABASE_URL });
const q = (t, v = []) => pool.query(t, v).then((r) => r.rows);
const PW = "zzp-Pass-123";
const EMAIL = "zzp-asha+desk@mcciapune.com";
const hash = (pw) => { const s = randomBytes(16); return `scrypt$16384$${s.toString("base64")}$${scryptSync(pw, s, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("base64")}`; };

let pass = 0, fail = 0;
const check = (name, good, detail = "") => { if (good) pass++; else fail++; console.log(`${good ? "PASS" : "FAIL"}  ${name}${good || !detail ? "" : `  (${detail})`}`); };

async function tidy() {
  const ids = (await q("select id from users where email like 'zzp-%'")).map((r) => r.id);
  if (ids.length) {
    await q("delete from activity_log where user_id = any($1)", [ids]).catch(() => {});
    await q("delete from access_audit where actor_id = any($1)", [ids]).catch(() => {});
    await q("delete from hub_notifications where user_id = any($1)", [ids]).catch(() => {});
  }
  await q("delete from users where email like 'zzp-%'");
  await q("delete from apps where name like 'ZZP%'");
  await q("delete from departments where name like 'ZZP%'");
}

await tidy();
const [d] = await q("insert into departments (name, icon) values ('ZZP Finance', 'wallet') returning id").catch(() => q("insert into departments (name, icon) values ('ZZP Finance', 'clock') returning id"));
const [desk] = await q("insert into apps (department_id, name, url, icon, description) values ($1, 'ZZP Payment Desk', 'https://payment-advice.vercel.app', 'clock', 'Payment advice') returning id", [d.id]);
const [other] = await q("insert into apps (department_id, name, url, icon) values ($1, 'ZZP Other', 'https://example.com', 'clock') returning id", [d.id]);
const [u] = await q("insert into users (name, email, password_hash) values ('Asha', $1, $2) returning id", [EMAIL, hash(PW)]);
for (const a of [desk, other]) await q("insert into user_app_access (user_id, app_id, app_role) values ($1, $2, 'user')", [u.id, a.id]);

const pw = req("playwright-core");
const br = await pw.chromium.launch({ channel: "chrome", headless: true }).catch(() => pw.chromium.launch({ headless: true }));
try {
  // Signed out: the page and the old link both go to the sign-in page.
  {
    const ctx = await br.newContext();
    const p = await ctx.newPage();
    await p.goto(BASE + "/payment-desk");
    check("signed out: /payment-desk goes to /login", new URL(p.url()).pathname === "/login", p.url());
    check("signed out: and comes back after signing in", new URL(p.url()).searchParams.get("next") === "/payment-desk", p.url());
    check("signed out: no frame", (await p.locator("iframe[title='Payment Desk']").count()) === 0);
    await ctx.close();
  }

  for (const vp of [{ width: 1280, height: 860 }, { width: 390, height: 844 }]) {
    const tag = vp.width < 768 ? "phone" : "laptop";
    const ctx = await br.newContext({ viewport: vp, isMobile: vp.width < 768, hasTouch: vp.width < 768 });
    await ctx.addInitScript(() => { try { localStorage.setItem("mccia-install-popup-seen", "1"); localStorage.setItem("mccia-install-snoozed-until", String(Date.now() + 864e5)); } catch {} });
    const p = await ctx.newPage();
    await p.goto(BASE + "/login"); await p.fill("input[name=email]", EMAIL); await p.fill("input[name=password]", PW);
    await p.click("button[type=submit]"); await p.waitForURL((x) => x.pathname === "/", { timeout: 90000 });

    // The tile: a link to the hub page, in this tab, with the same-tab arrow; the outside application is unchanged.
    const tile = p.locator("a", { hasText: "ZZP Payment Desk" }).first();
    check(`${tag}: tile links to /payment-desk`, (await tile.getAttribute("href")) === "/payment-desk", await tile.getAttribute("href"));
    check(`${tag}: tile opens in the same tab`, !(await tile.getAttribute("target")) || (await tile.getAttribute("target")) === "_self");
    check(`${tag}: tile does not say "opens in a new tab"`, (await tile.locator("[aria-label='opens in a new tab']").count()) === 0);
    check(`${tag}: tile never shows Payment Desk's address`, !(await p.content()).includes("payment-advice.vercel.app"));
    const otherTile = p.locator("a", { hasText: "ZZP Other" }).first();
    check(`${tag}: another outside application still goes through /go`, (await otherTile.getAttribute("href")) === `/go/${other.id}`, await otherTile.getAttribute("href"));

    const before = Number((await q("select count(*)::int as n from activity_log where user_id = $1 and app_id = $2 and action = 'launch'", [u.id, desk.id]))[0].n);
    await tile.click();
    await p.waitForURL((x) => x.pathname === "/payment-desk", { timeout: 30000 });
    check(`${tag}: clicking the tile opens /payment-desk in this tab`, new URL(p.url()).pathname === "/payment-desk");
    const frame = p.locator("iframe[title='Payment Desk']");
    await frame.waitFor({ timeout: 20000 });
    const src = await frame.getAttribute("src");
    check(`${tag}: frame address is Payment Desk in embed mode with the email`, src === `https://payment-advice.vercel.app/?embed=1&email=${encodeURIComponent(EMAIL)}`, src);
    check(`${tag}: frame has no sandbox`, (await frame.getAttribute("sandbox")) === null);
    check(`${tag}: frame allows clipboard-write`, (await frame.getAttribute("allow")) === "clipboard-write");
    const geo = await p.evaluate(() => {
      const f = document.querySelector("iframe[title='Payment Desk']").getBoundingClientRect();
      const h = document.querySelector("header").getBoundingClientRect();
      const cs = getComputedStyle(document.querySelector("iframe[title='Payment Desk']"));
      return { fTop: f.top, fBottom: f.bottom, fW: f.width, hH: h.height, vh: innerHeight, vw: innerWidth, border: cs.borderTopWidth, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight };
    });
    check(`${tag}: frame fills the width`, Math.round(geo.fW) === geo.vw, JSON.stringify(geo));
    check(`${tag}: frame reaches the bottom of the screen`, Math.abs(geo.fBottom - geo.vh) <= 1, JSON.stringify(geo));
    check(`${tag}: frame has no border`, geo.border === "0px", geo.border);
    check(`${tag}: no page scroll around the frame`, geo.sh <= geo.vh + 1 && geo.sw <= geo.vw, JSON.stringify(geo));
    await p.waitForTimeout(500);
    const after = Number((await q("select count(*)::int as n from activity_log where user_id = $1 and app_id = $2 and action = 'launch'", [u.id, desk.id]))[0].n);
    check(`${tag}: the launch is recorded in the activity log`, after === before + 1, `${before} → ${after}`);

    // The help line: a new-tab link to Payment Desk, which can be closed; the frame then takes its space.
    const help = p.locator("[data-testid=payment-desk-help]");
    check(`${tag}: help line shown`, await help.isVisible());
    check(`${tag}: help line text`, /Having trouble loading\?\s*Open Payment Desk in new tab →/.test((await help.innerText()).replace(/\s+/g, " ")), await help.innerText());
    const link = help.locator("a");
    check(`${tag}: help link goes to Payment Desk`, (await link.getAttribute("href")) === "https://payment-advice.vercel.app");
    check(`${tag}: help link opens a new tab`, (await link.getAttribute("target")) === "_blank" && /noopener/.test((await link.getAttribute("rel")) ?? ""));
    const fs = await p.evaluate(() => getComputedStyle(document.querySelector("[data-testid=payment-desk-help]")).fontSize);
    check(`${tag}: help line is small text`, parseFloat(fs) <= 13, fs);
    await help.getByRole("button", { name: "Hide this message" }).click();
    check(`${tag}: help line closes`, (await help.count()) === 0);
    const top = await p.evaluate(() => document.querySelector("iframe[title='Payment Desk']").getBoundingClientRect().top);
    check(`${tag}: frame then starts right under the top bar (64px)`, Math.round(top) === 64, String(top));
    const h = await p.evaluate(() => document.querySelector("iframe[title='Payment Desk']").getBoundingClientRect().height);
    check(`${tag}: frame is then the screen height minus 64px`, Math.abs(h - (geo.vh - 64)) <= 1, `${h} vs ${geo.vh - 64}`);

    // The old link (bookmarks, notifications): /go/<id> lands on the hub page too.
    await p.goto(BASE + `/go/${desk.id}`);
    check(`${tag}: /go/<id> lands on /payment-desk`, new URL(p.url()).pathname === "/payment-desk", p.url());
    await ctx.close();
  }

  // Someone without Payment Desk does not get its tile, and /go answers as for any application they do not have.
  {
    await q("delete from user_app_access where user_id = $1 and app_id = $2", [u.id, desk.id]);
    const ctx = await br.newContext();
    const p = await ctx.newPage();
    await p.goto(BASE + "/login"); await p.fill("input[name=email]", EMAIL); await p.fill("input[name=password]", PW);
    await p.click("button[type=submit]"); await p.waitForURL((x) => x.pathname === "/", { timeout: 90000 });
    check("without access: no Payment Desk tile", (await p.locator("a", { hasText: "ZZP Payment Desk" }).count()) === 0);
    const r = await p.request.get(BASE + `/go/${desk.id}`, { maxRedirects: 0 });
    check("without access: /go/<id> is not found", r.status() === 404, String(r.status()));
    await ctx.close();
  }
} finally {
  await br.close();
  await tidy();
  const left = (await q("select count(*)::int as n from users where email like 'zzp-%'"))[0].n + (await q("select count(*)::int as n from apps where name like 'ZZP%'"))[0].n;
  check("cleanup: no test people or applications left", left === 0, String(left));
  await pool.end();
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
