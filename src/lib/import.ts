import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { apps, branches, departments, teams, users, type Role } from "@/db/schema";
import { createAccount } from "@/lib/accounts";
import { applyAccess } from "@/lib/access-ops";
import { writeAudit, type AuditEntry } from "@/lib/audit";
import { isEnvAdmin } from "@/lib/auth";
import { domainsLabel, isEmailAllowed } from "@/lib/domains";
import { type ImportRow, MAX_IMPORT_ROWS } from "@/lib/import-parse";
import { deliverInvite, hashToken, tempPassword } from "@/lib/invites";
import { hashPassword } from "@/lib/passwords";
import { managerChainReaches } from "@/lib/org";
import { canImportUsers, canUpdateByImport, type Actor } from "@/lib/rbac";
import { UserError } from "@/lib/user-error";
import { emailSchema } from "@/lib/validation";

/**
 * Bulk creation of accounts. Two steps, so nothing is created by surprise:
 *   1. checkImport  reads every row against the real data and says, row by row, what is wrong or what would happen. Writes nothing.
 *   2. commitBatch  creates the accounts, a few rows at a time. Each person is ONE database statement (account, applications and
 *      invitation together), so a failure never leaves half an account, and running the same rows again is harmless: an email that
 *      already exists is skipped, never duplicated.
 * No password is ever read, stored or reported here: people choose their own from an emailed one-time link.
 */

export type RowStatus = "valid" | "needs_correction" | "invalid" | "duplicate" | "exists";
type RowAction = "create" | "update" | "skip" | "none";
export type RowCheck = { row: number; name: string; email: string; status: RowStatus; action: RowAction; errors: string[]; warnings: string[]; suggestions: string[] };
export type ImportPolicy = { existing: "skip" | "update" };

type Plan = {
  row: ImportRow; email: string; name: string; role: Extract<Role, "member" | "dept_lead">; branchId: string | null; teamId: string | null;
  managerId: string | null; managerEmail: string | null; managerRow: number | null; designation: string | null; appIds: string[]; existingId: string | null;
  action: RowAction;
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s*\/\s*/g, " / ").replace(/\s+/g, " ");

function distance(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 3) return 99;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
/** The closest real name, when it is close enough to be a likely typo. */
function suggest(value: string, names: string[]): string | null {
  const v = norm(value);
  let best: { n: string; d: number } | null = null;
  for (const n of names) {
    const d = distance(v, norm(n));
    if (d <= Math.max(2, Math.floor(v.length / 4)) && (!best || d < best.d)) best = { n, d };
  }
  return best?.n ?? null;
}

const ROLE_WORDS: Record<string, "member" | "dept_lead"> = {
  "": "member", user: "member", member: "member", "standard user": "member",
  "team manager": "dept_lead", team_manager: "dept_lead", manager: "dept_lead", dept_lead: "dept_lead", "team lead": "dept_lead",
};

