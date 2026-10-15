/**
 * Load generator for the hub: real HTTP, real cookies, real sign-in. No packages beyond the project's own.
 *
 *   LOAD_BASE_URL=http://localhost:3100 LOAD_DATA=/path/load-data.json LOAD_PG_URL=postgres://postgres@127.0.0.1:5432/loadtest \
 *   LOAD_SERVER_PID=12345 node tests/load/run.mjs --scenario mix --vus 200 --seconds 60 [--ramp 10] [--no-think] [--out result.json]
 *
 * Scenarios:  browse (a signed-in day: hub, department, launch), login (a sign-in storm through the real form), admin (people, dashboard,
 *             profile, audit, inventory), mix (90% browse, 10% admin).
 * Needs the same AUTH_SECRET, HEAD_ADMIN_EMAIL and HEAD_ADMIN_PASSWORD as the server (read from .env.local in the project folder).
 * Run it against a SCRATCH database only: the data comes from tests/load/seed.mts. It refuses any other address than localhost unless
 * LOAD_ALLOW_REMOTE=yes (for a staging deployment you own).
 */
import { createHash, createHmac } from "node:crypto";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const req = createRequire(ROOT + "/package.json");
req("dotenv").config({ path: ROOT + "/.env.local", quiet: true });
const { Client } = req("pg");

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes(`--${k}`);
const BASE = (process.env.LOAD_BASE_URL || "").replace(/\/$/, "");
const DATA = process.env.LOAD_DATA;
const PG = process.env.LOAD_PG_URL;
if (!BASE || !DATA) { console.error("Set LOAD_BASE_URL and LOAD_DATA (the file seed.mts wrote)."); process.exit(2); }
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE) && process.env.LOAD_ALLOW_REMOTE !== "yes") { console.error("Refusing a non-local address. Set LOAD_ALLOW_REMOTE=yes only for a staging deployment you own, never the live site."); process.exit(2); }
const SCENARIO = arg("scenario", "mix");
const VUS = Number(arg("vus", "100"));
const SECONDS = Number(arg("seconds", "60"));
const RAMP = Number(arg("ramp", "10"));
const THINK = flag("no-think") ? [0, 0] : [1000, 3000];
const SERVER_PID = process.env.LOAD_SERVER_PID;
const data = JSON.parse(fs.readFileSync(DATA, "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ------------------------------------------------------------------ cookies, built the same way the site builds them
const secret = process.env.AUTH_SECRET;
if (!secret) { console.error("AUTH_SECRET is not set (put it in .env.local of the project the server runs from)."); process.exit(2); }
const mac = (body) => createHmac("sha256", secret).update(body).digest("base64url");
const sign = (u, f, purpose, ttl) => { const body = Buffer.from(JSON.stringify({ u, f, e: Math.floor(Date.now() / 1000) + ttl, p: purpose })).toString("base64url"); return `${body}.${mac(body)}`; };
const fingerprint = (v) => createHash("sha256").update(v).digest("base64url").slice(0, 12);

const pg = new Client({ connectionString: PG });
await pg.connect();
const loadUsers = (await pg.query("select id, email, password_hash from users where email like 'zz-load-%' order by email")).rows;
if (loadUsers.length === 0) { console.error("No zz-load-* users found. Run tests/load/seed.mts first."); process.exit(2); }
const adminEmail = (process.env.HEAD_ADMIN_EMAIL || "").trim().toLowerCase();
const adminRow = (await pg.query("select id from users where email = $1", [adminEmail])).rows[0];
const adminCookie = adminRow ? `hub_session=${sign(adminRow.id, fingerprint(`env:${process.env.HEAD_ADMIN_PASSWORD ?? ""}`), "session", 3600)}; hub_admin=${sign(adminRow.id, "", "admin", 1800)}` : null;
const userCookie = (u) => `hub_session=${sign(u.id, fingerprint(u.password_hash), "session", 3600)}`;

// ------------------------------------------------------------------ measuring
const samples = [];
let measuring = false;
async function hit(label, url, { cookie, method = "GET", body, headers = {}, expect = [200], manual = true, keepText = false } = {}) {
  const t0 = performance.now();
  let status = 0, ok = false, err = null, res = null, text = "";
  try {
    res = await fetch(BASE + url, { method, body, redirect: manual ? "manual" : "follow", signal: AbortSignal.timeout(30000), headers: { ...(cookie ? { cookie } : {}), ...headers } });
    status = res.status;
    const buf = await res.arrayBuffer(); // read it all, as a browser would
    if (keepText) text = Buffer.from(buf).toString("utf8");
    ok = expect.includes(status);
  } catch (e) { err = e.name === "TimeoutError" ? "timeout" : "network"; }
  const ms = performance.now() - t0;
  if (measuring) samples.push({ label, ms, status, ok, err, at: Date.now() });
  return { res, status, ok, text };
}

async function login(u) {
  const page = await hit("login:page", "/login", { expect: [200], keepText: true });
  if (!page.ok) return null;
  const field = /name="(\$ACTION_ID_[^"]+)"/.exec(page.text)?.[1]; // the sign-in form carries its server action's identifier
  if (!field) return null;
  const form = new FormData(); // a browser submits this form as multipart, and so does this
  for (const [k, v] of Object.entries({ [field]: "", email: u.email, password: data.password, next: "/" })) form.append(k, v);
  const r = await hit("login:submit", "/login", { method: "POST", body: form, expect: [303, 302, 307] });
  const sess = (r.res?.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("hub_session="));
  if (r.ok && !sess && measuring) { const last = samples[samples.length - 1]; last.ok = false; last.err = "no-session"; }
  return sess ? sess.split(";")[0] : null;
}

