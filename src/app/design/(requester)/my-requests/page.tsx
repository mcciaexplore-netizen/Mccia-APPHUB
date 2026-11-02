import Link from "next/link";
import { requireRequester } from "@/lib/design/dal";
import { myRequests } from "@/lib/design/requester-queries";
import { REQUESTER_TABS, REQUESTER_TAB_LABEL, requesterTabOf, type RequesterTab } from "@/lib/design/rules";
import { Empty, PageHeader } from "@/components/design/ui";
import { MyRequestCard } from "@/components/design/requester/my-request-card";

/** The person's own design requests, by stage, with what they can do on each (approve, ask for changes, download). */
export default async function MyRequestsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireRequester();
  const { tab: raw } = await searchParams;
  const tab: RequesterTab = (REQUESTER_TABS as readonly string[]).includes(raw ?? "") ? (raw as RequesterTab) : "all";
  const all = await myRequests(user.id);
  const counts = Object.fromEntries(REQUESTER_TABS.map((t) => [t, t === "all" ? all.length : all.filter((r) => requesterTabOf(r.status) === t).length]));
  const shown = tab === "all" ? all : all.filter((r) => requesterTabOf(r.status) === tab);
  return (
    <div>
      <PageHeader
        title="My Requests"
        subtitle="Every design you have asked for, and where it stands."
        actions={
          <Link href="/design/request" className="btn btn-sm ds-btn-navy">
            Request a design
          </Link>
        }
      />
      <nav className="ds-tabs mb-5" aria-label="Filter requests">
        {REQUESTER_TABS.map((t) => (
          <Link key={t} href={t === "all" ? "/design/my-requests" : `/design/my-requests?tab=${t}`} className="ds-tab" aria-current={t === tab ? "page" : undefined}>
            {REQUESTER_TAB_LABEL[t]} <span className="opacity-70">({counts[t]})</span>
          </Link>
        ))}
      </nav>
      {shown.length === 0 ? (
        <div className="ds-card">
          <Empty title={all.length ? "Nothing here" : "No requests yet"}>
            {all.length ? "No request is at this stage." : (
              <>
                <Link href="/design/request" className="font-semibold text-[var(--ds-navy)] hover:underline">
                  Request a design
                </Link>{" "}
                and it will appear here.
              </>
            )}
          </Empty>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {shown.map((r) => (
            <MyRequestCard key={r.id} r={r} />
          ))}
        </div>
      )}
    </div>
  );
}
