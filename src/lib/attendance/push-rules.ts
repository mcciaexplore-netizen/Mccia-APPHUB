/**
 * Web Push (VAPID, RFC 8292) without a message body: the pieces that need no server. Pure, so the unit tests can check them.
 *
 * Keys are base64url: the public key is the 65-byte uncompressed P-256 point (0x04 ‖ x ‖ y) browsers take as applicationServerKey; the private
 * key is its 32-byte scalar d. scripts/att-vapid-keygen.mjs makes a pair.
 */

export const b64urlToBytes = (s: string): Uint8Array => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};
export const bytesToB64url = (b: Uint8Array): string => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export type VapidJwk = { kty: "EC"; crv: "P-256"; x: string; y: string; d: string };

/** The signing key as a JWK, from the two base64url keys; null when they are missing or not a P-256 pair's shape. */
export function vapidJwk(publicKey: string | undefined, privateKey: string | undefined): VapidJwk | null {
  if (!publicKey || !privateKey) return null;
  try {
    const pub = b64urlToBytes(publicKey.trim());
    const d = b64urlToBytes(privateKey.trim());
    if (pub.length !== 65 || pub[0] !== 4 || d.length !== 32) return null;
    return { kty: "EC", crv: "P-256", x: bytesToB64url(pub.slice(1, 33)), y: bytesToB64url(pub.slice(33)), d: bytesToB64url(d) };
  } catch {
    return null;
  }
}

/**
 * The browsers' push services. A subscription's endpoint must be on one of these: the server POSTs to it, so an address of someone's choosing
 * is never accepted (Chrome/Edge/Android: FCM; Firefox: Mozilla; Safari/iPhone: Apple; old Edge: Windows).
 */
const PUSH_HOSTS = ["fcm.googleapis.com", "android.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"];
export const isPushHost = (host: string) => PUSH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));

/** The push service's origin (the JWT's audience), or null for an endpoint that is not https on a known push service. */
export function pushAudience(endpoint: string): string | null {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && !u.username && !u.password && isPushHost(u.hostname) ? u.origin : null;
  } catch {
    return null;
  }
}

/** Whether a subscription sent by a browser looks right before it is stored. */
export function validSubscription(s: unknown): s is { endpoint: string; keys?: { p256dh?: string; auth?: string } } {
  if (!s || typeof s !== "object") return false;
  const e = (s as { endpoint?: unknown }).endpoint;
  return typeof e === "string" && e.length <= 1000 && pushAudience(e) !== null;
}

/** A push service's answer that means the subscription is gone for good (the browser unsubscribed or the app was removed). */
export const subscriptionGone = (status: number) => status === 404 || status === 410;
