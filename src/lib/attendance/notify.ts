import "server-only";
import { getSettings } from "./config";
import { email, hrIds, notify, peopleByIds } from "./host-adapter";
import { REQUEST_KIND_LABEL, type RequestKind } from "./att.manifest";

/**
 * Who hears about a request: the approver (the manager, or every HR admin when it went to HR) on a new request, the requester on the
 * decision, and anyone CC'd on leave. Always the bell; email too only when Settings → email is on. Never throws.
 */

const MANAGER_INBOX = "/attendance/more/approvals";
const HR_INBOX = "/attendance/admin/approvals";

export async function notifyNewRequest(i: { kind: RequestKind; id: string; requester: { id: string; name: string }; approverId: string | null; summary: string; cc?: string[] }): Promise<void> {
  try {
    const label = REQUEST_KIND_LABEL[i.kind];
    const to = i.approverId ? [i.approverId] : await hrIds();
    const link = i.approverId ? MANAGER_INBOX : HR_INBOX;
    const title = `${label} request from ${i.requester.name}`;
    await notify(to.filter((id) => id !== i.requester.id).map((userId) => ({ userId, title, body: i.summary, link, key: `new:${i.kind}:${i.id}:${userId}` })));
    if (i.cc?.length) await notify(i.cc.map((userId) => ({ userId, title: `${i.requester.name} applied for leave (you are CC'd)`, body: i.summary, link: "/attendance/leave", key: `cc:${i.id}:${userId}` })));
    if ((await getSettings()).emailEnabled) {
      const people = await peopleByIds(to);
      await email([...people.values()].map((p) => p.email), title, [title, i.summary], link);
    }
  } catch {
    // a notice must never undo the request
  }
}

export async function notifyDecision(i: { kind: RequestKind; id: string; requesterId: string; approved: boolean; by: string; summary: string; remark?: string | null; link: string }): Promise<void> {
  try {
    const word = i.approved ? "approved" : "rejected";
    const title = `Your ${REQUEST_KIND_LABEL[i.kind].toLowerCase()} request was ${word}`;
    const body = `${i.summary} · by ${i.by}${i.remark ? ` · “${i.remark}”` : ""}`;
    await notify([{ userId: i.requesterId, title, body, link: i.link, key: `decided:${i.kind}:${i.id}` }]);
    if ((await getSettings()).emailEnabled) {
      const p = (await peopleByIds([i.requesterId])).get(i.requesterId);
      if (p) await email([p.email], title, [title, body], i.link);
    }
  } catch {
    // as above
  }
}
