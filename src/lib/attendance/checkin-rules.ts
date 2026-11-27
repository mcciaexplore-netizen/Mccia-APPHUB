/**
 * The check-in and check-out rules. Pure: the server calls these with what it knows (the request's IP, the browser's reported position, the
 * day, the person's shift and requests), and the unit tests call them directly.
 *
 * Where a person may punch from: anywhere. Every check-in and check-out is tagged with where it was made:
 *   - in_office: the request's IP (set by Vercel, so the visitor cannot fake it) is one of the office IPs in Settings, or the phone's reported
 *     position is within the office radius (200 m by default);
 *   - remote: anywhere else.
 * The phone's position is required, except on the office network (which alone proves the office): without either the punch is refused
 * with LOCATION_REQUIRED. The position is recorded whenever the browser gives it, with its distance from the office, even on the office
 * network. The browser reports the position itself, so it can be faked; the method ("ip" or "gps") is recorded so HR can see which was used.
 * A remote punch on a day with approved WFH counts as WFH; remote without it is still present (and late is judged the same way anywhere).
 *
 * Late = check-in after shift start + grace. Early out = check-out more than `earlyOutMinutes` (30) before shift end. With first-half leave
 * the day starts at the second half; with second-half leave it ends at the first half's end. Extra-work days (holidays, weekly offs) are
 * never late or early, and every hour on them is excess.
 */

import type { DayStatus } from "@/db/attendance-schema";
import { statusForHours, type DayKind, type ShiftHours } from "./calendar";
import type { AttSettings } from "./settings";
import { round2 } from "./time";

/** Shown when the browser gives no position and the request is not from the office network. */
export const locationRequired = (verb: "check in" | "check out" = "check in") => `Location access is required to ${verb}. Please allow location in your browser settings.`;
export const LOCATION_REQUIRED = locationRequired("check in");

/** Distance in metres between two points on the Earth (haversine). */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type Position = { lat: number; lng: number; accuracy?: number | null };

export const validPosition = (p: unknown): p is Position =>
  !!p && typeof p === "object" && Number.isFinite((p as Position).lat) && Number.isFinite((p as Position).lng) && Math.abs((p as Position).lat) <= 90 && Math.abs((p as Position).lng) <= 180;

export function withinGeofence(p: Position | null | undefined, office: AttSettings["office"]): boolean {
  return !!p && validPosition(p) && distanceMeters(p, office) <= office.radiusM;
}

const ipv4ToInt = (ip: string) => ip.split(".").reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
const isV4 = (s: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s) && s.split(".").every((p) => Number(p) <= 255);

/** Normalises an address: trims, lower-cases, and turns an IPv4-mapped IPv6 address (::ffff:1.2.3.4) into plain IPv4. */
export function normalizeIp(ip: string | null | undefined): string | null {
  const s = (ip ?? "").trim().toLowerCase();
  if (!s) return null;
  const mapped = s.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  return mapped ? mapped[1] : s;
}

/** Whether `ip` is one of the entries: an exact address, or inside an IPv4 range (a.b.c.d/n). */
export function ipAllowed(ip: string | null | undefined, entries: readonly string[]): boolean {
  const addr = normalizeIp(ip);
  if (!addr) return false;
  for (const raw of entries) {
    const e = normalizeIp(raw);
    if (!e) continue;
    if (e.includes("/")) {
      const [net, bitsStr] = e.split("/");
      const bits = Number(bitsStr);
      if (!isV4(net) || !isV4(addr) || !Number.isInteger(bits) || bits < 0 || bits > 32) continue;
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      if ((ipv4ToInt(net) & mask) === (ipv4ToInt(addr) & mask)) return true;
    } else if (e === addr) return true;
  }
  return false;
}

export type PlaceTag = "in_office" | "remote";
export type PunchSpot = { method: "ip" | "gps"; place: PlaceTag; distanceM: number | null };
export type PunchPlace = ({ ok: true } & PunchSpot) | { ok: false; error: string };

/**
 * Where a punch is made (see the header), or the refusal when there is no position and no office network. Within the radius is "gps" even on
 * the office network (the position is preferred); outside it, the office network still makes it in_office ("ip").
 */
