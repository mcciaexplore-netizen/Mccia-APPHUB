/**
 * Integration test of the Attendance module's server code against a real Postgres, calling its functions directly (no browser, no web
 * server): who is a member and who is HR, check-in/out (office IP, outside, twice), leave (balances, apply, the approver, decide, cancel,
 * the checked-in rule), WFH, regularization (writing the corrected day), comp-off (claim, approve, spend oldest first), timesheets (submit,
 * reject with remark, resubmit, approve), HR balance adjustments with their notice, the manager field and its loop rule, feeds and wishes,
 * reminders (once a day), the today board and the reports.
 *
 * It WRITES to the database, so point it at a scratch database, never the live one:
 *   INTEGRATION_DB_CONFIRM=yes INTEGRATION_DATABASE_URL=postgres://localhost:5432/scratch npm run test:integration:attendance
 * The scratch database needs every migration applied first (npx drizzle-kit migrate, with DATABASE_URL pointing at it). Everything it creates
 * is named "ZZA"/"zza-" and is removed when it finishes (and at the start, if an earlier run was interrupted); the settings row is put back.
 * The project's own .env is NOT read, so it cannot reach the live database by accident. Uploads need storage and are not covered here.
 *
 * Days are real (today in IST), so a check that depends on today being a working day says so and adapts.
 */
import { randomUUID } from "node:crypto";

const url = process.env.INTEGRATION_DATABASE_URL;
if (process.env.INTEGRATION_DB_CONFIRM !== "yes" || !url) {
  console.error("Set INTEGRATION_DATABASE_URL to a scratch database and INTEGRATION_DB_CONFIRM=yes (this test writes to it).");
  process.exit(2);
}
if (/neon\.tech|supabase\.co/i.test(url) && process.env.INTEGRATION_ALLOW_REMOTE !== "yes") {
  console.error("Refusing: that looks like a hosted database. Use a local scratch database (or INTEGRATION_ALLOW_REMOTE=yes for a test branch).");
  process.exit(2);
}
process.env.DATABASE_URL = url;
process.env.DB_DRIVER = process.env.INTEGRATION_DB_DRIVER ?? "pg";
process.env.ATT_ENABLED = "true";
{
  // A throwaway push key pair for this run (phone notifications on).
  const { generateKeyPairSync } = await import("node:crypto");
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const pub = publicKey.export({ format: "jwk" });
  process.env.ATT_VAPID_PUBLIC_KEY = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x!, "base64url"), Buffer.from(pub.y!, "base64url")]).toString("base64url");
  process.env.ATT_VAPID_PRIVATE_KEY = privateKey.export({ format: "jwk" }).d!;
  process.env.ATT_VAPID_SUBJECT = "https://hub.example";
}
delete process.env.SMTP_HOST;

const { and, eq, inArray, like, sql } = await import("drizzle-orm");
const { db } = await import("../src/db");
const H = await import("../src/db/schema");
const T = await import("../src/db/attendance-schema");
const host = await import("../src/lib/attendance/host-adapter");
const cfg = await import("../src/lib/attendance/config");
const CI = await import("../src/lib/attendance/checkin");
const LV = await import("../src/lib/attendance/leave");
const RQ = await import("../src/lib/attendance/requests");
const AP = await import("../src/lib/attendance/approvals");
const TS = await import("../src/lib/attendance/timesheets");
const AD = await import("../src/lib/attendance/admin");
const OV = await import("../src/lib/attendance/overview");
const RP = await import("../src/lib/attendance/reports");
const { sendReminders } = await import("../src/lib/attendance/jobs");
const PUSH = await import("../src/lib/attendance/push");
const { DEFAULT_SETTINGS } = await import("../src/lib/attendance/settings");
const { dayKind } = await import("../src/lib/attendance/calendar");
const { addDays, istDay, istMoment, weekStart } = await import("../src/lib/attendance/time");

