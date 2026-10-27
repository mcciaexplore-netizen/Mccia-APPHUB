/**
 * Integration test of the hub's people-and-access server code against a real Postgres: changing access, team-manager limits, the
 * directory, bulk import, temporary passwords, the audit log, revocation and deactivation, the roles (Support Admin in the environment;
 * Super Admin, HR Admin and Expense Admin one person each) and the sign-in limits. It calls the code directly (no browser, no
 * web server), passing in who is acting, so every permission rule is exercised with real data.
 *
 * It WRITES to the database, so point it at a scratch database, never the live one:
 *   INTEGRATION_DB_CONFIRM=yes INTEGRATION_DATABASE_URL=postgres://postgres@127.0.0.1:5432/scratch npm run test:integration:hub
 * All migrations must be applied first. Everything it creates is named "ZZH"/"zz-hub-" and is removed when it finishes. The project's
 * own .env is NOT read, so it cannot reach the live database by accident; it also refuses a Neon address.
 */
import { randomUUID } from "node:crypto";

const url = process.env.INTEGRATION_DATABASE_URL;
if (process.env.INTEGRATION_DB_CONFIRM !== "yes" || !url) {
  console.error("Set INTEGRATION_DATABASE_URL to a scratch database and INTEGRATION_DB_CONFIRM=yes (this test writes to it).");
  process.exit(2);
}
if (/neon\.tech/i.test(url) && process.env.INTEGRATION_ALLOW_NEON !== "yes") {
  console.error("That looks like a Neon address. Use a scratch database (or a Neon branch with INTEGRATION_ALLOW_NEON=yes).");
  process.exit(2);
}
process.env.DATABASE_URL = url;
process.env.DB_DRIVER = process.env.INTEGRATION_DB_DRIVER ?? "pg";
process.env.APP_BASE_URL = "http://localhost:3999";
process.env.HEAD_ADMIN_EMAIL = "zz-hub-env-admin@example.com";
process.env.HEAD_ADMIN_PASSWORD = "Env-admin-pass-1";
// Left over from when the Super Admin, HR and Expenditure accounts lived in the environment: they must now be ignored (section 12).
process.env.SUPER_ADMIN_EMAIL = "zz-hub-env-super@example.com";
process.env.SUPER_ADMIN_PASSWORD = "Env-super-pass-1";
process.env.HR_ADMIN_EMAIL = "zz-hub-env-hr@example.com";
process.env.HR_ADMIN_PASSWORD = "Env-hr-pass-1";
delete process.env.SMTP_HOST; // no real email from a test
delete process.env.SMTP_FROM;
delete process.env.ALLOWED_EMAIL_DOMAIN;

const { and, count, eq, inArray, like, sql } = await import("drizzle-orm");
const { db } = await import("../src/db");
const S = await import("../src/db/schema");
const { applyAccess, applyAppUserChange, previewAccess } = await import("../src/lib/access-ops");
const { createAccount } = await import("../src/lib/accounts");
const { listAudit } = await import("../src/lib/audit");
const { checkOrg } = await import("../src/lib/org");
const { listPeople, getPerson, parsePeopleFilters, peopleIds, adminSummary } = await import("../src/lib/people");
const { checkImport, commitBatch } = await import("../src/lib/import");
const { sendInvite, inviteInfo, completeInvite, hashToken } = await import("../src/lib/invites");
const { getAccessibleApps, getLaunchTarget } = await import("../src/lib/access");
const { authenticate, isEnvAdmin, userFingerprint } = await import("../src/lib/auth");
const { refuseOrSlow, record } = await import("../src/lib/sign-in-limits");
const { hashPassword, verifyPassword } = await import("../src/lib/passwords");
const { UserError } = await import("../src/lib/user-error");
type User = typeof S.users.$inferSelect;
type ImportRow = import("../src/lib/import-parse").ImportRow;

let ok = 0, bad = 0;
const check = (name: string, pass: unknown, extra: unknown = "") => {
  if (pass) ok++; else bad++;
  console.log(pass ? "PASS" : "FAIL", name, pass || extra === "" ? "" : `\n   -> ${typeof extra === "string" ? extra : JSON.stringify(extra)}`);
};
/** Runs something that should be refused; returns the message, or null if it was allowed. */
const refused = async (fn: () => Promise<unknown>): Promise<string | null> => {
  try { await fn(); return null; } catch (e) { return e instanceof UserError ? e.message : `UNEXPECTED: ${String((e as Error)?.stack ?? e)}`; }
};

const cleanup = async () => {
  await db.delete(S.accessAudit).where(like(S.accessAudit.actorName, "ZZH %"));
  await db.delete(S.accessAudit).where(like(S.accessAudit.targetLabel, "ZZH %"));
  await db.delete(S.loginAttempts).where(like(S.loginAttempts.email, "zz-hub-%"));
  await db.delete(S.users).where(like(S.users.email, "zz-hub-%"));
  await db.delete(S.apps).where(like(S.apps.name, "ZZH %"));
  await db.delete(S.teams).where(like(S.teams.name, "ZZH %"));
  await db.delete(S.branches).where(like(S.branches.name, "ZZH %"));
  await db.delete(S.departments).where(like(S.departments.name, "ZZH %"));
};

// The Super Admin, HR Admin and Expense Admin are one person each (enforced by the database), and the test makes its own: it cannot run
// where real people already hold those roles.
const holders = await db.select({ email: S.users.email }).from(S.users).where(and(inArray(S.users.role, ["super_admin", "hr_admin", "expense_admin"]), sql`${S.users.email} not like 'zz-hub-%'`));
if (holders.length) {
  console.error(`This database already has a Super Admin, HR Admin or Expense Admin (${holders.length}). Use a scratch database.`);
  process.exit(2);
}

