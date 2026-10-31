import "server-only";
import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { writeCabAudit } from "./audit";
import { CabsError } from "./errors";
import type { CabUser } from "./host-adapter";
import { driverAccessRequested } from "./notify";
import {
  ACCESS_NOTICE_MINUTES, DRIVER_SESSION_COOKIE, DRIVER_SESSION_HOURS, LOGIN_LOCKED, LOGIN_MAX_ATTEMPTS, LOGIN_OTP_HOURS, LOGIN_REFUSED, PHONE_NOT_FOUND,
  loginPhone, pickDriver,
} from "./driver-login-rules";

/**
 * Drivers' sign-in to Cabs Driver by phone, for drivers without a hub account, in two steps on /cabs/driver-login: the driver gives their
 * name and phone and asks for access (the Cabs admins get a bell notice); a Cabs admin makes a 6-digit code on Cabs Admin → Drivers and
 * gives it to the driver by hand (no SMS); the driver enters it and gets a 12-hour session.
 *
 * Nothing that would let someone sign in is stored readable: a code is kept as an HMAC-SHA256 (keyed with AUTH_SECRET and the driver's id,
 * so a copy of the table cannot be tried against the million possible codes), and a session as the SHA-256 of the cookie's random value.
 * Checking a code is ONE statement (the production driver has no transactions): it counts the try and marks the code used only when it
 * matches, so a code works once and the fifth wrong try locks it.
 */

type Actor = Pick<CabUser, "id" | "name">;
const rows = <T,>(res: unknown) => (res as { rows: T[] }).rows;

export type DriverSession = { driverId: string; name: string; phone: string; isAvailable: boolean };

const secret = () => {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return s;
};
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const otpHash = (driverId: string, otp: string) => createHmac("sha256", secret()).update(`cab-driver-otp:${driverId}:${otp}`).digest("hex");

/** The cookie's settings: only the server reads it, and only over HTTPS when the site is on HTTPS. */
export const sessionCookie = (secure: boolean) => ({ httpOnly: true, sameSite: "lax" as const, path: "/", secure, maxAge: DRIVER_SESSION_HOURS * 3600 });

/**
 * A new sign-in code for a driver, from a cryptographic random source, replacing their unused ones. The digits are returned once, for the
 * admin to read out; only their HMAC is kept.
 */
export async function issueLoginOtp(driverId: string, actor: Actor): Promise<{ otp: string; expiresAt: Date; name: string }> {
  const otp = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const [row] = rows<{ name: string; expires_at: string }>(await db.execute(sql`
    with d as (select id, name from cab_drivers where id = ${driverId}),
      gone as (delete from cab_driver_otps where driver_id = (select id from d) and used_at is null),
      made as (insert into cab_driver_otps (driver_id, otp_hash, expires_at, created_by_id, created_by_name)
        select id, ${otpHash(driverId, otp)}, now() + make_interval(hours => ${LOGIN_OTP_HOURS}), ${actor.id}, ${actor.name} from d returning expires_at)
    select d.name, made.expires_at from d, made`));
  if (!row) throw new CabsError("That driver no longer exists. Reload and try again.", 404);
  await writeCabAudit(actor, "driver_login_otp", { subject: row.name });
  return { otp, expiresAt: new Date(row.expires_at), name: row.name };
}

/** The driver a phone number means (see pickDriver), or a 404 saying it is not a driver's. */
async function driverByPhone(rawPhone: string): Promise<{ id: string; name: string; phone: string }> {
  const phone = loginPhone(rawPhone);
  if (!phone) throw new CabsError(PHONE_NOT_FOUND, 404);
  const candidates = rows<{ id: string; name: string; phone: string }>(await db.execute(sql`
    select id, name, phone from cab_drivers where phone = ${phone.exact} or right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = ${phone.last10}`));
  const driver = pickDriver(candidates, phone);
  if (!driver) throw new CabsError(PHONE_NOT_FOUND, 404);
  return driver;
}

/**
 * Step 1: a driver asks for access with their name and phone. A phone that is not a driver's: 404. Otherwise the Cabs admins are told
 * (at most once every 15 minutes per driver), under the name the admins gave the driver. The name typed is only recorded in the audit log.
 */
