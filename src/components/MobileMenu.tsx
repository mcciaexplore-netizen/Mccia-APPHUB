"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown, Menu } from "lucide-react";

/**
 * A section's sidebar on a phone: one "Menu" button that opens the list, which closes again when a page is chosen, so the page is not pushed
 * below a long list. From a laptop up the list is simply shown beside the page.
 */
export function MobileMenu({ label, children }: { label: string; children: React.ReactNode }) {
  // The page the menu was opened on: once another page is chosen it no longer matches, so the menu is closed again.
  const pathname = usePathname();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  return (
    <div>
      <button type="button" onClick={() => setOpenOn(open ? null : pathname)} aria-expanded={open}
        className="btn btn-ghost w-full justify-between lg:hidden">
        <span className="inline-flex items-center gap-2"><Menu size={16} aria-hidden />{label}</span>
        <ChevronDown size={16} aria-hidden className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <div className={`${open ? "mt-2 block" : "hidden"} lg:mt-0 lg:block`}>{children}</div>
    </div>
  );
}
