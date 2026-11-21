import type { ReactNode } from "react";
import Link from "next/link";
import { Inbox, type LucideIcon } from "lucide-react";
import { initials } from "@/lib/attendance/att.manifest";
import { STATUS_LABEL, STATUS_TONE, type DayView } from "@/lib/attendance/calendar";

/** Attendance's small shared pieces (server- and client-safe: no hooks). Styles are in src/app/attendance/attendance.css (att-). */

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[clamp(1.6rem,3vw,2rem)] font-bold leading-tight text-gray-900">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-[0.92rem] text-gray-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export type IconTone = "green" | "blue" | "purple" | "orange" | "grey";

/** A round icon badge (light colour behind, the colour in front), as on the Home cards. */
export function IconBadge({ icon: I, tone = "green", size = 18 }: { icon: LucideIcon; tone?: IconTone; size?: number }) {
  return (
    <span className={`att-icon att-icon-${tone}`} aria-hidden>
      <I size={size} />
    </span>
  );
}

export function Card({
  title,
  subtitle,
  icon,
  iconTone,
  actions,
  children,
  className = "",
  pad = true,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  iconTone?: IconTone;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return (
    <section className={`att-card ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--att-line)] px-6 py-4">
          <div className="flex min-w-0 items-center gap-3">
            {icon && <IconBadge icon={icon} tone={iconTone} />}
            <div className="min-w-0">
              {title && <h2 className="text-base font-bold text-gray-900">{title}</h2>}
              {subtitle && <p className="text-[0.8rem] text-gray-500">{subtitle}</p>}
            </div>
          </div>
          {actions}
        </div>
      )}
      <div className={pad ? "p-6" : ""}>{children}</div>
    </section>
  );
}

export type Tone = "neutral" | "blue" | "amber" | "purple" | "green" | "red" | "teal" | "grey" | "none";

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`att-badge att-tone-${tone}`} title={title}>
      {children}
    </span>
  );
}

export const DayBadge = ({ view }: { view: DayView }) => <Badge tone={view.missedCheckout ? "red" : STATUS_TONE[view.status]}>{view.missedCheckout ? "Missed check-out" : STATUS_LABEL[view.status]}</Badge>;

const REQ_TONE: Record<string, Tone> = { pending: "amber", submitted: "amber", approved: "green", rejected: "red", cancelled: "neutral", draft: "neutral", used: "blue", expired: "neutral" };
export const RequestStatus = ({ status }: { status: string }) => <Badge tone={REQ_TONE[status] ?? "neutral"}>{status[0].toUpperCase() + status.slice(1)}</Badge>;

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span className="att-avatar" style={{ width: size, height: size, fontSize: size * 0.38 }} title={name} aria-hidden>
      {initials(name)}
    </span>
  );
}

export function Kpi({ label, value, tone, href }: { label: string; value: ReactNode; tone?: "green" | "red" | "amber" | "blue" | "teal" | "dark"; href?: string }) {
  const colors: Record<string, string> = { green: "var(--att-primary-2)", red: "var(--att-red)", amber: "#b45309", blue: "var(--att-info)", teal: "#0f766e" };
  const color = colors[tone ?? "dark"] ?? "#111827";
  const body = (
    <>
      <span className="att-label">{label}</span>
      <span className="text-[1.9rem] font-extrabold leading-tight tabular-nums" style={{ color }}>
        {value}
      </span>
    </>
  );
  const cls = "att-card flex flex-col gap-1 px-6 py-5";
  return href ? (
    <Link href={href} className={`${cls} hover:bg-[var(--att-primary-tint)]`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="grid place-items-center gap-2 px-6 py-10 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-full bg-gray-100 text-gray-400">
        <Inbox size={20} />
      </span>
      <p className="text-base font-bold text-ink">{title}</p>
      {children && <div className="max-w-md text-[0.85rem] att-muted">{children}</div>}
    </div>
  );
}

/** Tabs as links (?tab=…), so each tab has its own address. */
export function LinkTabs({ tabs, current }: { tabs: { key: string; label: string; href: string }[]; current: string }) {
  return (
    <nav className="att-tabs" aria-label="Tabs">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} className="att-tab" aria-current={t.key === current ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold att-muted">
      {label}
      {children}
      {hint && <span className="text-[0.7rem] font-normal">{hint}</span>}
    </label>
  );
}
