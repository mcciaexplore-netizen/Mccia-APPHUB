import Link from "next/link";
import { REVIEW_LABEL, REVIEW_TABS, REVIEW_TAB_LABEL, type ReviewKey, type ReviewTab } from "@/lib/approvals/approvals.manifest";

/** The three lists of HR or of Expenditure: Pending, Approved and Rejected, as tabs above the list. The Pending tab carries what waits for you. */
export function ReviewTabs({ place, active, waiting }: { place: ReviewKey; active: ReviewTab; waiting: number }) {
  return (
    <nav className="mb-5 flex gap-2 overflow-x-auto border-b border-line pb-3" aria-label={`${REVIEW_LABEL[place]} lists`}>
      {REVIEW_TABS.map((t) => (
        <Link
          key={t} href={`/approvals/review/${place}/${t}`} aria-current={t === active ? "page" : undefined}
          className={`whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-all duration-200 ${t === active ? "bg-blue-tint text-primary" : "text-muted hover:bg-blue-tint hover:text-primary"}`}
        >
          {REVIEW_TAB_LABEL[t]}
          {t === "pending" && waiting > 0 && <span className="ml-2 rounded-pill bg-brand-red px-1.5 text-[0.68rem] font-bold leading-5 text-white">{waiting > 99 ? "99+" : waiting}</span>}
        </Link>
      ))}
    </nav>
  );
}