async function browseLoop(u, cookieIn, end) {
  let cookie = cookieIn;
  while (Date.now() < end) {
    await hit("home", "/", { cookie }); await sleep(rnd(...THINK));
    if (Date.now() >= end) break;
    await hit("department", `/?d=${pick(data.departmentIds)}`, { cookie }); await sleep(rnd(...THINK));
    if (Date.now() >= end) break;
    await hit("launch", `/go/${pick(data.appIds)}`, { cookie, expect: [302, 404] }); await sleep(rnd(...THINK)); // 404 = this person was not given that app: correct, and still a real permission check
  }
}
async function adminLoop(end) {
  const p = pick(data.userIds);
  while (Date.now() < end) {
    await hit("admin:dashboard", "/administrator", { cookie: adminCookie }); await sleep(rnd(...THINK));
    await hit("admin:directory", "/administrator/users?sort=name", { cookie: adminCookie }); await sleep(rnd(...THINK));
    await hit("admin:search", `/administrator/users?q=${encodeURIComponent("ZL Person " + Math.floor(Math.random() * 400))}`, { cookie: adminCookie }); await sleep(rnd(...THINK));
    await hit("admin:filter", `/administrator/users?team=&role=dept_lead&status=active`, { cookie: adminCookie }); await sleep(rnd(...THINK));
    await hit("admin:profile", `/administrator/users/${p}`, { cookie: adminCookie }); await sleep(rnd(...THINK));
    await hit("admin:audit", "/administrator/users/audit", { cookie: adminCookie }); await sleep(rnd(...THINK));
    await hit("admin:inventory", "/administrator/inventory", { cookie: adminCookie }); await sleep(rnd(...THINK));
  }
}

// ------------------------------------------------------------------ resource sampling
const proc = [], dbconn = [], probe = [];
let stop = false;
async function sampler() {
  const probeClient = new Client({ connectionString: PG });
  await probeClient.connect();
  const uid = data.userIds[0];
  while (!stop) {
    if (SERVER_PID) await new Promise((r) => execFile("ps", ["-o", "%cpu=,rss=", "-p", SERVER_PID], (e, out) => { const [cpu, rss] = (out || "").trim().split(/\s+/).map(Number); if (!e && Number.isFinite(rss)) proc.push({ cpu, rssMb: rss / 1024 }); r(); }));
    try {
      const c = await probeClient.query("select count(*)::int n from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()");
      dbconn.push(c.rows[0].n);
      const t = performance.now();
      await probeClient.query("select a.id, a.name from apps a join user_app_access g on g.app_id = a.id where g.user_id = $1 and a.is_active", [uid]);
      probe.push(performance.now() - t);
    } catch { /* the sampler must never stop the test */ }
    await sleep(1000);
  }
  await probeClient.end();
}

