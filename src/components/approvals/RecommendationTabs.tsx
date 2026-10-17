import Link from "next/link";
import { REVIEW_KEYS, REVIEW_LABEL, type ReviewKey } from "@/lib/approvals/approvals.manifest";

/** The two tabs of the Director General's Recommended place: HR and Expenditure, each with how many requests wait for the final decision. */
export function RecommendationTabs({ active, counts }: { active: ReviewKey; counts: Record<ReviewKey, number> }) {
  return (
    <nav className="mb-5 flex gap-2 overflow-x-auto border-b border-line pb-3" aria-label="Recommended lists">
      {REVIEW_KEYS.map((k) => (
        <Link
          key={k} href={`/approvals/review/recommendation/${k}`} aria-current={k === active ? "page" : undefined}
          className={`whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-all duration-200 ${k === active ? "bg-blue-tint text-primary" : "text-muted hover:bg-blue-tint hover:text-primary"}`}
        >
          {REVIEW_LABEL[k]}
          {counts[k] > 0 && <span className="ml-2 rounded-pill bg-brand-red px-1.5 text-[0.68rem] font-bold leading-5 text-white">{counts[k] > 99 ? "99+" : counts[k]}</span>}
        </Link>
      ))}
    </nav>
  );
}
