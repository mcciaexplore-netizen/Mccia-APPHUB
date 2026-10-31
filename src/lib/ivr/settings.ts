import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/ivr/db";
import { appSettings } from "@/db/ivr-schema";

export type RetryRule = { maxAttempts: number; minGapHours: number };
export const DEFAULT_RETRY: RetryRule = { maxAttempts: 3, minGapHours: 2 };

export async function getRetryRule(): Promise<RetryRule> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "retry")).limit(1);
  const v = (row?.value ?? {}) as Partial<RetryRule>;
  const clamp = (n: unknown, lo: number, hi: number, d: number) =>
    typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d;
  return {
    maxAttempts: clamp(v.maxAttempts, 1, 20, DEFAULT_RETRY.maxAttempts),
    minGapHours: clamp(v.minGapHours, 0, 168, DEFAULT_RETRY.minGapHours),
  };
}

export async function saveRetryRule(rule: RetryRule): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: "retry", value: rule })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: rule, updatedAt: new Date() } });
}

/** Last 10 digits, so "+91 20 7100 0000", "02071000000" and "912071000000" all compare equal. */
export const lineKey = (n: string | null | undefined): string => (n ?? "").replace(/\D/g, "").slice(-10);

/**
 * The Smartflo account is shared with other departments, so the CRM only keeps Membership calls: those handled by an agent
 * linked to an IVR-CRM agent, or those on one of these phone lines (DIDs).
 */
export async function getMembershipLines(): Promise<string[]> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "membership_lines")).limit(1);
  const v = row?.value;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export async function saveMembershipLines(lines: string[]): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: "membership_lines", value: lines })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: lines, updatedAt: new Date() } });
}

/**
 * Automatic call sync. Vercel Hobby cannot run a cron more than once a day, so the app also syncs itself while people use it
 * (a heartbeat in every open tab) and on a ping from an optional external scheduler. Both only run inside these IST hours,
 * which keeps the Neon database asleep overnight. The daily cron still reconciles everything.
 */
export type AutoSyncConfig = { enabled: boolean; startHour: number; endHour: number; minGapSec: number };
export const DEFAULT_AUTOSYNC: AutoSyncConfig = { enabled: true, startHour: 8, endHour: 21, minGapSec: 60 };

export async function getAutoSyncConfig(): Promise<AutoSyncConfig> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "autosync")).limit(1);
  const v = (row?.value ?? {}) as Partial<AutoSyncConfig>;
  const clamp = (n: unknown, lo: number, hi: number, d: number) =>
    typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d;
  const startHour = clamp(v.startHour, 0, 23, DEFAULT_AUTOSYNC.startHour);
  return {
    enabled: typeof v.enabled === "boolean" ? v.enabled : DEFAULT_AUTOSYNC.enabled,
    startHour,
    endHour: Math.max(startHour + 1, clamp(v.endHour, 1, 24, DEFAULT_AUTOSYNC.endHour)),
    minGapSec: clamp(v.minGapSec, 30, 3600, DEFAULT_AUTOSYNC.minGapSec),
  };
}

export async function saveAutoSyncConfig(cfg: AutoSyncConfig): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: "autosync", value: cfg })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: cfg, updatedAt: new Date() } });
}