async function analyse(rows: ImportRow[], policy: ImportPolicy, actor: Actor) {
  if (rows.length === 0) throw new UserError("There are no people to check.");
  if (rows.length > MAX_IMPORT_ROWS) throw new UserError(`At most ${MAX_IMPORT_ROWS} people at a time.`);

  const emails = [...new Set(rows.map((r) => r.email.trim().toLowerCase()).filter(Boolean))];
  const managerTokens = [...new Set(rows.map((r) => r.manager.trim()).filter(Boolean))];
  const managerEmails = managerTokens.filter((t) => t.includes("@")).map((t) => t.toLowerCase());
  const managerNames = managerTokens.filter((t) => !t.includes("@")).map((t) => t.toLowerCase());

  const [brs, tms, catalog, byEmail, byName] = await Promise.all([
    db.select({ id: branches.id, name: branches.name, isActive: branches.isActive }).from(branches),
    db.select({ id: teams.id, name: teams.name, branchId: teams.branchId, isActive: teams.isActive }).from(teams),
    db.select({ id: apps.id, name: apps.name, departmentId: apps.departmentId, dept: departments.name }).from(apps).innerJoin(departments, eq(departments.id, apps.departmentId)).where(and(eq(apps.isActive, true), eq(departments.isActive, true))),
    emails.length || managerEmails.length
      ? db.select({ id: users.id, email: users.email, name: users.name, isActive: users.isActive, status: users.status, role: users.role }).from(users).where(inArray(users.email, [...new Set([...emails, ...managerEmails])]))
      : Promise.resolve([]),
    managerNames.length
      ? db.select({ id: users.id, email: users.email, name: users.name }).from(users).where(and(eq(users.isActive, true), eq(users.status, "approved"), inArray(sql`lower(${users.name})`, managerNames)))
      : Promise.resolve([]),
  ]);

  const brByName = new Map(brs.map((b) => [norm(b.name), b]));
  const teamByName = new Map(tms.map((t) => [norm(t.name), t]));
  const branchName = new Map(brs.map((b) => [b.id, b.name]));
  const userByEmail = new Map(byEmail.map((u) => [u.email, u]));
  const peopleByName = new Map<string, { id: string; email: string }[]>();
  for (const u of byName) peopleByName.set(u.name.toLowerCase(), [...(peopleByName.get(u.name.toLowerCase()) ?? []), u]);

  const byAppName = new Map<string, string[]>();
  const byFull = new Map<string, string>();
  for (const a of catalog) {
    byAppName.set(norm(a.name), [...(byAppName.get(norm(a.name)) ?? []), a.id]);
    byFull.set(norm(`${a.dept} / ${a.name}`), a.id);
  }

  // The first row to use an email owns it; later ones are duplicates.
  const firstRowOf = new Map<string, number>();
  for (const r of rows) {
    const e = r.email.trim().toLowerCase();
    if (e && !firstRowOf.has(e)) firstRowOf.set(e, r.row);
  }

  const checks = new Map<number, RowCheck>();
  const plans = new Map<number, Plan>();

  for (const raw of rows) {
    const email = raw.email.trim().toLowerCase();
    const name = raw.name.trim();
    const errors: string[] = [], warnings: string[] = [], suggestions: string[] = [];
    const check: RowCheck = { row: raw.row, name, email, status: "valid", action: "create", errors, warnings, suggestions };
    checks.set(raw.row, check);

    if (email && firstRowOf.get(email) !== raw.row) {
      errors.push(`Row ${firstRowOf.get(email)} already uses this email.`);
      check.status = "duplicate"; check.action = "none";
      continue;
    }
    if (!name) errors.push("Name is missing.");
    else if (name.length > 120) errors.push("Name is longer than 120 characters.");
    if (!email) errors.push("Email is missing.");
    else if (!emailSchema.safeParse(email).success) errors.push(`"${email}" is not a valid email address.`);
    else if (!isEmailAllowed(email)) errors.push(`Email must end with ${domainsLabel()}.`);
    else if (isEnvAdmin(email)) errors.push("That address is the main admin, which is set in the environment settings.");

    // Only the name and the email are required. An optional value that cannot be used (a branch, team, manager, role or application that
    // is not found) is left empty with a warning, and the person is still added; it can be set later on their profile.
    const role = ROLE_WORDS[norm(raw.role)] ?? "member";
    if (!ROLE_WORDS[norm(raw.role)]) warnings.push(`Role "${raw.role}" is not recognised, so they are added as a User. Other roles are given on their profile.`);

    const need = (kind: string, value: string, names: string[]) => {
      const s = suggest(value, names);
      warnings.push(`${kind} "${value}" was not found${s ? ` (did you mean "${s}"?)` : ""}, so it was left empty.`);
    };

    let branchId: string | null = null, teamId: string | null = null;
    if (raw.branch.trim()) {
      const b = brByName.get(norm(raw.branch));
      if (!b) need("Branch", raw.branch, brs.map((x) => x.name));
      else if (!b.isActive) warnings.push(`Branch "${b.name}" is inactive, so it was left empty.`);
      else branchId = b.id;
    }
    if (raw.team.trim()) {
      const t = teamByName.get(norm(raw.team));
      if (!t) need("Team", raw.team, tms.map((x) => x.name));
      else if (!t.isActive) warnings.push(`Team "${t.name}" is inactive, so it was left empty.`);
      else {
        teamId = t.id;
        if (t.branchId && branchId && t.branchId !== branchId) { teamId = null; warnings.push(`Team "${t.name}" belongs to branch "${branchName.get(t.branchId) ?? "another branch"}", not "${raw.branch.trim()}", so the team was left empty.`); }
        else if (t.branchId && !branchId) { branchId = t.branchId; warnings.push(`Branch set to "${branchName.get(t.branchId)}", the team's branch.`); }
      }
    }

    // Reporting manager: by email (an existing account, or another row in this file) or by an exact, unique name.
    let managerId: string | null = null, managerEmail: string | null = null, managerRow: number | null = null;
    const mt = raw.manager.trim();
    if (mt) {
      if (mt.includes("@")) {
        const me = mt.toLowerCase();
        managerEmail = me;
        const dbUser = userByEmail.get(me);
        if (me === email) { managerEmail = null; warnings.push("A person cannot be their own reporting manager, so it was left empty."); }
        else if (dbUser) {
          if (!dbUser.isActive || dbUser.status !== "approved") { managerEmail = null; warnings.push(`Reporting manager ${me} is inactive, so it was left empty.`); }
          else managerId = dbUser.id;
        } else if (firstRowOf.has(me)) managerRow = firstRowOf.get(me)!;
        else { managerEmail = null; warnings.push(`Reporting manager ${me} has no account and is not in this file, so it was left empty.`); }
      } else {
        const found = peopleByName.get(mt.toLowerCase()) ?? [];
        if (found.length === 1) { managerId = found[0].id; managerEmail = found[0].email; }
        else if (found.length > 1) warnings.push(`Several people are called "${mt}", so the manager was left empty. Write the manager's email instead.`);
        else warnings.push(`Reporting manager "${mt}" was not found, so it was left empty. Write their email.`);
      }
    }

    const appIds: string[] = [];
    for (const token of raw.applications.split(/[,;|]/).map((s) => s.trim()).filter(Boolean)) {
      const full = byFull.get(norm(token));
      const named = byAppName.get(norm(token));
      if (full) appIds.push(full);
      else if (named?.length === 1) appIds.push(named[0]);
      else if (named && named.length > 1) warnings.push(`Application "${token}" exists in several application categories, so it was not given. Write it as Category / App.`);
      else need("Application", token, catalog.map((a) => a.name));
    }

    const existing = email ? userByEmail.get(email) : undefined;
    let action: RowAction = "create";
    // An Admin may only touch plain users: a row naming the Support Admin, the Super Admin or another Admin is refused.
    if (existing && policy.existing === "update" && !canUpdateByImport(actor, existing)) errors.push("You cannot change that person's account.");
    if (existing) {
      if (policy.existing === "skip") { action = "skip"; check.status = "exists"; warnings.push("This person already has an account. Nothing will change."); }
      else { action = "update"; warnings.push("This person already has an account. Their branch, team, manager and designation will be updated, and the applications added. Role, password and status are never changed."); }
    }
    check.action = errors.length ? "none" : action;
    if (errors.length) check.status = suggestions.length ? "needs_correction" : "invalid";
    plans.set(raw.row, {
      row: raw, email, name, role: role ?? "member", branchId, teamId, managerId, managerEmail, managerRow, designation: raw.designation.trim() || null,
      appIds: [...new Set(appIds)], existingId: existing?.id ?? null, action: check.action,
    });
  }

  // A manager who is a row in this file must be a person who will actually be created, and the chain must not loop.
  const bad = (n: number) => { const c = checks.get(n)!; return c.errors.length > 0 || c.status === "duplicate"; };
  for (let pass = 0; pass < rows.length; pass++) {
    let changed = false;
    for (const [n, p] of plans) {
      const c = checks.get(n)!;
      if (c.errors.length || p.managerRow == null) continue;
      if (bad(p.managerRow)) {
        c.errors.push(`Its reporting manager (row ${p.managerRow}) has errors, so this person cannot be linked to them yet.`);
        c.status = "invalid"; c.action = "none"; p.action = "none"; changed = true;
      }
    }
    if (!changed) break;
  }
  for (const [n, p] of plans) {
    const c = checks.get(n)!;
    if (c.errors.length) continue;
    let cur: number | null = p.managerRow;
    const seen = new Set<number>([n]);
    while (cur != null) {
      if (seen.has(cur)) { c.errors.push("This reporting line goes round in a loop."); c.status = "invalid"; c.action = "none"; p.action = "none"; break; }
      seen.add(cur);
      cur = plans.get(cur)?.managerRow ?? null;
    }
  }
  // Someone who already has an account must not be placed above their own manager.
  for (const [n, p] of plans) {
    const c = checks.get(n)!;
    if (c.errors.length || p.action !== "update" || !p.existingId || !p.managerId) continue;
    if (await managerChainReaches(p.managerId, p.existingId)) {
      c.errors.push("That reporting manager already reports to this person, which would make a loop.");
      c.status = "invalid"; c.action = "none"; p.action = "none";
    }
  }

  // Managers first: a person is created only after the person they report to.
  const order: number[] = [];
  const done = new Set<number>();
  const visit = (n: number, depth = 0) => {
    if (done.has(n) || depth > rows.length) return;
    const p = plans.get(n);
    if (p?.managerRow != null) visit(p.managerRow, depth + 1);
    done.add(n);
    if (p && (p.action === "create" || p.action === "update")) order.push(n);
  };
  for (const r of rows) visit(r.row);

  return { checks: rows.map((r) => checks.get(r.row)!), plans, order };
}

