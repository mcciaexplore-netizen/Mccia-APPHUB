import "server-only";
import { formatIST } from "@/lib/format";
import { escapeHtml, sendMail } from "@/lib/mail";
import { notifyUsers } from "@/lib/notifications";
import { siteUrl } from "@/lib/site-url";
import { hubUserIdByEmail } from "./host-adapter";

/**
 * What the Cab Booking module tells people: a row in the hub's bell (notifyUsers) and an email (sendMail). Neither can fail the action
 * that caused it: both never throw, and the email is skipped when SMTP is not set up. A driver has no hub account of their own here: their
 * bell notice goes to the hub account with their email, if there is one, and the email is sent either way.
 */

export type RideFacts = { id: string; pickup: string; dropoff: string; scheduledFor: Date };
type Person = { userId: string | null; email: string };
type Notice = { to: Person; event: string; title: string; body: string; link: string };

const when = (r: RideFacts) => formatIST(r.scheduledFor);
const route = (r: RideFacts) => `${r.pickup} → ${r.dropoff}`;

async function send(ride: RideFacts, notices: Notice[]): Promise<void> {
  if (!notices.length) return;
  await notifyUsers(notices.filter((n): n is Notice & { to: { userId: string } } => !!n.to.userId).map((n) => ({ userId: n.to.userId, kind: `cabs.${n.event}`, title: n.title, body: n.body, link: n.link, dedupeKey: `cabs:${ride.id}:${n.event}:${n.to.userId}` })));
  let base = "";
  try { base = siteUrl(); } catch { /* no APP_BASE_URL: the email goes without a link */ }
  await Promise.all(notices.filter((n) => n.to.email).map((n) => sendMail(n.to.email, n.title,
    `<p>${escapeHtml(n.title)}</p><p>${escapeHtml(n.body)}</p>${base ? `<p><a href="${escapeHtml(base + n.link)}">Open MCCIA Cabs</a></p>` : ""}`)));
}

export const rideReceived = (ride: RideFacts, requester: Person) => send(ride, [
  { to: requester, event: "created", title: "Your ride request has been received", body: `${route(ride)}, ${when(ride)}. You'll hear again once a driver and car are assigned.`, link: "/cabs/rides" },
]);

/** A driver, as cab_drivers knows them: their bell goes to the hub account with their email, if any. */
export const driverPerson = async (email: string): Promise<Person> => ({ userId: await hubUserIdByEmail(email), email });

export const rideAssigned = (ride: RideFacts, requester: Person, driver: Person & { name: string }, vehicle: { plate: string; model: string }) => send(ride, [
  { to: requester, event: "assigned", title: "Your ride is confirmed", body: `Driver: ${driver.name}, Vehicle: ${vehicle.plate} (${vehicle.model}). ${route(ride)}, ${when(ride)}.`, link: "/cabs/rides" },
  { to: driver, event: "assigned-driver", title: "New ride assigned to you", body: `${route(ride)}, ${when(ride)}, in ${vehicle.plate}.`, link: "/cabs/driver" },
]);

export const rideCompleted = (ride: RideFacts, requester: Person) => send(ride, [
  { to: requester, event: "completed", title: "Your ride is complete", body: `${route(ride)}.`, link: "/cabs/rides" },
]);

/** Cancelled by an admin: the person who booked it is told why, and the driver too when one had been assigned. */
export const rideCancelledByAdmin = (ride: RideFacts, requester: Person, reason: string, driver: Person | null) => send(ride, [
  { to: requester, event: "cancelled", title: `Your ride was cancelled: ${reason}`, body: `${route(ride)}, ${when(ride)}.`, link: "/cabs/rides" },
  ...(driver ? [{ to: driver, event: "cancelled-driver", title: "A ride assigned to you was cancelled", body: `${route(ride)}, ${when(ride)}. Reason: ${reason}`, link: "/cabs/driver" }] : []),
]);
