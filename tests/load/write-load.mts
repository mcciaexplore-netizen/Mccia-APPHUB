/**
 * Write-path and database load, at library level: concurrent access changes, a 200-person bulk assignment, a 500-row import, and reads
 * and writes at the same time. (The writes are Next.js server actions, which cannot be driven by plain HTTP without their build-specific
 * identifiers, so this calls the same server code the actions call.)
 *
 *   LOAD_DB_CONFIRM=yes LOAD_DATABASE_URL=postgres://postgres@127.0.0.1:5432/loadtest DB_POOL_MAX=5 \
 *   npx tsx --require ./tests/stub-server-only.cjs tests/load/write-load.mts [--concurrency 200] [--out result.json]
 * Run tests/load/seed.mts first. Same safety guards as the seed: a scratch database only, never Neon.
 */
import { writeFileSync } from "node:fs";

const url = process.env.LOAD_DATABASE_URL;
const name = url ? new URL(url).pathname.slice(1) : "";
if (process.env.LOAD_DB_CONFIRM !== "yes" || !url) { console.error("Set LOAD_DATABASE_URL and LOAD_DB_CONFIRM=yes."); process.exit(2); }
if (/neon\.tech/i.test(url)) { console.error("Refusing a Neon address."); process.exit(2); }
if (!/(load|scratch|test)/i.test(name)) { console.error(`Refusing database "${name}": its name must contain load, scratch or test.`); process.exit(2); }
process.env.DATABASE_URL = url;
process.env.DB_DRIVER = "pg";
process.env.APP_BASE_URL = "http://localhost:3999";
delete process.env.SMTP_HOST; delete process.env.SMTP_FROM; delete process.env.ALLOWED_EMAIL_DOMAIN;
const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const CONC = Number(arg("concurrency", "200"));

const { count, eq, inArray, like } = await import("drizzle-orm");
const { db } = await import("../../src/db");
const S = await import("../../src/db/schema");
const { applyAccess } = await import("../../src/lib/access-ops");
const { checkImport, commitBatch } = await import("../../src/lib/import");
const { listPeople, parsePeopleFilters } = await import("../../src/lib/people");
type ImportRow = import("../../src/lib/import-parse").ImportRow;

const pct = (a: number[], p: number) => (a.length ? Math.round([...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] * 10) / 10 : null);
const stats = (ms: number[], errors: number, wall: number) => ({ n: ms.length + errors, errors, p50: pct(ms, 50), p95: pct(ms, 95), p99: pct(ms, 99), max: pct(ms, 100), wallMs: Math.round(wall), perSecond: Math.round(((ms.length + errors) / (wall / 1000)) * 10) / 10 });
async function timed(fn: () => Promise<unknown>): Promise<{ ms: number; ok: boolean }> {
  const t = performance.now();
  try { await fn(); return { ms: performance.now() - t, ok: true }; } catch (e) { console.error("  error:", (e as Error).message.slice(0, 120)); return { ms: performance.now() - t, ok: false }; }
}
async function burst(n: number, make: (i: number) => () => Promise<unknown>) {
  const t = performance.now();
  const r = await Promise.all(Array.from({ length: n }, (_, i) => timed(make(i))));
  return stats(r.filter((x) => x.ok).map((x) => x.ms), r.filter((x) => !x.ok).length, performance.now() - t);
}

const ids = (await db.select({ id: S.users.id }).from(S.users).where(like(S.users.email, "zz-load-%"))).map((r) => r.id);
const appIds = (await db.select({ id: S.apps.id }).from(S.apps).where(like(S.apps.name, "ZL %"))).map((r) => r.id);
if (ids.length < 200 || appIds.length < 10) { console.error("Run tests/load/seed.mts first (needs 200+ people and 10+ applications)."); process.exit(2); }
await db.delete(S.users).where(eq(S.users.email, "zz-load-admin@example.com"));
const [admin] = await db.insert(S.users).values({ name: "ZL Admin", email: "zz-load-admin@example.com", role: "head_admin", passwordHash: "x", signupSource: "load" }).returning();
const rnd = (n: number) => Math.floor(Math.random() * n);
const sample = <T,>(arr: T[], k: number) => [...arr].sort(() => Math.random() - 0.5).slice(0, k);
const result: Record<string, unknown> = { concurrency: CONC, poolMax: Number(process.env.DB_POOL_MAX) || 5, database: name };

