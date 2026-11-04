import { notFound } from "next/navigation";
import Link from "next/link";
import { FilesList, LinksList, Timeline } from "@/components/aistudio/files-list";
import { DownloadDeliverables } from "@/components/aistudio/requester/download-deliverables";
import { Card, PriorityBadge, StatusBadge, TypeBadge, formatDateTime, formatDay } from "@/components/aistudio/ui";
import { requireRequester } from "@/lib/aistudio/dal";
import { myRequestDetail } from "@/lib/aistudio/queries";
import { getRequest } from "@/lib/aistudio/requests";

export const metadata = { title: "My request · AI Studio" };

/** One of the person's own requests: what they asked for, where it stands, the team's shared notes and, once delivered, the files. */
export default async function MyRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireRequester();
  const { id } = await params;
  const own = await getRequest(id);
  if (!own || own.requesterId !== u.id) notFound();
  const r = await myRequestDetail(u, id);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/aistudio/my-requests" className="text-sm font-semibold text-[var(--ai-navy)] hover:underline">
          ← My requests
        </Link>
        <h1 className="mt-2 flex flex-wrap items-center gap-2 text-[clamp(1.5rem,2.6vw,2rem)] text-ink">
          <span className="text-[var(--ai-navy)]">{r.number}</span> · {r.title} <StatusBadge status={r.status} />
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <TypeBadge type={r.requestType} />
          <span className="ai-muted" suppressHydrationWarning>Submitted: {formatDateTime(r.createdAt)}</span>
          <span className="ai-muted">Deadline: {r.deadline ? formatDay(r.deadline) : "To be confirmed"}</span>
          <span className="ai-muted">Priority: {r.priority ? <PriorityBadge priority={r.priority} /> : "To be confirmed"}</span>
        </div>
      </div>
      {r.status === "declined" && (
        <p role="status" className="alert alert-red text-sm">
          This request was declined{r.declineReason ? `: ${r.declineReason}` : "."}
        </p>
      )}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <Card title="Description">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{r.description}</p>
            {r.content && (
              <div className="mt-4 rounded-lg border border-[var(--ai-line)] bg-[#fafafa] px-3 py-2 text-sm">
                <span className="ai-label block">Content you shared</span>
                <span className="whitespace-pre-wrap text-ink">{r.content}</span>
              </div>
            )}
          </Card>
          <Card title="References">
            <p className="ai-label mb-2">Links</p>
            <LinksList links={r.referenceLinks} />
            <p className="ai-label mb-2 mt-4">Files</p>
            <FilesList files={r.attachments} />
          </Card>
          {(r.status === "delivered" || r.status === "closed") && (
            <Card title="Deliverables" actions={<DownloadDeliverables number={r.number} files={r.deliverables} label="Download all" />}>
              {r.deliveryNotes && <p className="mb-3 whitespace-pre-wrap text-sm text-ink">{r.deliveryNotes}</p>}
              <FilesList files={r.deliverables} />
            </Card>
          )}
        </div>
        <div className="flex flex-col gap-5">
          {r.status !== "declined" && (
            <Card title="Progress">
              <Timeline steps={r.steps} />
            </Card>
          )}
          <Card title="Notes from AI Studio">
            {r.notes.length === 0 ? (
              <p className="text-sm ai-muted">No updates yet. AI Studio will post updates here.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {r.notes.map((n) => (
                  <li key={n.id} className="border-l-2 border-[var(--ai-navy-line)] pl-3 text-sm">
                    <p className="text-xs ai-muted" suppressHydrationWarning>
                      AI Studio team · {formatDateTime(n.at)}
                    </p>
                    <p className="whitespace-pre-wrap text-ink">{n.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