export function punchPlace(input: { ip: string | null; position: Position | null; settings: AttSettings }, verb: "check in" | "check out" = "check in"): PunchPlace {
  const p = input.position && validPosition(input.position) ? input.position : null;
  const distanceM = p ? Math.round(distanceMeters(p, input.settings.office)) : null;
  if (p && distanceM! <= input.settings.office.radiusM) return { ok: true, method: "gps", place: "in_office", distanceM };
  if (ipAllowed(input.ip, input.settings.officeIps)) return { ok: true, method: "ip", place: "in_office", distanceM };
  if (!p) return { ok: false, error: locationRequired(verb) };
  return { ok: true, method: "gps", place: "remote", distanceM };
}

export type CheckInDecision = ({ ok: true; isWfh: boolean; isExtraWork: boolean } & PunchSpot) | { ok: false; error: string };

/** Whether a check-in is allowed now, and how it is recorded. A remote check-in counts as WFH only with WFH approved for the day. */
export function decideCheckIn(input: {
  alreadyCheckedIn: boolean;
  /** Approved leave covering today: "none" = the whole day. */
  leaveToday: "none" | "first" | "second" | null;
  kind: DayKind;
  wfhApproved: boolean;
  ip: string | null;
  position: Position | null;
  settings: AttSettings;
}): CheckInDecision {
  if (input.alreadyCheckedIn) return { ok: false, error: "You have already checked in today. There is one check-in and one check-out per day." };
  if (input.leaveToday === "none") return { ok: false, error: "You are on leave today. Cancel the leave first if you are working." };
  const place = punchPlace(input, "check in");
  if (!place.ok) return place;
  return { ...place, isWfh: input.wfhApproved && place.place === "remote", isExtraWork: input.kind !== "working" };
}

export type CheckOutDecision = ({ ok: true } & PunchSpot) | { ok: false; error: string };

/** Whether a check-out is allowed: checked in today and not yet out, from anywhere, with a position (or on the office network). */
export function decideCheckOut(input: { checkedIn: boolean; checkedOut: boolean; ip: string | null; position: Position | null; settings: AttSettings }): CheckOutDecision {
  if (!input.checkedIn) return { ok: false, error: "You have not checked in today." };
  if (input.checkedOut) return { ok: false, error: "You have already checked out today." };
  return punchPlace(input, "check out");
}

/** Where a recorded punch was made. Rows from before tagging have no place: the method says it (office network or GPS in the office = in
 * office; WFH = remote); a regularized punch has none. */
export function placeOfPunch(place: PlaceTag | null | undefined, method: string | null | undefined): PlaceTag | null {
  if (place) return place;
  if (method === "ip" || method === "gps") return "in_office";
  if (method === "wfh") return "remote";
  return null;
}

export type PhotonProps = Record<string, string | undefined>;

/** A Photon (OpenStreetMap) place's area for a remote punch: the locality or district, then the city ("Baner, Pune"); area.ts asks for it. */
export function areaName(p: PhotonProps): string | null {
  const local = p.district ?? p.locality ?? p.suburb ?? p.neighbourhood ?? (p.osm_value === "suburb" || p.osm_value === "neighbourhood" ? p.name : undefined);
  const city = p.city ?? p.town ?? p.village ?? p.county;
  const parts = [local, city].filter((x, i, all): x is string => !!x && !!x.trim() && all.indexOf(x) === i);
  if (!parts.length && p.state) parts.push(p.state);
  return parts.length ? parts.join(", ").slice(0, 120) : null;
}

/** 2340 → "2.3 km", 420 → "420 m". */
export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

/** "In Office", or "Remote (2.3 km)" (for the reports). */
export function placeLabel(place: PlaceTag | null, distanceM: number | null | undefined): string {
  if (place === "in_office") return "In Office";
  if (place === "remote") return distanceM != null ? `Remote (${formatDistance(distanceM)})` : "Remote";
  return "";
}

