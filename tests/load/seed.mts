/**
 * Fills a SCRATCH database with load-test data, or removes it again. Everything is named "zz-load-*" / "ZL *".
 *   LOAD_DB_CONFIRM=yes LOAD_DATABASE_URL=postgres://postgres@127.0.0.1:5432/loadtest LOAD_OUT=/tmp/load-data.json npx tsx --require ./tests/stub-server-only.cjs tests/load/seed.mts [--people 400] [--clean]
 * It refuses a database whose name does not contain "load", "scratch", "test" or "apprtest", and refuses Neon addresses outright.
 */
import { writeFileSync } from "node:fs";

const url = process.env.LOAD_DATABASE_URL;
const name = url ? new URL(url).pathname.slice(1) : "";
if (process.env.LOAD_DB_CONFIRM !== "yes" || !url) { console.error("Set LOAD_DATABASE_URL and LOAD_DB_CONFIRM=yes."); process.exit(2); }
if (/neon\.tech/i.test(url)) { console.error("Refusing a Neon address: load tests never run against hosted databases from here."); process.exit(2); }
if (!/(load|scratch|test)/i.test(name)) { console.error(`Refusing database "${name}": its name must contain load, scratch or test.`); process.exit(2); }
process.env.DATABASE_URL = url;
process.env.DB_DRIVER = "pg";

const arg = (k: string, d: number) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? Number(process.argv[i + 1]) : d; };
const PEOPLE = arg("people", 400);
const { like, sql } = await import("drizzle-orm");
const { db } = await import("../../src/db");
const S = await import("../../src/db/schema");
const { hashPassword } = await import("../../src/lib/passwords");
export const LOAD_PASSWORD = "Load-test-pass-1";

async function clean() {
  await db.delete(S.activityLog).where(sql`${S.activityLog.userId} in (select id from users where email like 'zz-load-%')`);
  await db.delete(S.users).where(like(S.users.email, "zz-load-%"));
  await db.delete(S.apps).where(like(S.apps.name, "ZL %"));
  await db.delete(S.teams).where(like(S.teams.name, "ZL %"));
  await db.delete(S.branches).where(like(S.branches.name, "ZL %"));
  await db.delete(S.departments).where(like(S.departments.name, "ZL %"));
  await db.delete(S.accessAudit).where(like(S.accessAudit.actorName, "ZL %"));
}

await clean();
if (process.argv.includes("--clean")) { console.log("Load-test data removed."); process.exit(0); }

const deps = await db.insert(S.departments).values(Array.from({ length: 6 }, (_, i) => ({ name: `ZL Dept ${i + 1}`, slug: `zl-dept-${i + 1}`, icon: "Building2", sortOrder: 9000 + i }))).returning({ id: S.departments.id });
const appRows = await db.insert(S.apps).values(Array.from({ length: 40 }, (_, i) => ({
  name: `ZL App ${i + 1}`, description: `Load test application ${i + 1}`, url: `https://example.com/zl/${i + 1}`, icon: "AppWindow", departmentId: deps[i % deps.length].id, sortOrder: i,
}))).returning({ id: S.apps.id });
const brs = await db.insert(S.branches).values(Array.from({ length: 4 }, (_, i) => ({ name: `ZL Branch ${i + 1}` }))).returning({ id: S.branches.id });
const tms = await db.insert(S.teams).values(Array.from({ length: 12 }, (_, i) => ({ name: `ZL Team ${i + 1}`, branchId: brs[i % brs.length].id }))).returning({ id: S.teams.id });

const hash = await hashPassword(LOAD_PASSWORD); // every load user shares it: this is test data, in a scratch database
const rnd = (n: number) => Math.floor(Math.random() * n);
const people = await db.insert(S.users).values(Array.from({ length: PEOPLE }, (_, i) => ({
  name: `ZL Person ${i}`, email: `zz-load-${i}@example.com`, passwordHash: hash, signupSource: "load", role: (i < 20 ? "dept_lead" : "member") as "dept_lead" | "member",
  homeDepartmentId: deps[i % deps.length].id, branchId: brs[i % brs.length].id, teamId: tms[i % tms.length].id, designation: "Load tester",
}))).returning({ id: S.users.id });
await db.update(S.users).set({ reportingManagerId: people[0].id }).where(sql`${S.users.email} like 'zz-load-%' and ${S.users.email} <> 'zz-load-0@example.com'`);

const grants: { userId: string; appId: string }[] = [];
for (const p of people) for (const a of new Set(Array.from({ length: 6 + rnd(10) }, () => appRows[rnd(appRows.length)].id))) grants.push({ userId: p.id, appId: a });
for (let i = 0; i < grants.length; i += 4000) await db.insert(S.userAppAccess).values(grants.slice(i, i + 4000)).onConflictDoNothing();
const acts = Array.from({ length: 20000 }, () => ({ userId: people[rnd(people.length)].id, appId: appRows[rnd(appRows.length)].id, departmentId: deps[rnd(deps.length)].id, action: "launch" as const, ipAddress: "10.0.0.1" }));
for (let i = 0; i < acts.length; i += 4000) await db.insert(S.activityLog).values(acts.slice(i, i + 4000));
await db.insert(S.accessAudit).values(Array.from({ length: 5000 }, (_, i) => ({ actorName: "ZL Seed", action: "access.change", targetType: "user", targetLabel: `ZL Person ${i % PEOPLE}`, details: {} })));

const out = process.env.LOAD_OUT ?? "load-data.json";
writeFileSync(out, JSON.stringify({ people: PEOPLE, password: LOAD_PASSWORD, departmentIds: deps.map((d) => d.id), appIds: appRows.map((a) => a.id), userIds: people.map((p) => p.id), grants: grants.length }));
console.log(`Seeded ${PEOPLE} people, ${appRows.length} applications, ${grants.length} grants, 20000 activity rows, 5000 audit rows. Details in ${out}.`);
process.exit(0);
