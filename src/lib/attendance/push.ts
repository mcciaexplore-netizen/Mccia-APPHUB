import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { SignJWT, importJWK } from "jose";
import { db } from "./db";
import { pushSubscriptions } from "@/db/attendance-schema";
import { AttError } from "./dal";
import { pushAudience, subscriptionGone, validSubscription, vapidJwk } from "./push-rules";

/**
 * Web Push for Attendance: phone notifications next to the hub bell (check-in/out reminders, decisions on requests, leave approvals …).
 *
 * Switched on by three settings in Vercel (without them nothing is sent and the "Enable notifications" button is hidden):
 *   ATT_VAPID_PUBLIC_KEY, ATT_VAPID_PRIVATE_KEY   a key pair from `node scripts/att-vapid-keygen.mjs`
 *   ATT_VAPID_SUBJECT                             optional, a mailto: or https: contact for the push services (default: the site's address)
 *
 * A push carries no message, so there is nothing to encrypt: the service worker (public/attendance-sw.js) wakes up and fetches the person's
 * latest notice from /api/attendance/push/latest with their own sign-in, then shows it. Never throws: a phone that cannot be reached must not
 * undo what caused the notice.
 */

export const vapidPublicKey = () => (vapidJwk(process.env.ATT_VAPID_PUBLIC_KEY, process.env.ATT_VAPID_PRIVATE_KEY) ? process.env.ATT_VAPID_PUBLIC_KEY!.trim() : null);

export async function saveSubscription(userId: string, sub: unknown): Promise<void> {
  if (!vapidPublicKey()) throw new AttError("Phone notifications are not set up yet. Ask the Support Admin.");
  if (!validSubscription(sub)) throw new AttError("This browser gave a subscription that could not be used. Try again.");
  const keys = sub.keys ?? {};
  await db
    .insert(pushSubscriptions)
    .values({ userId, endpoint: sub.endpoint, p256dh: String(keys.p256dh ?? "").slice(0, 200), auth: String(keys.auth ?? "").slice(0, 100) })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId, p256dh: String(keys.p256dh ?? "").slice(0, 200), auth: String(keys.auth ?? "").slice(0, 100) } });
}

export async function removeSubscription(userId: string, endpoint: string): Promise<void> {
  await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, String(endpoint))));
}

async function vapidHeader(endpoint: string, subject: string): Promise<string | null> {
  const jwk = vapidJwk(process.env.ATT_VAPID_PUBLIC_KEY, process.env.ATT_VAPID_PRIVATE_KEY);
  const aud = pushAudience(endpoint);
  if (!jwk || !aud) return null;
  const key = await importJWK(jwk, "ES256");
  const jwt = await new SignJWT({ sub: subject })
    .setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .setAudience(aud)
    .setExpirationTime(Math.floor(Date.now() / 1000) + 12 * 3600)
    .sign(key);
  return `vapid t=${jwt}, k=${process.env.ATT_VAPID_PUBLIC_KEY!.trim()}`;
}

/** Wakes every subscribed browser of these people (each then shows its latest notice). Ends subscriptions the push service says are gone. */
export async function pushTo(userIds: string[], subject: string): Promise<{ sent: number; removed: number }> {
  const out = { sent: 0, removed: 0 };
  try {
    if (!vapidPublicKey() || !userIds.length) return out;
    const subs = await db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, [...new Set(userIds)]));
    await Promise.all(
      subs.map(async (s) => {
        try {
          const auth = await vapidHeader(s.endpoint, subject);
          if (!auth) return;
          const res = await fetch(s.endpoint, {
            method: "POST",
            headers: { authorization: auth, ttl: "86400", urgency: "high", "content-length": "0" },
            signal: AbortSignal.timeout(10_000),
          });
          if (subscriptionGone(res.status)) {
            await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
            out.removed++;
          } else if (res.ok) out.sent++;
        } catch {
          // one phone that cannot be reached does not stop the others
        }
      }),
    );
  } catch {
    // as above
  }
  return out;
}
