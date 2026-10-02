"use server";

import { and, count, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { apps, departments, userAppAccess, users } from "@/db/schema";
import { adminAction, UserError } from "@/lib/action";
import { clearLoginFailures } from "@/lib/login-guard";
import { domainsLabel, isEmailAllowed } from "@/lib/domains";
import { generatePassword } from "@/lib/generate-password";
import { hashPassword, passwordSchema } from "@/lib/passwords";
import { emailSchema, roleSchema, uuid } from "@/lib/validation";

function checkDomain(email: string) {
  if (!isEmailAllowed(email)) throw new UserError(`Email must end with ${domainsLabel()}`);
}

/** Blocks any change that would leave zero active head admins. */
async function assertNotLastAdmin(userId: string, willStillBeActiveAdmin: boolean) {
  if (willStillBeActiveAdmin) return;
  const [cur] = await db.select().from(users).where(eq(users.id, userId));
  if (!cur || cur.role !== "head_admin" || !cur.isActive) return;
  const [{ n }] = await db
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.role, "head_admin"), eq(users.isActive, true), ne(users.id, userId)));
  if (n === 0) throw new UserError("There must always be at least one active head admin.");
}

const optionalText = (max: number) =>
  z.string().trim().max(max).nullish().transform((v) => v || null);

const userInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: emailSchema,
  phone: optionalText(30),
  designation: optionalText(120),
  role: roleSchema,
  homeDepartmentId: uuid.nullish().transform((v) => v ?? null),
});

/** The admin sets a temporary password; the user must replace it on first login. */
export async function createUser(input: unknown) {
  return adminAction(async () => {
    const v = userInput.extend({ tempPassword: passwordSchema }).parse(input);
    checkDomain(v.email);
    const { tempPassword, ...rest } = v;
    await db.insert(users).values({ ...rest, passwordHash: await hashPassword(tempPassword), mustChangePassword: true });
  });
}

export async function updateUser(id: string, input: unknown) {
  return adminAction(async () => {
    uuid.parse(id);
    const v = userInput.omit({ email: true }).parse(input);
    await assertNotLastAdmin(id, v.role === "head_admin");
    await db.update(users).set(v).where(eq(users.id, id));
  });
}

export async function resetPassword(id: string, tempPassword: unknown) {
  return adminAction(async () => {
    uuid.parse(id);
    const pw = passwordSchema.parse(tempPassword);
    const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, id));
    if (!u) throw new UserError("User not found.");
    await db.update(users).set({ passwordHash: await hashPassword(pw), mustChangePassword: true }).where(eq(users.id, id));
    await clearLoginFailures(u.email);
  });
}

/** Users are never hard-deleted so the activity log keeps its history. */
export async function setUserActive(id: string, active: boolean) {
  return adminAction(async () => {
    uuid.parse(id);
    await assertNotLastAdmin(id, !!active);
    await db.update(users).set({ isActive: !!active }).where(eq(users.id, id));
  });
}

/** Accepts a pending (or previously rejected) sign-up. The admin then grants apps on the Access page. */
export async function approveUser(id: string) {
  return adminAction(async (admin) => {
    uuid.parse(id);
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, id));
    if (!u) throw new UserError("User not found.");
    await db.update(users).set({ status: "approved", reviewedAt: new Date(), reviewedById: admin.id }).where(eq(users.id, id));
  });
}

/** Rejected people cannot sign in or use the hub. They stay in the list so an admin can accept them later. */
export async function rejectUser(id: string) {
  return adminAction(async (admin) => {
    uuid.parse(id);
    if (id === admin.id) throw new UserError("You cannot reject yourself.");
    const [u] = await db.select({ role: users.role }).from(users).where(eq(users.id, id));
    if (!u) throw new UserError("User not found.");
    if (u.role === "head_admin") throw new UserError("A head admin cannot be rejected. Change their role first.");
    await db.update(users).set({ status: "rejected", reviewedAt: new Date(), reviewedById: admin.id }).where(eq(users.id, id));
  });
}

