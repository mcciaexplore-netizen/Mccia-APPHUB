"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/Modal";
import { adjustBalanceAction } from "@/lib/attendance/actions/admin";
import { leaveColor } from "@/lib/attendance/att.manifest";
import { Field } from "../ui";
import { useAct } from "../use-act";

type T = { id: string; name: string; color: string; isCompoff: boolean };
type Row = { userId: string; name: string; balances: Record<string, { entitled: number; accrued: number; carried: number; adjusted: number; booked: number; pending: number; balance: number }> };

/** Everyone's balances for the year, per type; Adjust adds or deducts days with a remark (the person is told on the bell). */
export function LeaveTrackerView({ types, rows, year }: { types: T[]; rows: Row[]; year: number }) {
  const [q, setQ] = useState("");
  const [adjusting, setAdjusting] = useState<Row | null>(null);
  const shown = useMemo(() => rows.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase())), [rows, q]);
  return (
    <div>
      <div className="border-b border-[var(--att-line)] px-5 py-3">
        <input className="input max-w-xs" placeholder="Search people…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
      </div>
      <div className="att-scroll">
        <table className="att-table">
          <thead>
            <tr>
              <th>Name</th>
              {types.map((t) => (
                <th key={t.id}>
                  <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: leaveColor(t.color) }} aria-hidden />
                  {t.name}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.userId}>
                <td className="font-semibold">{r.name}</td>
                {types.map((t) => {
                  const b = r.balances[t.id];
                  return (
                    <td key={t.id} className="tabular-nums" title={t.isCompoff ? "Approved, unexpired comp-offs not yet used" : `Entitled ${b.entitled} (available ${b.accrued}) · carried ${b.carried} · adjusted ${b.adjusted} · booked ${b.booked} · pending ${b.pending}`}>
                      <span className="font-bold">{b.balance}</span>
                      {!t.isCompoff && (
                        <span className="block text-[0.68rem] att-muted">
                          {b.booked} taken{b.pending ? ` · ${b.pending} pend.` : ""}
                          {b.adjusted ? ` · ${b.adjusted > 0 ? "+" : ""}${b.adjusted} adj.` : ""}
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="text-right">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdjusting(r)}>
                    Adjust
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {adjusting && <AdjustDialog row={adjusting} types={types.filter((t) => !t.isCompoff)} year={year} onClose={() => setAdjusting(null)} />}
    </div>
  );
}

function AdjustDialog({ row, types, year, onClose }: { row: Row; types: T[]; year: number; onClose: () => void }) {
  const { act, pending } = useAct();
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [sign, setSign] = useState<1 | -1>(1);
  const [days, setDays] = useState("1");
  const [remark, setRemark] = useState("");
  const b = row.balances[typeId];
  return (
    <Modal title={`Adjust ${row.name}'s ${year} balance`} onClose={onClose}>
      <form
        className="grid gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await act(() => adjustBalanceAction({ userId: row.userId, leaveTypeId: typeId, year, days: sign * Number(days), remark }));
          if (r.ok) onClose();
        }}
      >
        <Field label="Leave type" hint={b ? `Balance now: ${b.balance}` : undefined}>
          <select className="input" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Add or deduct">
            <select className="input" value={sign} onChange={(e) => setSign(Number(e.target.value) === -1 ? -1 : 1)}>
              <option value={1}>Add</option>
              <option value={-1}>Deduct</option>
            </select>
          </Field>
          <Field label="Days">
            <input className="input" type="number" min={0.5} max={365} step={0.5} value={days} onChange={(e) => setDays(e.target.value)} required />
          </Field>
        </div>
        <Field label="Remark (they see this)">
          <textarea className="input" rows={2} maxLength={500} value={remark} onChange={(e) => setRemark(e.target.value)} required />
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={pending || remark.trim().length < 3}>
            {sign === 1 ? "Add" : "Deduct"} {days} day{Number(days) === 1 ? "" : "s"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
