import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatMonth, shiftMonth } from "@/lib/attendance/time";

/** ‹ November 2026 › — links that keep the rest of the address. */
export function MonthNav({ month, href }: { month: string; href: (month: string) => string }) {
  return (
    <div className="inline-flex items-center gap-1">
      <Link href={href(shiftMonth(month, -1))} className="btn btn-ghost btn-sm" aria-label="Previous month">
        <ChevronLeft size={16} />
      </Link>
      <span className="min-w-[9.5rem] text-center text-sm font-bold text-ink">{formatMonth(month)}</span>
      <Link href={href(shiftMonth(month, 1))} className="btn btn-ghost btn-sm" aria-label="Next month">
        <ChevronRight size={16} />
      </Link>
    </div>
  );
}
