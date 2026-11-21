"use client";

import { useConfirm } from "@/components/ConfirmDialog";
import { cancelLeaveAction } from "@/lib/attendance/actions/staff";
import type { MyLeave } from "@/lib/attendance/leave";
import { leaveColor } from "@/lib/attendance/att.manifest";
import { formatDay } from "@/lib/attendance/time";
import { Empty, RequestStatus } from "../ui";
import { useAct } from "../use-act";

/** The person's leave requests with their status; pending ones (and approved ones not started) can be cancelled. */
export function MyLeaveList({ items }: { items: MyLeave[] }) {
  const { act, pending } = useAct();
  const confirm = useConfirm();
  if (!items.length) return <Empty title="No leave requests yet" />;
  return (
    <div className="att-scroll">
      <table className="att-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Dates</th>
            <th>Days</th>
            <th>Status</th>
            <th>Remark</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap font-semibold">
                <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: leaveColor(r.color) }} aria-hidden />
                {r.typeName}
              </td>
              <td className="whitespace-nowrap">
                {r.startDate === r.endDate ? formatDay(r.startDate) : `${formatDay(r.startDate)} – ${formatDay(r.endDate)}`}
                {r.halfDay !== "none" && <span className="att-muted"> ({r.halfDay} half)</span>}
                {r.hasAttachment && (
                  <a href={`/api/attendance/files/${r.id}`} className="ml-2 text-xs font-semibold text-[var(--att-blue)]" target="_blank" rel="noreferrer">
                    Document
                  </a>
                )}
              </td>
              <td className="tabular-nums">{r.days}</td>
              <td>
                <RequestStatus status={r.status} />
              </td>
              <td className="max-w-[16rem] text-xs att-muted">{r.remark ?? (r.reason ? `Reason: ${r.reason}` : "")}</td>
              <td className="text-right">
                {r.canCancel && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={pending}
                    onClick={async () => {
                      if (await confirm({ title: "Cancel this leave?", message: "The days go back to your balance.", confirmLabel: "Cancel leave", danger: true })) await act(() => cancelLeaveAction(r.id));
                    }}
                  >
                    Cancel
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
