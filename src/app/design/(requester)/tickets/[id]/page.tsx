import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { RequestActions } from "@/components/design/requester/request-actions";
import { Badge, Card, StatusBadge, Steps, formatDateTime, formatDay } from "@/components/design/ui";
import { DesignError, requireRequester } from "@/lib/design/dal";
import { requesterTicket } from "@/lib/design/requester-queries";
import { isImage } from "@/lib/design/file-types";
import { timeLeft, FINISHED_STATUSES } from "@/lib/design/rules";

export const metadata = { title: "My request · Design Team Forms" };

/** The address that opens a stored file (the server checks who may, then redirects to a 60-second link). */
const fileHref = (fileId: string, inline = false) => `/api/design/files/${fileId}${inline ? "?inline=1" : ""}`;

/**
 * One of the person's own requests, read-only: where it stands, what they asked for, the design to review (or the approved one), the
 * actions for its stage and a timeline of status changes. Nothing about who works on it: no designer, notes, time, subtasks or audit
 * details. Anyone else's request is "not found".
 */
export default async function RequesterTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireRequester();
  const { id } = await params;
  let r;
  try {
    r = await requesterTicket(u, id);
  } catch (e) {
    if (e instanceof DesignError) notFound();
    throw e;
  }
  const finished = FINISHED_STATUSES.includes(r.status);
  const p = r.proof;

  return (
    <div className="flex flex-col gap-5">
      <Link href="/design/my-requests" className="inline-flex items-center gap-1.5 self-start text-sm font-semibold text-[var(--ds-navy)] hover:underline">
        <ArrowLeft size={15} /> My requests
      </Link>

      <section className="ds-card px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="flex flex-wrap items-center gap-2 text-[clamp(1.3rem,2.4vw,1.7rem)] text-ink">
            <span className="text-[var(--ds-navy)]">{r.number}</span>
            <span className="ds-muted">·</span>
            <span className="min-w-0 break-words">{r.title}</span>
          </h1>
          <StatusBadge status={r.status} />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
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
        {r.status === "declined" ? (
          <p className="mt-3 rounded-lg bg-[var(--ds-red-tint)] px-3 py-2 text-sm text-[var(--ds-red)]">Declined{r.declineReason ? `: ${r.declineReason}` : "."}</p>
        ) : (
          <div className="mt-4">
            <Steps status={r.status} />
          </div>
        )}
        {r.status === "superseded" && <p className="mt-3 text-sm ds-muted">You asked for changes: the design team is working on the next version.</p>}
        <RequestActions r={r} viewLink={false} />
      </section>

      {p && (
        <Card
          title={`${p.approved ? "Approved design" : "Design for your review"} · V${p.version}`}
          actions={
            <a href={fileHref(p.fileId)} className="btn btn-sm btn-ghost">
              <Download size={14} aria-hidden /> Download
            </a>
          }
        >
          {isImage(p.mime) ? (
            // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link from storage, not a static asset
            <img src={fileHref(p.fileId, true)} alt={`${r.number}, version ${p.version}`} className="mx-auto block max-h-[70vh] w-auto rounded-lg border border-[var(--ds-line)]" />
          ) : p.mime === "application/pdf" ? (
            <iframe title={`${r.number}, version ${p.version}`} src={fileHref(p.fileId, true)} className="h-[70vh] w-full rounded-lg border border-[var(--ds-line)]" />
          ) : (
            <p className="text-sm ds-muted">{p.fileName} cannot be shown here. Use Download to open it.</p>
          )}
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card title="What you asked for">
          <div className="mb-3 flex flex-wrap gap-1.5">
            {r.designs.map((d) => (
              <Badge key={d} tone="blue">
                {d}
              </Badge>
            ))}
          </div>
          {r.eventName && (
            <p className="mb-2 text-sm">
              <span className="ds-muted">Event: </span>
              <span className="font-semibold text-ink">
                {r.eventName}
                {r.eventDate ? ` · ${formatDay(r.eventDate)}` : ""}
              </span>
            </p>
          )}
          <p className="whitespace-pre-wrap text-sm text-ink">{r.brief}</p>
          {r.content && (
            <div className="mt-4 rounded-lg border border-[var(--ds-line)] bg-[#fafafa] px-3 py-2 text-sm">
              <span className="ds-label block">Your content for the design</span>
              <span className="whitespace-pre-wrap text-ink">{r.content}</span>
            </div>
          )}
        </Card>
        <Card title="Activity">
          <ol className="flex flex-col gap-3">
            {r.history.map((h, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--ds-navy)]" aria-hidden />
                <span>
                  <span className="block text-ink">{h.text}</span>
                  <time className="text-xs ds-muted" dateTime={h.at} suppressHydrationWarning>
                    {formatDateTime(h.at)}
                  </time>
                </span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}
