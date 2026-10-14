"use client";

import { useRouter } from "next/navigation";

/** A table row that opens a request when clicked anywhere (the request number inside it is also a real link, for keyboards and screen readers). */
export function ClickableRow({ href, children, level }: { href: string; children: React.ReactNode; level?: string }) {
  const router = useRouter();
  return (
    <tr
      data-level={level} className="cursor-pointer"
      onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button,input,select,textarea")) router.push(href); }}
    >
      {children}
    </tr>
  );
}
