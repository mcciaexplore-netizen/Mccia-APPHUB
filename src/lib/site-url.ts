/**
 * The address of this site, for links in emails (sign-in details, approval notifications). Never taken from the request's Host header,
 * which a visitor can influence on some hosts.
 *   - APP_BASE_URL when it is set (always, in production).
 *   - Production without it is a setup mistake: it fails with a message saying exactly what to set, rather than sending broken links.
 *   - A Vercel Preview deployment without it: that deployment's own address (VERCEL_URL, set by Vercel).
 *   - Local development: http://localhost:3000.
 */
export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  const fixed = (env.APP_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (fixed) return fixed;
  const production = env.VERCEL_ENV ? env.VERCEL_ENV === "production" : env.NODE_ENV === "production";
  if (production) throw new Error("APP_BASE_URL is not set. Add APP_BASE_URL = https://mccia-apphub.vercel.app (no / at the end) in Vercel for Production, then redeploy.");
  const vercel = (env.VERCEL_URL ?? "").trim();
  return vercel ? `https://${vercel}` : "http://localhost:3000";
}

/**
 * An application's address when it is a page of this site ("/cabs", "/inventory?x=1"), or null for another site ("https://…", and "//host"
 * or "/\\host", which browsers read as another site too). Such a page opens in place from the hub (see LaunchLink).
 */
export const sitePath = (url: string): string | null => (/^\/(?![/\\])/.test(url) ? url : null);
