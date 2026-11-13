import Link from "next/link";
import { CalendarDays, FileText } from "lucide-react";
import type { ProjectCard as Card } from "@/lib/eru/queries";
import { Avatars, DomainBadge, formatDateTime, formatDay, isOverdue, PriorityBadge, StatusBadge } from "../ui";

/** A project as a card: number, title, status, priority, due date, who is assigned, documents, last updated. The whole card opens it. */
export function ProjectCard({ p, showDomain = false }: { p: Card; showDomain?: boolean }) {
  const late = isOverdue(p.dueDate) && p.status !== "completed" && p.status !== "archived";
  return (
    <Link href={`/eru/projects/${p.id}`} className="eru-card eru-card-hover flex flex-col gap-3 p-4" data-testid="eru-project-card">
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-xs font-bold text-[var(--eru-navy)]">{p.number}</span>
        <span className="flex flex-wrap justify-end gap-1">
          <StatusBadge status={p.status} />
          <PriorityBadge priority={p.priority} />
        </span>
      </div>
      <h3 className="line-clamp-2 text-[1rem] font-bold leading-snug text-ink">{p.title}</h3>
      {showDomain && <DomainBadge name={p.domain.name} color={p.domain.color} />}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 text-xs eru-muted">
        <Avatars people={p.assigned} />
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1" title="Documents">
            <FileText size={13} aria-hidden /> {p.documents}
          </span>
          {p.dueDate && (
            <span className={`flex items-center gap-1 ${late ? "font-bold text-[var(--eru-red)]" : ""}`} title={late ? "Overdue" : "Due date"}>
              <CalendarDays size={13} aria-hidden /> {formatDay(p.dueDate)}
            </span>
          )}
        </span>
      </div>
      <p className="text-[0.7rem] eru-muted">Updated {formatDateTime(p.updatedAt)}</p>
    </Link>
  );
}
