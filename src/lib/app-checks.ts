import "server-only";
import dns from "node:dns/promises";
import net from "node:net";
import { isPublicAddress } from "@/lib/net-guard";

/**
 * A reachability check of an application's address: does it answer, over a valid secure connection, and what does it say? This proves the
 * link works. It does NOT prove the application's own features work, which need a person (or that application's own tests).
 * Only https addresses on the public internet are fetched; each redirect is checked the same way.
 */
export type CheckResult = { ok: boolean; httpStatus: number | null; durationMs: number; detail: string };

const TIMEOUT_MS = 8000;
const UA = "MCCIA-App-Hub-Check/1.0";
const CERT_CODES = new Set(["CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_NOT_YET_VALID"]);

function codeOf(e: unknown): string | undefined {
  let c = e as { code?: unknown; cause?: unknown } | undefined;
  for (let i = 0; i < 5 && c; i++, c = c.cause as typeof c) if (typeof c.code === "string") return c.code;
}

async function publicHost(host: string): Promise<boolean> {
  const bare = host.replace(/^\[|\]$/g, "");
  if (net.isIP(bare)) return isPublicAddress(bare);
  const found = await dns.lookup(bare, { all: true });
  return found.length > 0 && found.every((a) => isPublicAddress(a.address));
}

export async function checkUrl(address: string): Promise<CheckResult> {
  const started = Date.now();
  const done = (ok: boolean, httpStatus: number | null, detail: string): CheckResult => ({ ok, httpStatus, durationMs: Date.now() - started, detail });
  let url: URL;
  try { url = new URL(address); } catch { return done(false, null, "The address is not valid."); }
  if (url.protocol !== "https:") return done(false, null, "Only secure (https) addresses are checked.");
  // A browser keeps cookies while it follows redirects, and some sign-in handshakes (Streamlit's, for one) need that to finish. So does this check.
  const jar = new Map<string, Map<string, string>>();
  const cookieFor = (host: string) => [...(jar.get(host) ?? [])].map(([k, v]) => `${k}=${v}`).join("; ");
  try {
    for (let hop = 0; hop < 8; hop++) {
      if (!(await publicHost(url.hostname))) return done(false, null, "The address leads to a private or internal network, so it was not checked.");
      const cookie = cookieFor(url.hostname);
      const get = (method: string) => fetch(url, { method, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "User-Agent": UA, ...(cookie ? { Cookie: cookie } : {}), ...(method === "GET" ? { Range: "bytes=0-0" } : {}) } });
      let res = await get("HEAD");
      if (res.status === 405 || res.status === 501) res = await get("GET");
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const pair = c.split(";")[0], eq = pair.indexOf("=");
        if (eq > 0) (jar.get(url.hostname) ?? jar.set(url.hostname, new Map()).get(url.hostname)!).set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
      }
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        url = new URL(loc, url);
        if (url.protocol !== "https:") return done(false, res.status, "It redirects to an address that is not secure (https).");
        continue;
      }
      const s = res.status;
      if (s >= 200 && s < 400) return done(true, s, `Reachable (HTTP ${s}).`);
      if (s === 401 || s === 403) return done(true, s, `Reachable. The application asks for its own sign-in (HTTP ${s}).`);
      if (s === 404) return done(false, s, "Page not found (HTTP 404). The address may be wrong.");
      if (s >= 500) return done(false, s, `The application reported a server error (HTTP ${s}).`);
      return done(false, s, `Unexpected answer (HTTP ${s}).`);
    }
    return done(false, null, "Too many redirects.");
  } catch (e) {
    const code = codeOf(e);
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return done(false, null, `No answer within ${TIMEOUT_MS / 1000} seconds.`);
    if (code && CERT_CODES.has(code)) return done(false, null, "Its security certificate is not valid.");
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") return done(false, null, "The address could not be found (the domain does not exist).");
    return done(false, null, "Could not connect.");
  }
}