let ok = 0;
let bad = 0;
const check = (name: string, pass: unknown, extra: unknown = "") => {
  if (pass) ok++;
  else bad++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || extra === "" ? "" : `  -> ${JSON.stringify(extra).slice(0, 400)}`}`);
};
const refused = async (fn: () => Promise<unknown>, pattern: RegExp) => {
  try {
    await fn();
    return "not refused";
  } catch (e) {
    return pattern.test((e as Error).message) ? true : (e as Error).message;
  }
};

const OFFICE_IP = "203.0.113.77";
const [savedSettings] = await db.select().from(T.settings).where(eq(T.settings.key, "config"));

async function cleanup() {
  const people = (await db.select({ id: H.users.id }).from(H.users).where(like(H.users.email, "zza-%"))).map((u) => u.id);
  if (people.length) {
    for (const t of [T.attendance, T.leaveRequests, T.leaveBalances, T.leaveAdjustments, T.wfhRequests, T.earlyDepartures, T.regularizationRequests, T.compoffRequests, T.timeLogs, T.timesheets, T.userProfiles]) {
      await db.delete(t).where(inArray((t as typeof T.attendance).userId, people));
    }
    await db.delete(T.wishes).where(inArray(T.wishes.fromUserId, people));
    await db.delete(T.pushSubscriptions).where(inArray(T.pushSubscriptions.userId, people));
    await db.delete(T.announcements).where(inArray(T.announcements.createdBy, people));
    await db.delete(H.hubNotifications).where(inArray(H.hubNotifications.userId, people));
    await db.delete(H.accessAudit).where(inArray(H.accessAudit.actorId, people));
  }
  await db.delete(T.timeProjects).where(like(T.timeProjects.name, "ZZA%"));
  await db.delete(H.users).where(like(H.users.email, "zza-%"));
  await db.delete(H.apps).where(like(H.apps.name, "ZZA%"));
  await db.delete(H.departments).where(like(H.departments.name, "ZZA%"));
}

/** The next day from `from` on that is a working day for the calendar. */
async function nextWorking(from: string): Promise<string> {
  const cal = await cfg.calendarFor(from, addDays(from, 30));
  for (let d = from; ; d = addDays(d, 1)) if (dayKind(d, cal) === "working") return d;
}
async function lastWeeklyOff(before: string): Promise<string> {
  const cal = await cfg.calendarFor(addDays(before, -30), before);
  for (let d = addDays(before, -1); ; d = addDays(d, -1)) if (dayKind(d, cal) === "weekly_off") return d;
}

await cleanup();
try {
  const today = istDay();
  const year = Number(today.slice(0, 4));
  await cfg.saveSettings(randomUUID(), { ...DEFAULT_SETTINGS, officeIps: [OFFICE_IP] });
  const recorded = await cfg.getSettings();
  check("go-live: the first use records the day Attendance was switched on (today), the go-live date until HR set one", recorded.firstEnabledOn === today && recorded.goLiveDate === null, recorded);
  const preLive = await RQ.regularizableDays(randomUUID());
  check("go-live: going live today means no past day can be regularized yet", preLive.length === 0, preLive);
  await cfg.saveSettings(randomUUID(), { ...DEFAULT_SETTINGS, officeIps: [OFFICE_IP], goLiveDate: addDays(today, -60), firstEnabledOn: today });

  // ── The hub side: two applications and five people ───────────────────
  const [dept] = await db.insert(H.departments).values({ name: `ZZA HR ${randomUUID().slice(0, 6)}`, icon: "clock" }).returning();
  const [userApp] = await db.insert(H.apps).values({ departmentId: dept.id, name: "ZZA Attendance", url: "/attendance", icon: "clock" }).returning();
  const [adminApp] = await db.insert(H.apps).values({ departmentId: dept.id, name: "ZZA Attendance Admin", url: "/attendance/admin", icon: "clock" }).returning();
  const mk = async (name: string, managerId: string | null = null) =>
    (await db.insert(H.users).values({ name, email: `zza-${name.toLowerCase()}-${randomUUID().slice(0, 6)}@mcciapune.com`, reportingManagerId: managerId }).returning())[0];
  const mgr = await mk("Manju");
  const asha = await mk("Asha", mgr.id);
  const ben = await mk("Ben");
  const hr = await mk("Hema");
  const outsider = await mk("Omar");
  const rhea = await mk("Rhea");
  for (const u of [mgr, asha, ben, rhea]) await db.insert(H.userAppAccess).values({ userId: u.id, appId: userApp.id, appRole: "user" });
  await db.insert(H.appAdmins).values({ appId: adminApp.id, userId: hr.id });
  const A = { id: asha.id, name: asha.name };
  const M = { id: mgr.id, name: mgr.name };
  const B = { id: ben.id, name: ben.name };
  const HR = { id: hr.id, name: hr.name, hr: true };

  // ── Members and HR ────────────────────────────────────────────────────
  const members = (await host.listMembers()).map((m) => m.id);
  check("members: everyone with the Attendance tile, plus HR (App Admin of Attendance Admin); not someone without either", [asha, mgr, ben, hr].every((u) => members.includes(u.id)) && !members.includes(outsider.id), members.length);
  check("HR: the App Admins of Attendance Admin", JSON.stringify(await host.hrIds()) === JSON.stringify([hr.id]));
  check("approver: Asha's requests go to her manager; Ben (no manager) to HR", (await LV.approverIdFor(asha.id)) === mgr.id && (await LV.approverIdFor(ben.id)) === null);

  // ── Check-in / out ────────────────────────────────────────────────────
  const kindToday = dayKind(today, await cfg.calendarFor(today, today));
  check("check-in: refused without a location (and not on the office network) with the exact message", (await refused(() => CI.checkIn(asha.id, { ip: "8.8.8.8", position: null }), /^Location access is required to check in\. Please allow location in your browser settings\.$/)) === true);
  const inMsg = await CI.checkIn(asha.id, { ip: OFFICE_IP, position: null });
  const [rec] = await db.select().from(T.attendance).where(and(eq(T.attendance.userId, asha.id), eq(T.attendance.date, today)));
  check("check-in: from the office network, recorded as ip; extra work exactly when today is not a working day", rec?.checkInMethod === "ip" && rec.isExtraWork === (kindToday !== "working") && /network/.test(inMsg.message), { rec, kindToday });
  check("check-in: a second check-in today is refused", (await refused(() => CI.checkIn(asha.id, { ip: OFFICE_IP, position: null }), /already checked in/)) === true);
  const near = { lat: 18.5195 + 50 / 111_320, lng: 73.8553 };
  await CI.checkIn(ben.id, { ip: null, position: near });
  const card = await CI.todayCard(ben.id);
  check("check-in: within 150 m by phone, recorded as gps, in office, with its distance; the card shows it open", card.record?.method === "gps" && card.record.place === "in_office" && card.record.distanceM === 50 && !!card.record.checkIn && !card.record.checkOut, card.record);
  const away = { lat: 18.5195 + 2300 / 111_320, lng: 73.8553, accuracy: 12 };
  const remoteMsg = await CI.checkIn(rhea.id, { ip: "8.8.8.8", position: away });
  const [rr] = await db.select().from(T.attendance).where(and(eq(T.attendance.userId, rhea.id), eq(T.attendance.date, today)));
  check("check-in: from anywhere: 2.3 km away is allowed, tagged remote with coordinates, accuracy and distance", rr?.checkInPlace === "remote" && rr.checkInMethod === "gps" && rr.checkInDistanceM === 2297 && rr.checkInLat === away.lat && rr.checkInAccuracyM === 12 && /remotely \(2\.3 km from the office\)/.test(remoteMsg.message), { rr, remoteMsg });
  check("check-in: late is judged the same remotely as in the office (Rhea remote and Asha on the office network, moments apart)", rr?.isLate === rec?.isLate, { remote: rr?.isLate, office: rec?.isLate });
  check("card: the remote check-in shows remote with its distance", (await CI.todayCard(rhea.id)).record?.place === "remote");
  check("check-out: refused before the shift's 7.5 hours are worked (when today is a working day)", kindToday !== "working" || (await refused(() => CI.checkOut(ben.id, { ip: OFFICE_IP, position: null }), /once you have worked 7h 30m/)) === true);
  check("check-out: the card says 7.5 hours are required (0 on extra work)", card.requiredHours === (kindToday === "working" ? 7.5 : 0), card.requiredHours);
  if (kindToday === "working") {
    const { id: earlyId } = await RQ.applyEarlyDeparture(B, { reason: "doctor's appointment" });
    check("early check-out: asking twice the same day is refused", (await refused(() => RQ.applyEarlyDeparture(B, { reason: "again" }), /already asked/)) === true);
    check("early check-out: goes to HR (Ben has no manager) and shows in HR's inbox as an early check-out", (await AP.pendingFor(HR, true)).some((i) => i.id === earlyId && i.kind === "early"));
    check("early check-out: a colleague cannot decide it", (await refused(() => AP.decide({ ...A, hr: false }, "early", earlyId, true, ""), /not yours/)) === true);
    await AP.decide(HR, "early", earlyId, true, "");
    check("early check-out: once approved the card shows it", (await CI.todayCard(ben.id)).early?.status === "approved");
  }
  await CI.checkOut(ben.id, { ip: OFFICE_IP, position: null });
  const card2 = await CI.todayCard(ben.id);
  check("check-out: fills the check-out once, with hours", !!card2.record?.checkOut && card2.record.hoursWorked != null, card2.record);
  const [bo] = await db.select().from(T.attendance).where(and(eq(T.attendance.userId, ben.id), eq(T.attendance.date, today)));
  check("check-out: on the office network without a position is in office (ip); its place is stored", bo?.checkOutPlace === "in_office" && bo.checkOutMethod === "ip" && bo.checkOutLat === null, bo);
  check("check-out: a second check-out is refused", (await refused(() => CI.checkOut(ben.id, { ip: OFFICE_IP, position: null }), /already checked out/)) === true);
  const board = await OV.todayBoard();
  check("today board: Asha and Ben in office; Manju not in yet on a working day (off otherwise)", board.inOffice.some((p) => p.id === asha.id) && board.inOffice.some((p) => p.id === ben.id) && (kindToday === "working" ? board.notIn : board.off).some((p) => p.id === mgr.id));
  const rb = board.remote.find((p) => p.id === rhea.id);
  check("today board: Rhea under Remote, with her distance from the office", rb?.place === "remote" && rb.distanceM === 2297, rb);

  // ── Leave ─────────────────────────────────────────────────────────────
  const bal = await LV.balancesFor(asha.id, year);
  const byName = (n: string) => bal.find((b) => b.type.name === n);
  check("balances: CL 12, SL 8, PL 15, Comp-off 0 for someone who joined before this year", byName("Casual Leave")?.balance === 12 && byName("Sick Leave")?.balance === 8 && byName("Privileged Leave")?.balance === 15 && byName("Comp-off")?.balance === 0, bal.map((b) => [b.type.name, b.balance]));
  const types = await LV.listLeaveTypes();
  const PL = types.find((t) => t.name === "Privileged Leave")!;
  await db.insert(T.leaveBalances).values({ userId: ben.id, leaveTypeId: PL.id, year: year - 1, entitled: 15, carried: 0 });
  const benPl = (await LV.balancesFor(ben.id, year)).find((b) => b.type.id === PL.id);
  check("carry forward: with last year's row (15 left), PL carries the cap of 10 → 25; a first year carries nothing (Asha 15)", benPl?.carried === 10 && benPl.balance === 25, benPl);
  const CL = types.find((t) => t.name === "Casual Leave")!;
  const SL = types.find((t) => t.name === "Sick Leave")!;
  const CO = types.find((t) => t.isCompoff)!;
  check("leave: Sick Leave today is refused because Asha has checked in", (await refused(() => LV.applyLeave(A, { leaveTypeId: SL.id, startDate: today, endDate: today, halfDay: "none", reason: "unwell" }), /checked in/)) === true);
  const d1 = await nextWorking(addDays(today, 2));
  const { id: leaveId } = await LV.applyLeave(A, { leaveTypeId: CL.id, startDate: d1, endDate: d1, halfDay: "none", reason: "", ccUserIds: [ben.id] });
  const [lr] = await db.select().from(T.leaveRequests).where(eq(T.leaveRequests.id, leaveId));
  check("leave: sent to the manager, 1 day, CC kept", lr.approverId === mgr.id && Number(lr.daysCount) === 1 && lr.ccUserIds[0] === ben.id, lr);
  check("leave: pending holds the day (CL 11 left)", (await LV.balancesFor(asha.id, year)).find((b) => b.type.id === CL.id)?.balance === 11);
  check("leave: overlapping leave is refused", (await refused(() => LV.applyLeave(A, { leaveTypeId: CL.id, startDate: d1, endDate: d1, halfDay: "first", reason: "" }), /already have leave/)) === true);
  const notices = await db.select().from(H.hubNotifications).where(inArray(H.hubNotifications.userId, [mgr.id, ben.id]));
  check("leave: the manager is told on the bell, and the CC'd colleague too", notices.some((n) => n.userId === mgr.id && n.title === "New leave request from Asha") && notices.some((n) => n.userId === ben.id && /CC/.test(n.title)));
  const mInbox = await AP.pendingFor({ ...M, hr: false });
  const hrInbox = await AP.pendingFor(HR, true);
  check("inbox: the manager sees it (and may decide it); HR see it, read only; a colleague's inbox is empty", mInbox.some((i) => i.id === leaveId && i.canAct) && hrInbox.some((i) => i.id === leaveId && !i.canAct && !i.toHr) && (await AP.pendingFor({ ...B, hr: false })).length === 0);
  check("inbox: a request sent to a manager is not in HR's queue", !(await AP.hrQueue(HR)).some((i) => i.id === leaveId));
  check("decide: someone it was not sent to cannot decide", (await refused(() => AP.decide({ ...B, hr: false }, "leave", leaveId, true, ""), /not yours|Only the reporting manager/)) === true);
  check("decide: HR cannot approve a request sent to a manager", (await refused(() => AP.decide(HR, "leave", leaveId, true, ""), /Only the reporting manager this was sent to can decide it/)) === true);
  check("decide: nobody decides their own (not even as HR)", (await refused(() => AP.decide({ ...A, hr: true }, "leave", leaveId, true, ""), /You cannot decide your own request/)) === true);
  check("decide: rejecting needs a remark", (await refused(() => AP.decide({ ...M, hr: false }, "leave", leaveId, false, " "), /remark/)) === true);
  await AP.decide({ ...M, hr: false }, "leave", leaveId, true, "Enjoy");
  const afterApprove = (await LV.balancesFor(asha.id, year)).find((b) => b.type.id === CL.id)!;
  check("decide: approved → booked 1, pending 0, CL 11", afterApprove.booked === 1 && afterApprove.pending === 0 && afterApprove.balance === 11, afterApprove);
  check("decide: deciding again is refused (already decided)", (await refused(() => AP.decide(HR, "leave", leaveId, false, "no"), /already been decided/)) === true);
  check("decide: Asha is told “Manju approved your leave request”", (await db.select().from(H.hubNotifications).where(eq(H.hubNotifications.userId, asha.id))).some((n) => n.title === "Manju approved your leave request"));
  check("decide: HR are told “Asha's leave was approved by Manju”", (await db.select().from(H.hubNotifications).where(eq(H.hubNotifications.userId, hr.id))).some((n) => n.title === "Asha's leave was approved by Manju"));
  check("new request: the manager was told “New leave request from Asha”, HR were not", (await db.select().from(H.hubNotifications).where(eq(H.hubNotifications.userId, mgr.id))).some((n) => n.title === "New leave request from Asha") && !(await db.select().from(H.hubNotifications).where(eq(H.hubNotifications.userId, hr.id))).some((n) => n.title === "New leave request from Asha"));
  await LV.cancelLeave(asha.id, leaveId);
  check("cancel: approved leave not started can be cancelled; CL back to 12", (await LV.balancesFor(asha.id, year)).find((b) => b.type.id === CL.id)?.balance === 12);
  check("history: the manager's history has the decision", (await AP.historyFor({ ...M, hr: false })).some((i) => i.id === leaveId));

  // ── WFH ───────────────────────────────────────────────────────────────
  const d2 = await nextWorking(addDays(today, 1));
  const { id: wfhId } = await RQ.applyWfh(B, { date: d2, reason: "plumber visit", planNote: "reports" });
  check("wfh: Ben has no manager, so it goes to HR (approver null)", (await db.select().from(T.wfhRequests).where(eq(T.wfhRequests.id, wfhId)))[0].approverId === null);
  check("wfh: asking again for the same day is refused", (await refused(() => RQ.applyWfh(B, { date: d2, reason: "again" }), /already asked/)) === true);
  check("wfh: only HR can decide one sent to HR (not Asha)", (await refused(() => AP.decide({ ...A, hr: false }, "wfh", wfhId, true, ""), /not yours/)) === true);
  await AP.decide(HR, "wfh", wfhId, true, "");
  check("wfh: approved; that day's view is WFH", (await (await import("../src/lib/attendance/days")).personDays(ben.id, d2, d2)).views[0].wfh === true);

  check("wfh: sent to HR, HR are told it has no manager", (await db.select().from(H.hubNotifications).where(eq(H.hubNotifications.userId, hr.id))).some((n) => n.title === "New work from home request from Ben" && /No manager assigned - sent to HR for approval/.test(n.body ?? "")));

  // A manager who leaves: what waits for them goes to HR.
  const d5 = await nextWorking(addDays(today, 3));
  const { id: orphanId } = await RQ.applyWfh(A, { date: d5, reason: "visit" });
  check("left manager: before, HR cannot decide it", (await refused(() => AP.decide(HR, "wfh", orphanId, true, ""), /Only the reporting manager/)) === true);
  await db.update(H.users).set({ isActive: false }).where(eq(H.users.id, mgr.id));
  try {
    const q = await AP.hrQueue(HR);
    check("left manager: the request is now in HR's queue, marked as sent to HR", q.some((i) => i.id === orphanId && i.toHr && i.canAct));
    check("left manager: HR's sidebar count includes it", (await AP.pendingCountAll()) >= 1);
    await AP.decide(HR, "wfh", orphanId, false, "please ask your new manager");
  } finally {
    await db.update(H.users).set({ isActive: true }).where(eq(H.users.id, mgr.id));
  }
  check("left manager: HR decided it", (await db.select().from(T.wfhRequests).where(eq(T.wfhRequests.id, orphanId)))[0].decidedBy === hr.id);

  // ── Regularization ────────────────────────────────────────────────────
  const past = await nextWorking(addDays(today, -10));
  const missedDay = past < today ? past : addDays(today, -3);
  await db.insert(T.attendance).values({ userId: asha.id, date: missedDay, checkInTime: istMoment(missedDay, 600), checkInMethod: "ip", status: "present" });
  const regDays = await RQ.regularizableDays(asha.id);
  check("regularization: the day with a missed check-out is offered (checkout only)", regDays.some((d) => d.day === missedDay && d.missed[0] === "checkout"), regDays.slice(0, 3));
  check("regularization: a check-out before the check-in is refused", (await refused(() => RQ.applyRegularization(A, { date: missedDay, missed: "checkout", checkOut: "09:00", reason: "forgot" }), /after the check-in/)) === true);
  const { id: regId } = await RQ.applyRegularization(A, { date: missedDay, missed: "checkout", checkOut: "17:40", reason: "forgot to check out" });
  check("regularization: a second request for the day is refused", (await refused(() => RQ.applyRegularization(A, { date: missedDay, missed: "checkout", checkOut: "17:40", reason: "again" }), /already a regularization/)) === true);
  await AP.decide({ ...M, hr: false }, "regularization", regId, true, "");
  const [fixed] = await db.select().from(T.attendance).where(and(eq(T.attendance.userId, asha.id), eq(T.attendance.date, missedDay)));
  check("regularization: approval writes the check-out (17:40), hours 7.67, present, linked to the request", fixed.regularizationId === regId && Number(fixed.hoursWorked) === 7.67 && fixed.status === "present" && fixed.checkOutMethod === "manual", fixed);
  check("regularization: the day is no longer offered", !(await RQ.regularizableDays(asha.id)).some((d) => d.day === missedDay));
  const cards = await RQ.pastDayCards(asha.id);
  check("regularization cards: the corrected day stays as a grey 'regularized' card with its times", cards.some((c) => c.day === missedDay && c.state === "regularized" && c.checkOut === "17:40"), cards.slice(0, 3));

  // ── Planned working days ──────────────────────────────────────────────
  const planDay = await nextWorking(addDays(today, 3));
  const planList = await RQ.planCards(asha.id);
  check("plan: the next 30 days list working days only, from tomorrow", planList.length > 0 && planList.every((p) => p.day > today && p.day <= addDays(today, 30)) && planList.some((p) => p.day === planDay && !p.plan), planList.slice(0, 3));
  check("plan: today cannot be planned", (await refused(() => RQ.applyPlan(A, { date: today, checkIn: "10:00", checkOut: "18:00" }), /from tomorrow/)) === true);
  check("plan: a check-out before the check-in is refused", (await refused(() => RQ.applyPlan(A, { date: planDay, checkIn: "18:00", checkOut: "10:00" }), /after the check-in/)) === true);
  const { id: planId } = await RQ.applyPlan(A, { date: planDay, checkIn: "09:30", checkOut: "18:15" });
  check("plan: a second plan for the day is refused", (await refused(() => RQ.applyPlan(A, { date: planDay, checkIn: "10:00", checkOut: "18:00" }), /already planned/)) === true);
  const [planRow] = await db.select().from(T.regularizationRequests).where(eq(T.regularizationRequests.id, planId));
  check("plan: stored as a future request with its planned day and times, sent to the manager", planRow.isFuture && planRow.plannedDate === planDay && planRow.plannedCheckin?.startsWith("09:30") && planRow.plannedCheckout?.startsWith("18:15") && planRow.approverId === mgr.id && planRow.status === "pending", planRow);
  check("plan: it is not a past correction (the day is not offered or carded as missed)", !(await RQ.regularizableDays(asha.id)).some((d) => d.day === planDay) && !(await RQ.pastDayCards(asha.id)).some((c) => c.day === planDay));
  const mq = await AP.pendingFor({ ...M, hr: false });
  const inQueue = mq.find((i) => i.id === planId);
  check("plan: the manager sees it as a planned working day with its times", inQueue?.title === "Planned working day" && inQueue.detail === "Plans to work 09:30 – 18:15", inQueue);
  await AP.decide({ ...M, hr: false }, "regularization", planId, true, "ok");
  const planDayRec = await db.select().from(T.attendance).where(and(eq(T.attendance.userId, asha.id), eq(T.attendance.date, planDay)));
  check("plan: approving it writes nothing onto the day (the person still checks in)", planDayRec.length === 0, planDayRec);
  check("plan: the card shows the approved plan", (await RQ.planCards(asha.id)).some((p) => p.day === planDay && p.plan?.status === "approved" && p.plan.checkIn === "09:30" && p.plan.checkOut === "18:15"));
  const { id: planId2 } = await RQ.applyPlan(A, { date: await nextWorking(addDays(planDay, 1)), checkIn: "10:00", checkOut: "17:30", reason: "client visit" });
  await AP.decide({ ...M, hr: false }, "regularization", planId2, false, "not that day");
  const rejected = (await RQ.planCards(asha.id)).find((p) => p.plan?.id === planId2);
  check("plan: a rejected plan shows with its remark and the day can be planned again", rejected?.plan?.status === "rejected" && rejected.plan.remark === "not that day", rejected);
  const { id: planId3 } = await RQ.applyPlan(A, { date: rejected!.day, checkIn: "10:00", checkOut: "17:30" });
  await RQ.cancelRequest(asha.id, "regularization", planId3);
  const { id: benPlan } = await RQ.applyPlan(B, { date: planDay, checkIn: "10:00", checkOut: "17:30" });
  check("plan: with no manager it goes to HR's queue", (await AP.hrQueue(HR)).some((i) => i.id === benPlan && i.toHr && i.title === "Planned working day"));
  await AP.decide(HR, "regularization", benPlan, false, "test over");
  check("plan: a pending plan can be withdrawn", (await db.select().from(T.regularizationRequests).where(eq(T.regularizationRequests.id, planId3)))[0].status === "cancelled");

  // ── Comp-off ──────────────────────────────────────────────────────────
  const off = await lastWeeklyOff(today);
  await db.insert(T.attendance).values({ userId: asha.id, date: off, checkInTime: istMoment(off, 600), checkOutTime: istMoment(off, 1050), checkInMethod: "ip", isExtraWork: true, hoursWorked: 7.5, excessHours: 7.5, status: "present" });
  check("comp-off: the worked weekly off is claimable", (await RQ.claimableCompoffDays(asha.id)).some((d) => d.day === off));
  const { id: coId } = await RQ.applyCompoff(A, { workedDate: off, type: "full", reason: "event" });
  await AP.decide({ ...M, hr: false }, "compoff", coId, true, "");
  const [coRow] = await db.select().from(T.compoffRequests).where(eq(T.compoffRequests.id, coId));
  check("comp-off: approved with an expiry 90 days after the day worked", coRow.expiryDate === addDays(off, 90), coRow);
  check("comp-off: balance 1", (await LV.compoffSummary(asha.id)).balance === 1);
  const d3 = await nextWorking(addDays(today, 1));
  await LV.applyLeave(A, { leaveTypeId: CO.id, startDate: d3, endDate: d3, halfDay: "none", reason: "" });
  check("comp-off: taking it as leave uses it (balance 0)", (await LV.compoffSummary(asha.id)).balance === 0);
  const d4 = await nextWorking(addDays(d3, 1));
  check("comp-off: another day of comp-off leave is refused (none left)", (await refused(() => LV.applyLeave(A, { leaveTypeId: CO.id, startDate: d4, endDate: d4, halfDay: "none", reason: "" }), /Not enough Comp-off/)) === true);

  // ── Timesheets ────────────────────────────────────────────────────────
  await AD.saveProject({ name: "ZZA Project", description: "", isActive: true });
  const [proj] = await db.select().from(T.timeProjects).where(eq(T.timeProjects.name, "ZZA Project"));
  const wk = weekStart(today);
  await TS.addTimeLog(asha.id, { projectId: proj.id, date: wk, hours: 3.5, description: "drafting" });
  await TS.submitWeek(A, wk);
  check("timesheet: submitted week is locked", (await refused(() => TS.addTimeLog(asha.id, { projectId: proj.id, date: wk, hours: 1, description: "" }), /locked/)) === true);
  const [sheet] = await db.select().from(T.timesheets).where(and(eq(T.timesheets.userId, asha.id), eq(T.timesheets.weekStartDate, wk)));
  check("timesheet: sent to the manager with the total", sheet.status === "submitted" && sheet.approverId === mgr.id && Number(sheet.totalHours) === 3.5, sheet);
  await AP.decide({ ...M, hr: false }, "timesheet", sheet.id, false, "add Friday");
  await TS.addTimeLog(asha.id, { projectId: proj.id, date: wk, hours: 1, description: "fix" });
  await TS.submitWeek(A, wk);
  check("timesheet: HR cannot approve one sent to the manager", (await refused(() => AP.decide(HR, "timesheet", sheet.id, true, ""), /Only the reporting manager/)) === true);
  await AP.decide({ ...M, hr: false }, "timesheet", sheet.id, true, "");
  const [sheet2] = await db.select().from(T.timesheets).where(eq(T.timesheets.id, sheet.id));
  check("timesheet: rejected opens it; resubmitted 4.5 h; approved by the manager", sheet2.status === "approved" && Number(sheet2.totalHours) === 4.5 && sheet2.decidedBy === mgr.id, sheet2);
  check("timesheet: a project with time logged is closed, not deleted", (await AD.deleteProject(proj.id)) === "deactivated");

  // ── HR: balances, manager field, people ───────────────────────────────
  await AD.adjustBalance(HR, { userId: asha.id, leaveTypeId: CL.id, year, days: 2, remark: "Diwali duty" });
  check("adjust: +2 CL → 14", (await LV.balancesFor(asha.id, year)).find((b) => b.type.id === CL.id)?.balance === 14);
  check("adjust: Asha is told on the bell", (await db.select().from(H.hubNotifications).where(eq(H.hubNotifications.userId, asha.id))).some((n) => /added 2 days of Casual Leave/.test(n.title)));
  check("adjust: comp-off cannot be adjusted", (await refused(() => AD.adjustBalance(HR, { userId: asha.id, leaveTypeId: CO.id, year, days: 1, remark: "x x x" }), /comp-offs/)) === true);
  const tracker = await AD.leaveTracker(year);
  check("leave tracker: Asha's row has CL 14", tracker.rows.find((r) => r.userId === asha.id)?.balances[CL.id].balance === 14);
  check("manager: a loop is refused (Manju cannot report to Asha)", (await refused(() => host.setManager(HR, mgr.id, asha.id), /cannot be their manager/)) === true);
  await AD.updatePerson(HR, ben.id, { managerId: mgr.id, shiftId: null, employmentType: "consultant", dateOfJoining: "2024-03-01", dateOfBirth: `1990-${today.slice(5)}` });
  check("people: setting Ben's manager writes the hub's own field (and the access audit)", (await host.personFacts(ben.id))?.managerId === mgr.id && (await db.select().from(H.accessAudit).where(and(eq(H.accessAudit.actorId, hr.id), eq(H.accessAudit.action, "attendance.manager")))).length === 1);
  check("people: his requests now go to Manju", (await LV.approverIdFor(ben.id)) === mgr.id);

  // ── Feeds ─────────────────────────────────────────────────────────────
  const f = await OV.feed(asha.id);
  const bday = f.today.find((e) => e.userId === ben.id && e.type === "birthday");
  check("feed: Ben's birthday is today", !!bday && !bday.wished);
  await OV.sendWish(A, { toUserId: ben.id, type: "birthday", date: today, message: "Happy birthday, Ben!" });
  check("wishes: once per person per event", (await refused(() => OV.sendWish(A, { toUserId: ben.id, type: "birthday", date: today, message: "again" }), /already sent/)) === true);
  check("wishes: Ben sees it and is told", (await OV.feed(ben.id)).wishesForMe.some((w) => w.from === "Asha") && (await db.select().from(H.hubNotifications).where(eq(H.hubNotifications.userId, ben.id))).some((n) => /birthday wishes/.test(n.title)));

  // ── Reminders ─────────────────────────────────────────────────────────
  const noon = istMoment(today, 12 * 60);
  const first = await sendReminders(noon);
  const count = async () => (await db.select({ n: sql<number>`count(*)` }).from(H.hubNotifications).where(and(eq(H.hubNotifications.userId, mgr.id), like(H.hubNotifications.dedupeKey, "att:remind-in:%"))))[0].n;
  const n1 = Number(await count());
  await sendReminders(noon);
  const n2 = Number(await count());
  check("reminders: Manju (not checked in) is reminded on a working day, and only once however often it runs", kindToday === "working" ? n1 === 1 && n2 === 1 && first.checkIn >= 1 : n1 === 0, { kindToday, n1, n2, first });

  // ── Phone notifications (Web Push) ────────────────────────────────────
  const endpoint = `https://fcm.googleapis.com/fcm/send/zza-${randomUUID()}`;
  check("push: an endpoint that is not a browser push service is refused", (await refused(() => PUSH.saveSubscription(asha.id, { endpoint: "https://evil.example/x" }), /could not be used/)) === true);
  await PUSH.saveSubscription(asha.id, { endpoint, keys: { p256dh: "p", auth: "a" } });
  await PUSH.saveSubscription(asha.id, { endpoint, keys: { p256dh: "p2", auth: "a2" } });
  check("push: a subscription is kept once per browser", (await db.select().from(T.pushSubscriptions).where(eq(T.pushSubscriptions.userId, asha.id))).length === 1);
  const realFetch = globalThis.fetch;
  const calls: { url: string; headers: Record<string, string> }[] = [];
  let answer = 201;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith("https://fcm.googleapis.com/")) return realFetch(input, init);
    calls.push({ url, headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])) });
    return new Response(null, { status: answer });
  }) as typeof fetch;
  try {
    await AD.adjustBalance(HR, { userId: asha.id, leaveTypeId: CL.id, year, days: 0.5, remark: "push test" });
    const c = calls[0];
    check("push: a notice to Asha also wakes her phone: one POST, no body, VAPID-signed for the push service", calls.length === 1 && c.url === endpoint && /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/.test(c.headers.authorization ?? "") && c.headers["content-length"] === "0" && c.headers.ttl === "86400", calls);
    const latest = await host.latestNotice(asha.id);
    check("push: what the phone then shows is her newest notice", /added 0\.5 days of Casual Leave/.test(latest?.title ?? ""), latest);
    answer = 410;
    const r = await PUSH.pushTo([asha.id], "https://hub.example");
    check("push: a subscription the push service says is gone (410) is removed", r.removed === 1 && (await db.select().from(T.pushSubscriptions).where(eq(T.pushSubscriptions.userId, asha.id))).length === 0, r);
  } finally {
    globalThis.fetch = realFetch;
  }

  // ── Reports ───────────────────────────────────────────────────────────
  const month = await RP.monthlyReport(today.slice(0, 7));
  const ashaLine = month.find((l) => l.userId === asha.id);
  check("report: monthly line for Asha counts the regularized day as present", !!ashaLine && ashaLine.present >= 1, ashaLine);
  const csvs = await Promise.all([RP.leaveBalanceRows(year), RP.leaveHistoryRows(`${year}-01-01`, `${year}-12-31`), RP.timeByProjectRows(addDays(today, -14), today), RP.personMonthRows(asha.id, addDays(today, -14), today)]);
  check("report: the other CSVs have a header and rows", csvs.every((r) => r.length >= 2), csvs.map((r) => r.length));
} catch (e) {
  bad++;
  console.error("FAIL  crashed:", e);
} finally {
  await cleanup();
  if (savedSettings) await db.insert(T.settings).values(savedSettings).onConflictDoUpdate({ target: T.settings.key, set: { value: savedSettings.value } });
}
console.log(`\n${ok}/${ok + bad} attendance integration checks passed`);
process.exit(bad ? 1 : 0);