try {
  await cleanup();

  // ------------------------------------------------------------------------------------------------ fixtures
  const [dFin] = await db.insert(S.departments).values({ name: "ZZH Finance", icon: "Calculator", slug: "zzh-finance" }).returning();
  const [dOps] = await db.insert(S.departments).values({ name: "ZZH Operations", icon: "Briefcase", slug: "zzh-ops" }).returning();
  const [bPune] = await db.insert(S.branches).values({ name: "ZZH Pune" }).returning();
  const [bMum] = await db.insert(S.branches).values({ name: "ZZH Mumbai" }).returning();
  const [bOld] = await db.insert(S.branches).values({ name: "ZZH Closed", isActive: false }).returning();
  const [tAcc] = await db.insert(S.teams).values({ name: "ZZH Accounts", branchId: bPune.id }).returning();
  const [tSales] = await db.insert(S.teams).values({ name: "ZZH Sales", branchId: bMum.id }).returning();
  const [tFree] = await db.insert(S.teams).values({ name: "ZZH Floating" }).returning();
  const mkApp = async (name: string, deptId: string, extra: Partial<typeof S.apps.$inferInsert> = {}) =>
    (await db.insert(S.apps).values({ name, departmentId: deptId, url: `https://example.com/${encodeURIComponent(name)}`, icon: "AppWindow", ...extra }).returning())[0];
  const [aTally, aCrm, aLedger, aOps] = [await mkApp("ZZH Tally", dFin.id), await mkApp("ZZH CRM", dFin.id), await mkApp("ZZH Ledger", dFin.id), await mkApp("ZZH Ops Tool", dOps.id)];
  const mkUser = async (key: string, o: Partial<typeof S.users.$inferInsert> = {}) =>
    (await db.insert(S.users).values({ name: `ZZH ${key}`, email: `zz-hub-${key.toLowerCase().replace(/\s+/g, "-")}@example.com`, passwordHash: "scrypt$16384$x$y", signupSource: "test", ...o }).returning())[0];
  const admin = await mkUser("Admin", { role: "head_admin" });
  const tm = await mkUser("Manager", { role: "dept_lead", teamId: tAcc.id, branchId: bPune.id });
  const tm2 = await mkUser("Other Manager", { role: "dept_lead", teamId: tSales.id });
  const inTeam1 = await mkUser("Asha InTeam", { teamId: tAcc.id, branchId: bPune.id });
  const inTeam2 = await mkUser("Ravi InTeam", { teamId: tAcc.id, branchId: bPune.id });
  const reports = await mkUser("Meera Reports", { reportingManagerId: tm.id });
  const outside = await mkUser("Kiran Outside", { teamId: tSales.id, branchId: bMum.id });
  const plain = await mkUser("Plain User");
  const pending = await mkUser("Pending Person", { passwordHash: null });
  const gone = await mkUser("Inactive Person", { isActive: false });
  const grantRows = async (userId: string) => (await db.select({ a: S.userAppAccess.appId }).from(S.userAppAccess).where(eq(S.userAppAccess.userId, userId))).map((r) => r.a).sort();
  const sorted = (...ids: string[]) => [...ids].sort();
  const auditCount = async (action?: string) => (await db.select({ n: count() }).from(S.accessAudit).where(action ? and(like(S.accessAudit.actorName, "ZZH %"), eq(S.accessAudit.action, action)) : like(S.accessAudit.actorName, "ZZH %")))[0].n;

  // ------------------------------------------------------------------------------------------------ 1. access changes
  console.log("\n== 1. Access: add, remove, replace, retry, atomic ==");
  const r1 = await applyAccess(admin, { userIds: [inTeam1.id, inTeam2.id, outside.id], appIds: [aTally.id, aCrm.id], mode: "add", source: "test" });
  check("adding two apps to three people changes all three", r1.changed.length === 3 && r1.unchanged === 0 && r1.changed.every((c) => c.added.length === 2), r1);
  check("the rows are in the database", JSON.stringify(await grantRows(inTeam1.id)) === JSON.stringify(sorted(aTally.id, aCrm.id)));
  check("the grant records who gave it", (await db.select().from(S.userAppAccess).where(eq(S.userAppAccess.userId, inTeam1.id)))[0].grantedById === admin.id);
  check("one audit row per person changed, naming the apps added", (await auditCount("access.change")) === 3 && (await db.select().from(S.accessAudit).where(eq(S.accessAudit.targetId, inTeam1.id)))[0].details && JSON.stringify((await db.select().from(S.accessAudit).where(eq(S.accessAudit.targetId, inTeam1.id)))[0].details).includes("ZZH Tally"));
  const again = await applyAccess(admin, { userIds: [inTeam1.id, inTeam2.id, outside.id], appIds: [aTally.id, aCrm.id], mode: "add", source: "test" });
  check("running the same add again changes nothing and writes no audit rows (a retry is safe)", again.changed.length === 0 && again.unchanged === 3 && (await auditCount("access.change")) === 3);
  check("no duplicate grant rows exist", (await grantRows(inTeam1.id)).length === 2);
  const rem = await applyAccess(admin, { userIds: [inTeam2.id], appIds: [aCrm.id], mode: "remove", source: "test" });
  check("removing an app removes only that one", rem.changed[0].removed[0].name === "ZZH CRM" && JSON.stringify(await grantRows(inTeam2.id)) === JSON.stringify([aTally.id]));
  check("removing what is already gone is a quiet no-op", (await applyAccess(admin, { userIds: [inTeam2.id], appIds: [aCrm.id], mode: "remove", source: "test" })).changed.length === 0);
  const rep = await applyAccess(admin, { userIds: [inTeam1.id, plain.id], appIds: [aLedger.id, aOps.id], mode: "replace", source: "test" });
  check("replace makes access exactly the ticked apps", JSON.stringify(await grantRows(inTeam1.id)) === JSON.stringify(sorted(aLedger.id, aOps.id)) && JSON.stringify(await grantRows(plain.id)) === JSON.stringify(sorted(aLedger.id, aOps.id)));
  check("the audit row for a replace holds before and after", (() => { const c = rep.changed.find((x) => x.userId === inTeam1.id)!; return c.removed.length === 2 && c.added.length === 2; })());
  const auditBefore = await db.select().from(S.accessAudit).where(and(eq(S.accessAudit.targetId, inTeam1.id), like(S.accessAudit.actorName, "ZZH %")));
  const rd = auditBefore.map((a) => a.details as { mode: string; before: string[]; after: string[] }).find((d) => d.mode === "replace")!;
  check("before and after are recorded as names", JSON.stringify(rd.before) === JSON.stringify(["ZZH CRM", "ZZH Tally"]) && JSON.stringify(rd.after) === JSON.stringify(["ZZH Ledger", "ZZH Ops Tool"]), rd);
  await applyAccess(admin, { userIds: [plain.id], appIds: [], mode: "replace", source: "test" });
  check("replace with nothing ticked removes all access", (await grantRows(plain.id)).length === 0);

  const snapshot = async () => JSON.stringify([await grantRows(inTeam1.id), await grantRows(inTeam2.id), await grantRows(outside.id), await auditCount()]);
  const before = await snapshot();
  check("an application that does not exist stops the whole request, changing nobody", (await refused(() => applyAccess(admin, { userIds: [inTeam1.id, inTeam2.id], appIds: [aTally.id, randomUUID()], mode: "add", source: "test" })))?.includes("no longer exist") && (await snapshot()) === before);
  check("a user that does not exist stops the whole request, changing nobody", (await refused(() => applyAccess(admin, { userIds: [inTeam1.id, randomUUID()], appIds: [aTally.id], mode: "replace", source: "test" })))?.includes("no longer exist") && (await snapshot()) === before);
  check("choosing no people or no applications is refused with a clear message", (await refused(() => applyAccess(admin, { userIds: [], appIds: [aTally.id], mode: "add", source: "test" })))?.includes("at least one user") === true && (await refused(() => applyAccess(admin, { userIds: [inTeam1.id], appIds: [], mode: "add", source: "test" })))?.includes("at least one application") === true);
  const prev = await previewAccess(admin, { userIds: [inTeam1.id, inTeam2.id], appIds: [aTally.id], mode: "add" as const, source: "test" });
  check("the preview shows who would get what (Ravi already has it), and writes nothing", prev.rows.length === 2 && prev.adds === 1 && prev.unchanged === 1 && (await snapshot()) === before, prev);

  // ------------------------------------------------------------------------------------------------ 2. team manager limits
  console.log("\n== 2. A team manager stays inside their scope ==");
  await applyAccess(admin, { userIds: [tm.id], appIds: [aTally.id, aCrm.id], mode: "replace", source: "test" }); // the manager holds Tally and CRM
  await applyAccess(admin, { userIds: [inTeam1.id], appIds: [aLedger.id], mode: "replace", source: "test" });
  const tmAdd = await applyAccess(tm, { userIds: [inTeam1.id, reports.id], appIds: [aTally.id], mode: "add", source: "test" });
  check("a team manager can give an app they hold to people in their team and people reporting to them", tmAdd.changed.length === 2 && (await grantRows(reports.id)).includes(aTally.id));
  check("granting an app the manager does not hold is refused, and nothing changes", (await refused(() => applyAccess(tm, { userIds: [inTeam1.id], appIds: [aOps.id], mode: "add", source: "test" })))?.includes("that you can open yourself") === true && !(await grantRows(inTeam1.id)).includes(aOps.id));
  check("a person outside the team cannot be changed", (await refused(() => applyAccess(tm, { userIds: [outside.id], appIds: [aTally.id], mode: "add", source: "test" })))?.includes("not allowed") === true);
  check("one out-of-scope person in a group refuses the whole group (no half-applied change)", (await refused(() => applyAccess(tm, { userIds: [inTeam2.id, outside.id], appIds: [aCrm.id], mode: "add", source: "test" }))) !== null && !(await grantRows(inTeam2.id)).includes(aCrm.id));
  check("a team manager cannot change another manager, an administrator or themselves", (await refused(() => applyAccess(tm, { userIds: [tm2.id], appIds: [aTally.id], mode: "add", source: "test" }))) !== null && (await refused(() => applyAccess(tm, { userIds: [admin.id], appIds: [aTally.id], mode: "add", source: "test" }))) !== null && (await refused(() => applyAccess(tm, { userIds: [tm.id], appIds: [aTally.id], mode: "add", source: "test" }))) !== null);
  // inTeam1 holds Ledger (which the manager does not hold) and Tally: a replace by the manager must leave Ledger alone
  const tmRep = await applyAccess(tm, { userIds: [inTeam1.id], appIds: [aCrm.id], mode: "replace", source: "test" });
  const held = await grantRows(inTeam1.id);
  check("a replace by a team manager only touches the apps the manager may hand out", held.includes(aLedger.id) && held.includes(aCrm.id) && !held.includes(aTally.id), { held, tmRep });
  check("a plain user cannot change anyone's access", (await refused(() => applyAccess(plain, { userIds: [inTeam2.id], appIds: [aTally.id], mode: "add", source: "test" }))) !== null);
  check("the same rules decide who the manager may see: peopleIds with a group only returns people in scope", (await peopleIds(tm, { teamId: tSales.id })).length === 0 && (await peopleIds(tm, { teamId: tAcc.id })).sort().join() === [inTeam1.id, inTeam2.id].sort().join());

  // ------------------------------------------------------------------------------------------------ 3. directory
  console.log("\n== 3. The directory filters, sorts and pages on the server ==");
  const pf = (o: Record<string, string>) => parsePeopleFilters(o);
  const all = await listPeople(admin, pf({ q: "ZZH" }), 100);
  check("the super administrator sees everyone", all.total >= 10 && all.rows.some((r) => r.id === admin.id));
  const names = (r: { rows: { name: string }[] }) => r.rows.map((x) => x.name);
  check("search matches name and email, ignoring case", names(await listPeople(admin, pf({ q: "asha intea" }))).join() === "ZZH Asha InTeam" && names(await listPeople(admin, pf({ q: "ZZ-HUB-RAVI" }))).join() === "ZZH Ravi InTeam");
  check("filter by team", names(await listPeople(admin, pf({ team: tAcc.id, sort: "name" }))).join() === "ZZH Asha InTeam,ZZH Manager,ZZH Ravi InTeam");
  check("filter by branch", names(await listPeople(admin, pf({ branch: bMum.id }))).join() === "ZZH Kiran Outside");
  check("filter by role", names(await listPeople(admin, pf({ role: "dept_lead", q: "ZZH" }))).join() === "ZZH Manager,ZZH Other Manager");
  check("filter by reporting manager", names(await listPeople(admin, pf({ manager: tm.id }))).join() === "ZZH Meera Reports");
  check("filter by status: pending invitation, inactive", names(await listPeople(admin, pf({ status: "pending", q: "ZZH" }))).join() === "ZZH Pending Person" && names(await listPeople(admin, pf({ status: "inactive", q: "ZZH" }))).join() === "ZZH Inactive Person");
  check("filter by the application a person holds", names(await listPeople(admin, pf({ app: aLedger.id }))).includes("ZZH Asha InTeam"));
  const p1 = await listPeople(admin, pf({ q: "ZZH", sort: "name" }), 4);
  const p2 = await listPeople(admin, pf({ q: "ZZH", sort: "name", page: "2" }), 4);
  check("paging returns a stable page of the right size, and pages do not overlap", p1.rows.length === 4 && p1.pages >= 3 && p2.rows.every((r) => !p1.rows.some((x) => x.id === r.id)) && p1.rows[0].name <= p1.rows[3].name);
  check("a page beyond the end shows the last page, not an error", (await listPeople(admin, pf({ q: "ZZH", page: "9999" }), 4)).page === p1.pages);
  check("each row carries the apps the person holds, loaded in one extra query for the page", (await listPeople(admin, pf({ q: "ZZH Asha" }))).rows[0].apps.length > 0);
  const hostile = await listPeople(admin, pf({ q: "x'; drop table users; --" }));
  check("a hostile search string is just text (no error, no match, table intact)", hostile.total === 0 && (await db.select({ n: count() }).from(S.users))[0].n > 0);
  check("a % or _ in the search is literal, not a wildcard", (await listPeople(admin, pf({ q: "%" }))).total === 0 && (await listPeople(admin, pf({ q: "_" }))).total === 0);
  const tmView = await listPeople(tm, pf({}), 100);
  check("a team manager's directory holds only people in their team or reporting to them", tmView.rows.map((r) => r.name).sort().join() === "ZZH Asha InTeam,ZZH Meera Reports,ZZH Ravi InTeam");
  check("filters cannot widen a team manager's scope", (await listPeople(tm, pf({ team: tSales.id }))).total === 0 && (await listPeople(tm, pf({ role: "head_admin" }))).total === 0);
  check("a plain user's directory is empty", (await listPeople(plain, pf({}))).total === 0);
  check("the profile of someone in scope opens for a team manager, out of scope it does not exist", !!(await getPerson(tm as User, inTeam1.id)) && (await getPerson(tm as User, outside.id)) === null && (await getPerson(tm as User, "not-a-uuid")) === null);
  check("a person can open their own profile; no one else's", !!(await getPerson(plain as User, plain.id)) && (await getPerson(plain as User, inTeam1.id)) === null);
  const prof = await getPerson(admin, inTeam1.id);
  check("the profile gathers org, access and status in one read", prof?.team === "ZZH Accounts" && prof.branch === "ZZH Pune" && prof.appIds.length === 2 && prof.status === "active");
  const sum = await adminSummary();
  check("the dashboard counts come from real rows", sum.users.total >= 10 && sum.users.pending >= 1 && sum.users.inactive >= 1 && sum.apps.total >= 4);

  // ------------------------------------------------------------------------------------------------ 4. organisation rules
  console.log("\n== 4. Branch, team and manager rules ==");
  const none = { branchId: null, teamId: null, managerId: null };
  check("a team's branch fills in a blank branch", (await checkOrg({ ...none, teamId: tAcc.id }, null)).branchId === bPune.id);
  check("a team from another branch is refused, naming both", ((await refused(() => checkOrg({ ...none, teamId: tAcc.id, branchId: bMum.id }, null))) ?? "").includes("ZZH Pune"));
  check("a team with no branch fits any branch", (await checkOrg({ ...none, teamId: tFree.id, branchId: bMum.id }, null)).branchId === bMum.id);
  check("an inactive branch cannot be newly chosen, but may stay where it already is", ((await refused(() => checkOrg({ ...none, branchId: bOld.id }, null))) ?? "").includes("inactive") && (await checkOrg({ ...none, branchId: bOld.id }, null, { branchId: bOld.id })).branchId === bOld.id);
  check("a person cannot be their own manager", ((await refused(() => checkOrg({ ...none, managerId: plain.id }, plain.id))) ?? "").includes("own reporting manager"));
  check("an inactive manager cannot be chosen", ((await refused(() => checkOrg({ ...none, managerId: gone.id }, plain.id))) ?? "").includes("inactive"));
  await db.update(S.users).set({ reportingManagerId: plain.id }).where(eq(S.users.id, inTeam2.id)); // inTeam2 reports to plain
  check("a reporting loop is refused, direct or indirect", ((await refused(() => checkOrg({ ...none, managerId: inTeam2.id }, plain.id))) ?? "").includes("loop"));
  check("a valid chain is accepted", (await checkOrg({ ...none, managerId: tm.id }, plain.id)).managerId === tm.id);
  await db.update(S.users).set({ reportingManagerId: null }).where(eq(S.users.id, inTeam2.id));

  // ------------------------------------------------------------------------------------------------ 5. bulk import
  console.log("\n== 5. Bulk import: check, commit, retry ==");
  const R = (row: number, o: Partial<ImportRow>): ImportRow => ({ row, name: "", email: "", branch: "", team: "", manager: "", role: "", applications: "", designation: "", ...o });
  const rows: ImportRow[] = [
    R(1, { name: "ZZH Boss", email: "zz-hub-imp-boss@example.com", branch: "ZZH Pune", team: "ZZH Accounts", applications: "ZZH Tally, ZZH CRM", designation: "Head" }),
    R(2, { name: "ZZH Report One", email: "zz-hub-imp-r1@example.com", manager: "zz-hub-imp-boss@example.com", team: "ZZH Accounts", applications: "ZZH Finance / ZZH Ledger", role: "Team manager" }),
    R(3, { name: "ZZH Bad Email", email: "not-an-email" }),
    R(4, { name: "ZZH Dup", email: "zz-hub-imp-boss@example.com" }),
    R(5, { name: "ZZH Existing", email: inTeam1.email }),
    R(6, { name: "ZZH Typo Branch", email: "zz-hub-imp-typo@example.com", branch: "ZZH Pnue" }),
    R(7, { name: "ZZH Wrong Team", email: "zz-hub-imp-wt@example.com", team: "ZZH Accounts", branch: "ZZH Mumbai" }),
    R(8, { name: "ZZH Bad Role", email: "zz-hub-imp-br@example.com", role: "Super administrator" }),
    R(9, { name: "ZZH Bad App", email: "zz-hub-imp-ba@example.com", applications: "ZZH Nope" }),
    R(10, { name: "ZZH Loop A", email: "zz-hub-imp-la@example.com", manager: "zz-hub-imp-lb@example.com" }),
    R(11, { name: "ZZH Loop B", email: "zz-hub-imp-lb@example.com", manager: "zz-hub-imp-la@example.com" }),
    R(12, { name: "ZZH No Manager", email: "zz-hub-imp-nm@example.com", manager: "ghost@example.com" }),
    R(13, { name: "", email: "zz-hub-imp-noname@example.com" }),
    R(14, { name: "ZZH Child First", email: "zz-hub-imp-child@example.com", manager: "zz-hub-imp-r1@example.com" }),
  ];
  const chk = await checkImport(admin, rows, { existing: "skip" });
  const st = (n: number) => chk.checks.find((c) => c.row === n)!;
  check("a complete row is valid and will be created", st(1).status === "valid" && st(1).action === "create" && st(2).status === "valid");
  check("a bad email is invalid with a message naming the value", st(3).status === "invalid" && st(3).errors[0].includes("not-an-email"));
  check("a repeated email in the file is marked duplicate and points at the first row", st(4).status === "duplicate" && st(4).errors[0].includes("Row 1"));
  check("an existing account is marked exists and is skipped under the skip policy", st(5).status === "exists" && st(5).action === "skip");
  // Only name and email are required. A branch, team, manager, role or application that cannot be matched is left empty, with a warning.
  const warned = (n: number, text: string) => st(n).status === "valid" && st(n).errors.length === 0 && st(n).warnings.join(" ").includes(text);
  check("a misspelt branch is left empty with a warning that suggests the real one", warned(6, "ZZH Pnue") && warned(6, "ZZH Pune"), st(6));
  check("a team that belongs to another branch is left empty with a warning naming both", warned(7, "ZZH Accounts") && warned(7, "ZZH Pune"), st(7));
  check("a role the import does not know adds them as a User, with a warning", warned(8, "not recognised"), st(8));
  check("an unknown application is not given, with a warning", warned(9, "ZZH Nope"), st(9));
  check("a reporting loop inside the file marks both rows invalid", st(10).status === "invalid" && st(11).status === "invalid" && st(10).errors.join().includes("loop"));
  check("a manager who is nowhere is left empty, with a warning", warned(12, "ghost@example.com"), st(12));
  check("a missing name is invalid", st(13).status === "invalid" && st(13).errors[0].includes("Name is missing"));
  check("the summary counts every kind", chk.summary.total === 14 && chk.summary.willCreate === 8 && chk.summary.valid === 8 && chk.summary.invalid === 4 && chk.summary.duplicate === 1 && chk.summary.exists === 1 && chk.summary.needsCorrection === 0, chk.summary);
  check("the order puts a manager before the people who report to them", chk.order.indexOf(1) < chk.order.indexOf(2) && chk.order.indexOf(2) < chk.order.indexOf(14), chk.order);
  check("checking writes nothing", (await db.select({ n: count() }).from(S.users).where(like(S.users.email, "zz-hub-imp-%")))[0].n === 0);
  check("only the super administrator may check or run an import", (await refused(() => checkImport(tm, rows, { existing: "skip" }))) !== null && (await refused(() => commitBatch(tm as never, rows, { existing: "skip" }, [1], { invite: true }))) !== null);

  const out1 = await commitBatch(admin, rows, { existing: "skip" }, chk.order, { invite: true });
  const o = (n: number) => out1.find((r) => r.row === n)!;
  check("the valid rows are created, including those with warnings", [1, 2, 6, 7, 8, 9, 12, 14].every((n) => o(n)?.outcome === "created") && [3, 4, 10, 11, 13].every((n) => !o(n) || o(n).outcome === "invalid"), out1);
  const boss = (await db.select().from(S.users).where(eq(S.users.email, "zz-hub-imp-boss@example.com")))[0];
  const r1u = (await db.select().from(S.users).where(eq(S.users.email, "zz-hub-imp-r1@example.com")))[0];
  const child = (await db.select().from(S.users).where(eq(S.users.email, "zz-hub-imp-child@example.com")))[0];
  check("organisation fields are saved: branch, team, designation, role", boss.branchId === bPune.id && boss.teamId === tAcc.id && boss.designation === "Head" && r1u.role === "dept_lead");
  check("reporting managers inside the file are linked in the right order", r1u.reportingManagerId === boss.id && child.reportingManagerId === r1u.id);
  check("applications from the file are assigned, and only those", JSON.stringify(await grantRows(boss.id)) === JSON.stringify(sorted(aTally.id, aCrm.id)) && JSON.stringify(await grantRows(r1u.id)) === JSON.stringify([aLedger.id]) && (await grantRows(child.id)).length === 0);
  const typo = (await db.select().from(S.users).where(eq(S.users.email, "zz-hub-imp-typo@example.com")))[0];
  const badRole = (await db.select().from(S.users).where(eq(S.users.email, "zz-hub-imp-br@example.com")))[0];
  check("what could not be matched is left empty, and an unknown role becomes a User", typo.branchId === null && badRole.role === "member" && (await grantRows((await db.select().from(S.users).where(eq(S.users.email, "zz-hub-imp-ba@example.com")))[0].id)).length === 0);
  check("imported people get a temporary password (stored only as a hash) they must change, and show as pending", !!boss.passwordHash && boss.passwordHash.startsWith("scrypt$") && boss.mustChangePassword === true && (await listPeople(admin, pf({ status: "pending", q: "zz-hub-imp-boss" }))).total === 1);
  const inv = await db.select().from(S.userInvites).where(eq(S.userInvites.userId, boss.id));
  check("one invitation record exists, holding only a 64-character hash, expiring in about 7 days", inv.length === 1 && /^[0-9a-f]{64}$/.test(inv[0].tokenHash) && Math.abs(inv[0].expiresAt.getTime() - Date.now() - 168 * 3600 * 1000) < 120000);
  check("with no mail set up the temporary password is handed back once, marked manual, and it signs them in", o(1).invitation === "manual" && /^.{12}$/.test(o(1).link ?? "") && inv[0].tokenHash === hashToken(o(1).link!) && (await authenticate(boss.email, o(1).link!))?.id === boss.id);
  check("the delivery is recorded as manual in the database", inv[0].delivery === "manual");
  const outBad = await commitBatch(admin, rows, { existing: "skip" }, [3, 4, 10, 13], { invite: true });
  check("rows with problems are reported with their reasons and nothing is created for them", outBad.every((r) => r.outcome === "invalid" && r.message.length > 0) && (await db.select({ n: count() }).from(S.users).where(inArray(S.users.email, ["not-an-email", "zz-hub-imp-noname@example.com", "zz-hub-imp-la@example.com"])))[0].n === 0, outBad);
  const counts = async () => JSON.stringify([
    (await db.select({ n: count() }).from(S.users).where(like(S.users.email, "zz-hub-imp-%")))[0].n,
    (await db.select({ n: count() }).from(S.userAppAccess).where(inArray(S.userAppAccess.userId, [boss.id, r1u.id, child.id])))[0].n,
    (await db.select({ n: count() }).from(S.userInvites).where(inArray(S.userInvites.userId, [boss.id, r1u.id, child.id])))[0].n,
    (await db.select({ h: S.users.passwordHash }).from(S.users).where(eq(S.users.id, boss.id)))[0].h,
  ]);
  const snap = await counts();
  const out2 = await commitBatch(admin, rows, { existing: "skip" }, chk.order, { invite: true });
  check("running the same import again creates no duplicates: accounts, grants, invitations and passwords are unchanged", (await counts()) === snap && out2.filter((r) => [1, 2, 6, 14].includes(r.row)).every((r) => r.outcome === "skipped"), out2);
  check("a batch may not be larger than the limit", (await refused(() => commitBatch(admin, rows, { existing: "skip" }, Array.from({ length: 26 }, (_, i) => i + 1), { invite: true })))?.includes("between 1 and") === true);
  check("a row number that is not in the file is reported, not crashed on", (await commitBatch(admin, rows, { existing: "skip" }, [999], { invite: true }))[0].outcome === "failed");

  const upd = await commitBatch(admin, [R(1, { name: "ZZH Asha Renamed", email: inTeam1.email, applications: "ZZH Ops Tool", designation: "Senior" })], { existing: "update" }, [1], { invite: true });
  const asha = (await db.select().from(S.users).where(eq(S.users.id, inTeam1.id)))[0];
  check("the update policy changes designation and adds apps, but never the name, role, password or status", upd[0].outcome === "updated" && asha.designation === "Senior" && asha.name === "ZZH Asha InTeam" && asha.role === "member" && asha.passwordHash === "scrypt$16384$x$y" && (await grantRows(inTeam1.id)).includes(aOps.id));
  const noInvite = await commitBatch(admin, [R(1, { name: "ZZH No Invite", email: "zz-hub-imp-noinv@example.com" })], { existing: "skip" }, [1], { invite: false });
  const noInv = (await db.select().from(S.users).where(eq(S.users.email, "zz-hub-imp-noinv@example.com")))[0];
  check("creating without sending details makes the account with no password and no invitation row (pending until details are sent)", noInvite[0].outcome === "created" && noInvite[0].invitation === "none" && noInv.passwordHash === null && (await db.select({ n: count() }).from(S.userInvites).where(eq(S.userInvites.userId, noInv.id)))[0].n === 0);

  // ------------------------------------------------------------------------------------------------ 6. temporary passwords
  console.log("\n== 6. Temporary passwords (sign-in details) ==");
  const target = (await db.select().from(S.users).where(eq(S.users.id, pending.id)))[0];
  const i1 = await sendInvite(target, admin.id);
  const temp1 = i1.link!;
  check("with no mail set up the temporary password comes back once: 12 characters", i1.delivery === "manual" && /^.{12}$/.test(temp1));
  const afterSend = (await db.select().from(S.users).where(eq(S.users.id, pending.id)))[0];
  check("the account now has it as a scrambled password, and must choose its own at the first sign-in", afterSend.passwordHash!.startsWith("scrypt$") && afterSend.mustChangePassword === true);
  check("it signs them in while its invitation record is open", (await authenticate(pending.email, temp1))?.id === pending.id);
  check("the database holds only hashes, never the temporary password", (await db.select().from(S.userInvites).where(eq(S.userInvites.tokenHash, temp1))).length === 0 && (await db.select().from(S.userInvites).where(eq(S.userInvites.tokenHash, hashToken(temp1)))).length === 1);
  const i2 = await sendInvite(target, admin.id);
  const temp2 = i2.link!;
  check("sending new details replaces the old temporary password", temp1 !== temp2 && (await authenticate(pending.email, temp1)) === null && (await authenticate(pending.email, temp2))?.id === pending.id);
  check("only one invitation record is still open", (await db.select().from(S.userInvites).where(eq(S.userInvites.userId, pending.id))).filter((r) => !r.usedAt && r.expiresAt > new Date()).length === 1);
  await db.update(S.userInvites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(S.userInvites.tokenHash, hashToken(temp2)));
  check("once its 7 days are over, the temporary password no longer signs in", (await authenticate(pending.email, temp2)) === null);
  const i3 = await sendInvite(target, admin.id);
  // What the change-password action does once they choose their own (the action itself needs a browser session, so its writes are repeated here).
  await db.update(S.users).set({ passwordHash: await hashPassword("My-own-password-9"), mustChangePassword: false }).where(eq(S.users.id, pending.id));
  await db.update(S.userInvites).set({ usedAt: new Date() }).where(and(eq(S.userInvites.userId, pending.id), sql`${S.userInvites.usedAt} is null`));
  check("after choosing their own password they sign in with it, and the temporary one stops working", !!(await authenticate(pending.email, "My-own-password-9")) && (await authenticate(pending.email, i3.link!)) === null);
  check("the stored value is a hash, not the password", (await verifyPassword("My-own-password-9", (await db.select().from(S.users).where(eq(S.users.id, pending.id)))[0].passwordHash!)) === true);
  check("the Support Admin cannot be sent one (their password is in the settings), and an inactive person cannot either", ((await refused(() => sendInvite({ id: admin.id, name: "x", email: process.env.HEAD_ADMIN_EMAIL!, isActive: true }, admin.id))) ?? "").includes("environment") && ((await refused(() => sendInvite({ id: gone.id, name: gone.name, email: gone.email, isActive: false }, admin.id))) ?? "").includes("inactive"));
  await sendInvite({ id: gone.id, name: gone.name, email: gone.email, isActive: true }, admin.id); // pretend the check passed: the account is still inactive
  const goneTemp = (await db.select().from(S.users).where(eq(S.users.id, gone.id)))[0];
  check("a temporary password for an inactive account does not sign in", goneTemp.mustChangePassword === true && (await authenticate(gone.email, "anything-at-all")) === null);
  // Older one-time links (sent before temporary passwords) still work on /set-password until they expire.
  const legacy = "legacy-link-token-for-the-test-0123456789";
  await db.insert(S.userInvites).values({ userId: plain.id, tokenHash: hashToken(legacy), expiresAt: new Date(Date.now() + 3600 * 1000), createdById: admin.id });
  check("an older one-time link still shows who it is for and sets the password once", (await inviteInfo(legacy))?.email === plain.email && (await completeInvite(legacy, "Legacy-pass-1")) === true && (await completeInvite(legacy, "Legacy-pass-2")) === false && !!(await authenticate(plain.email, "Legacy-pass-1")));
  check("a wrong-shaped link is refused outright", (await inviteInfo("short")) === null && (await completeInvite("../../etc/passwd", "Whatever-pass-1")) === false);
  await db.update(S.users).set({ passwordHash: "scrypt$16384$x$y" }).where(eq(S.users.id, plain.id));

  // ------------------------------------------------------------------------------------------------ 7. revocation and deactivation
  console.log("\n== 7. Revoking access and deactivating accounts ==");
  await applyAccess(admin, { userIds: [plain.id], appIds: [aTally.id], mode: "replace", source: "test" });
  check("a person with the grant sees the app and can launch it", (await getAccessibleApps(plain)).some((a) => a.id === aTally.id) && !!(await getLaunchTarget(plain, aTally.id)));
  await applyAccess(admin, { userIds: [plain.id], appIds: [aTally.id], mode: "remove", source: "test" });
  check("after revocation the app is gone from their hub and the launch route refuses it", !(await getAccessibleApps(plain)).some((a) => a.id === aTally.id) && (await getLaunchTarget(plain, aTally.id)) === null);
  await applyAccess(admin, { userIds: [plain.id], appIds: [aTally.id], mode: "add", source: "test" });
  await db.update(S.apps).set({ isActive: false }).where(eq(S.apps.id, aTally.id));
  check("an application that is switched off cannot be launched even with a grant", (await getLaunchTarget(plain, aTally.id)) === null && !(await getAccessibleApps(plain)).some((a) => a.id === aTally.id));
  await db.update(S.apps).set({ isActive: true }).where(eq(S.apps.id, aTally.id));
  check("the head admin sees every app without any grant", (await getAccessibleApps(admin)).some((a) => a.id === aOps.id));
  check("a deactivated account cannot sign in", (await authenticate(gone.email, "anything-1")) === null);
  await db.update(S.users).set({ passwordHash: (await db.select().from(S.users).where(eq(S.users.id, pending.id)))[0].passwordHash }).where(eq(S.users.id, plain.id));
  check("an active account with a password signs in; deactivating it stops that at once", !!(await authenticate(plain.email, "My-own-password-9")) && (await db.update(S.users).set({ isActive: false }).where(eq(S.users.id, plain.id)), (await authenticate(plain.email, "My-own-password-9")) === null));
  await db.update(S.users).set({ isActive: true }).where(eq(S.users.id, plain.id));

  // ------------------------------------------------------------------------------------------------ 8. audit
  console.log("\n== 8. The audit log ==");
  const au = await listAudit({ page: 1 }, 1000);
  const mine = au.rows.filter((r) => r.actorName.startsWith("ZZH "));
  check("every access change and import is recorded with who did it", mine.length > 10 && mine.every((r) => r.actorId === admin.id || r.actorId === tm.id));
  const blob = JSON.stringify(mine.map((r) => r.details)).toLowerCase();
  check("the audit log holds no password, token, hash or link anywhere", !/password|token|hash|set-password|scrypt/.test(blob));
  check("the filter by person finds exactly their entries", (await listAudit({ page: 1, targetId: inTeam1.id })).rows.every((r) => r.targetId === inTeam1.id) && (await listAudit({ page: 1, targetId: inTeam1.id })).total >= 2);
  check("the filter by action prefix works", (await listAudit({ page: 1, action: "access." })).rows.every((r) => r.action.startsWith("access.")));
  check("the entries are newest first", mine.every((r, i) => i === 0 || mine[i - 1].at >= r.at));

  // ------------------------------------------------------------------------------------------------ 9. scale
  console.log("\n== 9. A large change is still one statement ==");
  const crowd = [];
  for (let i = 0; i < 200; i++) crowd.push({ name: `ZZH Crowd ${i}`, email: `zz-hub-crowd-${i}@example.com`, passwordHash: "x", signupSource: "test" });
  const crowdIds = (await db.insert(S.users).values(crowd).returning({ id: S.users.id })).map((r) => r.id);
  const t0 = performance.now();
  const big = await applyAccess(admin, { userIds: crowdIds, appIds: [aTally.id, aCrm.id, aLedger.id, aOps.id], mode: "add", source: "test" });
  const ms = Math.round(performance.now() - t0);
  check(`200 people x 4 apps (800 grants) change in one call, in ${ms} ms`, big.changed.length === 200 && ms < 3000, { changed: big.changed.length, ms });
  const t1 = performance.now();
  const big2 = await applyAccess(admin, { userIds: crowdIds, appIds: [aTally.id], mode: "replace", source: "test" });
  const ms2 = Math.round(performance.now() - t1);
  check(`replacing all 200 people's access (600 removals) takes ${ms2} ms and ends exactly right`, big2.changed.length === 200 && ms2 < 3000 && (await db.select({ n: count() }).from(S.userAppAccess).where(inArray(S.userAppAccess.userId, crowdIds)))[0].n === 200, { ms2 });
  const t2 = performance.now();
  const dir = await listPeople(admin, pf({ q: "ZZH Crowd" }), 25);
  const ms3 = Math.round(performance.now() - t2);
  check(`the directory returns a page out of 200+ in ${ms3} ms`, dir.total === 200 && dir.rows.length === 25 && ms3 < 1000, { total: dir.total, ms3 });

  // ------------------------------------------------------------------------------------------------ 10. per-application changes, atomic accounts
  console.log("\n== 10. The per-application screen and all-or-nothing account creation ==");
  await applyAccess(admin, { userIds: [inTeam1.id, inTeam2.id, plain.id], appIds: [aCrm.id], mode: "replace", source: "test" });
  const mixed = await applyAppUserChange(admin, { appId: aCrm.id, add: [outside.id, reports.id], remove: [inTeam2.id], source: "test" });
  check("adding some people and removing others happens in one go (Kiran already had it, so two people change)", mixed.changed.length === 2 && mixed.unchanged === 1 && (await grantRows(outside.id)).includes(aCrm.id) && (await grantRows(reports.id)).includes(aCrm.id) && !(await grantRows(inTeam2.id)).includes(aCrm.id));
  check("each person's audit entry names the application and what happened to them", mixed.changed.every((c) => c.added.length + c.removed.length === 1));
  check("the same request again changes nothing", (await applyAppUserChange(admin, { appId: aCrm.id, add: [outside.id, reports.id], remove: [inTeam2.id], source: "test" })).changed.length === 0);
  const beforeMixed = JSON.stringify([await grantRows(outside.id), await grantRows(plain.id)]);
  check("an unknown person stops the whole per-application change, changing nobody", (await refused(() => applyAppUserChange(admin, { appId: aCrm.id, add: [randomUUID(), plain.id], remove: [outside.id], source: "test" })))?.includes("no longer exist") === true && JSON.stringify([await grantRows(outside.id), await grantRows(plain.id)]) === beforeMixed);
  check("a team manager may use it only for an application they hold and people in their scope", (await refused(() => applyAppUserChange(tm, { appId: aOps.id, add: [inTeam2.id], remove: [], source: "test" }))) !== null && (await refused(() => applyAppUserChange(tm, { appId: aCrm.id, add: [outside.id], remove: [], source: "test" }))) !== null && (await applyAppUserChange(tm, { appId: aTally.id, add: [inTeam2.id], remove: [], source: "test" })).changed.length === 1);

  const baseAccount = { name: "ZZH Atomic", email: "zz-hub-atomic@example.com", role: "member" as const, branchId: null, teamId: null, managerId: null, designation: null, appIds: [aTally.id, aCrm.id], passwordHash: null, inviteTokenHash: hashToken("atomic-token-for-test"), source: "admin" as const };
  const madeId = await createAccount(admin, baseAccount);
  const invitesOf = async (id: string) => (await db.select({ n: count() }).from(S.userInvites).where(eq(S.userInvites.userId, id)))[0].n;
  check("an account, its applications and its invitation are created together", !!madeId && (await grantRows(madeId!)).length === 2 && (await invitesOf(madeId!)) === 1);
  check("creating the same email again returns nothing and changes nothing", (await createAccount(admin, { ...baseAccount, inviteTokenHash: hashToken("another-token") })) === null && (await invitesOf(madeId!)) === 1 && (await grantRows(madeId!)).length === 2);
  const failing = await createAccount(admin, { ...baseAccount, email: "zz-hub-atomic2@example.com", managerId: randomUUID(), inviteTokenHash: hashToken("third-token") }).then(() => "created", () => "refused");
  check("if any part fails (here, a manager that does not exist) nothing at all is created", failing === "refused" && (await db.select({ n: count() }).from(S.users).where(eq(S.users.email, "zz-hub-atomic2@example.com")))[0].n === 0 && (await db.select({ n: count() }).from(S.userInvites).where(eq(S.userInvites.tokenHash, hashToken("third-token"))))[0].n === 0);

  // ------------------------------------------------------------------------------------------------ 11. Super Admin, Support Admin and Admins
  console.log("\n== 11. Roles: Super Admin, Support Admin (head_admin), and Admins with areas ==");
  const superAdmin = await mkUser("Super Admin", { role: "super_admin" });
  const admPeople = await mkUser("Admin People", { role: "admin", adminAreas: ["people"] });
  const admNone = await mkUser("Admin None", { role: "admin" });
  const admImport = await mkUser("Admin Import", { role: "admin", adminAreas: ["import"] });
  const admAudit = await mkUser("Admin Audit", { role: "admin", adminAreas: ["audit"] });
  const grantsOf = (u: string) => grantRows(u);
  check("the Support Admin opens every application without any grant", (await getAccessibleApps(admin)).some((a) => a.id === aOps.id) && (await getLaunchTarget(admin, aOps.id)) !== null);
  check("the Super Admin (the DG) sees only the applications assigned to them, like any user: none until one is given", (await getAccessibleApps(superAdmin)).length === 0 && (await getLaunchTarget(superAdmin, aOps.id)) === null);
  await applyAccess(admin, { userIds: [superAdmin.id], appIds: [aOps.id], mode: "add", source: "test" });
  check("and exactly that one once the Support Admin gives it", (await getAccessibleApps(superAdmin)).map((a) => a.id).join() === aOps.id && (await getLaunchTarget(superAdmin, aOps.id)) !== null && (await getLaunchTarget(superAdmin, aTally.id)) === null);
  check("an Admin is an ordinary user for applications: only what is ticked for them", (await getAccessibleApps(admPeople)).length === 0 && (await getLaunchTarget(admPeople, aOps.id)) === null);
  const everyone = await listPeople(admin, pf({}));
  const superRow = (await listPeople(admin, pf({}), 500)).rows.find((r) => r.id === superAdmin.id);
  check("the Super Admin is a main admin in the directory, but their password is not in the settings", superRow?.mainAdmin === true && superRow.passwordInSettings === false && superRow.status === "active");
  check("a plain user and an Admin are not main admins", (await listPeople(admin, pf({}), 500)).rows.filter((r) => [plain.id, admPeople.id, admNone.id].includes(r.id)).every((r) => !r.mainAdmin));
  check("the profile says the same", (await getPerson(admin, superAdmin.id))?.mainAdmin === true && (await getPerson(admin, superAdmin.id))?.passwordInSettings === false);
  check("the Super Admin sees no one in the directory: only the Support Admin manages people", (await listPeople(superAdmin, pf({}))).total === 0 && everyone.total > 10);
  const seen = await listPeople(admPeople, pf({}), 500);
  check("an Admin with Users & access sees plain users and Team managers, and themselves", seen.total > 5 && seen.rows.every((r) => r.role === "member" || r.role === "dept_lead" || r.id === admPeople.id) && seen.rows.some((r) => r.id === admPeople.id));
  check("and never the Support Admin, the Super Admin or another Admin", !seen.rows.some((r) => [admin.id, superAdmin.id, admNone.id, admImport.id, admAudit.id].includes(r.id)));
  check("an Admin without Users & access sees nobody", (await listPeople(admNone, pf({}))).total === 0 && (await listPeople(admAudit, pf({}))).total === 0);
  check("the role filter knows the new roles", parsePeopleFilters({ role: "admin" }).role === "admin" && parsePeopleFilters({ role: "super_admin" }).role === "super_admin");
  check("an Admin cannot open the profile of the Super Admin, the Support Admin or another Admin", (await getPerson(admPeople, superAdmin.id)) === null && (await getPerson(admPeople, admin.id)) === null && (await getPerson(admPeople, admAudit.id)) === null);
  check("but can open a plain user's profile and their own", (await getPerson(admPeople, plain.id)) !== null && (await getPerson(admPeople, admPeople.id)) !== null);
  check("the profile carries an Admin's areas", JSON.stringify((await getPerson(admin, admAudit.id))?.adminAreas) === JSON.stringify(["audit"]));
  const reach = await peopleIds(admPeople, { filters: { q: "ZZH" } });
  check("a selection by filter never reaches an account the Admin may not manage", reach.includes(plain.id) && !reach.some((id) => [superAdmin.id, admin.id, admAudit.id, admNone.id].includes(id)));

  const gave = await applyAccess(admPeople, { userIds: [plain.id], appIds: [aOps.id], mode: "add", source: "test" });
  check("an Admin with Users & access gives a plain user any application, even one they do not hold", gave.changed.length === 1 && (await grantsOf(plain.id)).includes(aOps.id));
  check("the audit entry names the Admin who did it", (await db.select().from(S.accessAudit).where(eq(S.accessAudit.targetId, plain.id))).some((a) => a.actorId === admPeople.id));
  check("an Admin cannot change the access of the Super Admin, the Support Admin or another Admin", (await refused(() => applyAccess(admPeople, { userIds: [superAdmin.id], appIds: [aOps.id], mode: "add", source: "test" }))) !== null
    && (await refused(() => applyAccess(admPeople, { userIds: [admin.id], appIds: [aOps.id], mode: "add", source: "test" }))) !== null
    && (await refused(() => applyAccess(admPeople, { userIds: [admAudit.id], appIds: [aOps.id], mode: "add", source: "test" }))) !== null);
  check("nor their own", (await refused(() => applyAccess(admPeople, { userIds: [admPeople.id], appIds: [aOps.id], mode: "add", source: "test" }))) !== null);
  check("an Admin without Users & access cannot change anyone's access", (await refused(() => applyAccess(admNone, { userIds: [plain.id], appIds: [aTally.id], mode: "add", source: "test" }))) !== null && (await refused(() => applyAccess(admAudit, { userIds: [plain.id], appIds: [aTally.id], mode: "add", source: "test" }))) !== null);
  check("the per-application screen applies the same rule", (await refused(() => applyAppUserChange(admPeople, { appId: aTally.id, add: [superAdmin.id], remove: [], source: "test" }))) !== null && (await applyAppUserChange(admPeople, { appId: aTally.id, add: [plain.id], remove: [], source: "test" })).changed.length === 1);
  check("the Super Admin cannot change anyone's access, only the Support Admin can", (await refused(() => applyAccess(superAdmin, { userIds: [plain.id], appIds: [aLedger.id], mode: "add", source: "test" }))) !== null && (await applyAccess(admin, { userIds: [plain.id], appIds: [aLedger.id], mode: "add", source: "test" })).changed.length === 1);

  const impRows: ImportRow[] = [
    R(1, { name: "ZZH Imp Fresh", email: "zz-hub-imp-fresh@example.com" }),
    R(2, { name: "ZZH Existing Super", email: superAdmin.email }),
    R(3, { name: "ZZH Existing Plain", email: plain.email }),
  ];
  check("bulk add needs its own area: Users & access alone is not enough", (await refused(() => checkImport(admPeople, impRows, { existing: "skip" }))) !== null && (await refused(() => checkImport(admNone, impRows, { existing: "skip" }))) !== null);
  const impChk = await checkImport(admImport, impRows, { existing: "update" });
  check("an Admin with Bulk add may import, and update plain users", impChk.checks.find((c) => c.row === 1)?.action === "create" && impChk.checks.find((c) => c.row === 3)?.action === "update");
  check("but a row naming the Super Admin is refused, so an update can never reach that account", impChk.checks.find((c) => c.row === 2)?.action === "none" && /cannot change that person/.test(impChk.checks.find((c) => c.row === 2)?.errors.join(" ") ?? ""), impChk.checks.find((c) => c.row === 2));
  const impTop = await checkImport(admin, impRows, { existing: "update" });
  check("the Support Admin may update any account in an import", impTop.checks.find((c) => c.row === 2)?.action === "update");
  check("the Super Admin cannot import people at all", (await refused(() => checkImport(superAdmin, impRows, { existing: "skip" }))) !== null);
  const impOut = await commitBatch(admImport as never, impRows, { existing: "update" }, [1, 2, 3], { invite: false });
  check("committing as that Admin creates the new person, updates the plain user and leaves the Super Admin alone", impOut.find((o) => o.row === 1)?.outcome === "created" && impOut.find((o) => o.row === 3)?.outcome === "updated" && impOut.find((o) => o.row === 2)?.outcome === "invalid", impOut.map((o) => `${o.row}:${o.outcome}`).join());
  check("an account made by an Admin's import is a plain user", (await db.select().from(S.users).where(eq(S.users.email, "zz-hub-imp-fresh@example.com")))[0]?.role === "member");

  const adminAccount = await createAccount(admin, { ...baseAccount, name: "ZZH Made Admin", email: "zz-hub-made-admin@example.com", role: "admin", appIds: [], inviteTokenHash: null });
  const madeAdmin = (await db.select().from(S.users).where(eq(S.users.id, adminAccount!)))[0];
  check("an account can be created as an Admin, with no areas switched on", madeAdmin.role === "admin" && madeAdmin.adminAreas.length === 0);
  const [areasSaved] = await db.update(S.users).set({ adminAreas: ["people", "audit"] }).where(eq(S.users.id, madeAdmin.id)).returning();
  check("an Admin's areas are stored as a list", JSON.stringify(areasSaved.adminAreas) === JSON.stringify(["people", "audit"]));

  // ------------------------------------------------------------------------------------------------ 12. The environment account: the Support Admin only
  console.log("\n== 12. Only the Support Admin's password lives in the environment settings ==");
  const SUPPORT_EMAIL = "zz-hub-env-admin@example.com";
  const headEnv = await authenticate("  ZZ-Hub-Env-Admin@Example.com ", "Env-admin-pass-1");
  check("the Support Admin signs in with the password from the settings (any capitals, spaces ignored), and the account is made on the first sign-in", headEnv?.role === "head_admin" && headEnv.signupSource === "env" && headEnv.isActive);
  check("a wrong or empty password is refused", (await authenticate(SUPPORT_EMAIL, "Env-admin-pass-2")) === null && (await authenticate(SUPPORT_EMAIL, "")) === null);
  check("the old SUPER_ADMIN_* and HR_ADMIN_* settings are ignored: no environment account, no sign-in, no account made", !isEnvAdmin("zz-hub-env-super@example.com") && !isEnvAdmin("zz-hub-env-hr@example.com")
    && (await authenticate("zz-hub-env-super@example.com", "Env-super-pass-1")) === null && (await authenticate("zz-hub-env-hr@example.com", "Env-hr-pass-1")) === null
    && (await db.select({ n: count() }).from(S.users).where(inArray(S.users.email, ["zz-hub-env-super@example.com", "zz-hub-env-hr@example.com"])))[0].n === 0);
  await db.update(S.users).set({ passwordHash: await hashPassword("Stored-pass-1") }).where(eq(S.users.id, headEnv!.id));
  check("a password stored in the database for that address is ignored: only the settings count", (await authenticate(SUPPORT_EMAIL, "Stored-pass-1")) === null && !!(await authenticate(SUPPORT_EMAIL, "Env-admin-pass-1")));
  await db.update(S.users).set({ role: "member", isActive: false }).where(eq(S.users.id, headEnv!.id));
  const restored = await authenticate(SUPPORT_EMAIL, "Env-admin-pass-1");
  check("it can never be locked out: signing in puts the role back and reactivates it", restored?.role === "head_admin" && restored.isActive === true);
  const fpBefore = userFingerprint({ email: SUPPORT_EMAIL, passwordHash: null });
  process.env.HEAD_ADMIN_PASSWORD = "Env-admin-pass-9";
  check("changing the password in the settings signs out every older session (the fingerprint changes)", userFingerprint({ email: SUPPORT_EMAIL, passwordHash: null }) !== fpBefore && (await authenticate(SUPPORT_EMAIL, "Env-admin-pass-1")) === null && !!(await authenticate(SUPPORT_EMAIL, "Env-admin-pass-9")));
  process.env.HEAD_ADMIN_PASSWORD = "Env-admin-pass-1";
  const supPerson = await getPerson(admin, headEnv!.id);
  check("the directory marks it as the main account whose password is in the settings, with its role fixed", supPerson?.mainAdmin === true && supPerson.passwordInSettings === true && supPerson.roleFixed === true);
  check("no temporary password can be sent to it", (await refused(() => sendInvite({ id: headEnv!.id, name: headEnv!.name, email: headEnv!.email, isActive: true }, admin.id))) !== null);
  process.env.SUPPORT_ADMIN_EMAIL = "zz-hub-env-support@example.com";
  process.env.SUPPORT_ADMIN_NAME = "ZZH Env Support";
  process.env.SUPPORT_ADMIN_PASSWORD = "Env-support-pass-1";
  const sup2 = await authenticate("zz-hub-env-support@example.com", "Env-support-pass-1");
  check("SUPPORT_ADMIN_* works as the Support Admin, and the older HEAD_ADMIN_* keeps working beside it, so changing over locks nobody out", sup2?.role === "head_admin" && sup2.name === "ZZH Env Support" && (await authenticate(SUPPORT_EMAIL, "Env-admin-pass-1"))?.role === "head_admin");
  check("neither password opens the other account", (await authenticate("zz-hub-env-support@example.com", "Env-admin-pass-1")) === null && (await authenticate(SUPPORT_EMAIL, "Env-support-pass-1")) === null);
  process.env.SUPPORT_ADMIN_PASSWORD = "   ";
  check("an email with a password of only spaces is not an environment account and cannot sign in with an empty password", !isEnvAdmin("zz-hub-env-support@example.com") && (await authenticate("zz-hub-env-support@example.com", "")) === null);
  process.env.SUPPORT_ADMIN_PASSWORD = "  Env-support-pass-1 \n";
  check("spaces or a line break around a password in the settings are not part of it", (await authenticate("zz-hub-env-support@example.com", "Env-support-pass-1"))?.role === "head_admin");
  delete process.env.SUPPORT_ADMIN_EMAIL; delete process.env.SUPPORT_ADMIN_NAME; delete process.env.SUPPORT_ADMIN_PASSWORD;
  check("the Support Admin cannot be created or imported as a new person", (await refused(() => checkImport(admin, [R(1, { name: "ZZH Dup Admin", email: SUPPORT_EMAIL })], { existing: "skip" }).then((c) => { if (c.checks[0].errors.length) throw new UserError(c.checks[0].errors.join(" ")); }))) !== null);

  // ------------------------------------------------------------------------------------------------ 13. Super Admin, HR Admin and Expense Admin: one person each
  console.log("\n== 13. The Super Admin, HR Admin and Expense Admin roles: one person each, and they decide who approves ==");
  const { roleApprovers } = await import("../src/lib/approvals/host-adapter");
  const hrA = await mkUser("HR Admin", { role: "hr_admin" });
  const expA = await mkUser("Expense Admin", { role: "expense_admin" });
  const takenBy = async (role: "super_admin" | "hr_admin" | "expense_admin") => (await mkUser(`Second ${role}`, { role }).then(() => "allowed", (e) => String((e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code ?? e)));
  check("the database refuses a second Super Admin, HR Admin or Expense Admin", (await takenBy("super_admin")) === "23505" && (await takenBy("hr_admin")) === "23505" && (await takenBy("expense_admin")) === "23505");
  const appr = await roleApprovers();
  check("the approvers are whoever holds each role", appr.superAdmin?.id === superAdmin.id && appr.hr?.id === hrA.id && appr.expense?.id === expA.id);
  check("they are ordinary users for applications: nothing until the Support Admin gives it", (await getAccessibleApps(hrA)).length === 0 && (await getAccessibleApps(expA)).length === 0);
  check("they see nobody in the directory: only the Support Admin and Admins with Users & access manage people", (await listPeople(hrA, pf({}))).total === 0 && (await listPeople(expA, pf({}))).total === 0);
  check("they cannot change anyone's access", (await refused(() => applyAccess(hrA, { userIds: [plain.id], appIds: [aTally.id], mode: "add", source: "test" }))) !== null && (await refused(() => applyAccess(expA, { userIds: [plain.id], appIds: [aTally.id], mode: "add", source: "test" }))) !== null);
  check("an Admin with Users & access cannot reach them either", (await getPerson(admPeople, hrA.id)) === null && (await refused(() => applyAccess(admPeople, { userIds: [expA.id], appIds: [aTally.id], mode: "add", source: "test" }))) !== null);
  await db.update(S.users).set({ role: "member" }).where(eq(S.users.id, hrA.id));
  check("when the HR Admin's role is taken away, there is no HR approver until someone else is given it", (await roleApprovers()).hr === null);
  const hrB = await mkUser("New HR Admin", { role: "hr_admin" });
  check("and the new holder becomes the HR approver", (await roleApprovers()).hr?.id === hrB.id);
  await db.update(S.users).set({ isActive: false }).where(eq(S.users.id, expA.id));
  check("a deactivated holder is not an approver", (await roleApprovers()).expense === null);

  // ------------------------------------------------------------------------------------------------ 14. sign-in limits
  console.log("\n== 14. Sign-in limits: recorded attempts decide them ==");
  const V = "zz-hub-victim@example.com";
  for (let i = 0; i < 5; i++) await record(V, "198.51.100.7", "login", false);
  check("after 5 wrong passwords for one email from one IP, that pair is refused", await refuseOrSlow(V, "198.51.100.7", "login"));
  check("the refused try is recorded as blocked", (await db.select({ n: count() }).from(S.loginAttempts).where(and(eq(S.loginAttempts.email, V), eq(S.loginAttempts.blocked, true))))[0].n === 1);
  check("the same email from another IP is not refused (no lock by email alone)", !(await refuseOrSlow(V, "198.51.100.8", "login")));
  check("unlocking Administrator and changing a password share the same limits", await refuseOrSlow(V, "198.51.100.7", "unlock") && await refuseOrSlow(V, "198.51.100.7", "password"));
  check("16 minutes later the pair may try again", !(await refuseOrSlow(V, "198.51.100.7", "login", Date.now() + 16 * 60_000)));
  for (let i = 0; i < 30; i++) await record(`zz-hub-spray-${i}@example.com`, "198.51.100.9", "login", false);
  check("after 30 wrong passwords from one IP across many emails, a new email from that IP is refused", await refuseOrSlow("zz-hub-someone@example.com", "198.51.100.9", "login"));
  check("a right password is recorded as a success with its form", await record(plain.email, "198.51.100.10", "unlock", true).then(async () => (await db.select().from(S.loginAttempts).where(eq(S.loginAttempts.email, plain.email)))[0]?.kind === "unlock"));

  // The Approval System is not an application to tick: the old /approvals card and the entry pages are left out of the access box, and so is a category that holds nothing else
  const { getCatalog } = await import("../src/lib/catalog");
  const [dOnlyApr] = await db.insert(S.departments).values({ name: "ZZH Approval System", icon: "ClipboardList", slug: "zzh-approval-system" }).returning();
  const [dMixed] = await db.insert(S.departments).values({ name: "ZZH Mixed", icon: "Building2", slug: "zzh-mixed" }).returning();
  await db.insert(S.apps).values([
    { departmentId: dOnlyApr.id, name: "ZZH HR Approval", url: "/approvals/hr/new", icon: "UserCheck" },
    { departmentId: dOnlyApr.id, name: "ZZH Old Approvals card", url: "/approvals", icon: "ClipboardList" },
    { departmentId: dMixed.id, name: "ZZH Expenditure Approval", url: "/approvals/expenses/new", icon: "Wallet" },
    { departmentId: dMixed.id, name: "ZZH Real App", url: "https://example.com/zzh-real", icon: "AppWindow" },
  ]);
  const cat = await getCatalog();
  check("the access box does not offer the Approval System rows, nor a category that holds only those", !cat.apps.some((a) => /^ZZH (HR Approval|Old Approvals card|Expenditure Approval)$/.test(a.name)) && !cat.departments.some((d) => d.id === dOnlyApr.id));
  check("a category that also holds a real application stays, with that application", cat.departments.some((d) => d.id === dMixed.id) && cat.apps.some((a) => a.name === "ZZH Real App" && a.departmentId === dMixed.id));
} finally {
  await cleanup().catch((e) => console.error("cleanup failed", e));
  const left = await db.select({ n: count() }).from(S.users).where(like(S.users.email, "zz-hub-%"));
  console.log(left[0].n === 0 ? "PASS all test data removed" : `FAIL ${left[0].n} test users left behind`);
  if (left[0].n !== 0) bad++; else ok++;
}

console.log(`\n${ok}/${ok + bad} hub integration checks passed`);
process.exit(bad ? 1 : 0);
void sql;
