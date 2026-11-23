"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown, Menu } from "lucide-react";

/**
 * Attendance Admin's menu on a phone (below 768 px): one "Menu" button that opens the sidebar and closes again when a page is chosen. From
 * 768 px the sidebar is simply shown. (The hub's own MobileMenu switches at 1024 px; Attendance switches earlier, like its bottom bar.)
 */
export function AttMenu({ label, children }: { label: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  return (
    <div>
      <button type="button" onClick={() => setOpenOn(open ? null : pathname)} aria-expanded={open} className="btn btn-ghost w-full justify-between md:hidden">
        <span className="inline-flex items-center gap-2">
          <Menu size={16} aria-hidden />
          {label}
        </span>
        <ChevronDown size={16} aria-hidden className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <div className={`${open ? "mt-2 block" : "hidden"} md:mt-0 md:block`}>{children}</div>
    </div>
  );
}
