import { namesOf } from "@/lib/ivr/host-adapter";
import type { SessionUser } from "@/lib/ivr/dal";
import { listCategories } from "@/lib/ivr/categories";
import { getLeadDetail } from "@/lib/ivr/leads";
import { hasOpenMissed } from "@/lib/ivr/missed";
import { OUTCOMES } from "@/lib/ivr/outcome";
import { formatPhone } from "@/lib/ivr/phone";
import { formatDuration, formatIst } from "@/lib/ivr/time";
import { getZohoConnection } from "@/lib/ivr/zoho";
import { LeadPanelClient, type PanelData } from "./lead-panel-client";

/** Server half of the 50% side panel: loads one member the viewer is allowed to see. */
export async function LeadPanel({ leadId, viewer, closeHref }: { leadId: string; viewer: SessionUser; closeHref: string }) {
  const detail = await getLeadDetail(leadId, viewer);
  if (!detail) {
    return (
      <div className="ivr-card grid place-items-center p-10 text-center">
        <p className="font-heading text-lg font-semibold">Member not found</p>
        <p className="mt-1 text-[13px] text-muted">It may have been reassigned or removed.</p>
        <a className="btn btn-ghost btn-sm mt-4" href={closeHref}>
          Close
        </a>
      </div>
    );
  }
  const { lead } = detail;

  const [zoho, categories, openMissed] = await Promise.all([
    getZohoConnection(viewer.id),
    listCategories({ activeOnly: true }),
    hasOpenMissed(lead.phone),
  ]);

  const userIds = [...new Set(detail.assignments.flatMap((a) => [a.toUserId, a.fromUserId]).filter(Boolean) as string[])];
  const names = await namesOf(userIds);

  const data: PanelData = {
    lead: {
      id: lead.id,
      name: lead.name,
      phone: formatPhone(lead.phone),
      email: lead.email,
      company: lead.company,
      memberCode: lead.memberCode,
      categoryId: lead.categoryId,
      source: lead.source,
      stage: lead.stage,
      attempts: lead.attempts,
      lastOutcome: lead.lastOutcome ? OUTCOMES[lead.lastOutcome].label : null,
      ownerName: lead.ownerName,
      createdAt: formatIst(lead.createdAt, { year: "numeric" }),
      extra: lead.extra,
    },
    categories: categories.map((c) => ({ id: c.id, label: c.label })),
    calls: detail.calls.map((c) => ({
      id: c.id,
      direction: c.direction,
      status: c.status,
      outcome: c.outcome ? OUTCOMES[c.outcome].label : null,
      when: formatIst(c.startedAt, { year: "numeric" }),
      duration: formatDuration(c.status === "answered" ? c.answeredSec : c.durationSec),
      hasRecording: !!c.hasRecording,
      dtmf: c.dtmf,
      categoryId: c.categoryId,
      categorySource: c.categorySource,
      remark: c.remark,
      agentName: c.agentName,
      disposition: c.disposition,
    })),
    notes: detail.notes.map((n) => ({ id: n.id, body: n.body, when: formatIst(n.createdAt, { year: "numeric" }), by: n.userName })),
    emails: detail.emails.map((e) => ({
      id: e.id,
      subject: e.subject,
      body: e.body,
      toAddress: e.toAddress,
      status: e.status,
      error: e.error,
      sentAt: e.sentAt,
      userName: e.userName,
    })),
    history: [
      ...detail.assignments.map((a) => ({
        at: a.createdAt,
        text: `${a.fromUserId ? `Moved from ${names.get(a.fromUserId) ?? "an agent"} to` : "Assigned to"} ${
          a.toUserId ? (names.get(a.toUserId) ?? "an agent") : "the unassigned pool"
        }${a.reason ? `. ${a.reason}` : ""}`,
      })),
      ...detail.stageEvents.map((s) => ({ at: s.createdAt, text: `Stage: ${s.fromStage ?? "new"} → ${s.toStage}` })),
    ]
      .sort((x, y) => y.at.getTime() - x.at.getTime())
      .slice(0, 12)
      .map((h) => ({ when: formatIst(h.at, { year: "numeric" }), text: h.text })),
    zohoConnected: zoho.connected,
    openMissed,
  };

  return <LeadPanelClient data={data} closeHref={closeHref} />;
}
