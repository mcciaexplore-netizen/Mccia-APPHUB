"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function Pagination({ total, page, pageSize }: { total: number; page: number; pageSize: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const go = (p: number) => {
    const n = new URLSearchParams(sp.toString());
    n.set("page", String(p));
    router.push(`${pathname}?${n.toString()}`, { scroll: false });
  };
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-[12px] text-muted">
      <span className="tabular-nums">
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-2">
        <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => go(page - 1)}>
          Previous
        </button>
        <span className="tabular-nums">
          Page {page} of {pages}
        </span>
        <button className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => go(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}
