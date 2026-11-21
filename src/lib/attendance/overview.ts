import "server-only";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "./db";
import { announcements, userProfiles, wishes } from "@/db/attendance-schema";
import { listMembers, notify, peopleByIds, type Member } from "./host-adapter";
import { loadDays, recordOf, viewOf } from "./days";
import { cleanWish, todaysEvents, upcomingEvents, type FeedEvent, type FeedType } from "./feeds";
import { AttError } from "./dal";
import { addDays, istClock, istDay } from "./time";
import { isUuid } from "./att.manifest";

/** Who is where today (Home → Team, HR's Today), the feed (birthdays, anniversaries, joiners, announcements) and wishes. */

export type TodayPerson = { id: string; name: string; teamName: string | null; branchName: string | null; designation: string | null; checkIn: string | null; checkOut: string | null; note: string | null; late: boolean };
export type TodayBoard = { day: string; inOffice: TodayPerson[]; wfh: TodayPerson[]; onLeave: TodayPerson[]; notIn: TodayPerson[]; off: TodayPerson[] };

export async function todayBoard(filter: { teamId?: string | null; branchId?: string | null } = {}): Promise<TodayBoard> {
  const day = istDay();
  let members: Member[] = await listMembers();
  if (filter.teamId) members = members.filter((m) => m.teamId === filter.teamId);
  if (filter.branchId) members = members.filter((m) => m.branchId === filter.branchId);
  const data = await loadDays(
    members.map((m) => m.id),
    day,
    day,
  );
  const board: TodayBoard = { day, inOffice: [], wfh: [], onLeave: [], notIn: [], off: [] };
  for (const m of members) {
    const v = viewOf(data, m.id, day, day);
    const r = recordOf(data, m.id, day);
    const p: TodayPerson = {
      id: m.id,
      name: m.name,
      teamName: m.teamName,
      branchName: m.branchName,
      designation: m.designation,
      checkIn: r?.checkInTime ? istClock(r.checkInTime) : null,
      checkOut: r?.checkOutTime ? istClock(r.checkOutTime) : null,
      note: v.leave ? `${v.leave.typeName}${v.leave.half !== "none" ? ` (${v.leave.half} half)` : ""}` : null,
      late: !!r?.isLate,
    };
    if (r?.checkInTime) (r.isWfh ? board.wfh : board.inOffice).push(p);
    else if (v.leave?.half === "none") board.onLeave.push(p);
    else if (v.kind !== "working") board.off.push({ ...p, note: v.holidayName ?? "Weekly off" });
    else if (v.wfh) board.wfh.push({ ...p, note: "WFH approved, not checked in yet" });
    else if (v.leave) board.onLeave.push(p);
    else board.notIn.push(p);
  }
  return board;
}

// ── Feed ─────────────────────────────────────────────────────────────────

export type FeedItem = FeedEvent & { wished: boolean; self: boolean };

export async function feed(viewerId: string): Promise<{ today: FeedItem[]; upcoming: FeedEvent[]; announcements: { id: string; title: string; content: string; createdAt: Date; by: string }[]; wishesForMe: { from: string; message: string; type: string }[] }> {
  const today = istDay();
  const members = await listMembers();
  const ids = members.map((m) => m.id);
  const [profiles, sent, ann, mine] = await Promise.all([
    ids.length ? db.select({ userId: userProfiles.userId, dob: userProfiles.dateOfBirth, doj: userProfiles.dateOfJoining }).from(userProfiles).where(inArray(userProfiles.userId, ids)) : Promise.resolve([]),
    db.select({ to: wishes.toUserId, type: wishes.eventType, date: wishes.eventDate }).from(wishes).where(and(eq(wishes.fromUserId, viewerId), gte(wishes.eventDate, addDays(today, -7)))),
    db.select().from(announcements).orderBy(desc(announcements.createdAt)).limit(5),
    db.select({ from: wishes.fromUserId, message: wishes.message, type: wishes.eventType }).from(wishes).where(and(eq(wishes.toUserId, viewerId), gte(wishes.eventDate, addDays(today, -7)))).orderBy(desc(wishes.createdAt)).limit(20),
  ]);
  const names = new Map(members.map((m) => [m.id, m.name]));
  const people = profiles.map((p) => ({ userId: p.userId, name: names.get(p.userId) ?? "", dateOfBirth: p.dob, dateOfJoining: p.doj }));
  const done = new Set(sent.map((s) => `${s.to}|${s.type}|${s.date}`));
  const authors = await peopleByIds([...ann.map((a) => a.createdBy), ...mine.map((w) => w.from)]);
  return {
    today: todaysEvents(people, today).map((e) => ({ ...e, wished: done.has(`${e.userId}|${e.type}|${e.date}`), self: e.userId === viewerId })),
    upcoming: upcomingEvents(people, today),
    announcements: ann.map((a) => ({ id: a.id, title: a.title, content: a.content, createdAt: a.createdAt, by: authors.get(a.createdBy)?.name ?? "HR" })),
    wishesForMe: mine.map((w) => ({ from: authors.get(w.from)?.name ?? "A colleague", message: w.message, type: w.type })),
  };
}

/** Sends a wish for one of today's events: once per person per event (the unique index keeps it so). */
export async function sendWish(from: { id: string; name: string }, input: { toUserId: string; type: FeedType; date: string; message: string }): Promise<void> {
  if (!isUuid(input.toUserId) || input.toUserId === from.id) throw new AttError("Choose who to wish.");
  const message = cleanWish(input.message);
  if (!message) throw new AttError("Write a message (2 to 300 characters).");
  const people = await db.select({ userId: userProfiles.userId, dob: userProfiles.dateOfBirth, doj: userProfiles.dateOfJoining }).from(userProfiles).where(eq(userProfiles.userId, input.toUserId));
  const names = await peopleByIds([input.toUserId]);
  const events = todaysEvents(
    people.map((p) => ({ userId: p.userId, name: names.get(p.userId)?.name ?? "", dateOfBirth: p.dob, dateOfJoining: p.doj })),
    istDay(),
  );
  const ev = events.find((e) => e.type === input.type && e.date === input.date);
  if (!ev) throw new AttError("That occasion is not today any more.");
  const done = await db.insert(wishes).values({ fromUserId: from.id, toUserId: input.toUserId, eventType: ev.type, eventDate: ev.date, message }).onConflictDoNothing().returning({ id: wishes.id });
  if (!done.length) throw new AttError("You have already sent your wishes.");
  const what = ev.type === "birthday" ? "birthday" : ev.type === "anniversary" ? "work anniversary" : "welcome";
  await notify([{ userId: input.toUserId, title: `${from.name} sent you ${ev.type === "joiner" ? "a welcome" : `${what} wishes`}`, body: message, link: "/attendance", key: `wish:${done[0].id}` }]);
}