try {
  // W1: many people changing one person's access at the same moment
  const picked = sample(ids, CONC);
  const want = new Map(picked.map((id) => [id, sample(appIds, 3)]));
  result.w1_concurrentAccessChanges = await burst(CONC, (i) => () => applyAccess(admin, { userIds: [picked[i]], appIds: want.get(picked[i])!, mode: "add", source: "load" }));
  const have = await db.select({ u: S.userAppAccess.userId, a: S.userAppAccess.appId }).from(S.userAppAccess).where(inArray(S.userAppAccess.userId, picked));
  const got = new Map<string, Set<string>>(); for (const h of have) (got.get(h.u) ?? got.set(h.u, new Set()).get(h.u)!).add(h.a);
  result.w1_finalStateCorrect = picked.every((id) => want.get(id)!.every((a) => got.get(id)?.has(a)));

  // W2: a 200-person, 10-application bulk assignment in one call
  const tenApps = sample(appIds, 10);
  const t2 = performance.now(); const bulk = await applyAccess(admin, { userIds: sample(ids, 200), appIds: tenApps, mode: "add", source: "load" });
  result.w2_bulkAssign200x10 = { ms: Math.round(performance.now() - t2), changed: bulk.changed.length };

  // W3: a 500-row import, checked, created in batches of 25, then run again
  await db.delete(S.users).where(like(S.users.email, "zz-load-import-%"));
  const rows: ImportRow[] = Array.from({ length: 500 }, (_, i) => ({
    row: i + 1, name: `ZL Import ${i}`, email: `zz-load-import-${i}@example.com`, branch: `ZL Branch ${(i % 4) + 1}`, department: `ZL Dept ${(i % 6) + 1}`, team: `ZL Team ${(i % 12) + 1}`,
    manager: i % 5 === 0 ? "" : "zz-load-0@example.com", role: "", applications: `ZL App ${(i % 40) + 1}, ZL App ${((i + 7) % 40) + 1}`, designation: "Imported",
  }));
  rows[2].branch = "ZL Branch 99"; // a few bad rows, as in real files
  rows[3].email = "not-an-email";
  const tc = performance.now(); const chk = await checkImport(admin, rows, { existing: "skip" }); const checkMs = Math.round(performance.now() - tc);
  const tr = performance.now(); let created = 0;
  for (let i = 0; i < chk.order.length; i += 25) created += (await commitBatch(admin, rows, { existing: "skip" }, chk.order.slice(i, i + 25), { invite: true })).filter((r) => r.outcome === "created").length;
  const importMs = Math.round(performance.now() - tr);
  const before = (await db.select({ n: count() }).from(S.users).where(like(S.users.email, "zz-load-import-%")))[0].n;
  const tr2 = performance.now(); let again = 0;
  for (let i = 0; i < chk.order.length; i += 25) again += (await commitBatch(admin, rows, { existing: "skip" }, chk.order.slice(i, i + 25), { invite: true })).filter((r) => r.outcome === "created").length;
  const after = (await db.select({ n: count() }).from(S.users).where(like(S.users.email, "zz-load-import-%")))[0].n;
  result.w3_import500 = { checkMs, createMs: importMs, created, flaggedInvalid: chk.summary.invalid + chk.summary.needsCorrection, secondRunMs: Math.round(performance.now() - tr2), secondRunCreated: again, duplicatesAfterRetry: after - before };

  // W4: many people searching the directory at once
  const filterSets = [{}, { q: "ZL Person 1" }, { role: "dept_lead" }, { status: "active" }, { sort: "lastLogin" }, { q: "zz-load-3" }];
  result.w4_concurrentDirectoryReads = await burst(CONC, (i) => () => listPeople(admin, parsePeopleFilters({ ...(filterSets[i % filterSets.length] as Record<string, string>), page: String(1 + (i % 5)) })));

  // W5: reads and writes at the same moment (half and half)
  const t5 = performance.now();
  const mixed = await Promise.all(Array.from({ length: CONC }, (_, i) => timed(i % 2 === 0
    ? () => listPeople(admin, parsePeopleFilters({ q: "ZL Person", page: String(1 + (i % 8)) }))
    : () => applyAccess(admin, { userIds: [ids[(i * 7) % ids.length]], appIds: sample(appIds, 2), mode: i % 4 === 1 ? "add" : "remove", source: "load" }))));
  result.w5_mixedReadsAndWrites = stats(mixed.filter((x) => x.ok).map((x) => x.ms), mixed.filter((x) => !x.ok).length, performance.now() - t5);
} finally {
  await db.delete(S.users).where(like(S.users.email, "zz-load-import-%"));
  await db.delete(S.users).where(eq(S.users.email, "zz-load-admin@example.com"));
  await db.delete(S.accessAudit).where(like(S.accessAudit.actorName, "ZL %"));
}
console.log(JSON.stringify(result, null, 2));
const out = arg("out", "");
if (out) writeFileSync(out, JSON.stringify(result, null, 2));
process.exit(0);
