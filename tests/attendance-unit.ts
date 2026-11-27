/**
 * Attendance's pure rules: check-in (place, late, early out, hours, status), the working calendar, leave days and balances, every leave
 * check, comp-off spending and expiry, regularization eligibility, timesheets, feeds, roles and approval routing, the month tally and the
 * org chart layout. Run as part of `npm run test:unit` (tests/unit.ts calls attendanceUnit()).
 */
import { readdirSync, readFileSync } from "node:fs";
import * as T from "../src/lib/attendance/time";
import { DEFAULT_SETTINGS, effectiveGoLive, isIpEntry, parseSettings } from "../src/lib/attendance/settings";
import { dayKind, isWeeklyOff, nthOfMonth, resolveDay, statusForHours, type Calendar, type PunchRecord, type ShiftHours } from "../src/lib/attendance/calendar";
import * as C from "../src/lib/attendance/checkin-rules";
import * as L from "../src/lib/attendance/leave-rules";
import * as CO from "../src/lib/attendance/compoff";
import { checkPlanTimes, checkRegularizationTimes, pastCardState, planEligibility, PAST_CARD_TEXT, regularizationEligibility } from "../src/lib/attendance/regularization";
import * as W from "../src/lib/attendance/time-wheel";
import { canEditWeek, checkSubmitWeek, checkTimeEntry, weekDays } from "../src/lib/attendance/timesheet";
import { eventsBetween, fillTemplate, onYear, todaysEvents, upcomingEvents, cleanWish } from "../src/lib/attendance/feeds";
import { approverFor, attRolesFor, canDecide, isAdmin, isMember, navFor } from "../src/lib/attendance/att.manifest";
import { tally } from "../src/lib/attendance/summary";
import * as DR from "../src/lib/attendance/daily";
import { BOTTOM_NAV } from "../src/lib/attendance/att.manifest";
import { b64urlToBytes, bytesToB64url, isPushHost, pushAudience, subscriptionGone, validSubscription, vapidJwk } from "../src/lib/attendance/push-rules";
import { installState, isDarkTheme, isIosSafari, parseThemePref, themeColorFor } from "../src/lib/attendance/pwa-rules";
import { generateKeyPairSync } from "node:crypto";
import { SignJWT, importJWK, jwtVerify } from "jose";
import { layout, ORG_ROOT } from "../src/lib/attendance/org-layout";

type Eq = (name: string, got: unknown, want: unknown) => void;

/** The async checks (signing a VAPID token with a generated key pair). */
export async function attendanceUnitAsync(eq: Eq): Promise<void> {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const pub = publicKey.export({ format: "jwk" });
  const priv = privateKey.export({ format: "jwk" });
  const rawPub = bytesToB64url(new Uint8Array([4, ...Buffer.from(pub.x!, "base64url"), ...Buffer.from(pub.y!, "base64url")]));
  const jwk = vapidJwk(rawPub, priv.d);
  eq("att push: a generated key pair gives a P-256 signing key", !!jwk && jwk.x === pub.x && jwk.y === pub.y && jwk.d === priv.d, true);
  const token = await new SignJWT({ sub: "https://hub.example" }).setProtectedHeader({ alg: "ES256" }).setAudience("https://fcm.googleapis.com").setExpirationTime("1h").sign(await importJWK(jwk!, "ES256"));
  const { payload } = await jwtVerify(token, await importJWK({ kty: "EC", crv: "P-256", x: pub.x!, y: pub.y! }, "ES256"));
  eq("att push: the VAPID token verifies with the public key and names the push service", [payload.aud, payload.sub], ["https://fcm.googleapis.com", "https://hub.example"]);
}

