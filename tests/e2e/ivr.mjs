/**
 * End-to-end test of the IVR-CRM module in a real browser: who may open its two sections (IVR-CRM at /ivr, IVR-CRM Admin at /ivr/admin)
 * and Integrations; that an agent sees ONLY their own members and their own calls everywhere (queue, calls, pipeline, member panel,
 * recordings, KPIs), while the admin section sees everyone's; the Call button (mock Smartflo), wrap-up, notes, closing and reopening a
 * member; importing a calling list and assigning members; analytics, the number CSV and the PDF report; the Smartflo webhook (its secret,
 * repeats, the Membership-only filter), the sync cron and the heartbeat. Run against a site with IVR_ENABLED=true, SMARTFLO_MODE=mock,
 * SMARTFLO_WEBHOOK_SECRET and CRON_SECRET set (the same values here):
 *   E2E_BASE_URL=http://localhost:3000 SMARTFLO_WEBHOOK_SECRET=... CRON_SECRET=... node tests/e2e/ivr.mjs
 * With the module switched off (IVR_ENABLED unset), E2E_IVR_OFF=yes checks instead that every /ivr page and /api/ivr route is a 404.
 *
 * It WRITES to the database the site uses, but only rows named "ZZI"/"zzi-": people, two "ZZI" applications (URLs /ivr, /ivr/admin) given
 * to them, and the members, calls, notes and settings they make. Everything is removed when it finishes (and at the start, if an earlier
 * run was interrupted), the retry rule is put back as it was, and it checks that every other ivr_ member and call is exactly as before.
 * It refuses a Neon database unless E2E_ALLOW_NEON=yes. The head admin (HEAD_ADMIN_EMAIL / HEAD_ADMIN_PASSWORD) is used for Integrations.
 */
