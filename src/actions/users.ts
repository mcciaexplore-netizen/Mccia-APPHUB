"use server";

import { and, count, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { adminAction, UserError } from "@/lib/action";
import { clearLoginFailures } from "@/lib/login-guard";
import { hashPassword, passwordSchema } from "@/lib/passwords";
import { emailSchema, roleSchema, uuid } from "@/lib/validation";

const domain = () => (process.env.ALLOWED_EMAIL_DOMAIN ?? "").trim().toLowerCase();

function checkDomain(email: string) {
  if (domain() && !email.endsWith(`@${domain()}`)) throw new UserError(`Email must end with @${domain()}`);
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
    await clearLoginFailures(u.email); // also unlocks the account
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
