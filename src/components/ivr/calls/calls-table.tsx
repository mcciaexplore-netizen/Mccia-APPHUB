"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { cx as clsx } from "@/lib/ivr/cx";
import { CallButton } from "@/components/ivr/call-button";
import { RecordingPlayer } from "@/components/ivr/recording-player";
import { Badge, CallStatusPill, Empty } from "@/components/ivr/ui";

export type CallRowDTO = {
  id: string;
  leadId: string | null;
  /** The viewer may open this member's panel (an admin, or the member's owner). */
  canOpen: boolean;
  when: string;
  name: string;
  phone: string;
  direction: "inbound" | "outbound";
  status: string;
  outcome: string | null;
  duration: string;
  hasRecording: boolean;
  category: string | null;
  remark: string | null;
  missed: boolean;
  resolved: boolean;
  tries: number;
  lastTry: string | null;
  closed: boolean;
};

/** Calls the viewer handled. Pressing a row opens the same member panel as the call queue, beside the list. */
export function CallsTable({ rows, selectedLeadId, emptyHint }: { rows: CallRowDTO[]; selectedLeadId?: string; emptyHint: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const compact = !!selectedLeadId;

  const open = (leadId: string) => {
    const next = new URLSearchParams(sp.toString());
    next.set("lead", leadId);
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  };

  if (!rows.length) return <Empty title="No calls here">{emptyHint}</Empty>;

  const showCallback = rows.some((r) => r.missed);
  return (
    <div className="overflow-x-auto">
      <table className={clsx("w-full border-collapse text-[13px]", compact ? "min-w-[460px]" : "min-w-[820px]")}>
        <thead>
          <tr>
            <th className="ivr-th">When</th>
            <th className="ivr-th">Member</th>
            <th className="ivr-th">Call</th>
            <th className="ivr-th">Duration</th>
            {!compact && <th className="ivr-th">Category</th>}
            {!compact && <th className="ivr-th">Recording</th>}
            {showCallback && <th className="ivr-th">Call back</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const clickable = r.canOpen && !!r.leadId;
            return (
              <tr
                key={r.id}
                onClick={clickable ? () => open(r.leadId!) : undefined}
                className={clsx("align-top", clickable && "cursor-pointer", r.leadId && r.leadId === selectedLeadId && "bg-[var(--ivr-tint-blue)]")}
              >
                <td className="ivr-td whitespace-nowrap">{r.when}</td>
                <td className="ivr-td">
                  {clickable ? (
                    <button
                      className="text-left font-semibold transition-colors hover:text-primary focus-visible:text-primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        open(r.leadId!);
                      }}
                    >
                      {r.name}
                    </button>
                  ) : (
                    <span className="font-semibold">{r.name}</span>
                  )}
                  <span className="block font-mono text-[12px] text-muted">{r.phone}</span>
                </td>
                <td className="ivr-td">
                  <span className="flex items-center gap-2">
                    {r.direction === "outbound" ? <ArrowUpRight className="h-4 w-4 text-primary" aria-label="Outbound" /> : <ArrowDownLeft className="h-4 w-4 text-primary" aria-label="Inbound" />}
                    {r.missed ? <Badge color="var(--ivr-missed)">missed</Badge> : <CallStatusPill status={r.status} />}
                  </span>
                  {r.outcome && r.outcome !== "Answered" && !r.missed && <span className="mt-0.5 block text-[12px] text-muted">{r.outcome}</span>}
                </td>
                <td className="ivr-td tabular-nums">{r.duration}</td>
                {!compact && (
                  <td className="ivr-td">
                    {r.category ?? "–"}
                    {r.remark && <span className="block text-[12px] text-muted">{r.remark}</span>}
                  </td>
                )}
                {!compact && (
                  <td className="ivr-td" onClick={(e) => e.stopPropagation()}>
                    {r.hasRecording ? <RecordingPlayer className="w-56" callId={r.id} duration={r.duration} /> : <span className="text-muted">–</span>}
                  </td>
                )}
                {showCallback && (
                  <td className="ivr-td">
                    {!r.missed ? null : r.resolved ? (
                      <Badge color="var(--ivr-done)">connected</Badge>
                    ) : (
                      <div className="grid gap-1">
                        {r.canOpen && r.leadId ? <CallButton leadId={r.leadId} callBack disabled={r.closed} /> : <span className="text-[12px] text-muted">Not your member</span>}
                        <span className="text-[11px] text-muted">
                          {r.tries ? `Tried ${r.tries}× · last ${r.lastTry}, not connected` : "Not called back yet"}
                        </span>
                      </div>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
