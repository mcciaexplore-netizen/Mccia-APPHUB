/**
 * Integration test of single sign-on against a real Postgres and a real running hub: /launch/<slug> (who gets a token, who is refused, what the
 * page and its headers look like, what is logged), the per-application role, and the application form's actions.
 *
 * It starts `next dev` itself on port 3998 (with every setting given explicitly, so no .env file decides anything), makes sign-in cookies with the
 * hub's own sign() and userFingerprint(), and talks to it over HTTP. A tiny stand-in for the MCCIA Search app listens on 127.0.0.1:3991 and
 * checks the token the way the real one will.
 *
 * It WRITES to the database, so point it at a scratch database, never the live one:
 *   INTEGRATION_DB_CONFIRM=yes INTEGRATION_DATABASE_URL=postgres://postgres@127.0.0.1:55432/hub_scratch npm run test:sso
 * All migrations must be applied first. Everything it creates is named "ZZSSO" / "zz-sso-" and is removed when it finishes. It refuses a Neon
 * address and any database that is not on this machine.
 */
import { generateKeyPairSync } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const url = process.env.INTEGRATION_DATABASE_URL;
if (process.env.INTEGRATION_DB_CONFIRM !== "yes" || !url) {
  console.error("Set INTEGRATION_DATABASE_URL to a scratch database and INTEGRATION_DB_CONFIRM=yes (this test writes to it).");
  process.exit(2);
}
const dbHost = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
if (/neon\.tech/i.test(url) || !["localhost", "127.0.0.1"].includes(dbHost)) {
  console.error("Refusing: the database must be a scratch Postgres on this machine (localhost or 127.0.0.1), never a Neon or other remote address.");
  process.exit(2);
}
console.log(`Scratch database at ${dbHost}:${new URL(url).port || "5432"}`);

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3998;
const BASE = `http://127.0.0.1:${PORT}`;
const APP_PORT = 3991; // the stand-in application
const APP_ORIGIN = `http://127.0.0.1:${APP_PORT}`;
const SECRET = "sso-integration-secret-0123456789abcdef";
const HEAD_EMAIL = "zz-sso-head@test.local";
const HEAD_PASSWORD = "Head-pass-1!";

// The settings for this test process AND for the hub it starts. Nothing is read from a .env file.
process.env.DATABASE_URL = url;
process.env.DB_DRIVER = "pg";
process.env.AUTH_SECRET = SECRET;
process.env.SUPPORT_ADMIN_EMAIL = HEAD_EMAIL;
process.env.SUPPORT_ADMIN_NAME = "ZZSSO Head";
process.env.SUPPORT_ADMIN_PASSWORD = HEAD_PASSWORD;

const { and, eq, like, or, sql } = await import("drizzle-orm");
const { db } = await import("../src/db");
const S = await import("../src/db/schema");
const { sign } = await import("../src/lib/session");
const { userFingerprint } = await import("../src/lib/auth");
const { hashPassword } = await import("../src/lib/passwords");
const { verifySsoToken } = await import("../src/lib/sso");
const { applyAccess, applyAppUserChange, applyAppUserRole } = await import("../src/lib/access-ops");
const { UserError } = await import("../src/lib/user-error");
type User = typeof S.users.$inferSelect;

let ok = 0, bad = 0;
const check = (name: string, pass: unknown, extra: unknown = "") => {
  if (pass) ok++; else bad++;
  console.log(pass ? "PASS" : "FAIL", name, pass || extra === "" ? "" : `\n   -> ${typeof extra === "string" ? extra : JSON.stringify(extra)}`);
};

// ---------------------------------------------------------------- the data
const cleanup = async () => {
  const people = await db.select({ id: S.users.id }).from(S.users).where(like(S.users.email, "zz-sso-%"));
  for (const p of people) await db.delete(S.activityLog).where(eq(S.activityLog.userId, p.id));
  await db.delete(S.accessAudit).where(or(like(S.accessAudit.actorName, "ZZSSO%"), like(S.accessAudit.targetLabel, "ZZSSO%"))!);
  const appRows = await db.select({ id: S.apps.id }).from(S.apps).where(like(S.apps.name, "ZZSSO%"));
  for (const a of appRows) await db.delete(S.activityLog).where(eq(S.activityLog.appId, a.id));
  await db.delete(S.apps).where(like(S.apps.name, "ZZSSO%"));
  await db.delete(S.departments).where(like(S.departments.name, "ZZSSO%"));
  await db.delete(S.users).where(like(S.users.email, "zz-sso-%"));
};
await cleanup();

const passwordHash = await hashPassword("Member-pass-1!");
const mkUser = async (key: string, role: User["role"], extra: Partial<typeof S.users.$inferInsert> = {}): Promise<User> => {
  const [u] = await db.insert(S.users).values({ name: `ZZSSO ${key}`, email: `zz-sso-${key}@test.local`, role, passwordHash, status: "approved", isActive: true, mustChangePassword: false, ...extra }).returning();
  return u;
};
const head = await mkUser("head", "head_admin", { email: HEAD_EMAIL, passwordHash: null });
const normal = await mkUser("normal", "member");
const appAdmin = await mkUser("appadmin", "member");
const noAccess = await mkUser("noaccess", "member");
const mustChange = await mkUser("mustchange", "member", { mustChangePassword: true });
const inactive = await mkUser("inactive", "member", { isActive: false });
const hubAdmin = await mkUser("hubadmin", "admin", { adminAreas: ["people", "apps", "import", "org", "audit", "activity"] });
const superAdmin = await mkUser("super", "super_admin");
const teamLead = await mkUser("teamlead", "dept_lead");

