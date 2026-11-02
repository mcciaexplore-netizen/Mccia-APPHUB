import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "./db";
import { profiles, type Ticket } from "@/db/design-schema";
import { getSettings } from "./config";
import { listLeads, notify, peopleByIds, sendMail, siteUrl, type Person } from "./host-adapter";
import { isSlackWebhook } from "./rules";
import { trackingToken } from "./tokens";

/**
 * Who hears about what, by hub bell and by email:
 *   new request          → every design lead
 *   ticket assigned      → the designer
 *   proof sent           → the requester (with the review link)
 *   requester approved   → the designer and the leads
 *   changes requested    → the designer (the new version is theirs)
 *   due within 6 hours   → the leads (and the designer)
 *   overdue              → the leads
 * A team member can turn their emails off (My Dashboard); the bell always gets the notice. Slack, if a webhook is set, gets the team-wide
 * events that are switched on. Nothing here throws: a notice that cannot be sent must not undo the change behind it.
 */

export const SLACK_EVENTS = { new: "New requests", breach: "Deadlines missed", escalate: "Last-minute changes and change requests", approved: "Designs approved" } as const;
export type SlackEvent = keyof typeof SLACK_EVENTS;

type T = Pick<Ticket, "id" | "number" | "title">;
const ref = (t: T) => `${t.number} — ${t.title}`;
const teamLink = (t: T) => `/design/tickets/${t.id}`;
export const trackingUrl = (number: string) => `${siteUrl()}/track/${trackingToken(number)}`;
export const reviewUrl = (token: string) => `${siteUrl()}/review/${token}`;

async function emailsOff(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db.select({ userId: profiles.userId, on: profiles.emailEnabled }).from(profiles).where(inArray(profiles.userId, ids));
  return new Set(rows.filter((r) => !r.on).map((r) => r.userId));
}

/** Bell for everyone listed; email for the team members among them who have not turned it off. */
async function tellTeam(people: Person[], t: T, title: string, body: string, key: string, link = teamLink(t)) {
  try {
    const unique = [...new Map(people.map((p) => [p.id, p])).values()];
    await notify(unique.map((p) => ({ userId: p.id, title, body, link, key: `${key}:${p.id}` })));
    const off = await emailsOff(unique.map((p) => p.id));
    await Promise.all(
      unique.filter((p) => !off.has(p.id)).map((p) => sendMail(p.email, `DesignDesk: ${title}`.slice(0, 150), `Hi ${p.name.split(" ")[0]},\n\n${title}\n\n${body}\n\nOpen it: ${siteUrl()}${link}\n\nYou get these emails because you are on the design team. Turn them off on your My Dashboard page.`)),
    );
  } catch {
    // see the header
  }
}

/** Bell and email to the person who asked for the design. */
async function tellRequester(t: T & { requesterId: string }, title: string, body: string, key: string, link = "/design/my-requests"): Promise<string | null> {
  try {
    const p = (await peopleByIds([t.requesterId])).get(t.requesterId);
    if (!p) return null;
    await notify([{ userId: p.id, title, body, link, key }]);
    const sent = await sendMail(p.email, title.slice(0, 150), `Hi ${p.name.split(" ")[0]},\n\n${body}\n\nMCCIA Design Team`);
    return sent === "sent" ? p.email : null;
  } catch {
    return null;
  }
}

export async function postSlack(kind: SlackEvent, text: string): Promise<void> {
  try {
    const s = await getSettings();
    if (!s.slackWebhook || !isSlackWebhook(s.slackWebhook) || !s.slackEvents?.[kind]) return;
    await fetch(s.slackWebhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(8000) });
  } catch {
    // see the header
  }
}
const slackSafe = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function newRequest(t: T & { requesterId: string; deliveryDate: string | null }, requesterName: string, summary: string) {
  await tellTeam(await listLeads(), t, `New design request ${t.number} from ${requesterName}`, `${t.title}\n\n${summary}`, `new:${t.id}`, "/design/admin/pending");
  await postSlack("new", `:inbox_tray: *New request* ${slackSafe(ref(t))} from ${slackSafe(requesterName)}`);
}

export async function requestReceived(t: T & { requesterId: string }) {
  await tellRequester(
    t,
    `Request received: ${t.number}`,
    `Your design request "${t.title}" (${t.number}) has been received. The design team will review it shortly.\n\nFollow its progress here:\n${trackingUrl(t.number)}`,
    `received:${t.id}`,
  );
}