export type ImportSummary = { total: number; valid: number; needsCorrection: number; invalid: number; duplicate: number; exists: number; willCreate: number; willUpdate: number };

/** Reads every row and reports. Writes nothing. */
export async function checkImport(actor: Actor, rows: ImportRow[], policy: ImportPolicy) {
  if (!canImportUsers(actor)) throw new UserError("You are not allowed to add people in bulk.");
  const { checks, order } = await analyse(rows, policy, actor);
  const count = (s: RowStatus) => checks.filter((c) => c.status === s).length;
  const summary: ImportSummary = {
    total: checks.length, valid: count("valid"), needsCorrection: count("needs_correction"), invalid: count("invalid"), duplicate: count("duplicate"), exists: count("exists"),
    willCreate: checks.filter((c) => c.action === "create").length, willUpdate: checks.filter((c) => c.action === "update").length,
  };
  return { checks, order, summary };
}

type Outcome = "created" | "updated" | "skipped" | "invalid" | "failed";
type Invitation = "sent" | "failed" | "manual" | "not_sent" | "none";
export type RowOutcome = { row: number; name: string; email: string; outcome: Outcome; message: string; invitation: Invitation; link?: string };
export const BATCH_ROWS = 25;

/**
 * Processes some of the rows (the client sends the whole file each time, plus the row numbers to do now, in the order the check gave).
 * Everything is re-checked here against the live data: nothing the browser says about a row is trusted.
 */
