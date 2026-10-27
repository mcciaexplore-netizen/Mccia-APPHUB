/**
 * The rules of the sign-in limits, with no database, so they are tested directly. src/lib/sign-in-limits.ts applies them:
 *   - the same email from the same IP: 5 wrong passwords within 15 minutes, then refused for 15 minutes;
 *   - the same IP, any email: 30 wrong passwords within 15 minutes, then refused for 15 minutes;
 *   - the same email, any IP: from 10 wrong passwords within 15 minutes, each try waits a little longer (1 s, 2 s, ... up to 5 s), but is
 *     never refused, so nobody can lock the real person (the Support Admin included) out of their account from somewhere else.
 */
export const WINDOW_MS = 15 * 60 * 1000;
export const LIMITS = { emailIp: 5, ip: 30, emailSlowFrom: 10, maxDelayMs: 5000 } as const;

/** When a refusal ends: the latest moment `limit` wrong passwords fell within one window, plus the window. `times` in ms, any order. */
export function refusedUntil(times: readonly number[], limit: number, windowMs = WINDOW_MS): number {
  const t = [...times].sort((a, b) => a - b);
  let until = 0;
  for (let j = limit - 1; j < t.length; j++) if (t[j] - t[j - limit + 1] <= windowMs) until = Math.max(until, t[j] + windowMs);
  return until;
}

/** How long to wait before checking a password for an email with this many recent wrong passwords (from any IP). */
export const slowDownMs = (recentWrongForEmail: number) =>
  recentWrongForEmail < LIMITS.emailSlowFrom ? 0 : Math.min(LIMITS.maxDelayMs, (recentWrongForEmail - LIMITS.emailSlowFrom + 1) * 1000);
