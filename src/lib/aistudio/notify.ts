import "server-only";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { settings, type Request } from "@/db/aistudio-schema";
import { TYPE_LABEL } from "./aistudio.manifest";
import { listLeads, notify, peopleByIds, sendMail, siteUrl, type Person } from "./host-adapter";

/**
 * Who hears about what, on the hub bell and by email:
 *   new request                    → every lead (the Support Admins while there are none), and Slack if a webhook is set
 *   accepted                       → the requester (and the person it is assigned to)
 *   assigned to someone            → that person
 *   moved to In progress           → the requester
 *   a note shared with them        → the requester
 *   delivered                      → the requester
 *   declined (with the reason)     → the requester
 * Requesters are never told who works on their request. Nothing here throws: a notice that cannot be sent must not undo the change.
 */

type R = Pick<Request, "id" | "number" | "title" | "requesterId">;
const adminLink = (r: R) => `/aistudio/admin/requests/${r.id}`;
const myLink = (r: R) => `/aistudio/requests/${r.id}`;

async function tell(people: Person[], r: R, title: string, body: string, key: string, link: string, footer: string) {
  try {
    const unique = [...new Map(people.map((p) => [p.id, p])).values()];
    await notify(unique.map((p) => ({ userId: p.id, title, body, link, key: `${key}:${p.id}` })));
    await Promise.all(unique.map((p) => sendMail(p.email, `AI Studio: ${title}`.slice(0, 150), `Hi ${p.name.split(" ")[0]},\n\n${body}\n\nOpen it: ${siteUrl()}${link}\n\n${footer}`)));
  } catch {
    // see the header
  }
}

async function tellRequester(r: R, title: string, body: string, key: string) {
  const p = (await peopleByIds([r.requesterId])).get(r.requesterId);
  if (p) await tell([p], r, title, body, key, myLink(r), "MCCIA AI Studio");
}

async function tellTeam(people: Person[], r: R, title: string, body: string, key: string) {
  await tell(people, r, title, body, key, adminLink(r), "You get these because you are on the AI Studio team.");
}

/** Slack, when a webhook is set in Settings. Never throws. */
async function postSlack(text: string): Promise<void> {
  try {
    const [s] = await db.select({ hook: settings.slackWebhook }).from(settings).where(eq(settings.id, 1)).limit(1);
    if (!s?.hook || !/^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/.test(s.hook)) return;
    await fetch(s.hook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(8000) });
  } catch {
    // see the header
  }
}

const slackSafe = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function newRequest(r: R & Pick<Request, "requestType" | "department">, requesterName: string) {
  await tellTeam(await listLeads(), r, `New request ${r.number} from ${requesterName}`, `${r.title}\n${TYPE_LABEL[r.requestType]}${r.department ? ` · ${r.department}` : ""}`, `new:${r.id}`);
  await postSlack(`:inbox_tray: *New AI Studio request* ${slackSafe(r.number)} — ${slackSafe(r.title)} from ${slackSafe(requesterName)}`);
}

export async function accepted(r: R & Pick<Request, "deadline">) {
  await tellRequester(r, `Request accepted: ${r.number}`, `AI Studio has accepted your request "${r.title}" (${r.number}).${r.deadline ? ` The target date is ${r.deadline}.` : ""}`, `accepted:${r.id}`);
}

export async function assigned(r: R, assigneeId: string | null, by: string) {
  if (!assigneeId) return;
  const p = (await peopleByIds([assigneeId])).get(assigneeId);
  if (p) await tellTeam([p], r, `${by} assigned you ${r.number}`, r.title, `assigned:${r.id}:${assigneeId}:${Date.now()}`);
}

export async function inProgress(r: R) {
  await tellRequester(r, `Work has started: ${r.number}`, `AI Studio has started work on "${r.title}" (${r.number}).`, `progress:${r.id}`);
}

export async function noteShared(r: R, body: string) {
  await tellRequester(r, `An update on ${r.number}`, `AI Studio has an update on "${r.title}" (${r.number}):\n\n${body.slice(0, 1500)}`, `note:${r.id}:${Date.now()}`);
}

export async function delivered(r: R) {
  await tellRequester(r, `Delivered: ${r.number}`, `"${r.title}" (${r.number}) has been delivered. Download what AI Studio made for you from the request's page.`, `delivered:${r.id}:${Date.now()}`);
}

export async function declined(r: R, reason: string) {
  await tellRequester(r, `Request declined: ${r.number}`, `Your request "${r.title}" (${r.number}) was declined.\n\nReason: ${reason}`, `declined:${r.id}`);
}

/** Settings → "Send a test email" (to the person asking). */
export async function testEmail(to: Person): Promise<string> {
  const res = await sendMail(to.email, "AI Studio: test email", `Hi ${to.name.split(" ")[0]},\n\nThis is a test from AI Studio in the MCCIA App Hub. Email is working.`);
  return res === "sent" ? `Sent to ${to.email}.` : res === "not_configured" ? "Email is not set up on this hub (SMTP)." : "The email could not be sent. Check the hub's SMTP settings.";
}
