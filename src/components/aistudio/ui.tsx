import type { ReactNode } from "react";
import Link from "next/link";
import { Inbox } from "lucide-react";
import type { Priority, RequestStatus, RequestType } from "@/db/aistudio-schema";
import { PRIORITY_LABEL, STATUS_LABEL, STATUS_TONE, TYPE_LABEL } from "@/lib/aistudio/aistudio.manifest";

/** AI Studio's small shared pieces (server- and client-safe: no hooks). Styles are in src/app/aistudio/aistudio.css (ai-). */

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[clamp(1.7rem,3vw,2.2rem)] text-ink">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-[0.9rem] ai-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = "", pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`ai-card ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ai-line)] px-5 py-3.5">
          {title && <h2 className="text-[1.02rem] font-bold text-ink">{title}</h2>}
          {actions}
        </div>
      )}
      <div className={pad ? "p-5" : ""}>{children}</div>
    </section>
  );
}

export type Tone = "neutral" | "blue" | "amber" | "purple" | "green" | "red" | "orange";

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`ai-badge ai-tone-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: RequestStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

const PRIORITY_TONE: Record<Priority, Tone> = { urgent: "red", high: "orange", normal: "blue", low: "neutral" };
export function PriorityBadge({ priority }: { priority: Priority | null }) {
  if (!priority) return <span className="text-xs ai-muted">No priority yet</span>;
  return <Badge tone={PRIORITY_TONE[priority]}>{PRIORITY_LABEL[priority]}</Badge>;
}

export function TypeBadge({ type }: { type: RequestType }) {
  return <Badge tone="purple">{TYPE_LABEL[type]}</Badge>;
}

/** The five steps as bars: finished green, current navy. */
export function Steps({ steps }: { steps: { label: string; done: boolean; current: boolean }[] }) {
  const now = steps.find((s) => s.current) ?? [...steps].reverse().find((s) => s.done) ?? steps[0];
  return (
    <div className="ai-steps" aria-label={`Progress: ${now.label}`}>
      {steps.map((s) => (
        <div key={s.label}>
          <div className="ai-step-bar" data-done={s.done} data-on={s.current} />
          <div className="ai-step-text" data-on={s.current}>
            {s.label}
          </div>
        </div>
      ))}
    </div>
  );
}

/** One of the dashboard's numbers. With `href` the whole card is a link (to the list, filtered to what the number counts). */
export function Kpi({ label, value, tone, href }: { label: string; value: ReactNode; tone?: "green" | "purple" | "navy" | "amber"; href?: string }) {
  const color = tone === "green" ? "var(--ai-green-text)" : tone === "purple" ? "var(--ai-purple)" : tone === "amber" ? "#b45309" : "var(--ai-navy)";
  const body = (
    <>
      <span className="ai-label">{label}</span>
      <span className="text-[2rem] font-extrabold leading-tight tabular-nums" style={{ color }}>
        {value}
      </span>
    </>
  );
  const cls = "ai-card ai-card-hover flex flex-col gap-1 px-5 py-4";
  return href ? (
    <Link href={href} className={`${cls} cursor-pointer hover:bg-[var(--ai-navy-tint)] hover:shadow-md`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="grid place-items-center gap-2 px-6 py-12 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-xl bg-[var(--ai-navy-tint)] text-[var(--ai-navy)]">
        <Inbox size={22} />
      </span>
      <p className="text-base font-bold text-ink">{title}</p>
      {children && <div className="max-w-md text-[0.85rem] ai-muted">{children}</div>}
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

/** A stored file's page address: the server checks who may open it, then redirects to a 60-second link. */
export const fileHref = (fileId: string, inline = false) => `/api/aistudio/files/${fileId}${inline ? "?inline=1" : ""}`;
