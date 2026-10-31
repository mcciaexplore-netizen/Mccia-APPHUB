import type { CSSProperties, ReactNode } from "react";
import { AlertCircle, CheckCircle2, Inbox, Info } from "lucide-react";
import { CountUp } from "@/components/ivr/count-up";
import { STAGES, type StageKey } from "@/lib/ivr/stage";

const tone = (color: string) => ({ "--tone": color }) as CSSProperties;

export function StagePill({ stage }: { stage: StageKey }) {
  const s = STAGES[stage];
  return (
    <span className="ivr-pill" style={tone(s.color)}>
      {s.label}
    </span>
  );
}

export function CallStatusPill({ status }: { status: string | null }) {
  if (!status) return <span className="text-muted">–</span>;
  const color =
    status === "answered" ? "var(--ivr-done)" : status === "missed" ? "var(--ivr-missed)" : status === "ongoing" ? "var(--ivr-sched)" : "var(--ivr-muted)";
  return (
    <span className="ivr-pill" style={tone(color)}>
      {status === "missed" ? "not answered" : status}
    </span>
  );
}

export function Kpi({
  label,
  value,
  live,
  hint,
  tone: toneKey,
  className = "",
  children,
}: {
  label: string;
  value: ReactNode;
  live?: boolean;
  hint?: string;
  tone?: "missed" | "done" | "sched" | "incoming" | "attempted";
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`ivr-stat flex flex-col items-center gap-1 px-4 py-5 ${className}`}>
      <span className={typeof value === "string" && value.length >= 6 ? "ivr-stat-number ivr-stat-number-text" : "ivr-stat-number"} style={toneKey ? { color: `var(--ivr-${toneKey})` } : undefined}>
        {typeof value === "number" ? <CountUp value={value} /> : value}
      </span>
      <span className="ivr-label flex items-center gap-1.5">
        {live && <span className="ivr-live-dot h-2 w-2 rounded-full bg-brand-red" aria-hidden />}
        {label}
      </span>
      {hint && <span className="text-[0.75rem] text-muted">{hint}</span>}
      {children}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-2 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[clamp(1.9rem,3.5vw,2.5rem)]">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-[0.9rem] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="grid place-items-center gap-2 px-6 py-14 text-center">
      <span className="ivr-icon-tile mb-1">
        <Inbox />
      </span>
      <p className="font-heading text-lg font-bold">{title}</p>
      {children && <div className="max-w-md text-[0.85rem] text-muted">{children}</div>}
    </div>
  );
}

export function Badge({ children, color = "var(--ivr-muted)" }: { children: ReactNode; color?: string }) {
  return (
    <span className="ivr-pill" style={tone(color)}>
      {children}
    </span>
  );
}

const ALERT_ICON = { info: Info, success: CheckCircle2, error: AlertCircle } as const;

/** Tinted message box with a matching icon. `kind` picks blue, green or red. */
export function Alert({
  kind = "info",
  children,
  className = "",
  role,
}: {
  kind?: "info" | "success" | "error";
  children: ReactNode;
  className?: string;
  role?: "alert" | "status";
}) {
  const Icon = ALERT_ICON[kind];
  const cls = kind === "info" ? "ivr-alert" : `ivr-alert ivr-alert-${kind}`;
  return (
    <div role={role ?? (kind === "error" ? "alert" : undefined)} className={`${cls} ${className}`}>
      <Icon aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