export async function commitBatch(actor: Actor & { name: string }, rows: ImportRow[], policy: ImportPolicy, only: number[], opts: { invite: boolean }): Promise<RowOutcome[]> {
  if (!canImportUsers(actor)) throw new UserError("You are not allowed to add people in bulk.");
  if (only.length === 0 || only.length > BATCH_ROWS) throw new UserError(`Send between 1 and ${BATCH_ROWS} rows at a time.`);
  const { checks, plans } = await analyse(rows, policy, actor);
  const checkOf = new Map(checks.map((c) => [c.row, c]));
  const results: RowOutcome[] = [];
  const audit: AuditEntry[] = [];
  const toMail: { index: number; name: string; email: string; token: string }[] = [];

  for (const n of only) {
    const c = checkOf.get(n), p = plans.get(n);
    if (!c) { results.push({ row: n, name: "", email: "", outcome: "failed", message: "That row is not in the file.", invitation: "none" }); continue; }
    const base = { row: n, name: c.name, email: c.email };
    if (!p) { results.push({ ...base, outcome: "invalid", message: c.errors.join(" ") || "Not processed.", invitation: "none" }); continue; }
    if (c.errors.length || p.action === "none") { results.push({ ...base, outcome: "invalid", message: c.errors.join(" ") || "Not processed.", invitation: "none" }); continue; }
    if (p.action === "skip") { results.push({ ...base, outcome: "skipped", message: "Already has an account. Not changed.", invitation: "none" }); continue; }

    try {
      // A manager created earlier in this very import is an ordinary account by now.
      let managerId = p.managerId;
      if (!managerId && p.managerEmail) {
        const [m] = await db.select({ id: users.id }).from(users).where(and(eq(users.email, p.managerEmail), eq(users.isActive, true)));
        if (!m) { results.push({ ...base, outcome: "failed", message: `Reporting manager ${p.managerEmail} could not be found (was their row created?).`, invitation: "none" }); continue; }
        managerId = m.id;
      }

      if (p.action === "update" && p.existingId) {
        const set: Partial<typeof users.$inferInsert> = {};
        if (p.branchId) set.branchId = p.branchId;
        if (p.teamId) set.teamId = p.teamId;
        if (managerId) set.reportingManagerId = managerId;
        if (p.designation) set.designation = p.designation;
        if (Object.keys(set).length) await db.update(users).set(set).where(eq(users.id, p.existingId));
        let added = 0;
        if (p.appIds.length) added = (await applyAccess(actor, { userIds: [p.existingId], appIds: p.appIds, mode: "add", source: "import" })).changed.reduce((k, ch) => k + ch.added.length, 0);
        audit.push({ action: "user.update", targetType: "user", targetId: p.existingId, targetLabel: p.name, details: { source: "import", fields: Object.keys(set) } });
        results.push({ ...base, outcome: "updated", message: `Updated${added ? `, ${added} application${added > 1 ? "s" : ""} added` : ""}.`, invitation: "none" });
        continue;
      }

      const token = opts.invite ? tempPassword() : null;
      const id = await createAccount(actor, {
        name: p.name, email: p.email, role: p.role, branchId: p.branchId, teamId: p.teamId, managerId, designation: p.designation,
        appIds: p.appIds, passwordHash: token ? await hashPassword(token) : null, mustChangePassword: !!token, inviteTokenHash: token ? hashToken(token) : null, source: "import",
      });
      if (!id) { results.push({ ...base, outcome: "skipped", message: "Already has an account. Not changed.", invitation: "none" }); continue; }

      audit.push({
        action: "user.create", targetType: "user", targetId: id, targetLabel: p.name,
        details: { source: "import", role: p.role, applications: p.appIds.length, branch: !!p.branchId, team: !!p.teamId, manager: !!managerId },
      });
      results.push({ ...base, outcome: "created", message: p.appIds.length ? `Created with ${p.appIds.length} application${p.appIds.length > 1 ? "s" : ""}.` : "Created with no applications.", invitation: opts.invite ? "not_sent" : "none" });
      if (token) toMail.push({ index: results.length - 1, name: p.name, email: p.email, token });
    } catch (e) {
      console.error("import row failed", e instanceof Error ? e.message : e);
      results.push({ ...base, outcome: "failed", message: "Could not save this row. Nothing was created for it; run it again.", invitation: "none" });
    }
  }

  // Sign-in emails, a few at a time. The temporary password is returned to the administrator only when it could not be emailed.
  for (let i = 0; i < toMail.length; i += 5) {
    await Promise.all(toMail.slice(i, i + 5).map(async (m) => {
      const r = results[m.index];
      const { delivery, link } = await deliverInvite(m, m.token);
      r.invitation = delivery;
      if (link) r.link = link;
    }));
  }

  const tally = (o: Outcome) => results.filter((r) => r.outcome === o).length;
  audit.push({ action: "import.batch", targetType: "import", targetLabel: `${results.length} rows`, details: { created: tally("created"), updated: tally("updated"), skipped: tally("skipped"), invalid: tally("invalid"), failed: tally("failed") } });
  try {
    await writeAudit(actor, audit);
  } catch (e) {
    console.error("audit write failed", e);
    throw new UserError("The accounts were processed, but the change could not be recorded in the audit log. Please tell an administrator.");
  }
  return results;
}