export async function requestAccess(name: string, rawPhone: string): Promise<{ name: string }> {
  const driver = await driverByPhone(rawPhone);
  await driverAccessRequested(driver, ACCESS_NOTICE_MINUTES);
  await writeCabAudit({ id: driver.id, name: driver.name, via: "phone" } as Actor, "driver_access_requested", { subject: driver.name, details: { nameGiven: name } });
  return { name: driver.name };
}

/**
 * Step 2: signs a driver in with their phone and code. Right: a new session, whose cookie value is returned. Wrong, used or expired: 401.
 * The fifth wrong try on a code (and any try after it): 429. A phone that is not a driver's: 404.
 */
export async function loginWithOtp(rawPhone: string, otp: string): Promise<{ token: string; driver: { id: string; name: string } }> {
  const driver = await driverByPhone(rawPhone);
  const hash = otpHash(driver.id, otp);
  const [tried] = rows<{ ok: boolean; attempts: number }>(await db.execute(sql`
    with o as (select id from cab_driver_otps where driver_id = ${driver.id} and used_at is null and expires_at > now() and attempts < ${LOGIN_MAX_ATTEMPTS}
      order by created_at desc limit 1)
    update cab_driver_otps t set attempts = t.attempts + (case when t.otp_hash = ${hash} then 0 else 1 end),
      used_at = case when t.otp_hash = ${hash} then now() end
    from o where t.id = o.id and t.used_at is null and t.attempts < ${LOGIN_MAX_ATTEMPTS}
    returning t.used_at is not null as ok, t.attempts`));
  if (!tried) {
    const [locked] = rows<{ id: string }>(await db.execute(sql`
      select id from cab_driver_otps where driver_id = ${driver.id} and used_at is null and expires_at > now() and attempts >= ${LOGIN_MAX_ATTEMPTS} limit 1`));
    throw new CabsError(locked ? LOGIN_LOCKED : LOGIN_REFUSED, locked ? 429 : 401);
  }
  if (!tried.ok) throw new CabsError(tried.attempts >= LOGIN_MAX_ATTEMPTS ? LOGIN_LOCKED : LOGIN_REFUSED, tried.attempts >= LOGIN_MAX_ATTEMPTS ? 429 : 401);
  const token = randomBytes(32).toString("base64url");
  await db.execute(sql`insert into cab_driver_sessions (driver_id, token, expires_at) values (${driver.id}, ${sha256(token)}, now() + make_interval(hours => ${DRIVER_SESSION_HOURS}))`);
  await writeCabAudit({ id: driver.id, name: driver.name, via: "phone" } as Actor, "driver_signed_in", { subject: driver.name });
  return { token, driver: { id: driver.id, name: driver.name } };
}

/** Ends the session this cookie value belongs to (signing out). */
export async function endSession(token: string | undefined): Promise<void> {
  if (token && token.length <= 200) await db.execute(sql`delete from cab_driver_sessions where token = ${sha256(token)}`);
}

/** The driver signed in by phone on this request (from the cab_driver_session cookie), if any. Sessions of removed drivers are gone with them. */
export const getDriverSession = cache(async (): Promise<DriverSession | null> => {
  const token = (await cookies()).get(DRIVER_SESSION_COOKIE)?.value;
  if (!token || token.length > 200) return null;
  const [d] = rows<{ id: string; name: string; phone: string; is_available: boolean }>(await db.execute(sql`
    select d.id, d.name, d.phone, d.is_available from cab_driver_sessions s join cab_drivers d on d.id = s.driver_id
    where s.token = ${sha256(token)} and s.expires_at > now()`));
  return d ? { driverId: d.id, name: d.name, phone: d.phone, isAvailable: d.is_available } : null;
});

/** For a page only a phone-signed-in driver may open: anyone else goes to the driver sign-in. */
export async function requireDriverSession(): Promise<DriverSession> {
  const s = await getDriverSession();
  if (!s) redirect("/cabs/driver-login");
  return s;
}

/** For the daily cron: sessions and codes past their time, and used codes after a day. Returns how many of each were deleted. */
export async function deleteExpiredDriverLogins(): Promise<{ sessions: number; otps: number }> {
  const [r] = rows<{ sessions: number; otps: number }>(await db.execute(sql`
    with s as (delete from cab_driver_sessions where expires_at < now() returning 1),
      o as (delete from cab_driver_otps where expires_at < now() or used_at < now() - interval '1 day' returning 1)
    select (select count(*) from s)::int as sessions, (select count(*) from o)::int as otps`));
  return r ?? { sessions: 0, otps: 0 };
}
