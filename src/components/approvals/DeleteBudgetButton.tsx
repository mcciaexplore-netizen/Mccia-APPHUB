"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { api } from "@/components/approvals/api";

/**
 * "Delete Budget", for the Support Admin and the Super Admin: a confirmation that names the budget and only lets the deletion through once
 * the Budget ID (or, for a budget never approved, its event name) is typed exactly. The server checks the same.
 */
export function DeleteBudgetButton({ requestId, budgetId, eventName, confirmText }: { requestId: string; budgetId: string | null; eventName: string; confirmText: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();
  const matches = typed.trim() === confirmText.trim();

  const close = () => { if (busy) return; setOpen(false); setTyped(""); setError(null); };
  const remove = async () => {
    if (!matches) return;
    setBusy(true);
    setError(null);
    const r = await api<{ budgetId: string | null; eventName: string }>("POST", `/api/approvals/requests/${requestId}/delete`, { confirm: typed });
    if (!r.ok) { setBusy(false); setError(r.error); return; }
    toast.success(r.data.budgetId
      ? `Budget ${r.data.budgetId} has been permanently deleted. This ID has been retired.`
      : `The budget for ${r.data.eventName} has been permanently deleted.`);
    router.push("/approvals/budget/all");
    router.refresh();
  };

  return (
    <>
      <button type="button" className="btn btn-danger btn-sm" onClick={() => setOpen(true)} data-testid="budget-delete">
        <Trash2 size={14} aria-hidden /> Delete Budget
      </button>
      {open && (
        <Modal title="Delete this budget?" onClose={close}>
          <div className="space-y-3 text-sm" data-testid="budget-delete-dialog">
            <p>Are you sure you want to delete this budget?</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted">Budget ID:</dt><dd className="font-semibold">{budgetId ?? "Not assigned yet"}</dd>
              <dt className="text-muted">Event:</dt><dd className="font-semibold">{eventName}</dd>
            </dl>
            <p className="text-muted">
              This action cannot be undone. The original budget, every revision, its history and its files are deleted.
              {budgetId && <> The Budget ID <b className="text-ink">{budgetId}</b> will be permanently retired and cannot be used again.</>}
            </p>
            <label className="block">
              <span className="font-semibold">Type {budgetId ? "the Budget ID" : "the event name"} to confirm:</span>
              <input
                className="input mt-1 w-full" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={confirmText}
                autoComplete="off" spellCheck={false} disabled={busy} data-testid="budget-delete-confirm"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void remove(); } }}
              />
            </label>
            {error && <p className="text-red-700" role="alert">{error}</p>}
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" className="btn btn-ghost btn-sm" onClick={close} disabled={busy}>Cancel</button>
            <button type="button" className="btn btn-danger btn-sm" onClick={remove} disabled={!matches || busy} data-testid="budget-delete-go">
              {busy ? "Deleting…" : "Delete permanently"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
