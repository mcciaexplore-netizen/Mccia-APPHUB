/**
 * The client's IP address, as Vercel reports it. Vercel overwrites X-Forwarded-For with the real client address "to prevent IP spoofing"
 * and sets x-vercel-forwarded-for and x-real-ip to the same value (https://vercel.com/docs/headers/request-headers), so on Vercel none of
 * these can be set by the visitor. x-vercel-forwarded-for comes first because it stays correct even with another proxy in front of Vercel.
 * Off Vercel (a laptop running `next dev`) the headers are whatever the client sends; that is fine for development only.
 */
export function clientIp(h: Headers): string | null {
  const first = (v: string | null) => v?.split(",")[0]?.trim() || null;
  return first(h.get("x-vercel-forwarded-for")) ?? first(h.get("x-real-ip")) ?? first(h.get("x-forwarded-for"));
}
