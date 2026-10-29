/**
 * The plain rules of single sign-on: what a slug and a callback address may look like, and which role a person gets inside an application.
 * No database and no keys, so the admin form, the server actions, the launch route and the tests all ask the same functions.
 */

/**
 * The role every single sign-on token carries. The hub only decides who may open an application; what someone may do inside it is
 * the application's own decision (its own settings), so the token never claims more than this.
 */
export const SSO_TOKEN_ROLE = "user" as const;
export type SsoRole = typeof SSO_TOKEN_ROLE;

const SSO_SLUG_MIN = 2;
const SSO_SLUG_MAX = 40;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** What is wrong with a slug (the application's single sign-on name, used in /launch/<slug> and as the token's audience), or null when it is fine. */
export function slugProblem(slug: string): string | null {
  if (slug.length < SSO_SLUG_MIN || slug.length > SSO_SLUG_MAX) return `The SSO slug must be ${SSO_SLUG_MIN} to ${SSO_SLUG_MAX} characters.`;
  if (!SLUG.test(slug)) return "The SSO slug may only use lowercase letters, numbers and single hyphens (for example mccia-search).";
  return null;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * What is wrong with a callback address (where the signed token is posted), or null when it is fine:
 *   - https, or http only for localhost / 127.0.0.1 and only when not in production;
 *   - no user name or password in it, and no #fragment;
 *   - exactly the same origin (scheme, host and port) as the application's own address, so a token can only ever go to that application.
 * `production` defaults to this process's NODE_ENV; tests pass it.
 */
export function callbackProblem(callback: string, appUrl: string, opts: { production?: boolean } = {}): string | null {
  const production = opts.production ?? process.env.NODE_ENV === "production";
  let cb: URL;
  try {
    cb = new URL(callback);
  } catch {
    return "Enter the callback URL as a full web address, for example https://app.example.com/api/sso/callback.";
  }
  if (cb.protocol !== "https:") {
    const localHttp = cb.protocol === "http:" && LOCAL_HOSTS.has(cb.hostname);
    if (!localHttp || production) return "The callback URL must start with https://.";
  }
  if (cb.username || cb.password) return "The callback URL must not contain a user name or password.";
  if (cb.hash || callback.includes("#")) return "The callback URL must not contain a # fragment.";
  let app: URL;
  try {
    app = new URL(appUrl);
  } catch {
    return "Single sign-on needs the application's URL to be a full web address, not a path inside the hub.";
  }
  if (app.origin !== cb.origin) return `The callback URL must be on the same site as the application's URL (${app.origin}).`;
  return null;
}

