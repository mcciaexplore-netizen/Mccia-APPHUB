import { z } from "zod";

/**
 * The rules of drivers' phone sign-in, with no server code, so the unit tests and the sign-in page can use them too. The server half is
 * driver-session.ts.
 */

export const DRIVER_SESSION_COOKIE = "cab_driver_session";
/** A sign-in lasts a shift: the cookie and the session both end after 12 hours. */
export const DRIVER_SESSION_HOURS = 12;
/** A code from an admin works once, within 24 hours. */
export const LOGIN_OTP_HOURS = 24;
/** Wrong tries a code allows; the fifth wrong one locks it until an admin makes a new one. */
export const LOGIN_MAX_ATTEMPTS = 5;
/** A wrong, used or expired code. */
export const LOGIN_REFUSED = "Invalid OTP. Try again.";
export const LOGIN_LOCKED = "OTP locked. Ask your admin for a new OTP.";
export const PHONE_NOT_FOUND = "Phone number not found. Contact your admin to be added as a driver.";
/** Asking for access again within this many minutes does not tell the admins again. */
export const ACCESS_NOTICE_MINUTES = 15;

/**
 * A phone as a driver types it, in the form drivers' phones are kept (digits, with a leading + when given; see normalisePhone), plus its
 * last 10 digits for a number typed without (or with a different) country code. Null when it has fewer than 10 digits.
 */
export function loginPhone(raw: string): { exact: string; last10: string } | null {
  const t = raw.trim();
  const digits = t.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  return { exact: (t.startsWith("+") ? "+" : "") + digits, last10: digits.slice(-10) };
}

/**
 * Which driver a phone means: the one whose number is exactly it; failing that, the one whose number ends in the same 10 digits, but
 * only when exactly one does (two drivers sharing those digits is never guessed between).
 */
export function pickDriver<T extends { phone: string }>(drivers: T[], phone: { exact: string; last10: string }): T | null {
  const exact = drivers.find((d) => d.phone === phone.exact);
  if (exact) return exact;
  const tail = drivers.filter((d) => d.phone.replace(/\D/g, "").slice(-10) === phone.last10);
  return tail.length === 1 ? tail[0]! : null;
}

/** Step 1 of the sign-in: who the driver says they are. */
export const driverAccessInput = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(100),
  phone: z.string().max(30),
});

/** Step 2: the code the admin gave them. */
export const driverLoginInput = z.object({
  phone: z.string().max(30),
  otp: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit OTP."),
});
