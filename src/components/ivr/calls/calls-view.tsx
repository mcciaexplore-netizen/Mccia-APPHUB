import Link from "next/link";
import { cx as clsx } from "@/lib/ivr/cx";
import { CallsTable, type CallRowDTO } from "@/components/ivr/calls/calls-table";
import { LeadPanel } from "@/components/ivr/leads/lead-panel";
import { PageHeader } from "@/components/ivr/ui";
import type { SessionUser } from "@/lib/ivr/dal";
import { qs } from "@/lib/ivr/lead-params";
import { listCalls, missedCounts, MISSED_DAYS, type CallsTab, type MissedSub } from "@/lib/ivr/missed";
import { OUTCOMES } from "@/lib/ivr/outcome";
import { formatPhone } from "@/lib/ivr/phone";
import { formatDuration, formatIst } from "@/lib/ivr/time";

type Sp = Record<string, string | string[] | undefined>;

const TABS: { key: CallsTab; label: string; hint: string }[] = [
  { key: "all", label: "All calls", hint: "The latest 50 calls, any direction." },
  { key: "outbound", label: "Outbound", hint: "Calls placed to members." },
  { key: "answered", label: "Inbound answered", hint: "Members who called and were picked up." },
  { key: "missed", label: "Inbound missed", hint: `Members who called and were not picked up, last ${MISSED_DAYS} days.` },
];

/**
 * A list of calls with a member panel beside it. `team`: every call (IVR-CRM Admin → Team calls); otherwise only the calls the person
 * handled themselves (IVR-CRM → My calls), and a member opens only when it is theirs. `base` is the page's own address.
 */
export async function CallsView({ user, sp, base, team }: { user: SessionUser; sp: Sp; base: string; team: boolean }) {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const tab: CallsTab = TABS.find((t) => t.key === one(sp.tab))?.key ?? "all";
  const sub: MissedSub = one(sp.sub) === "done" ? "done" : "open";
  const leadId = one(sp.lead);
  const scopeUser = team ? undefined : user.id;

  const [list, counts] = await Promise.all([listCalls({ userId: scopeUser, tab, sub }), missedCounts(scopeUser)]);

  const rows: CallRowDTO[] = list.map((r) => ({
    id: r.id,
    leadId: r.leadId,
    canOpen: !!r.leadId && (team || r.leadOwnerId === user.id),
    when: formatIst(r.at, { year: "numeric" }),
    name: r.name ?? "Unknown",
    phone: formatPhone(r.phone),
    direction: r.direction,
    status: r.status,
    outcome: r.outcome ? OUTCOMES[r.outcome].label : r.status === "ongoing" ? "In progress" : null,
    duration: formatDuration(r.status === "answered" ? r.answeredSec : r.durationSec),
    hasRecording: r.hasRecording,
    category: r.category,
    remark: r.remark,
    missed: r.missed,
    resolved: r.resolved,
    tries: r.tries,
    lastTry: r.lastTry ? formatIst(r.lastTry) : null,
    closed: r.leadStage === "closed",
  }));

  const active = TABS.find((t) => t.key === tab)!;
  const closeHref = `${base}${qs(sp, { lead: null })}`;
  const pill = (on: boolean) => clsx("btn btn-sm", on ? "btn-primary" : "btn-ghost");
  const emptyHint =
    tab === "missed"
      ? sub === "done"
        ? "No missed call has been reached yet. When a call back is answered, the missed call moves here."
        : "No missed calls are waiting for a call back."
      : team
        ? "Calls show here after Smartflo reports them. The Support Admin can pull them in with Sync on Integrations."
        : "Calls you handle show here after Smartflo reports them.";

  return (
    <div className="grid gap-5">
      <PageHeader title={team ? "Team calls" : "My calls"} subtitle={team ? `Every agent's calls. ${active.hint}` : `Only calls you handled. ${active.hint}`} />

      <div className="grid gap-3">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Call type">
          {TABS.map((t) => (
            <Link
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              href={`${base}${qs(sp, { tab: t.key === "all" ? null : t.key, sub: null, lead: null })}`}
              className={pill(tab === t.key)}
            >
              {t.label}
              {t.key === "missed" && counts.open > 0 && (
                <span className="ml-1.5 rounded-full bg-brand-red px-1.5 py-0.5 text-[11px] leading-none font-bold text-white tabular-nums">{counts.open}</span>
              )}
            </Link>
          ))}
        </div>
        {tab === "missed" && (
          <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Missed calls">
            <Link role="tab" aria-selected={sub === "open"} href={`${base}${qs(sp, { sub: null, lead: null })}`} className={pill(sub === "open")}>
              Not connected ({counts.open})
            </Link>
            <Link role="tab" aria-selected={sub === "done"} href={`${base}${qs(sp, { sub: "done", lead: null })}`} className={pill(sub === "done")}>
              Connected ({counts.done})
            </Link>
            <span className="text-[12px] text-muted">
              {sub === "open"
                ? "Nobody has reached these members yet. A call back that rings but is not picked up keeps the call here."
                : "A later call to these members was answered."}
            </span>
          </div>
        )}
      </div>

      <div className={clsx("grid items-start gap-5", leadId && "lg:grid-cols-2")}>
        <section className="ivr-card min-w-0 overflow-hidden">
          <CallsTable rows={rows} selectedLeadId={leadId} emptyHint={emptyHint} />
        </section>
        {leadId && <LeadPanel leadId={leadId} viewer={user} closeHref={closeHref} />}
      </div>
    </div>
  );
}
