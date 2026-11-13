import type { ReactNode } from "react";
import Link from "next/link";
import { BarChart3, BookOpen, Briefcase, ClipboardList, FileText, Folder, Globe, Inbox, Landmark, LifeBuoy, ShieldCheck, type LucideIcon } from "lucide-react";
import type { Priority, ProjectStatus } from "@/db/eru-schema";
import { colorOf, initials, PRIORITY_LABEL, STATUS_LABEL, STATUS_TONE } from "@/lib/eru/eru.manifest";

/** ERU's small shared pieces (server- and client-safe: no hooks). Styles are in src/app/eru/eru.css (eru-). */

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[clamp(1.7rem,3vw,2.2rem)] text-ink">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-[0.9rem] eru-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = "", pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`eru-card ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--eru-line)] px-5 py-3.5">
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
    <span className={`eru-badge eru-tone-${tone}`} title={title}>
      {children}
    </span>
  );
}

export const StatusBadge = ({ status }: { status: ProjectStatus }) => <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;

const PRIORITY_TONE: Record<Priority, Tone> = { urgent: "red", high: "orange", normal: "blue", low: "neutral" };
export const PriorityBadge = ({ priority }: { priority: Priority }) => <Badge tone={PRIORITY_TONE[priority]}>{PRIORITY_LABEL[priority]}</Badge>;

export function DomainBadge({ name, color }: { name: string; color: string }) {
  const c = colorOf(color);
  return (
    <span className="eru-badge" style={{ background: c.tint, color: c.text, borderColor: c.tint }}>
      {name}
    </span>
  );
}

const ICONS: Record<string, LucideIcon> = {
  landmark: Landmark,
  "clipboard-list": ClipboardList,
  "book-open": BookOpen,
  "shield-check": ShieldCheck,
  "life-buoy": LifeBuoy,
  folder: Folder,
  "bar-chart": BarChart3,
  globe: Globe,
  briefcase: Briefcase,
  "file-text": FileText,
};
export function DomainIcon({ icon, size = 22 }: { icon: string; size?: number }) {
  const I = ICONS[icon] ?? Folder;
  return <I size={size} aria-hidden />;
}

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span className="eru-avatar" style={{ width: size, height: size, fontSize: size * 0.38 }} title={name} aria-label={name}>
      {initials(name)}
    </span>
  );
}

/** Up to `max` avatars, then "+n". */
export function Avatars({ people, max = 4, size = 26 }: { people: { id: string; name: string }[]; max?: number; size?: number }) {
  if (!people.length) return <span className="text-xs eru-muted">Nobody assigned</span>;
  return (
    <span className="eru-avatars" aria-label={`Assigned: ${people.map((p) => p.name).join(", ")}`}>
      {people.slice(0, max).map((p) => (
        <Avatar key={p.id} name={p.name} size={size} />
      ))}
      {people.length > max && (
        <span className="eru-avatar" style={{ width: size, height: size, fontSize: size * 0.36, background: "#94a3b8" }}>
          +{people.length - max}
        </span>
      )}
    </span>
  );
}

/** One of the dashboard's numbers. With `href` the whole card is a link. */
export function Kpi({ label, value, tone, href }: { label: string; value: ReactNode; tone?: "green" | "purple" | "navy" | "amber"; href?: string }) {
  const color = tone === "green" ? "#15803d" : tone === "purple" ? "var(--eru-purple)" : tone === "amber" ? "#b45309" : "var(--eru-navy)";
  const body = (
    <>
      <span className="eru-label">{label}</span>
      <span className="text-[2rem] font-extrabold leading-tight tabular-nums" style={{ color }}>
        {value}
      </span>
    </>
  );
  const cls = "eru-card eru-card-hover flex flex-col gap-1 px-5 py-4";
  return href ? (
    <Link href={href} className={`${cls} hover:bg-[var(--eru-navy-tint)]`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="grid place-items-center gap-2 px-6 py-12 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-xl bg-[var(--eru-navy-tint)] text-[var(--eru-navy)]">
        <Inbox size={22} />
      </span>
      <p className="text-base font-bold text-ink">{title}</p>
      {children && <div className="max-w-md text-[0.85rem] eru-muted">{children}</div>}
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
/** Whether a YYYY-MM-DD due date is before today (IST). */
export const isOverdue = (day: string | null) => !!day && day < new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/** A stored file's page address: the server checks who may open it, then redirects to a 60-second link. */
export const fileHref = (fileId: string, inline = false) => `/api/eru/files/${fileId}${inline ? "?inline=1" : ""}`;
export const exportHref = (documentId: string) => `/api/eru/documents/${documentId}/export`;

/** One line of history in words. */
export function describeActivity(action: string, d: Record<string, unknown>): string {
  const s = (k: string) => (typeof d[k] === "string" || typeof d[k] === "number" ? String(d[k]) : "");
  switch (action) {
    case "project.create":
      return `created ${s("number")} "${s("title")}"`;
    case "project.details":
      return "edited the project details";
    case "project.update":
      return `changed ${Object.entries(d).map(([k, v]) => `${k === "dueDate" ? "due date" : k} to ${String(v)}`).join(", ")}`;
    case "project.assignees":
      return "changed who is assigned";
    case "project.delete":
      return `deleted ${s("number")} "${s("title")}"`;
    case "document.create":
      return `created the document "${s("title")}"`;
    case "document.import":
      return `imported the document "${s("title")}"`;
    case "document.edit":
      return `edited "${s("title")}"`;
    case "document.delete":
      return `deleted the document "${s("title")}"`;
    case "document.track_on":
      return `switched track changes on in "${s("title")}"`;
    case "document.track_off":
      return `switched track changes off in "${s("title")}"`;
    case "changes.accepted":
      return `accepted ${s("count")} change${s("count") === "1" ? "" : "s"} in "${s("title")}"`;
    case "changes.rejected":
      return `rejected ${s("count")} change${s("count") === "1" ? "" : "s"} in "${s("title")}"`;
    case "comment.add":
      return `commented on "${s("title")}"`;
    case "file.upload":
      return `uploaded ${s("fileName")}`;
    case "file.remove":
      return `removed ${s("fileName")}`;
    case "domain.update":
      return `updated the domain ${s("name")}`;
    case "settings.update":
      return "changed the settings";
    case "data.delete_all":
      return "deleted all ERU data";
    default:
      return action;
  }
}
