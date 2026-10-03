"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { apps, departments, userAppAccess, users } from "@/db/schema";
import { isEnvAdmin } from "@/lib/auth";
import { hashPassword, passwordSchema } from "@/lib/passwords";
import { adminAction, UserError } from "@/lib/action";
import { domainsLabel, isEmailAllowed } from "@/lib/domains";
import { emailSchema, uuid } from "@/lib/validation";

function checkDomain(email: string) {
  if (!isEmailAllowed(email)) throw new UserError(`Email must end with ${domainsLabel()}`);
}

const optionalText = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);

const newUser = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: emailSchema,
  password: passwordSchema,
  designation: optionalText(120),
  homeDepartmentId: uuid.nullish().transform((v) => v ?? null),
});

/** One person, with the password they will sign in with. Everyone created here is a normal user; the main admin is set in the environment. */
export async function createUser(input: unknown) {
  return adminAction(async (admin) => {
    const v = newUser.parse(input);
    checkDomain(v.email);
    if (isEnvAdmin(v.email)) throw new UserError("That address is the main admin, which is set in the environment settings.");
    const { password, ...rest } = v;
    await db.insert(users).values({ ...rest, passwordHash: await hashPassword(password), signupSource: "admin", reviewedAt: new Date(), reviewedById: admin.id });
  });
}

export async function resetPassword(id: string, password: unknown) {
  return adminAction(async () => {
    uuid.parse(id);
    const pw = passwordSchema.parse(password);
    const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, id));
    if (!u) throw new UserError("User not found.");
    if (isEnvAdmin(u.email)) throw new UserError("The main admin's password is set in the environment settings (HEAD_ADMIN_PASSWORD).");
    await db.update(users).set({ passwordHash: await hashPassword(pw) }).where(eq(users.id, id)); // also signs them out everywhere
  });
}

/** Users are never hard-deleted so the activity log keeps its history. A deactivated person is signed out at once. */
export async function setUserActive(id: string, active: boolean) {
  return adminAction(async (admin) => {
    uuid.parse(id);
    const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, id));
    if (!u) throw new UserError("User not found.");
    if (!active && (id === admin.id || isEnvAdmin(u.email))) throw new UserError("The main admin cannot be deactivated.");
    await db.update(users).set({ isActive: !!active }).where(eq(users.id, id));
  });
}

const importRow = z.object({
  line: z.number().int().min(1),
  name: z.string().trim().max(120),
  email: z.string().trim().toLowerCase().max(200),
  password: z.string().max(200).default(""),
  department: z.string().trim().max(120).default(""),
  applications: z.string().max(2000).default(""), // "App A, App B" or "Dept / App"
  designation: z.string().trim().max(120).default(""),
});

export type ImportResult = {
  line: number; email: string; name: string; status: "created" | "skipped" | "error"; message: string;
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s*\/\s*/g, " / ").replace(/\s+/g, " ");

/**
 * Bulk setup from a CSV: creates each user with their password, home department and the listed applications. An application name
 * is looked up in the user's own department first, then across all departments (it must be unique there), or can be
 * written as "Department / App". Callers send a few rows at a time so a big file never hits the request time limit,
 * and one bad row never blocks the others. Existing emails are skipped, never changed.
 */
export async function importUsers(rows: unknown) {
  return adminAction(async (admin): Promise<ImportResult[]> => {
    const list = z.array(importRow).min(1).max(25).parse(rows);

    const [deps, catalog] = await Promise.all([
      db.select({ id: departments.id, name: departments.name }).from(departments),
      db
        .select({ id: apps.id, name: apps.name, departmentId: apps.departmentId, dept: departments.name })
        .from(apps)
        .innerJoin(departments, eq(departments.id, apps.departmentId))
        .where(and(eq(apps.isActive, true), eq(departments.isActive, true))),
    ]);
    const deptByName = new Map(deps.map((d) => [norm(d.name), d.id]));
    const inDept = new Map<string, string>(); // `${departmentId}|${app name}` -> app id
    const byName = new Map<string, string[]>();
    const byFull = new Map<string, string>();
    for (const a of catalog) {
      inDept.set(`${a.departmentId}|${norm(a.name)}`, a.id);
      byName.set(norm(a.name), [...(byName.get(norm(a.name)) ?? []), a.id]);
      byFull.set(norm(`${a.dept} / ${a.name}`), a.id);
    }

    const out: ImportResult[] = [];
    for (const r of list) {
      const base = { line: r.line, email: r.email, name: r.name };
      try {
        const email = emailSchema.parse(r.email);
        if (!r.name) throw new UserError("Name is missing.");
        checkDomain(email);
        if (isEnvAdmin(email)) throw new UserError("That address is the main admin, set in the environment settings.");
        const password = passwordSchema.safeParse(r.password.trim());
        if (!password.success) throw new UserError(r.password.trim() ? (password.error.issues[0]?.message ?? "Invalid password.") : "Password is missing.");

        let departmentId: string | null = null;
        if (r.department) {
          departmentId = deptByName.get(norm(r.department)) ?? null;
          if (!departmentId) throw new UserError(`Department "${r.department}" was not found. Add it under Departments first.`);
        }

        const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
        if (existing) {
          out.push({ ...base, status: "skipped", message: "Already exists. Not changed." });
          continue;
        }

        const appIds: string[] = [];
        for (const token of r.applications.split(/[,;|]/).map((s) => s.trim()).filter(Boolean)) {
          const own = departmentId ? inDept.get(`${departmentId}|${norm(token)}`) : undefined;
          const full = byFull.get(norm(token));
          const named = byName.get(norm(token));
          if (own) appIds.push(own);
          else if (full) appIds.push(full);
          else if (named?.length === 1) appIds.push(named[0]);
          else if (named && named.length > 1) throw new UserError(`"${token}" exists in several departments. Write it as Department / App.`);
          else throw new UserError(`Application "${token}" was not found.`);
        }

        const [u] = await db
          .insert(users)
          .values({
            name: r.name, email, designation: r.designation || null, homeDepartmentId: departmentId,
            passwordHash: await hashPassword(password.data), signupSource: "csv", reviewedAt: new Date(), reviewedById: admin.id,
          })
          .returning({ id: users.id });
        const unique = [...new Set(appIds)];
        if (unique.length) {
          await db.insert(userAppAccess).values(unique.map((appId) => ({ userId: u.id, appId, grantedById: admin.id }))).onConflictDoNothing();
        }
        out.push({ ...base, status: "created", message: unique.length ? `Created with ${unique.length} application${unique.length > 1 ? "s" : ""}.` : "Created with no applications." });
      } catch (e) {
        const msg = e instanceof UserError ? e.message : e instanceof z.ZodError ? (e.issues[0]?.message ?? "Invalid row.") : "Could not save this row.";
        if (!(e instanceof UserError) && !(e instanceof z.ZodError)) console.error(e);
        out.push({ ...base, status: "error", message: msg });
      }
    }
    return out;
  });
}