/** The part of the shift a person is expected to work, given half-day leave. */
export function expectedWindow(shift: ShiftHours & { firstHalfEndMin: number; secondHalfStartMin: number }, halfLeave: "none" | "first" | "second" | null) {
  if (halfLeave === "first") return { startMin: shift.secondHalfStartMin, endMin: shift.endMin, hours: shift.halfDayHours };
  if (halfLeave === "second") return { startMin: shift.startMin, endMin: shift.firstHalfEndMin, hours: shift.halfDayHours };
  return { startMin: shift.startMin, endMin: shift.endMin, hours: shift.fullDayHours };
}

export const isLate = (checkInMin: number, startMin: number, graceMinutes: number) => checkInMin > startMin + graceMinutes;
export const isEarlyOut = (checkOutMin: number, endMin: number, earlyOutMinutes: number) => checkOutMin < endMin - earlyOutMinutes;

export type DayFigures = { hoursWorked: number; deficitHours: number; excessHours: number; isLate: boolean; isEarlyOut: boolean; status: DayStatus };

/** Everything stored on a day once it has both punches. Minutes are IST clock minutes; `workedMs` is check-out minus check-in. */
export function computeDay(input: {
  workedMs: number;
  checkInMin: number;
  checkOutMin: number;
  shift: ShiftHours & { firstHalfEndMin: number; secondHalfStartMin: number };
  earlyOutMinutes: number;
  isWfh: boolean;
  isExtraWork: boolean;
  halfLeave: "none" | "first" | "second" | null;
}): DayFigures {
  const hoursWorked = round2(Math.max(0, input.workedMs) / 3_600_000);
  if (input.isExtraWork) return { hoursWorked, deficitHours: 0, excessHours: hoursWorked, isLate: false, isEarlyOut: false, status: input.isWfh ? "wfh" : "present" };
  const w = expectedWindow(input.shift, input.halfLeave);
  const late = isLate(input.checkInMin, w.startMin, input.shift.graceMinutes);
  const early = isEarlyOut(input.checkOutMin, w.endMin, input.earlyOutMinutes);
  const diff = round2(hoursWorked - w.hours);
  let status: DayStatus;
  if (input.halfLeave && input.halfLeave !== "none") status = hoursWorked >= input.shift.halfDayHours - input.shift.graceMinutes / 60 ? "half_day" : "absent";
  else status = statusForHours(hoursWorked, input.shift, input.isWfh);
  return { hoursWorked, deficitHours: diff < 0 ? -diff : 0, excessHours: diff > 0 ? diff : 0, isLate: late, isEarlyOut: early, status };
}

export type CheckoutGate = { allowed: boolean; remainingMs: number; requiredHours: number; why: "worked" | "approved_early" | "extra_work" | "wait" };

/**
 * Whether a person may check out yet: only once they have worked the hours expected of them today (the shift's full-day hours, 7.5 by
 * default; the half-day hours with half-day leave), unless their manager or HR approved leaving early today. Extra work on a holiday or
 * weekly off has no minimum. `remainingMs` is how long until check-out opens (0 when allowed).
 */
export function checkoutGate(i: { workedMs: number; requiredHours: number; isExtraWork: boolean; earlyApproved: boolean }): CheckoutGate {
  const requiredMs = Math.round(i.requiredHours * 3_600_000);
  if (i.isExtraWork) return { allowed: true, remainingMs: 0, requiredHours: i.requiredHours, why: "extra_work" };
  if (i.workedMs >= requiredMs) return { allowed: true, remainingMs: 0, requiredHours: i.requiredHours, why: "worked" };
  if (i.earlyApproved) return { allowed: true, remainingMs: 0, requiredHours: i.requiredHours, why: "approved_early" };
  return { allowed: false, remainingMs: requiredMs - Math.max(0, i.workedMs), requiredHours: i.requiredHours, why: "wait" };
}

/** 16_320_000 ms → "4h 32m" (rounded up to the minute, so it never says 0m while still waiting). */
export function formatWait(ms: number): string {
  const mins = Math.max(0, Math.ceil(ms / 60_000));
  const h = Math.floor(mins / 60);
  return h ? `${h}h ${mins % 60}m` : `${mins}m`;
}
