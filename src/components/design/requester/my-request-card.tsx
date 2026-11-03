"use client";

import Link from "next/link";
import type { MyRequest } from "@/lib/design/requester-queries";
import { FINISHED_STATUSES, timeLeft } from "@/lib/design/rules";
import { Badge, StatusBadge, Steps, formatDay } from "../ui";
import { RequestActions } from "./request-actions";

/** One of the person's requests on My Requests: progress, deadline, the actions that apply at its stage, and a link to its page. */

export function MyRequestCard({ r }: { r: MyRequest }) {
  const finished = FINISHED_STATUSES.includes(r.status);

  return (
    <article className="ds-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold text-[var(--ds-navy)]">{r.number}</p>
          <h2 className="text-[1.05rem] font-bold text-ink">
            <Link href={`/design/tickets/${r.id}`} className="hover:underline">
              {r.title}
            </Link>
          </h2>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {r.designs.map((d) => (
              <Badge key={d} tone="blue">
                {d}
              </Badge>
            ))}
          </div>
        </div>
        <StatusBadge status={r.status} />
      </div>

      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {r.deliveryDate && (
          <span>
            <span className="ds-muted">Needed by </span>
            <span className="font-semibold text-ink">{formatDay(r.deliveryDate)}</span>
            {!finished && r.dueAt && r.status !== "declined" && r.status !== "superseded" && (
              <span className="ds-muted" suppressHydrationWarning>
                {" "}
                · {timeLeft(r.dueAt)}
              </span>
            )}
          </span>
        )}
        <span className="ds-muted">Asked {formatDay(r.createdAt)}</span>
      </div>

      {r.status !== "declined" && (
        <div className="mt-4">
          <Steps status={r.status} />
        </div>
      )}

      {r.status === "declined" && (
        <p className="mt-3 rounded-lg bg-[var(--ds-red-tint)] px-3 py-2 text-sm text-[var(--ds-red)]">
          Declined{r.declineReason ? `: ${r.declineReason}` : "."}
        </p>
      )}
      {r.status === "superseded" && <p className="mt-3 text-sm ds-muted">You asked for changes: the design team is working on the next version.</p>}

      <RequestActions r={r} />
      <div className="mt-4 border-t border-[var(--ds-line)] pt-3 text-sm">
        <Link href={`/design/tickets/${r.id}`} className="font-semibold text-[var(--ds-navy)] hover:underline">
          Open request →
        </Link>
      </div>
    </article>
  );
}
