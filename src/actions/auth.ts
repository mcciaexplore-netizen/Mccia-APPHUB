"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { authenticate, checkPassword, isEnvAdmin, recordLogin, userFingerprint } from "@/lib/auth";
import { clientIp } from "@/lib/ip";
import { hashPassword, passwordSchema } from "@/lib/passwords";
import { getCurrentUser } from "@/lib/permissions";
import { ADMIN_COOKIE, ADMIN_IDLE, SESSION_COOKIE, SESSION_MAX_AGE, cookieOptions, safeNext, sign } from "@/lib/session";

const isHttps = async () => (await headers()).get("x-forwarded-proto") === "https" || process.env.NODE_ENV === "production";
const back = (path: string, next: string) => `${path}?error=1${next !== "/" ? `&next=${encodeURIComponent(next)}` : ""}`;

/** Email + password. A wrong password just fails and can be tried again straight away. */
export async function login(formData: FormData) {
  const next = safeNext(formData.get("next"));
  const user = await authenticate(String(formData.get("email") ?? ""), String(formData.get("password") ?? ""));
  if (!user) redirect(back("/login", next));
  (await cookies()).set(SESSION_COOKIE, sign(user.id, userFingerprint(user), "session", SESSION_MAX_AGE), cookieOptions(SESSION_MAX_AGE, await isHttps()));
  await recordLogin(user, clientIp(await headers()));
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
  const target = next.startsWith("/administrator") ? next : "/administrator/departments";
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "head_admin") redirect("/");
  if (!(await checkPassword(user, String(formData.get("password") ?? "")))) redirect(back("/unlock", next));
  (await cookies()).set(ADMIN_COOKIE, sign(user.id, "", "admin", ADMIN_IDLE), cookieOptions(undefined, await isHttps()));
  redirect(target);
}

/** Called by the sidebar the moment you really leave Administrator. */
export async function lockAdmin() {
  (await cookies()).delete(ADMIN_COOKIE);
}

type Result = { ok: true } | { ok: false; error: string };

/** Someone changing their own password. The main admin's password lives in the environment, so it cannot be changed here. */
export async function changePassword(input: unknown): Promise<Result> {
  try {
    const me = await getCurrentUser();
    if (!me) return { ok: false, error: "Please sign in again." };
    if (isEnvAdmin(me.email)) return { ok: false, error: "The main admin's password is set in the environment settings (HEAD_ADMIN_PASSWORD)." };
    const v = z.object({ current: z.string().min(1, "Enter your current password"), next: passwordSchema }).parse(input);
    if (!(await checkPassword(me, v.current))) return { ok: false, error: "Current password is incorrect." };
    if (v.current === v.next) return { ok: false, error: "Choose a password different from the current one." };
    const hash = await hashPassword(v.next);
    await db.update(users).set({ passwordHash: hash, mustChangePassword: false }).where(eq(users.id, me.id));
    // Keep this browser signed in under the new password; every other sign-in is now invalid.
    (await cookies()).set(SESSION_COOKIE, sign(me.id, userFingerprint({ email: me.email, passwordHash: hash }), "session", SESSION_MAX_AGE), cookieOptions(SESSION_MAX_AGE, await isHttps()));
    return { ok: true };
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input" };
    console.error(e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
