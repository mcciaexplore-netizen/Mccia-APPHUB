"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Play } from "lucide-react";
import { cx as clsx } from "@/lib/ivr/cx";
import { BulkAssignDialog } from "@/components/ivr/assign/bulk-assign-dialog";
import { CallButton } from "@/components/ivr/call-button";
import { CallStatusPill, Empty, StagePill } from "@/components/ivr/ui";
import type { AgentOption, LeadRowDTO } from "./types";

export function LeadsTable({
  rows,
  selectedId,
  selectable,
  showOwner,
  agents,
  emptyHint,
}: {
  rows: LeadRowDTO[];
  selectedId?: string;
  selectable?: boolean;
  showOwner?: boolean;
  agents?: AgentOption[];
  emptyHint?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState(false);
  // With the 50% member panel open the table only has half the width, so drop the least useful columns.
  const compact = !!selectedId;

  const open = (id: string) => {
    const next = new URLSearchParams(sp.toString());
    next.set("lead", id);
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const allPicked = rows.length > 0 && rows.every((r) => picked.has(r.id));
  const toggleAll = () => setPicked(allPicked ? new Set() : new Set(rows.map((r) => r.id)));
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const ids = useMemo(() => [...picked], [picked]);

  if (!rows.length) {
    return (
      <Empty title="No members here">
        {emptyHint ?? "Nothing matches the current filters. Try another section or clear the search."}
      </Empty>
    );
  }

  return (
    <div>
      {selectable && picked.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-alt px-5 py-2.5">
          <span className="text-[13px] font-semibold">{picked.size} selected</span>
          <button className="btn btn-primary btn-sm" onClick={() => setDialog(true)}>
            Assign or reassign
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setPicked(new Set())}>
            Clear
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className={clsx("w-full border-collapse text-[13px]", compact ? "min-w-[460px]" : "min-w-[760px]")}>
          <thead>
            <tr>
              {selectable && (
                <th className="ivr-th w-8">
                  <input type="checkbox" checked={allPicked} onChange={toggleAll} aria-label="Select all on this page" />
                </th>
              )}
              <th className="ivr-th">Member</th>
              <th className="ivr-th">Phone</th>
              {!compact && <th className="ivr-th">Category</th>}
              <th className="ivr-th">Stage</th>
              <th className="ivr-th text-right">Tries</th>
              <th className="ivr-th">Last call</th>
              {showOwner && <th className="ivr-th">Owner</th>}
              {!compact && <th className="ivr-th w-10">Rec.</th>}
              <th className="ivr-th w-24">Call</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                onClick={() => open(r.id)}
                className={clsx("cursor-pointer", r.id === selectedId && "bg-[var(--ivr-tint-blue)]")}
              >
                {selectable && (
                  <td className="ivr-td" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={picked.has(r.id)}
                      onChange={() => toggle(r.id)}
                      aria-label={`Select ${r.name}`}
                    />
                  </td>
                )}
                <td className="ivr-td">
                  <button
                    className="text-left font-semibold transition-colors hover:text-primary focus-visible:text-primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      open(r.id);
                    }}
                  >
                    {r.name}
                  </button>
                  {r.company && <div className="text-[12px] text-muted">{r.company}</div>}
                </td>
                <td className="ivr-td font-mono text-[12px] whitespace-nowrap">{r.phone}</td>
                {!compact && <td className="ivr-td max-w-[200px] truncate">{r.category ?? <span className="text-muted">–</span>}</td>}
                <td className="ivr-td">
                  <StagePill stage={r.stage} />
                </td>
                <td className="ivr-td tabular-nums text-right">{r.attempts}</td>
                <td className="ivr-td whitespace-nowrap">
                  {r.lastCall ? (
                    <span className="flex items-center gap-2">
                      <CallStatusPill status={r.lastCall.status} />
                      <span className="text-[12px] text-muted">
                        {r.lastCall.when}
                        {r.lastCall.status === "answered" && ` · ${r.lastCall.duration}`}
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted">No calls yet</span>
                  )}
                </td>
                {showOwner && <td className="ivr-td whitespace-nowrap">{r.ownerName ?? <span className="text-brand-purple">Unassigned</span>}</td>}
                {!compact && (
                  <td className="ivr-td">
                    {r.hasRecording ? (
                      <span className="grid h-6 w-6 place-items-center rounded-full text-white" style={{ background: "var(--ivr-grad-primary)" }} title="Has a recording">
                        <Play className="h-3 w-3" />
                      </span>
                    ) : (
                      <span className="text-muted">–</span>
                    )}
                  </td>
                )}
                <td className="ivr-td">
                  <CallButton leadId={r.id} disabled={r.stage === "closed"} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dialog && agents && (
        <BulkAssignDialog
          leadIds={ids}
          agents={agents}
          onClose={() => {
            setDialog(false);
            setPicked(new Set());
          }}
        />
      )}
    </div>
  );
}