const [dept] = await db.insert(S.departments).values({ kind: "application", name: "ZZSSO Dept", icon: "Building2" }).returning();
const [deptOff] = await db.insert(S.departments).values({ kind: "application", name: "ZZSSO Dept Off", icon: "Building2", isActive: false }).returning();
const mkApp = async (key: string, v: Partial<typeof S.apps.$inferInsert> = {}) => {
  const [a] = await db.insert(S.apps).values({
    departmentId: dept.id, name: `ZZSSO ${key}`, icon: "Globe", url: APP_ORIGIN, ssoEnabled: true, ssoSlug: `zz-sso-${key.toLowerCase()}`, ssoCallbackUrl: `${APP_ORIGIN}/api/sso/callback`, ...v,
  }).returning();
  return a;
};
const search = await mkApp("Search");
const plain = await mkApp("Plain", { url: "https://example.com", ssoEnabled: false, ssoSlug: null, ssoCallbackUrl: null });
const down = await mkApp("Down", { status: "unavailable" });
const off = await mkApp("Off", { ssoEnabled: false }); // a slug, but single sign-on switched off
const hidden = await mkApp("Hidden", { isActive: false });
const inOffDept = await mkApp("DeptOff", { departmentId: deptOff.id });
const badCallback = await mkApp("Bad", { ssoCallbackUrl: "https://evil.example.com/steal" }); // stored behind the form's back
const noCallback = await mkApp("NoCb", { ssoCallbackUrl: null });

const grant = (u: User, a: { id: string }, appRole: "user" | "admin" = "user") => db.insert(S.userAppAccess).values({ userId: u.id, appId: a.id, appRole });
for (const a of [search, plain, down, off, hidden, inOffDept, badCallback, noCallback]) await grant(normal, a);
await grant(appAdmin, search, "admin");
await grant(mustChange, search);
await grant(inactive, search);
const roleOf = async (u: User, a: { id: string }) => (await db.select({ r: S.userAppAccess.appRole }).from(S.userAppAccess).where(and(eq(S.userAppAccess.userId, u.id), eq(S.userAppAccess.appId, a.id))))[0]?.r;
const launches = async (u: User, a: { id: string }) => (await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(S.activityLog).where(and(eq(S.activityLog.userId, u.id), eq(S.activityLog.appId, a.id), eq(S.activityLog.action, "launch"))))[0].n;

// ---------------------------------------------------------------- cookies
const session = (u: User, offsetFingerprint = false) => `hub_session=${sign(u.id, offsetFingerprint ? "stale-password" : userFingerprint(u), "session", 3600)}`;
const unlocked = (u: User) => `${session(u)}; hub_admin=${sign(u.id, "", "admin", 1800)}`;

// ---------------------------------------------------------------- the stand-in application (it verifies the token as MCCIA Search will)
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const PRIVATE_B64 = Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" }) as string).toString("base64");
const PUBLIC_PEM = publicKey.export({ type: "spki", format: "pem" }) as string;
const received: { contentType: string | undefined; fields: string[]; verified: { sub: string; role: string } | string }[] = [];
const standIn: Server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    const form = new URLSearchParams(body);
    const token = form.get("token") ?? "";
    let verified: { sub: string; role: string } | string;
    try { const v = await verifySsoToken(token, PUBLIC_PEM, { audience: "zz-sso-search" }); verified = { sub: v.claims.sub, role: v.claims.role }; } catch (e) { verified = (e as { code?: string }).code ?? "error"; }
    received.push({ contentType: req.headers["content-type"], fields: [...form.keys()], verified });
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ verified }));
  });
});
await new Promise<void>((r) => standIn.listen(APP_PORT, "127.0.0.1", r));

