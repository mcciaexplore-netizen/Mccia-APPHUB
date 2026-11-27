/**
 * Attendance's settings: what att_settings ("config") holds, read with a default for anything missing or wrong, so an empty row (as seeded)
 * already works. Pure, so the Settings form, the server and the unit tests share it.
 */

import { isDay, parseHm } from "./time";

export type AttSettings = {
  /** The office the phone check-in is measured from (MCCIA Trade Tower, SB Road, Pune by default; 200 m covers the basement parking too, where GPS is weaker). */
  office: { name: string; lat: number; lng: number; radiusM: number };
  /** Office network addresses a laptop may check in from: exact IPv4/IPv6 addresses or IPv4 ranges (CIDR, e.g. 203.0.113.0/28). */
  officeIps: string[];
  /** How far back a missed punch may be corrected. */
  regularizationWindowDays: number;
  /** Which Saturdays of the month are off (Sundays always are). 2 and 4 by default: the 1st, 3rd and 5th are working days. */
  offSaturdays: number[];
  /** A check-out this many minutes or more before the shift ends is an early out. */
  earlyOutMinutes: number;
  /** Comp-offs expire this many days after the day worked. */
  compoffExpiryDays: number;
  /** Bell reminders, at IST clock times ("10:30"). */
  reminders: { enabled: boolean; checkIn: string; checkOut: string };
  /** Also email managers about new requests and requesters about decisions (the bell is always used). On by default. */
  emailEnabled: boolean;
  /**
   * The day attendance starts counting, set by HR (null = not set). Days before it are not tracked: shown as "—", never absent, never in
   * the reports' totals, never regularized. See effectiveGoLive().
   */
  goLiveDate: string | null;
  /** The day Attendance was first used with ATT_ENABLED on, recorded once by the server (config.ts): the go-live date until HR set one. */
  firstEnabledOn: string | null;
};

export const DEFAULT_SETTINGS: AttSettings = {
  office: { name: "MCCIA Trade Tower, SB Road, Pune", lat: 18.5355973, lng: 73.8297353, radiusM: 200 },
  officeIps: [],
  regularizationWindowDays: 31,
  offSaturdays: [2, 4],
  earlyOutMinutes: 30,
  compoffExpiryDays: 90,
  reminders: { enabled: true, checkIn: "10:00", checkOut: "17:30" },
  emailEnabled: true,
  goLiveDate: null,
  firstEnabledOn: null,
};

const num = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= lo && n <= hi ? n : dflt;
};
const int = (v: unknown, lo: number, hi: number, dflt: number) => Math.round(num(v, lo, hi, dflt));
const hm = (v: unknown, dflt: string) => (parseHm(v) != null ? String(v).slice(0, 5) : dflt);

/** An IPv4 or IPv6 address, or an IPv4 range a.b.c.d/n. */
export function isIpEntry(s: string): boolean {
  const v4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
  const [addr, bits, extra] = s.split("/");
  if (extra !== undefined) return false;
  if (v4.test(addr)) return bits === undefined || (/^\d{1,2}$/.test(bits) && Number(bits) <= 32);
  return bits === undefined && /^[0-9a-f:]+$/i.test(addr) && addr.includes(":") && addr.length <= 39;
}

/**
 * The office IPs from what is stored: "officeIps" (what the Settings page writes) and "allowedIps" (a row edited by hand), together, trimmed,
 * valid entries only, no repeats, at most 50.
 */
function ipList(r: Record<string, unknown>): string[] {
  const raw = [...(Array.isArray(r.officeIps) ? r.officeIps : []), ...(Array.isArray(r.allowedIps) ? r.allowedIps : [])];
  return [...new Set(raw.map((s) => String(s).trim()).filter(isIpEntry))].slice(0, 50);
}

/** The settings from what is stored (anything missing or invalid takes its default). */
export function parseSettings(raw: unknown): AttSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const o = (r.office && typeof r.office === "object" ? r.office : {}) as Record<string, unknown>;
  const rem = (r.reminders && typeof r.reminders === "object" ? r.reminders : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const sats = Array.isArray(r.offSaturdays) ? [...new Set(r.offSaturdays.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 5))].sort() : d.offSaturdays;
  return {
    office: {
      name: typeof o.name === "string" && o.name.trim() ? o.name.trim().slice(0, 120) : d.office.name,
      lat: num(o.lat, -90, 90, d.office.lat),
      lng: num(o.lng, -180, 180, d.office.lng),
      // "radius" is accepted too (a row edited by hand); the Settings page writes radiusM.
      radiusM: int(o.radiusM ?? o.radius, 25, 5000, d.office.radiusM),
    },
    officeIps: ipList(r),
    regularizationWindowDays: int(r.regularizationWindowDays, 1, 90, d.regularizationWindowDays),
    offSaturdays: sats,
    earlyOutMinutes: int(r.earlyOutMinutes, 0, 240, d.earlyOutMinutes),
    compoffExpiryDays: int(r.compoffExpiryDays, 7, 365, d.compoffExpiryDays),
    reminders: {
      enabled: typeof rem.enabled === "boolean" ? rem.enabled : d.reminders.enabled,
      checkIn: hm(rem.checkIn, d.reminders.checkIn),
      checkOut: hm(rem.checkOut, d.reminders.checkOut),
    },
    emailEnabled: typeof r.emailEnabled === "boolean" ? r.emailEnabled : d.emailEnabled,
    goLiveDate: isDay(r.goLiveDate) ? r.goLiveDate : null,
    firstEnabledOn: isDay(r.firstEnabledOn) ? r.firstEnabledOn : null,
  };
}

/** The day attendance starts counting: HR's go-live date, else the day Attendance was first switched on, else today. */
export const effectiveGoLive = (s: Pick<AttSettings, "goLiveDate" | "firstEnabledOn">, today: string) => s.goLiveDate ?? s.firstEnabledOn ?? today;