export function attendanceUnit(eq: Eq): void {
  // ── Time (IST) ──────────────────────────────────────────────────────────
  eq("att time: a UTC moment late in the evening is the next IST day", T.istDay(new Date("2026-11-20T19:00:00Z")), "2026-11-21");
  eq("att time: IST minutes of 04:30 UTC is 10:00", T.istMinutes(new Date("2026-11-21T04:30:00Z")), 600);
  eq("att time: istMoment round-trips day and minutes", [T.istDay(T.istMoment("2026-11-21", 1050)), T.istMinutes(T.istMoment("2026-11-21", 1050))], ["2026-11-21", 1050]);
  eq("att time: weeks start on Monday (Sat 21 Nov → Mon 16 Nov; Sun 22 → Mon 16; Mon 23 → itself)", [T.weekStart("2026-11-21"), T.weekStart("2026-11-22"), T.weekStart("2026-11-23")], ["2026-11-16", "2026-11-16", "2026-11-23"]);
  eq("att time: month range of Feb 2028 (leap year)", T.monthRange("2028-02"), { from: "2028-02-01", to: "2028-02-29" });
  eq("att time: parseHm accepts HH:MM and HH:MM:SS, rejects 24:00", [T.parseHm("10:00"), T.parseHm("17:30:00"), T.parseHm("24:00"), T.parseHm("9:5")], [600, 1050, null, null]);
  eq("att time: isDay rejects 31 November", [T.isDay("2026-11-30"), T.isDay("2026-11-31"), T.isDay("2026-1-1")], [true, false, false]);
  eq("att time: formatHours", [T.formatHours(7.25), T.formatHours(0), T.formatHours(null)], ["7h 15m", "0h", "—"]);
  eq("att time: greeting by IST time (5–12 morning, 12–17 afternoon, 17–21 evening, else night)", [299, 300, 719, 720, 1019, 1020, 1259, 1260, 0].map(T.greetingFor), ["Good night", "Good morning", "Good morning", "Good afternoon", "Good afternoon", "Good evening", "Good evening", "Good night", "Good night"]);
  eq("att time: long date and capital short date", [T.formatLongDate("2025-06-24"), T.formatDayCaps("2026-11-21")], ["Tuesday, 24 June 2025", "SAT 21 NOV"]);
  eq("att time: formatClockDuration", T.formatClockDuration(7 * 3600 + 15 * 60 + 3), "07:15:03");

  // ── Settings ────────────────────────────────────────────────────────────
  const dflt = parseSettings({});
  eq("att settings: empty row gives the defaults (MCCIA Trade Tower 18.5355973, 73.8297353, 200 m; 31-day window; 2nd and 4th Saturdays off; 90-day comp-off)", dflt, DEFAULT_SETTINGS);
  eq("att settings: the default office is MCCIA Trade Tower, SB Road at 18.5355973, 73.8297353 with a 200 m radius", DEFAULT_SETTINGS.office, { name: "MCCIA Trade Tower, SB Road, Pune", lat: 18.5355973, lng: 73.8297353, radiusM: 200 });
  // The row scripts/update-attendance-office-location.sql leaves on an empty row; radiusM must win over a stale hand-written "radius".
  const afterSql = parseSettings({ office: { name: "MCCIA Trade Tower, SB Road, Pune", lat: 18.5355973, lng: 73.8297353, radiusM: 200 }, allowedIps: ["49.248.67.194"] });
  eq("att settings: the row the location script writes is read as the new office, 200 m, with that IP as an office IP", [afterSql.office, afterSql.officeIps], [{ name: "MCCIA Trade Tower, SB Road, Pune", lat: 18.5355973, lng: 73.8297353, radiusM: 200 }, ["49.248.67.194"]]);
  eq("att settings: radiusM wins over a leftover 'radius' (why the script removes it)", [parseSettings({ office: { radiusM: 200, radius: 150 } }).office.radiusM, parseSettings({ office: { radius: 150 } }).office.radiusM], [200, 150]);
  eq("att settings: bad values fall back, invalid IPs dropped, duplicates removed", parseSettings({ regularizationWindowDays: 500, officeIps: ["203.0.113.5", "203.0.113.5", "nope", "10.0.0.0/33", "10.0.0.0/24"], offSaturdays: [4, 2, 9] }), {
    ...DEFAULT_SETTINGS,
    officeIps: ["203.0.113.5", "10.0.0.0/24"],
    offSaturdays: [2, 4],
  });
  eq("att settings: go-live date: HR's date, else the day first switched on, else today; bad dates ignored", [
    effectiveGoLive(parseSettings({ goLiveDate: "2026-12-01", firstEnabledOn: "2026-11-20" }), "2026-11-21"),
    effectiveGoLive(parseSettings({ firstEnabledOn: "2026-11-20" }), "2026-11-21"),
    effectiveGoLive(parseSettings({ goLiveDate: "2026-13-01" }), "2026-11-21"),
  ], ["2026-12-01", "2026-11-20", "2026-11-21"]);
  const handEdited = parseSettings({ office: { lat: 18.534976522712075, lng: 73.82985210397189, radius: 150 }, allowedIps: ["49.248.67.194"] });
  eq("att settings: a hand-edited row (allowedIps, office.radius) is read: the IP is an office IP, the office is where it says", [handEdited.officeIps, handEdited.office.radiusM, handEdited.office.lat, C.ipAllowed("49.248.67.194", handEdited.officeIps), C.ipAllowed(" 49.248.67.194", handEdited.officeIps), C.ipAllowed("49.248.67.195", handEdited.officeIps)], [["49.248.67.194"], 150, 18.534976522712075, true, true, false]);
  eq("att settings: officeIps and allowedIps together, no repeats", parseSettings({ officeIps: ["1.2.3.4"], allowedIps: ["1.2.3.4", "5.6.7.8"] }).officeIps, ["1.2.3.4", "5.6.7.8"]);
  eq("att settings: isIpEntry", [isIpEntry("1.2.3.4"), isIpEntry("1.2.3.4/28"), isIpEntry("2001:db8::1"), isIpEntry("256.1.1.1"), isIpEntry("1.2.3.4/40"), isIpEntry("abc")], [true, true, true, false, false, false]);

  // ── Working calendar ────────────────────────────────────────────────────
  const cal: Calendar = { holidays: new Map([["2026-11-18", { name: "Founders' Day", isOptional: false }], ["2026-11-19", { name: "Optional day", isOptional: true }]]), offSaturdays: [2, 4] };
  eq("att calendar: Saturdays of Nov 2026 are the 1st, 2nd, 3rd, 4th", ["2026-11-07", "2026-11-14", "2026-11-21", "2026-11-28"].map(nthOfMonth), [1, 2, 3, 4]);
  eq("att calendar: 2nd and 4th Saturdays and Sundays off; 1st and 3rd Saturdays working", ["2026-11-07", "2026-11-14", "2026-11-21", "2026-11-28", "2026-11-29", "2026-11-30"].map((d) => isWeeklyOff(d, [2, 4])), [false, true, false, true, true, false]);
  eq("att calendar: holiday is off, optional holiday is a working day", [dayKind("2026-11-18", cal), dayKind("2026-11-19", cal), dayKind("2026-11-14", cal)], ["holiday", "working", "weekly_off"]);

  const shift: ShiftHours = { startMin: 600, endMin: 1050, graceMinutes: 45, fullDayHours: 7.5, halfDayHours: 4 };
  const shiftX = { ...shift, firstHalfEndMin: 840, secondHalfStartMin: 840 };
  eq("att calendar: status from hours (full day = 7.5 h less 45 min grace = 6.75 h; half day 4 h)", [statusForHours(7.5, shift), statusForHours(6.75, shift), statusForHours(6.7, shift), statusForHours(4, shift), statusForHours(3.9, shift), statusForHours(7, shift, true)], ["present", "present", "half_day", "half_day", "absent", "wfh"]);

  const rec = (o: Partial<PunchRecord>): PunchRecord => ({ checkIn: new Date("2026-11-16T04:30:00Z"), checkOut: new Date("2026-11-16T12:00:00Z"), status: "present", isWfh: false, isExtraWork: false, isLate: false, isEarlyOut: false, hoursWorked: 7.5, ...o });
  const day = (d: string, o: Partial<Parameters<typeof resolveDay>[0]> = {}) => resolveDay({ day: d, today: "2026-11-21", cal, ...o }).status;
  eq("att calendar: resolveDay: past working day, no punch = absent; today = pending; future = upcoming", [day("2026-11-16"), day("2026-11-21"), day("2026-11-23")], ["absent", "pending", "upcoming"]);
  eq("att calendar: resolveDay: holiday, weekly off, full leave, half leave without punch", [day("2026-11-18"), day("2026-11-14"), day("2026-11-17", { leave: { half: "none", typeName: "CL", color: "blue" } }), day("2026-11-17", { leave: { half: "first", typeName: "CL", color: "blue" } })], ["holiday", "weekly_off", "leave", "half_day"]);
  eq("att calendar: before the go-live date a day is not tracked (“—”), even a past working day with no punch; from go-live it is absent", [day("2026-11-16", { goLive: "2026-11-18" }), day("2026-11-17", { goLive: "2026-11-17" }), day("2026-11-16", { goLive: null })], ["untracked", "absent", "absent"]);
  eq("att calendar: resolveDay: a punch wins over everything; missed check-out on a past day is absent", [day("2026-11-16", { record: rec({}) }), resolveDay({ day: "2026-11-16", today: "2026-11-21", cal, record: rec({ checkOut: null }) }), day("2026-11-21", { record: rec({ checkOut: null }) })].map((x) => (typeof x === "string" ? x : `${x.status}:${x.missedCheckout}`)), ["present", "absent:true", "present"]);

  // ── Check-in rules ──────────────────────────────────────────────────────
  const office = DEFAULT_SETTINGS.office;
  const near = { lat: office.lat + 100 / 111_320, lng: office.lng };
  const far = { lat: office.lat + 250 / 111_320, lng: office.lng };
  eq("att checkin: distance ~100 m and ~250 m north of the office", [Math.round(C.distanceMeters(office, near)), Math.round(C.distanceMeters(office, far))], [100, 250]);
  eq("att checkin: geofence: 100 m in, 250 m out, no position out", [C.withinGeofence(near, office), C.withinGeofence(far, office), C.withinGeofence(null, office)], [true, false, false]);
  eq("att checkin: IP exact, IPv4 range, IPv4-mapped IPv6, outside", [C.ipAllowed("203.0.113.10", ["203.0.113.10"]), C.ipAllowed("203.0.113.14", ["203.0.113.0/28"]), C.ipAllowed("203.0.113.16", ["203.0.113.0/28"]), C.ipAllowed("::ffff:203.0.113.10", ["203.0.113.10"]), C.ipAllowed(null, ["203.0.113.10"]), C.ipAllowed("1.1.1.1", [])], [true, true, false, true, false, false]);

  const s = { ...DEFAULT_SETTINGS, officeIps: ["203.0.113.10"] };
  const ci = (o: Partial<Parameters<typeof C.decideCheckIn>[0]>) => C.decideCheckIn({ alreadyCheckedIn: false, leaveToday: null, kind: "working", wfhApproved: false, ip: null, position: null, settings: s, ...o });
  const far2k = { lat: office.lat + 2300 / 111_320, lng: office.lng };
  eq("att checkin: within 200 m is in office (gps), with the distance", ci({ position: near }), { ok: true, method: "gps", place: "in_office", distanceM: 100, isWfh: false, isExtraWork: false });
  eq("att checkin: anywhere is allowed: 2.3 km away is remote", ci({ position: far2k }), { ok: true, method: "gps", place: "remote", distanceM: 2297, isWfh: false, isExtraWork: false });
  eq("att checkin: just outside the radius (250 m) is remote", ci({ position: far, ip: "8.8.8.8" }), { ok: true, method: "gps", place: "remote", distanceM: 250, isWfh: false, isExtraWork: false });
  eq("att checkin: no position and not the office network is refused with the exact message", ci({ ip: "8.8.8.8" }), { ok: false, error: "Location access is required to check in. Please allow location in your browser settings." });
  eq("att checkin: office network without a position is in office (ip)", ci({ ip: "203.0.113.10" }), { ok: true, method: "ip", place: "in_office", distanceM: null, isWfh: false, isExtraWork: false });
  eq("att checkin: office network with a far position is still in office (ip), distance kept", ci({ ip: "203.0.113.10", position: far2k }), { ok: true, method: "ip", place: "in_office", distanceM: 2297, isWfh: false, isExtraWork: false });
  eq("att checkin: GPS within the radius is preferred over the network (gps)", ci({ ip: "203.0.113.10", position: near }).ok && (ci({ ip: "203.0.113.10", position: near }) as { method: string }).method, "gps");
  eq("att checkin: remote with WFH approved is WFH; in office with WFH approved is not", [ci({ position: far2k, wfhApproved: true }), ci({ position: near, wfhApproved: true })].map((d) => d.ok && d.isWfh), [true, false]);
  eq("att checkin: an invalid position counts as none", ci({ position: { lat: 200, lng: 0 } }).ok, false);
  eq("att checkin: the radius comes from Settings (300 m makes 250 m in office)", (C.decideCheckIn({ alreadyCheckedIn: false, leaveToday: null, kind: "working", wfhApproved: false, ip: null, position: far, settings: { ...s, office: { ...s.office, radiusM: 300 } } }) as { place: string }).place, "in_office");
  eq("att checkin: a holiday or weekly off is extra work", [ci({ kind: "holiday", position: near }), ci({ kind: "weekly_off", ip: "203.0.113.10" })].map((d) => d.ok && d.isExtraWork), [true, true]);
  eq("att checkin: cannot check in twice", ci({ alreadyCheckedIn: true, position: near }).ok, false);
  eq("att checkin: cannot check in on full-day leave; can with half-day leave", [ci({ leaveToday: "none", position: near }).ok, ci({ leaveToday: "first", position: near }).ok], [false, true]);
  const co = (o: Partial<Parameters<typeof C.decideCheckOut>[0]>) => C.decideCheckOut({ checkedIn: true, checkedOut: false, ip: null, position: near, settings: s, ...o });
  eq("att checkout: allowed once, from anywhere with a position", [co({}).ok, co({ checkedOut: true }).ok, co({ checkedIn: false }).ok, co({ position: far2k }).ok], [true, false, false, true]);
  eq("att checkout: remote check-out is tagged with its distance", co({ position: far2k }), { ok: true, method: "gps", place: "remote", distanceM: 2297 });
  eq("att checkout: no position: refused (check-out wording), unless on the office network", [co({ position: null }), co({ position: null, ip: "203.0.113.10" }).ok], [{ ok: false, error: "Location access is required to check out. Please allow location in your browser settings." }, true]);
  eq("att place: old rows read their place from the method; regularized has none", [C.placeOfPunch(null, "ip"), C.placeOfPunch(null, "gps"), C.placeOfPunch(null, "wfh"), C.placeOfPunch(null, "manual"), C.placeOfPunch("remote", "gps"), C.placeOfPunch(null, null)], ["in_office", "in_office", "remote", null, "remote", null]);
  eq("att place: labels and distances for the reports", [C.placeLabel("in_office", 40), C.placeLabel("remote", 2340), C.placeLabel("remote", 420), C.placeLabel("remote", null), C.placeLabel(null, null), C.formatDistance(12_600)], ["In Office", "Remote (2.3 km)", "Remote (420 m)", "Remote", "", "13 km"]);
  eq("att place: area name: district then city; suburb by name; state alone; nothing", [C.areaName({ district: "Baner", city: "Pune" }), C.areaName({ osm_value: "suburb", name: "Kothrud", city: "Pune" }), C.areaName({ city: "Pune" }), C.areaName({ state: "Maharashtra" }), C.areaName({})], ["Baner, Pune", "Kothrud, Pune", "Pune", "Maharashtra", null]);
  eq("att checkin: late still applies from anywhere (11:00 check-in is late, wherever it is made)", C.isLate(660, 600, 45), true);

  eq("att checkin: late = after 10:00 + 45 min grace (10:45 on time, 10:46 late)", [C.isLate(645, 600, 45), C.isLate(646, 600, 45)], [false, true]);
  eq("att checkin: early out = before 17:30 − 30 min (17:00 not early, 16:59 early)", [C.isEarlyOut(1020, 1050, 30), C.isEarlyOut(1019, 1050, 30)], [false, true]);
  const fig = (o: Partial<Parameters<typeof C.computeDay>[0]>) => C.computeDay({ workedMs: 7.5 * 3_600_000, checkInMin: 600, checkOutMin: 1050, shift: shiftX, earlyOutMinutes: 30, isWfh: false, isExtraWork: false, halfLeave: null, ...o });
  eq("att checkin: a full day exactly on shift", fig({}), { hoursWorked: 7.5, deficitHours: 0, excessHours: 0, isLate: false, isEarlyOut: false, status: "present" });
  eq("att checkin: late and long: 11:00–19:00 (8 h)", fig({ workedMs: 8 * 3_600_000, checkInMin: 660, checkOutMin: 1140 }), { hoursWorked: 8, deficitHours: 0, excessHours: 0.5, isLate: true, isEarlyOut: false, status: "present" });
  eq("att checkin: short day 10:00–15:00 is a half day, early out, 2.5 h short", fig({ workedMs: 5 * 3_600_000, checkOutMin: 900 }), { hoursWorked: 5, deficitHours: 2.5, excessHours: 0, isLate: false, isEarlyOut: true, status: "half_day" });
  eq("att checkin: with first-half leave, 14:00–17:30 is a full (half) day, not late", fig({ workedMs: 3.5 * 3_600_000, checkInMin: 840, halfLeave: "first" }), { hoursWorked: 3.5, deficitHours: 0.5, excessHours: 0, isLate: false, isEarlyOut: false, status: "half_day" });
  eq("att checkin: extra work: every hour is excess, never late or early", fig({ workedMs: 3 * 3_600_000, checkInMin: 700, checkOutMin: 880, isExtraWork: true }), { hoursWorked: 3, deficitHours: 0, excessHours: 3, isLate: false, isEarlyOut: false, status: "present" });

  const gate = (workedH: number, o: Partial<Parameters<typeof C.checkoutGate>[0]> = {}) => C.checkoutGate({ workedMs: workedH * 3_600_000, requiredHours: 7.5, isExtraWork: false, earlyApproved: false, ...o });
  eq("att checkout gate: closed until 7.5 h are worked (3 h 22 m in → opens in 4 h 08 m); open at exactly 7.5 h", [gate(3 + 22 / 60).allowed, C.formatWait(gate(3 + 22 / 60).remainingMs), gate(7.5).allowed, gate(7.5).remainingMs], [false, "4h 8m", true, 0]);
  eq("att checkout gate: an approved early check-out opens it; extra work has no minimum; half-day leave needs the half-day hours", [gate(2, { earlyApproved: true }).why, gate(1, { isExtraWork: true }).why, gate(4, { requiredHours: 4 }).allowed, gate(3.9, { requiredHours: 4 }).allowed], ["approved_early", "extra_work", true, false]);
  eq("att checkout gate: the wait is rounded up to the minute", [C.formatWait(1), C.formatWait(60_000), C.formatWait(61_000), C.formatWait(3_600_000)], ["1m", "1m", "2m", "1h 0m"]);
  eq("att time: 12-hour clock", [T.istClock12(T.istMoment("2026-11-21", 615)), T.istClock12(T.istMoment("2026-11-21", 0)), T.istClock12(T.istMoment("2026-11-21", 12 * 60 + 5)), T.istClock12(T.istMoment("2026-11-21", 17 * 60 + 30))], ["10:15 AM", "12:00 AM", "12:05 PM", "5:30 PM"]);

  // ── Leave days and balances ─────────────────────────────────────────────
  const noHol: Calendar = { holidays: new Map(), offSaturdays: [2, 4] };
  eq("att leave: Mon 16 – Mon 23 Nov = 7 days (3rd Saturday worked, Sunday not counted)", L.leaveDays({ start: "2026-11-16", end: "2026-11-23", halfDay: "none", countWeekends: false, cal: noHol }), 7);
  eq("att leave: …and 6 with a holiday on the 18th; 8 when weekly offs count", [L.leaveDays({ start: "2026-11-16", end: "2026-11-23", halfDay: "none", countWeekends: false, cal }), L.leaveDays({ start: "2026-11-16", end: "2026-11-23", halfDay: "none", countWeekends: true, cal })], [6, 8]);
  eq("att leave: a half day is 0.5; on a weekly off it is 0; over two dates it is 0", [L.leaveDays({ start: "2026-11-16", end: "2026-11-16", halfDay: "first", countWeekends: false, cal }), L.leaveDays({ start: "2026-11-14", end: "2026-11-14", halfDay: "first", countWeekends: false, cal }), L.leaveDays({ start: "2026-11-16", end: "2026-11-17", halfDay: "first", countWeekends: false, cal })], [0.5, 0, 0]);
  eq("att leave: entitlement: full for an earlier joiner; prorated by months for a joiner (CL 12 joining in July = 6; PL 15 joining in Nov = 2.5)", [L.entitlementFor(12, 2026, "2020-04-01"), L.entitlementFor(12, 2026, "2026-07-15"), L.entitlementFor(15, 2026, "2026-11-02"), L.entitlementFor(12, 2026, "2027-01-01"), L.entitlementFor(8, 2026, null)], [12, 6, 2.5, 0, 8]);
  eq("att leave: monthly accrual: 12/yr in November = 11; a past year = all; full-year = all", [L.accrued({ entitled: 12, accrualType: "monthly", year: 2026, today: "2026-11-21", dateOfJoining: null }), L.accrued({ entitled: 12, accrualType: "monthly", year: 2025, today: "2026-11-21", dateOfJoining: null }), L.accrued({ entitled: 12, accrualType: "full_year", year: 2026, today: "2026-01-02", dateOfJoining: null })], [11, 12, 12]);
  eq("att leave: monthly accrual for a September joiner (4 months, 4 days entitled) by November = 3", L.accrued({ entitled: 4, accrualType: "monthly", year: 2026, today: "2026-11-21", dateOfJoining: "2026-09-01" }), 3);
  eq("att leave: nothing accrues before the joining date or for a future year", [L.accrued({ entitled: 12, accrualType: "full_year", year: 2026, today: "2026-11-21", dateOfJoining: "2026-12-01" }), L.accrued({ entitled: 12, accrualType: "full_year", year: 2027, today: "2026-11-21", dateOfJoining: null })], [0, 0]);
  eq("att leave: carry forward: up to the cap (PL 10), never negative, none with cap 0", [L.carryForward(14, 10), L.carryForward(6.5, 10), L.carryForward(-2, 10), L.carryForward(5, 0)], [10, 6.5, 0, 0]);
  eq("att leave: balance = accrued + carried + adjusted − booked − pending", L.balanceOf({ accrued: 15, carried: 10, adjusted: -1, booked: 6, pending: 2.5 }), 15.5);

  const CL: L.LeaveRule = { name: "Casual Leave", isActive: true, availableTo: "all", allowHalfDay: true, halfDayFirst: true, halfDaySecond: true, maxConsecutiveDays: null, noticePeriodDays: 1, requiresDocumentAfterDays: null, requiresReason: false, countWeekends: false };
  const SL: L.LeaveRule = { ...CL, name: "Sick Leave", allowHalfDay: false, noticePeriodDays: 0, requiresDocumentAfterDays: 3, requiresReason: true };
  const PL: L.LeaveRule = { ...CL, name: "Privileged Leave", allowHalfDay: false, noticePeriodDays: 7, requiresReason: true, maxConsecutiveDays: 10 };
  const lc = (o: Partial<L.LeaveCheck>) => L.checkLeave({ type: CL, employmentType: "staff", start: "2026-11-23", end: "2026-11-23", halfDay: "none", days: 1, today: "2026-11-21", windowDays: 31, reason: "", hasAttachment: false, checkedInDays: new Set(), overlaps: false, available: 12, ...o });
  eq("att leave check: a normal CL request is fine", lc({}), null);
  eq("att leave check: CL needs 1 day's notice (today refused, tomorrow fine)", [lc({ start: "2026-11-21", end: "2026-11-21" }) !== null, lc({ start: "2026-11-22", end: "2026-11-22" })], [true, null]);
  eq("att leave check: PL needs 7 days' notice", lc({ type: PL, reason: "trip", start: "2026-11-25", end: "2026-11-25" }), "Privileged Leave needs 7 days' notice: the earliest start is 28 Nov 2026.");
  eq("att leave check: past dates refused for types with notice (CL, PL)", lc({ start: "2026-11-20", end: "2026-11-20" }), "Casual Leave cannot be applied for past dates.");
  eq("att leave check: Sick Leave may be backdated within the window, not beyond", [lc({ type: SL, reason: "fever", start: "2026-11-19", end: "2026-11-19" }), lc({ type: SL, reason: "fever", start: "2026-10-01", end: "2026-10-01" })], [null, "Leave can be applied at most 31 days back."]);
  eq("att leave check: sick leave over 3 days needs a document; 3 days does not", [lc({ type: SL, reason: "flu", start: "2026-11-23", end: "2026-11-26", days: 4 }) !== null, lc({ type: SL, reason: "flu", start: "2026-11-23", end: "2026-11-26", days: 4, hasAttachment: true }), lc({ type: SL, reason: "flu", start: "2026-11-23", end: "2026-11-25", days: 3 })], [true, null, null]);
  eq("att leave check: reason required where the type says so", lc({ type: SL, start: "2026-11-23", end: "2026-11-23" }), "Give a reason for Sick Leave.");
  eq("att leave check: half days only where allowed and on a single date", [lc({ type: PL, reason: "x", start: "2026-12-01", end: "2026-12-01", halfDay: "first", days: 0.5 }), lc({ halfDay: "first", end: "2026-11-24", days: 0.5 }), lc({ halfDay: "second", days: 0.5 })], ["Privileged Leave cannot be taken as a half day.", "A half day is for a single date.", null]);
  eq("att leave check: cannot take leave on a day already checked in; second-half leave that day is fine", [lc({ start: "2026-11-22", end: "2026-11-22", checkedInDays: new Set(["2026-11-22"]) }) !== null, lc({ start: "2026-11-22", end: "2026-11-22", halfDay: "second", days: 0.5, checkedInDays: new Set(["2026-11-22"]) })], [true, null]);
  eq("att leave check: overlapping leave, balance, max in a row, all-weekend dates, not available to interns", [
    lc({ overlaps: true }),
    lc({ days: 3, end: "2026-11-25", available: 2 }),
    lc({ type: PL, reason: "x", start: "2026-12-01", end: "2026-12-14", days: 11, available: 20 }),
    lc({ days: 0 }),
    lc({ type: { ...CL, availableTo: "staff" }, employmentType: "intern" }),
  ], ["You already have leave on some of these days.", "Not enough Casual Leave: 3 days asked, 2 left.", "Privileged Leave can be at most 10 days in one go.", "Those dates are all weekly offs or holidays, so no leave is needed.", "Casual Leave is not available to you."]);
  eq("att leave: cancel while pending, or approved before it starts", [L.canCancelLeave({ status: "pending", startDate: "2026-11-01" }, "2026-11-21"), L.canCancelLeave({ status: "approved", startDate: "2026-11-25" }, "2026-11-21"), L.canCancelLeave({ status: "approved", startDate: "2026-11-21" }, "2026-11-21"), L.canCancelLeave({ status: "rejected", startDate: "2026-12-01" }, "2026-11-21")], [true, true, false, false]);

  // ── Comp-off ────────────────────────────────────────────────────────────
  eq("att compoff: expires 90 days after the day worked", CO.expiryFor("2026-11-14", 90), "2027-02-12");
  const earned: CO.Earned[] = [
    { id: "b", workedDate: "2026-10-11", expiryDate: "2027-01-09", days: 1 },
    { id: "a", workedDate: "2026-09-13", expiryDate: "2026-12-12", days: 1 },
    { id: "c", workedDate: "2026-11-14", expiryDate: "2027-02-12", days: 0.5 },
  ];
  const states = (spends: CO.Spend[], today: string) => Object.fromEntries(CO.allocate(earned, spends, today).states.map((e) => [e.id, [e.used, e.remaining, e.expired]]));
  eq("att compoff: used oldest (soonest to expire) first", states([{ date: "2026-11-23", days: 1.5 }], "2026-11-21"), { a: [1, 0, false], b: [0.5, 0.5, false], c: [0, 0.5, false] });
  eq("att compoff: what is left past its expiry date has expired", states([], "2026-12-20"), { a: [0, 1, true], b: [0, 1, false], c: [0, 0.5, false] });
  eq("att compoff: a leave after a comp-off expired cannot draw on it", states([{ date: "2026-12-15", days: 1 }], "2026-12-20"), { a: [0, 1, true], b: [1, 0, false], c: [0, 0.5, false] });
  eq("att compoff: balance today, and what could cover a given date", [CO.compoffBalance(earned, [{ date: "2026-11-23", days: 1 }], "2026-11-21"), CO.availableOn(earned, [], "2026-12-20", "2026-11-21"), CO.availableOn(earned, [], "2026-11-01", "2026-10-20")], [1.5, 1.5, 2]);
  const claim = (o: Partial<Parameters<typeof CO.checkCompoffClaim>[0]>) => CO.checkCompoffClaim({ workedDate: "2026-11-14", today: "2026-11-21", kind: "weekly_off", type: "full", hoursWorked: 7, checkedOut: true, shift, expiryDays: 90, alreadyClaimed: false, ...o });
  eq("att compoff claim: a worked weekly off with a full day's hours", claim({}), null);
  eq("att compoff claim: refused for a working day, a future day, twice, without check-out, after expiry", [claim({ kind: "working" }), claim({ workedDate: "2026-11-28" }), claim({ alreadyClaimed: true }), claim({ checkedOut: false }), claim({ today: "2027-03-01" })].map((x) => x !== null), [true, true, true, true, true]);
  eq("att compoff claim: full needs 6.75 h; half needs 4 h", [claim({ hoursWorked: 5 }) !== null, claim({ hoursWorked: 5, type: "half" }), claim({ hoursWorked: 3, type: "half" }) !== null], [true, null, true]);

  // ── Regularization ──────────────────────────────────────────────────────
  const re = (o: Partial<Parameters<typeof regularizationEligibility>[0]>) => regularizationEligibility({ day: "2026-11-16", today: "2026-11-21", windowDays: 31, kind: "working", onFullLeave: false, liveRequest: false, record: null, ...o });
  eq("att regularization: a working day with no punch → both times", re({}), { ok: true, missed: ["both"] });
  eq("att regularization: checked in, no check-out → the check-out", re({ record: { checkIn: true, checkOut: false } }), { ok: true, missed: ["checkout"] });
  eq("att regularization: both punches present → nothing missed", re({ record: { checkIn: true, checkOut: true } }).ok, false);
  eq("att regularization: today, the future, beyond 31 days, on leave, already asked, an unworked weekly off → refused", [re({ day: "2026-11-21" }), re({ day: "2026-11-25" }), re({ day: "2026-10-20" }), re({ onFullLeave: true }), re({ liveRequest: true }), re({ kind: "weekly_off" })].map((x) => x.ok), [false, false, false, false, false, false]);
  eq("att regularization: nothing before the go-live date", [re({ goLive: "2026-11-17" }).ok, re({ goLive: "2026-11-16" }).ok], [false, true]);
  eq("att regularization: exactly 31 days back is allowed, 32 is not", [re({ day: "2026-10-21" }).ok, re({ day: "2026-10-20" }).ok], [true, false]);
  eq("att regularization: extra work with a missed check-out on a weekly off can be corrected", re({ kind: "weekly_off", record: { checkIn: true, checkOut: false } }), { ok: true, missed: ["checkout"] });
  eq("att regularization: times: check-out after check-in, check-in from 06:00, check-out after the recorded check-in", [
    checkRegularizationTimes({ missed: "both", checkIn: "10:05", checkOut: "17:40" }),
    checkRegularizationTimes({ missed: "both", checkIn: "18:00", checkOut: "17:00" }).ok,
    checkRegularizationTimes({ missed: "both", checkIn: "05:00", checkOut: "17:00" }).ok,
    checkRegularizationTimes({ missed: "checkout", checkIn: null, checkOut: "09:30", recordedCheckInMin: 600 }).ok,
    checkRegularizationTimes({ missed: "checkout", checkIn: null, checkOut: "", recordedCheckInMin: 600 }).ok,
  ], [{ ok: true, checkInMin: 605, checkOutMin: 1060 }, false, false, false, false]);
  eq("att regularization: a check-out with no check-in recorded → the check-in", re({ record: { checkIn: false, checkOut: true } }), { ok: true, missed: ["checkin"] });
  eq("att regularization: times: a missed check-in must be before the recorded check-out", [
    checkRegularizationTimes({ missed: "checkin", checkIn: "10:00", checkOut: null, recordedCheckOutMin: 1050 }).ok,
    checkRegularizationTimes({ missed: "checkin", checkIn: "18:00", checkOut: null, recordedCheckOutMin: 1050 }).ok,
  ], [true, false]);
  eq("att regularization cards: what is missing, or grey once asked for (pending) or corrected (approved)", [
    pastCardState({ missed: "checkin", request: null }), pastCardState({ missed: "checkout", request: null }), pastCardState({ missed: "both", request: null }),
    pastCardState({ missed: "checkout", request: "pending" }), pastCardState({ missed: "both", request: "approved" }), pastCardState({ missed: null, request: null }),
  ], ["missing_checkin", "missing_checkout", "missing_both", "pending", "regularized", null]);
  eq("att regularization cards: only a missing punch has an action", (Object.keys(PAST_CARD_TEXT) as (keyof typeof PAST_CARD_TEXT)[]).filter((k) => PAST_CARD_TEXT[k].action), ["missing_checkin", "missing_checkout", "missing_both"]);
  eq("att regularization cards: the missed check-out button reads as asked", PAST_CARD_TEXT.missing_checkout.action, "Add check-out time");

  // ── Planned working days ────────────────────────────────────────────────
  const pe = (o: Partial<Parameters<typeof planEligibility>[0]>) => planEligibility({ day: "2026-12-01", today: "2026-11-25", kind: "working", onFullLeave: false, livePlan: false, ...o });
  eq("att plan: a working day ahead can be planned", pe({}), { ok: true });
  eq("att plan: today, the past, beyond 30 days, a weekly off, a holiday, on leave, already planned → refused", [pe({ day: "2026-11-25" }), pe({ day: "2026-11-20" }), pe({ day: "2026-12-26" }), pe({ kind: "weekly_off" }), pe({ kind: "holiday" }), pe({ onFullLeave: true }), pe({ livePlan: true })].map((x) => x.ok), [false, false, false, false, false, false, false]);
  eq("att plan: tomorrow and exactly 30 days ahead are allowed", [pe({ day: "2026-11-26" }).ok, pe({ day: "2026-12-25" }).ok], [true, true]);
  eq("att plan: times: both needed, from 06:00, check-out after check-in", [
    checkPlanTimes("10:00", "18:30"), checkPlanTimes("", "18:00").ok, checkPlanTimes("10:00", null).ok, checkPlanTimes("05:30", "12:00").ok, checkPlanTimes("18:00", "18:00").ok,
  ], [{ ok: true, checkInMin: 600, checkOutMin: 1110 }, false, false, false, false]);

  // ── Time picker wheels ──────────────────────────────────────────────────
  eq("att wheel: hours 00–23", [W.WHEEL_HOURS.length, W.WHEEL_HOURS[0], W.WHEEL_HOURS[23]], [24, 0, 23]);
  eq("att wheel: minutes in 5-minute steps", W.wheelMinutes(30), [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  eq("att wheel: a saved minute off the grid keeps its place", W.wheelMinutes(47), [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 47, 50, 55]);
  eq("att wheel: split and join HH:MM (bad input falls back)", [W.splitHm("09:45"), W.splitHm("9:05"), W.splitHm("25:00"), W.splitHm(""), W.joinHm(7, 5)], [[9, 45], [9, 5], [10, 0], [10, 0], "07:05"]);
  eq("att wheel: 12-hour reading", [W.hm12("00:05"), W.hm12("10:15"), W.hm12("12:00"), W.hm12("17:30")], ["12:05 AM", "10:15 AM", "12:00 PM", "5:30 PM"]);
  eq("att wheel: a scroll settles on the nearest row, inside the list", [W.snapIndex(0, 44, 24), W.snapIndex(65, 44, 24), W.snapIndex(67, 44, 24), W.snapIndex(-30, 44, 24), W.snapIndex(5000, 44, 24)], [0, 1, 2, 0, 23]);

  // ── Timesheets ──────────────────────────────────────────────────────────
  eq("att timesheet: draft and rejected weeks are editable; submitted and approved are locked", [canEditWeek(null), canEditWeek("draft"), canEditWeek("rejected"), canEditWeek("submitted"), canEditWeek("approved")], [true, true, true, false, false]);
  eq("att timesheet: the week's days", weekDays("2026-11-16"), ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]);
  const te = (o: Partial<Parameters<typeof checkTimeEntry>[0]>) => checkTimeEntry({ date: "2026-11-20", hours: 2, today: "2026-11-21", otherHoursThatDay: 0, status: null, description: "", ...o });
  eq("att timesheet: entries: fine; future, locked, zero, odd quarters, over 24 h refused", [te({}), te({ date: "2026-11-22" }) !== null, te({ status: "submitted" }) !== null, te({ hours: 0 }) !== null, te({ hours: 1.3 }) !== null, te({ hours: 5, otherHoursThatDay: 20 }) !== null], [null, true, true, true, true, true]);
  eq("att timesheet: submit: fine; not a Monday, future week, empty, already submitted refused", [checkSubmitWeek({ start: "2026-11-16", today: "2026-11-21", status: "draft", totalHours: 30 }), checkSubmitWeek({ start: "2026-11-17", today: "2026-11-21", status: null, totalHours: 3 }) !== null, checkSubmitWeek({ start: "2026-11-23", today: "2026-11-21", status: null, totalHours: 3 }) !== null, checkSubmitWeek({ start: "2026-11-16", today: "2026-11-21", status: null, totalHours: 0 }) !== null, checkSubmitWeek({ start: "2026-11-16", today: "2026-11-21", status: "submitted", totalHours: 9 }) !== null], [null, true, true, true, true]);

  // ── Feeds ───────────────────────────────────────────────────────────────
  const people = [
    { userId: "1", name: "Asha Rao", dateOfBirth: "1990-11-21", dateOfJoining: "2020-11-21" },
    { userId: "2", name: "Ben Shah", dateOfBirth: "1992-02-29", dateOfJoining: "2026-11-18" },
    { userId: "3", name: "Chitra Iyer", dateOfBirth: "1985-12-05", dateOfJoining: "2026-11-21" },
    { userId: "4", name: "Dev Patil", dateOfBirth: null, dateOfJoining: "2026-11-01" },
  ];
  eq("att feeds: today: Asha's birthday and 6th anniversary, Ben and Chitra joined in the last 7 days (Dev 20 days ago is not)", todaysEvents(people, "2026-11-21").map((e) => `${e.type}:${e.name}${e.years ? `:${e.years}` : ""}`), ["birthday:Asha Rao", "anniversary:Asha Rao:6", "joiner:Ben Shah", "joiner:Chitra Iyer"]);
  eq("att feeds: a 29 Feb birthday falls on 28 Feb in a common year", [onYear("02-29", 2027), onYear("02-29", 2028)], ["2027-02-28", "2028-02-29"]);
  eq("att feeds: upcoming 30 days: Chitra's birthday on 5 Dec; no anniversary in the joining year", upcomingEvents(people, "2026-11-21").map((e) => `${e.type}:${e.name}:${e.date}`), ["birthday:Chitra Iyer:2026-12-05"]);
  eq("att feeds: a range crossing the new year", eventsBetween([{ userId: "x", name: "X", dateOfBirth: "1990-01-02", dateOfJoining: null }], "2026-12-30", 5).map((e) => e.date), ["2027-01-02"]);
  eq("att feeds: templates fill the first name and years", fillTemplate("Congratulations on {years} year(s), {name}!", { name: "Asha Rao", years: 6 }), "Congratulations on 6 year(s), Asha!");
  eq("att feeds: wishes are 2 to 300 characters", [cleanWish("  Happy   birthday! "), cleanWish("x"), cleanWish("y".repeat(301))], ["Happy birthday!", null, null]);

  // ── Roles and approval routing ──────────────────────────────────────────
  eq("att roles: Attendance tile = member; Attendance Admin App Admin = HR (and member); head_admin = all; nothing = none", [
    attRolesFor({ hubRole: "member", access: true, adminAppAdmin: false }),
    attRolesFor({ hubRole: "member", access: false, adminAppAdmin: true }),
    attRolesFor({ hubRole: "head_admin", access: false, adminAppAdmin: false }),
    attRolesFor({ hubRole: "super_admin", access: false, adminAppAdmin: false }),
  ], [["attendance_member"], ["attendance_member", "attendance_admin"], ["attendance_member", "attendance_admin", "attendance_super_admin"], []]);
  eq("att roles: isMember / isAdmin", [isMember(["attendance_admin"]), isAdmin(["attendance_member"])], [true, false]);
  eq("att nav: HR menu has Daily Report between Today and Approvals", navFor("admin", ["attendance_admin"]).slice(0, 3).map((i) => [i.label, i.href]), [["Today", "/attendance/admin"], ["Daily Report", "/attendance/admin/daily-report"], ["Approvals", "/attendance/admin/approvals"]]);
  const drow = (o: Partial<DR.DailyRow>): DR.DailyRow => ({ userId: "u", name: "Asha", email: "asha@x.in", checkIn: "2026-11-25T04:35:00Z", checkOut: "2026-11-25T12:10:00Z", place: "in_office", area: null, distanceM: 40, hoursWorked: 7.58, hoursSoFar: null, isLate: false, isEarlyOut: false, isWfh: false, regularized: false, absent: false, onLeave: false, ...o });
  eq("att daily: file name daily-report-25-nov-2026.csv (no leading zero)", [DR.dailyFileName("2026-11-25"), DR.dailyFileName("2026-01-05")], ["daily-report-25-nov-2026.csv", "daily-report-5-jan-2026.csv"]);
  eq("att daily: status Present / Late / Absent / On Leave (early out is only a mark)", [DR.dailyStatus(drow({})), DR.dailyStatus(drow({ isLate: true })), DR.dailyStatus(drow({ isEarlyOut: true })), DR.dailyStatus(drow({ absent: true, isLate: true })), DR.dailyStatus(drow({ onLeave: true, isLate: true }))], ["Present", "Late", "Present", "Absent", "On Leave"]);
  eq("att daily: CSV header and rows (in office; remote with area and distance, not out yet, late; regularized)", DR.dailyRows([drow({}), drow({ name: "Rhea", email: "r@x.in", place: "remote", area: "Baner, Pune", distanceM: 2297, checkOut: null, hoursWorked: null, isLate: true }), drow({ name: "Ben", place: null, distanceM: null })]), [
    ["Name", "Email", "Check In", "Check Out", "Location", "Distance from Office", "Hours Worked", "Status", "Late"],
    ["Asha", "asha@x.in", "10:05", "17:40", "In Office", "40 m", 7.58, "Present", "No"],
    ["Rhea", "r@x.in", "10:05", "", "Remote · Baner, Pune", "2.3 km", "", "Late", "Yes"],
    ["Ben", "asha@x.in", "10:05", "17:40", "", "", 7.58, "Present", "No"],
  ]);
  eq("att roles: staff menu (HR also see Attendance Admin); admin menu only for HR", [navFor("staff", ["attendance_member"]).map((i) => i.label), navFor("staff", ["attendance_member", "attendance_admin"]).length, navFor("admin", ["attendance_member"]).length, navFor("admin", ["attendance_admin"])[0].label], [["Dashboard", "Attendance", "Leave", "Time", "More"], 6, 0, "Today"]);
  eq("att approvals: to the active manager; no manager, inactive manager or self → HR (null)", [approverFor({ id: "u", managerId: "m" }, true), approverFor({ id: "u", managerId: null }, true), approverFor({ id: "u", managerId: "m" }, false), approverFor({ id: "u", managerId: "u" }, true)], ["m", null, null, null]);
  eq("att approvals: who decides: the reporting manager it was sent to; HR cannot decide a manager's request; HR decide what was sent to HR (no manager) or what waits for a manager who left; nobody decides their own", [
    canDecide({ id: "m", hr: false }, { userId: "u", approverId: "m" }),
    canDecide({ id: "h", hr: true }, { userId: "u", approverId: "m" }),
    canDecide({ id: "h", hr: true }, { userId: "u", approverId: null }),
    canDecide({ id: "h", hr: true }, { userId: "u", approverId: "m" }, false),
    canDecide({ id: "h", hr: true }, { userId: "h", approverId: null }),
    canDecide({ id: "x", hr: false }, { userId: "u", approverId: "m" }),
    canDecide({ id: "m", hr: false }, { userId: "u", approverId: null }),
    canDecide({ id: "m", hr: true }, { userId: "u", approverId: "m" }),
  ], [true, false, true, true, false, false, false, true]);

  // ── Month tally ─────────────────────────────────────────────────────────
  const days = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23"];
  const recs: Record<string, PunchRecord> = {
    "2026-11-16": rec({ isLate: true }),
    "2026-11-17": rec({ status: "half_day", hoursWorked: 4.5, isEarlyOut: true }),
    "2026-11-20": rec({ status: "wfh", isWfh: true }),
    "2026-11-22": rec({ status: "present", isExtraWork: true, hoursWorked: 3 }),
  };
  const views = days.map((d) => resolveDay({ day: d, today: "2026-11-22", cal, record: recs[d] ?? null, leave: d === "2026-11-19" ? { half: "none", typeName: "CL", color: "blue" } : null }));
  eq("att tally: a week: present, half day, holiday, leave, WFH, absent 3rd Saturday, extra-work Sunday, future Monday", tally(views), { workingDays: 5, present: 1.5, absent: 1.5, late: 1, earlyOut: 1, leave: 1, wfh: 1, extraWork: 1, hours: 22.5, inOffice: 0, remote: 0 });
  eq("att tally: days checked in counted by place (regularized = neither)", (({ inOffice, remote }) => [inOffice, remote])(tally([
    { day: "2026-11-16", kind: "working", status: "present", record: rec({ place: "in_office" }) },
    { day: "2026-11-17", kind: "working", status: "present", record: rec({ place: "remote", distanceM: 2300 }) },
    { day: "2026-11-18", kind: "working", status: "present", record: rec({ place: "remote" }) },
    { day: "2026-11-19", kind: "working", status: "present", record: rec({ place: null }) },
  ] as unknown as Parameters<typeof tally>[0])), [1, 2]);
  const fromWed = days.map((d) => resolveDay({ day: d, today: "2026-11-22", cal, record: recs[d] ?? null, goLive: "2026-11-18" }));
  eq("att tally: days before go-live (Mon, Tue) are not counted at all, not even their hours", tally(fromWed), { workingDays: 3, present: 0, absent: 2, late: 0, earlyOut: 0, leave: 0, wfh: 1, extraWork: 1, hours: 10.5, inOffice: 0, remote: 0 });

  // ── Org chart ───────────────────────────────────────────────────────────
  const org = layout([
    { id: "d", name: "DG", designation: null, managerId: null },
    { id: "a", name: "Asha", designation: null, managerId: "d" },
    { id: "b", name: "Ben", designation: null, managerId: "d" },
    { id: "c", name: "Chitra", designation: null, managerId: null },
  ]);
  const at = (id: string) => org.placed.find((p) => p.id === id)!;
  eq("att org: people with no manager sit under HR; reports under their manager; a manager is centred over their reports", [at("d").parent, at("c").parent, at("a").parent, at(ORG_ROOT).parent, at("d").x === (at("a").x + at("b").x) / 2, at("a").y > at("d").y], [ORG_ROOT, ORG_ROOT, "d", null, true, true]);
  eq("att org: a reporting loop is still drawn (everyone appears once)", layout([{ id: "x", name: "X", designation: null, managerId: "y" }, { id: "y", name: "Y", designation: null, managerId: "x" }]).placed.length, 3);

  // ── App (PWA) ───────────────────────────────────────────────────────────
  eq("att app: the phone's bottom bar is Home, Leave, Time, More, Profile", BOTTOM_NAV.map((i) => i.label), ["Home", "Leave", "Time", "More", "Profile"]);
  eq("att app: iPhone Safari (not Chrome or Firefox on iPhone, not Android) is told to use Share → Add to Home Screen", [
    isIosSafari("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"),
    isIosSafari("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0 Mobile/15E148 Safari/604.1"),
    isIosSafari("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36"),
  ], [true, false, false]);
  const inst = (o: Partial<Parameters<typeof installState>[0]> = {}) => installState({ standalone: false, installedNow: false, hasOffer: false, ios: false, declined: false, ...o });
  eq("att install button: shown when the browser has offered its install box (ready) or on iPhone Safari (ios); nothing when the browser offers nothing",
    [inst({ hasOffer: true }), inst({ ios: true }), inst()], ["ready", "ios", "unavailable"]);
  eq("att install button: gone once the app is installed, or opened as the app, whatever the browser still says",
    [inst({ standalone: true, hasOffer: true }), inst({ installedNow: true, hasOffer: true }), inst({ installedNow: true, ios: true }), inst({ standalone: true, ios: true })], ["installed", "installed", "installed", "installed"]);
  eq("att install button: after the one-time offer was turned down it stays, with the menu steps (manual); a fresh offer or iPhone still win over that",
    [inst({ declined: true }), inst({ declined: true, hasOffer: true }), inst({ declined: true, ios: true })], ["manual", "ready", "ios"]);
  eq("att dark mode: no choice follows the device; a choice (light or dark) wins over the device", [isDarkTheme(null, true), isDarkTheme(null, false), isDarkTheme("light", true), isDarkTheme("dark", false)], [true, false, false, true]);
  eq("att dark mode: only \"light\" and \"dark\" are choices; anything else means the device setting", [parseThemePref("dark"), parseThemePref("light"), parseThemePref("auto"), parseThemePref(null)], ["dark", "light", null, null]);
  eq("att dark mode: browser bar colour", [themeColorFor(true), themeColorFor(false)], ["#000000", "#16A34A"]);
  eq("att push: base64url round trip", bytesToB64url(b64urlToBytes("BPx-_w")), "BPx-_w");
  eq("att push: bad or missing keys give no signing key", [vapidJwk(undefined, "x"), vapidJwk("abc", "def"), vapidJwk(bytesToB64url(new Uint8Array(65)), bytesToB64url(new Uint8Array(32)))], [null, null, null]);
  eq("att push: only the browsers' push services are accepted as endpoints (never an address of someone's choosing)", [
    pushAudience("https://fcm.googleapis.com/fcm/send/abc"),
    pushAudience("https://updates.push.services.mozilla.com/wpush/v2/x"),
    pushAudience("https://web.push.apple.com/QK"),
    pushAudience("http://fcm.googleapis.com/fcm/send/abc"),
    pushAudience("https://evil.example/fcm.googleapis.com"),
    pushAudience("https://fcm.googleapis.com.evil.example/x"),
    pushAudience("https://user:pw@fcm.googleapis.com/x"),
    pushAudience("not a url"),
  ], ["https://fcm.googleapis.com", "https://updates.push.services.mozilla.com", "https://web.push.apple.com", null, null, null, null, null]);
  eq("att push: host check", [isPushHost("wns2-par02p.notify.windows.com"), isPushHost("notify.windows.com.example")], [true, false]);
  eq("att push: subscriptions are checked before they are kept; 404 and 410 mean gone", [validSubscription({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "a", auth: "b" } }), validSubscription({ endpoint: "https://x.example/y" }), validSubscription(null), subscriptionGone(410), subscriptionGone(404), subscriptionGone(429)], [true, false, false, true, true, false]);

  // ── Isolation ───────────────────────────────────────────────────────────
  const srcDir = new URL("../src/", import.meta.url);
  const all = (readdirSync(srcDir, { recursive: true }) as string[]).filter((f) => /\.(ts|tsx)$/.test(f));
  const isAtt = (f: string) => /^(lib\/attendance|app\/attendance|components\/attendance|app\/api\/attendance)\//.test(f) || f === "db/attendance-schema.ts" || f === "app/api/cron/attendance-reminders/route.ts";
  const OTHER = /from "@\/(?:lib|components|app)\/(?:approvals|inventory|cabs|ivr|design|aistudio|eru)\/|from "@\/db\/(?:approvals|inventory|cabs|ivr|design|aistudio|eru)-schema"/;
  eq("att isolation: no Attendance file imports another module", all.filter(isAtt).filter((f) => OTHER.test(readFileSync(new URL(f, srcDir), "utf8"))), []);
  eq("att isolation: no file outside Attendance imports it", all.filter((f) => !isAtt(f)).filter((f) => /from "@\/(?:lib|components)\/attendance\/|from "@\/db\/attendance-schema"/.test(readFileSync(new URL(f, srcDir), "utf8"))), []);
  const HOST = /from "@\/(?:db|db\/schema|lib\/permissions|lib\/notifications|lib\/site-url|lib\/log-error|lib\/notice-feed|lib\/audit|lib\/mail|lib\/rbac|lib\/ip)"/;
  eq("att isolation: only the host-adapter (and db.ts) reach the hub's own code", all.filter(isAtt).filter((f) => f !== "lib/attendance/host-adapter.ts" && f !== "lib/attendance/db.ts" && HOST.test(readFileSync(new URL(f, srcDir), "utf8"))), []);
}
