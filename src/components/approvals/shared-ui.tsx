import { CheckCircle2, ClipboardList, FileText } from "lucide-react";
import type { AprRequestStatus } from "@/db/approvals-schema";

/** Small pieces shared by the module's screens. No hooks here, so they render on the server and inside client components alike. */

const PILL_LABEL: Record<AprRequestStatus | "dg", string> = {
  pending: "Under Review", dg: "With Director General", approved: "Approved ✓", rejected: "Rejected", returned: "Needs Correction", withdrawn: "Withdrawn", draft: "Draft",
};

/**
 * A request's status as a coloured pill, the same everywhere. A pending request past its first step is with the Director General (their step
 * is the last), so it is told apart from one still under review by the first approver.
 */
export function StatusPill({ status, currentStepNo }: { status: AprRequestStatus; currentStepNo?: number }) {
  const key = status === "pending" && (currentStepNo ?? 1) > 1 ? "dg" : status;
  return <span className={`apr-pill apr-pill-${key} status-pill`}>{PILL_LABEL[key]}</span>;
}

const EMPTY = {
  waiting: { Icon: CheckCircle2, tone: "text-[var(--z-green)]", title: "You are all caught up!", body: "Nothing is waiting for your review right now." },
  queue: { Icon: CheckCircle2, tone: "text-[var(--z-green)]", title: "Nothing in the queue.", body: "No requests have been recommended to you yet." },
  mine: { Icon: FileText, tone: "text-subtle", title: "Nothing submitted yet.", body: "Use the buttons above to raise your first request." },
  none: { Icon: ClipboardList, tone: "text-subtle", title: "No requests found.", body: "Try adjusting your filters." },
} as const;

/** What a list shows instead of an empty table. */
export function EmptyState({ kind }: { kind: keyof typeof EMPTY }) {
  const e = EMPTY[kind];
  return (
    <div className="apr-empty" role="status">
      <e.Icon size={40} className={e.tone} aria-hidden />
      <p className="font-bold text-ink">{e.title}</p>
      <p className="text-sm text-subtle">{e.body}</p>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label-xs mb-1.5 block">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-subtle">{hint}</span>}
    </label>
  );
}

export function ActiveToggle({ active, onToggle, disabled }: { active: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      type="button" onClick={onToggle} disabled={disabled} title={active ? "Click to deactivate" : "Click to activate"}
      className={`badge btn-press ${active ? "badge-green" : "badge-neutral"} cursor-pointer disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {active ? "Active" : "Inactive"}
    </button>
  );
}

export function SearchBox({ value, onChange, placeholder = "Search" }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input className="input max-w-xs" type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />;
}