// ---------------------------------------------------------------- the hub
let child: ChildProcess | null = null;
let log = "";
const stopHub = async () => {
  if (!child?.pid) return;
  const pid = child.pid;
  const gone = new Promise<void>((r) => child!.once("exit", () => r()));
  try { process.kill(-pid, "SIGTERM"); } catch { /* already gone */ }
  await Promise.race([gone, new Promise((r) => setTimeout(r, 8000))]);
  try { process.kill(-pid, "SIGKILL"); } catch { /* already gone */ }
  child = null;
};
process.on("exit", () => { if (child?.pid) try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ } });
async function startHub(sso: string | undefined) {
  const env: Record<string, string | undefined> = {
    ...process.env, NODE_ENV: undefined, NEXT_TELEMETRY_DISABLED: "1", DATABASE_URL: url, DB_DRIVER: "pg", AUTH_SECRET: SECRET, APP_BASE_URL: BASE,
    SUPPORT_ADMIN_EMAIL: HEAD_EMAIL, SUPPORT_ADMIN_PASSWORD: HEAD_PASSWORD, SUPPORT_ADMIN_NAME: "ZZSSO Head", HEAD_ADMIN_EMAIL: "", HEAD_ADMIN_PASSWORD: "",
    SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "", SMTP_FROM: "", ALLOWED_EMAIL_DOMAIN: "", SSO_PRIVATE_KEY: sso,
  };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  log = "";
  child = spawn(process.execPath, [join(REPO, "node_modules/next/dist/bin/next"), "dev", "-p", String(PORT), "-H", "127.0.0.1"], { cwd: REPO, env: env as NodeJS.ProcessEnv, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout!.on("data", (d) => (log += d));
  child.stderr!.on("data", (d) => (log += d));
  const deadline = Date.now() + 180_000;
  for (;;) {
    try { if ((await fetch(`${BASE}/login`, { signal: AbortSignal.timeout(60_000) })).status === 200) return; } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error("the hub did not start in time:\n" + log.slice(-1500));
    await new Promise((r) => setTimeout(r, 500));
  }
}
const get = (path: string, cookie?: string, headers: Record<string, string> = {}) =>
  fetch(BASE + path, { redirect: "manual", headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers }, signal: AbortSignal.timeout(180_000) });
const tokenIn = (html: string) => /<input type="hidden" name="token" value="([^"]+)">/.exec(html)?.[1] ?? null;
const issued: string[] = [];

/** Calls a server action the way the browser does: a POST to a page that uses it, with the action's id. */
function actionId(name: string): string {
  const m = JSON.parse(readFileSync(join(REPO, ".next/dev/server/server-reference-manifest.json"), "utf8")) as { node: Record<string, { exportedName: string }> };
  const found = Object.entries(m.node).find(([, v]) => v.exportedName === name);
  if (!found) throw new Error(`server action ${name} is not in the manifest yet`);
  return found[0];
}
async function callAction(name: string, page: string, args: unknown[], cookie: string): Promise<{ ok: boolean | null; error: string | null; status: number; location: string | null }> {
  const r = await fetch(BASE + page, { method: "POST", redirect: "manual", headers: { Cookie: cookie, "Next-Action": actionId(name), "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component" }, body: JSON.stringify(args), signal: AbortSignal.timeout(180_000) });
  const text = await r.text();
  const m = /(?:^|\n)[0-9a-f]+:(\{"ok":(?:true|false)[^\n]*\})/.exec(text);
  const parsed = m ? (JSON.parse(m[1]) as { ok: boolean; error?: string }) : null;
  return { ok: parsed ? parsed.ok : null, error: parsed?.error ?? null, status: r.status, location: r.headers.get("location") };
}

const hardStop = setTimeout(async () => { console.error("Test run took too long: stopping."); await stopHub(); process.exit(1); }, 15 * 60 * 1000);
hardStop.unref();

