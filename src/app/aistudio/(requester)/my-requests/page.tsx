import Link from "next/link";
import { DownloadDeliverables } from "@/components/aistudio/requester/download-deliverables";
import { Empty, PageHeader, StatusBadge, Steps, TypeBadge, formatDay } from "@/components/aistudio/ui";
import { requireRequester } from "@/lib/aistudio/dal";
import { myRequests, type MyRequest } from "@/lib/aistudio/queries";
import type { RequestStatus } from "@/db/aistudio-schema";

export const metadata = { title: "My Requests · AI Studio" };

const TABS: { key: string; label: string; statuses: RequestStatus[] | null }[] = [
  { key: "all", label: "All", statuses: null },
  { key: "pending", label: "Pending", statuses: ["pending_review"] },
  { key: "progress", label: "In Progress", statuses: ["accepted", "in_progress"] },
  { key: "review", label: "In Review", statuses: ["review_testing"] },
  { key: "delivered", label: "Delivered", statuses: ["delivered"] },
  { key: "closed", label: "Closed", statuses: ["closed", "declined"] },
];

function RequestCard({ r }: { r: MyRequest }) {
  return (
    <li className="ai-card ai-card-hover flex flex-col">
      <Link href={`/aistudio/requests/${r.id}`} className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-[var(--ai-navy)]">{r.number}</span>
          <TypeBadge type={r.requestType} />
          <StatusBadge status={r.status} />
        </div>
        <p className="font-semibold text-ink">{r.title}</p>
        <p className="text-xs ai-muted">
          Submitted {formatDay(r.createdAt)} · Deadline: {r.deadline ? formatDay(r.deadline) : "to be confirmed"}
        </p>
        {r.status === "declined" ? <p className="text-sm text-[var(--ai-red)]">Declined{r.declineReason ? `: ${r.declineReason}` : ""}</p> : <Steps steps={r.steps} />}
      </Link>
      {r.deliverables.length > 0 && (
        <div className="border-t border-[var(--ai-line)] px-5 py-3">
          <DownloadDeliverables number={r.number} files={r.deliverables} />
        </div>
      )}
    </li>
  );
}

/** The person's own requests, by stage. */
export default async function MyRequestsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const u = await requireRequester();
  const { tab: raw } = await searchParams;
  const tab = TABS.find((t) => t.key === raw) ?? TABS[0];
  const all = await myRequests(u);
  const shown = tab.statuses ? all.filter((r) => tab.statuses!.includes(r.status)) : all;
  return (
    <div>
      <PageHeader
        title="My Requests"
        subtitle="Everything you have asked AI Studio for, and where it stands."
        actions={
          <Link href="/aistudio/request" className="btn btn-sm ai-btn-navy">
            New request
          </Link>
        }
      />
      <nav className="ai-tabs mb-5" aria-label="Filter requests">
        {TABS.map((t) => (
          <Link key={t.key} href={t.key === "all" ? "/aistudio/my-requests" : `/aistudio/my-requests?tab=${t.key}`} className="ai-tab" aria-current={t.key === tab.key ? "page" : undefined}>
            {t.label} <span className="opacity-70">({t.statuses ? all.filter((r) => t.statuses!.includes(r.status)).length : all.length})</span>
          </Link>
        ))}
      </nav>
      {shown.length === 0 ? (
        <div className="ai-card">
          <Empty title={all.length ? "Nothing here" : "You haven't submitted any requests yet."}>
            {all.length ? (
              "No request is at this stage."
            ) : (
              <Link href="/aistudio/request" className="font-semibold text-[var(--ai-navy)] hover:underline">
                Submit your first request →
              </Link>
            )}
          </Empty>
        </div>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {shown.map((r) => (
            <RequestCard key={r.id} r={r} />
          ))}
        </ul>
      )}
    </div>
  );
}
