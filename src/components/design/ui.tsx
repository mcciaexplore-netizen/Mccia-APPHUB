import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import type { Priority, TicketStatus } from "@/db/design-schema";
import { PRIORITY_LABEL, STATUS_LABEL, STATUS_TONE, STEPS, dueHealth, stepOf, timeLeft } from "@/lib/design/rules";

/** DesignDesk's small shared pieces (server- and client-safe: no hooks). Styles are in src/app/design/design.css (ds-). */

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[clamp(1.7rem,3vw,2.2rem)] text-ink">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-[0.9rem] ds-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = "", pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`ds-card ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ds-line)] px-5 py-3.5">
          {title && <h2 className="text-[1.02rem] font-bold text-ink">{title}</h2>}
          {actions}
        </div>
      )}
      <div className={pad ? "p-5" : ""}>{children}</div>
    </section>
  );
}

export function Badge({ tone = "neutral", children, title }: { tone?: "neutral" | "blue" | "amber" | "purple" | "green" | "red" | "orange"; children: ReactNode; title?: string }) {
  return (
    <span className={`ds-badge ds-tone-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: TicketStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

const PRIORITY_TONE: Record<Priority, "red" | "orange" | "blue" | "neutral"> = { urgent: "red", high: "orange", normal: "blue", low: "neutral" };
export function PriorityBadge({ priority }: { priority: Priority }) {
  return <Badge tone={PRIORITY_TONE[priority]}>{PRIORITY_LABEL[priority]}</Badge>;
}

/** A deadline: red when late, amber within a day. */
export function DueText({ dueAt, status, withLeft = true }: { dueAt: string | null; status: TicketStatus; withLeft?: boolean }) {
  if (!dueAt) return <span className="ds-muted">No deadline</span>;
  const h = dueHealth(dueAt, status);
  const color = h === "overdue" ? "text-[var(--ds-red)] font-semibold" : h === "soon" ? "text-[#b45309] font-semibold" : "text-ink";
  return (
    <span className={color} suppressHydrationWarning>
      {formatDateTime(dueAt)}
      {withLeft && h !== "done" && <span className="ds-muted font-normal"> · {timeLeft(dueAt)}</span>}
    </span>
  );
}

/** The requester's five steps; finished steps are green, the current one navy. */
export function Steps({ status, compact = false }: { status: TicketStatus; compact?: boolean }) {
  const at = stepOf(status);
  const finished = at === 4;
  return (
    <div className="ds-steps" aria-label={`Progress: ${STEPS[at]}`}>
      {STEPS.map((s, i) => (
        <div key={s}>
          <div className="ds-step-bar" data-done={i < at || (finished && i === at)} data-on={i === at && !finished} />
          {!compact && (
            <div className="ds-step-text" data-on={i === at}>
              {s}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function Avatar({ name, size = 26 }: { name: string | null; size?: number }) {
  if (!name) return <span className="ds-avatar" style={{ width: size, height: size, background: "#cbd5e1", fontSize: size * 0.42 }} title="Unassigned">?</span>;
  const initials = name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <span className="ds-avatar" style={{ width: size, height: size, fontSize: size * 0.4 }} title={name}>
      {initials}
    </span>
  );
}

export function Kpi({ label, value, tone, hint, live }: { label: string; value: ReactNode; tone?: "red" | "green" | "purple" | "navy"; hint?: string; live?: boolean }) {
  const color = tone === "red" ? "var(--ds-red)" : tone === "green" ? "var(--ds-green-text)" : tone === "purple" ? "var(--ds-purple)" : "var(--ds-navy)";
  return (
    <div className="ds-card ds-card-hover flex flex-col gap-1 px-5 py-4">
      <span className="ds-label flex items-center gap-1.5">
        {live && <span className="ds-live" aria-hidden />}
        {label}
      </span>
      <span className="text-[2rem] font-extrabold leading-tight tabular-nums" style={{ color }}>
        {value}
      </span>
      {hint && <span className="text-[0.75rem] ds-muted">{hint}</span>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="grid place-items-center gap-2 px-6 py-12 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-xl bg-[var(--ds-navy-tint)] text-[var(--ds-navy)]">
        <Inbox size={22} />
      </span>
      <p className="text-base font-bold text-ink">{title}</p>
      {children && <div className="max-w-md text-[0.85rem] ds-muted">{children}</div>}
    </div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "12 Nov 2026, 18:00" in IST, the same on the server and in the browser. */
export function formatDateTime(iso: string | Date): string {
  const d = new Date(+new Date(iso) + 330 * 60_000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
/** "12 Nov 2026" for a YYYY-MM-DD day (or a moment, in IST). */
export function formatDay(day: string | Date): string {
  const s = typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : new Date(+new Date(day) + 330 * 60_000).toISOString().slice(0, 10);
  const [y, m, d] = s.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