try {
  console.log("Starting the hub on 127.0.0.1:3998 (the first requests compile, so this takes a moment)...");
  await startHub(PRIVATE_B64);

  // ------------------------------------------------ login is required, and the round trip works
  {
    const r = await get("/launch/zz-sso-search");
    check("signed out: /launch/<slug> redirects to /login with next", r.status === 307 && /\/login\?next=%2Flaunch%2Fzz-sso-search$/.test(r.headers.get("location") ?? ""), [r.status, r.headers.get("location")]);
    const page = await (await get("/login?next=%2Flaunch%2Fzz-sso-search")).text();
    check("signed out: the sign-in page keeps the launch address in its form", /name="next" value="\/launch\/zz-sso-search"/.test(page));
    const back = await get("/login?next=%2Flaunch%2Fzz-sso-search", session(normal));
    check("signed in: the sign-in page sends the person straight on to /launch/<slug>", back.status === 307 && /\/launch\/zz-sso-search$/.test(back.headers.get("location") ?? ""), [back.status, back.headers.get("location")]);
    const stale = await get("/launch/zz-sso-search", session(normal, true));
    check("a session whose password has since changed is sent to sign in (with next), nothing issued", stale.status === 302 && /\/login\?next=%2Flaunch%2Fzz-sso-search$/.test(stale.headers.get("location") ?? ""), [stale.status, stale.headers.get("location")]);
    const gone = await get("/launch/zz-sso-search", session(inactive));
    check("a deactivated person is sent to sign in, nothing issued", gone.status === 302 && (gone.headers.get("location") ?? "").includes("/login"), [gone.status]);
  }

  // ------------------------------------------------ a valid launch
  {
    const before = await launches(normal, search);
    const r = await get("/launch/zz-sso-search", session(normal), { "x-forwarded-for": "203.0.113.7" });
    const html = await r.text();
    const token = tokenIn(html);
    check("launch: 200 HTML with exactly one hidden token field", r.status === 200 && (r.headers.get("content-type") ?? "").startsWith("text/html") && !!token && (html.match(/<input /g) ?? []).length === 1, [r.status, r.headers.get("content-type")]);
    if (token) issued.push(token);
    const csp = r.headers.get("content-security-policy") ?? "";
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
    check("launch: headers - no-store, no-referrer, frame denied", r.headers.get("cache-control") === "no-store" && r.headers.get("referrer-policy") === "no-referrer" && r.headers.get("x-frame-options") === "DENY", [r.headers.get("cache-control"), r.headers.get("referrer-policy"), r.headers.get("x-frame-options")]);
    check("launch: CSP is default-src 'none', one nonce for the script and form-action the callback's origin only", csp.startsWith("default-src 'none';") && !!nonce && csp.includes(`form-action ${APP_ORIGIN};`) && !/unsafe-inline|unsafe-eval/.test(csp), csp);
    check("launch: the page posts to the callback and its one script carries the CSP's nonce", html.includes(`<form id="sso" method="post" action="${APP_ORIGIN}/api/sso/callback">`) && !!nonce && html.includes(`<script nonce="${nonce}">`) && (html.match(/<script/g) ?? []).length === 1 && html.includes("<noscript>"));
    check("launch: the token is in the body only: not in the address, a header or a cookie", r.url === `${BASE}/launch/zz-sso-search` && !!token && ![...r.headers.entries()].some(([k, v]) => v.includes(token) || (k === "set-cookie" && v.includes("eyJhbGciOiJFZERTQSI"))));
    let claims: Awaited<ReturnType<typeof verifySsoToken>> | null = null;
    try { claims = token ? await verifySsoToken(token, PUBLIC_PEM, { audience: "zz-sso-search" }) : null; } catch (e) { claims = null; console.log((e as Error).message); }
    check("launch: the token verifies with the public key; header EdDSA/JWT/hub-1", claims?.header.alg === "EdDSA" && claims?.header.typ === "JWT" && claims?.header.kid === "hub-1", claims?.header);
    check("launch: claims match the person (sub, email, name), audience, issuer, role user, 60 s life", claims?.claims.sub === normal.id && claims?.claims.email === normal.email && claims?.claims.name === normal.name
      && claims?.claims.aud === "zz-sso-search" && claims?.claims.iss === "mccia-app-hub" && claims?.claims.role === "user" && (claims?.claims.exp ?? 0) - (claims?.claims.iat ?? 0) === 60 && !!claims?.claims.jti, claims?.claims);
    const rows = await db.select().from(S.activityLog).where(and(eq(S.activityLog.userId, normal.id), eq(S.activityLog.appId, search.id)));
    check("launch: one launch row was written with the person, app, department and IP", rows.length === before + 1 && rows.at(-1)?.action === "launch" && rows.at(-1)?.departmentId === dept.id && rows.at(-1)?.ipAddress === "203.0.113.7", rows.at(-1));
    // Act as the browser: post the form to the callback
    if (token) {
      const posted = await fetch(`${APP_ORIGIN}/api/sso/callback`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }) });
      check("callback: the application receives the token as a form field and accepts it", posted.status === 200 && received.at(-1)?.fields.join() === "token" && JSON.stringify(received.at(-1)?.verified) === JSON.stringify({ sub: normal.id, role: "user" }), received.at(-1));
    }
    const second = tokenIn(await (await get("/launch/zz-sso-search", session(normal))).text());
    if (second) issued.push(second);
    check("launch: two launches give two different tokens (jti)", !!token && !!second && token !== second && (await verifySsoToken(token, PUBLIC_PEM, { audience: "zz-sso-search" })).claims.jti !== (await verifySsoToken(second, PUBLIC_PEM, { audience: "zz-sso-search" })).claims.jti);
  }

  // ------------------------------------------------ roles
  {
    const roleFor = async (u: User, slug = "zz-sso-search") => {
      const r = await get(`/launch/${slug}`, session(u));
      const t = tokenIn(await r.text());
      if (t) issued.push(t);
      return { status: r.status, role: t ? (await verifySsoToken(t, PUBLIC_PEM, { audience: slug })).claims.role : null };
    };
    check("role: a person whose grant is user gets user", (await roleFor(normal)).role === "user");
    check("role: a person whose grant is admin gets admin", (await roleFor(appAdmin)).role === "admin");
    const h = await roleFor(head);
    check("role: the Support Admin gets admin with no grant at all", h.status === 200 && h.role === "admin" && (await db.select().from(S.userAppAccess).where(eq(S.userAppAccess.userId, head.id))).length === 0, h);
    const hd = await roleFor(head, "zz-sso-down");
    check("role: the Support Admin may open an unavailable app (and is admin there too)", hd.status === 200 && hd.role === "admin", hd);
    check("role: a Super Admin without a grant is refused like anyone else (403)", (await get("/launch/zz-sso-search", session(superAdmin))).status === 403);
  }

  // ------------------------------------------------ refusals
  {
    const before = await launches(noAccess, search);
    const r = await get("/launch/zz-sso-search", session(noAccess));
    const html = await r.text();
    check("no access: 403 HTML with exactly the message and a link back to the hub", r.status === 403 && (r.headers.get("content-type") ?? "").startsWith("text/html") && html.includes("You don't have access to this app. Ask your administrator.") && html.includes('<a href="/">'), [r.status, html.slice(0, 300)]);
    check("no access: no token, no form, no launch row", tokenIn(html) === null && !/<form|name="token"|eyJ/.test(html) && (await launches(noAccess, search)) === before);
    check("no access: the refusal is not cached and not framed", r.headers.get("cache-control") === "no-store" && r.headers.get("x-frame-options") === "DENY");

    const body404 = async (path: string, who: User) => { const x = await get(path, session(who)); return { status: x.status, text: await x.text() }; };
    const unknown = await body404("/launch/zz-sso-nothing", normal);
    check("unknown slug: 404 plain text 'Not found'", unknown.status === 404 && unknown.text === "Not found", unknown);
    const offRes = await body404("/launch/zz-sso-off", normal);
    check("slug of an app with single sign-on switched off: 404", offRes.status === 404 && offRes.text === "Not found", offRes);
    const uuidRes = await body404(`/launch/${plain.id}`, normal);
    check("an ordinary (non-SSO) app has no launch address: 404 (its id is not a slug)", uuidRes.status === 404 && uuidRes.text === "Not found", uuidRes);
    const hiddenRes = await body404("/launch/zz-sso-hidden", normal);
    check("inactive app: 404", hiddenRes.status === 404 && hiddenRes.text === "Not found", hiddenRes);
    const deptOffRes = await body404("/launch/zz-sso-deptoff", normal);
    check("app in an inactive department: 404", deptOffRes.status === 404 && deptOffRes.text === "Not found", deptOffRes);
    const shapes = await Promise.all(["Zz-Sso-Search", "zz_sso_search", "a", "zz-sso-search-" + "x".repeat(40), "-x"].map((s) => body404(`/launch/${encodeURIComponent(s)}`, normal)));
    check("a slug that could never exist (capitals, underscore, too short, too long, edge hyphen): 404", shapes.every((x) => x.status === 404 && x.text === "Not found"), shapes.map((x) => x.status));
    check("none of those 404s logged a launch", (await launches(normal, hidden)) === 0 && (await launches(normal, off)) === 0 && (await launches(normal, inOffDept)) === 0);

    const mc = await get("/launch/zz-sso-search", session(mustChange));
    check("temporary password: redirected to /change-password, nothing issued or logged", mc.status === 302 && (mc.headers.get("location") ?? "").endsWith("/change-password") && (await launches(mustChange, search)) === 0, [mc.status, mc.headers.get("location")]);

    const downBefore = await launches(normal, down);
    const d = await get("/launch/zz-sso-down", session(normal));
    const dt = await d.text();
    check("unavailable app: 503 for an ordinary person, with Retry-After, no token, no launch row", d.status === 503 && d.headers.get("retry-after") === "600" && tokenIn(dt) === null && (await launches(normal, down)) === downBefore, [d.status, dt]);

    const bcBefore = await launches(normal, badCallback);
    const bc = await get("/launch/zz-sso-bad", session(normal));
    const bct = await bc.text();
    check("a stored callback on another site is refused at launch: 500 'not set up', no token, no launch row", bc.status === 500 && bct.includes("Single sign-on is not set up. Tell your administrator.") && tokenIn(bct) === null && (await launches(normal, badCallback)) === bcBefore, [bc.status, bct]);
    const nc = await get("/launch/zz-sso-nocb", session(normal));
    check("no callback stored: 500 'not set up', no token", nc.status === 500 && tokenIn(await nc.text()) === null);
  }

  // ------------------------------------------------ /go and the cards
  {
    const goSso = await get(`/go/${search.id}`, session(normal));
    check("/go/<id> of an SSO app redirects to /launch/<slug>, and logs nothing itself", goSso.status === 302 && (goSso.headers.get("location") ?? "").endsWith("/launch/zz-sso-search"), [goSso.status, goSso.headers.get("location")]);
    const goNo = await get(`/go/${search.id}`, session(noAccess));
    check("/go/<id> for someone without the app is still the plain 404", goNo.status === 404);
    const plainBefore = await launches(normal, plain);
    const goPlain = await get(`/go/${plain.id}`, session(normal));
    check("/go/<id> of an ordinary app is unchanged: logs a launch and redirects to its address", goPlain.status === 302 && goPlain.headers.get("location") === "https://example.com/" && (await launches(normal, plain)) === plainBefore + 1, [goPlain.status, goPlain.headers.get("location")]);
    const home = await (await get("/", session(normal))).text();
    check("cards: the SSO app's card links to /launch/<slug> (new tab), not /go", home.includes('href="/launch/zz-sso-search"') && !home.includes(`/go/${search.id}`) && /<a href="\/launch\/zz-sso-search" target="_blank"/.test(home));
    check("cards: an ordinary app's card still links to /go/<id>", home.includes(`href="/go/${plain.id}"`));
    check("cards: an app with a slug but single sign-on switched off still links to /go/<id>", home.includes(`href="/go/${off.id}"`) && !home.includes("/launch/zz-sso-off"));
    check("cards: the callback address never reaches the page", !home.includes("/api/sso/callback"));
  }

  // ------------------------------------------------ the per-application role, through the real server actions
  {
    await get(`/administrator/access/app/${search.id}`, unlocked(head)); // compiles the page, so the actions are known
    const page = `/administrator/access/app/${search.id}`;
    const attempt = async (u: User) => { const r = await callAction("setAppUserRole", page, [search.id, normal.id, "admin"], unlocked(u)); return r; };
    for (const [label, u] of [["a plain member", normal], ["an Admin with every area", hubAdmin], ["the Super Admin", superAdmin], ["a team manager", teamLead], ["the app's own admin", appAdmin]] as const) {
      const r = await attempt(u);
      check(`setAppUserRole: ${label} is refused ("Not allowed.")`, r.ok === false && r.error === "Not allowed.", r);
    }
    check("setAppUserRole: after all those attempts the role is unchanged and nothing was audited", (await roleOf(normal, search)) === "user" && (await db.select().from(S.accessAudit).where(eq(S.accessAudit.action, "access.role"))).filter((a) => a.targetLabel.startsWith("ZZSSO")).length === 0);
    const anon = await callAction("setAppUserRole", page, [search.id, normal.id, "admin"], session(head));
    check("setAppUserRole: even the Support Admin needs Administrator unlocked", anon.ok !== true && (await roleOf(normal, search)) === "user", anon);

    const good = await callAction("setAppUserRole", page, [search.id, normal.id, "admin"], unlocked(head));
    check("setAppUserRole: the Support Admin can set admin", good.ok === true && (await roleOf(normal, search)) === "admin", good);
    const audit = (await db.select().from(S.accessAudit).where(eq(S.accessAudit.action, "access.role"))).filter((a) => a.targetLabel === normal.name);
    check("setAppUserRole: an access.role audit entry names the actor, the person, the app and from/to", audit.length === 1 && audit[0].actorName === head.name && audit[0].targetId === normal.id && JSON.stringify(audit[0].details) === JSON.stringify({ to: "admin", from: "user", application: search.name }), audit);
    const afterT = tokenIn(await (await get("/launch/zz-sso-search", session(normal))).text());
    if (afterT) issued.push(afterT);
    check("setAppUserRole: the next launch carries role admin for that person", !!afterT && (await verifySsoToken(afterT, PUBLIC_PEM, { audience: "zz-sso-search" })).claims.role === "admin");
    const same = await callAction("setAppUserRole", page, [search.id, normal.id, "admin"], unlocked(head));
    check("setAppUserRole: setting the same role again is fine and writes no second entry", same.ok === true && (await db.select().from(S.accessAudit).where(eq(S.accessAudit.action, "access.role"))).filter((a) => a.targetLabel === normal.name).length === 1, same);
    const noGrant = await callAction("setAppUserRole", page, [search.id, noAccess.id, "admin"], unlocked(head));
    check("setAppUserRole: a person without the app cannot be given a role in it", noGrant.ok === false && /does not have access/.test(noGrant.error ?? ""), noGrant);
    const badRole = await callAction("setAppUserRole", page, [search.id, normal.id, "root"], unlocked(head));
    check("setAppUserRole: only user, admin or super_admin", badRole.ok === false && badRole.error === "Choose User, Admin or Super Admin." && (await roleOf(normal, search)) === "admin", badRole);

    // Re-granting keeps the role
    const addAgain = await callAction("changeAppUsers", page, [search.id, { add: [normal.id], remove: [] }], unlocked(head));
    check("granting an app someone already has (per-app screen) keeps their role", addAgain.ok === true && (await roleOf(normal, search)) === "admin", addAgain);
    await applyAccess(head, { userIds: [normal.id], appIds: [search.id, plain.id], mode: "add", source: "test" });
    check("granting it again by 'add' (people screen) keeps their role", (await roleOf(normal, search)) === "admin");
    await applyAccess(head, { userIds: [normal.id], appIds: [search.id, plain.id, down.id, off.id, hidden.id, inOffDept.id, badCallback.id, noCallback.id], mode: "replace", source: "test" });
    check("'make access exactly this' keeps the role of a grant that stays", (await roleOf(normal, search)) === "admin");
    await applyAppUserChange(head, { appId: search.id, add: [normal.id], remove: [], source: "test" });
    check("per-app add of an existing grant keeps the role", (await roleOf(normal, search)) === "admin");
    await applyAppUserChange(head, { appId: search.id, add: [], remove: [normal.id], source: "test" });
    await applyAppUserChange(head, { appId: search.id, add: [normal.id], remove: [], source: "test" });
    check("a grant taken away and given again starts as user", (await roleOf(normal, search)) === "user");

    // The core function, called directly: it refuses anyone but the Support Admin by itself
    const direct = async (u: User) => { try { await applyAppUserRole(u, { appId: search.id, userId: normal.id, role: "admin" }); return "allowed"; } catch (e) { return e instanceof UserError ? "refused" : "crashed"; } };
    check("applyAppUserRole refuses everyone but the head admin, even called directly", (await Promise.all([normal, hubAdmin, superAdmin, teamLead, appAdmin].map(direct))).every((x) => x === "refused") && (await roleOf(normal, search)) === "user");
    check("applyAppUserRole allows the head admin", (await direct(head)) === "allowed" && (await roleOf(normal, search)) === "admin");
    await applyAppUserRole(head, { appId: search.id, userId: normal.id, role: "user" });
  }

  // ------------------------------------------------ App roles on the Edit form: both lists at once, through the real server action
  {
    await get("/administrator/inventory", unlocked(head));
    const page = "/administrator/inventory";
    const setRoles = (u: User, admins: string[], superAdmins: string[], appId = search.id) => callAction("setAppRoles", page, [appId, { admins, superAdmins }], unlocked(u));
    const roleAudits = async () => (await db.select().from(S.accessAudit).where(eq(S.accessAudit.action, "access.role"))).filter((a) => a.targetLabel.startsWith("ZZSSO")).length;
    const auditsBefore = await roleAudits();
    for (const [label, u] of [["an Admin with the Applications area", hubAdmin], ["the Super Admin", superAdmin], ["a plain member", normal]] as const) {
      const r = await setRoles(u, [normal.id], []);
      check(`setAppRoles: ${label} is refused`, r.ok === false && (await roleOf(normal, search)) === "user", r);
    }
    const both = await setRoles(head, [normal.id], [normal.id]);
    check("setAppRoles: one person in both lists is refused", both.ok === false && /not both/.test(both.error ?? "") && (await roleOf(normal, search)) === "user", both);
    const stranger = await setRoles(head, [noAccess.id], []);
    check("setAppRoles: someone without the application cannot be given a role", stranger.ok === false && /already have this application/.test(stranger.error ?? ""), stranger);
    const notSso = await setRoles(head, [normal.id], [], plain.id);
    check("setAppRoles: an application without single sign-on has no roles", notSso.ok === false && /single sign-on/.test(notSso.error ?? ""), notSso);
    check("setAppRoles: the refusals changed nothing and audited nothing", (await roleAudits()) === auditsBefore && (await roleOf(appAdmin, search)) === "admin");

    const good = await setRoles(head, [normal.id], [appAdmin.id]);
    check("setAppRoles: the Support Admin sets an Admin and a Super Admin in one save; everyone else stays a user", good.ok === true
      && (await roleOf(normal, search)) === "admin" && (await roleOf(appAdmin, search)) === "super_admin" && (await roleOf(mustChange, search)) === "user", good);
    check("setAppRoles: one access.role audit entry per person whose role changed", (await roleAudits()) === auditsBefore + 2);
    const superT = tokenIn(await (await get("/launch/zz-sso-search", session(appAdmin))).text());
    if (superT) issued.push(superT);
    check("setAppRoles: the next launch carries role super_admin for the Super Admin", !!superT && (await verifySsoToken(superT, PUBLIC_PEM, { audience: "zz-sso-search" })).claims.role === "super_admin");
    const again = await setRoles(head, [normal.id], [appAdmin.id]);
    check("setAppRoles: saving the same lists again changes and audits nothing", again.ok === true && (await roleAudits()) === auditsBefore + 2, again);
    const cleared = await setRoles(head, [], []);
    check("setAppRoles: empty lists make everyone a user", cleared.ok === true && (await roleOf(normal, search)) === "user" && (await roleOf(appAdmin, search)) === "user", cleared);
    await setRoles(head, [appAdmin.id], []);
    check("setAppRoles: the app's own admin is back to admin for the rest of the test", (await roleOf(appAdmin, search)) === "admin");
  }

  // ------------------------------------------------ the application form's actions: validation, duplicates, audit
  {
    await get(`/administrator/departments/${dept.id}`, unlocked(head));
    const page = `/administrator/departments/${dept.id}`;
    const form = (over: Record<string, unknown> = {}) => ({ departmentId: dept.id, name: "ZZSSO Created", description: "", url: "https://zz-sso-created.example.com", appToken: "", icon: "Globe", isActive: true, status: "active", ssoEnabled: true, ssoSlug: "zz-sso-created", ssoCallbackUrl: "https://zz-sso-created.example.com/api/sso/callback", ...over });
    const made = await callAction("createApp", page, [form()], unlocked(head));
    const created = (await db.select().from(S.apps).where(eq(S.apps.name, "ZZSSO Created")))[0];
    check("createApp: an application with single sign-on is created with its slug and callback", made.ok === true && created?.ssoEnabled === true && created.ssoSlug === "zz-sso-created" && created.ssoCallbackUrl === "https://zz-sso-created.example.com/api/sso/callback", [made, created]);
    const dup = await callAction("createApp", page, [form({ name: "ZZSSO Created Two" })], unlocked(head));
    check("createApp: a slug already in use gives a plain message naming the other app", dup.ok === false && /already used by ZZSSO Created/.test(dup.error ?? ""), dup);
    const clash = await callAction("createApp", page, [form({ name: "ZZSSO Clash", ssoSlug: "zz-sso-search" })], unlocked(head));
    check("createApp: the same for a slug held by an app created elsewhere", clash.ok === false && /already used by ZZSSO Search/.test(clash.error ?? ""), clash);
    const cross = await callAction("createApp", page, [form({ name: "ZZSSO Cross", ssoSlug: "zz-sso-cross", ssoCallbackUrl: "https://evil.example.com/cb" })], unlocked(head));
    check("createApp: a callback on another site is refused", cross.ok === false && /same site/.test(cross.error ?? ""), cross);
    const noSlug = await callAction("createApp", page, [form({ name: "ZZSSO NoSlug", ssoSlug: "" })], unlocked(head));
    check("createApp: single sign-on on without a slug is refused", noSlug.ok === false && /SSO slug/.test(noSlug.error ?? ""), noSlug);
    const badUrl = await callAction("createApp", page, [form({ name: "ZZSSO HttpCb", ssoSlug: "zz-sso-httpcb", ssoCallbackUrl: "http://zz-sso-created.example.com/cb" })], unlocked(head));
    check("createApp: an http callback (not localhost) is refused", badUrl.ok === false && /https/.test(badUrl.error ?? ""), badUrl);
    const credentials = await callAction("createApp", page, [form({ name: "ZZSSO Cred", ssoSlug: "zz-sso-cred", ssoCallbackUrl: "https://user:pw@zz-sso-created.example.com/cb" })], unlocked(head));
    check("createApp: credentials in the callback are refused", credentials.ok === false && /user name or password/.test(credentials.error ?? ""), credentials);
    check("none of the refused ones created anything", (await db.select().from(S.apps).where(like(S.apps.name, "ZZSSO %"))).filter((a) => ["ZZSSO Created Two", "ZZSSO Clash", "ZZSSO Cross", "ZZSSO NoSlug", "ZZSSO HttpCb", "ZZSSO Cred"].includes(a.name)).length === 0);

    if (created) {
      const edit = await callAction("updateApp", page, [created.id, form({ ssoCallbackUrl: "https://zz-sso-created.example.com/api/v2/callback", ssoSlug: "zz-sso-created-2" })], unlocked(head));
      check("updateApp: the slug and callback can change", edit.ok === true, edit);
      const take = await callAction("updateApp", page, [created.id, form({ ssoSlug: "zz-sso-search" })], unlocked(head));
      check("updateApp: taking another app's slug is refused with the plain message", take.ok === false && /already used by ZZSSO Search/.test(take.error ?? ""), take);
      const off2 = await callAction("updateApp", page, [created.id, form({ ssoEnabled: false, ssoSlug: "zz-sso-created-2", ssoCallbackUrl: "" })], unlocked(head));
      check("updateApp: single sign-on can be switched off, and the launch address is then a 404", off2.ok === true && (await get("/launch/zz-sso-created-2", session(normal))).status === 404, off2);
      const legacy = await callAction("updateApp", page, [created.id, { departmentId: dept.id, name: "ZZSSO Created", description: "", url: "https://zz-sso-created.example.com", appToken: "", icon: "Globe" }], unlocked(head));
      const after = (await db.select().from(S.apps).where(eq(S.apps.id, created.id)))[0];
      check("updateApp: an older form that sends no single sign-on fields leaves them as they were", legacy.ok === true && after.ssoSlug === "zz-sso-created-2" && after.ssoEnabled === false, [legacy, after]);

      const rows = (await db.select().from(S.accessAudit).where(eq(S.accessAudit.targetId, created.id))).map((a) => ({ action: a.action, details: a.details as Record<string, unknown> }));
      const text = JSON.stringify(rows);
      const changed = JSON.stringify(rows.filter((r) => r.action === "app.update").map((r) => r.details.changed));
      check("audit: app.create and app.update entries exist and say what changed", rows.some((r) => r.action === "app.create" && r.details.singleSignOn === true) && changed.includes("SSO callback address") && changed.includes("SSO slug zz-sso-created → zz-sso-created-2") && changed.includes("single sign-on off"), rows);
      check("audit: the callback address is never recorded (not the host, not the path)", !/example\.com|\/api\/|https?:/i.test(text), text);
      const allAudit = JSON.stringify((await db.select().from(S.accessAudit)).filter((a) => a.actorName.startsWith("ZZSSO")));
      check("audit: no entry made in this run contains a token or a key", !issued.some((t) => allAudit.includes(t)) && !allAudit.includes(PRIVATE_B64.slice(0, 24)));
    }
  }

  // ------------------------------------------------ what the server logged
  {
    const leaked = issued.filter((t) => log.includes(t));
    check(`logs: none of the ${issued.length} tokens issued appears in the hub's log`, issued.length >= 5 && leaked.length === 0, leaked.length);
    check("logs: no key material in the hub's log", !log.includes(PRIVATE_B64.slice(0, 24)) && !/BEGIN PRIVATE KEY/.test(log));
    check("logs: no callback address, and no JWT-shaped string at all", !log.includes("/api/sso/callback") && !/eyJhbGciOiJFZERTQSI/.test(log));
  }
  await stopHub();

  // ------------------------------------------------ the key is missing or unusable
  for (const [label, value, code] of [["missing", undefined, "key_missing"], ["not a key", "bm90LWEta2V5LWF0LWFsbA==", "key_invalid"]] as const) {
    await startHub(value);
    const before = await launches(normal, search);
    const r = await get("/launch/zz-sso-search", session(normal));
    const html = await r.text();
    check(`key ${label}: 500 'Single sign-on is not set up. Tell your administrator.', no token`, r.status === 500 && html.includes("Single sign-on is not set up. Tell your administrator.") && tokenIn(html) === null, [r.status, html.slice(0, 200)]);
    check(`key ${label}: only the short code is logged, and no launch row is written`, log.includes(`[sso] launch failed: ${code}`) && (value === undefined || !log.includes(value)) && (await launches(normal, search)) === before);
    const home = await get("/", session(normal));
    check(`key ${label}: the rest of the hub keeps working`, home.status === 200);
    await stopHub();
  }
} catch (e) {
  bad++;
  console.error("FAIL the test run crashed:", e instanceof Error ? e.stack : e);
} finally {
  await stopHub();
  await new Promise<void>((r) => standIn.close(() => r()));
  await cleanup();
}

console.log(`\n${ok}/${ok + bad} single sign-on integration checks passed`);
process.exit(bad ? 1 : 0);
