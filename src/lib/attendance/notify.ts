import "server-only";
import { getSettings } from "./config";
import { email, hrIds, peopleByIds } from "./host-adapter";
import { notify } from "./notice";
import { NO_MANAGER_NOTE, REQUEST_KIND_LABEL, type RequestKind } from "./att.manifest";

/**
 * Who hears about a request:
 *   new request  the reporting manager ("New leave request from Asha"), or every HR admin when there is no manager (with the note that it
 *                was sent to HR for approval); anyone CC'd on leave
 *   decision     the requester ("Manju approved your leave request"), and HR ("Asha's leave was approved by Manju"; never the HR admin who
 *                decided it themself)
 * Always the bell (and the phone, where notifications are on); email too while Settings → email is on (the default). Never throws.
 */

const MANAGER_INBOX = "/attendance/more/approvals";
const HR_INBOX = "/attendance/admin/approvals";

export async function notifyNewRequest(i: { kind: RequestKind; id: string; requester: { id: string; name: string }; approverId: string | null; summary: string; cc?: string[] }): Promise<void> {
  try {
    const label = REQUEST_KIND_LABEL[i.kind];
    const to = i.approverId ? [i.approverId] : await hrIds();
    const link = i.approverId ? MANAGER_INBOX : HR_INBOX;
    const title = `New ${label.toLowerCase()} request from ${i.requester.name}`;
    const body = i.approverId ? i.summary : `${i.summary} · ${NO_MANAGER_NOTE}.`;
    await notify(to.filter((id) => id !== i.requester.id).map((userId) => ({ userId, title, body, link, key: `new:${i.kind}:${i.id}:${userId}` })));
    if (i.cc?.length) await notify(i.cc.map((userId) => ({ userId, title: `${i.requester.name} applied for leave (you are CC'd)`, body: i.summary, link: "/attendance/leave", key: `cc:${i.id}:${userId}` })));
    if ((await getSettings()).emailEnabled) {
      const people = await peopleByIds(to);
      await email([...people.values()].map((p) => p.email), title, [title, body], link);
    }
  } catch {
    // a notice must never undo the request
  }
}

export async function notifyDecision(i: {
  kind: RequestKind;
  id: string;
  requesterId: string;
  approved: boolean;
  by: string;
  deciderId: string;
  summary: string;
  remark?: string | null;
  link: string;
}): Promise<void> {
  try {
    const word = i.approved ? "approved" : "rejected";
    const what = REQUEST_KIND_LABEL[i.kind].toLowerCase();
    const title = `${i.by} ${word} your ${what} request`;
    const body = `${i.summary}${i.remark ? ` · “${i.remark}”` : ""}`;
    await notify([{ userId: i.requesterId, title, body, link: i.link, key: `decided:${i.kind}:${i.id}` }]);
    // HR hear about every decision (they cannot change it), except the HR admin who made it.
    const [hr, people] = await Promise.all([hrIds(), peopleByIds([i.requesterId])]);
    const name = people.get(i.requesterId)?.name ?? "Someone";
    await notify(
      hr
        .filter((id) => id !== i.deciderId && id !== i.requesterId)
        .map((userId) => ({ userId, title: `${name}'s ${what} was ${word} by ${i.by}`, body, link: "/attendance/admin/approvals?tab=history", key: `decided-hr:${i.kind}:${i.id}:${userId}` })),
    );
    if ((await getSettings()).emailEnabled) {
      const p = people.get(i.requesterId);
      if (p) await email([p.email], title, [title, body], i.link);
    }
  } catch {
    // as above
  }
}