// ---- CSV import -------------------------------------------------------------------------------------------------

const importRow = z.object({
  line: z.number().int().min(1),
  email: z.string().trim().toLowerCase().max(200),
  name: z.string().trim().max(120),
  password: z.string().max(200).default(""), // blank: a password is generated
  designation: z.string().trim().max(120).default(""),
  apps: z.string().max(2000).default(""), // "App; Department / App; ..."
});

export type ImportResult = {
  line: number; email: string; name: string; status: "created" | "skipped" | "error"; message: string;
  password?: string; apps: string[];
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s*\/\s*/g, " / ").replace(/\s+/g, " ");

/**
 * Creates approved users from CSV rows, each with a temporary password and the listed apps. Callers send a few rows
 * at a time (bcrypt is slow), so a big file never hits the request time limit. One bad row never blocks the others.
 */
export async function importUsers(rows: unknown) {
  return adminAction(async (admin): Promise<ImportResult[]> => {
    const list = z.array(importRow).min(1).max(10).parse(rows);

    const catalog = await db
      .select({ id: apps.id, name: apps.name, dept: departments.name })
      .from(apps)
      .innerJoin(departments, eq(departments.id, apps.departmentId))
      .where(and(eq(apps.isActive, true), eq(departments.isActive, true)));
    const byName = new Map<string, string[]>();
    const byFull = new Map<string, string>();
    for (const a of catalog) {
      byName.set(norm(a.name), [...(byName.get(norm(a.name)) ?? []), a.id]);
      byFull.set(norm(`${a.dept} / ${a.name}`), a.id);
    }

    const out: ImportResult[] = [];
    for (const r of list) {
      const base = { line: r.line, email: r.email, name: r.name, apps: [] as string[] };
      try {
        const email = emailSchema.parse(r.email);
        if (!r.name) throw new UserError("Name is missing.");
        checkDomain(email);

        const [existing] = await db.select({ status: users.status }).from(users).where(eq(users.email, email));
        if (existing) {
          out.push({ ...base, status: "skipped", message: `Already has an account (${existing.status}). Not changed.` });
          continue;
        }

        const appIds: string[] = [];
        for (const token of r.apps.split(/[;|]/).map((s) => s.trim()).filter(Boolean)) {
          const full = byFull.get(norm(token));
          const named = byName.get(norm(token));
          if (full) appIds.push(full);
          else if (named?.length === 1) appIds.push(named[0]);
          else if (named && named.length > 1) throw new UserError(`"${token}" matches several apps. Write it as Department / App.`);
          else throw new UserError(`App "${token}" was not found.`);
        }

        const password = r.password.trim() ? passwordSchema.parse(r.password.trim()) : generatePassword();
        const [u] = await db
          .insert(users)
          .values({
            name: r.name, email, designation: r.designation || null, passwordHash: await hashPassword(password),
            mustChangePassword: true, status: "approved", signupSource: "csv", reviewedAt: new Date(), reviewedById: admin.id,
          })
          .returning({ id: users.id });
        const unique = [...new Set(appIds)];
        if (unique.length) {
          await db.insert(userAppAccess).values(unique.map((appId) => ({ userId: u.id, appId, grantedById: admin.id }))).onConflictDoNothing();
        }
        out.push({ ...base, status: "created", message: unique.length ? `Created with ${unique.length} app${unique.length > 1 ? "s" : ""}.` : "Created with no apps.", password, apps: r.apps.split(/[;|]/).map((s) => s.trim()).filter(Boolean) });
      } catch (e) {
        const msg = e instanceof UserError ? e.message : e instanceof z.ZodError ? (e.issues[0]?.message ?? "Invalid row.") : "Could not save this row.";
        if (!(e instanceof UserError) && !(e instanceof z.ZodError)) console.error(e);
        out.push({ ...base, status: "error", message: msg });
      }
    }
    return out;
  });
}
