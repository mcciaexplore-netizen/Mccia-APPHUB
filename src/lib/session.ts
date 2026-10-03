import { createHmac, timingSafeEqual } from "node:crypto";

/** Signed cookies: `<payload>.<signature>`, the signature being an HMAC of the payload with AUTH_SECRET. */
export const SESSION_COOKIE = "hub_session";
export const ADMIN_COOKIE = "hub_admin";
/** A sign-in lasts 8 hours. */
export const SESSION_MAX_AGE = 8 * 60 * 60;
/** Administrator stays unlocked this long while it is in use, and is locked again the moment you leave it. */
export const ADMIN_IDLE = 30 * 60;

export type Purpose = "session" | "admin";
export type Payload = { u: string; f: string; e: number; p: Purpose };

const secret = () => {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return s;
};
const mac = (body: string) => createHmac("sha256", secret()).update(body).digest("base64url");

/** `u` = user id, `f` = password fingerprint (a password change signs the person out), `e` = expiry in seconds since 1970. */
export function sign(u: string, f: string, purpose: Purpose, ttlSeconds: number): string {
  const body = Buffer.from(JSON.stringify({ u, f, e: Math.floor(Date.now() / 1000) + ttlSeconds, p: purpose } satisfies Payload)).toString("base64url");
  return `${body}.${mac(body)}`;
}

export function verify(token: string | undefined, purpose: Purpose): Payload | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(mac(body));
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as Payload;
    if (p.p !== purpose || typeof p.u !== "string" || typeof p.e !== "number" || p.e < Date.now() / 1000) return null;
    return p;
  } catch {
    return null;
  }
}

/** Only same-site paths are accepted as a place to go after signing in (no `//evil.com`, no full URLs). */
export function safeNext(n: unknown): string {
  return typeof n === "string" && /^\/(?!\/)[^\\]*$/.test(n) ? n : "/";
}

export const cookieOptions = (maxAge: number | undefined, secure: boolean) => ({
  httpOnly: true, sameSite: "lax" as const, path: "/", secure, ...(maxAge ? { maxAge } : {}),
});
