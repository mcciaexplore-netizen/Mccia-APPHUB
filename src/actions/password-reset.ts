"use server";

import { cookies, headers } from "next/headers";
import { after } from "next/server";
import { z } from "zod";
import { clientIp } from "@/lib/ip";
import { logError } from "@/lib/log-error";
import { completePasswordReset, requestPasswordReset } from "@/lib/password-reset";
import { resetPasswordSchema } from "@/lib/password-reset-rules";
import { ADMIN_COOKIE, SESSION_COOKIE } from "@/lib/session";

/**
 * "Send reset link". Always the same answer, straight away: the account is looked up and the email sent only after the answer has gone
 * back (after()), so neither the answer nor how long it took says whether the email has an account. Limits: src/lib/password-reset.ts.
 */
export async function sendResetLink(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = z.object({ email: z.string().trim().min(1, "Enter your email").max(320) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Enter your email" };
  const ip = clientIp(await headers());
  const email = parsed.data.email;
  after(async () => {
    await requestPasswordReset(email, ip);
  });
  return { ok: true };
}

/** "Reset password", from the emailed link. On success this browser is signed out too (the new password already signed out every other). */
export async function resetPassword(input: unknown): Promise<{ ok: true } | { ok: false; error: string; expired?: boolean }> {
  try {
    const v = z.object({ token: z.string().max(200), password: z.string().max(200), again: z.string().max(200) }).parse(input);
    if (v.password !== v.again) return { ok: false, error: "The two passwords do not match." };
    const rule = resetPasswordSchema.safeParse(v.password);
    if (!rule.success) return { ok: false, error: rule.error.issues[0]?.message ?? "Choose a stronger password." };
    if (!(await completePasswordReset(v.token, v.password))) return { ok: false, expired: true, error: "This reset link has expired or is invalid." };
    const jar = await cookies();
    jar.delete(SESSION_COOKIE);
    jar.delete(ADMIN_COOKIE);
    return { ok: true };
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: "Something was missing. Please try again." };
    logError("[reset] reset failed", e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