import { createRequire } from "node:module";
import { randomBytes, scryptSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const req = createRequire(ROOT + "/package.json");
req("dotenv").config({ path: ROOT + "/.env.local", quiet: true });
req("dotenv").config({ path: ROOT + "/.env", quiet: true });
const BASE = (process.env.E2E_BASE_URL || "").replace(/\/$/, "");
if (!BASE) { console.error("Set E2E_BASE_URL, for example: E2E_BASE_URL=http://localhost:3000 node tests/e2e/ivr.mjs"); process.exit(2); }
if (/neon\.tech/i.test(process.env.DATABASE_URL || "") && process.env.E2E_ALLOW_NEON !== "yes") { console.error("Refusing: DATABASE_URL is a Neon database. Use a test database, or set E2E_ALLOW_NEON=yes for a Neon test branch."); process.exit(2); }
const WEBHOOK_SECRET = process.env.SMARTFLO_WEBHOOK_SECRET || "dev-webhook-secret";
const CRON_SECRET = process.env.CRON_SECRET || "";

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
const PW = "zzi-Test-pass-123";

const testPeople = async () => (await sql`select id from users where email like 'zzi-%'`).map((r) => r.id);
const removeTestData = async () => {
  const people = await testPeople();
  const leadIds = (await sql`select id from ivr_leads where name like 'ZZI%' or phone like '+9191111%'`).map((r) => r.id);
  for (const id of leadIds) { await sql`delete from ivr_dial_requests where lead_id = ${id}`; await sql`delete from ivr_calls where lead_id = ${id}`; }
  await sql`delete from ivr_calls where smartflo_call_id like 'zzi-%' or customer_number like '+9191111%'`;
  await sql`delete from ivr_call_events where call_id like 'zzi-%'`;
  await sql`delete from ivr_leads where name like 'ZZI%' or phone like '+9191111%'`;
  for (const id of people) {
    await sql`delete from ivr_audit where user_id = ${id}`;
    await sql`delete from ivr_import_batches where uploaded_by = ${id}`;
    await sql`delete from ivr_allocation_rules where user_id = ${id}`;
    await sql`delete from ivr_agent_profiles where user_id = ${id}`;
    await sql`delete from ivr_integrations where user_id = ${id}`;
    await sql`update ivr_smartflo_agents set mapped_user_id = null where mapped_user_id = ${id}`;
    await sql`delete from hub_notifications where user_id = ${id}`;
    await sql`delete from activity_log where user_id = ${id}`;
  }
  await sql`delete from ivr_call_categories where key like 'zzi%'`;
  await sql`delete from users where email like 'zzi-%'`;
  for (const a of await sql`select id from apps where name like 'ZZI%'`) await sql`delete from activity_log where app_id = ${a.id}`;
  await sql`delete from apps where name like 'ZZI%'`;
  await sql`delete from departments where name like 'ZZI%'`;
};
// Every ivr_ member and call that is not this test's own, so the end can prove none of it changed.
const snap = async () => JSON.stringify([
  await sql`select id, owner_id, stage, attempts, updated_at from ivr_leads where name not like 'ZZI%' and phone not like '+9191111%' order by id`,
  await sql`select id, agent_user_id, lead_id, category_id, remark, updated_at from ivr_calls where smartflo_call_id not like 'zzi-%' and customer_number not like '+9191111%' order by id`,
]);
const categoriesBefore = await sql`select id, key, label, ivr_key, active from ivr_call_categories where key not like 'zzi%' order by id`;
const sameCategories = async () => {
  const now = new Map((await sql`select id, key, label, ivr_key, active from ivr_call_categories`).map((c) => [c.id, JSON.stringify(c)]));
  return categoriesBefore.every((c) => now.get(c.id) === JSON.stringify(c));
};

await removeTestData();
const before = await snap();
const retryBefore = (await sql`select value from ivr_settings where key = 'retry'`)[0]?.value ?? null;

const person = async (name, email, role = "member") => (await sql`insert into users (name, email, password_hash, status, role) values (${name}, ${email}, ${hash(PW)}, 'approved', ${role}) returning id`)[0];
const agentA = await person("ZZI Agent Asha", "zzi-agent-a@gmail.com");
const agentB = await person("ZZI Agent Bala", "zzi-agent-b@gmail.com");
const admin = await person("ZZI Admin", "zzi-admin@gmail.com");
const adminOnly = await person("ZZI Admin Only", "zzi-adminonly@gmail.com");
const appAdminNoAccess = await person("ZZI App Admin Without Access", "zzi-appadmin@gmail.com");
const outsider = await person("ZZI Outsider", "zzi-outsider@gmail.com");
// The two applications, as a Support Admin would add them in Administrator → Applications, and who has each.
const [dept] = await sql`insert into departments (kind, name, icon) values ('application', 'ZZI Dept', 'Phone') returning id`;
const app = async (name, url, icon) => (await sql`insert into apps (department_id, name, url, icon) values (${dept.id}, ${name}, ${url}, ${icon}) returning id`)[0];
const crmApp = await app("ZZI IVR-CRM", "/ivr", "Phone");
const adminApp = await app("ZZI IVR-CRM Admin", "/ivr/admin", "ClipboardList");
const grant = (u, a) => sql`insert into user_app_access (user_id, app_id) values (${u.id}, ${a.id}) on conflict do nothing`;
for (const u of [agentA, agentB, admin]) await grant(u, crmApp);
await grant(admin, adminApp); await grant(adminOnly, adminApp);
for (const u of [admin, adminOnly, appAdminNoAccess]) await sql`insert into app_admins (app_id, user_id) values (${adminApp.id}, ${u.id})`;

// What Smartflo rings for each agent, and the test members and calls: Asha owns A1 and A2, Bala owns B1, one is unassigned. Bala also made
// a call to Asha's member A1: Asha must not see it.
const PHONE_A = "+919800000101", PHONE_B = "+919800000102";
await sql`insert into ivr_agent_profiles (user_id, phone) values (${agentA.id}, ${PHONE_A}), (${agentB.id}, ${PHONE_B})`;
const lead = async (name, phone, owner) => (await sql`insert into ivr_leads (name, phone, owner_id, source) values (${name}, ${phone}, ${owner?.id ?? null}, 'ZZI test') returning id, phone`)[0];
const A1 = await lead("ZZI Member A1", "+919111100001", agentA);
const A2 = await lead("ZZI Member A2", "+919111100002", agentA);
const B1 = await lead("ZZI Member B1", "+919111100003", agentB);
const U1 = await lead("ZZI Member Unassigned", "+919111100004", null);
const call = async (sid, l, agent, status, mins) => (await sql`insert into ivr_calls (smartflo_call_id, lead_id, agent_user_id, direction, status, outcome, customer_number, started_at, ended_at, duration_sec, answered_sec, recording_url, source)
  values (${sid}, ${l.id}, ${agent.id}, 'outbound', ${status}, ${status === "answered" ? "answered" : "not_answered"}, ${l.phone}, now() - (${mins} || ' minutes')::interval, now() - (${mins - 1} || ' minutes')::interval, 70, ${status === "answered" ? 60 : 0}, ${status === "answered" ? `mock://recording/${sid}` : null}, 'sync') returning id`)[0];
const cA1 = await call("zzi-c-a1", A1, agentA, "answered", 30);
const cB1 = await call("zzi-c-b1", B1, agentB, "answered", 25);
const cB2 = await call("zzi-c-b2-on-a1", A1, agentB, "answered", 20);

const browser = await launch();
const pageErrors = [];
const signedIn = async (email, password = PW) => {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
  ctx.setDefaultTimeout(45000);
  await ctx.addInitScript(() => { try { localStorage.setItem("mccia-install-popup-seen", "1"); localStorage.setItem("mccia-install-snoozed-until", String(Date.now() + 864e5)); } catch {} });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(`${new URL(page.url()).pathname}: ${String(e).slice(0, 120)}`));
  await page.goto(BASE + "/login"); await page.fill("input[name=email]", email); await page.fill("input[name=password]", password);
  await page.click("button[type=submit]"); await page.waitForURL((u) => u.pathname === "/", { timeout: 60000 });
  return { ctx, page };
};
const go = async (page, p) => { const r = await page.goto(BASE + p); await page.waitForLoadState("networkidle").catch(() => {}); return r; };
const pathOf = (page) => new URL(page.url()).pathname;
const api = (page, url, method = "GET", body) => page.evaluate(async ([u, m, b]) => {
  const r = await fetch(u, { method: m, headers: b ? { "Content-Type": "application/json" } : {}, body: b ? JSON.stringify(b) : undefined });
  const type = r.headers.get("content-type") ?? "";
  return { status: r.status, type, body: type.includes("json") ? await r.json().catch(() => null) : null };
}, [url, method, body]);
const navLabels = async (page, name) => (await page.locator(`nav[aria-label="${name}"] a`).allInnerTexts()).map((t) => t.trim()).filter((t) => t && !/hub/i.test(t)).join("|");
const mainText = async (page) => page.locator("main").innerText();
const rows = async (page) => page.locator("main table tbody tr").count();
const hook = (secret, payload) => fetch(`${BASE}/api/ivr/webhooks/smartflo/${secret}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), redirect: "manual" });
const ist = (d) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 19).replace("T", " ");

let exitCode = 0;
if (process.env.E2E_IVR_OFF === "yes") {
  try {
    section("module switched off");
    const { page } = await signedIn("zzi-admin@gmail.com");
    for (const p of ["/ivr", "/ivr/calls", "/ivr/pipeline", "/ivr/connections", "/ivr/admin", "/ivr/admin/members", "/ivr/admin/import", "/ivr/admin/analytics", "/ivr/admin/integrations"]) {
      check(`off: ${p} is a 404`, (await go(page, p))?.status() === 404);
    }
    for (const p of ["/api/ivr/kpis", "/api/ivr/analytics/numbers", "/api/ivr/reports/pdf", `/api/ivr/recordings/${cA1.id}`]) check(`off: GET ${p} is a 404`, (await api(page, p)).status === 404);
    check("off: the Smartflo webhook is a 404, even with the right secret", (await hook(WEBHOOK_SECRET, { call_id: "zzi-off" })).status === 404);
    if (CRON_SECRET) {
      const r = await fetch(`${BASE}/api/cron/ivr-sync`, { headers: { authorization: `Bearer ${CRON_SECRET}` } });
      check("off: the sync cron answers that the module is off, and does nothing", r.status === 200 && /switched off/.test(JSON.stringify(await r.json())));
    }
    check("off: nothing was written", (await sql`select count(*)::int n from ivr_call_events where call_id like 'zzi-%'`)[0].n === 0);
  } catch (e) { console.error(e); exitCode = 1; }
  await browser.close(); await removeTestData();
  if (exitCode) process.exit(exitCode);
  finish();
}

try {
  const A = await signedIn("zzi-agent-a@gmail.com");
  const B = await signedIn("zzi-agent-b@gmail.com");
  const M = await signedIn("zzi-admin@gmail.com");
  const MO = await signedIn("zzi-adminonly@gmail.com");
  const NA = await signedIn("zzi-appadmin@gmail.com");
  const O = await signedIn("zzi-outsider@gmail.com");
  const H = process.env.HEAD_ADMIN_EMAIL && process.env.HEAD_ADMIN_PASSWORD ? await signedIn(process.env.HEAD_ADMIN_EMAIL, process.env.HEAD_ADMIN_PASSWORD) : null;

  section("who may open which section");
  await go(A.page, "/");
  const tilesA = await mainText(A.page);
  check("hub: an agent sees the IVR-CRM tile, not IVR-CRM Admin", tilesA.includes("ZZI IVR-CRM") && !tilesA.includes("ZZI IVR-CRM Admin"));
  await go(M.page, "/");
  const tilesM = await mainText(M.page);
  check("hub: the admin sees both tiles", tilesM.includes("ZZI IVR-CRM") && tilesM.includes("ZZI IVR-CRM Admin"));
  await go(A.page, "/ivr");
  check("agent: /ivr opens on the call queue, with the agent menu", pathOf(A.page) === "/ivr" && (await navLabels(A.page, "IVR-CRM")) === "Call queue|My calls|Pipeline|Connections");
  check("agent: the hub bell is in the IVR-CRM frame", (await A.page.locator("[data-hub-bell]").count()) === 1);
  await go(A.page, "/ivr/admin"); check("agent: IVR-CRM Admin sends them back to their queue", pathOf(A.page) === "/ivr");
  await go(A.page, "/ivr/admin/integrations"); check("agent: Integrations sends them back to their queue", pathOf(A.page) === "/ivr");
  await go(O.page, "/ivr"); check("someone without IVR-CRM is sent back to the hub", pathOf(O.page) === "/");
  await go(O.page, "/ivr/admin"); check("someone without IVR-CRM Admin is sent back to the hub", pathOf(O.page) === "/");
  await go(NA.page, "/ivr/admin"); check("an App Admin of IVR-CRM Admin who was not given it is sent back to the hub (as for every Admin application)", pathOf(NA.page) === "/");
  await go(M.page, "/ivr/admin");
  check("admin: /ivr/admin opens on Team overview, with the admin menu and no Integrations", pathOf(M.page) === "/ivr/admin"
    && (await navLabels(M.page, "IVR-CRM Admin")) === "Team overview|Members and assignment|Import members|Team calls|Pipeline|Analytics|PDF reports|Categories|Agents");
  check("admin: the hub bell is in the IVR-CRM Admin frame", (await M.page.locator("[data-hub-bell]").count()) === 1);
  await go(M.page, "/ivr/admin/integrations"); check("admin: Integrations (Smartflo credentials) sends an IVR admin back to Team overview", pathOf(M.page) === "/ivr/admin");
  await go(M.page, "/ivr"); check("admin given IVR-CRM too: also opens the agents' section", pathOf(M.page) === "/ivr");
  await go(MO.page, "/ivr"); check("admin without IVR-CRM: /ivr sends them to IVR-CRM Admin", pathOf(MO.page) === "/ivr/admin");
  if (H) {
    await go(H.page, "/ivr/admin/integrations");
    check("head admin: Integrations opens, and the menu has it", pathOf(H.page) === "/ivr/admin/integrations" && (await navLabels(H.page, "IVR-CRM Admin")).endsWith("|Integrations")
      && (await H.page.getByRole("heading", { name: "Integrations" }).count()) >= 1);
    await go(H.page, "/ivr"); check("head admin: opens the agents' section too", pathOf(H.page) === "/ivr");
  } else check("head admin: HEAD_ADMIN_EMAIL / HEAD_ADMIN_PASSWORD are set for the test", false);
  check("API: an agent cannot download the PDF report (403)", (await api(A.page, "/api/ivr/reports/pdf")).status === 403);
  check("API: an agent cannot download the number CSV (403)", (await api(A.page, "/api/ivr/analytics/numbers")).status === 403);
  check("API: someone without IVR-CRM cannot read KPIs (403)", (await api(O.page, "/api/ivr/kpis?range=today")).status === 403);
  check("API: someone without IVR-CRM cannot trigger a sync (403)", (await api(O.page, "/api/ivr/sync/tick", "POST")).status === 403);
  const anon = await fetch(`${BASE}/api/ivr/kpis?range=today`, { redirect: "manual" });
  check("API: signed out is refused", anon.status === 401 || anon.status === 307, anon.status);

  section("an agent sees only their own members and calls");
  await go(A.page, "/ivr?show=all");
  const queueA = await mainText(A.page);
  check("queue: Asha sees her members A1 and A2", queueA.includes("ZZI Member A1") && queueA.includes("ZZI Member A2"));
  check("queue: not Bala's member or the unassigned one", !queueA.includes("ZZI Member B1") && !queueA.includes("ZZI Member Unassigned"));
  await go(B.page, "/ivr?show=all");
  const queueB = await mainText(B.page);
  check("queue: Bala sees only B1", queueB.includes("ZZI Member B1") && !queueB.includes("ZZI Member A1") && !queueB.includes("ZZI Member A2"));
  await go(A.page, `/ivr?lead=${B1.id}`);
  check("member panel: Asha opening Bala's member by address gets 'Member not found'", (await A.page.getByText("Member not found").count()) === 1);
  await go(A.page, "/ivr/calls");
  check("My calls: Asha sees exactly her one call", (await rows(A.page)) === 1 && (await mainText(A.page)).includes("ZZI Member A1"));
  await go(B.page, "/ivr/calls");
  check("My calls: Bala sees his two calls (one on Asha's member)", (await rows(B.page)) === 2);
  await go(A.page, `/ivr?lead=${A1.id}`);
  const panelA = await A.page.getByRole("tab", { name: /calls and recordings/ }).innerText();
  check("member panel: on her own member A1, Asha sees only her own call there, not Bala's", /\(1\)/.test(panelA), panelA);
  await go(A.page, "/ivr/pipeline");
  const pipeA = await mainText(A.page);
  check("pipeline: Asha's board has only her members", pipeA.includes("ZZI Member A1") && pipeA.includes("ZZI Member A2") && !pipeA.includes("ZZI Member B1") && !pipeA.includes("ZZI Member Unassigned"));
  check("pipeline: and no owner filter", (await A.page.locator("select[name=owner], select[aria-label*='wner']").count()) === 0);
  const recA = await api(A.page, `/api/ivr/recordings/${cA1.id}`);
  check("recording: Asha plays her own call's recording", recA.status === 200 && recA.type.startsWith("audio/"), recA.status);
  check("recording: not Bala's call on her own member (404)", (await api(A.page, `/api/ivr/recordings/${cB2.id}`)).status === 404);
  check("recording: not Bala's call on his member (404)", (await api(A.page, `/api/ivr/recordings/${cB1.id}`)).status === 404);
  const kA = await api(A.page, `/api/ivr/kpis?range=today&user=${agentB.id}`);
  check("KPIs: asking for Bala's numbers still gives Asha only her own (1 connected call, 2 members in her queue)", kA.status === 200 && kA.body?.kpis?.connected === 1 && kA.body?.kpis?.queue === 2, JSON.stringify(kA.body?.kpis));
  const kAll = await api(A.page, "/api/ivr/kpis?range=today");
  check("KPIs: and without naming anyone, still only her own", kAll.body?.kpis?.connected === 1);
  await go(M.page, "/ivr/calls");
  check("an admin's own My calls (agents' section) shows only calls they handled: none", (await M.page.getByText("Calls you handle show here").count()) === 1);

  section("the admin sees everyone's");
  await go(M.page, "/ivr/admin/members");
  const membersM = await mainText(M.page);
  check("members: all four test members, with their owners", ["ZZI Member A1", "ZZI Member A2", "ZZI Member B1", "ZZI Member Unassigned"].every((n) => membersM.includes(n)));
  await go(M.page, "/ivr/admin/calls");
  check("team calls: all three test calls", (await rows(M.page)) >= 3 && (await mainText(M.page)).includes("ZZI Member B1"));
  const kM = await api(M.page, "/api/ivr/kpis?range=today");
  check("KPIs: the admin's team numbers count every agent's calls", (kM.body?.kpis?.connected ?? 0) >= 3, JSON.stringify(kM.body?.kpis));
  const kMB = await api(M.page, `/api/ivr/kpis?range=today&user=${agentB.id}`);
  check("KPIs: an admin may look at one agent (Bala: 2 connected)", kMB.body?.kpis?.connected === 2, JSON.stringify(kMB.body?.kpis));
  await go(M.page, `/ivr/admin/members?lead=${A1.id}`);
  const panelM = await M.page.getByRole("tab", { name: /calls and recordings/ }).innerText();
  check("member panel: the admin sees both calls on A1", /\(2\)/.test(panelM), panelM);
  check("recording: the admin plays any call", (await api(M.page, `/api/ivr/recordings/${cB2.id}`)).status === 200);
  await go(M.page, "/ivr/admin/pipeline");
  const pipeM = await mainText(M.page);
  check("pipeline: the admin's board has every member", ["ZZI Member A1", "ZZI Member B1", "ZZI Member Unassigned"].every((n) => pipeM.includes(n)));

  section("assigning members");
  await go(M.page, "/ivr/admin/members?unassigned=1");
  await M.page.getByLabel("Select ZZI Member Unassigned").check();
  await M.page.getByRole("button", { name: "Assign or reassign" }).click();
  await M.page.getByRole("radio", { name: /Give all to one agent/ }).check();
  await M.page.getByRole("group", { name: "Agents" }).getByRole("button", { name: /ZZI Agent Bala/ }).click();
  await M.page.getByRole("button", { name: "Assign", exact: true }).click();
  const assigned = await poll(async () => (await sql`select owner_id from ivr_leads where id = ${U1.id}`)[0].owner_id === agentB.id);
  check("assign: the unassigned member now belongs to Bala", assigned);
  check("assign: the change is kept in the assignment history", (await sql`select count(*)::int n from ivr_lead_assignments where lead_id = ${U1.id} and to_user_id = ${agentB.id}`)[0].n === 1);
  await go(B.page, "/ivr?show=all");
  check("assign: it is in Bala's queue now", (await mainText(B.page)).includes("ZZI Member Unassigned"));
  await go(A.page, "/ivr?show=all");
  check("assign: and not in Asha's", !(await mainText(A.page)).includes("ZZI Member Unassigned"));
  const outsiderAssign = (await sql`select count(*)::int n from ivr_leads where owner_id = ${outsider.id}`)[0].n;
  check("assign: nobody without IVR-CRM owns a member", outsiderAssign === 0);

  section("calling (mock Smartflo), wrap-up, notes, close and reopen");
  await go(A.page, "/ivr?show=all");
  await A.page.locator("main tr", { hasText: "ZZI Member A2" }).getByRole("button", { name: "Call", exact: true }).click();
  const placed = await poll(async () => (await sql`select id, agent_user_id, status, source from ivr_calls where lead_id = ${A2.id}`)[0]);
  check("Call: the finished call is stored, tied to Asha (the person who pressed Call)", placed && placed.agent_user_id === agentA.id && placed.source === "click_to_call", JSON.stringify(placed));
  check("Call: the dial request is matched", (await sql`select status from ivr_dial_requests where lead_id = ${A2.id}`)[0]?.status === "matched");
  const a2 = (await sql`select stage, attempts from ivr_leads where id = ${A2.id}`)[0];
  check("Call: the member moved on from New (connected or attempted, one try)", a2.stage !== "new" && a2.attempts >= (a2.stage === "attempted" ? 1 : 0), JSON.stringify(a2));
  // The member panel's own Call button (beside its close button), not a queue row's.
  const panelCall = (page) => page.locator("div").filter({ has: page.getByLabel("Close panel") }).last().getByRole("button", { name: /^Call/ });
  const again = await (async () => { await go(A.page, `/ivr?lead=${A2.id}`); await panelCall(A.page).click(); return poll(() => A.page.getByText(/just dialed|Wait a minute/).first().isVisible().catch(() => false), 15000); })();
  check("Call: the same member cannot be dialled again within a minute", again);
  await go(A.page, `/ivr?lead=${A2.id}`);
  const membership = (await sql`select id from ivr_call_categories where key = 'membership'`)[0];
  await A.page.locator(`select[id="cat-${placed.id}"]`).selectOption(membership.id);
  await A.page.locator(`input[id="rem-${placed.id}"]`).fill("ZZI wanted the renewal form");
  await A.page.locator(`form:has(select[id="cat-${placed.id}"])`).getByRole("button", { name: "Save" }).click();
  const wrapped = await poll(async () => { const r = (await sql`select category_id, category_source, remark from ivr_calls where id = ${placed.id}`)[0]; return r.remark ? r : null; });
  check("wrap-up: category and remark are saved, marked as the agent's choice", wrapped?.category_id === membership.id && wrapped?.category_source === "agent" && wrapped?.remark === "ZZI wanted the renewal form", JSON.stringify(wrapped));
  await A.page.getByRole("tab", { name: /notes/ }).click();
  await A.page.locator("#note-body").fill("ZZI prefers a call after 4 pm");
  await A.page.getByRole("button", { name: "Save note" }).click();
  check("notes: the note is saved, by Asha", await poll(async () => (await sql`select count(*)::int n from ivr_notes where lead_id = ${A2.id} and user_id = ${agentA.id} and body like 'ZZI%'`)[0].n === 1));
  await go(A.page, `/ivr?lead=${A2.id}`);
  await A.page.getByRole("button", { name: "Close member" }).click();
  check("close: the member is closed", await poll(async () => (await sql`select stage from ivr_leads where id = ${A2.id}`)[0].stage === "closed"));
  await go(A.page, `/ivr?lead=${A2.id}`);
  await A.page.getByRole("button", { name: "Reopen" }).click();
  check("reopen: the member is open again", await poll(async () => (await sql`select stage from ivr_leads where id = ${A2.id}`)[0].stage !== "closed"));
  check("audit: the module logged the call and its wrap-up", (await sql`select count(*)::int n from ivr_audit where user_id = ${agentA.id} and action in ('call.place', 'call.wrapup')`)[0].n >= 2);
  check("history: closing and reopening are kept as stage events, by Asha", (await sql`select count(*)::int n from ivr_lead_stage_events where lead_id = ${A2.id} and by_user_id = ${agentA.id}`)[0].n === 2);
  await go(B.page, "/ivr/calls");
  check("Bala still does not see Asha's new call", (await rows(B.page)) === 2);

  section("Smartflo webhook, sync cron and heartbeat");
  check("webhook: a wrong secret is a 404", (await hook("not-the-secret", { call_id: "zzi-wh-x" })).status === 404);
  const started = new Date(Date.now() - 10 * 60_000);
  const payload = { call_id: "zzi-wh-1", direction: "inbound", customer_number: B1.phone, call_to_number: "+912071000000", answered_agent_number: PHONE_B,
    start_stamp: ist(started), end_stamp: ist(new Date(started.getTime() + 90_000)), duration: 90, billsec: 75, call_status: "answered" };
  const w1 = await hook(WEBHOOK_SECRET, payload);
  check("webhook: no hub sign-in is needed (Smartflo has none), and the right secret is accepted", w1.status === 200, w1.status);
  const wh = await poll(async () => (await sql`select agent_user_id, lead_id, status from ivr_calls where smartflo_call_id = 'zzi-wh-1'`)[0]);
  check("webhook: the call is stored, tied to Bala by his phone and to member B1", wh?.agent_user_id === agentB.id && wh?.lead_id === B1.id && wh?.status === "answered", JSON.stringify(wh));
  await hook(WEBHOOK_SECRET, payload);
  check("webhook: a repeat does not make a second call", (await sql`select count(*)::int n from ivr_calls where smartflo_call_id = 'zzi-wh-1'`)[0].n === 1);
  check("webhook: every payload is kept untouched in the event log", (await sql`select count(*)::int n from ivr_call_events where call_id = 'zzi-wh-1'`)[0].n === 2);
  await hook(WEBHOOK_SECRET, { ...payload, call_id: "zzi-wh-other", customer_number: "+919111199999", answered_agent_number: "+919999999999", call_to_number: "+911100000000" });
  check("webhook: another department's call (no Membership agent, not a Membership line) is ignored", (await sql`select count(*)::int n from ivr_calls where smartflo_call_id = 'zzi-wh-other'`)[0].n === 0
    && (await sql`select count(*)::int n from ivr_call_events where call_id = 'zzi-wh-other'`)[0].n === 1);
  await go(B.page, "/ivr/calls");
  check("webhook: Bala sees the new call in My calls", (await rows(B.page)) === 3);
  await go(A.page, "/ivr/calls");
  check("webhook: Asha does not", !(await mainText(A.page)).includes("ZZI Member B1"));
  check("cron: no secret is refused (401)", (await fetch(`${BASE}/api/cron/ivr-sync`)).status === 401);
  check("cron: a wrong secret is refused (401)", (await fetch(`${BASE}/api/cron/ivr-sync`, { headers: { authorization: "Bearer nope" } })).status === 401);
  if (CRON_SECRET) {
    const c = await fetch(`${BASE}/api/cron/ivr-sync?force=1`, { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    check("cron: the right secret runs a sync (mock)", c.status === 200, c.status);
  } else check("cron: CRON_SECRET is set for the test", false);
  const tick = await api(A.page, "/api/ivr/sync/tick", "POST");
  check("heartbeat: an agent's tab may trigger the (throttled) sync", tick.status === 200, tick.status);

  section("import a calling list");
  const csv = ["Member Name,Mobile,Email,Organisation,Call Category,Agent Email", "ZZI Imported One,9111100011,one@example.com,ZZI Co,Membership,zzi-agent-a@gmail.com", "ZZI Imported Two,9111100012,,ZZI Co,Hall booking,"].join("\n") + "\n";
  const csvPath = path.join(os.tmpdir(), `zzi-import-${Date.now()}.csv`);
  fs.writeFileSync(csvPath, csv);
  await go(M.page, "/ivr/admin/import");
  await M.page.locator("#import-file").setInputFiles(csvPath);
  await M.page.getByRole("button", { name: "Allocate members" }).click();
  await M.page.getByRole("button", { name: "Continue" }).click();
  await M.page.getByRole("button", { name: "Save members" }).click();
  const imported = await poll(async () => { const r = await sql`select name, owner_id, phone from ivr_leads where name like 'ZZI Imported%' order by name`; return r.length === 2 ? r : null; });
  check("import: both rows saved as members, phone numbers in +91 form", imported && imported[0].phone === "+919111100011" && imported[1].phone === "+919111100012", JSON.stringify(imported));
  check("import: the row naming Asha's email is hers; the other is unassigned (no rule)", imported?.[0].owner_id === agentA.id && imported?.[1].owner_id === null, JSON.stringify(imported));
  check("import: the batch is listed with who uploaded it", (await sql`select count(*)::int n from ivr_import_batches where uploaded_by = ${admin.id}`)[0].n === 1);
  fs.rmSync(csvPath, { force: true });
  await go(A.page, "/ivr?show=all");
  check("import: Asha's new member is in her queue", (await mainText(A.page)).includes("ZZI Imported One"));
  const sample = await api(M.page, "/api/ivr/import/sample");
  check("import: the sample CSV downloads for an admin", sample.status === 200 && sample.type.startsWith("text/csv"));

  section("analytics, reports, categories, agents");
  await go(M.page, "/ivr/admin/analytics");
  check("analytics: the page opens with its charts", (await M.page.getByRole("heading", { name: "Analytics" }).count()) >= 1);
  const numbers = await api(M.page, "/api/ivr/analytics/numbers?range=week");
  check("analytics: the answer-rate-by-number CSV downloads", numbers.status === 200 && numbers.type.startsWith("text/csv"));
  const pdf = await M.page.evaluate(async () => { const r = await fetch("/api/ivr/reports/pdf"); const b = await r.arrayBuffer(); return { status: r.status, type: r.headers.get("content-type"), head: String.fromCharCode(...new Uint8Array(b.slice(0, 4))) }; });
  check("reports: an IVR admin downloads the PDF report", pdf.status === 200 && pdf.type === "application/pdf" && pdf.head === "%PDF", JSON.stringify(pdf));
  await go(M.page, "/ivr/admin");
  check("team overview: the agent table lists both agents", (await mainText(M.page)).includes("ZZI Agent Asha") && (await mainText(M.page)).includes("ZZI Agent Bala"));
  await go(M.page, "/ivr/admin/categories");
  const catValues = await M.page.locator("main input").evaluateAll((els) => els.map((e) => e.value));
  check("categories: the page opens for an IVR admin, with the default categories", catValues.includes("Proforma invoice") && catValues.includes("Hall booking"), catValues.slice(0, 6).join("|"));
  await M.page.getByLabel("Minimum gap between tries (hours)").fill("3");
  await M.page.locator("form:has(input[inputmode=numeric])").last().getByRole("button", { name: "Save" }).click();
  check("categories: an IVR admin changes the retry rule (it is put back at the end)", await poll(async () => (await sql`select value from ivr_settings where key = 'retry'`)[0]?.value?.minGapHours === 3));
  await go(M.page, "/ivr/admin/agents");
  check("agents: everyone given IVR-CRM is listed (Asha, Bala, the admin), nobody else", (await M.page.locator("[data-agent-row]").count()) >= 3
    && !(await mainText(M.page)).includes("ZZI Outsider") && !(await mainText(M.page)).includes("ZZI Admin Only"));
  const rowB = M.page.locator(`[data-agent-row="${agentB.id}"]`);
  await rowB.getByRole("button", { name: "Edit" }).click();
  await rowB.getByLabel(/Softphone extension/).fill("060123456");
  await rowB.getByRole("button", { name: "Save" }).click();
  check("agents: an admin sets Bala's softphone extension", await poll(async () => (await sql`select softphone_extension from ivr_agent_profiles where user_id = ${agentB.id}`)[0]?.softphone_extension === "060123456"));
  await go(A.page, "/ivr/connections");
  check("connections: the agent's Connections page opens", (await A.page.getByRole("heading", { name: "Connections" }).count()) >= 1);

  check("no page errors in the browser", pageErrors.length === 0, pageErrors.join(" | "));
} catch (e) {
  console.error(e);
  exitCode = 1;
}

await browser.close();
// Put the retry rule back as it was, then remove everything this test made, and prove nothing else changed.
if (retryBefore === null) await sql`delete from ivr_settings where key = 'retry'`;
else await sql`update ivr_settings set value = ${JSON.stringify(retryBefore)}::jsonb where key = 'retry'`;
await removeTestData();
check("cleanup: every other ivr_ member and call is exactly as before", (await snap()) === before);
check("cleanup: every category that was there before is unchanged", await sameCategories());
check("cleanup: no ZZI people or applications are left", (await sql`select count(*)::int n from users where email like 'zzi-%'`)[0].n === 0 && (await sql`select count(*)::int n from apps where name like 'ZZI%'`)[0].n === 0);
if (exitCode) process.exit(exitCode);
finish();
