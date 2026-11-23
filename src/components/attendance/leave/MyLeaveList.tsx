"use client";

import { useConfirm } from "@/components/ConfirmDialog";
import { cancelLeaveAction } from "@/lib/attendance/actions/staff";
import type { MyLeave } from "@/lib/attendance/leave";
import { leaveColor } from "@/lib/attendance/att.manifest";
import { formatDay } from "@/lib/attendance/time";
import { Empty, RequestStatus } from "../ui";
import { useAct } from "../use-act";

const dates = (r: MyLeave) => (r.startDate === r.endDate ? formatDay(r.startDate) : `${formatDay(r.startDate)} – ${formatDay(r.endDate)}`);

/** The person's leave requests with their status; pending ones (and approved ones not started) can be cancelled. Cards on a phone, a table from 768 px. */
export function MyLeaveList({ items }: { items: MyLeave[] }) {
  const { act, pending } = useAct();
  const confirm = useConfirm();
  if (!items.length) return <Empty title="No leave requests yet" />;
  const cancel = async (r: MyLeave) => {
    if (await confirm({ title: "Cancel this leave?", message: "The days go back to your balance.", confirmLabel: "Cancel leave", danger: true })) await act(() => cancelLeaveAction(r.id));
  };
  const doc = (r: MyLeave) =>
    r.hasAttachment && (
      <a href={`/api/attendance/files/${r.id}`} className="text-xs font-semibold text-[var(--att-primary)]" target="_blank" rel="noreferrer">
        Document
      </a>
    );
  return (
    <>
      <ul className="divide-y divide-[var(--att-line)] md:hidden">
        {items.map((r) => (
          <li key={r.id} className="flex flex-col gap-2 px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <p className="flex items-center gap-2 font-bold text-(--att-text)">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: leaveColor(r.color) }} aria-hidden />
                {r.typeName}
              </p>
              <RequestStatus status={r.status} />
            </div>
            <p className="text-sm text-gray-700">
              {dates(r)}
              {r.halfDay !== "none" && <span className="text-gray-500"> ({r.halfDay} half)</span>} · {r.days} day{r.days === 1 ? "" : "s"}
            </p>
            {(r.remark || r.reason) && <p className="text-xs text-gray-500">{r.remark ?? `Reason: ${r.reason}`}</p>}
            <div className="flex items-center justify-between gap-2">
              {doc(r) || <span />}
              {r.canCancel && (
                <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => cancel(r)}>
                  Cancel leave
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="att-scroll hidden md:block">
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
                  {dates(r)}
                  {r.halfDay !== "none" && <span className="att-muted"> ({r.halfDay} half)</span>} <span className="ml-1">{doc(r)}</span>
                </td>
                <td className="tabular-nums">{r.days}</td>
                <td>
                  <RequestStatus status={r.status} />
                </td>
                <td className="max-w-[16rem] text-xs att-muted">{r.remark ?? (r.reason ? `Reason: ${r.reason}` : "")}</td>
                <td className="text-right">
                  {r.canCancel && (
                    <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => cancel(r)}>
                      Cancel
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
