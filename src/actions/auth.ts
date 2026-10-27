"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { userInvites, users } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { authenticate, checkPassword, isEnvAdmin, recordLogin, userFingerprint } from "@/lib/auth";
import { clientIp } from "@/lib/ip";
import { hashPassword, passwordSchema } from "@/lib/passwords";
import { record, refuseOrSlow } from "@/lib/sign-in-limits";
import { getCurrentUser } from "@/lib/permissions";
import { canAdminister } from "@/lib/rbac";
import { ADMIN_COOKIE, ADMIN_IDLE, SESSION_COOKIE, SESSION_MAX_AGE, cookieOptions, safeNext, sign } from "@/lib/session";

const isHttps = async () => (await headers()).get("x-forwarded-proto") === "https" || process.env.NODE_ENV === "production";
const back = (path: string, next: string) => `${path}?error=1${next !== "/" ? `&next=${encodeURIComponent(next)}` : ""}`;

/**
 * Email + password. Every try is recorded, and too many wrong passwords are refused for a while (src/lib/sign-in-limits.ts). A refusal
 * looks exactly like a wrong password, so it tells a guesser nothing.
 */
export async function login(formData: FormData) {
  const next = safeNext(formData.get("next"));
  const email = String(formData.get("email") ?? "");
  const ip = clientIp(await headers());
  if (await refuseOrSlow(email, ip, "login")) redirect(back("/login", next));
  const user = await authenticate(email, String(formData.get("password") ?? ""));
  await record(email, ip, "login", !!user);
  if (!user) redirect(back("/login", next));
  (await cookies()).set(SESSION_COOKIE, sign(user.id, userFingerprint(user), "session", SESSION_MAX_AGE), cookieOptions(SESSION_MAX_AGE, await isHttps()));
  await recordLogin(user, ip);
  redirect(next);
}

export async function logout() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(ADMIN_COOKIE);
  redirect("/login");
}

/** Administrator asks for the password again; it locks again as soon as you leave it (see src/proxy.ts). */
export async function unlockAdmin(formData: FormData) {
  const next = safeNext(formData.get("next"));
  const target = next.startsWith("/administrator") ? next : "/administrator";
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAdminister(user)) redirect("/");
  const ip = clientIp(await headers());
  if (await refuseOrSlow(user.email, ip, "unlock")) redirect(back("/unlock", next));
  const right = await checkPassword(user, String(formData.get("password") ?? ""));
  await record(user.email, ip, "unlock", right);
  if (!right) redirect(back("/unlock", next));
  (await cookies()).set(ADMIN_COOKIE, sign(user.id, "", "admin", ADMIN_IDLE), cookieOptions(undefined, await isHttps()));
  redirect(target);
}

/** Called by the page frame the moment you really leave Administrator. */
export async function lockAdmin() {
  (await cookies()).delete(ADMIN_COOKIE);
}

type Result = { ok: true } | { ok: false; error: string };

/** Someone changing their own password. The main admin's password lives in the environment, so it cannot be changed here. */
export async function changePassword(input: unknown): Promise<Result> {
  try {
    const me = await getCurrentUser();
    if (!me) return { ok: false, error: "Please sign in again." };
    if (isEnvAdmin(me.email)) return { ok: false, error: "This account's password is set in the environment settings, so it cannot be changed here." };
    const v = z.object({ current: z.string().min(1, "Enter your current password"), next: passwordSchema }).parse(input);
    // The same limits as signing in: a refusal gets the same answer as a wrong current password.
    const ip = clientIp(await headers());
    if (await refuseOrSlow(me.email, ip, "password")) return { ok: false, error: "Current password is incorrect." };
    const right = await checkPassword(me, v.current);
    await record(me.email, ip, "password", right);
    if (!right) return { ok: false, error: "Current password is incorrect." };
    if (v.current === v.next) return { ok: false, error: "Choose a password different from the current one." };
    const hash = await hashPassword(v.next);
    await db.update(users).set({ passwordHash: hash, mustChangePassword: false }).where(eq(users.id, me.id));
    // The temporary password they were sent (if any) is used up, and the change is recorded (never the password).
    await db.update(userInvites).set({ usedAt: new Date() }).where(and(eq(userInvites.userId, me.id), isNull(userInvites.usedAt)));
    await writeAudit({ id: me.id, name: me.name }, [{ action: me.mustChangePassword ? "user.password_first_set" : "user.password_changed", targetType: "user", targetId: me.id, targetLabel: me.name }]);
    // Keep this browser signed in under the new password; every other sign-in is now invalid.
    (await cookies()).set(SESSION_COOKIE, sign(me.id, userFingerprint({ email: me.email, passwordHash: hash }), "session", SESSION_MAX_AGE), cookieOptions(SESSION_MAX_AGE, await isHttps()));
    return { ok: true };
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input" };
    console.error(e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