const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] * 10) / 10; };
const summarise = (list, seconds) => ({
  requests: list.length, perSecond: Math.round((list.length / seconds) * 10) / 10,
  p50: pct(list.map((s) => s.ms), 50), p95: pct(list.map((s) => s.ms), 95), p99: pct(list.map((s) => s.ms), 99), max: pct(list.map((s) => s.ms), 100),
  errors: list.filter((s) => !s.ok).length, errorRate: list.length ? Math.round((list.filter((s) => !s.ok).length / list.length) * 10000) / 100 : 0,
  timeouts: list.filter((s) => s.err === "timeout").length, serverErrors: list.filter((s) => s.status >= 500).length,
});

// ------------------------------------------------------------------ run
console.log(`Scenario ${SCENARIO}: ${VUS} virtual users, ${SECONDS}s after a ${RAMP}s ramp, think ${THINK[0]}-${THINK[1]} ms, against ${BASE}`);
const sampling = sampler();
const startedAt = Date.now();
const rampEnd = startedAt + RAMP * 1000;
const end = rampEnd + SECONDS * 1000;
const admins = SCENARIO === "admin" ? VUS : SCENARIO === "mix" ? Math.max(1, Math.round(VUS * 0.1)) : 0;
if (admins > 0 && !adminCookie) { console.error("The main admin has no row yet: sign in once as the admin so the load test can act as them."); process.exit(2); }

if (SCENARIO === "login") {
  measuring = true;
  const window = 20000;
  await Promise.all(Array.from({ length: VUS }, async (_, i) => {
    await sleep((i / VUS) * window);
    const u = loadUsers[i % loadUsers.length];
    const cookie = await login(u);
    if (cookie) { await hit("home", "/", { cookie }); await hit("launch", `/go/${pick(data.appIds)}`, { cookie, expect: [302, 404] }); }
  }));
} else {
  setTimeout(() => { measuring = true; }, RAMP * 1000);
  await Promise.all(Array.from({ length: VUS }, async (_, i) => {
    await sleep((i / VUS) * RAMP * 1000);
    if (i < admins) return adminLoop(end);
    const u = loadUsers[i % loadUsers.length];
    return browseLoop(u, userCookie(u), end);
  }));
}
measuring = false; stop = true; await sampling;
const seconds = SCENARIO === "login" ? Math.max(1, (Date.now() - startedAt) / 1000) : SECONDS;

const labels = [...new Set(samples.map((s) => s.label))].sort();
const result = {
  scenario: SCENARIO, vus: VUS, seconds, think: THINK, startedAt: new Date(startedAt).toISOString(),
  overall: summarise(samples.filter((s) => s.label !== "login:page"), seconds),
  byLabel: Object.fromEntries(labels.map((l) => [l, summarise(samples.filter((s) => s.label === l), seconds)])),
  server: proc.length ? { cpuAvgPct: Math.round(proc.reduce((a, b) => a + b.cpu, 0) / proc.length), cpuMaxPct: Math.max(...proc.map((p) => p.cpu)), rssStartMb: Math.round(proc[0].rssMb), rssEndMb: Math.round(proc.at(-1).rssMb), rssMaxMb: Math.round(Math.max(...proc.map((p) => p.rssMb))), rssGrowthPct: Math.round(((proc.at(-1).rssMb - proc[0].rssMb) / proc[0].rssMb) * 100) } : null,
  database: { connectionsMax: dbconn.length ? Math.max(...dbconn) : null, probeP50: pct(probe, 50), probeP95: pct(probe, 95), probeMax: pct(probe, 100) },
};
console.log(JSON.stringify(result, null, 2));
const out = arg("out");
if (out) fs.writeFileSync(out, JSON.stringify(result, null, 2));
await pg.end();
process.exit(0);
