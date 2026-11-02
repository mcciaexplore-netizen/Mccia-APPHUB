import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The links that work without signing in.
 *   Tracking (/track/<number>.<signature>): the ticket number signed with AUTH_SECRET, so a link cannot be made up for someone else's
 *   request. It shows progress only: no brief, names or files.
 *   Review (/review/<token>): 32 random bytes, sent once by email; only its sha256 is stored, and it works for two days.
 */

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return s;
}

const sign = (number: string) => createHmac("sha256", secret()).update(`design-track:${number}`).digest("hex").slice(0, 24);

export const trackingToken = (number: string) => `${number}.${sign(number)}`;

/** The ticket number a tracking token stands for, or null when it was not made here. */
export function numberFromTrackingToken(token: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const number = token.slice(0, dot);
  const sig = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(sign(number));
  return sig.length === want.length && timingSafeEqual(sig, want) ? number : null;
}

export const newReviewToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
