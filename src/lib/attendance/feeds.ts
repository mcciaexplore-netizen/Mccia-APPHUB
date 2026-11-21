/**
 * The Home feed: today's birthdays, work anniversaries and new joiners, and the next 30 days of them. Worked out from att_user_profiles
 * (date of birth, date of joining), never stored. Pure.
 *
 * A 29 February birthday or joining date falls on 28 February in other years. An anniversary is a joining date at least one whole year
 * ago; a joiner is someone whose joining date is today (shown "today") or in the last 7 days.
 */

import { addDays, daysBetween } from "./time";

export type FeedType = "birthday" | "anniversary" | "joiner";
export type FeedPerson = { userId: string; name: string; dateOfBirth: string | null; dateOfJoining: string | null };
export type FeedEvent = { type: FeedType; userId: string; name: string; date: string; years?: number };

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** The date `md` (MM-DD) falls on in `year`. */
export function onYear(md: string, year: number): string {
  if (md === "02-29" && !isLeap(year)) return `${year}-02-28`;
  return `${year}-${md}`;
}

/** Every event from `from` to `from + days − 1`, by date then name. */
export function eventsBetween(people: readonly FeedPerson[], from: string, days: number): FeedEvent[] {
  const to = addDays(from, days - 1);
  const years = [...new Set([Number(from.slice(0, 4)), Number(to.slice(0, 4))])];
  const out: FeedEvent[] = [];
  for (const p of people) {
    for (const y of years) {
      if (p.dateOfBirth) {
        const d = onYear(p.dateOfBirth.slice(5), y);
        if (d >= from && d <= to) out.push({ type: "birthday", userId: p.userId, name: p.name, date: d });
      }
      if (p.dateOfJoining) {
        const d = onYear(p.dateOfJoining.slice(5), y);
        const n = y - Number(p.dateOfJoining.slice(0, 4));
        if (n >= 1 && d >= from && d <= to) out.push({ type: "anniversary", userId: p.userId, name: p.name, date: d, years: n });
      }
    }
    if (p.dateOfJoining && p.dateOfJoining >= from && p.dateOfJoining <= to) out.push({ type: "joiner", userId: p.userId, name: p.name, date: p.dateOfJoining });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

/** Today's events: birthdays and anniversaries today, and joiners from the last 7 days. */
export function todaysEvents(people: readonly FeedPerson[], today: string): FeedEvent[] {
  const now = eventsBetween(people, today, 1).filter((e) => e.type !== "joiner");
  const joiners = people
    .filter((p) => p.dateOfJoining && p.dateOfJoining <= today && daysBetween(p.dateOfJoining, today) <= 7)
    .map((p) => ({ type: "joiner" as const, userId: p.userId, name: p.name, date: p.dateOfJoining! }));
  return [...now, ...joiners];
}

/** Events in the 30 days after today. */
export const upcomingEvents = (people: readonly FeedPerson[], today: string) => eventsBetween(people, addDays(today, 1), 30).filter((e) => e.type !== "joiner");

export const FEED_EMOJI: Record<FeedType, string> = { birthday: "🎂", anniversary: "🎉", joiner: "👋" };

/** Ready-made wishes; {name} is the person's first name, {years} the anniversary. */
export const WISH_TEMPLATES: Record<FeedType, string[]> = {
  birthday: ["Happy birthday, {name}! Have a wonderful year ahead.", "Many happy returns of the day, {name}!", "Wishing you a great birthday, {name}. Enjoy your day!"],
  anniversary: ["Congratulations on {years} year(s) at MCCIA, {name}!", "Happy work anniversary, {name}! Thank you for all you do.", "Cheers to {years} year(s), {name}. Here's to many more!"],
  joiner: ["Welcome to MCCIA, {name}! Glad to have you with us.", "A warm welcome, {name}. Looking forward to working together!", "Welcome aboard, {name}!"],
};

export function fillTemplate(t: string, e: { name: string; years?: number }): string {
  return t.replace(/\{name\}/g, e.name.split(/\s+/)[0] || e.name).replace(/\{years\}/g, String(e.years ?? ""));
}

export function cleanWish(s: unknown): string | null {
  const m = String(s ?? "").replace(/\s+/g, " ").trim();
  return m.length >= 2 && m.length <= 300 ? m : null;
}