export async function assigned(t: T & { assigneeId: string | null }, by: string | null) {
  if (!t.assigneeId) return;
  const p = (await peopleByIds([t.assigneeId])).get(t.assigneeId);
  if (!p) return;
  await tellTeam([p], t, by ? `${by} assigned you ${t.number}` : `${t.number} was assigned to you`, t.title, `assigned:${t.id}:${t.assigneeId}:${Date.now()}`);
}

export async function proofSent(t: T & { requesterId: string }, version: number, link: string): Promise<string | null> {
  const lead = version > 1 ? `The changes you asked for are done: version ${version} of "${t.title}" (${t.number}) is ready.` : `Your design "${t.title}" (${t.number}) is ready.`;
  return tellRequester(
    t,
    `Design ready for your approval: ${t.number}`,
    `${lead}\n\nOpen it, then approve it or tell us what to change (the link works for 2 days):\n${link}\n\nYou can also approve it from My Requests in the App Hub.`,
    `proof:${t.id}:${version}:${Date.now()}`,
    "/design/my-requests",
  );
}

export async function decided(t: T & { assigneeId: string | null }, approved: boolean, by: string, newTicket: T | null) {
  const designer = t.assigneeId ? [...(await peopleByIds([t.assigneeId])).values()] : [];
  if (approved) {
    await tellTeam([...designer, ...(await listLeads())], t, `${by} approved ${t.number}`, t.title, `approved:${t.id}`);
    await postSlack("approved", `:white_check_mark: ${slackSafe(by)} approved ${slackSafe(ref(t))}`);
  } else {
    const target = newTicket ?? t;
    await tellTeam(designer, target, `${by} asked for changes on ${t.number}`, newTicket ? `The changes are on the new version ${newTicket.number}.` : t.title, `changes:${t.id}`);
    await postSlack("escalate", `:pencil2: ${slackSafe(by)} asked for changes on ${slackSafe(ref(t))}`);
  }
}

export async function declined(t: T & { requesterId: string }, reason: string | null) {
  await tellRequester(t, `Request declined: ${t.number}`, `Your design request "${t.title}" (${t.number}) was declined.${reason ? `\n\nReason: ${reason}` : ""}`, `declined:${t.id}`);
}

export async function question(t: T & { requesterId: string }, text: string, by: string) {
  await tellRequester(
    t,
    `A question about your design request ${t.number}`,
    `${by} from the design team has a question about "${t.title}" (${t.number}):\n\n${text}\n\nPlease reply to this email or contact the design team.`,
    `question:${t.id}:${Date.now()}`,
  );
}

export async function dueSoon(t: T & { assigneeId: string | null }) {
  const designer = t.assigneeId ? [...(await peopleByIds([t.assigneeId])).values()] : [];
  await tellTeam([...designer, ...(await listLeads())], t, `${t.number} is due within 6 hours`, t.title, `due6:${t.id}`);
}

export async function overdue(t: T) {
  await tellTeam(await listLeads(), t, `Overdue: ${t.number}`, `${t.title} has missed its deadline.`, `overdue:${t.id}`);
  await postSlack("breach", `:warning: *Deadline missed* ${slackSafe(ref(t))}`);
}

export async function lastMinute(t: T) {
  await postSlack("escalate", `:rotating_light: *Last-minute change* on ${slackSafe(ref(t))}`);
}

export async function reviewReminder(t: T & { requesterId: string }, link: string, closes: string) {
  await tellRequester(t, `Your review is needed: ${t.number}`, `"${t.title}" (${t.number}) is still waiting for your review. Please approve it or tell us what to change before ${closes} IST, when it closes.\n\n${link}`, `remind:${t.id}`);
}

export async function autoClosed(t: T & { assigneeId: string | null }, why: string) {
  const designer = t.assigneeId ? [...(await peopleByIds([t.assigneeId])).values()] : [];
  await tellTeam(designer, t, `${t.number} closed`, why, `closed:${t.id}`);
}

export async function cdrUpdate(t: T & { requesterId: string }, text: string, key: string) {
  await tellRequester(t, `Source files: ${t.number}`, text, `cdr:${t.id}:${key}`);
}

export async function cdrRequested(t: T & { assigneeId: string | null }, by: string) {
  const designer = t.assigneeId ? [...(await peopleByIds([t.assigneeId])).values()] : [];
  await tellTeam([...designer, ...(await listLeads())], t, `${by} asked for the source files of ${t.number}`, t.title, `cdrreq:${t.id}:${Date.now()}`);
}
